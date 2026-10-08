// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderSidebarSections,
  type SidebarData,
} from "../../src/views/sidebar-render";
import type { Substitution, TimetableSlot } from "../../src/api/timetable";
import type { QueueItem } from "../../src/review-queue/state";
import type { Mail } from "../../src/api/mails";

function entry(
  weekday: number,
  slot: number,
  subject: string,
  course = subject
): SidebarData["entries"][number] {
  return {
    id: weekday * 100 + slot,
    weekday,
    slot,
    subject,
    course,
    room: `R${slot}`,
  };
}

const SLOTS: TimetableSlot[] = [
  { id: 1, number: 1, startTime: "08:00", endTime: "08:45" },
  { id: 2, number: 2, startTime: "08:50", endTime: "09:35" },
  { id: 3, number: 3, startTime: "09:55", endTime: "10:40" },
  { id: 4, number: 4, startTime: "10:45", endTime: "11:30" },
];

function baseData(now = new Date("2026-09-21T10:00:00+02:00")): SidebarData {
  return {
    entries: [entry(0, 1, "Mathe"), entry(0, 2, "Mathe"), entry(0, 3, "Latein")],
    slots: SLOTS,
    substs: [],
    now,
  };
}

describe("renderSidebarSections — Stundenplan als Tabelle", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert eine echte Tabelle mit Kopfzeile (Stunde|Zeit|Fach|Raum)", () => {
    renderSidebarSections(container, baseData());
    const table = container.querySelector("table.iserv-timetable-table");
    expect(table).toBeTruthy();
    const head = table!.querySelector("thead");
    expect(head!.textContent).toContain("Stunde");
    expect(head!.textContent).toContain("Zeit");
    expect(head!.textContent).toContain("Fach");
    expect(head!.textContent).toContain("Raum");
    const rows = table!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2); // Mathe 1./2. gemergt, Latein 3.
    expect(rows[0]!.textContent).toContain("1./2.");
    expect(rows[0]!.textContent).toContain("08:00–09:35");
  });

  it("Entfall-Zeile bekommt iserv-absence-Klasse + Entfall-Badge", () => {
    const d = baseData();
    const substs: Substitution[] = [
      {
        id: 1,
        createdAt: "0",
        channel: { name: "O Latein 12gN Sz", type: "course" },
        channels: [],
        date: { date: "2026-09-21 00:00:00.000", timezone: "Europe/Berlin" },
        hour: 3,
        substitutionType: "class-absence",
        displayMessageForStudents: "",
        courseName: "O Latein 12gN Sz",
      },
    ];
    d.substs = substs;
    // course muss courseName matchen (Join-Regel aus entryDecor):
    d.entries = d.entries.map((e) =>
      e.subject === "Latein" ? { ...e, course: "O Latein 12gN Sz" } : e
    );
    renderSidebarSections(container, d);
    const row = container.querySelector("tr.iserv-absence");
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("Entfall");
  });

  it("Wochenende: zeigt nächsten Schultag (Montag-Plan, Label Morgen)", () => {
    const sat = baseData(new Date("2026-09-26T09:00:00+02:00"));
    renderSidebarSections(container, sat);
    const sec = container.querySelector(".iserv-timetable");
    expect(sec).toBeTruthy();
    expect(sec!.textContent).toContain("Mo.");
  });
});

