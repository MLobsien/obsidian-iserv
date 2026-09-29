/**
 * DieschulApp-JSON-Stundenplan-Primärquelle (Issue #7, ADR-0007-Erweiterung).
 *
 * Live-Befunde (29.09.2026, gymmeck.de — Beweise im Issue #7-Kommentar):
 *
 * REICHWEITE: `current-timetable/?date=YYYY-MM-DD&week=true` antwortet 200 für
 * JEDES geprüfte Datum (heute, +1 … +365, Rückblick −30, Ferien-Wochen!) mit
 * der WOCHEN-VORLAGE `{entries (34 Zeilen Mo–Fr), vacations[], schoolEvents[]}`.
 * Das ist keine datengetreue Tages-Wahrheit: Ferientage liefern trotzdem 34
 * Einträge; die Ferientatsachen stehen in `vacations` (in JEDER Antwort
 * enthalten). → Consumer müssen Ferientage selbst über `vacations` unterdrücken.
 *
 * SUBSTITUTIONS-Parameter: `?substitutions=true` → 200 (01.09.2026 „404" ist
 * NICHT mehr reproduzierbar — korrigiert). Vertretungs-/Entfall-Stunden
 * erscheinen als eigene Entries mit:
 *   - `substitutionType: "substituted" | "class-absence"`
 *   - `originalTimeTableEntry`: Original-Fach/Lehrer/Raum (vOR der Änderung)
 *   - Top-Level `courseSubject.subject === null` + `teachers:[{displayname:""}]`
 *     (die „`-` als Fach"-Zeilen aus Untis → KEIN Phantom-Fach rendern)
 *   - `changedParts: {room, teachers, subject}` — true = Feld geändert
 *   - ggf. anderes Top-Level `room` (Vertretungsraum)
 *
 * GRUPPENORDNER (R2): Der Files-Ordner-Name eines Kurses ist EXAKT
 * `courseSubject.course.name` („O Latein 12gN Sz" ↔ `Groups/O Latein 12gN Sz/…`,
 * live via file/api/list/Groups verifiziert). `groups/` kennt nur
 * „… Schüler/Eltern/Lehrer"-Suffixed-Namen — der Kursname selbst genügt für
 * Review-Queue-Fachvorschläge (subjectFromGroup("O Latein 12gN Sz") → Latein).
 */
import type { IServClient } from "./shared-client";
import type { TimetableEntry, TimetableSlot } from "./timetable";

const API_BASE = "/iserv/dieschulapp/api/1.0/";

/** Vertretungs-/Entfall-Flag an einem JSON-Entry (ADR-0007-Semantik). */
export type JsonSubstitutionType = "substituted" | "class-absence";

export interface JsonSubstitutionEntry extends TimetableEntry {
  /** Nur auf Vertretungs-Set promotes. */
  substitutionType: JsonSubstitutionType;
  /** Changed fields (live: {room, teachers, subject}). */
  changedParts?: { room?: boolean; teachers?: boolean; subject?: boolean };
  /** Display message (leer, wenn Untis-Stunde subsituiert). */
  message?: string;
  /** Das Entry VOR der Änderung (echtes Fach/Lehrer/Raum). */
  originalTimeTableEntry?: TimetableEntry;
  /** Untis-Quelle (live: "Untis"). */
  substitution?: { id: number; sourceOfCreation?: string };
}

export interface Vacation {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}

export interface CurrentTimetableResponse {
  entries: JsonSubstitutionEntry[];
  vacations: Vacation[];
  schoolEvents: unknown[];
}

/**
 * current-timetable/?date=&week=&substitutions=true fetchen (best-effort →
 * null bei Fehler; wirft nie — ADR-0007-Pattern).
 */
