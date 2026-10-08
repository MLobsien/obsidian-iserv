/**
 * Dashboard-Rendering (T7, ADR-0008) — obsidian-freies Modul (Seam-Split à la ADR-0007).
 * Stundenplan der ganzen Woche Mo–Fr als Tag-Spalten (CSS Grid, KEIN Doppelstunden-Merge),
 * Mails in Gänze (+ leerer server-seitiger Such-Hook), Review-Queue in voller Breite,
 * aktive Arbeiten mit Countdown.
 */
import {
  entryDecor,
  isoForWeekday,
  type RowDecor,
  type SidebarEntry,
  type SlotClock,
} from "./sidebar-logic";
import type { Substitution, TimetableSlot } from "../api/timetable";
import type { QueueItem } from "../review-queue/state";
import type { QueueBindOptions } from "../review-queue/queue-bind";
import type { Mail } from "../api/mails";
import { formatMailDate } from "./format-date";
import { SIDEBAR_PAGE_SIZE, renderBrowseButtons } from "./paginate";
import type { SidebarData, SidebarExam } from "./sidebar-render";
import { renderQueueSection } from "./sidebar-render";
import { computeStatus, type ExamStatus } from "../exams/exam-status";
import {
  renderCountdownPanel,
  type CountdownItem,
} from "./countdown";
import {
  renderNoticeCenter,
  type NoticeEntry,
} from "./notice-center";
import type { UntisRow } from "../api/untis";
import type { JsonFreeSlot } from "../api/timetable-json";
import { displayTeacherName } from "../api/timetable-json";
import { renderFilesBrowser, type FilesBrowserData } from "./files-browser";

export const VIEW_TYPE_ISERV_DASHBOARD = "iserv-dashboard-view";

/** Gleiches Daten-Contract wie die Sidebar, erweitert um Mail-Vollständigkeit + Hooks. */
export interface DashboardData extends Omit<
  SidebarData,
  "mails" | "unread" | "queue" | "exams"
> {
  entries: SidebarEntry[];
  slots: TimetableSlot[];
  substs: Substitution[];
  now: Date;
  mails?: Mail[];
  unread?: number;
  queue?: QueueItem[];
  exams?: SidebarExam[];
  /** Server-seitige Mail-Suche (ADR-0008): View liefert nur Hook, Filter passiert server-seitig. */
  mailSearchQuery?: string;
  onMailSearch?(q: string): void;
  /**
   * Aktuelle Mail-Seite (0-basiert, T9/T10-Pagination). State im ViewModel:
   * Liste kommt server-seitig gpaged (mails()/searchMails() mit limit/offset),
   * Blättern → refetch via onMailPage.
   */
  mailPage?: number;
  /** Mails pro server-seitiger Seite (Default: SIDEBAR_PAGE_SIZE = 10). */
  mailPageSize?: number;
  /** True, wenn server-seitig noch ältere Mails liegen (sonst Button disabled). */
  mailHasOlder?: boolean;
  /** Browse-Buttons (Ältere/Neuere Mails): Seite gewechselt → server-seitiger Refetch. */
  onMailPage?(page: number): void;
  /** Klick auf eine Mail-Zeile (ID-String, konsistent zur Sidebar). */
  mailRowClick?(id: string): void;
  /** Bind-Callbacks für Queue-Aktionen (behalten/verwerfen/unsicher/shared mit Sidebar). */
  queueActions?: QueueBindOptions;
  /** T21: Vollviewer-Preview (über T15-Tap/aus Desktop-FallbackButtons). */
  onPreview?(item: QueueItem): void;
  /** Badge-Klick im Countdown-Panel (T19, ADR-0006 F5: Status-Override). */
  onExamStatusChange?(examId: string, newStatus: ExamStatus): void;
  /**
   * Day-Pager (T26-Kritik: 5 Spalten passen nicht nebeneinander): angezeigter
   * Tag relativ zu heute (0 = heute, kann z. B. durch Wochenende/Feiertag leicht
   * versabt sein); State im ViewModel (DashboardView), Renderer ist zustandsfrei.
   */
  dayOffset?: number;
  /** Pager-Buttons: Offset geändert (ViewModel re-rendert ohne Refetch). */
  onOffsetChange?(offset: number): void;
  /** NoticeCenter-Panel (Issue #1 Abschnitt 1): gesetzt → Renderer hängt am Ende renderNoticeCenter an. */
  noticeCenter?: { recent(n: number): NoticeEntry[] };
  /**
   * Dateibrowser (Issue #11, nur Groups-Ordner): Listing des aktuellen cwd
   * (file/api/list/<pfad>, live 28.09.2026). `undefined` → Sektion entfällt
   * (Mobile/ADR-0009: Listing braucht Netz); State cwd liegt im ViewModel.
   */
  files?: FilesBrowserData;
  /**
   * Untis-HTML-Overlay (User 28.09.2026: „Untis HTML Stundenpläne sind die
   * einzig korrekten"): Vertretungs-Details (echter Vertreter, Art, Text) +
   * Tagesmeldungen aus dem Untis-Pläne-Modul. `undefined`/unvollständig →
   * renderer fällt best-effort auf substitutions/ zurück (fail-soft).
   */
  untis?: UntisOverlay;
  /**
   * Issue #7 (JSON-Primärquelle): ISO-Datum des gerenderten Tages, wenn er in
   * einer Vacation liegt (aus dem `vacations`-Array des current-timetable-
   * JSONs). Gesetzt → Sektion rendert Ferien-Hinweis statt Plan-Zeilen; die
   * Wochen-Vorlage des Endpoints trügt in Ferien (34 Entries) sonst.
   */
  vacationIso?: string;
  /**
   * Issue #8 R3: reguläre Freistunden des angezeigten Tages (jsonFreeSlots:
   * Slots ohne Entry zwischen 1 und letzter Unterrichts-Slot). `undefined` →
   * keine Freistunden-Zeilen (best-effort, fail-soft).
   */
  freeSlots?: JsonFreeSlot[];
}

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];