describe("renderSidebarSections — Benachrichtigungen", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("zeigt Mails (Betreff), Zeilen-Hilite statt String-Badge (Issue #6)", () => {
    const mails: Mail[] = [
      { id: 1, subject: "HA und Themen Klausur 7.10.", from: "Lehrer", date: "2026-09-26", snippet: "", flags: [] },
      { id: 2, subject: "Tabelle AG1", from: "Andere", date: "2026-09-25", snippet: "", flags: [] },
    ];
    renderSidebarSections(container, { ...baseData(), mails, unread: 2 });
    const section = container.querySelector(".iserv-notifications");
    expect(section).toBeTruthy();
    expect(section!.textContent).toContain("HA und Themen Klausur 7.10.");
    // Issue #6: kein "x ungelesen"-String-Badge mehr — Zeilen tragen iserv-mail-unread.
    expect(container.querySelector(".iserv-unread-badge")).toBeNull();
    expect(container.querySelectorAll(".iserv-mail-unread").length).toBe(2);
  });

  it("zeigt aktive Arbeiten-Countdown-Zeilen, wenn vorhanden (R6: zukünftig, mit Termin)", () => {
    const exams = [
      { title: "Klausur Latein", daysLeft: 3, date: new Date("2026-09-29T10:00:00+02:00") },
    ];
    renderSidebarSections(container, { ...baseData(), exams });
    const sec = container.querySelector(".iserv-notifications");
    expect(sec!.textContent).toContain("Klausur Latein");
    expect(sec!.textContent).toContain("3 Tagen");
  });

  it("mailRowClick: Klick auf Mail-Zeile feuert Callback mit der Mail-ID", () => {
    // R6 (swan/Coordinator): "Aktuell" zeigt nur UNGELESENE Mails.
    const mails: Mail[] = [
      { id: 7, subject: "HA und Themen Klausur 7.10.", from: "Lehrer", date: "2026-09-26", snippet: "", flags: ["unread"] },
      { id: 11, subject: "Tabelle AG1", from: "Andere", date: "2026-09-25", snippet: "", flags: ["unread"] },
    ];
    const clicked: (string | number)[] = [];
    renderSidebarSections(container, {
      ...baseData(),
      mails,
      mailRowClick: (id) => clicked.push(id),
    });

    const rows = container.querySelectorAll<HTMLElement>(".iserv-mail-row");
    expect(rows.length).toBe(2);
    rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toEqual(["7"]); // dataset.id ist string
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toEqual(["7", "11"]);
  });

  it("ohne mailRowClick: Klick auf Mail-Zeile ist kein Fehler", () => {
    const mails: Mail[] = [
      { id: 7, subject: "X", from: "L", date: "d", snippet: "", flags: [] },
    ];
    renderSidebarSections(container, { ...baseData(), mails });
    const row = container.querySelector<HTMLElement>(".iserv-mail-row")!;
    expect(() =>
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    ).not.toThrow();
  });
});

