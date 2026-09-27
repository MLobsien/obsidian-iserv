import { createHash } from "crypto";

export interface PluginDataStore {
  loadData(): Promise<Record<string, unknown>>;
  saveData(data: Record<string, unknown>): Promise<void>;
}

/** Plugin-Daten-Key für den Discard-Dedup-Cache (nicht cred-belastet, kein data.json-gitignore). */
export const DISCARD_CACHE_KEY = "review-queue-discard";

export function hashFile(data: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const hash = createHash("sha256").update(data).digest("hex");
    resolve(hash);
  });
}

export function quickHash(
  name: string,
  size: number,
  mtime: number,
): string {
  return createHash("sha256")
    .update(`${name}:${size}:${mtime}`)
    .digest("hex");
}

interface CacheEntry {
  hash: string;
  timestamp: number;
}

export class DiscardCache {
  private entries: Map<string, CacheEntry> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 48 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  add(hash: string): void {
    this.entries.set(hash, { hash, timestamp: Date.now() });
  }

  isDiscarded(hash: string): boolean {
    const entry = this.entries.get(hash);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.entries.delete(hash);
      return false;
    }
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [hash, entry] of this.entries) {
      if (now - entry.timestamp > this.ttlMs) {
        this.entries.delete(hash);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  /** Aktive (nicht abgelaufene) Einträge mit Original-Timestamp für Persistenz. */
  snapshot(): Map<string, CacheEntry> {
    const now = Date.now();
    const out = new Map<string, CacheEntry>();
    this.entries.forEach((entry, hash) => {
      if (now - entry.timestamp <= this.ttlMs) {
        out.set(hash, entry);
      }
    });
    return out;
  }

  /** Persistierten Eintrag (mit Original-Timestamp) direkt übernehmen. */
  restoreEntry(hash: string, timestamp: number): void {
    if (typeof hash !== "string" || !hash) return;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return;
    this.entries.set(hash, { hash, timestamp });
  }
}

/**
 * Persistenz-Schicht für den Discard-Cache (#18 Fund 14): verworfene Datei-Hashes
 * überleben Plugin-Neustarts (sonst erscheint dieselbe Datei direkt nach jedem
 * Obsidian-Start wieder als Sync-Kandidat). Beliebig oft anwendbar; restore()
 * wendet übernommene Einträge in einen (neuen) DiscardCache an, sync() schreibt
 * den Cache-Zustand (oder einen expliziten Quell-Cache) ins Plugin-Data-JSON.
 */
export class DiscardPersistence {
  private store: PluginDataStore;
  private cache: DiscardCache | null;

  constructor(store: PluginDataStore, cache?: DiscardCache) {
    this.store = store;
    this.cache = cache ?? null;
  }

  private requireCache(): DiscardCache {
    if (!this.cache) {
      throw new Error(
        "DiscardPersistence: kein Cache gebunden; sync() nur mit Quell-Cache aufrufen oder Cache im Konstruktor übergeben."
      );
    }
    return this.cache;
  }

  /** Aktive Einträge des Quell-Caches (Default: gebundener Cache) ins Plugin-Data-JSON schreiben. */
  async sync(source?: DiscardCache): Promise<void> {
    const active = source ?? this.requireCache();
    // Map → Plain-Record serialisieren (JSON-safe, Object.entries-kompatibel)
    const valid: Record<string, { time: number }> = {};
    active.snapshot().forEach((entry, hash) => {
      valid[hash] = { time: entry.timestamp };
    });
    const snapshot = { valid };
    const data = await this.store.loadData();
    data[DISCARD_CACHE_KEY] = snapshot;
    await this.store.saveData(data);
  }

  /**
   * Persistierte Einträge in den (neuen) Ziel-Cache übernehmen. Ablgelaufene
   * (TTL > 48h) werden nicht übernommen; der Ziel-Cache entscheided via
   * isDiscarded()/cleanup() über das weitere Alter.
   */
  async restore(target?: DiscardCache): Promise<void> {
    const into = target ?? this.requireCache();
    const data = await this.store.loadData();
    const raw = data[DISCARD_CACHE_KEY] as { valid?: Record<string, { timestamp?: number }> } | undefined;
    const persisted = raw?.valid;
    if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
      return; // fehlt oder malformed: nichts übernehmen (fail-soft)
    }
    for (const [hash, entry] of Object.entries(persisted)) {
      if (!entry || typeof entry !== "object") continue;
      // sync() schreibt { time }, ältere Einzel-Imports { timestamp } — beides ok
      const t = typeof (entry as { time?: number; timestamp?: number }).time
        === "number"
        ? (entry as { time: number }).time
        : (entry as { timestamp?: number }).timestamp;
      if (typeof t !== "number" || !Number.isFinite(t)) continue;
      into.restoreEntry(hash, t);
    }
    // Direkt nach dem Übernehmen abgelaufene Einträge rausschmeißen.
    into.cleanup();
  }
}
