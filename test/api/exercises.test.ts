import { describe, it, expect, vi, beforeEach } from "vitest";
import { exercises, parseExercises, docToExercises, ExerciseDoc } from "../../src/api/exercises";
import { JSDOM } from "jsdom";
import type { IServClient } from "../../src/api/exercises";

/** Node-Testdoppel für den Plugin-DOMParser-Seam: jsdom (devDependency, keine Runtime-Dep).
 *  In Produktion liefert defaultHtmlParser den DOMParser-des-Chromium-Wrap. */
function browserParser(html: string): ExerciseDoc | null {
  const doc = new JSDOM(html).window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = doc.querySelector("table") as any;
  if (!table) return { rows: [] };
  const rows = Array.from(table.querySelectorAll("tr")).map((tr: any) => ({
    cells: Array.from(tr.querySelectorAll("th,td")).map((cell: any) => ({
      tag: String(cell.tagName).toLowerCase(),
      text: (cell.textContent ?? "").trim(),
      href: cell.querySelector("a")?.getAttribute("href") ?? null,
    })),
  })) as ExerciseDoc["rows"];
  return { rows };
}

const HTML_WITH_TWO_EXERCISES = `
<html>
<body>
<table>
  <thead>
    <tr>
      <th>Aufgabe</th>
      <th>Kurs</th>
      <th>Abgabefrist</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="/iserv/exercise/show/123">Kapitel 5 Zusammenfassung</a></td>
      <td>12gN</td>
      <td>10.09.2026 14:00</td>
      <td>Offen</td>
    </tr>
    <tr>
      <td><a href="/iserv/exercise/show/456">Hausaufgabe Nr. 3</a></td>
      <td>11eN</td>
      <td>12.09.2026 12:00</td>
      <td>abgegeben</td>
    </tr>
  </tbody>
</table>
</body>
</html>
`;

const HTML_EMPTY_TABLE = `
<html>
<body>
<table>
  <thead>
    <tr>
      <th>Aufgabe</th>
      <th>Kurs</th>
      <th>Abgabefrist</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
  </tbody>
</table>
</body>
</html>
`;

const HTML_NO_TABLE = `<html><body><p>Keine Aufgaben vorhanden.</p></body></html>`;

describe("parseExercises", () => {
  it("parses exercises from HTML table", () => {
    const result = parseExercises(HTML_WITH_TWO_EXERCISES, browserParser);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "123",
      title: "Kapitel 5 Zusammenfassung",
      course: "12gN",
      due: "10.09.2026 14:00",
      status: "Offen",
    });
    expect(result[1]).toEqual({
      id: "456",
      title: "Hausaufgabe Nr. 3",
      course: "11eN",
      due: "12.09.2026 12:00",
      status: "abgegeben",
    });
  });

  it("returns empty array for HTML without table", () => {
    expect(parseExercises(HTML_NO_TABLE, browserParser)).toEqual([]);
  });

  it("returns empty array for empty table body", () => {
    expect(parseExercises(HTML_EMPTY_TABLE, browserParser)).toEqual([]);
  });

  it("skips rows without exercise link", () => {
    const html = `
      <table>
        <tr><th>Aufgabe</th><th>Kurs</th><th>Abgabefrist</th><th>Status</th></tr>
        <tr>
          <td>Kein Link</td>
          <td>12gN</td>
          <td>10.09.2026</td>
          <td>Offen</td>
        </tr>
      </table>
    `;
    expect(parseExercises(html, browserParser)).toEqual([]);
  });
});

describe("exercises", () => {
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
  });

  function makeClient(): IServClient {
    return { request: mockRequest } as IServClient;
  }

  it("fetches and parses exercises, filtering out abgegeben", async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: HTML_WITH_TWO_EXERCISES,
    });

    const client = makeClient();
    const result = await exercises(client, browserParser);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("123");
    expect(result[0].status).toBe("Offen");
    expect(mockRequest).toHaveBeenCalledWith("/iserv/exercise");
  });

  it("returns empty array on non-200 status", async () => {
    mockRequest.mockResolvedValue({
      status: 401,
      headers: {},
      body: "Unauthorized",
    });

    const result = await exercises(makeClient(), browserParser);
    expect(result).toEqual([]);
  });

  it("returns empty array on request error", async () => {
    mockRequest.mockRejectedValue(new Error("Network error"));

    const result = await exercises(makeClient(), browserParser);
    expect(result).toEqual([]);
  });

  it("returns empty array when HTML has no exercises", async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: HTML_EMPTY_TABLE,
    });

    const result = await exercises(makeClient(), browserParser);
    expect(result).toEqual([]);
  });

  it("filters out all exercises when all are abgegeben", async () => {
    const html = `
      <table>
        <tr><th>Aufgabe</th><th>Kurs</th><th>Abgabefrist</th><th>Status</th></tr>
        <tr>
          <td><a href="/iserv/exercise/show/1">Erledigt</a></td>
          <td>12gN</td>
          <td>01.09.2026</td>
          <td>abgegeben</td>
        </tr>
      </table>
    `;
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: html,
    });

    const result = await exercises(makeClient(), browserParser);
    expect(result).toEqual([]);
  });
});

describe("docToExercises (ADR-0007 Seam-Split — pure Extraktion)", () => {
  function makeDoc(rows: { cells: { tag: string; text: string; href: string | null }[] }[]) {
    return { rows };
  }

  it("mappt DOM-Zeilen zu Exercises ohne Regex-HTML-Loops", () => {
    const doc = makeDoc([
      { cells: [
        { tag: "th", text: "Aufgabe", href: null },
        { tag: "th", text: "Kurs", href: null },
        { tag: "th", text: "Frist", href: null },
        { tag: "th", text: "Status", href: null },
      ] },
      { cells: [
        { tag: "td", text: "  Kapitel   5  ", href: "/iserv/exercise/show/123" },
        { tag: "td", text: "12gN", href: null },
        { tag: "td", text: "10.09.2026 14:00", href: null },
        { tag: "td", text: "Offen", href: null },
      ] },
    ]);
    expect(docToExercises(doc as never)).toEqual([
      { id: "123", title: "Kapitel 5", course: "12gN", due: "10.09.2026 14:00", status: "Offen" },
    ]);
  });

  it("überspringt Rows ohne show-Link und mit <4 Zellen", () => {
    const doc = makeDoc([
      { cells: [
        { tag: "td", text: "kein Link", href: null },
        { tag: "td", text: "c", href: null },
        { tag: "td", text: "d", href: null },
        { tag: "td", text: "e", href: null },
      ] },
      { cells: [
        { tag: "td", text: "zu kurz", href: "/iserv/exercise/show/9" },
        { tag: "td", text: "c", href: null },
      ] },
    ]);
    expect(docToExercises(doc as never)).toEqual([]);
  });
});
