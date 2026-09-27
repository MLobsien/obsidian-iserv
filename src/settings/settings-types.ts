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
}

export const DEFAULT_SETTINGS: IServSettings = {
  host: "gymmeck.de",
  port: 443,
  ssl: true,
  user: "",
  pollMinutes: 0,
  jobIntervals: { core: 15, mails: 15, exercises: 30 },
  onlySchoolEmails: true,
};
