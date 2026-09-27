// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
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

  it("rendert eine echte Tabelle mit Kopfzeile (Slot|Zeit|Fach|Raum)", () => {
    renderSidebarSections(container, baseData());
    const table = container.querySelector("table.iserv-timetable-table");
    expect(table).toBeTruthy();
    const head = table!.querySelector("thead");
    expect(head!.textContent).toContain("Slot");
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
