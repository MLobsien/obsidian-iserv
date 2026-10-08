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
import { groupSegmentOf, FILES_ROOT_PATH } from "../review-queue/files-feed";
/**
 * Issue #22 (R5-2, User-Befund 16:38): sequenzieller Active-Course-Modus —
 * EIN Kurs nach dem anderen statt Kurs-Stapel. activeCoursePicker/activeCourse
 * sind KEEP-als-Aktionen-Callbacks aus main.ts (queueActionHandlers) —
 * main.ts hält ausschließlich Variable + Refresh; kein Settings-Key
 * (maple-Direktive: Session-Zustand, kein User-Setting).
 */
import {
  groupQueueByFolder,
  folderDiscardPayload,
  groupQueueBySubPath,
  coursesWithOpen,
} from "../review-queue/folder-groups";
import { classifyQueueItem } from "../review-queue/pdf-preview";

/** Kindgerechte Queue-Icons (Live-Befund: pausch 📄 auch bei PNG/mp4). */
const KIND_ICONS: Record<string, string> = {
  pdf: "📄",
  image: "🖼️",
  other: "📎",
};
import {
  bindQueueRows,
  type QueueBindOptions,
} from "../review-queue/queue-bind";
import type { Mail } from "../api/mails";
// R6 (worker snail2): exercise types — offene Aufgaben RENDERN WIR HIER
// (composeAktuellItems); die separate "Aufgaben"-Section entfällt weitgehend
// (Issue #9: Aufgaben erschienen DOPPELT — in "Aktuell" UND in der
// eigenständigen Section mit denselben data.exercises).
import type { ExerciseCandidate } from "../review-queue/exercise-feed";
// R6 (swan, Coordinator-Integration): "Aktuell"-Compositor — ungelesene
// Mails + zukünftige Arbeiten + offene Aufgaben + HW im Offset-Fenster.
import {
  composeAktuellItems,
  dueDateToDate,
  type AktuellView,
} from "./notifications-filter";
import { MAIL_PAGE_SIZE, SIDEBAR_PAGE_SIZE, renderBrowseButtons } from "./paginate";

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
  /**
   * Issue #22 (R5-2): AKTIVER Kurs (RAW-Gruppen-Segment, z. B. "O Chemie
   * 12eN Hn") für den sequenziellen Modus. Ephemeral-Session-State —
   * undefined = Kurs-Auswahlliste (Default nach Reload).
   */
  queueActiveCourse?: string | null;
  /** Issue #22: Kurs als aktiven Kontext wählen (aus der Kursliste). */
  onQueueCoursePick?: (group: string) => void;
  /** Issue #22: aktiven Kontext verlassen (zurück zur Kursliste). */
  onQueueCourseClear?: () => void;
  /**
   * Issue #23 (R5-3, User 16:54): Unterricht-Kurse des AKTUELLEN Tagesplan-
   * Tages (RAW-Gruppen-Segmente). Die Kurs-Auswahlliste zeigt NUR die
   * Intersection (ttKurse ∩ offene Queue-Items) — fehlt das Feld oder ist
   * leer: LEERE Liste, kein Fallback (P3-Philosophie, maple-Direktive).
   */
  queueTimetableCourses?: string[];
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
  // R6 (worker snail2): exercise section — offene Aufgaben ("Aktuelles").
  exercises?: ExerciseCandidate[];
  onExerciseClick?: (e: ExerciseCandidate) => void;
  /**
   * R6 (swan): HW-Fenster in Tagen für die "Aktuell"-Section (Settings
   * homeworkDueOffsetDays, Default 1). Nur für den Filter, nicht der Feed.
   */
  homeworkDueOffsetDays?: number;
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

  renderQueueSection(container, data.queue ?? [], data.queueActions, data.onPreview, {
    activeCourse: data.queueActiveCourse,
    onCoursePick: data.onQueueCoursePick,
    onCourseClear: data.onQueueCourseClear,
    timetableCourses: data.queueTimetableCourses,
  });
  // R6 (swan, Coordinator): "Aktuell" ist der radikal gefilterte Strom
  // (ungelesene Mails, zukünftige Arbeiten, offene Aufgaben, HW-Fenster).
  const aktuell = composeAktuellItems(
    {
      mails: data.mails ?? [],
      exams: data.exams ?? [],
      exercises: data.exercises ?? [],
    },
    { homeworkDueOffsetDays: data.homeworkDueOffsetDays, now: data.now }
  );
  renderNotificationsSection(container, {
    ...aktuell,
    unread: data.unread ?? 0,
    onMailRowClick: data.mailRowClick,
    // Issue #9: Aufgaben-Klick (openExerciseDetails-Weg) lebt HIER — in "Aktuell".
    onExerciseRowClick: data.onExerciseClick,
    // Mail-Browse bleibt: Historie lebt im Mail-Reader/Dashboard.
    mailPage: data.mailPage,
    mailPageSize: data.mailPageSize,
    mailHasOlder: data.mailHasOlder,
    onMailPage: (page) => {
      data.mailPage = page;
      data.onMailPage?.(page);
    },
  });

  // Issue #9 (User-Kritik 29.09.2026): die SEPARATE "Aufgaben"-Section ist
  // ENTFERNT — offene Aufgaben erscheinen nur noch in "Aktuell" (kein Duplikat,
  // fälligkeitssortiert kompakt, Klick → openExerciseDetails).
}

