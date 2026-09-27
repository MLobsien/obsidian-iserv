/**
 * CredStore - Credential storage per ADR-0003:
 * Electron safeStorage (OS secret store), FAIL-CLOSED — wenn Verschlüsselung
 * nicht verfügbar ist (kein safeStorage / basic_text-Backend), wird NICHT
 * persistiert; save() wirft mit actionablen Setup-Hinweisen.
 * `data.json` bleibt cred-free-Code-Invariante: Im Klartext gespeicherte
 * Credentials verlassen dieses Modul nicht.
 */

export interface CredStorePlugin {
  loadData(): Promise<Record<string, unknown>>;
  saveData(data: Record<string, unknown>): Promise<void>;
}

export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encrypt(data: Buffer): Buffer;
  decrypt(data: Buffer): Buffer;
}

/** ADR-0003 fail-closed: kein Persist ohne OS-Secret-Store. */
export class EncryptionUnavailableError extends Error {
  constructor(reason: string) {
    super(
      `Credential-Speicherung nicht möglich: ${reason}. ` +
        "Setup-Hinweise: OS-Secret-Service installieren (Linux: gnome-keyring/keepassxc, " +
        "D-Bus-Interface org.freedesktop.secrets muss erreichbar sein; ggf. Obsidian " +
        "mit --password-store=gnome-libsecret starten). Credentials werden NICHT " +
        "gespeichert, bis die Verschlüsselung verfügbar ist (fail-closed, ADR-0003)."
    );
    this.name = "EncryptionUnavailableError";
  }
}

const CRED_KEY = "_credentials";
const PLAINTEXT_BACKEND = "basic_text";

export class CredStore {
  private plugin: CredStorePlugin;
  private safeStorage: SafeStorage | null;

  constructor(plugin: CredStorePlugin, safeStorage?: SafeStorage) {
    this.plugin = plugin;
    this.safeStorage = safeStorage ?? null;
  }

  /** ADR-0003 Runtime-Check: throw statt persist, wenn Verschlüsselung fehlt. */
  private assertEncryptionAvailable(): void {
    const ss = this.safeStorage;
    if (!ss || !ss.isEncryptionAvailable()) {
      throw new EncryptionUnavailableError(
        "safeStorage ist nicht verfügbar (Verschlüsselung deaktiviert)"
      );
    }
    const backend = ss.getSelectedStorageBackend();
    if (backend === PLAINTEXT_BACKEND) {
      throw new EncryptionUnavailableError(
        `Secret-Store-Backend ist '${backend}' (unverschlüsselt)`
      );
    }
  }

  async save(key: string, value: string): Promise<void> {
    this.assertEncryptionAvailable();

    const data = await this.plugin.loadData();
    const store = (data[CRED_KEY] as Record<string, string>) ?? {};
    const encrypted = this.safeStorage!.encrypt(Buffer.from(value, "utf-8"));
    store[key] = encrypted.toString("base64");

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

    // Bestehende Einträge entschlüsseln; ohne safeStorage können wir nichts lesen.
    if (this.safeStorage?.isEncryptionAvailable() &&
        this.safeStorage.getSelectedStorageBackend() !== PLAINTEXT_BACKEND) {
      const decrypted = this.safeStorage.decrypt(Buffer.from(raw, "base64"));
      return decrypted.toString("utf-8");
    }

    throw new EncryptionUnavailableError(
      "Verschluesselter Eintrag kann ohne aktiven Secret-Store nicht gelesen werden"
    );
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
