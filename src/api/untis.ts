/**
 * Untis-HTML-Stundenplan (Dashboard-Primärquelle, User 28.09.2026: „Der
 * Stundenplan im Dashboard nutzt nicht die Untis HTML Stundenpläne, obwohl
 * dies die einzig korrekten sind.").
 *
 * Recherche (Live-Verifizierung 28.09.2026, gymmeck.de):
 * - Die Schule betreibt **keinen** separaten Untis-Host und keine/webuntis
 *   public timetable (WebUntis 302t überall auf index.do; anonyme API 404).
 * - Die Untis-HTML-Pläne laufen ÜBER das IServ Pläne-Modul:
 *   `/iserv/plan/show/raw/Vertretungsplan Schüler/f1|f2/subst_001.htm`
 *   (Untis-2026-Frameset, `meta generator = Untis 2026`, 60s meta refresh).
 * - Verfügbare Reichweite: f1 = HEUTE, f2 = MOTTO (`mon_title` 28.9./29.9.)
 *   — subst_002..014 existieren NICHT (IServ-404-Shell, kein Untis).
 *   → Vertretungen/Pläne sind exactly heute + morgen verfügbar; der
 *     generische Stundenplan (Wochenraster Mo–Fr) kommt weiterhin aus
 *     `timetable-entries/` (DieSchulApp-API), die Untis-Tageslisten liefern
 *     Vertretungs-Detail (Klasse/Stunde/Vertreter/Fach/Raum/Art/Text).
 *
 * Parser (ADR-0007-Pattern wie exercise-feed): DOM-Dokument-Seam +
 * Regex-Fallback; reine Extraktion th↔td positional, Node-testbar.
 */
import type { IServClient } from "./shared-client";

/** Basis-Pfad des Untis-Pläne-Moduls im IServ (immer nur GET). */
export const UNTIS_PLAN_PATH =
  "/iserv/plan/show/raw/Vertretungsplan%20Sch%C3%BCler";

export interface UntisDoc {
  date?: string;
  stand?: string;
  messages: string[];
  absentTeachers?: string;
  rows: UntisRow[];
}

export interface UntisRow {
  klassen: string;
  /** Slot-Nummer(n), Untis-Form „1 - 2" / „3./4." → [1,2]. */
  slots?: number[];
  teacher?: string;
  subject?: string;
  room?: string;
  art?: string;
  insteadOfTeacher?: string;
  text?: string;
}

/** Wie ADR-0007/exercise-feed: (html, parser) → UntisDoc|null. */
export type UntisHtmlParser = (html: string) => UntisDoc | null;

/** Whitespace/NBSP kollabieren + trimmen (wie collapseWhitespace). */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Zellen-Inhalt: Tags entfernen, HTML-Entities lösen (nur básic ESC), NBSP → space.
 * Bewusst keine generische HTML-Entity-Bibliothek (keine Dependency, ADR-0007).
 */
function cellText(raw: string): string {
  return collapseWhitespace(
    raw
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
  );
}

/**
 * Untis-Stundenspalte „1 - 2", „3./4.", „5", „1,2" → [1,2] / [3,4] / [5] / [1,2].
 * Bemerkungs/-Trennung über mehrere Trennzeichen („ - ", „.", „/", „,") hinweg.
 */
export function parseUntisSlotNumbers(raw: string): number[] {
  const txt = collapseWhitespace(raw.replace(/&nbsp;/g, " "));
  const parts = txt.split(/\s*[-./,]+\s*/u);
  const ns: number[] = [];
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (!Number.isNaN(n) && n > 0) ns.push(n);
  }
  return ns;
}