/**
 * Untis-Tag-Daten (aus src/api/untis.ts fetchUntisBothDays) — Dashboard-
 * Primärquelle für Vertretungs-Details. `null` → Fallback auf substitutions/
 * (ADR-0007 Cross-Check-Pfad, fail-soft).
 */
export interface UntisOverlay {
  /** Untis-mon_title-Form der geladenen Tage ("28.9.2026 Montag"). */
  todayDate?: string;
  tomorrowDate?: string;
  stand?: string;
  today?: UntisRow[];
  tomorrow?: UntisRow[];
  /** Tagesmeldungen f1 (z. B. "Abwesende Lehrer: Br, Bu", Hofdienst). */
  messages: string[];
  /** Meine Kurs-/Klassen-Tokens (12gN/12eN) für den Row-Filter. */
  classTokens: string[];
}

/**
 * Untis-Row → Dekor-Override für eine Plan-Zeile (same-day match via Slot).
 * Untis „12"-Zeilen betreffen die ganze Jahrgangskohorte (12gN/12eN);
 * Slots sind Untis-Stundennummern (= Slot-Nummern im Zeitraster).
 * Kein Match → null (Zeile bleibt mit substitutions/-Dekor).
 */
export function untisDecorForRow(
  row: UntisRow,
  entrySlot: number,
  tokens: string[]
):
  | { kind: "absence" | "substituted"; label: string; who: string; text: string }
  | null {
  const slots = row.slots ?? [];
  if (slots.length > 0 && !slots.includes(entrySlot)) return null;
  const art = (row.art ?? "").toLowerCase();
  // R2-Kritik (30.09.2026): Untis markiert Ausfälle mit „---" in Vertreter-
  // UND Fach-Spalte (live belegt: „5b, 8, ---, ---, ---, Entfall …"). Auch
  // ein „---"-Fach ist ein Entfall-Marker → nie als Fach rendern.
  const isAbsence =
    art.includes("entfall") ||
    (row.teacher ?? "").trim() === "---" ||
    (row.subject ?? "").trim() === "---";
  const who =
    isAbsence ? "" : (row.insteadOfTeacher || row.teacher || "").replace(/^---$/, "").trim();
  return {
    kind: isAbsence ? "absence" : "substituted",
    label: isAbsence ? "Entfall" : who ? `Vertretung: ${who}` : "Vertretung",
    who,
    text: row.text ?? "",
  };
}

/** Erste passende Untis-Zeile für einen Tag+Slot finden (best-effort). */
function findUntisRow(
  rows: UntisRow[] | undefined,
  entrySlot: number,
  tokens: string[]
): { row: UntisRow; decor: NonNullable<ReturnType<typeof untisDecorForRow>> } | null {
  if (!rows) return null;
  for (const row of rows) {
    // Klassen-Match: Row-Klassenstr („12", „12gN, 12eN") gegen meine Tokens.
    const k = row.klassen.toLowerCase();
    const parts = k.split(/[\s,]+/).filter(Boolean);
    const hit =
      tokens.length === 0 ||
      tokens.some((token) => {
        const t = token.toLowerCase();
        if (parts.includes(t)) return true;
        const jahrgang = t.replace(/[a-z]+$/i, "");
        return jahrgang && (parts.includes(jahrgang) || k === jahrgang);
      });
    if (!hit) continue;
    const decor = untisDecorForRow(row, entrySlot, tokens);
    if (decor) return { row, decor };
  }
  return null;
}

function humanDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
  });
}

