/**
 * Unit-Tests für den "Aktuell"-Compositor (Runde 6, User-Kritik):
 * ungelesene Mails, zukünftige Arbeiten, offene Aufgaben, HW-Fenster.
 * Pure Functions — kein DOM/Obsidian (jsdom nicht nötig).
 */
import { describe, it, expect } from "vitest";
import {
  composeAktuellItems,
  filterUnreadMails,
  filterUpcomingExams,
  dueDateToDate,
  homeworkDueWindowEnd,
  type NotificationFilterOptions,
} from "../../src/views/notifications-filter";
import type { Mail } from "../../src/api/mails";
import type { SidebarExam } from "../../src/views/sidebar-render";
import type { ExerciseCandidate } from "../../src/review-queue/exercise-feed";

/** Festernow: berlin Sommerzeit, 2026-09-28 10:00 lokal (+02:00). */
const NOW = new Date("2026-09-28T10:00:00+02:00");

const opts: NotificationFilterOptions = { now: NOW };

function mail(
  id: number,
  flags: string[],
  unread?: boolean
): Mail {
  return { id, subject: `S${id}`, from: "t", date: "", snippet: "", flags, unread };
}

function exam(title: string, date?: Date): SidebarExam {
  return { title, daysLeft: 3, ...(date ? { date } : {}) };
}

function ex(
  id: string,
  dueDate?: string,
  name = `Aufgabe ${id}`
): ExerciseCandidate {
  return { id, name, status: "open", ...(dueDate ? { dueDate } : {}) };
}

describe("filterUnreadMails (Keine gelesenen in 'Aktuell')", () => {
  it("behält Mail ohne \\Seen-Flag, verwirft gelesene", () => {
    const input = [mail(1, []), mail(2, ["\\Seen"]), mail(3, ["\\Seen", "\\Flagged"])];
    const out = filterUnreadMails(input);
    expect(out.map((m) => m.id)).toEqual([1]);
  });

  it("unread-Flag=true gewinnt auch bei widersprüchlichen Flags", () => {
    const input = [mail(1, ["\\Seen"], true), mail(2, [], false)];
    const out = filterUnreadMails(input);
    expect(out.map((m) => m.id)).toEqual([1]);
  });

  it("leere Liste → leere Liste", () => {
    expect(filterUnreadMails([])).toEqual([]);
  });
});

describe("filterUpcomingExams (nur ZUKÜNFTIGE Arbeiten)", () => {
  it("verwirft Arbeiten ohne Datum oder mit vorbei-Termin", () => {
    const input = [
      exam("OhneDatum"),
      exam("Vorbei", new Date("2026-09-27T09:00:00+02:00")),
      exam("Laufend", new Date("2026-09-28T10:30:00+02:00")), // +30min ≤ 1h Puffer
      exam("Morgen", new Date("2026-09-29T10:00:00+02:00")),
    ];
    const out = filterUpcomingExams(input, NOW);
    expect(out.map((e) => e.title)).toEqual(["Morgen"]);
  });

  it("Akzeptiert Arbeiten in der Zukunft (>1h Puffer)", () => {
    const input = [exam("Heute spät", new Date("2026-09-28T18:00:00+02:00"))];
    expect(filterUpcomingExams(input, NOW).length).toBe(1);
  });
});

describe("dueDateToDate (IServ-Formate)", () => {
  it("deutsches Format mit Uhrzeit", () => {
    const d = dueDateToDate("10.09.2026 14:00");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(10);
    expect(d!.getHours()).toBe(14);
  });

  it("deutsches Format ohne Uhrzeit → 23:59 (ganzer Tag fällig)", () => {
    const d = dueDateToDate("29.09.2026");
    expect(d!.getHours()).toBe(23);
    expect(d!.getMinutes()).toBe(59);
  });

  it("toleriert 'Uhr'-Suffix", () => {
    expect(dueDateToDate("29.09.2026 14:00 Uhr")).not.toBeNull();
  });

  it("ISO-Format (Datum)", () => {
    const d = dueDateToDate("2026-09-29");
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(29);
  });

  it("ISO-Format mit Zeit und ISO 'T'-Form", () => {
    expect(dueDateToDate("2026-09-29 08:30")!.getHours()).toBe(8);
    expect(dueDateToDate("2026-09-29T08:30")!.getHours()).toBe(8);
  });

  it("Müll → null", () => {
    expect(dueDateToDate("")).toBeNull();
    expect(dueDateToDate("12gN")).toBeNull();
    expect(dueDateToDate(undefined as unknown as string)).toBeNull();
  });
});

