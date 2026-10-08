/**
 * Issue #17-P3 (User-Feedback 08.10): "Extern öffnen" öffnet NICHT mehr die
 * IServ-URL (das externe Programm ist nicht in IServ eingeloggt — fast nie
 * möglich). Neuer Flow: Datei HERUNTERLADEN (bestehende Bytes-Chain) →
 * lokal als Datei ablegen → Standard-Programm öffnen. Kein URL-Fallback:
 * wenn der Download scheitert, kommt eine Fehlermeldung (kein stiller
 * Failure, keine nutzlose URL-Öffnung).
 *
 * fs-Gate (Hard-Regel): KEIN Node-fs im Renderer. Schreiben über
 * app.vault.adapter.writeBinary in einen definierten Plugin-Cache-Ordner
 * (`.obsidian/plugins/iserv-integration/temp/`, außerhalb des User-Vault-
 * Inhalts). Öffnen über Electron remote shell (Desktop-only; Mobile haltet
 * die Kette bewusst an mit klarer Meldung, kein stiller Failure).
 *
 * Lifecycle: die Temp-Datei BLEIBT nach openPath liegen — OS-Programme
 * öffnen lazy, sofortiges Entfernen kann das Öffnen zerreißen. Aufgeräumt
 * wird beim nächsten Plugin-Load (cleanupExternTemp, aus main.ts oninit).
 *
 * Zwei obsidian-freie Schichten (Seam-Split):
 * - pure Logik: externTempDir(), externTempPath(name), sanitizeExternName()
 * - runExternOpen(deps, name, fetchBytes): orchestriert die Kette; die
 *   Obsidian-Shell (main.ts) wired adapter/shell/notice-Callbacks rein.
 */

/** Cache-Ordner (relativ zum Vault-Root) für die extern-Öffnen-Ablage. */
export const EXTERN_TEMP_DIR = ".obsidian/plugins/iserv-integration/temp";

/** Dateiname auf sichere Basis reparen (kein Pfad-Escape, keine Übel). */
export function sanitizeExternName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").trim();
  const cleaned =
    base.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").replace(/^\.+/, "_") ||
    "anlage.bin";
  return cleaned.length > 180 ? cleaned.slice(0, 180) : cleaned;
}

export function externTempDir(): string {
  return EXTERN_TEMP_DIR;
}

/** Volle Ablage-Pfad-Kombination (Ordner + sanitizierter Dateiname). */
export function externTempPath(name: string): string {
  return `${EXTERN_TEMP_DIR}/${sanitizeExternName(name)}`;
}

/** Result der Kette: ok + Pfad (für Anzeige) oder ok=false + Grund. */
export type ExternOpenResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export interface ExternOpenDeps {
  /** Obsidian-Adapter (fs-Gate-konform): mkdir/exists/writeBinary/remove. */
  adapter: {
    mkdir(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    list(path: string): Promise<{ files: string[]; folders: string[] }>;
    remove(path: string): Promise<void>;
  };
  /** bytes → local fs (implements acriptor callback for desc.) */
  openPath: (absOrVaultPath: string) => Promise<unknown>;
  /** true = Desktop-Electron mit remote-shell verfügbar. */
  isDesktop: boolean;
  /** Kette-Statusmeldung (pro Schritt, für Notices im Caller). */
  onProgress?: (msg: string) => void;
}

/**
 * Komplette Kette: mkdir → writeBinary → exists-Beweis → openPath.
 * KEIN URL-Fallback: bei DL-Scheitern/Alpha-Scheitern ok=false + Grund.
 */
export async function runExternOpen(
  deps: ExternOpenDeps,
  filename: string,
  fetchBytes: () => Promise<Uint8Array | null>
): Promise<ExternOpenResult> {
  if (!deps.isDesktop) {
    return {
      ok: false,
      reason: "Extern öffnen ist nur am Desktop verfügbar (Mobile-Gate).",
    };
  }
  const path = externTempPath(filename);
  let fileNameLocal = filename;
  try {
    deps.onProgress?.("Extern öffnen: lade Datei …");
    const bytes = await fetchBytes();
    if (!bytes || bytes.length === 0) {
      return { ok: false, reason: "Download fehlgeschlagen (keine Bytes)." };
    }
    // Kollision im Cache-Ordner: gleicher Name, anderer Inhalt → nummerieren.
    const collisionAware = await dedupeExternName(deps.adapter, path);
    fileNameLocal = collisionAware.split("/").pop() ?? filename;
    const realPath = collisionAware;
    // mkdir-Safety (maple-Zusatz): Ordner existenziell verifizieren — kein
    // stiller Failure bei fehlendem Ordner, writeBinary schlägt dann stumpf.
    await deps.adapter.mkdir(EXTERN_TEMP_DIR).catch(() => undefined);
    const dirReady = await deps.adapter.exists(EXTERN_TEMP_DIR);
    if (!dirReady) {
      return {
        ok: false,
        reason: `Cache-Ordner nicht erstellbar (${EXTERN_TEMP_DIR}).`,
      };
    }
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    await deps.adapter.writeBinary(realPath, buf);
    // Beweis-Schritt: die Datei MUSS existieren (kein stiller Failure).
    const exists = await deps.adapter.exists(realPath);
    if (!exists) {
      return { ok: false, reason: `Ablage fehlgeschlagen (${realPath}).` };
    }
    deps.onProgress?.(`Extern öffnen: ${fileNameLocal} wird geöffnet …`);
    await deps.openPath(realPath);
    return { ok: true, path: realPath };
  } catch (err) {
    return {
      ok: false,
      reason: `Extern öffnen fehlgeschlagen: ${String(err).slice(0, 100)}`,
    };
  }
}

/**
 * Kollision: Wenn der Zielpfad schon existiert, hängt ein `-N`-Suffix an
 * (bevor Inhalt verglichen wird — Adapter-Lesen von Binaries vermeiden).
 */
async function dedupeExternName(
  adapter: ExternOpenDeps["adapter"],
  path: string
): Promise<string> {
  if (!(await adapter.exists(path))) return path;
  const dot = path.lastIndexOf(".");
  const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!(await adapter.exists(candidate))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * Aufräumen beim Plugin-Load: alle Dateien im temp-Ordner entfernen
 * (die liegengebliebenen Vorstage-Opens). Fehler → fail-soft (der
 * Cache darf nicht die Plugin-Init lahmlegen).
 */
export async function cleanupExternTemp(
  adapter: ExternOpenDeps["adapter"]
): Promise<void> {
  try {
    const dir = EXTERN_TEMP_DIR;
    if (!(await adapter.exists(dir))) return;
    const { files } = await adapter.list(dir);
    for (const f of files) {
      await adapter.remove(f).catch(() => undefined);
    }
  } catch {
    // fail-soft: Cache-Aufräumen ist best effort (ADR-0007-Konvention).
  }
}