describe("renderSidebarSections — Review-Queue (Zeilen-Cards)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("zeigt Queue-Zeilen mit Name+Fach, newest first", () => {
    const queue: QueueItem[] = [
      { id: "a", name: "old.pdf", path: "x", hash: "h1", subject: "Mathe", status: "neu" },
      { id: "b", name: "new.pdf", path: "y", hash: "h2", subject: "Latein", status: "neu" },
    ];
    renderSidebarSections(container, { ...baseData(), queue });
    const rows = container.querySelectorAll(".iserv-queue-row");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("new.pdf"); // newest first
    expect(rows[1]!.textContent).toContain("old.pdf");
    expect(rows[0]!.textContent).toContain("Latein");
  });

  // Issue #7 (29.09.2026): RAW-Gruppenordner-Anker als Hover-Transparenz an
  // der Subject-Pill — Pill-Text bleibt das Vault-Fach (Vermutung), der
  // authentische Kurs-Ordner (1. Segment unter Groups) steht im title.
  it("Issue #7: Subject-Pill trägt den RAW-Gruppenordner als title (Vermutungs-Transparenz)", () => {
    const queue: QueueItem[] = [
      {
        id: "g1",
        name: "Arbeitsblatt.pdf",
        path: "Groups/O Latein 12gN Sz/Unterordner/Arbeitsblatt.pdf",
        hash: "h1",
        subject: "Latein",
        status: "neu",
      },
    ];
    renderSidebarSections(container, { ...baseData(), queue });
    const pill = container.querySelector<HTMLElement>(".iserv-queue-subject")!;
    expect(pill.textContent).toBe("Latein");
    expect(pill.title).toBe("O Latein 12gN Sz");
  });

  it("Issue #7: ohne Gruppen-Segment bleibt der title der Pill leer", () => {
    const queue: QueueItem[] = [
      { id: "g2", name: "a.pdf", path: "Files/a.pdf", hash: "h1", subject: "Mathe", status: "neu" },
    ];
    renderSidebarSections(container, { ...baseData(), queue });
    const pill = container.querySelector<HTMLElement>(".iserv-queue-subject")!;
    expect(pill.title).toBe("");
  });

  // R6-queue-sum (worker): nur offene Sichtungen als Rows, Rest als Summenzeile.
  it("R6-queue-sum: auto/kept/discarded → keine Rows, sondern Summenzeile; Titel zählt offene", () => {
    const queue: QueueItem[] = [
      { id: "n1", name: "neu1.pdf", path: "p", hash: "h1", subject: "Mathe", status: "neu" },
      { id: "n2", name: "neu2.pdf", path: "p", hash: "h2", subject: "Mathe", status: "neu" },
      { id: "u1", name: "unsure.pdf", path: "p", hash: "h3", subject: "Kunst", status: "unsure" },
      { id: "a1", name: "alt1.pdf", path: "p", hash: "h4", subject: "Mathe", status: "auto" },
      { id: "a2", name: "alt2.pdf", path: "p", hash: "h5", subject: "Mathe", status: "auto" },
      { id: "a3", name: "alt3.pdf", path: "p", hash: "h6", subject: "Mathe", status: "auto" },
      { id: "k1", name: "kept.pdf", path: "p", hash: "h7", subject: "Mathe", status: "kept" },
      { id: "d1", name: "disc.pdf", path: "p", hash: "h8", subject: "Mathe", status: "discarded" },
    ];
    renderSidebarSections(container, { ...baseData(), queue });
    const section = container.querySelector(".iserv-queue")!;
    // Titel zählt nur neu (2) + unsure (1)
    expect(section.querySelector(".iserv-section-title")!.textContent).toBe(
      "Review-Queue (3)"
    );
    const rows = section.querySelectorAll(".iserv-queue-row");
    expect(rows.length).toBe(3);
    expect(section.querySelector(".iserv-queue-auto-summary")!.textContent).toBe(
      "3 ältere Dateien automatisch übersprungen (Frist) · 2 erledigt"
    );
    // keine auto/kept/discarded-Zeilen gerendert
    expect(section.textContent).not.toContain("alt1.pdf");
    expect(section.textContent).not.toContain("kept.pdf");
  });

  it("R6-queue-sum: nur auto-Dateien → keine Sektion (keine offenen)", () => {
    const queue: QueueItem[] = [
      { id: "a1", name: "alt.pdf", path: "p", hash: "h1", subject: "Mathe", status: "auto" },
      { id: "k1", name: "kept.pdf", path: "p", hash: "h2", subject: "Mathe", status: "kept" },
    ];
    renderSidebarSections(container, { ...baseData(), queue });
    expect(container.querySelector(".iserv-queue")).toBeNull();
  });

  it("leere Queue → keine Sektion", () => {
    renderSidebarSections(container, { ...baseData(), queue: [] });
    expect(container.querySelector(".iserv-queue")).toBeNull();
  });

  it("queueActions gesetzt: Desktop-Buttons an Zeilen, Klick ruft Callback mit ID", () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    const onUnsure = vi.fn();
    const onOpenPreview = vi.fn();
    const queue: QueueItem[] = [
      { id: "a", name: "old.pdf", path: "x", hash: "h1", subject: "Mathe", status: "neu" },
      { id: "b", name: "new.pdf", path: "y", hash: "h2", subject: "Latein", status: "neu" },
    ];
    renderSidebarSections(container, {
      ...baseData(),
      queue,
      queueActions: { onKeep, onDiscard, onUnsure, onOpenPreview },
    });

    const rows = container.querySelectorAll<HTMLElement>(".iserv-queue-row");
    expect(rows.length).toBe(2);
    // Desktop (pointer: coarse in jsdom nicht coarse) → Button-Gruppen pro Zeile
    const btnGroups = container.querySelectorAll(".review-queue-buttons");
    expect(btnGroups.length).toBe(2);

    const keepBtn = rows[0].querySelector<HTMLButtonElement>(
      ".review-queue-buttons button:first-child"
    )!;
    keepBtn.click();
    expect(onKeep).toHaveBeenCalledWith("b"); // newest first

    const unsureBtn = rows[1].querySelectorAll<HTMLButtonElement>(
      ".review-queue-buttons button"
    )[2]!;
    unsureBtn.click();
    expect(onUnsure).toHaveBeenCalledWith("a");
    expect(onOpenPreview).not.toHaveBeenCalled();
  });

  it("onPreview: GANZE Zeile klickbar (Runde 5), Klick ruft Callback mit Item", () => {
    const onPreview = vi.fn();
    const queue: QueueItem[] = [
      { id: "a", name: "doc.pdf", path: "p", hash: "h1", subject: "Mathe", status: "neu" },
      { id: "b", name: "bild.png", path: "q", hash: "h2", subject: "Kunst", status: "neu" },
    ];
    renderSidebarSections(container, {
      ...baseData(),
      queue,
      onPreview,
      queueActions: { onKeep: () => {}, onDiscard: () => {}, onUnsure: () => {} },
    });
    const rows = container.querySelectorAll<HTMLElement>(".iserv-queue-row-clickable");
    expect(rows.length).toBe(2); // ALLE Typen klickbar (pdf + png)
    // renderQueueSection dreht die Reihenfolge ([...queue].reverse(), neueste zuerst)
    rows[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(queue[1]);
    expect(onPreview).not.toHaveBeenCalledWith(queue[0]);
  });

  it("ohne onPreview: kein Preview-Button", () => {
    renderSidebarSections(container, {
      ...baseData(),
      queue: [
        { id: "a", name: "doc.pdf", path: "p", hash: "h1", subject: "Mathe", status: "neu" },
      ],
    });
    expect(container.querySelectorAll(".iserv-queue-row-clickable").length).toBe(0);
  });

  // Issue #19 P2: Sub-Zeilen zeigen ALLE Unterordner (kompletter Unterpfad).
  it("Issue #19 P2: Sub-Zeilen listen alle Unterpfade mit offenen Items (auch 2 Ebenen tief)", () => {
    const onSubFolderDecide = vi.fn();
    const queue: QueueItem[] = [
      { id: "a", name: "v.pdf", path: "Groups/O Latein 12gN Sz/Lektion 7/Vokabeln.pdf", hash: "h1", subject: "", status: "neu" },
      { id: "b", name: "g.pdf", path: "Groups/O Latein 12gN Sz/Lektion 7/Grammatik/G1.pdf", hash: "h2", subject: "", status: "neu" },
      { id: "c", name: "x.pdf", path: "Groups/O Latein 12gN Sz/AAG 25-26/1. Halbjahr/x.pdf", hash: "h3", subject: "", status: "neu" },
      { id: "d", name: "m.pdf", path: "Groups/O Latein 12gN Sz/Memes/x.pdf", hash: "h4", subject: "", status: "neu" },
      { id: "e", name: "d.pdf", path: "Groups/O Latein 12gN Sz/Direkt.pdf", hash: "h5", subject: "", status: "neu" },
    ];
    renderSidebarSections(container, {
      ...baseData(),
      queue,
      queueActions: {
        onKeep: () => {},
        onDiscard: () => {},
        onUnsure: () => {},
        onFolderDiscard: () => {},
        onSubFolderDecide,
      },
    });
    const subs = container.querySelectorAll<HTMLElement>(".iserv-queue-subfolder-head");
    const labels = Array.from(subs).map((s) =>
      s.querySelector(".iserv-queue-subfolder-name")!.textContent
    );
    expect(labels).toEqual([
      "↳ Memes (1)",
      "↳ AAG 25-26/1. Halbjahr (1)",
      "↳ Lektion 7/Grammatik (1)",
      "↳ Lektion 7 (1)",
    ]);
    // Deny auf dem tiefen Pfad feuert mit VOLLEM folderPath:
    subs[2].querySelector<HTMLButtonElement>(".iserv-queue-subfolder-deny")!.click();
    expect(onSubFolderDecide).toHaveBeenCalledWith({
      folderPath: "Groups/O Latein 12gN Sz/Lektion 7/Grammatik",
      label: "Lektion 7/Grammatik",
      itemIds: ["b"],
      decision: "deny",
    });
  });

  it("queueActions ohne onOpenPreview: Rendern und Binden laufen ohne Fehler", () => {
    const queue: QueueItem[] = [
      { id: "a", name: "old.pdf", path: "x", hash: "h1", subject: "Mathe", status: "neu" },
    ];
    expect(() =>
      renderSidebarSections(container, {
        ...baseData(),
        queue,
        queueActions: {
          onKeep: () => {},
          onDiscard: () => {},
          onUnsure: () => {},
        },
      })
    ).not.toThrow();
  });

  // Issue #19 P1: Kurs-Kopf bekommt zusätzlich "Kurs verwerfen" (ganzer Kurs).
  it("Issue #19 P1: Kurs-Kopf zeigt Kurs-verwerfen-Button, Klick ruft onFolderDiscard mit Kurs-Pfad", () => {
    const onFolderDiscard = vi.fn();
    const queue: QueueItem[] = [
      { id: "a", name: "v.pdf", path: "Groups/O Latein 12gN Sz/Lektion 7/Vokabeln.pdf", hash: "h1", subject: "", status: "neu" },
      { id: "b", name: "x.pdf", path: "Groups/O Latein 12gN Sz/Memes/x.pdf", hash: "h2", subject: "", status: "neu" },
      { id: "c", name: "d.pdf", path: "Groups/O Latein 12gN Sz/Direkt.pdf", hash: "h3", subject: "", status: "neu" },
    ];
    renderSidebarSections(container, {
      ...baseData(),
      queue,
      queueActions: {
        onKeep: () => {},
        onDiscard: () => {},
        onUnsure: () => {},
        onFolderDiscard,
      },
    });
    const heads = container.querySelectorAll<HTMLElement>(".iserv-queue-folder-head");
    expect(heads.length).toBe(1);
    const courseBtn = heads[0].querySelector<HTMLButtonElement>(".iserv-queue-course-discard")!;
    expect(courseBtn.textContent).toBe("Kurs verwerfen");
    const folderBtn = heads[0].querySelector<HTMLButtonElement>(".iserv-queue-folder-discard");
    expect(folderBtn).toBeTruthy();
    courseBtn.click();
    expect(onFolderDiscard).toHaveBeenCalledTimes(1);
    expect(onFolderDiscard).toHaveBeenCalledWith({
      group: "O Latein 12gN Sz",
      itemIds: ["c", "b", "a"],
      folderPath: "Groups/O Latein 12gN Sz",
    });
  });
});

