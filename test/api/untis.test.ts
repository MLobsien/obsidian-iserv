import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  collapseWhitespace,
  parseUntisSlotNumbers,
  parseUntisDateTitle,
  parseUntisStand,
  docToUntis,
  fallbackUntisParser,
  safeUntisParser,
  rowMentionsClasses,
  fetchUntisDoc,
  fetchUntisBothDays,
  UNTIS_PLAN_PATH,
  type UntisTableDoc,
} from "../../src/api/untis";

/** Echtes Untis-2026-Markup (live 28.09.2026 gymmeck.de, gekürzt). */
export const UNTIS_SAMPLE = `
<html>
<head>
<meta name="generator" content="Untis 2026">
<meta http-equiv="refresh" content="60; URL=subst_001.htm">
</head>
Stand: 28.09.2026 09:57<p>
<body bgcolor="#F0F0F0">
<CENTER>
<font size="3" face="Arial">
<div class="mon_title">28.9.2026 Montag</div>
<table class="info" >
<tr class="info"><th class="info" align="center" colspan="2">Nachrichten zum Tag</th></tr>
<tr class="info"><td class="info" align="left">Abwesende Lehrer&nbsp;</td><td class="info" align="left">Br, Bu</td></tr>
<tr class='info'><td class='info' colspan="2">Hofdienst 6d</td></tr>
</table>
<table class="mon_list" >
<tr class='list'><th class="list" align="center"><b>Klasse(n)</b></th><th class="list" align="center">Stunde</th><th class="list" align="center">Vertreter</th><th class="list" align="center">Fach</th><th class="list" align="center">Raum</th><th class="list" align="center">Art</th><th class="list" align="center">(Lehrer)</th><th class="list" align="center">Text</th></tr>
<tr class='list odd'><td class="list" align="center" style="background-color: #0351AF" ><b><span style="color: #FFFFFF">6b</span></b></td><td class="list" align="center" style="background-color: #0351AF" ><span style="color: #FFFFFF">1</span></td><td class="list" align="center" style="background-color: #0351AF" ><span style="color: #FFFFFF">---</span></td><td class="list" align="center" style="background-color: #0351AF" ><span style="color: #FFFFFF">---</span></td><td class="list" align="center" style="background-color: #0351AF" ><span style="color: #FFFFFF">---</span></td><td class="list" align="center" style="background-color: #0351AF" ><span style="color: #FFFFFF">Entfall</span></td><td class="list" align="center" style="background-color: #0351AF" ><span style="color: #FFFFFF">Xy</span></td><td class="list" align="center" style="background-color: #0351AF" >&nbsp;</td></tr>
<tr class='list odd'><td class="list" align="center"><b>8b</b></td><td class="list" align="center">5</td><td class="list" align="center">Sü</td><td class="list" align="center">De</td><td class="list" align="center">107</td><td class="list" align="center">Änderung</td><td class="list" align="center">Sara Schütte</td><td class="list" align="center">&nbsp;</td></tr>
<tr class='list odd'><td class="list" align="center"><b>12</b></td><td class="list" align="center">1 - 2</td><td class="list" align="center">+</td><td class="list" align="center">po2</td><td class="list" align="center">26</td><td class="list" align="center">e.L.</td><td class="list" align="center">Leon von Busch</td><td class="list" align="center">&nbsp;</td></tr>
<tr class='list even'><td class="list" align="center"><b>13</b></td><td class="list" align="center">4</td><td class="list" align="center">+</td><td class="list" align="center">wn1</td><td class="list" align="center">101</td><td class="list" align="center">e.L.</td><td class="list" align="center">Sven Brunzendorf</td><td class="list" align="center">&nbsp;</td></tr>
</table>
</font>
</CENTER>
</body>
</html>
`;

describe("untis helpers", () => {
  it("collapseWhitespace kollabiert NBSP + Umbrüche", () => {
    expect(collapseWhitespace("a\u00a0 b\n\u00a0\tc ")).toBe("a b c");
  });

  it.each([
    ["1 - 2", [1, 2]],
    ["3./4.", [3, 4]],
    ["5", [5]],
    ["1,2", [1, 2]],
    ["12", [12]],
    ["", []],
    ["---", []],
  ])("parseUntisSlotNumbers(%j) → %j", (input, expected) => {
    expect(parseUntisSlotNumbers(input)).toEqual(expected);
  });

  it("liest mon_title und Stand aus echtem Markup", () => {
    expect(parseUntisDateTitle(UNTIS_SAMPLE)).toBe("28.9.2026 Montag");
    expect(parseUntisStand(UNTIS_SAMPLE)).toBe("28.09.2026 09:57");
  });
});