/** Neue Card-Sektion mit Dashboard-Prefix-Klassen; Header/Sektion-Klassen der Sidebar wiederverwendet. */
function makeSection(
  container: HTMLElement,
  cls: string,
  title: string,
  opts?: { collapsedBody?: HTMLElement }
): { section: HTMLElement; body: HTMLElement } {
  const section = document.createElement("div");
  section.className = `iserv-section ${cls}`;

  const header = document.createElement("div");
  header.className = "iserv-section-header iserv-dashboard-section-header";
  header.setAttribute("role", "button");
  header.setAttribute("aria-expanded", "true");

  const label = document.createElement("span");
  label.className = "iserv-section-title";
  label.textContent = title;

  const chevron = document.createElement("span");
  chevron.className = "iserv-chevron";
  chevron.textContent = "▾";

  header.appendChild(label);
  header.appendChild(chevron);

  const body = document.createElement("div");
  body.className = "iserv-section-body";

  header.addEventListener("click", (ev) => {
    // Interaktive Kinder im Header (Mail-Suche-Input, Buttons) kollabieren die
    // Sektion nicht (User-Report: Suche klappte die Sektion ein).
    if ((ev.target as HTMLElement)?.closest("input, button, a, select, textarea")) {
      return;
    }
    const collapsed = section.classList.toggle("iserv-collapsed");
    header.setAttribute("aria-expanded", String(!collapsed));
    chevron.textContent = collapsed ? "▸" : "▾";
  });

  section.appendChild(header);
  if (opts?.collapsedBody) {
    header.appendChild(opts.collapsedBody);
  }
  section.appendChild(body);
  container.appendChild(section);
  return { section, body };
}

function emptyEl(): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "iserv-empty-text";
  empty.textContent = "Kein Unterricht";
  return empty;
}

/**
 * Eine Zeile pro Slot (KEIN Merge, ADR-0008): Sidebar-Decors wiederverwendet.
 * Issue #8 R2: `teacher` (strukturiertes TimetableTeacher-Objekt) optional —
 * Dashboard-Entries tragen den Lehrer für die Vorname-Nachname-Zeile.
 */
/**
 * Issue #13 (live 08.10.2026): NULL-Fach-Zeilen (courseSubject.subject =
 * null, die Untis-'-'-Zeilen) dürfen NIE als leere Fachzeile rendern.
 * Auflösung: sichtbares Fach/Lehrer/Kurs vom Partner-Entry desselben
 * weekday+slot (timetable-entries/Plan-Feed, kein NULL-Fach). Dann greift
 * der Dekor über entryDecor auf der Substitutions-Bridge
 * (jsonEntriesToSubstitutions trägt Fach/Slot/Kurs aus dem
 * originalTimeTableEntry, canceled → Entfall). Ohne Partner: "?"-Guard —
 * die Fachzelle bleibt nie leer.
 */
function emptySubjectPartner(
  entry: SidebarEntry,
  allEntries: SidebarEntry[]
): SidebarEntry | null {
  for (const o of allEntries) {
    if (o === entry) continue;
    if (o.weekday !== entry.weekday) continue;
    if (o.slot !== entry.slot) continue;
    if (!o.subject || !o.subject.trim()) continue;
    return o;
  }
  return null;
}