export async function fetchCurrentTimetable(
  client: IServClient,
  date: string,
  opts: { week?: boolean } = {}
): Promise<CurrentTimetableResponse | null> {
  try {
    const week = opts.week === false ? "false" : "true";
    const resp = await client.request(
      `${API_BASE}current-timetable/?date=${date}&week=${week}&substitutions=true`
    );
    if (resp.status !== 200) return null;
    const parsed: unknown = JSON.parse(resp.body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const o = parsed as Partial<CurrentTimetableResponse>;
    if (!Array.isArray(o.entries)) return null;
    return {
      entries: o.entries as JsonSubstitutionEntry[],
      vacations: Array.isArray(o.vacations) ? o.vacations : [],
      schoolEvents: Array.isArray(o.schoolEvents) ? o.schoolEvents : [],
    };
  } catch {
    return null;
  }
}

/** Datum (Vac-Range) → true, wenn `iso` in [startDate, endDate] liegt. */
export function isOnVacation(iso: string, vacations: Vacation[]): boolean {
  if (!iso) return false;
  for (const v of vacations) {
    if (iso >= v.startDate && iso <= v.endDate) return true;
  }
  return false;
}

/**
 * Ein „leeres Fach"-Dekorpaar (Issue #7 R3): wenn `courseSubject.subject ==
 * null` ist der Entry eine Vertretungs/Entfall-Zeile — echtes Fach kommt aus
 * `originalTimeTableEntry`. Rückgabe: {original, replacement} oder null für
 * normale Lessons (kein Substitution) ODER ohne Original (kein Anzeige-Fach).
 */
export function splitSubstitution(
  e: JsonSubstitutionEntry
): { original: TimetableEntry | null; type: JsonSubstitutionType } | null {
  const raw = (e as { substitutionType?: unknown }).substitutionType;
  if (raw !== "substituted" && raw !== "class-absence") return null;
  return { original: e.originalTimeTableEntry ?? null, type: raw };
}

/**
 * Ferientag-Unterdrückung (R1): planned entries eines Tages weglassen, wenn
 * das Tag-Datum in einer Vacation liegt (current-timetable liefert auch in
 * Ferien die volle Wochen-Vorlage — kein Leerzustand 自動).
 */
export function schoolDaysOfWeek(
  weekIso: Map<number, string>,
  vacations: Vacation[]
): number[] {
  const out: number[] = [];
  for (const [weekday, iso] of weekIso) {
    if (!isOnVacation(iso, vacations)) out.push(weekday);
  }
  return out.sort((a, b) => a - b);
}

/**
 * JSON-Ausfallzeilen (R3) → Sidebar-Dekor-verträgliche Substitutionen:
 * wandelt `current-timetable`-Substitution-Entries in `Substitution`-Shapes,
 * damit sidebar-logic.entryDecor unverändert weitermatchen kann.
 * Lehrer/Fach des ERSATZ-Slots aren im JSON leer (Untis schreibt das im Feld
 * `message` nicht) — insteadOfTeacher bleibt null (fail-soft wie ADR-0007).
 */
export function jsonEntriesToSubstitutions(
  entries: JsonSubstitutionEntry[]
): import("./timetable").Substitution[] {
  const out: import("./timetable").Substitution[] = [];
  for (const e of entries) {
    const raw = (e as { substitutionType?: unknown }).substitutionType;
    if (raw !== "substituted" && raw !== "class-absence") continue;
    const original = e.originalTimeTableEntry;
    const origSubject = original?.courseSubject;
    const slot =
      typeof e.timeTableSlot === "number"
        ? e.timeTableSlot
        : (e.timeTableSlot?.number ?? 0);
    out.push({
      id: (e as { substitution?: { id?: number } })?.substitution?.id ?? e.id,
      createdAt: "",
      channel: { name: origSubject?.course?.name ?? "", type: "course" },
      channels: [],
      date: { date: `${isoOfEntry(e)} 00:00:00.000`, timezone: "Europe/Berlin" },
      hour: slot,
      subject: e.courseSubject?.subject?.name ?? "",
      substitutionType: raw === "class-absence" ? "class-absence" : "substituted",
      displayMessageForStudents: e.message ?? "",
      room: typeof e.room === "object" && e.room !== null
        ? e.room
        : typeof original?.room === "object" && original?.room !== null
          ? original.room
          : null,
      insteadOfTeacher: null,
      courseName: origSubject?.course?.name ?? e.courseSubject?.course?.name ?? "",
      // originalTimeTableEntry-Felder für Display-Consumenten (Erweiterung).
      ...({ originalSubject: origSubject?.subject?.name ?? "" } as object),
      ...({ originalTeachers: origSubject?.teachers ?? [] } as object),
    });
  }
  return out;
}

/**
 * Date-ISO eines Entries aus einem Wochen-Fetch: current-timetable enthält je
 * Entry KEIN Datum → der Consumer (fetchJsonWeek) setzt die Zuordnung
 * weekday→iso selbst (weekIso-Argument) — hier nur best-effort über
 * weekday-Vorlage nötig. Wir liefern den weekday-Rohwert als Proxy (nicht
 * als Iso!) — deshalb separater Dekor-Pfad über original-entry statt iso;
 * isoOfEntry ist bewusst NICHT exportiert-wichtig (Tag-Mapping im Fetch).
 */
function isoOfEntry(e: JsonSubstitutionEntry): string {
  const raw = (e as { _iso?: unknown })._iso;
  return typeof raw === "string" ? raw : "";
}

export interface JsonDayPlan {
  iso: string;
  weekday: number;
  /** Ferientag (aus vacations) → true; Entries trotzdem geliefert. */
  vacation: boolean;
  entries: JsonSubstitutionEntry[];
}

/**
 * Wochenplan für ein ISO-Datum (weekday→ISO je Tag) holen. Liefert je Tag
 * Ferientag-Flag + Entries — der View-Renderer entscheidet (vacation →
 * „Kein Unterricht"/Ferien-Label), die parse-Schicht behält Daten.
 * @param weekIso — weekday (0=Mo…4=Fr) → ISO-Datum der Zielwoche.
 */
export async function fetchJsonWeek(
  client: IServClient,
  weekIso: Map<number, string>,
  opts: { slots?: TimetableSlot[] } = {}
): Promise<Map<number, JsonDayPlan>> {
  const out = new Map<number, JsonDayPlan>();
  if (weekIso.size === 0) return out;
  const anyDate = [...weekIso.values()][0];
  const resp = await fetchCurrentTimetable(client, anyDate, { week: true });
  if (!resp) return out;
  for (const [weekday, iso] of weekIso) {
    out.set(weekday, {
      iso,
      weekday,
      vacation: isOnVacation(iso, resp.vacations),
      entries: resp.entries.filter((e) => e.weekday === weekday),
    });
  }
  return out;
}

/**
 * Einzelner Tag (Weekday/sei zhlt nicht Kalenderwoche — T30-Integration):
 * current-timetable ohne week=true liefert NUR den Tag (Live: 6 Entries,
 * 1 Weekday am 29.9.). Für die Sidebar-Reichweite reichend.
 */
export async function fetchJsonDay(
  client: IServClient,
  date: string
): Promise<JsonDayPlan | null> {
  const resp = await fetchCurrentTimetable(client, date, { week: false });
  if (!resp) return null;
  // day-Modus: Entry weekday = Tag selbst; Iso bestimmen wir aus dem Date-Param.
  const first = resp.entries[0];
  const weekday = first ? first.weekday : -1;
  return {
    iso: date,
    weekday,
    vacation: isOnVacation(date, resp.vacations),
    entries: resp.entries,
  };
}

/**
 * Gruppe → Files-Ordner-Anker (R2): der Kursname ist selbst der Ordnername
 * unter Groups. Reine Funktion (Node-testbar), keine Fallbacks.
 */
export function filesFolderNameForCourse(courseName: string | undefined): string {
  return courseName?.trim() ?? "";
}
