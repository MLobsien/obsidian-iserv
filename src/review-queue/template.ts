export interface TemplateVars {
  subject?: string;
  course?: string;
  date?: string;
  time?: string;
  schoolyear?: string;
  teacher?: string;
  filename?: string;
}

export function resolveTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const lowerKey = key.toLowerCase() as keyof TemplateVars;
    return vars[lowerKey] ?? "";
  });
}

export function getDefaultTemplate(): string {
  return "{{SUBJECT}}/Material/{{SCHOOLYEAR}}";
}

export function calculateSchoolYear(date: Date): string {
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();

  if (month >= 7) {
    // August or later → new school year
    const yy = String(year).slice(-2);
    const yyNext = String(year + 1).slice(-2);
    return `${year}/${yyNext}`;
  } else {
    // Before August → old school year
    const yyPrev = String(year - 1).slice(-2);
    const yy = String(year).slice(-2);
    return `${year - 1}/${yy}`;
  }
}

export function sanitizePath(path: string): string {
  // Remove invalid filesystem characters
  let sanitized = path.replace(/[<>:"|?*\x00-\x1f]/g, "");
  // Collapse multiple slashes
  sanitized = sanitized.replace(/\/{2,}/g, "/");
  // Trim leading/trailing slashes
  sanitized = sanitized.replace(/^\/+|\/+$/g, "");
  return sanitized;
}

export function addCollisionSuffix(path: string, hash: string): string {
  const shortHash = hash.slice(0, 8);
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return `${path}(${shortHash})`;
  }
  const dir = path.slice(0, lastSlash);
  const file = path.slice(lastSlash + 1);
  return `${dir}/${file}(${shortHash})`;
}

/**
 * T3-Verkabelung (#18 Fund 6): Ziel-Pfad für eine abgelegte Datei aus der
 * Review-Queue — Fach-Vermutung (ADR-0001, subject-guess) + Template-Vars
 * inkl. SCHOOLYEAR + Kollisions-Suffix. Rein, kein Vault-Zugriff.
 */
import type { QueueItem } from "./state";
import { guessSubject } from "./subject-guess";
import { groupSegmentOf } from "./files-feed";

export interface QueueTargetContext {
  /** Vault-Fachordner-Namen (Reihenfolge = Template-Fallback). */
  vaultSubjects: string[];
  /** Ablage-Template ({{SUBJECT}}/Material/{{SCHOOLYEAR}} …). */
  template?: string;
  /** Datum fürs School-Year (Default: jetzt). */
  date?: Date;
  /** Original-Dateiname (inkl. Endung). */
  filename?: string;
}

export function buildQueueTargetPath(
  item: QueueItem,
  ctx: QueueTargetContext
): string {
  // Issue #7 (29.09.2026): Vermutungs-Kette um den RAW-Gruppenordner-Anker
  // erweitert (faktische Entscheidung: subject-Chain statt eigene target-
  // Ebene — der Kursname ist lt. filesFolderNameForCourse/herb f3e03fa
  // EXAKT der Files-Ordner unter Groups/, also der authentischste Bearer
  // der Fach-Vermutung; {{SUBJECT}} bleibt das Vault-Fach, nie der RAW-
  // Gruppenname). Reihenfolge: Queue-Fach (Feed) → Dateinamen-Match →
  // RAW-Gruppen-Segment-Match (Fächer außerhalb der Steuertabelle).
  const guessed =
    guessSubject(item.name ?? "", ctx.vaultSubjects) ??
    (item.path ? guessSubject(groupSegmentOf(item.path), ctx.vaultSubjects) : null);
  const subject = item.subject || guessed || "Allgemein";
  const vars: TemplateVars = {
    subject,
    schoolyear: calculateSchoolYear(ctx.date ?? new Date()),
    filename: ctx.filename ?? item.name,
  };
  const resolved = resolveTemplate(
    ctx.template ?? getDefaultTemplate(),
    vars
  );
  return sanitizePath(resolved);
}
