/**
 * Konzept-NEU (Issue #12): der Review-Queue-Fach-Anker kommt aus dem
 * personalisierten IServ-JSON-Stundenplan (current-timetable, Issue #7) —
 * pro Fach im heutigen/morgigen Stundenplan die lueckenlose Fach-Dokumente-
 * Liste (nicht mehr nur die Frist-Dateien "neu").
 *
 * Pure Layer (Node-testbar): hier lebt NUR die Kursnamen-Extraktion aus den
 * JSON-Entries (JsonSubstitutionEntry). Fetch (fetchJsonDay) + Feed-Filter
 * (files-feed.ts) bleiben separate Layer. Vertretungs-/Entfall-Zeilen
 * (substitutionType) tragen das ECHTE Fach in originalTimeTableEntry — der
 * Kursordner eines entfallenen Stunden ist trotzdem relevant (Lehrer lädt
 * Material VOR der Stunde hoch).
 */
import type { JsonSubstitutionEntry } from "../api/timetable-json";
import { splitSubstitution } from "../api/timetable-json";

/**
 * Kursnamen (Files-Ordner-Anker, filesFolderNameForCourse) aller Entries
 * eines Tages-Plans — Reihenfolge = Server-Reihenfolge, Dedup via Set.
 * Selbst `sortiert` bleibt stabil: Set bewahrt den ersten Auftreten.
 */
export function coursesFromEntries(
  entries: JsonSubstitutionEntry[]
): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    const sub = splitSubstitution(e);
    // Original (Vertretung/Entfall) VOR dem — das Fach ist der Anker.
    const cs =
      sub && sub.original?.courseSubject
        ? sub.original.courseSubject
        : e.courseSubject;
    const name = cs?.course?.name;
    if (typeof name === "string" && name.trim() !== "") {
      out.add(name);
    }
  }
  return [...out];
}

/**
 * Union heutiger/morgiger Kursordner für den Review-Queue-Feed. `tomorrow`
 * fehlen darf (z. B. Fetch-Fehler) — best-effort: ein Tag ist genug Basis.
 * Reihenfolge: heute zuerst (relevantester Tag), dann morgen-neu.
 */
export function unionTodayTomorrow(
  today: string[],
  tomorrow?: string[]
): string[] {
  const set = new Set(today.filter(Boolean));
  for (const c of tomorrow ?? []) if (c) set.add(c);
  return [...set];
}

/** ISO-Datum von "morgen" (lokal, ohne DST-Falle — hinzu 1 Kalendertag). */
export function tomorrowIso(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO-Datum von "heute" (lokal). */
export function todayIso(now: Date = new Date()): string {
  const d = now;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
