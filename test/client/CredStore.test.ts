import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CredStore,
  CredStorePlugin,
  SafeStorage,
  EncryptionUnavailableError,
} from "../../src/client/CredStore";

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
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => "basic_gcm"),
    encrypt: vi.fn((buf: Buffer) => Buffer.from("enc:" + buf.toString())),
    decrypt: vi.fn((buf: Buffer) =>
      Buffer.from(buf.toString().replace("enc:", "")),
    ),
  };
}

describe("CredStore (ADR-0003: fail-closed)", () => {
  it("saves and loads with SafeStorage (roundtrip)", async () => {
    const plugin = mockPlugin();
    const ss = mockSafeStorage();
    const store = new CredStore(plugin, ss);

    await store.save("token", "secret-value");
    const result = await store.load("token");

    expect(result).toBe("secret-value");
    expect(ss.encrypt).toHaveBeenCalledOnce();
    expect(plugin.saveData).toHaveBeenCalledOnce();
  });

  it("FAILS CLOSED when safeStorage is unavailable — does not persist, throws actionable error", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, undefined);

    await expect(store.save("host", "gymmeck.de")).rejects.toThrow(
      EncryptionUnavailableError
    );
    // nothing persisted
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on basic_text backend", async () => {
    const plugin = mockPlugin();
    const ss = mockSafeStorage();
    (ss.getSelectedStorageBackend as ReturnType<typeof vi.fn>).mockReturnValue(
      "basic_text"
    );
    const store = new CredStore(plugin, ss);

    await expect(store.save("pass", "x")).rejects.toThrow(/text/);
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when isEncryptionAvailable() is false", async () => {
    const plugin = mockPlugin();
    const ss = mockSafeStorage();
    (ss.isEncryptionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(
      false
    );
    const store = new CredStore(plugin, ss);

    await expect(store.save("pass", "x")).rejects.toThrow(
      EncryptionUnavailableError
    );
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it("saveData payload contains no plaintext credential (cred-free invariant proof)", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, mockSafeStorage());
    await store.save("pass", "topsecret-value");

    const savedData = plugin.saveData.mock.calls[0][0];
    const serialized = JSON.stringify(savedData);
    expect(serialized).not.toContain("topsecret-value");
  });

  it("clear removes a specific key", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, mockSafeStorage());

    await store.save("keep", "a");
    await store.save("remove", "b");
    await store.clear("remove");

    expect(await store.load("keep")).toBe("a");
    expect(await store.load("remove")).toBeNull();
  });

  it("clearAll removes all credentials", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, mockSafeStorage());

    await store.save("a", "1");
    await store.save("b", "2");
    await store.clearAll();

    expect(await store.load("a")).toBeNull();
    expect(await store.load("b")).toBeNull();
  });

  it("load returns null for missing key", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, mockSafeStorage());

    const result = await store.load("nonexistent");
    expect(result).toBeNull();
  });
});

describe("CredStore Session-Persistenz (#17 Fund 5: IServSession im Keychain)", () => {
  it("save→load→clear roundtrip with fake SafeStorage", async () => {
    const plugin = mockPlugin();
    const ss = mockSafeStorage();
    const store = new CredStore(plugin, ss);

    await store.saveSession("IServSession=abc123def; Path=/; Secure");
    const loaded = await store.loadSession();
    expect(loaded).toBe("IServSession=abc123def; Path=/; Secure");

    await store.clearSession();
    expect(await store.loadSession()).toBeNull();
    // Session-Cookie verschlüsselt wie jedes Credential (ADR-0003)
    expect(ss.encrypt).toHaveBeenCalled();
    const serialized = JSON.stringify(plugin.saveData.mock.calls[0][0]);
    expect(serialized).not.toContain("abc123def");
  });

  it("loadSession returns null before anything was saved", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, mockSafeStorage());

    expect(await store.loadSession()).toBeNull();
  });

  it("clearSession without prior save does not throw", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, mockSafeStorage());

    await expect(store.clearSession()).resolves.toBeUndefined();
    expect(await store.loadSession()).toBeNull();
  });

  it("FAILS CLOSED when saving session without secret store (fail-closed, ADR-0003)", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, undefined);

    await expect(store.saveSession("sess-plain")).rejects.toThrow(
      EncryptionUnavailableError
    );
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it("saveSession does not disturb credential keys (shared encrypted store)", async () => {
    const plugin = mockPlugin();
    const store = new CredStore(plugin, mockSafeStorage());

    await store.save("pass", "keep-me");
    await store.saveSession("sess-1");
    await store.clearSession();

    expect(await store.load("pass")).toBe("keep-me");
    expect(await store.loadSession()).toBeNull();
  });
});