function renderSlotRow(
  entryArg: SidebarEntry,
  iso: string,
  substs: Substitution[],
  allEntries: SidebarEntry[],
  clock: SlotClock,
  untis?: { row: UntisRow; decor: { kind: "absence" | "substituted"; label: string; who: string; text: string } }
): HTMLElement {
  // Issue #13: NULL-Fach-Zeilen → sichtbares Fach vom Partner-Entry (oder
  // "?"-Guard). Der Dekor (entryDecor) matcht die Substitutions-Bridge über
  // courseName+hour (Fach/Slot aus originalTimeTableEntry).
  let entry = entryArg;
  if (!entry.subject || !entry.subject.trim()) {
    const partner = emptySubjectPartner(entryArg, allEntries);
    entry = partner ?? { ...entryArg, subject: "?", course: entryArg.course };
  }
  const decor: RowDecor = entryDecor(entry, iso, substs, allEntries, clock);
  const slotInfo = clock[entry.slot];

  // Untis-Overlay-Verdacht (User: „Untis HTML Stundenpläne sind die einzig
  // korrekten"): eigenes Dekor gewinnt; substitutions/-Dekor bleibt Fallback
  // wenn Untis den Tag/Slot nicht listet.
  const kind = untis?.decor.kind ?? (decor.kind === "normal" ? "normal" : decor.kind);
  const label = untis?.decor.label ?? null;
  const text = untis?.decor.text ?? "";

  const tr = document.createElement("tr");
  tr.className = `iserv-row iserv-${kind}`;
  tr.dataset.course = entry.course;

  const tdSlot = document.createElement("td");
  tdSlot.className = "iserv-slot";
  tdSlot.textContent = `${entry.slot}.`;

  const tdTime = document.createElement("td");
  tdTime.className = "iserv-time";
  tdTime.textContent = slotInfo ? `${slotInfo.start}–${slotInfo.end}` : "";

  const tdSubject = document.createElement("td");
  tdSubject.className = "iserv-subject";
  tdSubject.textContent =
    entry.subject + (untis && text ? ` · ${text}` : "");

  const tdRoom = document.createElement("td");
  tdRoom.className = "iserv-room";
  tdRoom.textContent = entry.room ?? "";

  // R2-Kritik (User 30.09.2026): der Lehrer braucht eine EIGENE SPALTE
  // (nicht nur Zeilen-Text unter dem Fach). Strukturierte forename/surname
  // aus den timetable-entries (live belegt), displayname-Fallback (Issue #8 R2).
  const teacherName = displayTeacherName(entry.teacher);
  const tdTeacher = document.createElement("td");
  tdTeacher.className = "iserv-teacher iserv-teacher-col";
  tdTeacher.textContent = teacherName;

  if (label) {
    tdSubject.textContent += ` · ${label}`;
    tr.setAttribute("title", text || label);
  } else if (untis) {
    // Untis-Zeile ohne Art/Text (e.L./Änderung wird über Art geliefert):
    // Raum/Vertreter aus Untis anzeigen, wenn die API-Rooms abweichen.
    if (untis.row.room && String(untis.row.room) !== (entry.room ?? "")) {
      tdRoom.textContent = String(untis.row.room);
      tdRoom.title = `Untis-Raum: ${untis.row.room}`;
    }
    if (untis.row.subject && untis.row.subject !== (entry.subject ?? "")) {
      tdSubject.textContent = `${untis.row.subject} · ${entry.subject}`;
      tdSubject.title = `Untis-Fach: ${untis.row.subject}`;
    }
    if (untis.decor.kind === "substituted" && untis.decor.who) {
      tdSubject.textContent += ` · Vtr. ${untis.decor.who}`;
    }
  } else if (decor.kind !== "normal") {
    const who = decor.subst.insteadOfTeacher?.displayname ?? "";
    const msg = decor.subst.displayMessageForStudents ?? "";
    tdSubject.textContent =
      entry.subject +
      (decor.kind === "absence"
        ? " · Entfall"
        : who
          ? ` · Vertretung: ${who}`
          : msg
            ? ` · ${msg}`
            : " · Vertretung");
    tr.setAttribute("title", msg || "");
  }

  tr.appendChild(tdSlot);
  tr.appendChild(tdTime);
  tr.appendChild(tdSubject);
  tr.appendChild(tdTeacher);
  tr.appendChild(tdRoom);
  return tr;
}

/**
 * Day-Pager statt 5-Spalten-Grid (T26 User-Kritik "zu breit, 5 Einträge passen
 * nicht nebeneinander"): EINE Tages-Spalte mit ‹ Zurück / Weiter ›-Buttons in
 * der Sektion-Titel-Zeile (Datum des angezeigten Tages). State (dayOffset) im
 * ViewModel — der Renderer selbst bleibt zustandsfrei.
 * Offset-Semantik: zählt Schultage (Wochenende wird übersprungen)), nicht
 * Kalendertage; beigezogen werden nur Mo–Fr-Daten (ADR-0008).
 */
