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
export interface IServClient {
  request(
    path: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> }
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    json?: unknown;
  }>;
}

const API_BASE = "/iserv/dieschulapp/api/1.0/";

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export async function timetable(
  client: IServClient
): Promise<TimetableEntry[]> {
  try {
    const response = await client.request(`${API_BASE}timetable-entries/`);

    if (response.status !== 200) {
      return [];
    }

    if (!response.json || !isArray(response.json)) {
      return [];
    }

    return response.json as TimetableEntry[];
  } catch {
    return [];
  }
}

export async function substitutions(
  client: IServClient
): Promise<Substitution[]> {
  try {
    const response = await client.request(`${API_BASE}substitutions/`);

    if (response.status !== 200) {
      return [];
    }

    if (!response.json || !isArray(response.json)) {
      return [];
    }

    return response.json as Substitution[];
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

    if (response.status !== 200) {
      return [];
    }

    if (!response.json || !isArray(response.json)) {
      return [];
    }

    return response.json as SubstitutionBoardMessage[];
  } catch {
    return [];
  }
}
