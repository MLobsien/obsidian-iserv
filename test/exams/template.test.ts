import { describe, it, expect } from "vitest";
import {
  ExamType,
  ExamStatus,
  Exam,
  generateTemplate,
  transitionState,
} from "../../src/exams/template";

function makeExam(status: ExamStatus): Exam {
  return {
    id: "1",
    title: "Mathe Klausur",
    type: ExamType.Klausur,
    date: new Date("2026-06-15"),
    subject: "Mathematik",
    status,
  };
}

describe("generateTemplate", () => {
  it("produces valid markdown with frontmatter", () => {
    const exam = makeExam(ExamStatus.Planned);
    const md = generateTemplate(exam);

    expect(md).toContain("---\n");
    expect(md).toContain("type: Klausur");
    expect(md).toContain("date: 2026-06-15");
    expect(md).toContain("subject: Mathematik");
    expect(md).toContain("status: planned");
    expect(md).toContain("# Mathe Klausur");
  });
});

describe("transitionState", () => {
  it("Planned → InPrep succeeds", () => {
    const exam = makeExam(ExamStatus.Planned);
    const next = transitionState(exam, ExamStatus.InPrep);
    expect(next.status).toBe(ExamStatus.InPrep);
  });

  it("InPrep → Done succeeds", () => {
    const exam = makeExam(ExamStatus.InPrep);
    const next = transitionState(exam, ExamStatus.Done);
    expect(next.status).toBe(ExamStatus.Done);
  });

  it("Planned → Postponed succeeds", () => {
    const exam = makeExam(ExamStatus.Planned);
    const next = transitionState(exam, ExamStatus.Postponed);
    expect(next.status).toBe(ExamStatus.Postponed);
  });

  it("Done → InPrep fails", () => {
    const exam = makeExam(ExamStatus.Done);
    expect(() => transitionState(exam, ExamStatus.InPrep)).toThrow();
  });

  it("Postponed → Done fails", () => {
    const exam = makeExam(ExamStatus.Postponed);
    expect(() => transitionState(exam, ExamStatus.Done)).toThrow();
  });
});
