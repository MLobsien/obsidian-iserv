/**
 * Sidebar-View (T6, ADR-0008): kompakte Card-Stack-Ansicht als Obsidian-ItemView.
 * Abschnitte: Stundenplan → Review-Queue (Zeilen) → Benachrichtigungen.
 * DOM-Rendering ist in reine Funktionen ausgelagert (document-Injection), damit
 * die Kern-Logik Node-testbar bleibt; hier nur Verdrahtung + ItemView-Shell.
 */
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
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

export const VIEW_TYPE_ISERV_SIDEBAR = "iserv-sidebar-view";

export interface SidebarData {
  entries: SidebarEntry[];
  slots: TimetableSlot[];
  substs: Substitution[];
  now: Date;
}

/** Alle Daten rein, DOM raus — testbar ohne Obsidian. */
export function renderSidebarSections(
  container: HTMLElement,
  data: SidebarData
): void {
  container.empty();
  container.addClass("iserv-sidebar");

  const clock: SlotClock = {};
  for (const s of data.slots) {
    clock[s.number] = { start: s.startTime, end: s.endTime };
  }

  const day = sidebarDay(data.now, clock, data.entries);
  const isTomorrow = day !== jsToApiWeekday(data.now);
  const dayEntries = data.entries.filter((e) => e.weekday === day);

  renderTimetableSection(container, {
    day,
    isTomorrow,
    entries: dayEntries,
    clock,
    substs: data.substs,
    now: data.now,
  });
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
  const section = document.createElement("div");
  section.className = "iserv-section iserv-timetable";

  const header = document.createElement("div");
  header.className = "iserv-section-header";

  const label = document.createElement("span");
  label.className = "iserv-section-title";
  const dateStr = isoForWeekday(ctx.now, ctx.day);
  const humanDate = new Date(`${dateStr}T12:00:00`).toLocaleDateString(
    "de-DE",
    { weekday: "short", day: "numeric", month: "short" }
  );
  label.textContent = ctx.isTomorrow
    ? `Morgen, ${humanDate}`
    : `Heute, ${humanDate}`;
  header.appendChild(label);
  section.appendChild(header);

  if (ctx.entries.length === 0) {
    // ADR-0008: Am Wochenende/feiertag gibt es gar keine Sektion — dieser
    // Codepfad wird nur bei leerem Plan eines Schultags erreicht.
    section.addClass("iserv-empty");
    const empty = document.createElement("div");
    empty.className = "iserv-empty-text";
    empty.textContent = "Kein Unterricht";
    section.appendChild(empty);
    container.appendChild(section);
    return;
  }

  const rows = mergeDoubleSlots(ctx.entries, ctx.clock);
  for (const row of rows) {
    section.appendChild(renderRow(row, ctx));
  }
  container.appendChild(section);
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

  const div = document.createElement("div");
  div.className = `iserv-row iserv-${decor.kind}`;
  div.dataset.course = row.course;

  const slot = document.createElement("span");
  slot.className = "iserv-slot";
  slot.textContent = slotLabel(row.slots);

  const time = document.createElement("span");
  time.className = "iserv-time";
  time.textContent = timeLabel(row.slots, ctx.clock);

  const subj = document.createElement("span");
  subj.className = "iserv-subject";
  subj.textContent = row.subject;

  const room = document.createElement("span");
  room.className = "iserv-room";
  room.textContent = row.rooms?.[0] ?? anchor.room ?? "";

  if (decor.kind !== "normal") {
    const badge = document.createElement("span");
    badge.className = `iserv-badge iserv-badge-${decor.kind}`;
    const who = decor.subst.insteadOfTeacher?.displayname ?? "";
    const msg = decor.subst.displayMessageForStudents ?? "";
    badge.textContent =
      decor.kind === "absence"
        ? "Entfall"
        : who
          ? `Vertretung: ${who}`
          : msg || "Vertretung";
    div.appendChild(badge);
  }

  div.appendChild(slot);
  div.appendChild(time);
  div.appendChild(subj);
  div.appendChild(room);
  return div;
}

/** Obsidian-ItemView-Shell (echtes Plugin). */
export class IServSidebarView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_ISERV_SIDEBAR;
  }

  getDisplayText(): string {
    return "IServ";
  }

  getIcon(): string {
    return "school";
  }

  async onOpen(): Promise<void> {
    const placeholder = this.contentEl.createDiv({
      cls: "iserv-sidebar iserv-loading",
    });
    placeholder.setText("IServ wird geladen …");
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Von außen (Plugin) mit Daten befüllen. */
  update(data: SidebarData): void {
    try {
      renderSidebarSections(this.contentEl, data);
    } catch (err) {
      // eslint-disable-next-line no-new
      new Notice(`IServ-Sidebar-Fehler: ${String(err)}`);
    }
  }
}
