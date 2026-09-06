import { describe, it, expect } from "vitest";
import {
  calculateMultiplier,
  calculatePrepWindow,
  formatCountdown,
  BASE_DAYS,
  PrepWindow,
} from "../../src/exams/prep-window";
import { ExamType } from "../../src/exams/template";

describe("calculateMultiplier", () => {
  it("returns 0.7 at 15 points", () => {
    expect(calculateMultiplier(15, "points")).toBeCloseTo(0.7, 2);
  });

  it("returns 3.0 at 0 points", () => {
    expect(calculateMultiplier(0, "points")).toBeCloseTo(3.0, 2);
  });

  it("returns 0.7 at grade 1", () => {
    expect(calculateMultiplier(1, "grades")).toBeCloseTo(0.7, 2);
  });

  it("returns 3.0 at grade 6", () => {
    expect(calculateMultiplier(6, "grades")).toBeCloseTo(3.0, 2);
  });

  it("clamps points below 0", () => {
    expect(calculateMultiplier(-5, "points")).toBeCloseTo(3.0, 2);
  });

  it("clamps points above 15", () => {
    expect(calculateMultiplier(20, "points")).toBeCloseTo(0.7, 2);
  });

  it("clamps grades below 1", () => {
    expect(calculateMultiplier(0, "grades")).toBeCloseTo(0.7, 2);
  });

  it("clamps grades above 6", () => {
    expect(calculateMultiplier(10, "grades")).toBeCloseTo(3.0, 2);
  });
});

describe("calculatePrepWindow", () => {
  it("Klausur base is 14 days", () => {
    expect(BASE_DAYS[ExamType.Klausur]).toBe(14);
  });

  it("Abi base is 183 days", () => {
    expect(BASE_DAYS[ExamType.Abi]).toBe(183);
  });

  it("returns correct prepStart for Klausur with 15 points", () => {
    const examDate = new Date("2026-07-01");
    const window = calculatePrepWindow(examDate, ExamType.Klausur, 15, "points");
    const prepDays = Math.ceil(14 * 0.7);
    const expected = new Date("2026-07-01");
    expected.setDate(expected.getDate() - prepDays);
    expect(window.prepStart.toISOString().split("T")[0]).toBe(
      expected.toISOString().split("T")[0]
    );
  });

  it("scales prepStart with lower points", () => {
    const examDate = new Date("2026-07-01");
    const window = calculatePrepWindow(examDate, ExamType.Klausur, 0, "points");
    expect(window.daysTotal).toBe(Math.ceil(14 * 3.0));
  });

  it("uses points scale by default", () => {
    const examDate = new Date("2026-07-01");
    const window = calculatePrepWindow(examDate, ExamType.Klausur, 15);
    expect(window.daysTotal).toBe(Math.ceil(14 * 0.7));
  });

  it("Test base is 5 days", () => {
    expect(BASE_DAYS[ExamType.Test]).toBe(5);
  });

  it("Presentation base is 7 days", () => {
    expect(BASE_DAYS[ExamType.Presentation]).toBe(7);
  });

  it("Ex base is 10 days", () => {
    expect(BASE_DAYS[ExamType.Ex]).toBe(10);
  });

  it("examDate is preserved", () => {
    const examDate = new Date("2026-07-01");
    const window = calculatePrepWindow(examDate, ExamType.Klausur, 15, "points");
    expect(window.examDate).toBe(examDate);
  });
});

describe("formatCountdown", () => {
  it("shows remaining days when prep has started", () => {
    const window: PrepWindow = {
      examDate: new Date("2026-07-01"),
      prepStart: new Date("2026-06-01"),
      daysTotal: 30,
      daysRemaining: 10,
    };
    expect(formatCountdown(window)).toBe("10 Tage verbleibend");
  });

  it("shows start date when prep hasn't started", () => {
    const window: PrepWindow = {
      examDate: new Date("2099-12-31"),
      prepStart: new Date("2099-11-01"),
      daysTotal: 60,
      daysRemaining: 0,
    };
    expect(formatCountdown(window)).toBe(
      `Vorbereitung beginnt am 01.11.2099`
    );
  });

  it("shows remaining when daysRemaining is 0 but prep already started", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const window: PrepWindow = {
      examDate: new Date("2099-12-31"),
      prepStart: today,
      daysTotal: 30,
      daysRemaining: 0,
    };
    expect(formatCountdown(window)).toBe("0 Tage verbleibend");
  });
});
