import { describe, it, expect, vi, beforeEach } from "vitest";
import { CredStore, CredStorePlugin, SafeStorage } from "../../src/client/CredStore";

function mockPlugin(data: Record<string, unknown> = {}): CredStorePlugin {
  const store = { ...data };
  return {
    loadData: vi.fn().mockResolvedValue(store),
    saveData: vi.fn().mockImplementation(async (d: Record<string, unknown>) => {
      Object.assign(store, d);
    }),
  };
}

function mockSafeStorage(): SafeStorage {
  return {
    encrypt: vi.fn((buf: Buffer) => Buffer.from("enc:" + buf.toString())),
    decrypt: vi.fn((buf: Buffer) =>
      Buffer.from(buf.toString().replace("enc:", "")),
    ),
  };
}

describe("CredStore", () => {
  it("saves and loads with SafeStorage (roundtrip)", async () => {
    const plugin = mockPlugin();
    const ss = mockSafeStorage();
    const store = new CredStore(plugin, ss);

    await store.save("token", "secret-value");
    const result = await store.load("token");

    expect(result).toBe("secret-value");
    expect(ss.encrypt).toHaveBeenCalledOnce();
    expect(ss.decrypt).toHaveBeenCalledOnce();
    expect(plugin.saveData).toHaveBeenCalledOnce();
  });

  it("saves and loads without SafeStorage (plaintext fallback)", async () => {
    const plugin = mockPlugin();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new CredStore(plugin);

    await store.save("key1", "plain-value");
    const result = await store.load("key1");

    expect(result).toBe("plain-value");
    expect(warnSpy).toHaveBeenCalledWith(
      "CredStore: safeStorage unavailable — storing plaintext",
    );
    warnSpy.mockRestore();
  });

  it("clear removes a specific key", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin);

    await store.save("keep", "a");
    await store.save("remove", "b");
    await store.clear("remove");

    expect(await store.load("keep")).toBe("a");
    expect(await store.load("remove")).toBeNull();
  });

  it("clearAll removes all credentials", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin);

    await store.save("a", "1");
    await store.save("b", "2");
    await store.clearAll();

    expect(await store.load("a")).toBeNull();
    expect(await store.load("b")).toBeNull();
  });

  it("load returns null for missing key", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin);

    const result = await store.load("nonexistent");
    expect(result).toBeNull();
  });

  it("save persists via plugin.saveData", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin);

    await store.save("cred", "val");

    expect(plugin.saveData).toHaveBeenCalledOnce();
    const savedData = plugin.saveData.mock.calls[0][0];
    expect(savedData).toHaveProperty("_credentials");
  });
});
