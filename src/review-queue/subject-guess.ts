/**
 * Fach-Vermutung (ADR-0001 / CONTEXT.md): aus dem IServ-Kurs-/Gruppennamen
 * wird per norm-match ein Vorschlag auf einen Vault-Fachordner-Namen
 * berechnet — NUR ein Vorschlag, nie auto-apply (Review-Queue entscheidet).
 */

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
