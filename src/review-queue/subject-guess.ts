/**
 * Fach-Vermutung (ADR-0001 / CONTEXT.md): aus dem IServ-Kurs-/Gruppennamen
 * wird per norm-match ein Vorschlag auf einen Vault-Fachordner-Namen
 * berechnet — NUR ein Vorschlag, nie auto-apply (Review-Queue entscheidet).
 *
 * Runde 6 (User): bei `Groups/<Gruppe>/…` ist die GRUPPE der authentische
 * Fach-Anker — der Dateiname lügt oft. `subjectFromGroup(groupSegment)`
 * parst `O <Fach> <Stufe> <Kürzel>` über eine Steuertabelle; Datei-Regex
 * (guessSubject) bleibt Fallback, wenn keine Gruppe passt.
 */

/**
 * Steuertabelle Gruppen-Regex → Fach-Wort. Reihenfolge = Match-Priorität,
 * normiert (Umlaute aufgelöst), teils Präfixe (macht→mathe, lat→latein).
 */
export const GROUP_SUBJECT_TABLE: [RegExp, string][] = [
  [/^mathe|^make?r/, "Mathematik"],
  [/^latein/, "Latein"],
  [/^chemie|^bio/, "Chemie"],
  [/^englisch/, "Englisch"],
  [/^deutsch/, "Deutsch"],
  [/^physik/, "Physik"],
  [/^kunst/, "Kunst"],
  [/^politik|^sozial|^wirts/, "Politik"],
  [/^seminarfach|^seminar|^w-seminar/, "Seminarfach"],
  [/^sport/, "Sport"],
];

/**
 * Gruppen-Schema (User 28.09.: `O Mathe 12eN Kü`, `O Latein 12gN Sz`):
 * `O <Fachwort> <Klassenstufe (Ziffern + optional J/N-Suffix)> <Kürzel (2-3 Buchstaben)>`.
 * Capture-Gruppe 1 = Fachwort.
 */
export const GROUP_NAME_RE =
  /^O (.+?) (\d+[a-zA-Z0-9]*N?)(?: ([A-Za-zäöü]{2,3}))?$/;

/**
 * GRUPPEN-Segment (z. B. `O Mathe 12eN Kü`) → Fach. Priorität:
 * 1. manuelle Overrides (settings.queueGroupMap, exakter Group-Name);
 * 2. Gruppen-Regex + Steuertabelle (Fachwort normiert);
 * 3. Fallback normierter Gruppenname gegen die Tabelle (Schema-Varianten).
 * @returns Vault-Fach-Vorschlag oder null (kein Match).
 */
export function subjectFromGroup(
  groupSegment: string,
  overrides?: Record<string, string>
): string | null {
  const group = groupSegment.trim();
  if (!group) return null;
  const manual = overrides?.[group];
  if (manual !== undefined && manual !== "") return manual;
  const normGroup = normalizeName(group);
  if (!normGroup) return null;
  // Kontrolle: Gruppen-Regex EXTRAKTION
  const m = GROUP_NAME_RE.exec(group);
  const tableTargets = m ? [normalizeName(m[1]), normGroup] : [normGroup];
  for (const target of tableTargets) {
    for (const [re, subject] of GROUP_SUBJECT_TABLE) {
      if (re.test(target)) return subject;
    }
  }
  return null;
}

/** Lowercase, Umlaute auflösen, alle Nicht-Buchstaben (a-z nach Auflösung) raus. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");
}

const MIN_MATCH_CHARS = 3;

/**
 * Reine Funktion: Vault-Fach, das als Teilstring im normierten Kursnamen
 * vorkommt (oder umgekehrt, min. 3 Zeichen) — sonst null. Der Vorschlag
 * ist der Vault-Ordner-Name im Original-Spelling (nicht normiert).
 */
export function guessSubject(
  courseName: string,
  vaultSubjects: string[]
): string | null {
  const normCourse = normalizeName(courseName);
  if (!normCourse) return null;

  for (const subject of vaultSubjects) {
    const normSubject = normalizeName(subject);
    if (!normSubject) continue;
    const longEnough =
      normSubject.length >= MIN_MATCH_CHARS && normCourse.length >= MIN_MATCH_CHARS;
    if (!longEnough) continue;
    if (normSubject.includes(normCourse) || normCourse.includes(normSubject)) {
      return subject;
    }
  }
  return null;
}