function renderDayPager(
  container: HTMLElement,
  data: DashboardData,
  clock: SlotClock
): void {
  const offset = data.dayOffset ?? 0;
  const { weekday, iso } = pagerTarget(data.now, offset);
  // Ferien-Erkennung (Issue #7): wenn Vacation-Info vorliegt und den Tag
  // trifft, Ferien-Label statt Zeilen.
  const vacation = data.vacationIso === iso ? data.vacationIso : undefined;

  const section = document.createElement("div");
  section.className = "iserv-section iserv-timetable iserv-dashboard-timetable";

  const header = document.createElement("div");
  header.className = "iserv-section-header iserv-dashboard-section-header";

  const pager = document.createElement("div");
  pager.className = "iserv-dashboard-day-pager";

  const prev = document.createElement("button");
  prev.className = "iserv-dashboard-pager-btn iserv-dashboard-pager-prev";
  prev.textContent = "‹"; // Theme-Variable wird im CSS gesetzt (ADR-0008)
  prev.setAttribute("aria-label", "Vorheriger Schultag");
  prev.title = "Zurück";
  const next = document.createElement("button");
  next.className = "iserv-dashboard-pager-btn iserv-dashboard-pager-next";
  next.textContent = "›";
  next.setAttribute("aria-label", "Nächster Schultag");
  next.title = "Weiter";

  // Nav-Bugfix (User-Report "Einsperren über die Wochenend-Grenze"): ‹ war
  // bei weekday===0 (Montag) disabled — nach dem Weiterklicken über das
  // Wochenende (Fr→Mo) war die zurück-Navigation dauerhaft weg. Der Offset
  // ist jetzt ein echtes Datum (dateForOffset), jeder Schritt ist reversibel
  // (Mo ‹ = Fr der Vorwoche). Buttons bleiben DESHALB immer aktiv; Samstag/
  // Sonntag werden weiterhin übersprungen (Mo–Fr-Raster, ADR-0008).

  const label = document.createElement("span");
  label.className = "iserv-section-title";
  // User-Kritik Runde 4: Datum NICHT doppelt (Section-Label + Day-Header
  // zeigten beide das Datum, teils abweichend). Der Day-Header trägt das
  // Datum — das Section-Label bleibt statisch "Stundenplan".
  label.textContent = "Stundenplan";

  pager.appendChild(prev);
  pager.appendChild(label);
  pager.appendChild(next);

  prev.addEventListener("click", () => {
    data.onOffsetChange?.(offset - 1);
  });
  next.addEventListener("click", () => {
    data.onOffsetChange?.(offset + 1);
  });

  header.appendChild(pager);
  section.appendChild(header);

  const body = document.createElement("div");
  body.className = "iserv-section-body";
  section.appendChild(body);

  // Spike #19 Vertretungs-Reichweite: Untis liefert f1=heute, f2=nächsten
  // Schultag; Tage OHNE Vertretungsdaten zeigen einfach den Plan ohne
  // Subst-Markierung. Nur der eine angezeigte Tag wird gerendert.
  body.appendChild(
    renderDayColumn({
      weekday,
      iso,
      entries: data.entries.filter((e) => e.weekday === weekday),
      clock,
      substs: data.substs,
      now: data.now,
      vacationIso: data.vacationIso,
      freeSlots: data.freeSlots,
      // R2-Fix (30.09.2026): Untis-Overlay wurde hier NICHT durchgereicht —
      // alle Untis-Dekors (Entfall/Vertretung/„---"-Zeilen) griffen im echten
      // Dashboard nie (live-Beweis: Debug-Decor richtig, DOM iserv-normal).
      untis: data.untis,
    })
  );
  container.appendChild(section);
}

/**
 * Schultag-Offset (Mo–Fr) → JS-Weekday-Nummer: offset 0 = heute (auf Schultag
 * gerastet), 1 = nächster Schultag, −1 = voriger Schultag. Wochenenden werden
 * übersprungen (nur Mo–Fr, ADR-0008) — Offset zählt Schultage, nicht Kalendertage.
 */
export function dayForOffset(now: Date, offset: number): number {
  return pagerTarget(now, offset).weekday;
}

/**
 * Pager-Ziel: Schultag-Offset → { weekday, iso }.
 * DATUMSBASIERT (Nav-Bugfix): das Offset-Modell bildet jeden Offset auf genau
 * EIN Kalenderdatum ab (dateForOffset) statt nur den Weekday zu vergleichen.
 * Damit ist jeder prev/next-Schritt (±1 Schultag) exakt reversibel — auch über
 * die Wochenend-Grenze (Fr→Mo→Fr). Das alte weekday-only-Modell behandelte
 * jeden Montag gleich ("0 Schritte fortgeschritten", wenn heute Montag war)
 * und sperrte ‹ dauerhaft; das ist behoben.
 */
function pagerTarget(now: Date, offset: number): { weekday: number; iso: string } {
  const target = dateForOffset(now, offset);
  const weekday = (target.getDay() + 6) % 7; // ADR-0008-API-Weekday: 0=Mo … 4=Fr
  return { weekday, iso: toIso(target) };
}

/**
 * Offset (Schultage) → konkretes Kalenderdatum (immer Mo–Fr): offset 0 = heute
 * (auf Schultag gerastet), +1 = nächster Schultag, −2 = vorvoriger Schultag.
 * Wochenenden werden übersprungen — die Funktion gibt NIE Sa/So zurück.
 * Du und derselbe Offset ⇒ dasselbe Datum: jeder Navigationsschritt ist
 * reversibel (Bugfix: das alte weekday-only-Modell behandelte alle Montage
 * gleich und sperrte ‹).
 */
