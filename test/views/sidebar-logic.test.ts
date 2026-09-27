import { describe, it, expect } from "vitest";
import {
  mergeDoubleSlots,
  sidebarDay,
  entryDecor,
  slotLabel,
  timeLabel,
  isoForWeekday,
  type MergedRow,
  type SidebarEntry,
  type SlotClock,
} from "../../src/views/sidebar-logic";
import type { Substitution } from "../../src/api/timetable";

const SLOT_CLOCK: SlotClock = {
  1: { start: "08:00", end: "08:45" },
  2: { start: "08:50", end: "09:35" },
  3: { start: "09:55", end: "10:40" },
  4: { start: "10:45", end: "11:30" },
  5: { start: "11:45", end: "12:30" },
  6: { start: "12:35", end: "13:20" },
  7: { start: "13:20", end: "14:05" },
  8: { start: "14:05", end: "14:50" },
  9: { start: "14:55", end: "15:40" },
  10: { start: "15:40", end: "16:25" },
};

function entry(
  weekday: number,
  slot: number,
  subject: string,
  course = subject,
  id = weekday * 100 + slot
): SidebarEntry {
  return {
    id,
    weekday,
    slot,
    subject,
    course,
    room: `R${slot}`,
  };
}

function subst(
  dateIso: string,
  hour: number,
  type: string,
  courseName: string
): Substitution {
  return {
    id: dateIso.length * 1000 + hour,
    createdAt: "0",
    channel: { name: courseName, type: "course" },
    channels: [],
    date: { date: `${dateIso} 00:00:00.000`, timezone: "Europe/Berlin" },
    hour,
    substitutionType: type,
    displayMessageForStudents: "",
    courseName,
  };
}

describe("mergeDoubleSlots", () => {
  it("mergt aufeinanderfolgende Slots desselben Fachs (3./4. Beispiel)", () => {
    const entries = [
      entry(2, 3, "Latein"),
      entry(2, 4, "Latein"),
    ];
    const merged = mergeDoubleSlots(entries, SLOT_CLOCK);
    expect(merged).toHaveLength(1);
    expect(merged[0].slots).toEqual([3, 4]);
    expect(merged[0].subject).toBe("Latein");
  });

  it("mergt nicht über Fachgrenzen", () => {
    const entries = [entry(2, 3, "Latein"), entry(2, 4, "Physik")];
    expect(mergeDoubleSlots(entries, SLOT_CLOCK)).toHaveLength(2);
  });

  it("mergt nicht über Lücken (3+5)", () => {
    const entries = [entry(2, 3, "Latein"), entry(2, 5, "Latein")];
    expect(mergeDoubleSlots(entries, SLOT_CLOCK)).toHaveLength(2);
  });

  it("mergt Drittfach-Ketten (3 Slots)", () => {
    const entries = [
      entry(2, 7, "Sport"),
      entry(2, 8, "Sport"),
      entry(2, 9, "Sport"),
    ];
    const merged = mergeDoubleSlots(entries, SLOT_CLOCK);
    expect(merged).toHaveLength(1);
    expect(merged[0].slots).toEqual([7, 8, 9]);
  });

  it("sortiert nach Slot unabhängig von Eingabereihenfolge", () => {
    const entries = [entry(2, 4, "Latein"), entry(2, 3, "Latein")];
    const merged = mergeDoubleSlots(entries, SLOT_CLOCK);
    expect(merged[0].slots).toEqual([3, 4]);
  });
});

describe("slotLabel / timeLabel", () => {
  it("Einzelstunde: '3.'", () => {
    expect(slotLabel([3])).toBe("3.");
  });

  it("Doppelstunde: '3./4.'", () => {
    expect(slotLabel([3, 4])).toBe("3./4.");
  });

  it("Zeitfenster: Anfang erster bis Ende letzter Slot", () => {
    expect(timeLabel([3, 4], SLOT_CLOCK)).toBe("09:55–11:30");
    expect(timeLabel([1], SLOT_CLOCK)).toBe("08:00–08:45");
  });
});

