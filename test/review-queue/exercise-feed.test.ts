// @vitest-environment node
/**
 * Unit-Tests für den Studentischen-Aufgaben-Feed (exercise-feed.ts).
 *
 * Konventionen wie files-feed-Tests: jsdom für echte HTML-Formen, fake client
 * mit `{ request }`, best-effort-Vertrag (Fehler → []). Der pure-Parser
 * (docRowToExercise) wird mit Fake-DOM-Zeilen getestet — kein Live-Call.
 */
import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  OPEN_EXERCISE_PATHS,
  collapseWhitespace,
  extractExerciseId,
  parseDueDate,
  docRowToExercise,
  docToOpenExercises,
  fallbackParser,
  parseOpenExerciseIds,
  parseExerciseMeta,
  fetchOpenExercises,
  type ExerciseDoc,
  type ExerciseHtmlParser,
} from "../../src/review-queue/exercise-feed";

/** jsdom-basierter Parser (Produktionsnähe: DOMParser-Verhalten). */
function jsdomParser(html: string): ExerciseDoc | null {
  const doc = new JSDOM(html).window.document;
  const rows: ExerciseDoc["rows"] = [];
  for (const tr of Array.from(doc.querySelectorAll("tr"))) {
    rows.push({
      cells: Array.from(tr.querySelectorAll("th,td")).map((cell) => ({
        tag: cell.tagName.toLowerCase(),
        text: cell.textContent ?? "",
        href: cell.querySelector("a")?.getAttribute("href") ?? null,
      })),
    });
  }
  return rows.length > 0 ? { rows } : null;
}

