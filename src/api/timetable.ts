/**
 * Timetable & Substitution API client for IServ DieschulApp.
 *
 * Uses the `/iserv/dieschulapp/api/1.0/` JSON endpoints.
 */

export interface TimetableTeacher {
  displayname: string;
  externalId: string;
  /** Live-Shape (Issue #8 R2, 29.09.2026): timetable-entries liefern auch die
   * strukturierten Felder — „Vorname Nachname" ohne Displayname-Heuristik.
   * users/me + students/ tragen dieselben Felder (live verifiziert). */
  forename?: string;
  surname?: string;
  id?: number;
}

export interface TimetableSubject {
  name: string;
  acronym: string;
  hexColor: string;
}

export interface TimetableCourse {
  id?: number;
  name?: string;
  [key: string]: unknown;
}

export interface TimetableCourseSubject {
  teachers: TimetableTeacher[];
  subject: TimetableSubject;
  course: TimetableCourse;
}

/** Slot aus `timetable-slots/` bzw. verschachtelt im Entry (Live-Verifiziert 2026-09-27). */
export interface TimetableSlot {
  id: number;
  number: number;
  startTime: string;
  endTime: string;
  type?: string;
  name?: string;
}

export interface TimetableEntry {
  id: number;
  courseSubject: TimetableCourseSubject;
  weekday: number;
  timeTableSlot: TimetableSlot | number;
  room: TimetableRoom | string | null;
}

export interface TimetableRoom {
  id: number;
  name: string;
}

export interface SubstitutionChannel {
  name: string;
  type: string;
}

export interface SubstitutionDate {
  date?: string;
  timezone?: string;
  [key: string]: unknown;
}

export interface SubstitutionTeacher {
  displayname?: string;
  [key: string]: unknown;
}

export interface Substitution {
  id: number;
  createdAt: string;
  channel: SubstitutionChannel;
  channels: SubstitutionChannel[];
  /** Verschachteltes Datum: `{date: "YYYY-MM-DD HH:mm:ss.ffffff", timezone: "Europe/Berlin"}`. */
  date: SubstitutionDate;
  /** Slotnummer der betroffenen Stunde. */
  hour?: number;
  /** Leerer String bei Entfall (Live: class-absence hat subject=""). */
  subject?: string;
  substitutionType: string;
  displayMessageForStudents: string;
  room?: TimetableRoom | null;
  insteadOfTeacher?: SubstitutionTeacher | null;
  hour_raw?: number;
  courseName?: string;
  courseExternalId?: string;
}

/** Minimal shape of an IServ client with a `request` method. */
export type { IServClient, parseResponseBodyArray } from "./shared-client";
import { parseResponseBodyArray, IServClient } from "./shared-client";

const API_BASE = "/iserv/dieschulapp/api/1.0/";

export async function timetable(
  client: IServClient
): Promise<TimetableEntry[]> {
  try {
    const response = await client.request(`${API_BASE}timetable-entries/`);
    const rows = parseResponseBodyArray(response);
    return rows ? (rows as TimetableEntry[]) : [];
  } catch {
    return [];
  }
}

export async function substitutions(
  client: IServClient
): Promise<Substitution[]> {
  try {
    // Sekundär-Cross-Check für Entfall-Erkennung, nie primäre Display-Quelle (ADR-0007).
    const response = await client.request(`${API_BASE}substitutions/`);
    const rows = parseResponseBodyArray(response);
    return rows ? (rows as Substitution[]) : [];
  } catch {
    return [];
  }
}

/** Zeitraster (Slot-Nummer → Start/Endzeit), `?filterBy=type:is(lesson)` liefert die Unterrichtsslots. */
export async function timetableSlots(client: IServClient): Promise<TimetableSlot[]> {
  try {
    const response = await client.request(
      `${API_BASE}timetable-slots/?filterBy=type:is(lesson)`
    );
    const rows = parseResponseBodyArray(response);
    return rows ? (rows as TimetableSlot[]) : [];
  } catch {
    return [];
  }
}
