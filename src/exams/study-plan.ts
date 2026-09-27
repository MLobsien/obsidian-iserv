/**
 * Lernplan-Scaffold-Generator (ADR-0006 F2, T20).
 *
 * Pure Funktion, obsidian-frei, keine Datei-IO: der Caller (Phase-Start in
 * main.ts) scannt den Fachordner (inkl. Material/, rekursiv, mtime-absteigend
 * sortiert, letzter Arbeit im Fach bis Schuljahresbeginn) und übergibt die
 * fertige Notiz-Liste. Dieses Modul rendert nur den Markdown-String, den der
 * Caller als `Lernplan <Arbeit>.md` schreibt. User verfeinert manuell
 * (Lernstand nicht knowbar — ADR-0006), kein AI-Scan.
 *
 * Plan-Struktur nach T9-Evidenz (docs/research/lernmethodik.md):
 * - Verteilte Sessions mit 1–3 Tage Gaps bei ~2-Wochen-Horizont (Cepeda 2008)
 * - Fächer interleaved (Platzhalter)
 * - ≥90 % Selbsttest-Gate pro Thema (RTI/Mastery)
 * - Back-to-Back-Protokoll 70/30 → 80/20 → 90/10 als Checkpoint-Zeilen
 * - Kein Pomodoro (schwache Evidenz — bewusst kein Eintrag)
 */

export const STATUS_GEPLANT = "geplant";

/** Selbsttest-Gate-Formulierung (RTI/Mastery: „teaching to 90 %"). */
export const SELF_TEST_GATE = "Selbsttest ≥ 90 %";

/**
 * Evidenzbasierte Session-Gaps (Tage) bei ~2-Wochen-Horizont, fest im Modul
 * (ADR-0006: verteilte Sessions 1–3 Tage, Cepeda 2008; expanding Verlauf).
 * 5 Blöcke über ~10 Tage vor dem Termin.
 */
export const SESSION_GAPS_DAYS = [3, 2, 2, 2, 1] as const;

/** Back-to-Back-Protokoll in fortlaufender Reihenfolge. */
export const BACK_TO_BACK_PROTOCOL = ["70/30", "80/20", "90/10"] as const;

/** Scaffold-Platzhalter-Themen (User benennt sie konkret). */
const THEME_PLACEHOLDERS = [
  "Thema 1",
  "Thema 2",
  "Thema 3",
  "Thema 4",
  "Thema 5",
] as const;

export interface StudyPlanInput {
  examTitle: string;
  /** UTC-ISO-Datum der Arbeit, z. B. „2026-10-14“ (Frontmatter `due`). */
  examDate: string;
  subject: string;
  /** Fertig sortierte Notiz-Liste (mtime absteigend; Sortierung macht der Caller). */
  notizenNoten: string[];
}

