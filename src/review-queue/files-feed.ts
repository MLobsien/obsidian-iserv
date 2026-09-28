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
import { guessSubject, subjectFromGroup } from "./subject-guess";

/** Verifizierter JSON-Listing-Endpoint (iserv-api.md). */
export const FILES_LIST_PATH = "/iserv/file/api/list";
/**
 * Default-Feed-Root (Runde 5, User 28.09.2026): Lehrer-Dateien liegen unter
 * Groups (Kurs-/Gruppenordner), nicht in den eigenen Files — Root=Groups.
 */
export const QUEUE_FEED_ROOT = "Groups";
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
  /** Live: {display, order}; alt: Plain-String. */
  date?: string | { display?: string; order?: string };
}

/**
 * Entry-ISO-Datum (date.order im Listing-JSON, z. B. "2026-09-28T…+00:00").
 * Live-Fix (Runde 5): date ist ein OBJECT {display, order} — nicht ein string.
 * Vorher lieferte entryIsoDate immer "" → entryTime=NaN → alles "auto".
 */
export function entryIsoDate(e: FileEntry): string {
  if (typeof e.date === "string") return e.date;
  if (e.date && typeof e.date.order === "string") return e.date.order;
  return "";
}

/**
 * Threshold "heute" (Runde 5): ISO-Datum >= Tagesanfang von `now` (lokal) —
 * kein Alt-Ballast aus vergangenen Schuljahren. Fail-closed: ohne parsebares
 * Datum fliegt die Datei raus (kein Kandidat ohne weniger Info).
 */
/**
 * Runde 5 (User): Threshold ist eine REVIEW-FRIST (Tage zurück), kein
 * hartes "nur heute". Innerhalb des Fensters → reviewen ("neu"), dahinter →
 * auto ("auto") — niemals Einzelsichtung alt-Dateien erzwingen.
 */
export function isWithinThreshold(e: FileEntry, now: Date, days: number): boolean {
  const iso = entryIsoDate(e);
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const cutoff = dayStart - (days - 1) * 86_400_000;
  return t >= cutoff;
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
  /** IServ-Pfad, der gelistet wird (Default: "Groups" — Runde 5). */
  rootPath?: string;
  /**
   * Listing-Tiefe. Runde 5 (User): KEIN willkürlicher Cut bei 3 — viele
   * Lehrer legen mehr als 3 Unterordner tiefer ab. Obergrenze 8 (dezent,
   * Ring-Schutz) pro Ordner-Ebene; der Datum-Threshold trennt Alt von Neu.
   */
  maxDepth?: number;
  /** Vault-Fachordner-Namen für die Fach-Vermutung (Vorschlag, nie auto-apply). */
  vaultSubjects?: string[];
  /** Bestehende Queue-Items: deren IDs werden dedupliziert. */
  existing?: QueueItem[];
  /**
   * Zeit-Threshold (Runde 5): ISO-Datei-Datum `< dateFromMs` fliegt raus —
   * Default = Tagesanfang von „jetzt“ (heute). `null` = Filter aus
   * (Backwartskompatibilität/Test-Seam).
   */
  /** Referenz-"jetzt" (Tests); default real now. null = Threshold aus. */
  now?: Date | null;
  dateFromMs?: number | null;
  /**
   * Review-Frist in Tagen (Runde 5, User): NICHT fest "heute" — Dateien
   * innerhalb des Fensters kommen als "neu" (Einzelsichtung), ÄLTERE werden
   * automatisch entschieden (status "auto"), nie einzeln markiert.
   */
  thresholdDays?: number;
  /**
   * Runde 6 (User): manuelle Overrides „Gruppe=Fach" (Settings queueGroupMap).
   * Wird an subjectFromGroup als 2. Arg gereicht (Priorität vor Auto-Match).
   */
  queueGroupMap?: Record<string, string>;
}

/**
 * Runde 6 (User): Gruppen-Segment (1. Ebene unter dem Feed-Root `Groups`) ist
 * der authentische Fach-Anker — NICHT der Dateiname. Hilfsfunktion, um den
 * IServ-Gruppen-Namen aus dem Pfad zu holen (str-invariant, root-agnostisch).
 */
export function groupSegmentOf(path: string): string {
  const segs = path.split("/");
  // Live-Layout: filePath beginnt mit dem Feed-Root ("Groups/AG Informatik
  // Ja/..."), das erste Segment ist also NICHT die Gruppe. Root überlesen,
  // nächstes Segment = Gruppen-Anchor (Tests/Legacy ohne Root bleiben valide).
  const start = segs[0] === QUEUE_FEED_ROOT ? 1 : 0;
  return (segs[start] ?? "").split("\\")[0] ?? "";
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
  const root = opts.rootPath ?? QUEUE_FEED_ROOT;
  const maxDepth = Math.max(1, opts.maxDepth ?? 1);
  // Runde 5 (User): Threshold = Review-Frist in Tagen (default 7). Frischer
  // als die Frist → "neu" (einzeln reviewen), älter → "auto" (automatisch
  // entschieden, kein Einzelfeedback). dateFromMs bleibt Test-Override; null
  // = Threshold komplett aus (alle "neu").
  const now = opts.now !== undefined ? opts.now : new Date();
  const thresholdDays = opts.thresholdDays ?? 7;
  const cutoffMs =
    opts.dateFromMs !== undefined
      ? opts.dateFromMs
      : now
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
          (thresholdDays - 1) * 86_400_000
        : null;
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
        // älter als Frist → "auto" (entschieden), innerhalb → "neu"
        const entryTime = entryIsoDate(e) ? Date.parse(entryIsoDate(e)!) : NaN;
        const decided =
          cutoffMs !== null && !(Number.isNaN(entryTime) ? false : entryTime >= cutoffMs);
        existingIds.add(e.id);
        const name = entryName(e.name);
        const parentDir = typeof e.path === "string" ? "" : entryPath(e);
        const filePath = parentDir ? `${parentDir}/${name}` : entryPath(e) || name;
        // Runde 6 (User): Fach kommt primär aus dem GRUPPEN-Ordner (1. Ebene
        // unter Groups) — authentischer Anker statt Regex am Dateinamen.
        // Dateiname-Regex bleibt Fallback, wenn keine Gruppe abgeleitet werden kann.
        const group = groupSegmentOf(filePath);
        const queueGroupMap = opts.queueGroupMap ?? {};
        const subject =
          subjectFromGroup(group, queueGroupMap) ??
          guessSubject(name, opts.vaultSubjects ?? []) ??
          "";
        // Runde 6 (User 17:41): alt UND ohne Fach → gar nicht in die Queue.
        // Keine „auto"-Berge mehr: nicht reviewbare Alt-Dateien (AGs ohne
        // Vault-Ordner) tauchen nirgends auf und fluten nichts.
        if (decided && !subject) continue;
        // Runde 5 live-Fix (Preview broken): entry.path ist der ORDNER
        // („Files/Downloads"), der Dateipfad ist <ordner>/<name>. Sonst zeigt
        // die Preview-URL auf den Ordner (nginx 400/HTML) — nie die Datei.
        // entryPath: object-Form (live real {link,text}) = ORDNERpfad →
        // dranhängen; string-Form (Tests/legacy) = bereits Dateipfad.
        out.push({
          id: e.id,
          name,
          path: filePath,
          hash: e.id,
          subject,
          status: decided ? "auto" : "neu",
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
