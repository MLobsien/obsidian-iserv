/**
 * Files-Feed (T3/T4-Verkabelung): Sync-Kandidaten aus IServ-Dateien.
 *
 * Quelle (live verifiziert 2026-09-28, ADR-0001): `file/api/list?id=<b64>`
 * antwortet 200, ABER ignoriert den id-Query-Param für Unterordner still
 * (liefert immer das Root-Listing). Der echte pfadbasierte Endpoint ist
 * `/iserv/file/api/list/<URL-encodierter-Pfad>` — dieser liefert ECHTE
 * Kinder inkl. Files-Entries (`type.id:"File"`, Antwortformat gleich:
 * `{data:[{id,name:{text,link},size,type,path:{link,text}},…], breadcrumbs}`).
 * Download wäre `file/-/<pfad>` (Preview-Aufgabe, hier nicht Teil des Feeds).
 *
 * Der Feed erzeugt NUR Sync-Kandidaten (CONTEXT.md): Fach-Vermutung als
 * Vorschlag, Dedup gegen bestehende Queue-IDs — keine Datei landet ohne
 * aktive Entscheidung (Review-Queue) im Vault.
 */
import type { IServClient } from "../api/shared-client";
import { parseResponseBody } from "../api/shared-client";
import type { QueueItem } from "./state";
import { guessSubject } from "./subject-guess";

/** Verifizierter JSON-Listing-Endpoint (iserv-api.md). */
export const FILES_LIST_PATH = "/iserv/file/api/list";
/**
 * Pfad → Listing-URL. Pfadbasiert (live verifiziert): Query-Param `?id=` wird
 * serverseitig für Unterordner ignoriert, der Pfadsegment-Anhang funktioniert.
 */
export function filesListUrl(path: string): string {
  return `${FILES_LIST_PATH}/${encodeURIComponent(path)}`;
}

/** Backward-compat-Alias: Root-Listing = Listing von "Files". */
export const FILES_ROOT_PATH = "Files";

/** Zeile aus dem file/api/list-Listing (nur die gelesenen Felder). */
export interface FileEntry {
  id: string;
  name: string | { text?: string; link?: string };
  type: { id?: string } | string;
  /** Pflichtfeld im JSON (live): {link,text}; alt: Plain-String. */
  path?: string | { link?: string; text?: string };
  size?: number;
  date?: string;
}

/** entry.path normalisieren: link ("/iserv/file/-/<pfad>") → IServ-Pfad. */
export function entryPath(entry: FileEntry): string {
  const p = entry.path;
  if (typeof p === "string") return p;
  const link = p?.link ?? "";
  const marker = "/iserv/file/-/";
  if (typeof link === "string" && link.startsWith(marker)) {
    return decodeURIComponent(link.slice(marker.length));
  }
  return typeof p?.text === "string" ? p.text : "";
}

export interface FetchQueueItemsOptions {
  /** IServ-Pfad, der gelistet wird (Default: Root "Files"). */
  rootPath?: string;
  /** Listing-Tiefe (User-Kritik Runde 4 / piglet-Follow-Up): 1 = nur Root
   *  (Default, Rückwärtskompatibel), 2 = Subordner werden mitgelistet. */
  maxDepth?: number;
  /** Vault-Fachordner-Namen für die Fach-Vermutung (Vorschlag, nie auto-apply). */
  vaultSubjects?: string[];
  /** Bestehende Queue-Items: deren IDs werden dedupliziert. */
  existing?: QueueItem[];
}

function entryName(name: FileEntry["name"]): string {
  if (typeof name === "string") return name;
  return name?.text ?? "";
}

function typeId(type: FileEntry["type"]): string {
  return typeof type === "string" ? type : (type?.id ?? "");
}

/**
 * Listing-JSON → FileEntry[]. Fail-soft: Non-200/form-ahnhänges → leere Liste
 * (ADR-0007-Pattern: Feed darf die Sidebar nie hart brechen).
 */
export function parseFileListing(body: string): FileEntry[] {
  const parsed = parseResponseBodyRaw(body);
  if (!parsed) return [];
  const data = parsed.data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (e): e is FileEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as FileEntry).id === "string" &&
      entryName((e as FileEntry).name) !== ""
  );
}

/** parseResponseBody auf top-level {data} (besser JSON.parse-Wegwerf). */
function parseResponseBodyRaw(
  body: string
): { data?: unknown[] } | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as { data?: unknown[] };
  } catch {
    return null;
  }
}

/**
 * Hole Sync-Kandidaten aus dem IServ-Datei-Manager (Root-Listing + Subordner
 * bis maxDepth, Runde 4: Root-Files sind bei Mads leer — Dateien liegen in
 * Fächern/Unterordnern).
 * - nur `type.id === "File"` (Ordner werden maxDepth-fach nachgelistet)
 * - Queue-Item: id = IServ-Datei-Id (dient auch als hash-Anker der Source-Liste),
 *   name = Dateiname, path = IServ-Pfad, status = "neu"
 * - Fach-Vermutung per guessSubject (Vorschlag), subject leer wenn kein Match
 * - Dedup gegen `existing` UND über Ebenen hinweg
 * - best-effort pro Ebene: ein Subordner-Fehler bricht den Feed nicht
 */
export async function fetchQueueItems(
  client: IServClient,
  opts: FetchQueueItemsOptions = {}
): Promise<QueueItem[]> {
  const root = opts.rootPath ?? "Files";
  const maxDepth = Math.max(1, opts.maxDepth ?? 1);
  const existingIds = new Set((opts.existing ?? []).map((i) => i.id));
  const out: QueueItem[] = [];

  const listLevel = async (path: string, depth: number): Promise<void> => {
    let entries: FileEntry[] = [];
    try {
      const resp = await client.request(filesListUrl(path));
      if (resp.status === 200) entries = parseFileListing(resp.body);
    } catch {
      return; // best-effort pro Ebene (Netz/Session-Probleme sollen nicht crashen)
    }
    for (const e of entries) {
      const isFile = typeId(e.type) === "File";
      if (isFile) {
        if (existingIds.has(e.id)) continue;
        existingIds.add(e.id);
        const name = entryName(e.name);
        const subject = guessSubject(name, opts.vaultSubjects ?? []) ?? "";
        out.push({
          id: e.id,
          name,
          path: entryPath(e) || `/${name}`,
          hash: e.id,
          subject,
          status: "neu",
        });
      } else if (depth < maxDepth) {
        // entryPath ist ein Eltern-Breadcrumb ("Eigene › Schule"), nicht der
        // Kindordner selbst: Ordnerpfad = <aktueller Pfad>/<Name>.
        const subPath = `${path}/${entryName(e.name)}`.replace(/\/+/g, "/");
        await listLevel(subPath, depth + 1);
      }
    }
  };

  try {
    await listLevel(root, 1);
  } catch {
    return out;
  }
  return out;
}
