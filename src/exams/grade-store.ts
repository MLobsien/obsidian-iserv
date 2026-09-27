/**
 * Fachindex (T10 F3, ADR-0006 / CONTEXT.md): interne Punkte-Map je Fach in
 * `data.json` (getrackt — cred-free, nicht personal-data-free), Grundlage des
 * Fenster-Multiplikators; Eintrag per Modal nach der +2-Wochen-Notice/Task.
 *
 * Pure-Modul (obsidian-frei, Seam-Split à la ADR-0007): Persistenz läuft über
 * ein injiziertes PluginDataStore (Callback-basiert loadData/saveData, wie
 * ReviewQueue in src/review-queue/state.ts). Das Wiring macht main.ts.
 */
import type { GradeScale } from "./prep-window";
import { PluginDataStore } from "../review-queue/state";

/** {examTitle, date, points}[] je Fach — die Noten-Einträge des Fachindex. */
export interface GradeEntry {
  examTitle: string;
  /** Datum der Arbeit (ISO-String, z.B. "2026-10-07"); leer = ohne Datum. */
  date: string;
  /** 0–15 Punkte je Scale 'punkte' — oder 1–6 je Scale 'noten'. */
  points: number;
  /** Scale, unter der der Eintrag erfasst wurde (punkt-einheit des 'points'-Werts). */
  scale: GradeScale;
}

/** {subject → GradeEntry[]} — die data.json-Struktur unter "grade-index". */
export type GradeIndexData = Record<string, GradeEntry[]>;

const INDEX_KEY = "grade-index";

const MIN_POINTS = 0;
const MAX_POINTS = 15;
const MIN_GRADE = 1;
const MAX_GRADE = 6;

export function isValidPoints(points: number, scale: GradeScale): boolean {
  if (!Number.isFinite(points)) return false;
  if (scale === "grades") {
    // Schulnoten 1–6 sind ganze Werte (keine 3.5er-Eintragung).
    return Number.isInteger(points) && points >= MIN_GRADE && points <= MAX_GRADE;
  }
  return points >= MIN_POINTS && points <= MAX_POINTS;
}

export class GradeStore {
  private grades: GradeIndexData = {};
  private plugin: PluginDataStore;

  constructor(plugin: PluginDataStore) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    const data = await this.plugin.loadData();
    const raw = data[INDEX_KEY];
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.values(raw as GradeIndexData).every((v) => Array.isArray(v))
    ) {
      this.grades = raw as GradeIndexData;
    } else {
      this.grades = {};
    }
  }

  async save(): Promise<void> {
    const data = await this.plugin.loadData();
    data[INDEX_KEY] = this.grades;
    await this.plugin.saveData(data);
  }

  /** Validierter Noten-Eintrag: wirft bei Punkten außerhalb der Scale. */
  addGrade(
    subject: string,
    entry: Omit<GradeEntry, "scale"> & { scale?: GradeScale }
  ): void {
    const scale = entry.scale ?? "points";
    const { examTitle, date, points } = entry;
    if (!isValidPoints(points, scale)) {
      const range = scale === "grades" ? "1–6" : "0–15";
      throw new RangeError(
        `Ungültige Punktzahl ${points} für Scale '${scale}' (erlaubt: ${range})`
      );
    }
    const list = this.grades[subject] ?? [];
    list.push({ examTitle, date, points, scale });
    this.grades[subject] = list;
  }

  /** Fach-Liste für die Index-Ansicht (insgesamte Entries je Fach). */
  getSubjects(): { subject: string; count: number }[] {
    return Object.entries(this.grades)
      .map(([subject, entries]) => ({ subject, count: entries.length }))
      .sort((a, b) => a.subject.localeCompare(b.subject, "de"));
  }

  getGrades(subject: string): GradeEntry[] {
    return (this.grades[subject] ?? []).map((e) => ({ ...e }));
  }

  getAllGrades(): GradeIndexData {
    const copy: GradeIndexData = {};
    for (const [subject, entries] of Object.entries(this.grades)) {
      copy[subject] = entries.map((e) => ({ ...e }));
    }
    return copy;
  }

  /**
   * Fach-Durchschnitt auf der Punkte-Scale 0–15: 'noten'-Einträge werden
   * normalisiert (Note 1 ≙ 15 P … Note 6 ≙ 0 P, linear, wie T9-Endpunkte).
   */
  getSubjectAverage(subject: string): number | null {
    const entries = this.grades[subject];
    if (!entries || entries.length === 0) return null;
    const pointsList = entries.map((e) =>
      e.scale === "grades" ? normalizeGradeToPoints(e.points) : e.points
    );
    const sum = pointsList.reduce((a, b) => a + b, 0);
    return sum / pointsList.length;
  }
}

/** Note 1–6 → Punkte 0–15 (linear; Note 1 = 15 P, Note 6 = 0 P). */
export function normalizeGradeToPoints(grade: number): number {
  const clamped = Math.max(MIN_GRADE, Math.min(MAX_GRADE, grade));
  return 15 - ((clamped - 1) * 15) / (MAX_GRADE - MIN_GRADE);
}

/**
 * Multiplikator-Hook für das prep-window-Tuning (ADR-0006, linear:
 * 15 P → ×0.7 … 0 P → ×3.0; Note 1 → ×0.7 … Note 6 → ×3.0). Nur Export —
 * das Wiring in prep-window folgt (Coordinator).
 */
export function multiplierFor(points: number, scale: GradeScale): number {
  if (scale === "grades") {
    const clamped = Math.max(MIN_GRADE, Math.min(MAX_GRADE, points));
    return 0.7 + ((clamped - 1) * 2.3) / 5;
  }
  const clamped = Math.max(MIN_POINTS, Math.min(MAX_POINTS, points));
  return 0.7 + ((15 - clamped) * 2.3) / 15;
}
