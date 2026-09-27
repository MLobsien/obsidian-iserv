/**
 * HA-Due-Shift (T4, ADR-0002): Bei Ausfall einer Stunde verschiebt sich die
 * HA-Fälligkeit (`Bis/<dd>`-Frontmatter) auf die nächste *tatsächliche* Stunde
 * des Fachs — deterministisch aus verifizierten Vertretungsdaten abgeleitet,
 * lokal auto (kein Remote-Write, dort nur ein-Klick-Vorschlag).
 *
 * Reine Funktionen (obsidian-frei, Seam-Split à la ADR-0007): das Frontmatter-
 * Write selbst passiert in main.ts (Plugin-Seite), hier nur die Berechnung.
 */
import type { Substitution, TimetableEntry } from "../api/timetable";

export interface ShiftContext {
  /** Statischer Stundenplan (gültig ab ADR-0007-Stichtag 07.09.2026). */
  entries: TimetableEntry[];
  /** Verifizierte Vertretungsdaten (substitutions()). */
  substitutions: Substitution[];
  /** Fachname der HA-Notiz (Vault-Schreibweise). */
  subject: string;
  /** IServ-Kursname der HA-Notiz (Substitution-Matching). */
  course?: string;
  /** Aktuelles Bis-Datum der Notiz (YYYY-MM-DD) oder undefined. */
  currentDue?: string;
  /** Jetzt-Zeit (für Testbarkeit). */
  now: Date;
}

export interface DueShiftResult {
  /** Neues Bis-Datum (YYYY-MM-DD) oder null, wenn kein Shift. */
  newDue: string | null;
  /** Begründung fürs Log/Notice. */
  reason: string;
}

/** ISO-Datum-Teil einer Substitution (date.date nested). */
function substIso(s: Substitution): string {
  const d = typeof s.date === "string" ? s.date : (s.date?.date ?? "");
  return d.slice(0, 10);
}

/**
 * Entfall-Erkennung: substitutionType "class-absence" am Tag+Slot+Kurs
 * (Vertretungen ohne Entfall verschieben die Fälligkeit nicht).
 */
export function isAbsent(
  substs: Substitution[],
  iso: string,
  hour: number | undefined,
  course: string | undefined
): boolean {
  return substs.some(
    (s) =>
      s.substitutionType === "class-absence" &&
      substIso(s) === iso &&
      (hour === undefined || s.hour === undefined || s.hour === hour) &&
      (course === undefined ||
        !s.courseName ||
        s.courseName === course)
  );
}

/** Fachname eines Stundenplan-Entry (Live-Shape: subject.name). */
function entrySubject(e: TimetableEntry): string {
  return e.courseSubject?.subject?.name ?? "";
}

/** Kursname eines Stundenplan-Entry. */
function entryCourse(e: TimetableEntry): string {
  return e.courseSubject?.course?.name ?? "";
}

/** API-Weekday (0=Mo..4=Fr) eines ISO-Datums. */
function apiWeekday(iso: string): number {
  return (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
}

/** ISO-Datum + n Tage. */
function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Nächste tatsächliche Stunde des Fachs streng nach dem Entfallstag
 * (ADR-0002: "nächste tatsächliche Stunde", nicht derselbe Tag-Restslot):
 * iteriert Kalendertage aufwärts, prüft Stundenplan-Match (subject+course)
 * und dass der Termin nicht ebenfalls entfällt.
 */
export function nextActualLesson(
  ctx: ShiftContext,
  absentIso: string
): string | null {
  const wanted = ctx.entries.filter(
    (e) =>
      entrySubject(e) === ctx.subject &&
      (ctx.course === undefined || entryCourse(e) === ctx.course)
  );
  if (wanted.length === 0) return null;

  for (let i = 1; i <= 28; i++) {
    const iso = plusDays(absentIso, i);
    const wd = apiWeekday(iso);
    if (wd > 4) continue; // Wochenende (Sa/So) entfällt
    const anyLesson = wanted.some((e) => e.weekday === wd);
    if (!anyLesson) continue;
    const stillAbsent = isAbsent(
      ctx.substitutions,
      iso,
      undefined,
      ctx.course
    );
    if (stillAbsent) continue;
    return iso;
  }
  return null;
}

/**
 * Due-Shift-Berechnung: Shift nur, wenn (a) Bis-Datum gesetzt, (b) am
 * Bis-Tag eine Stunde des Fachs entfällt. Sonst null (kein Write).
 */
export function computeDueShift(ctx: ShiftContext): DueShiftResult {
  if (!ctx.currentDue) {
    return { newDue: null, reason: "kein Bis-Datum gesetzt" };
  }
  // Entfall am Due-Tag im Fach (irgendeine Stunde des Fachs).
  const absentToday = ctx.substitutions.some(
    (s) =>
      s.substitutionType === "class-absence" &&
      substIso(s) === ctx.currentDue &&
      (ctx.course === undefined ||
        !s.courseName ||
        s.courseName === ctx.course)
  );
  if (!absentToday) {
    return { newDue: null, reason: "kein Entfall am Bis-Tag" };
  }
  const next = nextActualLesson(ctx, ctx.currentDue);
  if (!next) {
    return { newDue: null, reason: "keine spätere Stunde im Stundenplan" };
  }
  return {
    newDue: next,
    reason: `Entfall am ${ctx.currentDue} → nächste tatsächliche Stunde ${next}`,
  };
}
