/**
 * Ordner-Ablehnung (Issue #12, Konzept-NEU): ganze IServ-Unterordner aus der
 * Review-Queue fernhalten — Rejection nicht nur pro Datei, sondern pro
 * Ordnerpfad (z. B. "Groups/O Latein 12gN Sz/LateinMemes").
 *
 * Issue #17 Punkt 4 (User-Feedback 08.10): selektives ZULASSEN von
 * Unterordnern — ein erlaubter Sub-Ordner unter einem Denied-Ordner gewinnt
 * (längster Matching-Präfix entscheidet). Beispiel: "Groups/O Latein 12gN Sz"
 * denied, "Groups/O Latein 12gN Sz/Lektion 7" allowed ⇒ Lektion-7-Dateien
 * kommen in die Queue, der Rest von Latein bleibt draußen.
 *
 * Persistenz über den PluginDataStore-Vertrag (Plugin.loadData/saveData,
 * fs-Gate: KEIN app.vault.adapter-FS-Zugriff hier). Keys im data.json:
 * - "review-queue-denied-folders": string[] (bestehendes Format, unverändert)
 * - "review-queue-allowed-folders": string[] (neu, Issue #17.4)
 *
 * Semantik:
 * - Einträge = IServ-Pfade von ORDNERN (normalisiert: mehrfache Slashes
 *   kollabiert, trailing slash weg).
 * - isDenied(path): längsterpfad-segment-exakter Matching-Präfix entscheidet
 *   (kein String-Präfix: "LateinLektionen" matcht NICHT "Latein"). Allowed
 *   schlägt Denied bei gleich langem oder längeren Match.
 */
import type { PluginDataStore } from "./state";

export const DENIED_FOLDERS_KEY = "review-queue-denied-folders";
export const ALLOWED_FOLDERS_KEY = "review-queue-allowed-folders";

/** Pfad normalisieren: Slashes kollabieren, Ränder trimmen (auch Spaces). */
export function normalizeDenyPath(path: string): string {
  return path
    .trim()
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/** Tiefste (längste) Registry-Entry, das `path` segment-exakt abdeckt, oder null. */
function longestMatchingPrefixDir(
  paths: Iterable<string>,
  norm: string
): string | null {
  let best: string | null = null;
  for (const dir of paths) {
    if (norm === dir || norm.startsWith(`${dir}/`)) {
      if (best === null || dir.length > best.length) best = dir;
    }
  }
  return best;
}

export class DeniedFoldersStore {
  private folders: Set<string> = new Set();
  /** Issue #17.4: explizit erlaubte Ordner (siegen über Denied-Ancestor). */
  private allowed: Set<string> = new Set();
  private plugin: PluginDataStore;

  constructor(plugin: PluginDataStore) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    const data = await this.plugin.loadData();
    const readList = (key: string): Set<string> => {
      const raw = data[key];
      return new Set(
        Array.isArray(raw)
          ? raw.filter((s): s is string => typeof s === "string" && s.trim() !== "")
              .map(normalizeDenyPath)
          : []
      );
    };
    this.folders = readList(DENIED_FOLDERS_KEY);
    // Migration (#17.4): Alt-Bestand kannte nur den DENIED-Key; allowed startet leer.
    this.allowed = readList(ALLOWED_FOLDERS_KEY);
  }

  async save(): Promise<void> {
    const data = await this.plugin.loadData();
    data[DENIED_FOLDERS_KEY] = [...this.folders].sort();
    data[ALLOWED_FOLDERS_KEY] = [...this.allowed].sort();
    await this.plugin.saveData(data);
  }

  /** IServ-Ordnerpfad dauerhaft ablehnen (normalisiert gespeichert). */
  deny(path: string): boolean {
    const norm = normalizeDenyPath(path);
    if (!norm) return false;
    // Konsistenz (#17.4): ein explizit erlaubter Ordner darf nicht gleichzeitig
    // denied sein — deny räumt gleichen Pfad aus allowed (Sub-Allows bleiben).
    this.allowed.delete(norm);
    const added = !this.folders.has(norm);
    this.folders.add(norm);
    return added;
  }

  /**
   * Ordner ZULASSEN (Issue #17.4): unter einem Denied-Ancestor erlaubt diesen
   * Pfad (und alles darunter) wieder — längster Matching-Präfix entscheidet.
   * Gleichzeitig allowed- und denied-Eintrag ist ausgeschlossen (deny räumt ab).
   */
  allow(path: string): boolean {
    const norm = normalizeDenyPath(path);
    if (!norm) return false;
    this.folders.delete(norm);
    const added = !this.allowed.has(norm);
    this.allowed.add(norm);
    return added;
  }

  /**
   * Zulassen-Entscheidung zurücknehmen (weder denied noch allowed) — der
   * Ordner fällt auf "geerbt" zurück (Deny-Ancestor greift wieder).
   */
  unallow(path: string): boolean {
    return this.allowed.delete(normalizeDenyPath(path));
  }

  isDenied(path: string): boolean {
    const norm = normalizeDenyPath(path);
    if (!norm) return false;
    const denied = longestMatchingPrefixDir(this.folders, norm);
    if (!denied) return false;
    const allowed = longestMatchingPrefixDir(this.allowed, norm);
    // Erlaubter (längster-anwendbarer) Ordner gewinnt: erlaubt = weder denied
    // selbst noch denied-Ancestor mit <= Tiefe des Allowed-Treffers.
    if (allowed && allowed.length >= denied.length) return false;
    return true;
  }

  /** Normalisierte Sortier-Listen (Settings-Anzeige/Debug). */
  list(): string[] {
    return [...this.folders].sort();
  }
  listAllowed(): string[] {
    return [...this.allowed].sort();
  }

  get size(): number {
    return this.folders.size;
  }
}