describe("sidebarDay — Nächster-Schultag-Regel", () => {
  const refPo = new Date("2026-09-21T10:00:00+02:00"); // Montag 10:00
  const refFrInSlot9 = new Date("2026-09-25T15:30:00+02:00"); // Freitag in Slot 9 (14:55–15:40)
  const refFrNachEnde = new Date("2026-09-25T16:26:00+02:00"); // Freitag nach letzter Stunde
  const refFrLetzteStunde = new Date("2026-09-25T12:00:00+02:00"); // Freitag während Slot 5-6
  const refSa = new Date("2026-09-26T09:00:00+02:00"); // Samstag

  it("Freitag 15:30 (Slot 9 läuft noch) → noch Freitag", () => {
    expect(sidebarDay(refFrInSlot9, SLOT_CLOCK)).toBe(4);
  });

  it("Freitag nach letzter Stunde (16:26 > 16:25) → Montag (0)", () => {
    expect(sidebarDay(refFrNachEnde, SLOT_CLOCK)).toBe(0);
  });

  it("Freitag während Slot 5–6 → noch Freitag", () => {
    expect(sidebarDay(refFrLetzteStunde, SLOT_CLOCK)).toBe(4);
  });

  it("Samstag → Montag (0)", () => {
    expect(sidebarDay(refSa, SLOT_CLOCK)).toBe(0);
  });

  it("Montag Vormittag → Montag (0)", () => {
    expect(sidebarDay(refPo, SLOT_CLOCK)).toBe(0);
  });

  it("Schultag-Ende = letztes Slot-Ende am Tag, nicht eine fixe Uhrzeit", () => {
    // Dienstag 16:24 → Dienstag; 16:26 → Mittwoch
    expect(
      sidebarDay(new Date("2026-09-22T16:24:00+02:00"), SLOT_CLOCK)
    ).toBe(1);
    expect(
      sidebarDay(new Date("2026-09-22T16:26:00+02:00"), SLOT_CLOCK)
    ).toBe(2);
  });

  it("kürzerer Tag: endet der Plan 13:20, ist 15:30 bereits nach Schulschluss → Montag", () => {
    // Kein Eintrag nach Slot 6 → Tagesende 13:20.
    const fridayOnly = [entry(4, 1, "Physik"), entry(4, 6, "Sport")];
    expect(sidebarDay(refFrInSlot9, SLOT_CLOCK, fridayOnly)).toBe(0);
  });
});

describe("entryFarben — Vertretungs-Farbsemantic (rot=Ausfall, orange=Vertretung)", () => {
  it("class-absence am gleichen Tag+Slot+Kurs → Entfall (rot)", () => {
    const substs = [
      subst("2026-09-21", 3, "class-absence", "O Latein 12gN Sz"),
    ];
    const e = entry(0, 3, "Latein", "O Latein 12gN Sz");
    expect(entryDecor(e, "2026-09-21", substs)).toEqual({
      kind: "absence",
      subst: substs[0],
    });
  });

  it("substituted am gleichen Tag+Slot+Kurs → Vertretung (orange)", () => {
    const substs = [
      subst("2026-09-21", 3, "substituted", "O Latein 12gN Sz"),
    ];
    const e = entry(0, 3, "Latein", "O Latein 12gN Sz");
    expect(entryDecor(e, "2026-09-21", substs).kind).toBe("substituted");
  });

  it("andere Kurs = keine Markierung", () => {
    const substs = [
      subst("2026-09-21", 3, "class-absence", "O Latein 12gN Sz"),
    ];
    const e = entry(0, 3, "Physik", "O Physik 12gN");
    expect(entryDecor(e, "2026-09-21", substs).kind).toBe("normal");
  });

  it("Cross-Check: weekday+hour-Matching,(courseName wie course.name)", () => {
    // Der Merge behält die Kurs-Zuordnung; ein merged Doppel-Slot mit Entfall in Slot 4 → rot (die Zeile).
    const substs = [
      subst("2026-09-21", 4, "class-absence", "O Latein 12gN Sz"),
    ];
    const e = entry(0, 3, "Latein", "O Latein 12gN Sz", 999);
    const e2 = entry(0, 4, "Latein", "O Latein 12gN Sz", 998);
    const decor = entryDecor(e, "2026-09-21", substs, [e, e2], SLOT_CLOCK);
    // Slot 4 des gemergten Blocks fällt aus → Zeile rot (irgendein Treffer zählt).
    expect(decor.kind).toBe("absence");
  });
});

describe("isoForWeekday", () => {
  it("Samstag → nächster Montag (nicht Sonntag!)", () => {
    const sat = new Date("2026-09-26T09:00:00+02:00");
    expect(isoForWeekday(sat, 0)).toBe("2026-09-28");
  });

  it("Montag → gleich neuer Montag", () => {
    const mon = new Date("2026-09-21T09:00:00+02:00");
    expect(isoForWeekday(mon, 0)).toBe("2026-09-21");
  });

  it("Mittwoch → Freitag = +2", () => {
    const wed = new Date("2026-09-23T09:00:00+02:00");
    expect(isoForWeekday(wed, 4)).toBe("2026-09-25");
  });

  it("Freitag nach Schulschluss → übernächster Montag via sidebarDay+isoForWeekday", () => {
    const friEvening = new Date("2026-09-25T17:00:00+02:00");
    const wd = sidebarDay(friEvening, SLOT_CLOCK);
    expect(wd).toBe(0);
    expect(isoForWeekday(friEvening, wd)).toBe("2026-09-28");
  });
});
