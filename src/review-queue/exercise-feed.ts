/**
 * Studentischer Aufgaben-Feed ("Aktuelles", User-Kritik 28.09.2026):
 * "Aufgaben funktionieren gar nicht — es gibt offene Aufgaben auf IServ, aber
 * keine wird angezeigt."
 *
 * Ursache (live-Spike T11/T12, docs/iserv-api.md Abschnitt "Aufgaben
 * (Classic-Exercise-Modul)"): `dieschulapp/api/1.0/tasks/` ist eine Dead End —
 * `200 []` ist ECHT leer (kein Classic-Datenzustrom) und jedes `filterBy` →
 * 500 "Slim Application Error". Einen JSON-Zugriff fuer Schueler-Exercise-
 * Daten gibt es nicht (`dieschulapp/api/1.0/exercises/` → 404,
 * `exercise/api/v1/…` → 404).
 *
 * Die Truth-Quelle ist das Classic-Exercise-Modul als HTML:
 * - `GET /iserv/exercise` — Tabelle mit Spalten (Titel, Kurs, Frist, Status)
 *   und show-Links `/iserv/exercise/show/<id>` (bestehender Parser:
 *   src/api/exercises.ts).
 * - `GET /iserv/exercise/enter` — Eintritts-/Abgabe-Ansicht des Moduls
 *   (Doku: "Aufgaben (Tutor)"): dieselben Aufgaben als Links inkl. show-Links
 *   (`/iserv/exercise/show/<id>` bzw. relativ `show/<id>`). Dieselben IDs
 *   konsumiert der Abgabe-Flow (submitExercise) — hier repliziert.
 *
 * Feed-Vertrag (wie files-feed): best-effort — 0 Aufgaben, Netz-, Session-
 * oder Parse-Fehler liefern [] und duerfen die Sidebar nie hart brechen.
 * Dedup ueber Endpoints hinweg in fetchOpenExercises.
 */
import type { IServClient } from "../api/shared-client";

/** Zeilen-Shape des Enter-/Tabellen-Dokuments (DOM-Seam wie ADR-0007). */
export interface ExerciseDoc {
  rows: { cells: { tag: string; text: string; href: string | null; /** #10: Zellen-HTML (Status-Icon-Titel-Erkennung, best-effort). */ html?: string }[] }[];
}

/** DOM-Parser-Seam: Produktion DOMParser (Plugin), Tests Fake-DOM-Stubs. */
export type ExerciseHtmlParser = (html: string) => ExerciseDoc | null;

/**
 * Endpoints, die eine Open-/Enter-Liste enthalten koennen (best-effort, genau
 * EIN request je Endpoint). Ueberschreibbar via FetchOpenExercisesOptions.
 */
export const OPEN_EXERCISE_PATHS: readonly string[] = [
  "/iserv/exercise/enter",
  "/iserv/exercise",
];

/** Ein offener Aufgaben-Kandidat fuer die Sidebar "Aktuelles". Obsidian-frei. */
export interface ExerciseItem {
  /** IServ-Exercise-Id (numerisch als string) aus dem show-Link. */
  id: string;
  /** Titel (Link-Text), Whitespace-normalisiert. */
  name: string;
  /** IServ-Kurs-/Gruppenname ("12gN"), best-effort (leer → undefined). */
  subject?: string;
  /** Abgabefrist wie auf IServ angezeigt ("10.09.2026 14:00"), best-effort. */
  dueDate?: string;
  /** Immer "open": dieser Feed listet nur offene (nicht abgegebene) Aufgaben. */
  status: "open";
}

/** Alias fuer die Verdrahtung: Kandidaten sind einfach ExerciseItems. */
export type ExerciseCandidate = ExerciseItem;

/** Whitespace/NBSP/Umbrueche zu einem Leerzeichen kollabieren + trimmen. */
export function collapseWhitespace(text: string): string {
  return text.replace(/[\s\u00a0]+/g, " ").trim();
}

