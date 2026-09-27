/**
 * Sidebar-Rendering (T6, ADR-0008) — obsidian-freies Modul (Seam-Split à la ADR-0007).
 * Stundenplan als echte Tabelle, Review-Queue als kompakte Zeilen-Cards,
 * Benachrichtigungen (Mails + Ungelesen + aktive Arbeiten), einklappbare Sektionen.
 */
import {
  mergeDoubleSlots,
  sidebarDay,
  entryDecor,
  slotLabel,
  timeLabel,
  isoForWeekday,
  type MergedRow,
  type RowDecor,
  type SidebarEntry,
  type SlotClock,
} from "./sidebar-logic";
import type { Substitution, TimetableSlot } from "../api/timetable";
import type { QueueItem } from "../review-queue/state";
import {
  bindQueueRows,
  type QueueBindOptions,
} from "../review-queue/queue-bind";
import type { Mail } from "../api/mails";
import { MAIL_PAGE_SIZE, SIDEBAR_PAGE_SIZE, renderBrowseButtons } from "./paginate";
import { classifyQueueItem } from "../review-queue/pdf-preview";

export const VIEW_TYPE_ISERV_SIDEBAR = "iserv-sidebar-view";

/** Aktive Arbeit (aus Vault-Frontmatter, ADR-0006) — nur laufende Vorbereitungen. */
export interface SidebarExam {
  title: string;
  daysLeft: number;
  /** Countdown-Panel (T19): id + Termin nötig für Status + Badge-Cycle. */
  id?: string;
  date?: Date;
  type?: import("../exams/template").ExamType;
  points?: number;
  /** Importierter Status (Frontmatter-override, ADR-0006 F5). */
  status?: string;
}
export interface SidebarData {
  entries: SidebarEntry[];
  slots: TimetableSlot[];
  substs: Substitution[];
  now: Date;
  mails?: Mail[];
  unread?: number;
  queue?: QueueItem[];
  /** Wenn gesetzt: bindet Swipe/Buttons an die Queue-Zeilen (ADR-0008). */
  queueActions?: QueueBindOptions;
  /** Klick auf den Preview-Button einer PDF-Queue-Zeile (T15). */
  onPreview?: (item: QueueItem) => void;
  /** Klick auf eine Mail-Zeile (Übergabe der Mail-ID als string). */
  mailRowClick?: (id: string) => void;
  /**
   * Aktuelle Mail-Seite (0-basiert, T9/T10-Pagination). State im ViewModel:
   * die Liste selbst kommt bereits server-seitig gpaged aus main.ts
   * (mails() mit limit/offset, "Ältere Mails browsen" → refetch via onMailPage).
   */
  mailPage?: number;
  /** Mails pro server-seitiger Seite (Default: SIDEBAR_PAGE_SIZE = 10). */
  mailPageSize?: number;
  /** True, wenn server-seitig noch ältere Mails liegen (sonst Button disabled). */
  mailHasOlder?: boolean;
  /** Blättern (Ältere/Neuere) → ViewModel-Seite wechseln + refetch/re-render. */
  onMailPage?(page: number): void;
  /** Klick auf den dezenten Sync-Button im Header (T3/T4: → plugin.syncNow()). */
  onSyncClick?: () => void;
  exams?: SidebarExam[];
}

/** Alle Daten rein, DOM raus — testbar ohne Obsidian. */
export function renderSidebarSections(
  container: HTMLElement,
  data: SidebarData
): void {
  container.empty?.();
  container.replaceChildren();
  container.classList?.add("iserv-sidebar");

  renderHeaderRow(container, data.onSyncClick);

  const clock: SlotClock = {};
  for (const s of data.slots) {
    clock[s.number] = { start: s.startTime, end: s.endTime };
  }

  const nowApiWd = (data.now.getDay() + 6) % 7;
  const day = sidebarDay(data.now, clock, data.entries);

  // ADR-0008: Wochenende/feiertag → gar keine Stundenplan-Sektion.
  if (day <= 4) {
    const dayEntries = data.entries.filter((e) => e.weekday === day);
    renderTimetableSection(container, {
      day,
      isTomorrow: day !== nowApiWd,
      entries: dayEntries,
      clock,
      substs: data.substs,
      now: data.now,
    });
  }

  renderQueueSection(container, data.queue ?? [], data.queueActions, data.onPreview);
  renderNotificationsSection(container, {
    mails: data.mails ?? [],
    unread: data.unread ?? 0,
    exams: data.exams ?? [],
    onMailRowClick: data.mailRowClick,
    mailPage: data.mailPage,
    mailPageSize: data.mailPageSize,
    mailHasOlder: data.mailHasOlder,
    // Server-seitiges Blättern: Seite im ViewModel merken und den View neu
    // befüllen (refetch via onMailPage-Callback des Koordinators).
    onMailPage: (page) => {
      data.mailPage = page;
      data.onMailPage?.(page);
    },
  });
}

