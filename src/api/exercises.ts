/**
 * Exercise (Aufgaben) API client for IServ DieschulApp.
 *
 * Exercises are served as HTML from `/iserv/exercise`.
 * This module parses the HTML table to extract exercise data.
 */

export interface Exercise {
  id: string;
  title: string;
  course: string;
  due: string;
  status: string;
}

export type { IServClient, parseResponseBodyArray } from "./shared-client";
import { IServClient } from "./shared-client";

/** Minimal-DOM-Shape, den docToExercises braucht (ADR-0007 Seam-Split). */
export interface ExerciseDoc {
  /** Zeilen der Tabelle; jede Zeile hat Zellen mit tag-Namen + Textinhalt. */
  rows: { cells: { tag: string; text: string; href: string | null }[] }[];
}

/** DOM-Parser-Seam: Produktion DOMParser (Plugin), Tests Fake-DOM-Stubs. */
export type HtmlParser = (html: string) => ExerciseDoc | null;

/** Default: thin DOMParser-Wrapper (läuft nur im Plugin — Chromium-Renderer). */
export function defaultHtmlParser(html: string): ExerciseDoc | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = doc.querySelector("table") as any;
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll("tr")).map((tr: any) => ({
    cells: Array.from(tr.querySelectorAll("th,td")).map((cell: any) => ({
      tag: cell.tagName.toLowerCase(),
      text: (cell.textContent ?? "").trim(),
      href: cell.querySelector("a")?.getAttribute("href") ?? null,
    })),
  }));
  return { rows };
}

/** Reine Extraktion (Node-testbar): Zeile→Objekt, header-Zeile überspringen. */
export function docToExercises(doc: ExerciseDoc | null): Exercise[] {
  if (!doc) return [];
  const exercises: Exercise[] = [];

  for (const row of doc.rows) {
    if (row.cells.some((c) => c.tag === "th")) continue; // Header-Zeile
    if (row.cells.length < 4) continue;

    const [titleCell, courseCell, dueCell, statusCell] = row.cells.map((c) => ({
      text: stripTags(c.text),
      href: c.href,
    }));

    const id = extractIdFromHref(titleCell.href);
    if (!id) continue;

    exercises.push({
      id,
      title: titleCell.text,
      course: courseCell.text,
      due: dueCell.text,
      status: statusCell.text,
    });
  }

  return exercises;
}

function stripTags(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractIdFromHref(href: string | null): string | null {
  const match = href?.match(/\/exercise\/show\/(\d+)/);
  return match ? match[1] : null;
}

/** Entry-Punkt: parseExercises nutzt die Default-Parser (DOMParser im Plugin). */
export function parseExercises(html: string, parser?: HtmlParser): Exercise[] {
  const parse = parser ?? defaultHtmlParser;
  return docToExercises(parse(html));
}

export async function exercises(
  client: IServClient,
  /** injizierbar für Node-Tests (jsdom); Production: defaultHtmlParser (DOMParser). */
  parser?: HtmlParser
): Promise<Exercise[]> {
  try {
    const response = await client.request("/iserv/exercise");

    if (response.status !== 200) {
      return [];
    }

    const parsed = parseExercises(response.body, parser);

    return parsed.filter((ex) => ex.status !== "abgegeben");
  } catch {
    return [];
  }
}
