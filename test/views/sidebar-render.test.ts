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

  it("zeigt Mails (Betreff) + Ungelesen-Badge", () => {
    const mails: Mail[] = [
      { id: 1, subject: "HA und Themen Klausur 7.10.", from: "Lehrer", date: "2026-09-26", snippet: "", flags: [] },
      { id: 2, subject: "Tabelle AG1", from: "Andere", date: "2026-09-25", snippet: "", flags: [] },
    ];
    renderSidebarSections(container, { ...baseData(), mails, unread: 2 });
    const section = container.querySelector(".iserv-notifications");
    expect(section).toBeTruthy();
    expect(section!.textContent).toContain("HA und Themen Klausur 7.10.");
    const badge = container.querySelector(".iserv-unread-badge");
    expect(badge!.textContent).toContain("2");
  });

  it("zeigt aktive Arbeiten-Countdown-Zeilen, wenn vorhanden", () => {
    const exams = [{ title: "Klausur Latein", daysLeft: 3 }];
    renderSidebarSections(container, { ...baseData(), exams });
    const sec = container.querySelector(".iserv-notifications");
    expect(sec!.textContent).toContain("Klausur Latein");
    expect(sec!.textContent).toContain("3 Tagen");
  });

  it("mailRowClick: Klick auf Mail-Zeile feuert Callback mit der Mail-ID", () => {
    const mails: Mail[] = [
      { id: 7, subject: "HA und Themen Klausur 7.10.", from: "Lehrer", date: "2026-09-26", snippet: "", flags: [] },
      { id: 11, subject: "Tabelle AG1", from: "Andere", date: "2026-09-25", snippet: "", flags: [] },
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
