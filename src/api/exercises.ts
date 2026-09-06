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

/** Minimal shape of an IServ client with a `request` method. */
export interface IServClient {
  request(
    path: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> }
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    json?: unknown;
  }>;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function extractIdFromLink(cell: string): string | null {
  const match = cell.match(/href="[^"]*\/exercise\/show\/(\d+)"/);
  return match ? match[1] : null;
}

function extractTitleFromLink(cell: string): string {
  const match = cell.match(/<a[^>]*>([^<]+)<\/a>/);
  return match ? match[1].trim() : stripTags(cell);
}

export function parseExercises(html: string): Exercise[] {
  const exercises: Exercise[] = [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let isHeader = true;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowContent = rowMatch[1];

    if (/<th[\s>]/i.test(rowContent)) {
      isHeader = false;
      continue;
    }

    if (isHeader) continue;

    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      cells.push(cellMatch[1]);
    }

    if (cells.length < 4) continue;

    const id = extractIdFromLink(cells[0]);
    if (!id) continue;

    const title = extractTitleFromLink(cells[0]);
    const course = stripTags(cells[1]);
    const due = stripTags(cells[2]);
    const status = stripTags(cells[3]);

    exercises.push({ id, title, course, due, status });
  }

  return exercises;
}

export async function exercises(
  client: IServClient
): Promise<Exercise[]> {
  try {
    const response = await client.request("/iserv/exercise");

    if (response.status !== 200) {
      return [];
    }

    const parsed = parseExercises(response.body);

    return parsed.filter((ex) => ex.status !== "abgegeben");
  } catch {
    return [];
  }
}
