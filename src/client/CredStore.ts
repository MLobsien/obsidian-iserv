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
  /** String-Varianten (werden im Obsidian-Renderer über electron.remote expose; evtl. Promise-rückgebend). */
  encryptString?(plain: string): Buffer | Promise<Buffer>;
  encryptStringAsync?(plain: string): Buffer | Promise<Buffer>;
  decryptString?(cipher: Buffer): string | Promise<string> | { result?: string } | Promise<{ result?: string }>;
  decryptStringAsync?(cipher: Buffer): string | Promise<string> | { result?: string } | Promise<{ result?: string }>;
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
const SESSION_KEY = "_session";
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
    store[key] = (await this.encryptToString(value)) ?? "";
    if (!store[key]) {
      throw new EncryptionUnavailableError(
        "safeStorage liefert keine encrypt-Funktion (encryptString/encrypt fehlen)");
    }

    data[CRED_KEY] = store;
    await this.plugin.saveData(data);
  }

  /**
   * encrypt über die verfügbare Variante:
   * Renderer (Obsidian/Electron) exponiertencryptString/-Async über remote.safeStorage;
   * das Buffer-encrypt steht nur Main-Process-seitig zur Verfügung.
   */
  private async encryptToString(plain: string): Promise<string | null> {
    const ss = this.safeStorage!;
    const pick = (v: unknown): unknown => {
      if (v && typeof v === "object" && "result" in (v as object)) {
        return (v as { result?: string }).result;
      }
      return v;
    };
    if (ss.encryptStringAsync) {
      const cipher = pick(await ss.encryptStringAsync(plain)) as unknown;
      if (cipher instanceof Buffer) return cipher.toString("base64");
      if (typeof cipher === "string") return cipher;
    }
    if (ss.encryptString) {
      const cipher = pick(ss.encryptString(plain)) as unknown;
      if (cipher instanceof Buffer) return cipher.toString("base64");
      if (typeof cipher === "string") return cipher;
    }
    // Letzter Fallback: Buffer-Variante (Main-Process-API; Tests nutzen diesen Pfad).
    if (typeof ss.encrypt === "function") {
      return ss.encrypt(Buffer.from(plain, "utf-8")).toString("base64");
    }
    return null;
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
      const plain = await this.decryptFromString(raw);
      if (plain !== null) return plain;
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

  /** decrypt-Spiegel von encryptToString (siehe dort). */
  private async decryptFromString(cipherB64: string): Promise<string | null> {
    const ss = this.safeStorage;
    if (!ss) return null;
    const cipherBuf = Buffer.from(cipherB64, "base64");
    const pick = (v: unknown): unknown => {
      if (v && typeof v === "object" && "result" in (v as object)) {
        return (v as { result?: string }).result;
      }
      return v;
    };
    try {
      if (ss.decryptStringAsync) {
        const plain = pick(await ss.decryptStringAsync(cipherBuf));
        if (typeof plain === "string") return plain;
      }
      if (ss.decryptString) {
        const plain = pick(ss.decryptString(cipherBuf));
        if (typeof plain === "string") return plain;
      }
    } catch { /* fall through to null */ }
    // Letzter Fallback: Buffer-Variante (Base64 in data.json; Main-Process-API/Tests).
    if (typeof ss.decrypt === "function") {
      return ss.decrypt(cipherBuf).toString("utf-8");
    }
    return null;
  }

  /**
   * IServSession-Cookie (#17 Fund 5): wie ein Credential im OS-Secret-Store
   * (Keychain) persistiert, damit das stille Re-Login ohne Klartext-Cookie in
   * data.json möglich ist. Fail-closed wie save().
   */
  async saveSession(cookieValue: string): Promise<void> {
    await this.save(SESSION_KEY, cookieValue);
  }

  /** Gespeicherten Session-Cookie laden; null wenn keiner vorhanden/entschlüsselbar. */
  async loadSession(): Promise<string | null> {
    try {
      const raw = await this.load(SESSION_KEY);
      return raw ?? null;
    } catch (err) {
      if (err instanceof EncryptionUnavailableError) {
        return null; // keiner/früherer Eintrag ohne aktiven Store → kein Session-Cookie
      }
      throw err;
    }
  }

  /** Session-Cookie löschen (z. B. nach Logout oder bei defekter Session). */
  async clearSession(): Promise<void> {
    await this.clear(SESSION_KEY);
  }
}