describe("fallbackUntisParser (Node, kein DOM)", () => {
  it("parst Rows th↔td positional inkl stattgefundener Werte", () => {
    const doc = fallbackUntisParser(UNTIS_SAMPLE);
    expect(doc).not.toBeNull();
    expect(doc!.date).toBe("28.9.2026 Montag");
    expect(doc!.stand).toBe("28.09.2026 09:57");
    expect(doc!.absentTeachers).toBe("Br, Bu");
    expect(doc!.messages).toContain("Hofdienst 6d");
    const byKlassen = Object.fromEntries(doc!.rows.map((r) => [r.klassen, r]));
    expect(byKlassen["6b"]).toMatchObject({ slots: [1], art: "Entfall", insteadOfTeacher: "Xy" });
    expect(byKlassen["12"]).toMatchObject({
      slots: [1, 2],
      subject: "po2",
      room: "26",
      insteadOfTeacher: "Leon von Busch",
    });
  });

  it("ignoriert Header-Zeile (Klasse(n)) und bei NICHT-Untis-Seite null", () => {
    const doc = fallbackUntisParser(UNTIS_SAMPLE);
    expect(doc!.rows.some((r) => r.klassen.startsWith("Klasse"))).toBe(false);
    expect(fallbackUntisParser("<html><body>kein Plan</body></html>")).toBeNull();
  });
});

describe("docToUntis (DOM-Seam-Form)", () => {
  const tableDoc: UntisTableDoc = {
    date: "29.9.2026 Dienstag",
    messages: ["Abwesende Lehrer: Xy"],
    rows: [
      {
        klassen: "12",
        stunde: "1",
        vertreter: "Kö",
        fach: "bi1",
        raum: "205",
        art: "Vertretung",
        lehrer: "Sinja Böttcher",
        text: "UB",
      },
    ],
  };

  it("bildet UntisRow inkl Slots ab", () => {
    const doc = docToUntis(tableDoc);
    expect(doc!.rows).toHaveLength(1);
    expect(doc!.rows[0]).toMatchObject({
      klassen: "12",
      slots: [1],
      teacher: "Kö",
      subject: "bi1",
      room: "205",
      art: "Vertretung",
      insteadOfTeacher: "Sinja Böttcher",
      text: "UB",
    });
  });

  it("null bei leerem Doc", () => {
    expect(docToUntis(null)).toBeNull();
    expect(docToUntis({ ...tableDoc, rows: [], messages: [] })).toBeNull();
  });
});

describe("safeUntisParser", () => {
  it("liefert in Node den Fallback (kein DOMParser)", () => {
    // Node/Vitest: DOMParser ist undefined → Fallback-Pfad.
    expect(safeUntisParser(UNTIS_SAMPLE)).not.toBeNull();
  });
});

describe("rowMentionsClasses", () => {
  it.each([
    [{ klassen: "12" } as const, ["12gN"], true],
    [{ klassen: "12, 13" } as const, ["13"], true],
    [{ klassen: "12gN, 12eN" } as const, ["12eN"], true],
    [{ klassen: "6b" } as const, ["12gN"], false],
  ])("%j ~ %j → %j", (row, tokens, expected) => {
    expect(rowMentionsClasses(row as never, tokens)).toBe(expected);
  });
});

describe("fetchUntisDoc (mock client)", () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockRequest = vi.fn();
  });

  function makeClient() {
    return { request: mockRequest } as never;
  }

  it("holt f1/subst_001.htm und parst best-effort", async () => {
    mockRequest.mockResolvedValue({ status: 200, headers: {}, body: UNTIS_SAMPLE });
    const doc = await fetchUntisDoc(makeClient(), { parser: fallbackUntisParser });
    expect(mockRequest).toHaveBeenCalledWith(`${UNTIS_PLAN_PATH}/f1/subst_001.htm`);
    expect(doc!.rows).toHaveLength(4);
  });

  it("non-200 → null", async () => {
    mockRequest.mockResolvedValue({ status: 503, headers: {}, body: "err" });
    expect(await fetchUntisDoc(makeClient())).toBeNull();
  });

  it("IServ-404-Shell (status 200 ohne Untis-Marker) → null", async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: "<!doctype html><html lang='de-DE'>IServ Fehler</html>",
    });
    expect(await fetchUntisDoc(makeClient())).toBeNull();
  });

  it("Netzfehler → null (wirft nie)", async () => {
    mockRequest.mockRejectedValue(new Error("boom"));
    expect(await fetchUntisDoc(makeClient())).toBeNull();
  });
});

describe("fetchUntisBothDays", () => {
  it("holt f1+f2 parallel und liefert today/tomorrow", async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: UNTIS_SAMPLE,
    });
    const res = await fetchUntisBothDays({ request: mockRequest } as never, {
      parser: fallbackUntisParser,
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(res.today!.entries).toHaveLength(4);
    expect(res.tomorrow!.entries).toHaveLength(4);
  });
});
