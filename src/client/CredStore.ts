/**
 * CredStore - Encrypted credential storage using Obsidian safeStorage
 *
 * Desktop: encrypt/decrypt via safeStorage
 * Mobile/Fallback: plaintext with console.warn
 */

export interface CredStorePlugin {
  loadData(): Promise<Record<string, unknown>>;
  saveData(data: Record<string, unknown>): Promise<void>;
}

export interface SafeStorage {
  encrypt(data: Buffer): Buffer;
  decrypt(data: Buffer): Buffer;
}

const CRED_KEY = "_credentials";

export class CredStore {
  private plugin: CredStorePlugin;
  private safeStorage: SafeStorage | null;

  constructor(plugin: CredStorePlugin, safeStorage?: SafeStorage) {
    this.plugin = plugin;
    this.safeStorage = safeStorage ?? null;
  }

  async save(key: string, value: string): Promise<void> {
    const data = await this.plugin.loadData();
    const store = (data[CRED_KEY] as Record<string, string>) ?? {};

    if (this.safeStorage) {
      const encrypted = this.safeStorage.encrypt(Buffer.from(value, "utf-8"));
      store[key] = encrypted.toString("base64");
    } else {
      console.warn(
        "CredStore: safeStorage unavailable — storing plaintext",
      );
      store[key] = value;
    }

    data[CRED_KEY] = store;
    await this.plugin.saveData(data);
  }

  async load(key: string): Promise<string | null> {
    const data = await this.plugin.loadData();
    const store = (data[CRED_KEY] as Record<string, string>) ?? {};
    const raw = store[key];

    if (raw === undefined) {
      return null;
    }

    if (this.safeStorage) {
      const decrypted = this.safeStorage.decrypt(
        Buffer.from(raw, "base64"),
      );
      return decrypted.toString("utf-8");
    }

    return raw;
  }

  async clear(key: string): Promise<void> {
    const data = await this.plugin.loadData();
    const store = (data[CRED_KEY] as Record<string, string>) ?? {};
    delete store[key];
    data[CRED_KEY] = store;
    await this.plugin.saveData(data);
  }

  async clearAll(): Promise<void> {
    const data = await this.plugin.loadData();
    data[CRED_KEY] = {};
    await this.plugin.saveData(data);
  }
}
