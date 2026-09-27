/**
 * Status-Flow der Arbeiten (T19, ADR-0006): 'geplant' | 'in-vorbereitung' |
 * 'fertig' | 'verschoben'. Rein funktional (kein Persist) — computeStatus
 * leitet den Status aus der Vorbereitungsphase (Termin − Fenster, prepWindow)
 * ODER aus einem importierten/override Status her.
 */
import { ExamType, Exam } from "./template";
import {
  calculatePrepWindow,
  type GradeScale,
} from "./prep-window";

export type ExamStatus =
  | "geplant"
  | "in-vorbereitung"
  | "fertig"
  | "verschoben";

export const EXAM_STATUSES: ExamStatus[] = [
  "geplant",
  "in-vorbereitung",
  "fertig",
  "verschoben",
];

/** Klick-Cycle-Reihenfolge für das Badge (ADR-0006 F5: Override jederzeit). */
export function cycleStatus(current: ExamStatus): ExamStatus {
  const i = EXAM_STATUSES.indexOf(current);
  return EXAM_STATUSES[(i + 1) % EXAM_STATUSES.length];
}

/** Eingangs-Shape für computeStatus (Frontmatter-Nah, Terminal-frei). */
export interface StatusExam {
  id?: string;
  type?: ExamType;
  /** Termin (examDate). */
  date: Date;
  /** Fachpunkte für den Multiplikator (default 15 = schwächste Vorlaufzeit). */
  points?: number;
  scale?: GradeScale;
  /** Importierter Status (Frontmatter) — override, sonst Fenster-Ableitung. */
  status?: string;
}

/** Importierter Status (Frontmatter-String → Typ) oder null bei unbekannt. */
export function parseImportedStatus(s: string | undefined): ExamStatus | null {
  if (!s) return null;
  const norm = s.trim().toLowerCase();
  switch (norm) {
    case "geplant":
    case "planned":
      return "geplant";
    case "in-vorbereitung":
    case "in-prep":
      return "in-vorbereitung";
    case "fertig":
    case "done":
      return "fertig";
    case "verschoben":
    case "postponed":
      return "verschoben";
    default:
      return null;
  }
}

/**
 * computeStatus: syntaktische Status-Übergänge rein aus (Termin, Fenster, now).
 * prepWindow (ADR-0006) determines 'in-vorbereitung' sobald Termin − Fenster
 * ≤ now ≤ Termin, sonst 'geplant' (vor Fensterstart). Importierter Status
 * (override, F5) gewinnt, wenn vorhanden.
 */
export function computeStatus(exam: StatusExam, now: Date): ExamStatus {
  const imported = parseImportedStatus(exam.status);
  if (imported) return imported;
  const type = exam.type ?? ExamType.Klausur;
  const window = calculatePrepWindow(
    exam.date,
    type,
    exam.points ?? 15,
    exam.scale ?? "points"
  );
  const day = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const nowDay = day(now);
  if (nowDay >= day(window.prepStart) && nowDay <= day(exam.date)) {
    return "in-vorbereitung";
  }
  return "geplant";
}

/**
 * Konvertiert legacy Exam (template.ts) → StatusExam-shape (nur Daten-Shaping,
 * kein Verhalten): einheitlicher Status-Typ über neue Module.
 */
export function toStatusExam(exam: Exam): StatusExam {
  return {
    id: exam.id,
    type: exam.type,
    date: exam.date,
    points: 15,
    scale: "points",
    status: exam.status,
  };
}
