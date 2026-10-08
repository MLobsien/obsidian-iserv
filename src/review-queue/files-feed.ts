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
 * Entry-ISO-Datum (date.order im Listing-JSON) — wird nur noch für Display/
 * Sortier-Zwecke außerhalb dieses Moduls genutzt (Fenster-Logik entfernt,
 * Konzept-NEU #12). Behalten als public Export wegen bestehender Nutzer-Tests.
 */
export function entryIsoDate(e: FileEntry): string {
  if (typeof e.date === "string") return e.date;
  if (e.date && typeof e.date.order === "string") return e.date.order;
  return "";
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

/**
 * Folder-Deny-Prädikat (Issue #12, Konzept-NEU): ganze IServ-Unterordner aus
 * der Queue fernhalten. Typ: true = Pfad ist abgelehnt (Ordner selbst oder
 * darunter). Implementierung: denied-folders.ts (DeniedFoldersStore).
 */
export type DenyFolderPredicate = (iservPath: string) => boolean;

/** Vault-Präsenz-Prädikat (Issue #12, Konzept-NEU): Datei ist "im Vault
 * vorhanden" → KEINE Queue-Kandidat mehr (wurde behalten/abgelegt).
 * Typ: true = IServ-Dateipfad existiert im Vault (Name im Vault-Fachordner).
 * Implementierung im Host (main.ts) via app.vault.adapter.exists.
 */
export type ExistsInVaultPredicate = (iservPath: string) => boolean;

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
   * Runde 6 (User): manuelle Overrides „Gruppe=Fach" (Settings queueGroupMap).
   * Wird an subjectFromGroup als 2. Arg gereicht (Priorität vor Auto-Match).
   */
  queueGroupMap?: Record<string, string>;
  /**
   * Issue #12 (Konzept-NEU): Ordner-Ablehnung — ganze IServ-Unterordner
   * (und alles darunter) werden NICHT als Kandidaten erzeugt (inkl. nicht
   * als "auto"). Fail-open: fehlt das Prädikat → nichts abgelehnt.
   */
  deniesFolder?: DenyFolderPredicate;
  /**
   * Issue #12 (Konzept-NEU): Vault-Duplikat-Filter — Dateien, die (per
   * Dateiname, in einem Vault-Ordner der passenden Fach) bereits existieren,
   * sind KEINE Kandidaten mehr (Konzept: "alle Fach-Dokumente ohne Duplikat").
   * Fail-open: fehlt das Prädikat → kein Vault-Check (Alt-Verhalten).
   */
  existsInVault?: ExistsInVaultPredicate;
  /**
   * Issue #12 (Konzept-NEU): stundenplan-basierte Kursordner-Whitelist —
   * NUR Dateien unter diesen Kurs-Ordner-Namen (1 Ebene unter dem Feed-Root
   * "Groups") kommen in die Queue. Leer/ohne = Alt-Verhalten (alle Gruppen-
   * Ordner unter dem Root listen)." */
  courseFolderFilter?: string[];
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
 * Konzept-NEU (Issue #12, maple-Freigabe 08.10): Das Threshold-Fenster
 * (auto/neu nach Review-Frist) fällt KOMPLETT weg — Ziel-Liste = ALLE
 * Kursordner-Dateien ohne Vault-Duplikate und ohne abgelehnte Ordner,
 * alle Items status "neu".
 * - nur `type.id === "File"` (Ordner werden maxDepth-fach oder per
 *   courseFolderFilter-Whitelist nachgelistet)
 * - Queue-Item: id = IServ-Datei-Id (hash-Anker), name, path, status="neu"
 * - subject bleibt Vorschlag (leer erlaubt, wenn courseFolderFilter gesetzt)
 * - filtert: deniedFolder-Prädikat, existsInVault-Prädikat,
 *   Dedup gegen `existing` UND über Ebenen hinweg
 * - best-effort pro Ebene: ein Subordner-Fehler bricht den Feed nicht
 */
export async function fetchQueueItems(
  client: IServClient,
  opts: FetchQueueItemsOptions = {}
): Promise<QueueItem[]> {
  const root = opts.rootPath ?? QUEUE_FEED_ROOT;
  const maxDepth = Math.max(1, opts.maxDepth ?? 1);
  const existingIds = new Set((opts.existing ?? []).map((i) => i.id));
  const out: QueueItem[] = [];

  // Issue #12 (Konzept-NEU): Filterkette der Konzept-Umstellung.
  // deniesFolder/existsInVault: fail-open ohne Prädikat (Alt-Verhalten).
  // courseFolderFilter: undefined = alle Ordner listen (Alt-Verhalten);
  // Array (auch leer) = WHITELIST: nur Segmente 1 Ebene unter dem Root.
  const deniesFolder = opts.deniesFolder;
  const existsInVault = opts.existsInVault;
  const allowedCourseSet =
    opts.courseFolderFilter === undefined
      ? null
      : new Set(opts.courseFolderFilter.filter(Boolean));

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
        const name = entryName(e.name);
        const parentDir = typeof e.path === "string" ? "" : entryPath(e);
        const filePath = parentDir ? `${parentDir}/${name}` : entryPath(e) || name;
        // Issue #12 (Konzept-NEU): Ordner-Ablehnung — Parent-Ordner des
        // Dateipfads (oder der Pfad selbst, string-Entry-Kante) abgelehnt
        // → kein Kandidat (auch kein "auto"). Fail-open ohne Prädikat.
        const parentPath = filePath.includes("/")
          ? filePath.slice(0, filePath.lastIndexOf("/"))
          : "";
        if (deniesFolder?.(parentPath) || deniesFolder?.(filePath)) continue;
        existingIds.add(e.id);
        // Issue #12 (Konzept-NEU): Vault-Duplikat-Filter — Datei bereits im
        // Vault ("alle Fach-Dokumente ohne Duplikat") → kein Kandidat.
        // Fail-open ohne Prädikat (Alt-Verhalten).
        if (existsInVault?.(filePath)) continue;
        // Runde 6 (User): Fach kommt primär aus dem GRUPPEN-Ordner (1. Ebene
        // unter Groups) — authentischer Anker statt Regex am Dateinamen.
        // Dateiname-Regex bleibt Fallback, wenn keine Gruppe abgeleitet werden kann.
        // Issue #7 (29.09.2026): Steuertabelle ohne Match → RAW-Gruppenordner als
        // letzter Anker: herb (f3e03fa, R2) hat live belegt, dass der Kursname
        // EXAKT dem Files-Ordner unter Groups/ entspricht (filesFolderNameForCourse)
        // — d. h. groupSegmentOf(filePath) IST der RAW-Anker, und norm-match
        // (guessSubject) gegen die Vault-Fächer deckt Fächer, die die Tabelle
        // nicht kennt (z. B. "O Informatik 12gN Sz" ↔ Vault "Informatik").
        const group = groupSegmentOf(filePath);
        const queueGroupMap = opts.queueGroupMap ?? {};
        const subject =
          subjectFromGroup(group, queueGroupMap) ??
          guessSubject(name, opts.vaultSubjects ?? []) ??
          (group ? guessSubject(group, opts.vaultSubjects ?? []) : null) ??
          "";
        // Issue #12 (Konzept-NEU, maple-Freigabe 12:37): Ziel-Liste = ALLE
        // Kursordner-Dateien — der KURS-Ordner (Whitelist) ist der Anker,
        // eine Fach-Zuordnung ist NICHT mehr Voraussetzung (Vorschlag).
        // Alt-Feed (ohne courseFolderFilter) behält den Runde-6-Drop
        // (alt UND ohne Fach → raus, keine "auto"-Berge).
        if (!subject && !opts.courseFolderFilter) continue;
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
          status: "neu",
        });
      } else {
        // entryPath ist ein Eltern-Breadcrumb ("Eigene › Schule"), nicht der
        // Kindordner selbst: Ordnerpfad = <aktueller Pfad>/<Name>.
        const childName = entryName(e.name);
        // Issue #12 (Konzept-NEU): courseFolderFilter-WHITELIST — Kinder der
        // Ebene 1 (direkt unter dem Root) nur dann weiterlisten, wenn der
        // Name auf der Kursliste steht; tiefer (depth >1) freilassen.
        if (allowedCourseSet && depth === 1 && !allowedCourseSet.has(childName)) {
          continue;
        }
        if (depth < maxDepth) {
          const subPath = `${path}/${childName}`.replace(/\/+/g, "/");
          await listLevel(subPath, depth + 1);
        }
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