/**
 * show-Link → Exercise-Id. Akzeptiert absolut (/iserv/exercise/show/42) und
 * relativ (show/42), wie es auf exercise/enter vorkommt. Kein Match → null.
 */
export function extractExerciseId(href: string | null): string | null {
  if (!href) return null;
  const absolute = /(?:^|\/)exercise\/show\/(\d+)/.exec(href);
  if (absolute) return absolute[1];
  // Relative enter-View-Form: "show/<id>" ohne exercise-Segment.
  const relative = /(?:^|\/)show\/(\d+)/.exec(href);
  return relative ? relative[1] : null;
}

/** Status-Kandidat: Status wie IServ anzeigt (auch in Wortverbunden). */
function isStatusLike(text: string): boolean {
  return /(?:^|\W)(offen|abgegeben|erledigt|fertig|zu sp[aä]t|versp[aä]tet)(?:\W|$)/i.test(
    text
  );
}

/** Nicht-offene Status-Worte: Zeile filtern (nur "open" bleibt im Feed). */
function isClosedStatus(text: string): boolean {
  return /(?:^|\W)(abgegeben|erledigt|fertig|zu sp[aä]t|versp[aä]tet)(?:\W|$)/i.test(
    text
  );
}

/**
 * Due-Feld-Erkennung (best-effort, so wie IServ es anzeigt): deutsche Formen
 * "10.09.2026" / "10.09.2026 14:00" (plus optionale Zeit) sowie ISO
 * "2026-09-28". Heuristik: Kurs-Kuerzel ("12gN") und Statusworte matchen
 * bewusst NICHT. Liefert den Match-Text, sonst null.
 */
export function parseDueDate(text: string): string | null {
  // Kein End-\b: bei Doppelstempel-Zellen ("16:0026.09.") frißt \b die
  // Uhrzeit weg, weil die nächste Ziffer word-char ist und die Grenze bricht.
  const de =
    /\b[0-3]?\d\.[0-3]?\d\.\d{4}(?:\s*[0-2]?\d:[0-5]\d)?(?:\s+Uhr)?/.exec(text);
  if (de) return collapseWhitespace(de[0]);
  const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(text);
  if (iso) return collapseWhitespace(iso[0]);
  return null;
}

/**
 * Zeile → ExerciseItem (offene Aufgabe) oder null.
 *
 * Reine Extraktion (ADR-0007-Pattern wie docToExercises):
 * - Header-Zeilen (th) und Zeilen ohne show-Link/leerem Titel → null.
 * - Die ERSTE Zelle mit show-Link liefert id + Titel.
 * - Enthaelt IRGENDEINE non-title-Zelle ein nicht-offenes Statuswort
 *   ("abgegeben"/"erledigt"/...) → null: die Zeile ist NICHT offen.
 * - dueDate: erste Zelle mit Datum; subject: erste non-title-Zelle ohne
 *   Datum und ohne Statuswort (best-effort — Flexibilitaet gegen Layout).
 */
