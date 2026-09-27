import { describe, it, expect, beforeEach } from "vitest";
import {
  GradeStore,
  multiplierFor,
  isValidPoints,
  normalizeGradeToPoints,
} from "../../src/exams/grade-store";
import type { GradeIndexData } from "../../src/exams/grade-store";

function createMockPlugin(data: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...data };
  return {
    loadData: async () => ({ ...store }),
    saveData: async (d: Record<string, unknown>) => {
      Object.assign(store, d);
    },
    dump: () => store,
  };
}

describe("GradeStore — addGrade", () => {
  let plugin: ReturnType<typeof createMockPlugin>;
  let store: GradeStore;

  beforeEach(() => {
    plugin = createMockPlugin();
    store = new GradeStore(plugin);
  });

  it("fügt einen Punkte-Eintrag (0–15) hinzu", () => {
    store.addGrade("Mathe", { examTitle: "K01 Algebra", date: "2026-10-07", points: 13 });
    const grades = store.getGrades("Mathe");
    expect(grades).toHaveLength(1);
    expect(grades[0]).toEqual({
      examTitle: "K01 Algebra",
      date: "2026-10-07",
      points: 13,
      scale: "points",
    });
  });

  it("Default-Scale ist 'points' (Punktesystem 0–15, ADR-0006)", () => {
    store.addGrade("Latein", { examTitle: "T1", date: "2026-09-20", points: 0 });
    expect(store.getGrades("Latein")[0].scale).toBe("points");
  });

  it("akzeptiert explizite 'noten'-Einträge (ganzzahlig 1–6)", () => {
    store.addGrade("Englisch", {
      examTitle: "K1",
      date: "2026-09-20",
      points: 2,
      scale: "grades",
    });
    expect(store.getGrades("Englisch")[0].points).toBe(2);
    expect(store.getGrades("Englisch")[0].scale).toBe("grades");
  });

  it("lehnt Punkte außerhalb der Scale ab (Punkte > 15 / Note 0)", () => {
    expect(() =>
      store.addGrade("Mathe", { examTitle: "X", date: "", points: 16 })
    ).toThrow(RangeError);
    expect(() =>
      store.addGrade("Mathe", { examTitle: "X", date: "", points: -1 })
    ).toThrow(RangeError);
    expect(() =>
      store.addGrade("Mathe", {
        examTitle: "X",
        date: "",
        points: 0,
        scale: "grades",
      })
    ).toThrow(RangeError);
    expect(() =>
      store.addGrade("Mathe", {
        examTitle: "X",
        date: "",
        points: 7,
        scale: "grades",
      })
    ).toThrow(RangeError);
    expect(store.getSubjects()).toHaveLength(0);
  });

  it("erlaubt Grenzwerte 0 und 15 (Punkte) sowie 1 und 6 (Noten)", () => {
    expect(() =>
      store.addGrade("A", { examTitle: "x", date: "", points: 0 })
    ).not.toThrow();
    expect(() =>
      store.addGrade("A", { examTitle: "x", date: "", points: 15 })
    ).not.toThrow();
    expect(() =>
      store.addGrade("B", { examTitle: "y", date: "", points: 1, scale: "grades" })
    ).not.toThrow();
    expect(() =>
      store.addGrade("B", { examTitle: "y", date: "", points: 6, scale: "grades" })
    ).not.toThrow();
  });
});

describe("GradeStore — getSubjectAverage", () => {
  let plugin: ReturnType<typeof createMockPlugin>;
  let store: GradeStore;

  beforeEach(() => {
    plugin = createMockPlugin();
    store = new GradeStore(plugin);
  });

  it("Durchschnitt auf Punkte-Scale aus zwei Punkte-Einträgen", () => {
    store.addGrade("Mathe", { examTitle: "K1", date: "d", points: 15 });
    store.addGrade("Mathe", { examTitle: "K2", date: "d", points: 11 });
    // Math.ceil(14 × multiplier(11)) ⇒ Preston 12 — hier nur Durchschnitt:
    expect(store.getSubjectAverage("Mathe")).toBe(13);
  });

  it("normalisiert 'noten'-Einträge auf die 0–15-Punkte-Scale (Note 1 ≙ 15 P)", () => {
    store.addGrade("Latein", { examTitle: "K1", date: "d", points: 1, scale: "grades" });
    store.addGrade("Latein", { examTitle: "K2", date: "d", points: 6, scale: "grades" });
    // Note 1 → 15 P, Note 6 → 0 P → Durchschnitt 7.5
    expect(store.getSubjectAverage("Latein")).toBeCloseTo(7.5, 5);
  });

  it("mischt Punkte- und Noten-Einträge auf der Punkte-Scale", () => {
    store.addGrade("Physik", { examTitle: "K1", date: "d", points: 9 });
    store.addGrade("Physik", { examTitle: "K2", date: "d", points: 3, scale: "grades" });
    // Note 3 → 9 P → (9 + 9)/2 = 9
    expect(store.getSubjectAverage("Physik")).toBeCloseTo(9, 5);
  });

  it("null für unbekanntes/leeres Fach", () => {
    expect(store.getSubjectAverage("Philosophie")).toBeNull();
  });

  it("multipliziert aus den Einträgen: multiplierFor(getSubjectAverage()) ≙ T9-Endpunkte", () => {
    store.addGrade("Mathe", { examTitle: "K1", date: "d", points: 15 });
    expect(multiplierFor(store.getSubjectAverage("Mathe")!, "points")).toBeCloseTo(0.7, 2);
    store.addGrade("Mathe", { examTitle: "K2", date: "d", points: 0 });
    expect(multiplierFor(store.getSubjectAverage("Mathe")!, "points")).toBeCloseTo(1.85, 5);
  });
});

