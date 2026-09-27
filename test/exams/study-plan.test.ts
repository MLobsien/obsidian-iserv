import { describe, it, expect } from "vitest";
import {
  StudyPlanInput,
  STATUS_GEPLANT,
  SELF_TEST_GATE,
  SESSION_GAPS_DAYS,
  BACK_TO_BACK_PROTOCOL,
  sessionOffsetsFromExam,
  deriveSessionShells,
  generateFrontmatter,
  generateMaterialSection,
  generateLernplanSection,
  generateProtocolSection,
  generateFächerSection,
  buildStudyPlanParts,
  generateStudyPlanContent,
  generateStudyPlan,
} from "../../src/exams/study-plan";

const EXAM_DATE = "2026-10-14"; // Klausur in ~2 Wochen

function makeInput(
  overrides: Partial<StudyPlanInput> = {}
): StudyPlanInput {
  return {
    examTitle: "Analysis Klausur",
    examDate: EXAM_DATE,
    subject: "Mathematik",
    notizenNoten: [
      "Mathematik/Material/AB Stammfunktion.md",
      "Mathematik/KurvenDiskussion.md",
      "Mathematik/Integration.md",
    ],
    ...overrides,
  };
}

describe("generateStudyPlanContent — Frontmatter", () => {
  it("startet mit Frontmatter: exam, subject, due (Termin-ISO), status geplant", () => {
    const md = generateStudyPlanContent(makeInput());
    const head = md.split("\n").slice(0, 6).join("\n");
    expect(head).toBe(
      [
        "---",
        "exam: Analysis Klausur",
        "subject: Mathematik",
        `due: ${EXAM_DATE}`,
        `status: ${STATUS_GEPLANT}`,
        "---",
      ].join("\n")
    );
  });

  it("status ist geplant (ADR-0006 Phase-Start: geplant → in-vorbereitung beim Caller)", () => {
    expect(generateFrontmatter(makeInput())).toContain(
      `status: ${STATUS_GEPLANT}`
    );
  });
});

describe("generateStudyPlanContent — Material", () => {
  it("listet alle übergebenen Notiz-Pfade als Obsidian-Wikilinks", () => {
    const md = generateStudyPlanContent(makeInput());
    expect(md).toContain("## Material");
    expect(md).toContain("[[Mathematik/Material/AB Stammfunktion.md]]");
    expect(md).toContain("[[Mathematik/KurvenDiskussion.md]]");
    expect(md).toContain("[[Mathematik/Integration.md]]");
  });

  it("respektiert die Caller-Sortierung (mtime absteigend = erste Zeile der Reihenfolge)", () => {
    const md = generateMaterialSection(["b.md", "a.md"]);
    const lines = md.split("\n").filter((l) => l.startsWith("- [["));
    expect(lines).toEqual(["- [[b.md]]", "- [[a.md]]"]);
  });

  it("Leer-Liste → Sektion vorhanden mit Hinweis (kein Crash, kein Fake-Link)", () => {
    const md = generateMaterialSection([]);
    expect(md).toContain("## Material");
    expect(md).not.toContain("[[");
  });
});