/**
 * Header-Zeile über allen Sektionen (T3/T4): dezenter Sync-Button rechts.
 * data-icon = Lucide-Icon-Name ("refresh-cw") — der Obsidian-View-Shells
 * (SidebarView) lösen das via setIcon auf; im Test bleibt der Marker stehen.
 */
function renderHeaderRow(
  container: HTMLElement,
  onSyncClick?: () => void
): void {
  const row = document.createElement("div");
  row.className = "iserv-header-row";
  const spacer = document.createElement("span");
  spacer.className = "iserv-header-spacer";
  row.appendChild(spacer);
  if (onSyncClick) {
    const btn = document.createElement("button");
    btn.className = "iserv-sync-btn";
    btn.type = "button";
    btn.dataset.icon = "refresh-cw";
    btn.setAttribute("aria-label", "IServ: Jetzt synchronisieren");
    btn.setAttribute("title", "IServ: Jetzt synchronisieren");
    btn.addEventListener("click", () => onSyncClick());
    row.appendChild(btn);
  }
  container.appendChild(row);
}

function jsToApiWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const WEEKDAY_NAMES = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
];

function humanDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Einklappbare Sektion (kein Persist, ADR-0008). */
function makeSection(
  container: HTMLElement,
  cls: string,
  title: string
): { section: HTMLElement; body: HTMLElement } {
  const section = document.createElement("div");
  section.className = `iserv-section ${cls}`;

  const header = document.createElement("div");
  header.className = "iserv-section-header";
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
  section.appendChild(body);
  container.appendChild(section);
  return { section, body };
}

function renderTimetableSection(
  container: HTMLElement,
  ctx: {
    day: number;
    isTomorrow: boolean;
    entries: SidebarEntry[];
    clock: SlotClock;
    substs: Substitution[];
    now: Date;
  }
): void {
  const { section, body } = makeSection(
    container,
    "iserv-timetable",
    ctx.isTomorrow
      ? `Morgen, ${humanDate(isoForWeekday(ctx.now, ctx.day))}`
      : `Heute, ${humanDate(isoForWeekday(ctx.now, ctx.day))}`
  );

  if (ctx.entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "iserv-empty-text";
    empty.textContent = "Kein Unterricht";
    body.appendChild(empty);
    section.classList.add("iserv-empty");
    return;
  }

  const rows = mergeDoubleSlots(ctx.entries, ctx.clock);

  const table = document.createElement("table");
  table.className = "iserv-timetable-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const h of ["Stunde", "Zeit", "Fach", "Raum"]) {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    tbody.appendChild(renderRow(row, ctx));
  }
  table.appendChild(tbody);
  body.appendChild(table);
}

function renderRow(
  row: MergedRow,
  ctx: {
    entries: SidebarEntry[];
    clock: SlotClock;
    substs: Substitution[];
    now: Date;
  }
): HTMLElement {
  const iso = isoForWeekday(ctx.now, row.weekday);
  const anchor = ctx.entries.find(
    (e) => e.weekday === row.weekday && e.slot === row.slots[0]
  )!;
  const decor: RowDecor = entryDecor(
    anchor,
    iso,
    ctx.substs,
    ctx.entries,
    ctx.clock
  );

  const tr = document.createElement("tr");
  tr.className = `iserv-row iserv-${decor.kind}`;
  tr.dataset.course = row.course;

  const tdSlot = document.createElement("td");
  tdSlot.className = "iserv-slot";
  tdSlot.textContent = slotLabel(row.slots);

  const tdTime = document.createElement("td");
  tdTime.className = "iserv-time";
  tdTime.textContent = timeLabel(row.slots, ctx.clock);

  const tdSubject = document.createElement("td");
  tdSubject.className = "iserv-subject";
  tdSubject.textContent = row.subject;

  const tdRoom = document.createElement("td");
  tdRoom.className = "iserv-room";
  tdRoom.textContent = row.rooms?.[0] ?? anchor.room ?? "";

  if (decor.kind !== "normal") {
    const who = decor.subst.insteadOfTeacher?.displayname ?? "";
    const msg = decor.subst.displayMessageForStudents ?? "";
    tdSubject.textContent =
      row.subject +
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

/** Review-Queue: kompakte Zeilen-Cards (Name + Fach), neueste zuerst (ADR-0008). */
function renderQueueSection(
  container: HTMLElement,
  queue: QueueItem[],
  actions?: QueueBindOptions,
  onPreview?: (item: QueueItem) => void
): void {
  const items = [...queue].reverse(); // neueste zuerst (Anhangsreihenfolge)
  if (items.length === 0) return; // ADR-0008: leere Sektion entfällt

  const { body } = makeSection(
    container,
    "iserv-queue",
    `Review-Queue (${items.length})`
  );

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "iserv-queue-row";
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

    // T15: PDF-Items bekommen einen Preview-Button (Theme-Icon file-text).
    if (onPreview && classifyQueueItem(item) === "pdf") {
      const previewBtn = document.createElement("button");
      previewBtn.className = "iserv-queue-preview";
      previewBtn.setAttribute("aria-label", `Vorschau: ${item.name}`);
      previewBtn.textContent = "🗎";
      previewBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onPreview(item);
      });
      row.appendChild(previewBtn);
    }

    if (item.status !== "neu") {
      const badge = document.createElement("span");
      badge.className = `iserv-queue-status iserv-queue-${item.status}`;
      badge.textContent = item.status;
      row.appendChild(badge);
    }

    body.appendChild(row);
  }

  if (actions) bindQueueRows(body, actions);
}

