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
import type { SidebarData, SidebarExam } from "./sidebar-render";
import { computeStatus, type ExamStatus } from "../exams/exam-status";
import {
  renderCountdownPanel,
  type CountdownItem,
} from "./countdown";

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
  /** Klick auf eine Mail-Zeile (ID-String, konsistent zur Sidebar). */
  mailRowClick?(id: string): void;
  /** Bind-Callbacks für Queue-Aktionen (behalten/verwerfen/unsicher/shared mit Sidebar). */
  queueActions?: QueueBindOptions;
  /** Badge-Klick im Countdown-Panel (T19, ADR-0006 F5: Status-Override). */
  onExamStatusChange?(examId: string, newStatus: ExamStatus): void;
}

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];

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

  header.addEventListener("click", () => {
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

/** Eine Zeile pro Slot (KEIN Merge, ADR-0008): Sidebar-Decors wiederverwendet. */
function renderSlotRow(
  entry: SidebarEntry,
  iso: string,
  substs: Substitution[],
  allEntries: SidebarEntry[],
  clock: SlotClock
): HTMLElement {
  const decor: RowDecor = entryDecor(entry, iso, substs, allEntries, clock);
  const slotInfo = clock[entry.slot];

  const tr = document.createElement("tr");
  tr.className = `iserv-row iserv-${decor.kind}`;
  tr.dataset.course = entry.course;

  const tdSlot = document.createElement("td");
  tdSlot.className = "iserv-slot";
  tdSlot.textContent = `${entry.slot}.`;

  const tdTime = document.createElement("td");
  tdTime.className = "iserv-time";
  tdTime.textContent = slotInfo ? `${slotInfo.start}–${slotInfo.end}` : "";

  const tdSubject = document.createElement("td");
  tdSubject.className = "iserv-subject";
  tdSubject.textContent = entry.subject;

  const tdRoom = document.createElement("td");
  tdRoom.className = "iserv-room";
  tdRoom.textContent = entry.room ?? "";

  if (decor.kind !== "normal") {
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
  tr.appendChild(tdRoom);
  return tr;
}

/** Stundenplan-Card: ganze Woche Mo-Fr als Tag-Spalten (CSS Grid, responsive). */
function renderWeekTimetableSection(
  container: HTMLElement,
  data: DashboardData,
  clock: SlotClock
): void {
  const section = document.createElement("div");
  section.className = "iserv-section iserv-timetable iserv-dashboard-timetable";

  const header = document.createElement("div");
  header.className = "iserv-section-header iserv-dashboard-section-header";
  const label = document.createElement("span");
  label.className = "iserv-section-title";
  label.textContent = "Stundenplan";
  header.appendChild(label);
  section.appendChild(header);

  const body = document.createElement("div");
  body.className = "iserv-section-body";
  section.appendChild(body);

  const grid = document.createElement("div");
  grid.className = "iserv-dashboard-grid";
  for (let weekday = 0; weekday <= 4; weekday++) {
    // Spike #19 Vertretungs-Reichweite: Untis liefert f1=heute, f2=nächsten Schultag
    // (Wochenende übersprungen); subst_00x+ sind leere Placeholder-Frames.
    // Tage OHNE Vertretungsdaten zeigen einfach den Plan ohne Subst-Markierung
    // (entryDecor matched die nur für verfügbar gültige Tage).
    grid.appendChild(
      renderDayColumn({
        weekday,
        entries: data.entries.filter((e) => e.weekday === weekday),
        clock,
        substs: data.substs,
        now: data.now,
      })
    );
  }
  body.appendChild(grid);
  container.appendChild(section);
}

function renderDayColumn(ctx: {
  weekday: number;
  entries: SidebarEntry[];
  clock: SlotClock;
  substs: Substitution[];
  now: Date;
}): HTMLElement {
  const col = document.createElement("div");
  col.className = "iserv-dashboard-day";
  col.dataset.weekday = String(ctx.weekday);

  const iso = isoForWeekday(ctx.now, ctx.weekday);
  const head = document.createElement("div");
  head.className = "iserv-dashboard-day-header";
  head.textContent = `${WEEKDAYS[ctx.weekday]}, ${iso.slice(8, 10)}.`;
  col.appendChild(head);

  if (ctx.entries.length === 0) {
    col.classList.add("iserv-dashboard-day-empty");
    col.appendChild(emptyEl());
    return col;
  }

  const table = document.createElement("table");
  table.className = "iserv-timetable-table iserv-dashboard-table";
  const tbody = document.createElement("tbody");
  // Chronologisch: Slot aufsteigend (User-Report: Reihenfolge war durcheinander).
  const sorted = [...ctx.entries].sort((a, b) => a.slot - b.slot);
  for (const entry of sorted) {
    tbody.appendChild(
      renderSlotRow(entry, iso, ctx.substs, ctx.entries, ctx.clock)
    );
  }
  table.appendChild(tbody);
  col.appendChild(table);
  return col;
}

/**
 * Mails in Gänze + Ungelesen-Badge. Such-Hook: nur Input+Listener, KEIN Client-Filter (ADR-0008).
 * Spike #19 (live verifiziert): Suche läuft server-seitig über
 * GET /iserv/mail/api/v2/account/<email>/message?q=<text>&query_search_fields[]=from|to|body|subject
 * (&flag[seen]=false&limit&offset&sort=date&order=desc; attachment→422).
 * Der Koordinator wired onMailSearch → searchMails(client, email, q) — NICHT Client-Filter:
 * Dieses Modul ruft nur den Callback auf und rendert die Antwort-Liste.
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
        input.addEventListener("input", () => {
          data.onMailSearch?.(input.value);
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

  if (unread > 0) {
    const badge = document.createElement("div");
    badge.className = "iserv-unread-badge iserv-dashboard-unread-badge";
    badge.textContent = `${unread} ungelesen`;
    body.appendChild(badge);
  }

  for (const mail of mails) {
    const row = document.createElement("div");
    row.className = "iserv-mail-row iserv-dashboard-mail-row";
    row.dataset.id = String(mail.id);
    if (mail.unread ?? mail.flags?.includes("\\Seen") === false) {
      row.classList.add("iserv-dashboard-mail-unread");
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
}

/** Review-Queue gespiegelt zur Sidebar, volle Breite. */
function renderQueueSection(
  container: HTMLElement,
  queue: QueueItem[],
  actions?: QueueBindOptions
): void {
  const items = [...queue].reverse(); // neueste zuerst (wie Sidebar)
  if (items.length === 0) return;

  const { body } = makeSection(
    container,
    "iserv-queue iserv-dashboard-queue",
    `Review-Queue (${items.length})`
  );

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "iserv-queue-row iserv-dashboard-queue-row";
    row.dataset.id = item.id;

    const icon = document.createElement("span");
    icon.className = "iserv-queue-icon";
    icon.textContent = "📄";

    const name = document.createElement("span");
    name.className = "iserv-queue-name";
    name.textContent = item.name;

    const subject = document.createElement("span");
    subject.className = "iserv-queue-subject";
    subject.textContent = item.subject;

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(subject);

    if (item.status !== "neu") {
      const badge = document.createElement("span");
      badge.className = `iserv-queue-status iserv-queue-${item.status}`;
      badge.textContent = item.status;
      row.appendChild(badge);
    } else if (actions) {
      const actionsEl = document.createElement("span");
      actionsEl.className = "iserv-dashboard-queue-actions";
      const bind = (
        label: string,
        cls: string,
        fn?: (item: QueueItem) => void
      ) => {
        const btn = document.createElement("button");
        btn.className = `iserv-dashboard-queue-action ${cls}`;
        btn.textContent = label;
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          fn?.(item);
        });
        actionsEl.appendChild(btn);
      };
      bind("Überspringen", "iserv-dashboard-queue-unsure", actions?.onUnsure && ((item) => actions.onUnsure!(item.id)));
      bind("Verwerfen", "iserv-dashboard-queue-discard", actions?.onDiscard && ((item) => actions.onDiscard!(item.id)));
      bind("Behalten", "iserv-dashboard-queue-keep", actions?.onKeep && ((item) => actions.onKeep!(item.id)));
      row.appendChild(actionsEl);
    }

    body.appendChild(row);
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

  renderWeekTimetableSection(container, data, clock);
  if (data.mails) {
    // Ohne Mail-Daten (undefined) entfällt die Sektion; leere Liste zeigt Leerzustand.
    renderMailsSection(container, data, data.mails, data.unread ?? 0);
  }
  renderQueueSection(container, data.queue ?? [], data.queueActions);
  renderExamsSection(container, data.exams ?? []);
  renderCountdownSection(
    container,
    data.exams ?? [],
    data.now,
    data.onExamStatusChange
  );
}