describe("generateStudyPlanContent — verteilte Sessions", () => {
  it("14-Tage-Fenster: exakt 5 Session-Blöcke", () => {
    const md = generateLernplanSection(makeInput());
    const headers = (md.match(/^### Session \d+ /gm) ?? []).length;
    expect(headers).toBe(5);
  });

  it("Session-Gaps liegen in 1–3 Tagen (T9/Cepeda 2-Wochen-Horizont)", () => {
    for (const gap of SESSION_GAPS_DAYS) {
      expect(gap).toBeGreaterThanOrEqual(1);
      expect(gap).toBeLessThanOrEqual(3);
    }
    expect(SESSION_GAPS_DAYS).toHaveLength(5);
  });

  it("Offsets kumulieren absteigend und bleiben im 2-Wochen-Fenster", () => {
    const offsets = sessionOffsetsFromExam();
    expect(offsets).toHaveLength(5);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeLessThan(offsets[i - 1]);
    }
    // ~2-Wochen-Horizont: erster Block liegt (evens) im Klausur-Fenster (14 T).
    expect(offsets[offsets.length - 1]).toBeGreaterThanOrEqual(1); // Gate vor Termin
    expect(offsets[0]).toBeLessThanOrEqual(14);
  });

  it("Session-Daten sind kalendergenau Termin − daysBefore (UTC, kein DST-Jitter)", () => {
    const sessions = deriveSessionShells(sessionOffsetsFromExam());
    const md = generateLernplanSection(makeInput());
    // Session 1 liegt SESSION_GAPS_DAYS-Total Tage vor dem Termin.
    const totalGapDays = SESSION_GAPS_DAYS.reduce((a, b) => a + b, 0);
    expect(sessions[0].daysBeforeExam).toBe(totalGapDays);
    expect(md).toMatch(new RegExp(`### Session 1 — \\d{4}-\\d{2}-\\d{2}\\s*\\(Gap ${totalGapDays === 10 ? 3 : totalGapDays} Tage, 10 Tage vor Termin`));
    expect(md).toMatch(/### Session 5 — 2026-10-13/);
  });

  it("Gaps zwischen den Blöcken erscheinen im Markdown", () => {
    const md = generateLernplanSection(makeInput());
    // Gap-Kette SESSION_GAPS_DAYS = 3/2/2/2/1 zwischen den 5 Blöcken.
    const gapKette = SESSION_GAPS_DAYS.map((g) => `Gap ${g} Tage`);
    expect(gapKette[0]).toBe("Gap 3 Tage");
    for (const g of gapKette) {
      expect(md).toContain(`${g},`); // „Gap 3 Tage,“ vor dem Termin-Rest
    }
    // Fortlaufend: Session-Daten rücken näher an den Termin.
    expect(md).toContain("### Session 1 — 2026-10-04 (Gap 3 Tage, 10 Tage vor Termin)");
    expect(md).toContain("### Session 5 — 2026-10-13 (Gap 1 Tage, 1 Tage vor Termin)");
  });
});

describe("generateStudyPlanContent — Selbsttest-Gate je Thema", () => {
  it("jede Session hat ≥90 % Selbsttest-Gate-Zeile (Checkbox) je Thema", () => {
    const md = generateStudyPlanContent(makeInput());
    const gateLines = (md.match(/^- \[ \] .*Selbsttest ≥ 90 %$/gm) ?? []).length;
    // 5 Sessions × 5 Themen-Platzhalter
    expect(gateLines).toBe(25);
    expect(md).toContain(`- [ ] Thema 1 — ${SELF_TEST_GATE}`);
  });

  it("Gate-Formulierung konstant über Sessions (RTI/Mastery-Terminologie)", () => {
    const md = generateStudyPlanContent(makeInput());
    expect(md.split(SELF_TEST_GATE).length - 1).toBe(25);
  });
});

describe("generateStudyPlanContent — Back-to-Back-Protokoll", () => {
  it("Checkpoint-Zeilen 70/30 → 80/20 → 90/10 in fortlaufender Reihenfolge", () => {
    const section = generateProtocolSection();
    expect(section).toContain("## Back-to-Back-Protokoll");
    expect(section).toContain("- [ ] Checkpoint 1: 70/30");
    expect(section).toContain("- [ ] Checkpoint 2: 80/20");
    expect(section).toContain("- [ ] Checkpoint 3: 90/10");
  });

  it("Reihenfolge steigt fortschreitend (70 → 80 → 90)", () => {
    expect([...BACK_TO_BACK_PROTOCOL]).toEqual(["70/30", "80/20", "90/10"]);
  });
});

describe("generateStudyPlanContent — interleaved-Platzhalter", () => {
  it("enthält Fächer-Platzhalter-Sektion (User verfeinert)", () => {
    const section = generateFächerSection();
    expect(section).toContain("Fach A (Platzhalter)");
    expect(section).toContain("Fach B (Platzhalter)");
  });
});

describe("generateStudyPlanContent — Sektionen & Reinheit", () => {
  it("enthält die museum Sektionen in fester Reihenfolge", () => {
    const md = generateStudyPlanContent(makeInput());
    const atFrontmatter = md.indexOf("---");
    const atMaterial = md.indexOf("## Material");
    const atLernplan = md.indexOf("## Lernplan");
    const atProtocol = md.indexOf("## Back-to-Back-Protokoll");
    const atFächer = md.indexOf("## Fächer interleaved");
    expect(atFrontmatter).toBe(0);
    expect(atMaterial).toBeGreaterThan(atFrontmatter);
    expect(atLernplan).toBeGreaterThan(atMaterial);
    expect(atProtocol).toBeGreaterThan(atLernplan);
    expect(atFächer).toBeGreaterThan(atProtocol);
  });

  it("kein Pomodoro-Eintrag (schwache Evidenz)", () => {
    const md = generateStudyPlanContent(makeInput());
    expect(md).not.toMatch(/pomodoro/i);
    expect(md).not.toMatch(/pomodoro-techn/i);
  });

  it("kein Datei-IO: Output ist ein plain markdown-String", () => {
    const md = generateStudyPlanContent(makeInput());
    expect(typeof md).toBe("string");
    expect(md).toMatch(/^---\n/);
    expect(md.trim().endsWith("")).toBe(true);
  });

  it("deterministisch: 2 Aufrufe identischer Input → identischer Output", () => {
    const a = generateStudyPlanContent(makeInput());
    const b = generateStudyPlanContent(makeInput());
    expect(a).toBe(b);
  });
});

describe("API-Form", () => {
  it("generateStudyPlanContent ist als export vorhanden (für main.ts Phase-Start)", () => {
    expect(typeof generateStudyPlanContent).toBe("function");
  });

  it("buildStudyPlanParts liefert alle Einzelteile", () => {
    const parts = buildStudyPlanParts(makeInput());
    expect(parts.frontmatter).toMatch(/^---\n/);
    expect(parts.materialSection).toContain("## Material");
    expect(parts.lernplanSection).toContain("## Lernplan");
    expect(parts.protocolSection).toContain("## Back-to-Back-Protokoll");
    expect(parts.fächerSection).toContain("## Fächer interleaved");
  });

  it("generateStudyPlan-Komfort-API gibt den selben String wie generateStudyPlanContent", () => {
    const input = makeInput();
    expect(generateStudyPlan(input)).toBe(generateStudyPlanContent(input));
  });
});
