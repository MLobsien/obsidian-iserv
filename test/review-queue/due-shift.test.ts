import { describe, expect, it } from "vitest";
import {
  computeDueShift,
  isAbsent,
  nextActualLesson,
  type ShiftContext,
} from "../../src/review-queue/due-shift";
import type {
  Substitution,
  TimetableEntry,
} from "../../src/api/timetable";

function subst(
  iso: string,
  hour: number | undefined,
  course: string | undefined,
  type = "class-absence"
): Substitution {
  return {
    id: hour ?? 0,
    createdAt: iso,
    channel: { name: course ?? "", type: "" },
    channels: [],
    date: { date: `${iso} 00:00:00.000000`, timezone: "Europe/Berlin" },
    hour,
    subject: type === "class-absence" ? "" : "Vertretung",
    substitutionType: type,
    displayMessageForStudents: "",
    courseName: course,
  } as unknown as Substitution;
}

function entry(
  subject: string,
  course: string,
  weekday: number,
  slot: number
): TimetableEntry {
  return {
    id: weekday * 10 + slot,
    courseSubject: {
      subject: { name: subject, acronym: subject.slice(0, 2), hexColor: "#000" },
      course: { name: course },
      teachers: [],
    },
    weekday,
    timeTableSlot: { id: slot, number: slot, startTime: "", endTime: "", type: "lesson", name: "" },
    room: null,
  } as unknown as TimetableEntry;
}

function ctx(partial: Partial<ShiftContext>): ShiftContext {
  return {
    entries: [
      entry("Mathematik", "M-Vb A", 0, 1), // Montag, 1. Stunde
      entry("Mathematik", "M-Vb A", 2, 3), // Mittwoch, 3. Stunde
    ],
    substitutions: [subst("2026-09-28", 1, "M-Vb A")], // Mo 1. Stunde entfällt
    subject: "Mathematik",
    course: "M-Vb A",
    currentDue: "2026-09-28",
    now: new Date("2026-09-27T12:00:00"),
    ...partial,
  };
}

describe("isAbsent", () => {
  it("erkennt class-absence am Tag+Slot+Kurs", () => {
    expect(
      isAbsent([subst("2026-09-28", 1, "M-Vb A")], "2026-09-28", 1, "M-Vb A")
    ).toBe(true);
  });

  it("ignoriert Vertretungen ohne Entfall", () => {
    expect(
      isAbsent(
        [subst("2026-09-28", 1, "M-Vb A", "substitution")],
        "2026-09-28",
        1,
        "M-Vb A"
      )
    ).toBe(false);
  });

  it("ignoriert andere Tage", () => {
    expect(
      isAbsent([subst("2026-09-29", 1, "M-Vb A")], "2026-09-28", 1, "M-Vb A")
    ).toBe(false);
  });
});

describe("nextActualLesson", () => {
  it("findet die nächste tatsächliche Stunde des Fachs nach dem Entfall", () => {
    // Mo entfällt, Mi steht laut Stundenplan und ist nicht abgesagt → 2026-09-30
    const iso = nextActualLesson(
      ctx({ currentDue: undefined, substitutions: [subst("2026-09-28", 1, "M-Vb A")] }),
      "2026-09-28"
    );
    expect(iso).toBe("2026-09-30");
  });

  it("überspringt weitere Entfälle desselben Fachs", () => {
    const iso = nextActualLesson(
      ctx({
        substitutions: [
          subst("2026-09-28", 1, "M-Vb A"),
          subst("2026-09-30", 3, "M-Vb A"),
        ],
      }),
      "2026-09-28"
    );
    // Mi entfällt ebenfalls → nächste Woche Montag
    expect(iso).toBe("2026-10-05");
  });

  it("gibt null zurück, wenn der Stundenplan das Fach gar nicht hat", () => {
    const iso = nextActualLesson(ctx({ entries: [] }), "2026-09-28");
    expect(iso).toBe(null);
  });
});

describe("computeDueShift", () => {
  it("verschiebt das Bis-Datum auf die nächste tatsächliche Stunde", () => {
    const result = computeDueShift(ctx({}));
    expect(result.newDue).toBe("2026-09-30");
    expect(result.reason).toContain("Entfall");
  });

  it("macht nichts, wenn das Fach am Due-Tag nicht entfällt", () => {
    const result = computeDueShift(
      ctx({ substitutions: [subst("2026-09-29", 2, "M-Vb A")] })
    );
    expect(result.newDue).toBe(null);
  });

  it("macht nichts ohne Bis-Datum", () => {
    const result = computeDueShift(ctx({ currentDue: undefined }));
    expect(result.newDue).toBe(null);
  });

  it("verschiebt nicht rückwärts: neue Stunde liegt nach dem Entfallstag", () => {
    const result = computeDueShift(ctx({}));
    expect(result.newDue! > "2026-09-28").toBe(true);
  });
});