/** Benachrichtigungen: Mails (server-seitig gpaged, Browse-Buttons) + Ungelesen + Arbeiten. */
function renderNotificationsSection(
  container: HTMLElement,
  ctx: {
    mails: Mail[];
    unread: number;
    exams: SidebarExam[];
    onMailRowClick?: (id: string) => void;
    mailPage?: number;
    mailPageSize?: number;
    mailHasOlder?: boolean;
    /** Blättern (Ältere/Neuere Mails) → ViewModel-Seite + refetch. */
    onMailPage?(page: number): void;
  }
): void {
  const { body } = makeSection(container, "iserv-notifications", "Aktuell");

  if (ctx.unread > 0) {
    const badge = document.createElement("div");
    badge.className = "iserv-unread-badge";
    badge.textContent = `${ctx.unread} ungelesen`;
    body.appendChild(badge);
  }

  const seen = new Set<string>();
  // T9/T10-Pagination: die gelieferte Liste ist bereits server-seitig gpaged
  // (main.ts: mails() mit limit/offset aus der ViewModel-Seite) — hier komplett
  // rendern, kein client-side Slicing mehr.
  const page = ctx.mailPage ?? 0;

  for (const mail of ctx.mails) {
    if (seen.has(mail.subject)) continue;
    seen.add(mail.subject);
    const row = document.createElement("div");
    row.className = "iserv-mail-row";
    row.dataset.id = String(mail.id);

    const subj = document.createElement("span");
    subj.className = "iserv-mail-subject";
    subj.textContent = mail.subject;

    const from = document.createElement("span");
    from.className = "iserv-mail-from";
    from.textContent = mail.from;

    row.appendChild(subj);
    row.appendChild(from);
    body.appendChild(row);
    if (ctx.onMailRowClick) {
      row.classList.add("iserv-clickable");
      row.addEventListener("click", () => ctx.onMailRowClick?.(String(mail.id)));
    }
  }

  // Browse-Buttons (‹ Ältere Mails / Neuere Mails ›): feuern onMailPage mit der
  // Ziel-Seite; der Koordinator fetched server-seitig neu (limit/offset).
  const pageSize = Math.max(1, Math.floor(ctx.mailPageSize ?? SIDEBAR_PAGE_SIZE));
  if (ctx.mails.length > 0 || page > 0) {
    const paginated = document.createElement("div");
    paginated.className = "iserv-mail-pagination";
    renderBrowseButtons(paginated, {
      page,
      // Heuristik: volle Seite geliefert → vermutlich gibt es ältere Mails.
      hasOlder: ctx.mailHasOlder ?? ctx.mails.length >= pageSize,
      hasNewer: page > 0,
      onPage: (p) => ctx.onMailPage?.(p),
    });
    body.appendChild(paginated);
  }

  for (const exam of ctx.exams) {
    const row = document.createElement("div");
    row.className = "iserv-exam-row";
    const label = document.createElement("span");
    label.className = "iserv-exam-title";
    label.textContent = exam.title;
    const days = document.createElement("span");
    days.className = "iserv-exam-days";
    days.textContent =
      exam.daysLeft <= 0 ? "heute" : `in ${exam.daysLeft} Tagen`;
    row.appendChild(label);
    row.appendChild(days);
    body.appendChild(row);
  }
}

export { jsToApiWeekday, WEEKDAY_NAMES };