function dateForOffset(now: Date, offset: number): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const isWeekend = (x: Date) => x.getDay() === 0 || x.getDay() === 6;
  // Basis auf Schultag rasten: Sa/So rasten NACH VORN auf Montag (der
  // am nächsten liegende Schultag). An Wochenenden zeigt Offset 0 den
  // kommenden Montag, ‹ den vorigen Freitag.
  while (isWeekend(d)) {
    d.setDate(d.getDate() + 1);
  }
  // Von der gerasteten Basis aus datumsexakt zählen: jeder Schritt bewegt
  // das Datum um einen Schultag (Wochenende automatisch übersprungen).
  const step = offset >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(offset); i++) {
    do {
      d.setDate(d.getDate() + step);
    } while (isWeekend(d));
  }
  return d;
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Dezente Freistunden-Zeile (Issue #8 R3): Slot + Zeit + „Freistunde“-Text,
 * keine Fach-/Raum-Zellen-Inhalte (kein Phantom-Fach, ADR-0007-Konvention).
 */
function renderFreeRow(free: JsonFreeSlot, clock: SlotClock): HTMLElement {
  const tr = document.createElement("tr");
  tr.className = "iserv-row iserv-free";
  tr.dataset.slot = String(free.slot);

  const tdSlot = document.createElement("td");
  tdSlot.className = "iserv-slot";
  tdSlot.textContent = `${free.slot}.`;

  const tdTime = document.createElement("td");
  tdTime.className = "iserv-time";
  const slotInfo = clock[free.slot];
  tdTime.textContent = slotInfo ? `${slotInfo.start}–${slotInfo.end}` : "";

  const tdSubject = document.createElement("td");
  tdSubject.className = "iserv-subject iserv-free-subject";
  tdSubject.textContent = "Freistunde";

  const tdTeacher = document.createElement("td");
  tdTeacher.className = "iserv-teacher iserv-teacher-col";

  const tdRoom = document.createElement("td");
  tdRoom.className = "iserv-room";

  tr.appendChild(tdSlot);
  tr.appendChild(tdTime);
  tr.appendChild(tdSubject);
  tr.appendChild(tdTeacher);
  tr.appendChild(tdRoom);
  return tr;
}

function renderDayColumn(ctx: {
  weekday: number;
  /** Echtes Datum des Pager-Ziel-Tags (pagerTarget.iso) — NICHT aus dem
   *  Weekday + heutiger Woche ableiten (Bugfix: Pager zeigte immer das Datum
   *  der aktuellen Woche, z.B. nach Fr 02. wieder 28. statt 05.). */
  iso: string;
  entries: SidebarEntry[];
  clock: SlotClock;
  substs: Substitution[];
  now: Date;
  /** Untis-Overlay-Daten + die Klassen-Tokens (best-effort, optional). */
  untis?: UntisOverlay;
  /** Issue #7: Vacation-ISO (wenn Ferien); setzt Ferien-Label statt Zeilen. */
  vacationIso?: string;
  /** Issue #8 R3: Freistunden des Tags (jsonFreeSlots). */
  freeSlots?: JsonFreeSlot[];
}): HTMLElement {
  const col = document.createElement("div");
  col.className = "iserv-dashboard-day";
  col.dataset.weekday = String(ctx.weekday);

  const iso = ctx.iso;
  const head = document.createElement("div");
  head.className = "iserv-dashboard-day-header";
  // Eindeutiges Datum (Tag + Monat): nur '28.' mehrdeutete Monatsgrenzen.
  const human = new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
  });

  const headLabel = document.createElement("span");
  headLabel.textContent = `${WEEKDAYS[ctx.weekday]}, ${human}`;
  head.appendChild(headLabel);
  // R2 (User 30.09.2026): Quelle ist EXKLUSIV personalisiertes IServ JSON —
  // das school-wide „Untis Stand"-Badge ist entfernt (führte zur User-Kritik
  // 'stundenplan benutzt Untis' + Fremd-Entfälle).
  col.appendChild(head);

  if (ctx.vacationIso === ctx.iso) {
    col.classList.add("iserv-dashboard-day-vacation");
    const v = document.createElement("div");
    v.className = "iserv-empty-text iserv-dashboard-vacation";
    v.textContent = "Ferien / freier Tag";
    col.appendChild(v);
    return col;
  }

  if (ctx.entries.length === 0) {
    col.classList.add("iserv-dashboard-day-empty");
    col.appendChild(emptyEl());
    return col;
  }

  const tokens = ctx.untis?.classTokens ?? [];
  const table = document.createElement("table");
  table.className = "iserv-timetable-table iserv-dashboard-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  // R2-Kritik (30.09.2026): eigene Lehrer-Spalte → auch im Kopf ausweisen.
  for (const h of ["Stunde", "Zeit", "Fach", "Lehrer", "Raum"]) {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  // Issue #8 R3: Freistunden als dezente Zeilen IN Slot-Reihenfolge einweben
  // (Merges nicht brechen: normale Unterrichtszeilen bleiben unverändert).
  // Entries und Frees sind per Konstruktion disjunkt (free = Slot OHNE Entry).
  const frees = (ctx.freeSlots ?? [])
    .filter((f) => f.weekday === ctx.weekday && f.slot > 0)
    .sort((a, b) => a.slot - b.slot);

  // Chronologisch: Slot aufsteigend (User-Report: Reihenfolge war durcheinander).
  const sorted = [...ctx.entries].sort((a, b) => a.slot - b.slot);
  let freeIdx = 0;
  for (const entry of sorted) {
    while (freeIdx < frees.length && frees[freeIdx].slot < entry.slot) {
      tbody.appendChild(renderFreeRow(frees[freeIdx], ctx.clock));
      freeIdx++;
    }
    const hit = ctx.untis
      ? findUntisRow(
          isUntisRowsForIso(ctx.untis, iso, ctx.now),
          entry.slot,
          tokens
        )
      : null;
    tbody.appendChild(
      renderSlotRow(entry, iso, ctx.substs, ctx.entries, ctx.clock, hit ?? undefined)
    );
  }
  // Freistunden nach der letzten geplanten Stunde (z. B. Slot 7 nach 6.).
  while (freeIdx < frees.length) {
    tbody.appendChild(renderFreeRow(frees[freeIdx], ctx.clock));
    freeIdx++;
  }
  table.appendChild(tbody);
  col.appendChild(table);
  return col;
}