/** Eine verteilte Session (Tag vor Termin + Themen-Gate-Zeilen). */
export interface StudyPlanSession {
  /** Tage vor der Arbeit (0 = Termin selbst). */
  daysBeforeExam: number;
  /** Gap in Tagen zur vorherigen Session (SESSION_GAPS_DAYS). */
  gapDays: number;
  /** Theme-Checkbox-Zeilen inkl. ≥90 %-Selbsttest-Gate. */
  themeLines: string[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Validiert YYYY-MM-DD und erzeugt UTC-kalendergenaues Datum. */
function validateISODate(examDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
    throw new Error(`examDate muss YYYY-MM-DD sein, erhalten: "${examDate}"`);
  }
  return examDate;
}

/** Termin minus n Tage als YYYY-MM-DD (UTC-kalendergenau, kein DST-Jitter). */
function dateDaysBefore(examDate: string, daysBefore: number): string {
  const [y, m, d] = examDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBefore);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Kumulierte Tage-vor-Termin-Offsets der 5 Session-Blöcke (absteigend). */
export function sessionOffsetsFromExam(): number[] {
  const offsets: number[] = [];
  let remaining = SESSION_GAPS_DAYS.reduce((a, b) => a + b, 0);
  for (const gap of SESSION_GAPS_DAYS) {
    offsets.push(remaining);
    remaining -= gap;
  }
  return offsets;
}

/**
 * Verteilte Sessions als Daten (für Fein-Tests): 5 Blöcke, Gap 1–3 T,
 * je eine Selbsttest-Gate-Zeile pro Themaplatzhalter.
 */
export function deriveSessionShells(
  offsetsWithExam: number[] = sessionOffsetsFromExam()
): StudyPlanSession[] {
  return SESSION_GAPS_DAYS.map((gapDays, index) => ({
    daysBeforeExam: offsetsWithExam[index],
    gapDays,
    themeLines: THEME_PLACEHOLDERS.map(
      (thema) => `- [ ] ${thema} — ${SELF_TEST_GATE}`
    ),
  }));
}

/** Frontmatter: exam, subject, due (Termin-ISO), status: geplant. */
export function generateFrontmatter(input: StudyPlanInput): string {
  return [
    "---",
    `exam: ${input.examTitle}`,
    `subject: ${input.subject}`,
    `due: ${input.examDate}`,
    `status: ${STATUS_GEPLANT}`,
    "---",
    "",
  ].join("\n");
}

/** Material-Sektion: Wikilink-Liste der übergebenen (fertig sortierten) Pfade. */
export function generateMaterialSection(notizenNoten: string[]): string {
  const lines = ["## Material", ""];
  if (notizenNoten.length === 0) {
    lines.push("_Noch keine Notizen seit der letzten Arbeit im Fach._");
  } else {
    for (const pfad of notizenNoten) {
      lines.push(`- [[${pfad}]]`);
    }
  }
  return lines.join("\n");
}

/** Lernplan-Sektion: 5 verteilte Session-Blöcke aus T9-Evidenz-Scaffolds. */
export function generateLernplanSection(input: StudyPlanInput): string {
  const sessions = deriveSessionShells();
  const lines = ["## Lernplan", ""];
  lines.push("_Platzhalter — User verfeinert manuell (Themen eintragen)._");
  lines.push("");
  sessions.forEach((session, index) => {
    const date = dateDaysBefore(validateISODate(input.examDate), session.daysBeforeExam);
    lines.push(
      `### Session ${index + 1} — ${date} (Gap ${session.gapDays} Tage, ${session.daysBeforeExam} Tage vor Termin)`
    );
    for (const line of session.themeLines) {
      lines.push(line);
    }
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Back-to-Back-Protokoll 70/30 → 80/20 → 90/10 als fortschreitende
 * Checkpoint-Zeilen (T9: Retrieval-Pfade der späteren Arbeit erhalten).
 */
export function generateProtocolSection(): string {
  const lines = ["## Back-to-Back-Protokoll", ""];
  BACK_TO_BACK_PROTOCOL.forEach((entry, index) => {
    lines.push(`- [ ] Checkpoint ${index + 1}: ${entry} (frühere/spätere Arbeit)`);
  });
  return lines.join("\n");
}

/** Interleaved-Platzhalter (T9: Fächer mischen; User trägt konkrete Fächer ein). */
export function generateFächerSection(): string {
  return [
    "## Fächer interleaved",
    "",
    "- [ ] Fach A (Platzhalter) — mit Session-Wechsel rotieren",
    "- [ ] Fach B (Platzhalter)",
    "",
  ].join("\n");
}

/** Einzelteile (Baustein-API, für Fein-Tests und spätere Caller). */
export function buildStudyPlanParts(input: StudyPlanInput): {
  frontmatter: string;
  materialSection: string;
  lernplanSection: string;
  protocolSection: string;
  fächerSection: string;
} {
  return {
    frontmatter: generateFrontmatter(input),
    materialSection: generateMaterialSection(input.notizenNoten),
    lernplanSection: generateLernplanSection(input),
    protocolSection: generateProtocolSection(),
    fächerSection: generateFächerSection(),
  };
}

/**
 * Generiert den vollständigen Lernplan als Markdown-String (pure, kein IO).
 * Separat exportiert für einen späteren Caller (main.ts Phase-Start-Notice).
 */
export function generateStudyPlanContent(input: StudyPlanInput): string {
  const parts = buildStudyPlanParts(input);
  return [
    parts.frontmatter,
    parts.materialSection,
    parts.lernplanSection,
    parts.protocolSection,
    parts.fächerSection,
  ].join("\n");
}

/** Komfort-API (Objekt aus Teilen + String) für den Phase-Start-Caller. */
export function generateStudyPlan(
  input: StudyPlanInput
): ReturnType<typeof generateStudyPlanContent> {
  return generateStudyPlanContent(input);
}