/** Komparator: Aufgaben nach Fälligkeit aufsteigend; unbekannte Frist ans Ende. */
function dueDateCompare(a: ExerciseCandidate, b: ExerciseCandidate): number {
  const keyOf = (e: ExerciseCandidate): number => {
    const due = e.dueDate ? dueDateToDate(e.dueDate) : null;
    return due === null ? Number.POSITIVE_INFINITY : due.getTime();
  };
  return keyOf(a) - keyOf(b);
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

/** Review-Queue: kompakte Zeilen-Cards (Name + Fach), neueste zuerst (ADR-0008).
 *
 * R6-queue-sum (worker): nur Zeilen mit status "neu" werden gerendert —
 * "auto" (automatisch entschiedene Alt-Dateien) und "kept"/"discarded"
 * fluteten die Sidebar (4131 Rows) und sprengten das Layout. Stattdessen
 * fasst eine dezente Summenzeile diese Bestände zusammen (iserv-queue-auto-summary).
 * Der Titel zählt nur die NEU-Zeilen. State/Fetch (state.ts, files-feed.ts)
 * bleiben unverändert — das ist reine Render-Ebene.
 *
 * export (28.09.2026, „Dashboard-Review-Queue vereinheitlichen"): das Dashboard
 * importiert GENAU DIESE Funktion statt ein eigenes Spiegel-DOM zu bauen
 * (Befund: Dashboard hatte einen zweiten Row-Typ mit funktionslosen
 * Behalten/Verwerfen/Überspringen-Pills + altem Preview-Button-Konzept).
 * Eine Quelle, zwei Views — DOM/Klassen/Summenzeile (R6-queue-sum) sind
 * garantiert identisch.
 */
export function renderQueueSection(
  container: HTMLElement,
  queue: QueueItem[],
  actions?: QueueBindOptions,
  onPreview?: (item: QueueItem) => void,
  sequencer?: {
    activeCourse?: string | null;
    onCoursePick?: (group: string) => void;
    onCourseClear?: () => void;
    /** Issue #23: Unterricht-Kurse — Liste zeigt NUR deren Intersection. */
    timetableCourses?: string[];
  }
): void {
  const items = [...queue].reverse(); // neueste zuerst (Anhangsreihenfolge)
  if (items.length === 0) return; // ADR-0008: leere Sektion entfällt

  // R6-queue-sum (worker): Rows nur für offene Sichtungen (neu + unsure).
  const visible = items.filter(
    (it) => it.status === "neu" || it.status === "unsure"
  );
  const autoCount = items.filter((it) => it.status === "auto").length;
  const doneCount = items.filter(
    (it) => it.status === "kept" || it.status === "discarded"
  ).length;
  if (visible.length === 0) return; // nichts offen → keine Sektion (ADR-0008)

  const { body } = makeSection(
    container,
    "iserv-queue",
    // R6-queue-sum (worker): Titel zählt nur die offenen (neu/unsure) Zeilen,
    // nicht mehr den ganzen State („Review-Queue (4131)"-Befund).
    `Review-Queue (${visible.length})`
  );

  // Konzept-NEU (Issue #12, Teil 2d): Ordner-Gruppen-Köpfe — Gruppen-Header
  // mit RAW-Kursname + „Ordner verwerfen"-Action (alle offenen Items der
  // Gruppe + Ordner-Ablehnung im DeniedFoldersStore). Zeilen selbst bleiben
  // flach (kein Nesting-DOM-Risiko); Header sind nur Orientierung + Gate.
  const seqActive = sequencer?.activeCourse ?? null;
  const seqPick = sequencer?.onCoursePick;
  const seqClear = sequencer?.onCourseClear;
  // Issue #23: Liste-Fonds = Intersection (ttKurse ∩ offene Items). Ohne
  // ttKurse (undefined) = leer (kein Fallback); mit ttKurse = Teilmenge.
  const periodCourses = new Set(sequencer?.timetableCourses ?? []);
  const scopedVisible = sequencer?.timetableCourses
    ? visible.filter((it) => periodCourses.has(groupSegmentOf(it.path ?? "") || ""))
    : visible;
  const folderGroups = groupQueueByFolder(visible);

  if (!seqActive && seqPick) {
    // Issue #23: OHNE Unterricht-Kurse (Feld fehlt/leer) → LEERE Liste
    // (P3-Philosophie, kein Fallback-Lotterie).
    if (sequencer?.timetableCourses && scopedVisible.length === 0) {
      const emptyNote = document.createElement("div");
      emptyNote.className = "iserv-queue-course-picker-empty";
      emptyNote.textContent = "Keine Kurse mit offenen Dateien im heutigen Unterricht.";
      body.appendChild(emptyNote);
      if (actions) bindQueueRows(body, actions);
      return;
    }
    // Issue #22: Kurs-Auswahlliste (kein aktiver Kurs) — EINE kompakte Zeile
    // pro Kurs mit offenen Items, ALPHABETISCH stabil. Auch Ein-Item-Kurse
    // (z. B. Englisch mit 1 offener Datei): KEIN <2-continue mehr — die Liste
    // ersetzt die alte Kopf-Gruppierung komplett (maple-Direktive 16:43).
    for (const g of coursesWithOpen(scopedVisible)) {
      const pick = document.createElement("div");
      pick.className = "iserv-queue-course-picker";
      pick.dataset.folderPath = g.group;
      const label = document.createElement("span");
      label.className = "iserv-queue-course-picker-name";
      label.textContent = `📁 ${g.group} (${g.items.length})`;
      pick.appendChild(label);
      const openBtn = document.createElement("button");
      openBtn.className = "iserv-queue-course-open";
      openBtn.textContent = "Behandeln";
      openBtn.title = "Diesen Kurs als aktiven Kontext öffnen (ein Kurs nach dem anderen)";
      openBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        seqPick(g.group);
      });
      pick.appendChild(openBtn);
      body.appendChild(pick);
    }
  } else if (seqActive) {
    // Issue #22: aktiver Kurs — Header (Name, N offene, zurück, weiter) +
    // VOLLER Sub-Tree inkl. Einzel-Item-Rows (kein <2-continue im aktiven Modus).
    const g = folderGroups.find((x) => x.group === seqActive);
    const nav = document.createElement("div");
    nav.className = "iserv-queue-course-nav";
    const backBtn = document.createElement("button");
    backBtn.className = "iserv-queue-course-back";
    backBtn.textContent = "← Kursliste";
    if (seqClear) {
      backBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        seqClear();
      });
    }
    nav.appendChild(backBtn);
    const title = document.createElement("span");
    title.className = "iserv-queue-course-title";
    title.textContent = g
      ? `📁 ${g.group} (${g.items.length})`
      : `📁 ${seqActive} (0)`;
    nav.appendChild(title);
    if (seqPick) {
      // "Weiter": alphabetisch nächster Kurs mit offenen Items (sequenzielle
      // Sichtung: behandeln → fertig → nächster) — Issue #23: INNERHALB der
      // gescopten Unterricht-Kurse (ohne ttKurse = ungescopt, Alt-Verhalten).
      const all = sequencer?.timetableCourses
        ? coursesWithOpen(scopedVisible)
        : coursesWithOpen(visible);
      const idx = all.findIndex((x) => x.group === seqActive);
      const next = all[(idx + 1) % all.length];
      if (all.length > 1 && next && next.group !== seqActive) {
        const nextBtn = document.createElement("button");
        nextBtn.className = "iserv-queue-course-next";
        nextBtn.textContent = `Weiter: ${next.group} →`;
        nextBtn.title = "Direkt zum nächsten Kurs mit offenen Items";
        nextBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          seqPick(next.group);
        });
        nav.appendChild(nextBtn);
      }
    }
    // Ordner-Verwerfen bleibt am aktiven Kurskopf erhaltenswert (hier = sinnvoller
    // Ort für die Aktion, NICHT in der Auswahlliste).
    if (g && actions?.onFolderDiscard) {
      const btn = document.createElement("button");
      btn.className = "iserv-queue-folder-discard";
      btn.textContent = "Ordner verwerfen";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        actions.onFolderDiscard?.(folderDiscardPayload(g));
      });
      nav.appendChild(btn);
    }
    body.appendChild(nav);
    if (g && actions?.onSubFolderDecide) {
      const subs = groupQueueBySubPath(g);
      for (const s of subs) {
        const sub = document.createElement("div");
        sub.className = "iserv-queue-subfolder-head";
        sub.dataset.folderPath = s.folderPath;
        const subLabel = document.createElement("span");
        subLabel.className = "iserv-queue-subfolder-name";
        subLabel.textContent = `↳ ${s.sub} (${s.items.length})`;
        subLabel.title = s.sub;
        const subActions = document.createElement("span");
        subActions.className = "iserv-queue-subfolder-actions";
        const allowBtn = document.createElement("button");
        allowBtn.className = "iserv-queue-subfolder-allow";
        allowBtn.textContent = "Erlauben";
        allowBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          actions.onSubFolderDecide?.({ folderPath: s.folderPath, label: s.sub, itemIds: s.items.map((i) => i.id), decision: "allow" });
        });
        const denyBtn = document.createElement("button");
        denyBtn.className = "iserv-queue-subfolder-deny";
        denyBtn.textContent = "Verwerfen";
        denyBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          actions.onSubFolderDecide?.({ folderPath: s.folderPath, label: s.sub, itemIds: s.items.map((i) => i.id), decision: "deny" });
        });
        subActions.appendChild(allowBtn);
        subActions.appendChild(denyBtn);
        sub.appendChild(subLabel);
        sub.appendChild(subActions);
        body.appendChild(sub);
      }
    }
  } else if (actions?.onFolderDiscard) {
    // Fallback-Compat (keine Sequencer-Callbacks): alter Kopf-Gruppierungs-Pfad.
    // Issue #23: auch hier greift der Unterricht-Scope (Konsistenz, maple).
    for (const g of folderGroups.filter(
      (x) => !sequencer?.timetableCourses || periodCourses.has(x.group)
    )) {
      if (g.items.length < 2) continue; // Einzel-Row: normale Zeilen-Aktionen reichen
      const head = document.createElement("div");
      head.className = "iserv-queue-folder-head";
      head.dataset.folderPath = g.group;
      const label = document.createElement("span");
      label.className = "iserv-queue-folder-name";
      label.textContent = `📁 ${g.group} (${g.items.length})`;
      head.appendChild(label);
      const btn = document.createElement("button");
      btn.className = "iserv-queue-folder-discard";
      btn.textContent = "Ordner verwerfen";
      const payload = folderDiscardPayload(g);
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        actions.onFolderDiscard?.(payload);
      });
      head.appendChild(btn);
      body.appendChild(head);
      // Issue #17 Punkt 4 + Issue #19 P2: Sub-Ordner-Zeilen — die Liste
      // zeigt ALLE Unterordner, aus denen aktuell offene Dateien in der
      // Queue liegen (kompletter Unterpfad relativ zum Kursordner,
      // groupQueueBySubPath — nicht nur die 2. Ebene). Auch bei EINEM
      // Sub-Pfad ist die Zeile essenzial (#17.4: Sub unter deniedem Kurs
      // zulassen; #19: Verwerfen eines beliebigen Unterordners).
      if (actions.onSubFolderDecide && g.items.length > 0) {
        const subs = groupQueueBySubPath(g);
        if (subs.length > 0) {
          for (const s of subs) {
            const sub = document.createElement("div");
            sub.className = "iserv-queue-subfolder-head";
            sub.dataset.folderPath = s.folderPath;
            const subLabel = document.createElement("span");
            subLabel.className = "iserv-queue-subfolder-name";
            subLabel.textContent = `↳ ${s.sub} (${s.items.length})`;
            // Issue #19 P2: mehrstufige Unterpfade werden abgeschnitten —
            // title gibt den vollen Sub-Pfad beim Hover zurück.
            subLabel.title = s.sub;
            const subActions = document.createElement("span");
            subActions.className = "iserv-queue-subfolder-actions";
            const allowBtn = document.createElement("button");
            allowBtn.className = "iserv-queue-subfolder-allow";
            allowBtn.textContent = "Erlauben";
            allowBtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              actions.onSubFolderDecide?.({ folderPath: s.folderPath, label: s.sub, itemIds: s.items.map((i) => i.id), decision: "allow" });
            });
            const denyBtn = document.createElement("button");
            denyBtn.className = "iserv-queue-subfolder-deny";
            denyBtn.textContent = "Verwerfen";
            denyBtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              actions.onSubFolderDecide?.({ folderPath: s.folderPath, label: s.sub, itemIds: s.items.map((i) => i.id), decision: "deny" });
            });
            subActions.appendChild(allowBtn);
            subActions.appendChild(denyBtn);
            sub.appendChild(subLabel);
            sub.appendChild(subActions);
            body.appendChild(sub);
          }
        }
      }
    }
  }

  // Issue #22: im aktiven Kurs nur DIESE kurs-Items als Rows (Kontext-Filter);
  // in Liste/Fallback: Issue #23 — tt-gescoped wenn tt-Kurse geliefert.
  const rowItems =
    seqActive && folderGroups.some((x) => x.group === seqActive)
      ? (folderGroups.find((x) => x.group === seqActive)?.items ?? visible)
      : sequencer?.timetableCourses
        ? scopedVisible
        : visible;
  for (const item of rowItems) {
    const row = document.createElement("div");
    row.className = "iserv-queue-row";
    row.dataset.id = item.id;

    const icon = document.createElement("span");
    icon.className = "iserv-queue-icon";
    // Kindgerechtes Icon (Live-Befund 19:27): Pausch-📄 auch bei PNG/mp4
    // verleitet zur falschen Inline-Vorschau-Erwartung.
    icon.textContent = KIND_ICONS[classifyQueueItem(item)] ?? "📄";

    const name = document.createElement("span");
    name.className = "iserv-queue-name";
    name.textContent = item.name;
    // Ellipse schneidet lange Namen (2 Live-Rows >60 Zeichen) — title-Attr
    // gibt den vollen Namen beim Hover zurück (sonst UX-Verlust).
    if (item.name.length > 40) name.title = item.name;

    const subject = document.createElement("span");
    subject.className = "iserv-queue-subject";
    subject.textContent = item.subject;
    // Issue #7 (29.09.2026, Transparenz): das Pill-Fach ist eine Vermutung —
    // der RAW-Gruppenordner (authentischer Kurs-Anker, 1. Segment des
    // IServ-Pfads unter Groups) steht als title beim Hover. Kein extra DOM,
    // kein Overrender (ADR-0008); Pill-Text bleibt das Vault-Fach.
    const group = item.path
      ? groupSegmentOf(item.path)
      : "";
    if (group && group !== FILES_ROOT_PATH && group !== item.subject) {
      subject.title = group;
    }

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(subject);

    // Runde 5 (User 28.09.2026): die GANZE Zeile ist klickbar für die
    // Vorschau (kein extra Button) — für ALLE Dateitypen (pdf/image/other,
    // other als Plaintext-Fallback). Klick-Highlight via CSS-Klasse.
    if (onPreview) {
      row.classList.add("iserv-queue-row-clickable");
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", `Vorschau: ${item.name}`);
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onPreview(item);
      });
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onPreview(item);
        }
      });
    }

    if (item.status !== "neu") {
      const badge = document.createElement("span");
      badge.className = `iserv-queue-status iserv-queue-${item.status}`;
      badge.textContent = item.status;
      row.appendChild(badge);
    }

    body.appendChild(row);
  }

  // R6-queue-sum (worker): dezente Summenzeile für auto/kept/discarded-Bestände
  // (einmalig am Ende, statt tausender Rows).
  if (autoCount > 0 || doneCount > 0) {
    const parts: string[] = [];
    if (autoCount > 0)
      parts.push(
        `${autoCount} ältere Dateien automatisch übersprungen (Frist)`
      );
    if (doneCount > 0) parts.push(`${doneCount} erledigt`);
    const summary = document.createElement("div");
    summary.className = "iserv-queue-auto-summary";
    summary.textContent = parts.join(" · ");
    body.appendChild(summary);
  }

  if (actions) bindQueueRows(body, actions);
}