/**
 * Untis-Rows für ein konkretes ISO-Datum auswählen: f1 = heute, f2 = morgen
 * (Reichweite live verifiziert — Untis-Modul stellt genau diese zwei Tage).
 * Nicht-heute/morgen (Pager weit weg) → keine Untis-Rows.
 */
function isUntisRowsForIso(
  overlay: UntisOverlay,
  iso: string,
  now: Date
): UntisRow[] | undefined {
  const todayIso = toIso(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  // Wochenende überspringen (morgen = nächster Schultag) — Untis f2 deckt das ab.
  while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  const tomorrowIso = toIso(tomorrow);
  if (iso === todayIso) return overlay.today;
  if (iso === tomorrowIso) return overlay.tomorrow;
  return undefined;
}

/**
 * Mails in Gänze + Ungelesen-Badge. Such-Hook: nur Input+Listener, KEIN Client-Filter (ADR-0008).
 * Spike #19 (live verifiziert): Suche läuft server-seitig über
 * GET /iserv/mail/api/v2/account/<email>/message?q=<text>&query_search_fields[]=from|to|body|subject
 * (&flag[seen]=false&limit&offset&sort=date&order=desc; attachment→422).
 * Der Koordinator wired onMailSearch → searchMails(client, email, q) — NICHT Client-Filter:
 * Dieses Modul ruft nur den Callback auf und rendert die Antwort-Liste.
 * T9/T10-Pagination: die Liste kommt bereits server-seitig gpaged (ViewModel-Seite
 * → limit/offset in mails()/searchMails(), q= bleibt unverändert). Blättern läuft
 * über Browse-Buttons (Ältere/Neuere Mails) → onMailPage → refetch durch den
 * Koordinator; State (mailPage) liegt im ViewModel.
 */
function renderMailsSection(
  container: HTMLElement,
  data: DashboardData,
  mails: Mail[],
  unread: number
): void {
  const search = data.onMailSearch
    ? (() => {
        const input = document.createElement("input");
        input.className = "iserv-dashboard-mail-search";
        input.type = "search";
        input.placeholder = "Mails durchsuchen (timeline à la Server-Suche)";
        input.value = data.mailSearchQuery ?? "";
        // Debounce (Runde 4: Refetch-Flut pro Keystroke fühlte sich wie
        // "fetching loop" an): 300ms nach letzter Taste suchen.
        let searchTimer: ReturnType<typeof setTimeout> | undefined;
        input.addEventListener("input", () => {
          if (searchTimer) clearTimeout(searchTimer);
          const q = input.value;
          searchTimer = setTimeout(() => {
            data.onMailSearch?.(q);
          }, 300);
        });
        return input;
      })()
    : null;

  const { section, body } = makeSection(
    container,
    "iserv-dashboard-mails",
    `Mails (${mails.length.toString()})`,
    search ? { collapsedBody: search } : undefined
  );

  // Issue #6 (User, Runde 3): String-Badge entfällt — Ungelesen-Markierung
  // passiert pro Zeile via iserv-mail-unread (Fett bleibt, Zeilen-Hilite
  // über Obsidian-CSS-Variablen).

  // T9/T10-Pagination: Liste ist bereits server-seitig gpaged — hier komplett rendern.
  const page = data.mailPage ?? 0;

  for (const mail of mails) {
    const row = document.createElement("div");
    row.className = "iserv-mail-row iserv-dashboard-mail-row";
    row.dataset.id = String(mail.id);
    if (mail.unread ?? mail.flags?.includes("\\Seen") === false) {
      row.classList.add("iserv-dashboard-mail-unread");
      // R6-UI-Review (worker): fett NUR für Ungelesene (Befund B) — generische
      // Klasse, damit die Sidebar denselben Kontrast nutzen kann.
      row.classList.add("iserv-mail-unread");
    }
    if (data.mailRowClick) {
      row.addEventListener("click", () => data.mailRowClick?.(String(mail.id)));
    }

    const subj = document.createElement("span");
    subj.className = "iserv-mail-subject";
    subj.textContent = mail.subject;

    const from = document.createElement("span");
    from.className = "iserv-mail-from";
    from.textContent = mail.from;

    const date = document.createElement("span");
    date.className = "iserv-dashboard-mail-date";
    date.textContent = formatMailDate(mail.date);

    // Spike #20 (offen): Alle /body-Endpoint-Varianten 404en — Mail-Reader-Modal
    // zeigt vorerst nur subject/from/date/snippet, keinen inline Body hier.

    row.appendChild(subj);
    row.appendChild(from);
    row.appendChild(date);
    body.appendChild(row);
  }

  // Browse-Buttons (‹ Ältere Mails / Neuere Mails ›): onMailPage → server-seitiger
  // Refetch (limit/offset) durch den Koordinator, dann wieder renderDashboard.
  const pageSize = Math.max(1, Math.floor(data.mailPageSize ?? SIDEBAR_PAGE_SIZE));
  if (mails.length > 0 || page > 0) {
    const paginated = document.createElement("div");
    paginated.className = "iserv-mail-pagination iserv-dashboard-mail-pagination";
    renderBrowseButtons(paginated, {
      page,
      hasOlder: data.mailHasOlder ?? mails.length >= pageSize,
      hasNewer: page > 0,
      onPage: (p) => {
        data.mailPage = p;
        data.onMailPage?.(p);
      },
    });
    body.appendChild(paginated);
  }
}

/** Aktive Arbeiten (nur laufende Vorbereitungen, ADR-0008/0006) mit Countdown. */
function renderExamsSection(
  container: HTMLElement,
  exams: SidebarExam[]
): void {
  if (exams.length === 0) return;

  const { body } = makeSection(
    container,
    "iserv-dashboard-exams",
    "Arbeiten"
  );

  for (const exam of exams) {
    const row = document.createElement("div");
    row.className = "iserv-exam-row iserv-dashboard-exam-row";
    row.dataset.days = String(exam.daysLeft);

    const label = document.createElement("span");
    label.className = "iserv-exam-title";
    label.textContent = exam.title;

    const days = document.createElement("span");
    days.className = "iserv-exam-days iserv-dashboard-exam-days";
    days.textContent =
      exam.daysLeft <= 0 ? "heute" : `in ${exam.daysLeft} Tag${exam.daysLeft === 1 ? "" : "en"}`;

    row.appendChild(label);
    row.appendChild(days);
    body.appendChild(row);
  }
}

/**
 * Countdown-Panel (T19, ADR-0006): unterhalb der Arbeiten-Sektion, gleiche
 * exams-Datenquelle. Status per computeStatus (Termin − Fenster, prepWindow),
 * Badge-Klick = Cycle → onStatusChange Callback (Override ADR-0006 F5).
 */
function renderCountdownSection(
  container: HTMLElement,
  exams: SidebarExam[],
  now: Date,
  onStatusChange?: (examId: string, newStatus: ExamStatus) => void
): void {
  const items: CountdownItem[] = [];
  for (const exam of exams) {
    // Ohne Termin (legacy?) keine Countdown-Zeile; id fällt auf Titel zurück.
    if (!exam.date) continue;
    items.push({
      id: exam.id ?? exam.title,
      title: exam.title,
      type: exam.type,
      date: exam.date,
      points: exam.points,
      status: exam.status,
    });
  }
  if (items.length === 0) return;
  renderCountdownPanel(container, items, { onStatusChange });
}

/** Dashboard-Daten rein, DOM raus — testbar ohne Obsidian. */
export function renderDashboard(
  container: HTMLElement,
  data: DashboardData
): void {
  container.empty?.();
  container.replaceChildren();
  container.classList?.add("iserv-dashboard");

  const clock: SlotClock = {};
  for (const s of data.slots) {
    clock[s.number] = { start: s.startTime, end: s.endTime };
  }

  renderDayPager(container, data, clock);
  if (data.mails) {
    // Ohne Mail-Daten (undefined) entfällt die Sektion; leere Liste zeigt Leerzustand.
    renderMailsSection(container, data, data.mails, data.unread ?? 0);
  }
  // 28.09.2026 („Dashboard-Review-Queue vereinheitlichen"): GENAU die Queue-
  // Section der Sidebar (renderQueueSection aus sidebar-render.ts) — gleiche
  // Rows (neu/unsure), gleiche Summenzeile (R6-queue-sum), Zeile-Klick =
  // Preview, Desktop-Buttons via bindQueueRows/queueActions aus main.ts.
  // Kein eigenes Spiegel-DOM mehr (leer/funktionslos: Behalten/Verwerfen/
  // Überspringen-Pills + 🗎-Button-Konzept entfernt).
  renderQueueSection(container, data.queue ?? [], data.queueActions, data.onPreview);
  renderExamsSection(container, data.exams ?? []);
  renderCountdownSection(
    container,
    data.exams ?? [],
    data.now,
    data.onExamStatusChange
  );

  if (data.files) {
    const filesSection = makeSection(
      container,
      "iserv-dashboard-files",
      "Dateien (Gruppen)"
    );
    renderFilesBrowser(filesSection.body, data.files);
  }

  if (data.noticeCenter) {
    renderNoticeCenter(container, data.noticeCenter.recent(5));
  }
}
