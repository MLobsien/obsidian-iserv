import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashFile, quickHash, DiscardCache } from "../../src/review-queue/dedup";

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
