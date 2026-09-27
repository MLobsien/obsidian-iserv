import { ExamType } from "./template";

export type GradeScale = "points" | "grades";

export interface PrepWindow {
  examDate: Date;
  prepStart: Date;
  daysTotal: number;
  daysRemaining: number;
}

export interface PrepWindowBases {
  [ExamType.Klausur]: number;
  [ExamType.Ex]: number;
  [ExamType.Test]: number;
  [ExamType.Presentation]: number;
  [ExamType.Abi]: number;
}

/** ADR-0006 Defaults; zur Laufzeit über Settings überschreibbar (Bases = Settings). */
export const DEFAULT_BASE_DAYS: PrepWindowBases = {
  [ExamType.Klausur]: 14,
  [ExamType.Ex]: 10,
  [ExamType.Test]: 5,
  [ExamType.Presentation]: 7,
  [ExamType.Abi]: 183, // ADR-0006 "6 Mon" ≈ 182.5 Tage → 183 (Tages-Granularität)
};

let baseDaysOverride: PrepWindowBases | null = null;

/** Settings-Wirksamkeit: Basen aus Plugin-Settings setzen (ADR-0006: Basen als Settings). */
export function setBaseDays(bases: Partial<PrepWindowBases>): void {
  baseDaysOverride = { ...DEFAULT_BASE_DAYS, ...bases };
}

/** Test/Reset-Hilfe: zurück auf die ADR-0006-Defaults. */
export function resetBaseDays(): void {
  baseDaysOverride = null;
}

/** Aktive Basen (Override oder Defaults). */
export function getBaseDays(): PrepWindowBases {
  return baseDaysOverride ?? DEFAULT_BASE_DAYS;
}

/** @deprecated Alias für die Defaults — nur für Legacy-Tests; use `getBaseDays()`. */
export const BASE_DAYS = DEFAULT_BASE_DAYS;

export function calculateMultiplier(
  points: number,
  scale: GradeScale
): number {
  if (scale === "points") {
    const clamped = Math.max(0, Math.min(15, points));
    return 0.7 + ((15 - clamped) * 2.3) / 15;
  }
  const clamped = Math.max(1, Math.min(6, points));
  return 0.7 + ((clamped - 1) * 2.3) / 5;
}

export function calculatePrepWindow(
  examDate: Date,
  examType: ExamType,
  points: number,
  scale: GradeScale = "points"
): PrepWindow {
  const baseDays = getBaseDays()[examType];
  const multiplier = calculateMultiplier(points, scale);
  const prepDays = Math.ceil(baseDays * multiplier);
  const prepStart = new Date(examDate);
  prepStart.setDate(prepStart.getDate() - prepDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const examDay = new Date(examDate);
  examDay.setHours(0, 0, 0, 0);
  // Countdown bis Termin (T10/#13): Tage verbleibend bis zur Arbeit, nicht verstrichene.
  const diffMs = examDay.getTime() - today.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  return { examDate, prepStart, daysTotal: prepDays, daysRemaining };
}

export function formatCountdown(prepWindow: PrepWindow): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < prepWindow.prepStart) {
    const day = String(prepWindow.prepStart.getDate()).padStart(2, "0");
    const month = String(prepWindow.prepStart.getMonth() + 1).padStart(2, "0");
    const year = prepWindow.prepStart.getFullYear();
    return `Vorbereitung beginnt am ${day}.${month}.${year}`;
  }
  return `${prepWindow.daysRemaining} Tage verbleibend`;
}
