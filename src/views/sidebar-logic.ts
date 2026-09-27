/**
 * Reine Sidebar-Logik (ADR-0008): Doppelstunden-Merge, Nächster-Schultag-Regel,
 * Vertretungs-Farbsemantic. Kein DOM, kein Obsidian-Import — Node-testbar.
 */
import type { Substitution } from "../api/timetable";

/** Slot-Nummer → Start/Endzeit (aus `timetable-slots/` bzw. den Entries). */
export type SlotClock = Record<number, { start: string; end: string }>;

/** Normalisierter Entry (aus TimetableEntry), für Merge + Dekor. */
export interface SidebarEntry {
  id: number;
  weekday: number;
  slot: number;
  subject: string;
  course: string;
  room: string | null;
}

/** Eine zusammengefasste Zeile der Sidebar (ein oder mehrere Slots). */
export interface MergedRow {
  key: string;
  weekday: number;
  slots: number[];
  subject: string;
  course: string;
  rooms: (string | null)[];
}

export type RowDecor =
  | { kind: "absence"; subst: Substitution }
  | { kind: "substituted"; subst: Substitution }
  | { kind: "normal" };

/**venience: String-Slot aus Entry (Objekt oder Zahl). */
export function slotNumber(slot: unknown): number {
  if (typeof slot === "number") return slot;
  if (slot && typeof slot === "object" && "number" in slot) {
    return (slot as { number: number }).number;
  }
  return 0;
}

/**
 * Doppelstunden-Merge (ADR-0008): aufeinanderfolgende Slots desselben Fachs
 * (subject + course, gleicher Tag) werden zu einer Zeile. Stabil nach Slot sortiert.
 */
export function mergeDoubleSlots(
  entries: SidebarEntry[],
  _clock?: SlotClock
): MergedRow[] {
  const sorted = [...entries].sort(
    (a, b) => a.weekday - b.weekday || a.slot - b.slot
  );
  const rows: MergedRow[] = [];
  for (const e of sorted) {
    const prev = rows[rows.length - 1];
    if (
      prev &&
      prev.weekday === e.weekday &&
      prev.subject === e.subject &&
      prev.course === e.course &&
      prev.slots[prev.slots.length - 1] === e.slot - 1
    ) {
      prev.slots.push(e.slot);
      prev.rooms.push(e.room);
      prev.key = `${e.weekday}:${prev.slots[0]}`;
    } else {
      rows.push({
        key: `${e.weekday}:${e.slot}`,
        weekday: e.weekday,
        slots: [e.slot],
        subject: e.subject,
        course: e.course,
        rooms: [e.room],
      });
    }
  }
  return rows;
}

/** „3.“ bzw. „3./4.“ */
export function slotLabel(slots: number[]): string {
  if (slots.length === 1) return `${slots[0]}.`;
  return `${slots[0]}./${slots[slots.length - 1]}.`;
}

/** Zeitfenster „09:55–11:30“ (Anfang erster bis Ende letzter Slot). */
export function timeLabel(slots: number[], clock: SlotClock): string {
  const first = clock[slots[0]];
  const last = clock[slots[slots.length - 1]];
  if (!first || !last) return "";
  return `${first.start}–${last.end}`;
}

/**
 * Nächster-Schultag-Regel: Vor dem Ende des letzten Unterrichtsslots des Tages
 * bleibt der aktuelle Tag; danach (Wochenende/Feiertage inkl.) der nächste Schultag.
 * Rückgabe: API-Weekday (0=Mo … 4=Fr, konform zu `timetable-entries[].weekday`).
 * `dayEntries` beschränkt das Tagesende auf die tatsächlich geplanten Slots
 * (kürzere Tage enden früher); ohne Einträge gilt das letzte Slot-Ende des Rasters.
 */
export function sidebarDay(
  now: Date,
  clock: SlotClock,
  dayEntries?: SidebarEntry[]
): number {
  const jsDay = now.getDay(); // 0=So, 1=Mo … 6=Sa
  const apiWd = (jsDay + 6) % 7; // 0=Mo … 5=Sa, 6=So
  if (apiWd >= 5) return 0; // Wochenende → Montag

  const relevant =
    dayEntries && dayEntries.length > 0
      ? dayEntries.filter((e) => e.weekday === apiWd)
      : [];
  const source =
    relevant.length > 0
      ? relevant.map((e) => e.slot)
      : Object.keys(clock).map(Number);
  const lastSlot = Math.max(...source);
  const end = clock[lastSlot]?.end ?? "23:59";
  const dayOver = timeOfDay(now) > parseHHMM(end);
  if (!dayOver) return apiWd;

  // Nach Schulschluss: nächster Schultag (über Samstag/Sonntag → Montag).
  return (apiWd + 1) % 7 === 5 || (apiWd + 1) % 7 === 6
    ? 0
    : (apiWd + 1) % 7;
}

function timeOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Dekor einer Zeile: Ausfall (rot), Vertretung (orange) oder normal.
 * Match: substitutions[].date.date == ISO-Datum + hour ∈ slots + courseName == course.
 */
export function entryDecor(
  entry: SidebarEntry,
  refIsoDate: string,
  substs: Substitution[],
  allEntries?: SidebarEntry[],
  clock?: SlotClock
): RowDecor {
  const slots =
    allEntries && clock
      ? (mergeDoubleSlots(
          allEntries.filter(
            (e) => e.weekday === entry.weekday && e.course === entry.course
          ),
          clock
        )
          .find((r) => r.subject === entry.subject && r.course === entry.course)
          ?.slots ?? [entry.slot])
      : [entry.slot];

  const hits = substs.filter((s) => {
    const sDate = typeof s.date === "string" ? s.date : s.date?.date ?? "";
    const iso = sDate.slice(0, 10);
    if (iso !== refIsoDate) return false;
    if (s.hour === undefined || !slots.includes(s.hour)) return false;
    if (s.courseName && s.courseName !== entry.course) return false;
    return true;
  });

  if (hits.length === 0) return { kind: "normal" };
  const absence = hits.find((s) => s.substitutionType === "class-absence");
  if (absence) return { kind: "absence", subst: absence };
  return { kind: "substituted", subst: hits[0] };
}

/** ISO-Referenzdatum, das die Sidebar für einen API-Weekday auflöst (nächster Schultag, nie So/Sa). */
export function isoForWeekday(from: Date, target: number): string {
  const d = new Date(from);
  const fromApi = (d.getDay() + 6) % 7; // 0=Mo … 6=So
  let delta = (target - fromApi + 7) % 7;
  // Ziel darf kein Wochenende sein (0=Mo..4=Fr): wenn delta auf So/Sa trifft, weiter zum nächsten Montag.
  const candidateApi = (fromApi + delta) % 7;
  if (candidateApi >= 5) {
    delta = delta + ((7 - candidateApi) % 7 || 7);
  }
  d.setDate(d.getDate() + delta);
  return toIsoDate(d);
}
