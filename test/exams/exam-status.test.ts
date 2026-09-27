import { describe, it, expect, beforeEach } from "vitest";
import {
  computeStatus,
  cycleStatus,
  parseImportedStatus,
  toStatusExam,
  EXAM_STATUSES,
  type StatusExam,
} from "../../src/exams/exam-status";
import {
  setBaseDays,
  resetBaseDays,
} from "../../src/exams/prep-window";
import { ExamType, ExamStatus as LegacyExamStatus } from "../../src/exams/template";

// Feste Referenzzeit (tages-Granularität wie prepWindow).
const NOW = new Date("2026-09-27T12:00:00");

function exam(partial: Partial<StatusExam> = {}): StatusExam {
  return {
    date: new Date("2026-10-07T08:00:00"), // 10 Tage nach NOW
    points: 15, // Multiplikator 0.7 → Klausurfenster 14*0.7 = ceil 10 Tage
    ...partial,
  };
}

describe("computeStatus — Status aus Fenstern (ADR-0006)", () => {
  beforeEach(() => resetBaseDays());

  it("vor Fensterstart → geplant", () => {
    // Klausur, points 15 → Fenster = ceil(14*0.7) = 10 Tage → Start 2026-09-27.
    // NOW ist genau am Starttage → Grenzfall wird separat getestet; hier: früher.
    const e = exam({ date: new Date("2026-10-08T08:00:00") });
    expect(computeStatus(e, NOW)).toBe("geplant");
  });

  it("im Fenster (Termin − Fenster ≤ now ≤ Termin) → in-vorbereitung", () => {
    setBaseDays({ [ExamType.Klausur]: 14 });
    // Termin 2026-10-07, NOW 2026-09-27: Fenster ≥ 10 Tage → NOW im Fenster.
    const e = exam();
    expect(computeStatus(e, NOW)).toBe("in-vorbereitung");
  });

  it("Fenster-Start = Termin − Basis×Multiplikator (Tages-Granularität, inklusiv)", () => {
    setBaseDays({ [ExamType.Klausur]: 15 });
    // points 15, mult 0.7 → 15*0.7 = 10.5 → ceil 11 Tage → Start 2026-09-26.
    const e = exam();
    expect(computeStatus(e, NOW)).toBe("in-vorbereitung");
    // NOW vor Fensterstart.
    const before = new Date("2026-09-25T12:00:00");
    expect(computeStatus(e, before)).toBe("geplant");
  });

  it("mult skaliert Fenster: 0 Punkte → ×3.0 → Großes Fenster, früher in-vorbereitung", () => {
    resetBaseDays();
    const e = exam({ points: 0 }); // mult 3.0 → ceil(14*3)=42 Tage → Start 2026-08-16
    const mid = new Date("2026-09-01T08:00:00");
    expect(computeStatus(e, mid)).toBe("in-vorbereitung");
  });

  it("am Termin-Tag selbst: noch in-vorbereitung (Tages-Granularität)", () => {
    setBaseDays({ [ExamType.Test]: 30 });
    const e = exam({ type: ExamType.Test, date: new Date("2026-09-27T08:00:00") });
    expect(computeStatus(e, NOW)).toBe("in-vorbereitung");
  });

  it("default type = Klausur, default points = 15", () => {
    const e = { date: new Date("2026-10-07T08:00:00") };
    expect(computeStatus(e, NOW)).toBe("in-vorbereitung");
  });

  it("importierter Status (Frontmatter-override) gewinnt über Fenster (F5)", () => {
    // Fenster würde in-vorbereitung sagen, override sagt fertig.
    const e = exam({ status: "fertig" });
    expect(computeStatus(e, NOW)).toBe("fertig");
    const e2 = exam({ status: "postponed" });
    expect(computeStatus(e2, NOW)).toBe("verschoben");
  });

  it("unbekannter Status-String → Fenster-Ableitung (fallback)", () => {
    const e = exam({ status: "murks" });
    expect(computeStatus(e, NOW)).toBe("in-vorbereitung");
  });

  it("kein Persist: computeStatus ändert die Eingabe nicht (pure)", () => {
    const e = exam();
    const before = JSON.stringify(e);
    computeStatus(e, NOW);
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe("parseImportedStatus (Legacy-Adapter)", () => {
  it("mappt neue und Legacy-Werte", () => {
    expect(parseImportedStatus("geplant")).toBe("geplant");
    expect(parseImportedStatus("planned")).toBe("geplant");
    expect(parseImportedStatus("in-prep")).toBe("in-vorbereitung");
    expect(parseImportedStatus("in-vorbereitung")).toBe("in-vorbereitung");
    expect(parseImportedStatus("done")).toBe("fertig");
    expect(parseImportedStatus("fertig")).toBe("fertig");
    expect(parseImportedStatus("postponed")).toBe("verschoben");
    expect(parseImportedStatus("verschoben")).toBe("verschoben");
  });

  it("unbekannt/leer → null", () => {
    expect(parseImportedStatus("")).toBeNull();
    expect(parseImportedStatus(undefined)).toBeNull();
    expect(parseImportedStatus("wasweissich")).toBeNull();
  });
});

describe("cycleStatus (Badge-Klick-Reihenfolge, ADR-0006 F5)", () => {
  it("zykliert durch alle vier Status und wrappt", () => {
    expect(cycleStatus("geplant")).toBe("in-vorbereitung");
    expect(cycleStatus("in-vorbereitung")).toBe("fertig");
    expect(cycleStatus("fertig")).toBe("verschoben");
    expect(cycleStatus("verschoben")).toBe("geplant"); // Wrap
  });

  it("jeder Status ist als Override erreichbar (inkl. rückwärts via Wrap)", () => {
    expect(EXAM_STATUSES).toHaveLength(4);
  });
});

describe("toStatusExam (legacy Exam-Adapter)", () => {
  it("projiziert ein template.Exam in das StatusExam-Shape", () => {
    const legacy = {
      id: "ex1",
      title: "Klausur Latein",
      type: ExamType.Klausur,
      date: new Date("2026-10-07T08:00:00"),
      subject: "Latein",
      status: LegacyExamStatus.InPrep,
    };
    const e = toStatusExam(legacy);
    expect(e.id).toBe("ex1");
    expect(e.type).toBe(ExamType.Klausur);
    expect(e.date).toBe(legacy.date);
    expect(parseImportedStatus(e.status)).toBe("in-vorbereitung");
    expect(computeStatus(e, NOW)).toBe("in-vorbereitung");
  });
});