describe("GradeStore — Persistenz & Fach-Liste", () => {
  let plugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    plugin = createMockPlugin();
  });

  it("save → load rundet_trip: Fachindex überlebt Plugin-Neustart", async () => {
    const store = new GradeStore(plugin);
    store.addGrade("Mathe", { examTitle: "K1", date: "2026-10-07", points: 12 });
    store.addGrade("Kunst", { examTitle: "P1", date: "2026-10-10", points: 2, scale: "grades" });
    await store.save();

    const store2 = new GradeStore(plugin);
    await store2.load();
    expect(store2.getGrades("Mathe")).toHaveLength(1);
    expect(store2.getGrades("Kunst")[0].scale).toBe("grades");
    expect(Object.keys(store2.getAllGrades()).sort()).toEqual(["Kunst", "Mathe"]);
  });

  it("load mit leerer/Kaputter data.json → leerer Fachindex (kein Wurf)", async () => {
    plugin.dump()["grade-index"] = "kein-objekt";
    const store = new GradeStore(plugin);
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.getSubjects()).toHaveLength(0);
  });

  it("getSubjects listet Fächer mit Entry-Count, alphabetisch (de)", async () => {
    const store = new GradeStore(plugin);
    store.addGrade("Biology", { examTitle: "K1", date: "d", points: 15 });
    store.addGrade("Ästhetik", { examTitle: "K2", date: "d", points: 15 });
    store.addGrade("Biology", { examTitle: "K3", date: "d", points: 15 });
    expect(store.getSubjects()).toEqual([
      { subject: "Ästhetik", count: 1 },
      { subject: "Biology", count: 2 },
    ]);
  });

  it("getAllGrades liefert Kopie (Mutationen leaken nicht in den Store)", async () => {
    const store = new GradeStore(plugin);
    store.addGrade("Mathe", { examTitle: "K1", date: "d", points: 15 });
    const snapshot: GradeIndexData = store.getAllGrades();
    snapshot["Mathe"]![0].points = 0;
    snapshot["Mathe"]!.push({
      examTitle: "Fake",
      date: "",
      points: 1,
      scale: "points",
    });
    expect(store.getGrades("Mathe")).toHaveLength(1);
    expect(store.getGrades("Mathe")[0].points).toBe(15);
  });

  it("getGrades liefert Kopie", async () => {
    const store = new GradeStore(plugin);
    store.addGrade("Mathe", { examTitle: "K1", date: "d", points: 15 });
    const copy = store.getGrades("Mathe");
    copy.push({ examTitle: "Fake", date: "", points: 1, scale: "points" });
    expect(store.getGrades("Mathe")).toHaveLength(1);
  });
});

describe("isValidPoints", () => {
  it("validiert beide Scales", () => {
    expect(isValidPoints(7.5, "points")).toBe(true);
    expect(isValidPoints(15.5, "points")).toBe(false);
    expect(isValidPoints(3, "grades")).toBe(true);
    expect(isValidPoints(3.5, "grades")).toBe(false);
    expect(isValidPoints(NaN, "points")).toBe(false);
  });
});

describe("normalizeGradeToPoints / multiplierFor", () => {
  it("Note 1→15 P, Note 6→0 P, Note 3→9 P (linear)", () => {
    expect(normalizeGradeToPoints(1)).toBe(15);
    expect(normalizeGradeToPoints(6)).toBe(0);
    expect(normalizeGradeToPoints(3)).toBe(9);
  });

  it("multiplierFor: 15 P → 0.7, 0 P → 3.0, 7.5 P ≙ 1.85 (linear, ADR-0006)", () => {
    expect(multiplierFor(15, "points")).toBeCloseTo(0.7, 2);
    expect(multiplierFor(0, "points")).toBeCloseTo(3.0, 2);
    expect(multiplierFor(7.5, "points")).toBeCloseTo(1.85, 5);
  });

  it("multiplierFor: Note 1→0.7, Note 6→3.0, Note 3.5 ≙ 1.85", () => {
    expect(multiplierFor(1, "grades")).toBeCloseTo(0.7, 2);
    expect(multiplierFor(6, "grades")).toBeCloseTo(3.0, 2);
    expect(multiplierFor(3.5, "grades")).toBeCloseTo(1.85, 5);
  });

  it("multiplierFor klemmt außerhalb der Scale", () => {
    expect(multiplierFor(20, "points")).toBeCloseTo(0.7, 2);
    expect(multiplierFor(-3, "points")).toBeCloseTo(3.0, 2);
    expect(multiplierFor(99, "grades")).toBeCloseTo(3.0, 2);
  });
});