describe("Einklappbare Sektionen", () => {
  it("Header-Klick toggelt iserv-collapsed-Klasse", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderSidebarSections(container, baseData());
    const header = container.querySelector(".iserv-section-header") as HTMLElement;
    const section = header!.closest(".iserv-section") as HTMLElement;
    header!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(section.classList.contains("iserv-collapsed")).toBe(true);
    header!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(section.classList.contains("iserv-collapsed")).toBe(false);
  });
});

describe("renderSidebarSections — Header-Sync-Button", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("ohne onSyncClick: kein Sync-Button (dezent, ADR-0004)", () => {
    renderSidebarSections(container, baseData());
    expect(container.querySelector(".iserv-sync-btn")).toBeNull();
  });

  it("mit onSyncClick: Button-Zeile über den Sektionen, Klick feuert Callback", () => {
    const onSyncClick = vi.fn();
    renderSidebarSections(container, { ...baseData(), onSyncClick });
    const row = container.querySelector<HTMLElement>(".iserv-header-row");
    expect(row).toBeTruthy();
    // erste Zeile = über allen Sektionen
    expect(container.firstElementChild).toBe(row);
    const btn = row!.querySelector<HTMLElement>(".iserv-sync-btn");
    expect(btn).toBeTruthy();
    expect(btn!.dataset.icon).toBe("refresh-cw"); // Icon-Marker für Obsidian setIcon
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSyncClick).toHaveBeenCalledTimes(1);
  });
});
