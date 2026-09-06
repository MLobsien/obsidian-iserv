import { ExamType } from "./template";

export type GradeScale = "points" | "grades";

export interface PrepWindow {
  examDate: Date;
  prepStart: Date;
  daysTotal: number;
  daysRemaining: number;
}

export const BASE_DAYS: Record<ExamType, number> = {
  [ExamType.Klausur]: 14,
  [ExamType.Ex]: 10,
  [ExamType.Test]: 5,
  [ExamType.Presentation]: 7,
  [ExamType.Abi]: 183,
};

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
  const baseDays = BASE_DAYS[examType];
  const multiplier = calculateMultiplier(points, scale);
  const prepDays = Math.ceil(baseDays * multiplier);
  const prepStart = new Date(examDate);
  prepStart.setDate(prepStart.getDate() - prepDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - prepStart.getTime();
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
