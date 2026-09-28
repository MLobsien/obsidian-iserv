/**
 * "Aktuell"-Compositor (Runde 6, User-Kritik 28.09.2026): die Sidebar-Sektion
 * "Aktuell" ist KEINE Mail-Liste mehr, sondern ein radikal gefilterter Strom
 * wirklich aktueller Dinge:
 *
 *   1) UNGELESENE Mails (gelesene fliegen raus; die volle, paginierte
 *      Mail-Liste bleibt im Mail-Bereich unverändert).
 *   2) Termingebundene ZUKÜNFTIGE Arbeiten (Termin nicht vorbei).
 *   3) Offene Aufgaben (Status "open" aus dem Runde-6-Exercise-Feed —
 *      fetchOpenExercises listet per Feed-Vertrag nur Nicht-Abgegebenes).
 *   4) Hausaufgaben: offene Aufgaben mit dueDate im Offset-Fenster ab JETZT
 *      (Default 1 Tag = "morgen", einstellbar via homeworkDueOffsetDays).
 *
 * Pure Functions (ADR-0007-Seam): kein DOM, kein Obsidian-Import — Node-testbar.
 * Settings-Key homeworkDueOffsetDays (Default 1) steuert das HW-Fenster.
 */
import type { Mail } from "../api/mails";
import type { SidebarExam } from "./sidebar-render";
import type {
  ExerciseCandidate,
  ExerciseItem,
} from "../review-queue/exercise-feed";

/** Options für den Compositor (obsidian-frei). */
export interface NotificationFilterOptions {
  /** HW-Fenster in Tagen ab jetzt (Default 1 → Frist im Rest von heute+morgen). */
  homeworkDueOffsetDays?: number;
  /** Test-/Determinismus-Seam: Jetzt-Zeit (sonst new Date()). */
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Der HW-Fenster-Endpunkt: now + offset Tage (Default 1 → morgen 23:59). */
export function homeworkDueWindowEnd(now: Date, offsetDays?: number): Date {
  const days =
    typeof offsetDays === "number" && Number.isFinite(offsetDays)
      ? Math.max(0, offsetDays)
      : 1;
  return new Date(now.getTime() + days * DAY_MS);
}

/**
 * UNGELESENE Mails rausfiltern: Mail.unread-Flag ODER kein
 * "\Seen"-Flag (Shape wie dashboard-render.ts). Gelesene erscheinen NUR noch
 * im Mail-Bereich mit Pagination — nicht mehr in "Aktuell".
 */
export function filterUnreadMails(mails: Mail[]): Mail[] {
  return mails.filter(
    (m) => (m.unread ?? m.flags?.includes("\\Seen") === false) === true
  );
}

/**
 * ZUKÜNFTIGE termingebundene Arbeiten: Termin liegt in der Zukunft
 * (+1h Puffer — eine laufende Klausur zählt nicht mehr als "aktuell").
 * SidebarExam trägt `date?: Date` (main.ts setzt es seit Runde 6).
 */
export function filterUpcomingExams(
  exams: SidebarExam[],
  now: Date
): SidebarExam[] {
  const cutoff = now.getTime() + HOUR_MS;
  return exams.filter(
    (e) =>
      e.date instanceof Date &&
      !Number.isNaN(e.date.getTime()) &&
      e.date.getTime() > cutoff
  );
}

/** IServ-Due-Formate: "10.09.2026", "10.09.2026 14:00", "... Uhr", ISO. */
const DE_DATE_RE =
  /\b[0-3]?\d\.[0-3]?\d\.\d{4}(?:\s+[0-2]?\d:[0-5]\d)?(?:\s+Uhr)?\b/;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b/;

/** De-Format ("10.09.2026 [14:00]") → Date; ohne Zeit = 23:59 (ganzer Tag). */
function parseDeDate(text: string): Date | null {
  const de = DE_DATE_RE.exec(text);
  if (!de) return null;
  const cleaned = de[0].replace(/\s+Uhr$/, "").trim();
  const m =
    /^([0-3]?\d)\.([0-3]?\d)\.(\d{4})(?:\s+([0-2]?\d):([0-5]\d))?$/.exec(
      cleaned
    );
  if (!m) return null;
  const hour = m[4] !== undefined ? Number(m[4]) : 23;
  const min = m[5] !== undefined ? Number(m[5]) : 59;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), hour, min);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** dueDate-Text aus IServ (de/ISO) → Date; unparsebar → null. */
export function dueDateToDate(text: string): Date | null {
  if (!text || typeof text !== "string") return null;
  const de = parseDeDate(text);
  if (de) return de;
  const iso = ISO_DATE_RE.exec(text);
  if (!iso) return null;
  let normalized = iso[0].replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += "T23:59:59";
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) normalized += ":00";
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Komplette Filter-View für die "Aktuell"-Sektion. */
export interface AktuellView {
  /** 1) Ungelesene Mails (ohne \Seen). */
  unreadMails: Mail[];
  /** 2) Zukünftige termingebundene Arbeiten. */
  upcomingExams: SidebarExam[];
  /** 3) Offene Aufgaben mit dueDate im Offset-Fenster (Hausaufgaben). */
  hwExercises: ExerciseCandidate[];
  /** 4) Offene Aufgaben außerhalb des Fensters / ohne parsebare Frist. */
  otherOpenExercises: ExerciseCandidate[];
}

/**
 * Der Compositor: ungelesene Mails + zukünftige Arbeiten + offene Aufgaben
 * → kompakte Four-Part-View für die "Aktuell"-Sektion. Rein funktional.
 */
export function composeAktuellItems(
  input: {
    mails?: Mail[];
    exams?: SidebarExam[];
    exercises?: ExerciseCandidate[];
  },
  opts: NotificationFilterOptions = {}
): AktuellView {
  const now = opts.now ?? new Date();
  const windowEnd = homeworkDueWindowEnd(now, opts.homeworkDueOffsetDays);
  const from = now.getTime();

  const hwExercises: ExerciseCandidate[] = [];
  const otherOpenExercises: ExerciseCandidate[] = [];
  for (const ex of input.exercises ?? []) {
    const due = ex.dueDate ? dueDateToDate(ex.dueDate) : null;
    if (due !== null && due.getTime() >= from && due.getTime() <= windowEnd.getTime()) {
      hwExercises.push(ex);
    } else {
      // Ohne parsebares dueDate bleibt die offene Aufgabe "sonstige offene
      // Aufgabe" (sichtbar, aber nicht als Hausaufgabe-Kandidat).
      otherOpenExercises.push(ex);
    }
  }

  return {
    unreadMails: filterUnreadMails(input.mails ?? []),
    upcomingExams: filterUpcomingExams(input.exams ?? [], now),
    hwExercises,
    otherOpenExercises,
  };
}

/** Sichtbare (nach dem Radikalfilter verbliebene) Aufgabe. */
export type VisibleExercise = ExerciseItem;