/** Benachrichtigungen: Mails (server-seitig gpaged, Browse-Buttons) + Ungelesen + Arbeiten. */
function renderNotificationsSection(
  container: HTMLElement,
  ctx: AktuellView & {
    unread: number;
    /** Klick auf eine (ungelesene) Mail-Zeile → Mail-Reader (R6). */
    onMailRowClick?: (id: string) => void;
    mailPage?: number;
    mailPageSize?: number;
    mailHasOlder?: boolean;
    /** Blättern (Ältere/Neuere Mails) → ViewModel-Seite + refetch. */
    onMailPage?(page: number): void;
    /**
     * Issue #9: Klick auf eine Aufgaben-Zeile in "Aktuell" → openExerciseDetails
     * (Detail-Modal, ANSEHEN + Text-ABGEBEN).
     */
    onExerciseRowClick?: (e: ExerciseCandidate) => void;
  }
): void {
  const { body } = makeSection(container, "iserv-notifications", "Aktuell");

  // Issue #6 (User, Runde 3): String-Badge "x ungelesen" entfällt — Ungelesenzahl
  // stand doppelt (Sektion + Mail-Header) und brach im dunklen Theme. Die
  // Ungerichtet-Markierung passiert jetzt pro Zeile via iserv-mail-unread
  // (Farb-Hilite über Obsidian-CSS-Variablen, kein festes Hex).

  // R6 (swan, Coordinator): nur UNGELESENE Mails in "Aktuell" — die volle
  // (gelesene) Historie lebt im Mail-Reader/Dashboard mit Pagination.
  const seen = new Set<string>();
  for (const mail of ctx.unreadMails) {
    if (seen.has(mail.subject)) continue;
    seen.add(mail.subject);
    const row = document.createElement("div");
    // "Aktuell" listet nur Ungelesene ⇒ Zeile direkt ungelesen markieren.
    row.className = "iserv-mail-row iserv-mail-unread";
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

  // Zukünftige Arbeiten (Termin nicht vorbei).
  for (const exam of ctx.upcomingExams) {
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

  // Issue #9 (User-Kritik 29.09.2026): offene Aufgaben — kompakt in "Aktuell",
  // STRIKT nach Fälligkeit sortiert (unbekannte Frist ans Ende), ganze Zeile
  // klickbar (openExerciseDetails). Die alte separate "Aufgaben"-Section ist
  // ENTFERNT (Doppel-Render-Befund: dieselben data.exercises hier + dort).
  const hwRows = [
    ...ctx.hwExercises.map((e) => ({ e, hw: true })),
    ...ctx.otherOpenExercises.map((e) => ({ e, hw: false })),
  ].sort((a, b) => dueDateCompare(a.e, b.e));
  for (const { e, hw } of hwRows) {
    const row = document.createElement("div");
    row.className = hw
      ? "iserv-homework-row iserv-clickable"
      : "iserv-exercise-mini-row iserv-clickable";
    row.dataset.id = e.id;
    // Kompakt-Text: Name (+ Fach/Frist-Hinweis als title). Fälligkeit bleibt
    // im Sort sichtbar steuernd, die Zeile selbst bleibt einspaltig kurz.
    const label = (hw ? "HW: " : "📋 ") + e.name;
    const hint = [
      e.subject,
      e.dueDate ? `bis ${e.dueDate}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const nameSpan = document.createElement("span");
    nameSpan.className = "iserv-row-name";
    nameSpan.textContent = label;
    row.appendChild(nameSpan);
    if (hint) {
      row.title = hint;
      const meta = document.createElement("span");
      meta.className = hw ? "iserv-homework-meta" : "iserv-exercise-mini-meta";
      meta.textContent = ` — ${hint}`;
      row.appendChild(meta);
    }
    if (ctx.onExerciseRowClick) {
      row.setAttribute("role", "button");
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ctx.onExerciseRowClick?.(e);
      });
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ctx.onExerciseRowClick?.(e);
        }
      });
    }
    body.appendChild(row);
  }

  // ADR-0008: Nichts Aktuelles? Sektion entfällt (komplett leer → remove).
  if (
    ctx.unread === 0 &&
    ctx.unreadMails.length === 0 &&
    ctx.upcomingExams.length === 0 &&
    ctx.hwExercises.length === 0 &&
    ctx.otherOpenExercises.length === 0
  ) {
    const section = body.closest(".iserv-section") ?? body.parentElement;
    section?.remove();
  }
}

export { jsToApiWeekday, WEEKDAY_NAMES };