export function docRowToExercise(
  row: ExerciseDoc["rows"][number]
): ExerciseItem | null {
  if (row.cells.some((c) => c.tag === "th")) return null;

  const titleCell = row.cells.find(
    (c) => extractExerciseId(c.href) !== null
  );
  const id = extractExerciseId(titleCell?.href ?? null);
  const name = collapseWhitespace(titleCell?.text ?? "");
  if (!id || name === "") return null;

  for (const cell of row.cells) {
    if (cell === titleCell) continue;
    const t = collapseWhitespace(cell.text);
    if (t !== "" && isClosedStatus(t)) return null;
    // #10-Live-Befund (29.09.2026): IServ zeigt Status auch als reines ICON
    // in der Status-Zelle (leerer Text; live verifiziert NUR title="-Attribut,
    // data-title/aria-label/data-original-title kommen nicht vor — defensive
    // Mitnahme der Varianten + Phrase "als erledigt markiert" für andere
    // IServ-Themes). Dann: Zeile ist NICHT offen.
    const cellHtml = cell.html ?? "";
    const stRe =
      /(?:title|data-title|aria-label)="([^"]*(?:Erledigt|Abgegeben|Fertig|Zu sp|Versp|Verspa|als erledigt)[^"]*)"/i;
    if (stRe.test(cellHtml)) return null;
  }

  const texts = row.cells
    .filter((c) => c !== titleCell)
    .map((c) => collapseWhitespace(c.text))
    .filter((t) => t !== "");

  // R6 (rhino-Live-Befund): IServ-Zellen enthalten die Frist teils DOPPELT
  // ("26.09.2026 16:0026.09.2026 16:00" — zwei Datumzellen, whitespace-lost
  // kollabiert). parseDueDate matcht davon nur den ersten Stamp — daher
  // explizit den geparsten Stamp übernehmen statt den rohen Doppelstring.
  const dueRaw = texts.find((t) => parseDueDate(t) !== null);
  const dueDate =
    dueRaw === undefined ? undefined : parseDueDate(dueRaw) ?? dueRaw;
  const subject = texts.find((t) => parseDueDate(t) === null && !isStatusLike(t));

  return {
    id,
    name,
    subject: subject === undefined ? undefined : subject,
    dueDate: dueDate === undefined ? undefined : collapseWhitespace(dueDate),
    status: "open",
  };
}

/**
 * Geparstes Dokument → offene Aufgaben. Reine Funktion (Node-testbar):
 * nicht-Exercise-Zeilen fliegen raus; Dedup nach id (die Enter-View kann
 * dieselbe Aufgabe mehrfach listen).
 */
