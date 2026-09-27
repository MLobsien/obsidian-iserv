/**
 * Timetable & Substitution API client for IServ DieschulApp.
 *
 * Uses the `/iserv/dieschulapp/api/1.0/` JSON endpoints.
 */

export interface TimetableTeacher {
  displayname: string;
  externalId: string;
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

export interface TimetableEntry {
  id: number;
  courseSubject: TimetableCourseSubject;
  weekday: number;
  timeTableSlot: number;
  room: string;
}

export interface SubstitutionChannel {
  name: string;
  type: string;
}

export interface Substitution {
  id: number;
  createdAt: string;
  channel: SubstitutionChannel;
  channels: SubstitutionChannel[];
  date: string;
  substitutionType: string;
  displayMessageForStudents: string;
  room?: string;
  insteadOfTeacher?: string;
  hour?: number;
}

export interface SubstitutionBoardMessage {
  id?: number;
  message?: string;
  [key: string]: unknown;
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

export async function substitutionBoardMessages(
  client: IServClient
): Promise<SubstitutionBoardMessage[]> {
  try {
    const response = await client.request(
      `${API_BASE}substitutionBoardMessages/`
    );
    const rows = parseResponseBodyArray(response);
    return rows ? (rows as SubstitutionBoardMessage[]) : [];
  } catch {
    return [];
  }
}
