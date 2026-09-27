import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  hashFile,
  quickHash,
  DiscardCache,
  DiscardPersistence,
} from "../../src/review-queue/dedup";

describe("hashFile", () => {
  it("returns consistent SHA-256 hash", async () => {
    const data = Buffer.from("hello world");
    const h1 = await hashFile(data);
    const h2 = await hashFile(data);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different hashes for different data", async () => {
    const h1 = await hashFile(Buffer.from("aaa"));
    const h2 = await hashFile(Buffer.from("bbb"));
    expect(h1).not.toBe(h2);
  });
});

describe("quickHash", () => {
  it("returns string from name+size+mtime", () => {
    const h = quickHash("file.md", 1234, 5678);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different hashes for different inputs", () => {
    const h1 = quickHash("a.md", 100, 1);
    const h2 = quickHash("b.md", 100, 1);
    const h3 = quickHash("a.md", 200, 1);
    const h4 = quickHash("a.md", 100, 2);
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).not.toBe(h4);
  });

  it("is deterministic", () => {
    const h1 = quickHash("test.txt", 500, 9999);
    const h2 = quickHash("test.txt", 500, 9999);
    expect(h1).toBe(h2);
  });
});

describe("DiscardCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("add and isDiscarded work", () => {
    const cache = new DiscardCache();
    cache.add("hash1");
    expect(cache.isDiscarded("hash1")).toBe(true);
    expect(cache.isDiscarded("hash2")).toBe(false);
    expect(cache.size).toBe(1);
  });

  it("respects TTL", () => {
    const ttlMs = 1000;
    const cache = new DiscardCache(ttlMs);
    cache.add("h1");

    vi.advanceTimersByTime(500);
    expect(cache.isDiscarded("h1")).toBe(true);

    vi.advanceTimersByTime(600);
    expect(cache.isDiscarded("h1")).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("cleanup removes expired entries", () => {
    const cache = new DiscardCache(100);
    cache.add("a");
    cache.add("b");

    vi.advanceTimersByTime(150);
    cache.cleanup();
    expect(cache.size).toBe(0);
    expect(cache.isDiscarded("a")).toBe(false);
    expect(cache.isDiscarded("b")).toBe(false);
  });

  it("cleanup keeps non-expired entries", () => {
    const cache = new DiscardCache(500);
    const t0 = Date.now();
    cache.add("x");
    cache.add("y");

    vi.setSystemTime(t0 + 200);
    cache.add("z");

    vi.setSystemTime(t0 + 501);
    cache.cleanup();
    expect(cache.size).toBe(1);
    expect(cache.isDiscarded("z")).toBe(true);
  });
});

describe("DiscardPersistence (#18 Fund 14: Discard-Dedup-Cache persistiert)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockPlugin(data: Record<string, unknown> = {}) {
    const store = { ...data };
    return {
      loadData: vi.fn(async () => store),
      saveData: vi.fn(async (d: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(d)) (store as Record<string, unknown>)[k] = v;
      }),
      peek: () => store,
    };
  }

  it("persists discards into a dedicated plugin-data key (key is non-cred, not _credentials)", async () => {
    const plugin = mockPlugin();
    const cache = new DiscardCache();
    const persistence = new DiscardPersistence(plugin, cache);

    cache.add("hash-1");
    await persistence.sync();

    expect(plugin.saveData).toHaveBeenCalledOnce();
    const savedKey = Object.keys(plugin.saveData.mock.calls[0][0]).find(
      (k) => k !== "review-queue" && k !== "_credentials"
    );
    expect(savedKey).toBeDefined();
    expect((plugin.peek() as Record<string, unknown>)[savedKey!]).toBeDefined();
  });

  it("roundtrip survives a new DiscardCache across plugin restarts", async () => {
    const plugin = mockPlugin();
    const write = new DiscardCache();
    const writePersistence = new DiscardPersistence(plugin, write);

    write.add("hash-a");
    write.add("hash-b");
    await writePersistence.sync();

    const read = new DiscardCache();
    const readPersistence = new DiscardPersistence(plugin, read);
    await readPersistence.restore();

    expect(read.isDiscarded("hash-a")).toBe(true);
    expect(read.isDiscarded("hash-b")).toBe(true);
    expect(read.isDiscarded("hash-c")).toBe(false);
  });

  it("restored entries expire according to TTL (timestamp persisted)", async () => {
    const plugin = mockPlugin({ "review-queue-discard": {} });
    const cache = new DiscardCache(48 * 60 * 60 * 1000);
    const persistence = new DiscardPersistence(plugin, cache);

    plugin.peek()["review-queue-discard"] = {
      valid: {
        "old-hash": { time: Date.now() - 100 * 60 * 60 * 1000 }, // 100h alt, TTL 48h
        "fresh-hash": { time: Date.now() - 1000 },
      },
    };

    await persistence.restore();

    expect(cache.isDiscarded("old-hash")).toBe(false);
    expect(cache.isDiscarded("fresh-hash")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("restore cleans up active entries (removes expired ones from cache)", async () => {
    const plugin = mockPlugin({ "review-queue-discard": {} });
    const cache = new DiscardCache(48 * 60 * 60 * 1000);
    const persistence = new DiscardPersistence(plugin, cache);

    plugin.peek()["review-queue-discard"] = {
      valid: {
        "old-hash": { time: Date.now() - 100 * 60 * 60 * 1000 },
      },
    };

    await persistence.restore();
    expect(cache.size).toBe(0);
  });

  it("sync accepts a source cache (write-through) without relying on shared state", async () => {
    const plugin = mockPlugin();
    const cache = new DiscardCache();
    const persistence = new DiscardPersistence(plugin, cache);

    cache.add("hash-w");
    await persistence.sync(cache);

    const persisted = (plugin.peek() as Record<string, unknown>)[
      "review-queue-discard"
    ] as { valid?: Record<string, unknown> };
    expect(persisted.valid["hash-w"]).toBeDefined();
  });

  it("tolerates malformed persisted payload (no throw)", async () => {
    const plugin = mockPlugin({ "review-queue-discard": "garbage" });
    const cache = new DiscardCache();
    const persistence = new DiscardPersistence(plugin, cache);

    await expect(persistence.restore()).resolves.not.toThrow();
    expect(cache.size).toBe(0);
  });
});
