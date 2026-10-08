import { describe, it, expect } from "vitest";
import {
  coursesFromEntries,
  scopedQueueCourses,
  unionTodayTomorrow,
  tomorrowIso,
  todayIso,
} from "../../src/review-queue/timetable-feed";
import type { JsonSubstitutionEntry } from "../../src/api/timetable-json";

function entry(
  courseName: string | undefined,
  subjectName: string | null,
  extra: Partial<JsonSubstitutionEntry> = {}
): JsonSubstitutionEntry {
  return {
    id: 1,
    courseSubject: {
      teachers: [],
      subject:
        subjectName === null
          ? (null as unknown as JsonSubstitutionEntry["courseSubject"]["subject"])
          : { name: subjectName, acronym: "X", hexColor: "#000000" },
      course: { name: courseName ?? undefined },
    },
    weekday: 0,
    timeTableSlot: 1,
    room: null,
    ...extra,
  } as unknown as JsonSubstitutionEntry;
}

describe("coursesFromEntries (Issue #12 Konzept-NEU)", () => {
  it("extrahiert Kursnamen, dedupliziert in Server-Reihenfolge", () => {
    const entries = [
      entry("O Physik 12eN Sü", "Physik"),
      entry("O Englisch 12gN Ha", "Englisch"),
      entry("O Physik 12eN Sü", "Physik"),
    ];
    expect(coursesFromEntries(entries)).toEqual([
      "O Physik 12eN Sü",
      "O Englisch 12gN Ha",
    ]);
  });

  it("Vertretungs-Zeile mit subject=null: Kurs aus originalTimeTableEntry", () => {
    const sub = {
      id: 2,
      weekday: 2,
      timeTableSlot: 3,
      courseSubject: { teachers: [], subject: null, course: null } as unknown,
      room: null,
      substitutionType: "class-absence",
      originalTimeTableEntry: {
        id: 9,
        weekday: 2,
        timeTableSlot: 3,
        courseSubject: {
          teachers: [],
          subject: { name: "Latein", acronym: "La", hexColor: "#0f0" },
          course: { name: "O Latein 12gN Sz" },
        },
        room: null,
      },
    } as unknown as JsonSubstitutionEntry;
    expect(coursesFromEntries([sub])).toEqual(["O Latein 12gN Sz"]);
  });

  it("leere/fehlende Kursnamen fliegen raus; leerer Input → []", () => {
    expect(coursesFromEntries([])).toEqual([]);
    expect(coursesFromEntries([entry(undefined, "Physik")])).toEqual([]);
    expect(coursesFromEntries([entry("", "Physik")])).toEqual([]);
  });
});

describe("unionTodayTomorrow", () => {
  it("Union ohne Duplikate, heute zuerst", () => {
    expect(
      unionTodayTomorrow(["A", "B"], ["B", "C"])
    ).toEqual(["A", "B", "C"]);
  });
  it("leerer heute-Tag + morgen bleibt best-effort", () => {
    expect(unionTodayTomorrow([], ["B"])).toEqual(["B"]);
    expect(unionTodayTomorrow(["A"])).toEqual(["A"]);
  });
  it("leere Strings fliegen raus", () => {
    expect(unionTodayTomorrow(["", "A"], [""])).toEqual(["A"]);
  });
});

describe("ISO-Datum-Helfer", () => {
  it("tomorrowIso rollt über Monats-/Jahresgrenzen (lokal)", () => {
    expect(tomorrowIso(new Date(2026, 9, 8))).toBe("2026-10-09");
    expect(tomorrowIso(new Date(2026, 11, 31))).toBe("2027-01-01");
  });
  it("todayIso ohne Zeitdrift", () => {
    expect(todayIso(new Date(2026, 9, 8))).toBe("2026-10-08");
  });
});

describe("scopedQueueCourses (Issue #19 P3)", () => {
  const plan = (entries: Parameters<typeof coursesFromEntries>[0], vacation = false) => ({
    entries,
    vacation,
  });

  it("beide Tage mit Kursen → Union gescoped (nicht leer)", () => {
    const e = (name: string) => ({ courseSubject: { course: { name } } });
    const d = scopedQueueCourses(plan([e("Physik")]), plan([e("Chemie")]));
    expect(d.scoped).toEqual(["Physik", "Chemie"]);
    expect(d.empty).toBe(false);
  });

  it("leerer Plan (Ferien/ganz entfallen) → bewusst LEER ([]), KEIN fetch-all", () => {
    const d = scopedQueueCourses(plan([]), plan([]));
    expect(d.scoped).toEqual([]);
    expect(d.empty).toBe(true);
  });

  it("vacation-Tag mit geleerten Entries → leer (Ferien ≠ alle Fächer)", () => {
    const d = scopedQueueCourses(plan([], true), plan([]));
    expect(d.scoped).toEqual([]);
    expect(d.empty).toBe(true);
  });

  it("ein Tag geladen, der andere null (technisch) → Scope aus dem geladenen Tag", () => {
    const e = (name: string) => ({ courseSubject: { course: { name } } });
    const d = scopedQueueCourses(plan([e("Physik")]), null);
    expect(d.scoped).toEqual(["Physik"]);
    expect(d.empty).toBe(false);
  });

  it("BEIDE Tage null (technischer Fetch-Fehler) → best-effort ohne Scope (undefined)", () => {
    const d = scopedQueueCourses(null, null);
    expect(d.scoped).toBeUndefined();
    expect(d.empty).toBe(false);
  });

  it("geladener Tag mit Entfall-Entries ohne Fach-Anker → leer (nicht fetch-all)", () => {
    const d = scopedQueueCourses(plan([{ substitutionType: "class-absence" }]), null);
    expect(d.scoped).toEqual([]);
    expect(d.empty).toBe(true);
  });
});
