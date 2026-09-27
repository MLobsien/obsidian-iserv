/**
 * Lernplan-Note schreiben (T20, ADR-0006/0008) — obsidian-freies Modul
 * (Seam-Split wie pdf-viewer.ts): der Caller injiziert einen Vault-Adapter
 * (create/exists/modify), die Logik bleibt DOM-/Obsidian-pur und jsdom-testbar.
 *
 * Konvention: Note unter `Lernplan/<Fach>/<Termin>-<Titel>.md` (Frontmatter mit
 * exam/subject/due/status=geplant; ADR-0006 Phase-Design). Existiert die Note
 * schon, wird sie NICHT überschrieben (idempotent; Caller bekommt 'existing').
 */
import { generateStudyPlanContent, type StudyPlanInput } from "./study-plan";

/** Minimal-Vault-Adapter (ADR-0007 Seam): main.ts injiziert die Obsidian-API. */
export interface VaultNoteAdapter {
  /** true wenn eine Datei/Notiz unter dem Pfad existiert. */
  exists(path: string): boolean;
  /** Neue Notiz anlegen. */
  create(path: string, content: string): Promise<void>;
  /** Bestehende Notiz überschreiben (nur für Regenerate-Pfad). */
  modify(path: string, content: string): Promise<void>;
}

export interface StudyPlanNoteResult {
  path: string;
  /** 'created' = neu angelegt; 'existing' = bereits da, nicht angerührt. */
  status: "created" | "existing";
}

/** Lernplan-Pfad nach ADR-0006: Lernplan/<Fach>/<due>-<Titel>.md. */
export function studyPlanNotePath(input: StudyPlanInput): string {
  const safe = (s: string) => s.replace(/[/\\:]/g, "-").trim();
  return `Lernplan/${safe(input.subject)}/${input.examDate}-${safe(input.examTitle)}.md`;
}

/**
 * Lernplan-Note erzeugen (idempotent, no-overwrite) und den Markdown-Body
 * über generateStudyPlanContent() bauen. Return: Pfad + Status.
 */
export async function writeStudyPlanNote(
  vault: VaultNoteAdapter,
  input: StudyPlanInput,
): Promise<StudyPlanNoteResult> {
  const path = studyPlanNotePath(input);
  if (vault.exists(path)) {
    return { path, status: "existing" };
  }
  const content = generateStudyPlanContent(input);
  await vault.create(path, content);
  return { path, status: "created" };
}