/** Dateizeile aus <div class="mon_title"> („28.9.2026 Montag"). */
export function parseUntisDateTitle(html: string): string | undefined {
  const dom = /<div[^>]*class=["']mon_title["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (dom) {
    const t = cellText(dom[1]);
    if (t) return t;
  }
  return undefined;
}

/** „Stand: 28.09.2026 09:57" Timestamp (Change-Detection-Anker). */
export function parseUntisStand(html: string): string | undefined {
  const m = /Stand:\s*[\s\S]{0,80}?(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/.exec(html);
  return m ? m[1] : undefined;
}

/** HTML (DOM-Seam-Form wie ExerciseDoc, für Injection-Tests) → UntisDoc. */
export function docToUntis(doc: UntisTableDoc | null): UntisDoc | null {
  if (!doc) return null;
  const out: UntisDoc = { date: doc.date, stand: doc.stand, messages: doc.messages, rows: [] };
  out.absentTeachers = doc.absentTeachers;
  out.messages = doc.messages;
  const rows: UntisRow[] = [];
  for (const r of doc.rows) {
    if (r.klassen.toLowerCase() === "klasse(n)") continue;
    const row: UntisRow = { klassen: r.klassen };
    const slots = parseUntisSlotNumbers(r.stunde);
    if (slots.length > 0) row.slots = slots;
    if (r.vertreter &&/[^\s]/.test(r.vertreter)) row.teacher = r.vertreter;
    if (r.fach && /[^\s]/.test(r.fach)) row.subject = r.fach;
    if (r.raum && /^[\s\-]+$/.test(r.raum) === false) row.room = r.raum;
    if (r.art) row.art = r.art;
    if (r.lehrer) row.insteadOfTeacher = r.lehrer;
    if (r.text) row.text = r.text;
    rows.push(row);
  }
  out.rows = rows;
  return rows.length > 0 || (out.messages && out.messages.length > 0) ? out : null;
}

/** DOM-Normalform güngstig für Tests: th↔td positional. */
export interface UntisTableDoc {
  date?: string;
  stand?: string;
  messages: string[];
  absentTeachers?: string;
  rows: {
    klassen: string;
    stunde: string;
    vertreter: string;
    fach: string;
    raum: string;
    art: string;
    lehrer: string;
    text: string;
  }[];
}

/** Produktion: DOMParser (Obsidian-Renderer/Chromium). */
export function defaultUntisHtmlParser(html: string): UntisDoc | null {
  const parser = new DOMParser();
  const dom = parser.parseFromString(html, "text/html");

  const messages: string[] = [];
  let absentTeachers: string | undefined;
  for (const tr of Array.from(dom.querySelectorAll("tr.info"))) {
    const cells = Array.from(tr.querySelectorAll("td,th")).map((c) => cellText(c.textContent ?? ""));
    if (cells.length === 2) {
      const [k, v] = cells;
      if (k === "Abwesende Lehrer") {
        absentTeachers = v;
        continue;
      }
    }
    const joined = cells.filter((t) => t && t !== "Nachrichten zum Tag").join(" ");
    if (joined && joined.trim()) messages.push(joined.trim());
  }

  const rows: UntisTableDoc["rows"] = [];
  for (const tr of Array.from(dom.querySelectorAll("table.mon_list tr"))) {
    const tds = Array.from(tr.querySelectorAll("td.list,th.list")).map((c) =>
      cellText(c.textContent ?? "")
    );
    if (tds.length < 2 || !tds[0] || tds[0] === "Klasse(n)") continue;
    rows.push({
      klassen: tds[0],
      stunde: tds[1] ?? "",
      vertreter: tds[2] ?? "",
      fach: tds[3] ?? "",
      raum: tds[4] ?? "",
      art: tds[5] ?? "",
      lehrer: tds[6] ?? "",
      text: tds[7] ?? "",
    });
  }

  const doc: UntisTableDoc = {
    date: parseUntisDateTitle(html),
    stand: parseUntisStand(html),
    messages,
    absentTeachers,
    rows,
  };
  return docToUntis(doc);
}

/**
 * Regex-Fallback ohne DOM (reine String-Verarbeitung, Node-sicher) —
 * untis-html z.B. in Node/Vitest ohne DOMParser.
 */
export function fallbackUntisParser(html: string): UntisDoc | null {
  const messages: string[] = [];
  let absentTeachers: string | undefined;
  const trRe = /<tr[^>]*class=["']info["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      cellText(c[1])
    );
    if (cells.length === 2 && cells[0] === "Abwesende Lehrer") {
      absentTeachers = cells[1];
      continue;
    }
    const joined = cells.filter((t) => t && t !== "Nachrichten zum Tag").join(" ");
    if (joined.trim()) messages.push(joined.trim());
  }

  const rows: UntisTableDoc["rows"] = [];
  const listRe = /<tr[^>]*class=["']list[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let lr: RegExpExecArray | null;
  while ((lr = listRe.exec(html))) {
    const cells = [...lr[1].matchAll(/<td[^>]*class=["']list[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)].map(
      (c) => cellText(c[1])
    );
    if (cells.length < 2) continue;
    if (cells[0] === "Klasse(n)") continue;
    rows.push({
      klassen: cells[0] ?? "",
      stunde: cells[1] ?? "",
      vertreter: cells[2] ?? "",
      fach: cells[3] ?? "",
      raum: cells[4] ?? "",
      art: cells[5] ?? "",
      lehrer: cells[6] ?? "",
      text: cells[7] ?? "",
    });
  }

  const doc: UntisTableDoc = {
    date: parseUntisDateTitle(html),
    stand: parseUntisStand(html),
    messages,
    absentTeachers,
    rows,
  };
  return docToUntis(doc);
}

/** DOMParser wenn verfügbar (Plugin), sonst Regex-Fallback (Node). */
export function safeUntisParser(html: string): UntisDoc | null {
  if (typeof DOMParser === "undefined") return fallbackUntisParser(html);
  try {
    return defaultUntisHtmlParser(html) ?? fallbackUntisParser(html);
  } catch {
    return fallbackUntisParser(html);
  }
}

/** Zeile betrifft meine Kurse? Klassen-Tokenvergleich (12gN/12eN aus Entries). */
export function rowMentionsClasses(row: UntisRow, classTokens: string[]): boolean {
  if (classTokens.length === 0) return true; // ohne Token-Info nichts filtern (best-effort).
  const k = row.klassen.toLowerCase();
  for (const token of classTokens) {
    const t = token.toLowerCase();
    if (k === t) return true;
    const parts = k.split(/[\s,]+/).filter(Boolean);
    if (parts.includes(t)) return true;
    // „12gN"-Token matcht auch Jahrgangs-Zeilen „12" (Untis listet Jahrgang ohne Suffix).
    const jahrgang = t.replace(/[a-z]+$/i, "");
    if (jahrgang && (parts.includes(jahrgang) || k === jahrgang)) return true;
  }
  return false;
}

export interface FetchUntisOptions {
  frame?: "f1" | "f2";
  file?: string;
  parser?: UntisHtmlParser;
}

/**
 * Untis-HTML-Tagesliste fetchen (best-effort wie files-feed/exercise-feed):
 * Fehler → null, wirft nie. Frame f1 = heute, f2 = morgen (Live-angezeigt).
 */
export async function fetchUntisDoc(
  client: IServClient,
  opts: FetchUntisOptions = {}
): Promise<UntisDoc | null> {
  const frame = opts.frame ?? "f1";
  const file = opts.file ?? "subst_001.htm";
  const parser = opts.parser ?? safeUntisParser;
  try {
    const resp = await client.request(
      `${UNTIS_PLAN_PATH}/${frame}/${file}`
    );
    if (resp.status !== 200) return null;
    // IServ fängt unbekannte Pläne auf seiner 404-Seite mit status 200 ab —
    // nur echte Untis-Dateien (mon_title/mon_list-Marker) akzeptieren.
    const html = resp.body;
    if (!/<meta[^>]*generator[^>]*Untis|<frameset|mon_list/i.test(html)) return null;
    return parser(html);
  } catch {
    return null;
  }
}

export interface UntisDayPlan {
  date?: string;
  stand?: string;
  messages: string[];
  absentTeachers?: string;
  entries: UntisRow[]
}

/** Beide Tageslisten (heute ft, morgen f2) in einem Call-Paar holen. */
export async function fetchUntisBothDays(
  client: IServClient,
  opts: { parser?: UntisHtmlParser } = {}
): Promise<{ today: UntisDayPlan | null; tomorrow: UntisDayPlan | null }> {
  const [t, tm] = await Promise.all([
    fetchUntisDoc(client, { frame: "f1", parser: opts.parser }),
    fetchUntisDoc(client, { frame: "f2", parser: opts.parser }),
  ]);
  const toPlan = (d: UntisDoc | null): UntisDayPlan | null => {
    if (!d) return null;
    return {
      date: d.date,
      stand: d.stand,
      messages: d.messages ?? [],
      absentTeachers: d.absentTeachers,
      entries: d.rows ?? [],
    };
  };
  return { today: toPlan(t), tomorrow: toPlan(tm) };
}
