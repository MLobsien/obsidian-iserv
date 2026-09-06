import { describe, it, expect, beforeEach } from "vitest";
import { CredStore, CredStorePlugin, SafeStorage } from "../../src/client/CredStore";

function createMockPlugin(): CredStorePlugin & {
  getData: () => Record<string, unknown>;
} {
  let store: Record<string, unknown> = {};
  return {
    getData: () => store,
    loadData: async () => ({ ...store }),
    saveData: async (d: Record<string, unknown>) => {
      store = { ...d };
    },
  };
}

function createMockSafeStorage(): SafeStorage {
  const keys = new Map<string, string>();

  return {
    encrypt: (data: Buffer) => {
      const id = `enc-${keys.size}`;
      keys.set(id, data.toString("utf-8"));
      return Buffer.from(id, "utf-8");
    },
    decrypt: (data: Buffer) => {
      const id = data.toString("utf-8");
      const plain = keys.get(id);
      if (plain === undefined) {
        throw new Error(`Unknown encrypted key: ${id}`);
      }
      return Buffer.from(plain, "utf-8");
    },
  };
}

describe("CredStore", () => {
  let plugin: ReturnType<typeof createMockPlugin>;
  let safeStorage: SafeStorage;
  let store: CredStore;

  beforeEach(() => {
    plugin = createMockPlugin();
    safeStorage = createMockSafeStorage();
    store = new CredStore(plugin, safeStorage);
  });

  it("save stores encrypted value", async () => {
    await store.save("token", "secret123");

    const data = plugin.getData();
    const creds = data["_credentials"] as Record<string, string>;

    expect(creds).toBeDefined();
    expect(creds["token"]).not.toBe("secret123");
    expect(typeof creds["token"]).toBe("string");
  });

  it("load returns decrypted value", async () => {
    await store.save("token", "secret123");
    const loaded = await store.load("token");
    expect(loaded).toBe("secret123");
  });

  it("load returns null for missing key", async () => {
    const loaded = await store.load("nonexistent");
    expect(loaded).toBeNull();
  });

  it("clear removes key", async () => {
    await store.save("token", "secret123");
    await store.clear("token");

    const loaded = await store.load("token");
    expect(loaded).toBeNull();
  });

  it("clearAll removes all keys", async () => {
    await store.save("token1", "secret1");
    await store.save("token2", "secret2");
    await store.clearAll();

    const data = plugin.getData();
    const creds = data["_credentials"] as Record<string, string>;
    expect(creds).toEqual({});
  });

  it("fallback to plaintext when no safeStorage", async () => {
    const plainStore = new CredStore(plugin);
    await plainStore.save("token", "secret123");

    const data = plugin.getData();
    const creds = data["_credentials"] as Record<string, string>;
    expect(creds["token"]).toBe("secret123");

    const loaded = await plainStore.load("token");
    expect(loaded).toBe("secret123");
  });
});