export function docToOpenExercises(doc: ExerciseDoc | null): ExerciseItem[] {
  if (!doc) return [];
  const items: ExerciseItem[] = [];
  const seen = new Set<string>();
  for (const row of doc.rows) {
    const item = docRowToExercise(row);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

/** Produktion: DOMParser (Obsidian-Renderer/Chromium), zeilenweise Zellen. */
export function defaultExerciseHtmlParser(html: string): ExerciseDoc | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows: ExerciseDoc["rows"] = [];
  for (const tr of Array.from(doc.querySelectorAll("tr"))) {
    rows.push({
      cells: Array.from(tr.querySelectorAll("th,td")).map((cell) => ({
        tag: cell.tagName.toLowerCase(),
        text: cell.textContent ?? "",
        href: cell.querySelector("a")?.getAttribute("href") ?? null,
        html: cell.innerHTML ?? "",
      })),
    });
  }
  return rows.length > 0 ? { rows } : null;
}

/**
 * Regex-Fallback ohne DOM (reine String-Verarbeitung, Node-sicher): liest
 * ZUERST Tabellen-Zeilen (<tr>/<td|th>) mit Zellen-Inhalt (Status bleibt
 * erkennbar!), und NUR wenn KEINE Tabelle existiert, die pure show-Anchors
 * einer Link-Liste (Enter-View: id + Titel ohne Zellen).
 */
export function fallbackParser(html: string): ExerciseDoc | null {
  const rows: ExerciseDoc["rows"] = [];

  // 1) Tabellen-Form: Zellen via <td|th> je <tr>.
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null = trRe.exec(html);
  while (trMatch) {
    const cells: ExerciseDoc["rows"][number]["cells"] = [];
    const tdRe = /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi;
    let tdMatch: RegExpExecArray | null = tdRe.exec(trMatch[1]);
    while (tdMatch) {
      const tag = tdMatch[1];
      const inner = tdMatch[2];
      const href = /<a\b[^>]*href=["']([^"']*)["']/.exec(inner)?.[1] ?? null;
      const text = collapseWhitespace(inner.replace(/<[^>]*>/g, " "));
      cells.push({ tag, text, href,
        // #10: Zellen-HTML für Icon-Status-Erkennung (title="Erledigt" …).
        html: inner,
      });
      tdMatch = tdRe.exec(trMatch[1]);
    }
    if (cells.length > 0) rows.push({ cells });
    trMatch = trRe.exec(html);
  }
  if (rows.length > 0) return { rows };

  // 2) List-Form (enter-View ohne Tabelle): show-Anchors als Einzelzellen.
  const seen = new Set<string>();
  const anchorRe =
    /<a[^>]*href=["']((?:[^"']*\/)?show\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null = anchorRe.exec(html);
  while (m) {
    const href = m[1];
    const id = extractExerciseId(href);
    const name = collapseWhitespace(m[2].replace(/<[^>]*>/g, " "));
    if (id && name && !seen.has(id)) {
      seen.add(id);
      rows.push({ cells: [{ tag: "td", text: name, href }] });
    }
    m = anchorRe.exec(html);
  }
  return rows.length > 0 ? { rows } : null;
}

/** DOMParser wenn verfuegbar (Plugin), sonst Regex-Fallback (Node). */
export function safeDefaultParser(html: string): ExerciseDoc | null {
  let domErr: unknown = null;
  try {
    if (typeof DOMParser === "undefined") return fallbackParser(html);
    const dom = defaultExerciseHtmlParser(html);
    const fb = fallbackParser(html);
    if (!dom) return fb;
    if (!fb) return dom;
    // Merge: DOM rows zuerst, Fallback-Rows (nur Anchor-Form) anhaengen —
    // Dedup nach id in docToOpenExercises.
    return { rows: [...dom.rows, ...fb.rows] };
  } catch (err) {
    domErr = err;
  }
  void domErr;
  try {
    return fallbackParser(html);
  } catch {
    return null;
  }
}

export interface FetchOpenExercisesOptions {
  /** Test-Seam: HTML-Parser injizieren (sonst safeDefaultParser). */
  parser?: ExerciseHtmlParser;
  /** Test-Override: Endpoint-Pfade ersetzen. */
  paths?: readonly string[];
}

/**
 * Offene Aufgaben-Ids aus HTML (pure, kein Live-Call): reine show-Link-Ids
 * in Aussehen-Reihenfolge ohne Duplikate (Enter-View kann doppelt listen).
 */
export function parseOpenExerciseIds(
  html: string,
  parser?: ExerciseHtmlParser
): string[] {
  const doc = (parser ?? safeDefaultParser)(html);
  return doc ? docToOpenExercises(doc).map((i) => i.id) : [];
}

/**
 * Offene Aufgaben-Metadaten aus HTML (pure, kein Live-Call): id/name/subject/
 * dueDate/status. Nutzt den selben Zeilen-Parser wie der Feed.
 */
export function parseExerciseMeta(
  html: string,
  parser?: ExerciseHtmlParser
): ExerciseItem[] {
  const doc = (parser ?? safeDefaultParser)(html);
  return doc ? docToOpenExercises(doc) : [];
}

/**
 * Hole offene Aufgaben (Student-Feed): best-effort ueber OPEN_EXERCISE_PATHS.
 * Non-200, Netzfehler und unparsbare HTML liefern [] — Feed darf die
 * "Aktuelles"-Sidebar niemals hart brechen (files-feed-Pattern).
 */
export async function fetchOpenExercises(
  client: IServClient,
  opts: FetchOpenExercisesOptions = {}
): Promise<ExerciseCandidate[]> {
  const parser = opts.parser ?? safeDefaultParser;
  const paths = opts.paths ?? OPEN_EXERCISE_PATHS;
  const out: ExerciseCandidate[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    let doc: ExerciseDoc | null = null;
    try {
      const resp = await client.request(path);
      if (resp.status === 200) doc = parser(resp.body);
    } catch {
      // best-effort: Netz/Session-Probleme sollen die Sidebar nicht crashen.
    }
    for (const item of docToOpenExercises(doc)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
