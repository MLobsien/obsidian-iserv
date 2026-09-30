/**
 * IServSettings + DEFAULT_SETTINGS (T23) — von main.ts nach hier extrahiert,
 * damit Settings-Konsumenten (settings-tab, Tests) obsidian-frei importieren.
 */

export interface IServSettings {
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  pollMinutes: number;
  /** Job-Intervalle in Minuten (T24/ADR-0005; 0 = Modul aus). */
  jobIntervals: { core: number; mails: number; exercises: number };
  /** Vorbereitungsfenster-Basen in Tagen (ADR-0006, override für DEFAULT_BASE_DAYS). */
  prepWindowBaseDays?: Partial<import("../exams/prep-window").PrepWindowBases>;
  /** Spam-Filter: Absender außerhalb der Schul-Domain filtern (ADR-0008/Plan "onlySchoolEmails"). */
  onlySchoolEmails: boolean;
  /** Ablage-Template für importierte Dateien (Platzhalter {{SUBJECT}}, {{SCHOOLYEAR}}, …). */
  template?: string;
  /** Notenscale für den Notenindex (T18/ADR-0006): 'punkte' (0–15) oder 'grades' (1–6). */
  gradesScale: "points" | "grades";
  /**
   * Review-Frist in Tagen (Runde 5, User 28.09.2026): Dateien innerhalb des
   * Fensters erscheinen einzeln in der Queue ("neu"), ältere werden automatisch
   * entschieden ("auto" — kein manuelles Einzelfeedback).
   */
  reviewThresholdDays?: number;
  /**
   * Runde 6 (User): Zielordner-Pattern für Queue-Ablagen. Platzhalter:
   * {{SUBJECT}}, {{GROUP}}, {{YEAR}}. Default: nur {{SUBJECT}}.
   * Noch kein Vault-Write — nur Setter + Validation.
   */
  queueTargetFolderPattern?: string;
  /**
   * Runde 6 (User): manuelle Gruppen→Fach-Overrides (Group-Name = exakter
   * IServ-Ordnername, z. B. "O Mathe 12eN Kü" → "Mathematik"). Überschreibt
   * das Gruppen-Automap-Ergebnis mit Vorrang.
   */
  queueGroupMap?: Record<string, string>;
  /**
   * Runde 6 (User): "Aktuell"-Radikalfilter — Hausaufgaben-Fenster in Tagen
   * ab jetzt. Offene Aufgaben mit dueDate im Fenster erscheinen in der
   * Sidebar-Sektion "Aktuell" als Hausaufgaben. Default 1 (= Rest von heute
   * + morgen); 0 = nur noch heute fällig.
   */
  homeworkDueOffsetDays?: number;
}

export const DEFAULT_SETTINGS: IServSettings = {
  host: "gymmeck.de",
  port: 443,
  ssl: true,
  user: "",
  pollMinutes: 0,
  jobIntervals: { core: 15, mails: 15, exercises: 30 },
  onlySchoolEmails: true,
  gradesScale: "points",
  reviewThresholdDays: 7,
  queueTargetFolderPattern: "{{SUBJECT}}",
  queueGroupMap: {},
  homeworkDueOffsetDays: 1,
};