interface FakeResp {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Fake-IServClient ({ request }), versioniert je Call (v.a. endpoint-Reihenfolge). */
function fakeClient(
  responses: { path: string; status: number; body: string }[]
): { request: ReturnType<typeof vi.fn>; paths: string[] } {
  const paths: string[] = [];
  const request = vi.fn(
    async (path: string): Promise<FakeResp> => {
      paths.push(path);
      const hit = responses.find((r) => r.path === path);
      if (!hit) return { status: 404, headers: {}, body: "" };
      return { status: hit.status, headers: {}, body: hit.body };
    }
  );
  return { request, paths };
}

/** Enter-Ansicht: TODO-Listing mit show-Links (Form wie documented). */
const ENTER_HTML_LIST = `
<html><body>
<div class="exercise-list">
  <a href="/iserv/exercise/show/401">Bio-Protokoll Zellatmung</a>
  <a href="/iserv/exercise/show/402">Mathe Blatt 7</a>
  <a href="/iserv/exercise/show/403">Latein Übersetzung 12</a>
</div>
</body></html>
`;

/** exercise-Tabelle: Titel/Kurs/Frist/Status, Status offen/abgegeben gemischt. */
const EXERCISE_TABLE_HTML = `
<html><body>
<table>
  <thead>
    <tr><th>Aufgabe</th><th>Kurs</th><th>Abgabefrist</th><th>Status</th></tr>
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
</body></html>
`;

function row(cells: ExerciseDoc["rows"][number]["cells"]): ExerciseDoc["rows"][number] {
  return { cells };
}

describe("extractExerciseId", () => {
  it("extrahiert ID aus absolutem show-Link", () => {
    expect(extractExerciseId("/iserv/exercise/show/123")).toBe("123");
  });

  it("extrahiert ID aus relativem enter-Link (Target-Form)", () => {
    expect(extractExerciseId("show/42")).toBe("42");
    expect(extractExerciseId("/exercise/show/99")).toBe("99");
  });

  it("liefert null für null/ohne show-Link", () => {
    expect(extractExerciseId(null)).toBeNull();
    expect(extractExerciseId("/iserv/mail/0/u")).toBeNull();
    expect(extractExerciseId("/iserv/exercise/show/abc")).toBeNull();
  });
});

describe("collapseWhitespace", () => {
  it("kollabiert Umbrueche und NBSP", () => {
    expect(collapseWhitespace("\n  Kapitel\u00a0 5\tZusammenfassung \n")).toBe(
      "Kapitel 5 Zusammenfassung"
    );
  });
});

describe("parseDueDate", () => {
  it("erkennt DE-Datum mit Uhrzeit", () => {
    expect(parseDueDate("10.09.2026 14:00")).toBe("10.09.2026 14:00");
  });
  it("erkennt DE-Datum ohne Uhrzeit", () => {
    expect(parseDueDate("Frist: 05.11.2026")).toBe("05.11.2026");
  });
  it("erkennt ISO-Datum", () => {
    expect(parseDueDate("2026-09-28")).toBe("2026-09-28");
  });
  it("liefert null fuer Kurskuerzel", () => {
    expect(parseDueDate("12gN")).toBeNull();
  });
});

describe("docRowToExercise (pure)", () => {
  it("mappt Tabellen-Zeile (Titel/Kurs/Frist, Status offen)", () => {
    const cells = [
      { tag: "td", text: "Kapitel 5 Zusammenfassung", href: "/iserv/exercise/show/123" },
      { tag: "td", text: "12gN", href: null },
      { tag: "td", text: "10.09.2026 14:00", href: null },
      { tag: "td", text: "Offen", href: null },
    ];
    expect(docRowToExercise(row(cells))).toEqual({
      id: "123",
      name: "Kapitel 5 Zusammenfassung",
      subject: "12gN",
      dueDate: "10.09.2026 14:00",
      status: "open",
    });
  });

  it("FIX #10: Icon-Status-Zelle (title='Erledigt', leerer Text) filtert die Zeile", () => {
    // Live-Befund show/17382: Status-Zelle als Icon (title-Attribut), Text leer.
    const cells = [
      { tag: "td", text: "Spannung und Stromstärke", href: "/iserv/exercise/show/17382" },
      { tag: "td", text: "02.10.2026 08:00", href: null },
      { tag: "td", text: "", href: null, html: '<span class="text-success" title="Erledigt"><span class="fal fa-circle-check"></span></span>' },
    ];
    expect(docRowToExercise(row(cells))).toBeNull();
  });

  it("FIX #10: 'Neu'-Icon (title-Attribut) bleibt im Feed", () => {
    const cells = [
      { tag: "td", text: "Vertretungsaufgabe", href: "/iserv/exercise/show/17393" },
      { tag: "td", text: "05.10.2026 15:16", href: null },
      { tag: "td", text: "", href: null, html: '<span class="text-primary" title="Neu"><span class="fal fa-circle-exclamation"></span></span>' },
    ];
    expect(docRowToExercise(row(cells))).not.toBeNull();
  });

  it("ueberspringt header rows (th)", () => {
    const cells = [
      { tag: "th", text: "Aufgabe", href: null },
      { tag: "th", text: "Kurs", href: null },
      { tag: "th", text: "Frist", href: null },
      { tag: "th", text: "Status", href: null },
    ];
    expect(docRowToExercise(row(cells))).toBeNull();
  });

  it("zeichne Zeilen mit close-Status (abgegeben) nicht als open", () => {
    const cells = [
      { tag: "td", text: "Hausaufgabe Nr. 3", href: "/iserv/exercise/show/456" },
      { tag: "td", text: "11eN", href: null },
      { tag: "td", text: "abgegeben", href: null },
    ];
    expect(docRowToExercise(row(cells))).toBeNull();
  });

  it("ueberspringt Zeilen ohne show-Link", () => {
    const cells = [
      { tag: "td", text: "Kein Link", href: null },
      { tag: "td", text: "Offen", href: null },
    ];
    expect(docRowToExercise(row(cells))).toBeNull();
  });

  it("liefert undefined fuer fehlende Kurs/Due-Felder (best-effort)", () => {
    const cells = [
      { tag: "td", text: "Nur Aufgabe", href: "/iserv/exercise/show/77" },
    ];
    const item = docRowToExercise(row(cells));
    expect(item).toEqual({
      id: "77",
      name: "Nur Aufgabe",
      subject: undefined,
      dueDate: undefined,
      status: "open",
    });
  });
});

describe("docToOpenExercises (pure)", () => {
  it("demedupliziert nach id und fasst open items beider Views", () => {
    const doc: ExerciseDoc = {
      rows: [
        {
          cells: [
            { tag: "th", text: "Aufgabe", href: null },
            { tag: "th", text: "Kurs", href: null },
          ],
        },
        {
          cells: [
            { tag: "td", text: "Kapitel 5", href: "/iserv/exercise/show/123" },
            { tag: "td", text: "12gN", href: null },
            { tag: "td", text: "10.09.2026 14:00", href: null },
            { tag: "td", text: "Offen", href: null },
          ],
        },
        // dupliziert 123 + closed 456 gleichzeitig
        {
          cells: [
            { tag: "td", text: "Kapitel 5 Zusammenfassung", href: "/iserv/exercise/show/123" },
            { tag: "td", text: "abgegeben", href: null },
          ],
        },
        {
          cells: [
            { tag: "td", text: "Hausaufgabe Nr. 3", href: "/iserv/exercise/show/456" },
            { tag: "td", text: "abgegeben", href: null },
          ],
        },
      ],
    };
    const items = docToOpenExercises(doc);
    expect(items.map((i) => i.id)).toEqual(["123"]);
  });
});

describe("fallbackParser (ohne DOM)", () => {
  it("zieht id+name aus show-Anchors", () => {
    const doc = fallbackParser(ENTER_HTML_LIST);
    expect(doc).not.toBeNull();
    const items = docToOpenExercises(doc);
    expect(items.map((i) => i.id)).toEqual(["401", "402", "403"]);
    expect(items[0].name).toBe("Bio-Protokoll Zellatmung");
    expect(items[0].subject).toBeUndefined();
  });

  it("liefert null wenn keine show-Anchors", () => {
    expect(fallbackParser("<html><body><p>leer</p></body></html>")).toBeNull();
  });
});

describe("parseOpenExerciseIds / parseExerciseMeta (pure, kein Live-Call)", () => {
  it("IDs aus enter-HTML (show-Links)", () => {
    // jsdomParser liest nur <tr>-Zeilen; die Enter-Liste ist Link-Form ohne
    // Tabelle → dort greift der safeDefaultParser-Fallback (Anchors).
    expect(parseOpenExerciseIds(ENTER_HTML_LIST, jsdomParser)).toEqual([]);
    expect(parseOpenExerciseIds(ENTER_HTML_LIST)).toEqual([
      "401",
      "402",
      "403",
    ]);
  });

  it("IDs aus Tabellen-HTML", () => {
    expect(parseOpenExerciseIds(EXERCISE_TABLE_HTML, jsdomParser)).toEqual([
      "123",
    ]);
  });

  it("Meta: id/name/subject/dueDate/status aus Tabellen-HTML", () => {
    const meta = parseExerciseMeta(EXERCISE_TABLE_HTML, jsdomParser);
    expect(meta).toEqual([
      {
        id: "123",
        name: "Kapitel 5 Zusammenfassung",
        subject: "12gN",
        dueDate: "10.09.2026 14:00",
        status: "open",
      },
    ]);
  });

  it("liefert [] fuer HTML ohne Aufgaben", () => {
    expect(
      parseOpenExerciseIds("<html><body><p>keine Aufgaben</p></body></html>", jsdomParser)
    ).toEqual([]);
    expect(parseExerciseMeta("<html><body></body></html>", jsdomParser)).toEqual([]);
  });
});

describe("fetchOpenExercises (best-effort-Vertrag)", () => {
  it("holt beide Endpoints und dedupliziert ueber sie hinweg", async () => {
    const c = fakeClient([
      { path: "/iserv/exercise/enter", status: 200, body: ENTER_HTML_LIST },
      { path: "/iserv/exercise", status: 200, body: EXERCISE_TABLE_HTML },
    ]);
    // OHNE explicit parser (safeDefaultParser: Tabelle via DOM-Seite, Liste
    // via Fallback-Anchors) — so wie die Produktion den Feed aufruft.
    const items = await fetchOpenExercises(c as never);
    expect(c.paths).toEqual(["/iserv/exercise/enter", "/iserv/exercise"]);
    // 401/402/403 aus enter, 123 (die enthaltene exercise-Tabelle) neu, 456
    // ist abgegeben → raus. Dedup: 123 nur einmal, auch wenn doppelt gelistet.
    expect(items.map((i) => i.id)).toEqual(["401", "402", "403", "123"]);
    expect(items.every((i) => i.status === "open")).toBe(true);
    expect(items.find((i) => i.id === "123")?.dueDate).toBe("10.09.2026 14:00");
  });

  it("liefert [] bei non-200 auf beiden Endpoints (fail-soft)", async () => {
    const c = fakeClient([
      { path: "/iserv/exercise/enter", status: 401, body: "" },
      { path: "/iserv/exercise", status: 500, body: "" },
    ]);
    const items = await fetchOpenExercises(c as never, { parser: jsdomParser });
    expect(items).toEqual([]);
  });

  it("ueberlebt Netz-Fehler je Endpoint (best-effort)", async () => {
    const request = vi.fn(async (path: string): Promise<FakeResp> => {
      if (path === "/iserv/exercise/enter") throw new Error("Network down");
      return { status: 200, headers: {}, body: EXERCISE_TABLE_HTML };
    });
    const items = await fetchOpenExercises(
      { request } as never,
      { parser: jsdomParser }
    );
    expect(items.map((i) => i.id)).toEqual(["123"]);
  });

  it("respektiert paths-Override (Wiring-Preview, nur ein Endpoint)", async () => {
    const c = fakeClient([
      { path: "/iserv/exercise", status: 200, body: EXERCISE_TABLE_HTML },
    ]);
    const items = await fetchOpenExercises(c as never, {
      parser: jsdomParser,
      paths: ["/iserv/exercise"],
    });
    expect(c.paths).toEqual(["/iserv/exercise"]);
    expect(items.map((i) => i.id)).toEqual(["123"]);
  });

  it("nutzt die dokumentierten Default-Endpoints", () => {
    expect(OPEN_EXERCISE_PATHS).toEqual([
      "/iserv/exercise/enter",
      "/iserv/exercise",
    ]);
  });
});

describe("ExerciseHtmlParser-Seam (Fake-DOM-Stubs wie ADR-0007)", () => {
  it("zulaessiger Stub-Parser wird direkt konsumiert", async () => {
    const stubParser: ExerciseHtmlParser = (html: string) =>
      html.includes("ROW")
        ? {
            rows: [
              {
                cells: [
                  { tag: "td", text: "Stub-Aufgabe", href: "show/55" },
                ],
              },
            ],
          }
        : null;
    const c = fakeClient([
      { path: "/iserv/exercise/enter", status: 200, body: "<ROW/>" },
      { path: "/iserv/exercise", status: 404, body: "" },
    ]);
    const items = await fetchOpenExercises(c as never, { parser: stubParser });
    expect(items.map((i) => i.id)).toEqual(["55"]);
  });
});
