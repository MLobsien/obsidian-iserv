/**
 * Ordner-Ablehnung (Issue #12, Konzept-NEU): ganze IServ-Unterordner aus der
 * Review-Queue fernhalten — Rejection nicht nur pro Datei, sondern pro
 * Ordnerpfad (z. B. "Groups/O Latein 12gN Sz/LateinMemes").
 *
 * Persistenz über den PluginDataStore-Vertrag (Plugin.loadData/saveData,
 * fs-Gate: KEIN app.vault.adapter-FS-Zugriff hier). Key im data.json:
 * "review-queue-denied-folders".
 *
 * Semantik:
 * - Deny-Eintrag = IServ-Pfad des ORDNERS (normalisiert: mehrfache Slashes
 *   kollabiert, trailing slash weg, "Groups"-Präfix optional entfernbar —
 *   die Feed-Wurzel ist implizit geduldet).
 * - isDenied(path) = true, wenn `path` EXAKT ein Denied-Ordner ist ODER
 *   unterhalb eines Denied-Ordners liegt (Prefix-Match auf Pfadsegmenten,
 *   kein String-Präfix: "LateinLektionen" matcht NICHT "Latein").
 */
import type { PluginDataStore } from "./state";

export const DENIED_FOLDERS_KEY = "review-queue-denied-folders";

/** Pfad normalisieren: Slashes kollabieren, Ränder trimmen (auch Spaces). */
export function normalizeDenyPath(path: string): string {
  return path
    .trim()
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export class DeniedFoldersStore {
  private folders: Set<string> = new Set();
  private plugin: PluginDataStore;

  constructor(plugin: PluginDataStore) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    const data = await this.plugin.loadData();
    const raw = data[DENIED_FOLDERS_KEY];
    if (Array.isArray(raw)) {
      this.folders = new Set(
        raw
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
          .map(normalizeDenyPath)
      );
    } else {
      this.folders = new Set();
    }
  }

  async save(): Promise<void> {
    const data = await this.plugin.loadData();
    data[DENIED_FOLDERS_KEY] = [...this.folders].sort();
    await this.plugin.saveData(data);
  }

  /** IServ-Ordnerpfad dauerhaft ablehnen (normalisiert gespeichert). */
  deny(path: string): boolean {
    const norm = normalizeDenyPath(path);
    if (!norm) return false;
    const added = !this.folders.has(norm);
    this.folders.add(norm);
    return added;
  }

  /** Ablehnung zurücknehmen (Ordner-Klick "Zulassen"). */
  allow(path: string): boolean {
    const norm = normalizeDenyPath(path);
    if (!norm) return false;
    return this.folders.delete(norm);
  }

  isDenied(path: string): boolean {
    const norm = normalizeDenyPath(path);
    if (!norm) return false;
    for (const folder of this.folders) {
      if (norm === folder) return true;
      if (norm.startsWith(`${folder}/`)) return true;
    }
    return false;
  }

  /** Normalisierte Sortier-Liste (Settings-Anzeige/Debug). */
  list(): string[] {
    return [...this.folders].sort();
  }

  get size(): number {
    return this.folders.size;
  }
}
