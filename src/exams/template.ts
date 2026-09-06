export enum ExamType {
  Klausur = "Klausur",
  Ex = "Ex",
  Test = "Test",
  Presentation = "Presentation",
  Abi = "Abi",
}

export enum ExamStatus {
  Planned = "planned",
  InPrep = "in-prep",
  Done = "done",
  Postponed = "postponed",
}

export interface Exam {
  id: string;
  title: string;
  type: ExamType;
  date: Date;
  subject: string;
  status: ExamStatus;
  prepWindow?: Date;
}

const VALID_TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
  [ExamStatus.Planned]: [ExamStatus.InPrep, ExamStatus.Postponed],
  [ExamStatus.InPrep]: [ExamStatus.Done, ExamStatus.Postponed],
  [ExamStatus.Done]: [],
  [ExamStatus.Postponed]: [],
};

export function generateTemplate(exam: Exam): string {
  const frontmatter = [
    "---",
    `type: ${exam.type}`,
    `date: ${exam.date.toISOString().split("T")[0]}`,
    `subject: ${exam.subject}`,
    `status: ${exam.status}`,
    "---",
    "",
  ].join("\n");

  return `${frontmatter}# ${exam.title}\n`;
}

export function transitionState(exam: Exam, newStatus: ExamStatus): Exam {
  const allowed = VALID_TRANSITIONS[exam.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${exam.status} → ${newStatus}`
    );
  }
  return { ...exam, status: newStatus };
}