describe("homeworkDueWindowEnd (Offset-Fenster)", () => {
  it("Default 1 Tag: now + 24h", () => {
    const end = homeworkDueWindowEnd(NOW);
    expect(end.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("offset 2 → now + 48h", () => {
    const end = homeworkDueWindowEnd(NOW, 2);
    expect(end.getTime() - NOW.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it("offset 0 → heute fällig zählt (Fenster nur abwärts bis now, aber wir geben now+0 zurück)", () => {
    // 0 Tage = Fenster endet "jetzt"; nur fällig ≤ jetzt — wichtiger Fall:
    // compose darf solche Aufgaben als HW zeigen (Fenster [now, now]).
    const end = homeworkDueWindowEnd(NOW, 0);
    expect(end.getTime()).toBe(NOW.getTime());
  });

  it("Hostile Input (NaN/undefined) → Default 1", () => {
    expect(homeworkDueWindowEnd(NOW, NaN).getTime() - NOW.getTime()).toBe(
      24 * 60 * 60 * 1000
    );
    expect(homeworkDueWindowEnd(NOW, -5).getTime() - NOW.getTime()).toBe(0);
  });
});

describe("composeAktuellItems (Gesamt-Compositor)", () => {
  it("radikal: gelesene Mails fliegen, ungelesene bleiben", () => {
    const v = composeAktuellItems(
      { mails: [mail(1, []), mail(2, ["\\Seen"])] },
      opts
    );
    expect(v.unreadMails.map((m) => m.id)).toEqual([1]);
    expect(v.upcomingExams).toEqual([]);
  });

  it("HW im Offset-Fenster (morgen 23:59) → hwExercises", () => {
    const v = composeAktuellItems(
      { exercises: [ex("1", "29.09.2026 08:00")] },
      opts
    );
    expect(v.hwExercises.length).toBe(1);
    expect(v.otherOpenExercises).toEqual([]);
  });

  it("HW zu weit weg (übermorgen) → otherOpenExercises", () => {
    const v = composeAktuellItems(
      { exercises: [ex("2", "01.10.2026")] },
      opts
    );
    expect(v.hwExercises).toEqual([]);
    expect(v.otherOpenExercises.length).toBe(1);
  });

  it("offene Aufgabe ohne parsebares dueDate → otherOpenExercises (nicht HW)", () => {
    const v = composeAktuellItems({ exercises: [ex("3")] }, opts);
    expect(v.hwExercises).toEqual([]);
    expect(v.otherOpenExercises.length).toBe(1);
  });

  it("offset-Fenster steuerbar: offset 4 nimmt den 01.10 (End-of-Day) ins Fenster", () => {
    const v = composeAktuellItems(
      { exercises: [ex("4", "01.10.2026")] },
      { ...opts, homeworkDueOffsetDays: 4 }
    );
    expect(v.hwExercises.length).toBe(1);
  });

  it("Vergangene Fristen sind KEINE Hausaufgabe mehr", () => {
    const v = composeAktuellItems(
      { exercises: [ex("5", "27.09.2026 08:00")] },
      opts
    );
    expect(v.hwExercises).toEqual([]);
  });

  it("Prüfungen filtern nach Termin; leere Eingaben sind safe", () => {
    const v = composeAktuellItems(
      {
        exams: [
          exam("Alt", new Date("2026-09-01T09:00:00+02:00")),
          exam("Neu", new Date("2026-10-15T09:00:00+02:00")),
        ],
        mails: [],
        exercises: [],
      },
      opts
    );
    expect(v.upcomingExams.map((e) => e.title)).toEqual(["Neu"]);
  });

  it("kompletter Empty-State: alles leer → alle Vier leer", () => {
    const v = composeAktuellItems({}, opts);
    expect(v.unreadMails).toEqual([]);
    expect(v.upcomingExams).toEqual([]);
    expect(v.hwExercises).toEqual([]);
    expect(v.otherOpenExercises).toEqual([]);
  });
});
