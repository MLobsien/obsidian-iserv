// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  renderDashboard,
  type DashboardData,
} from "../../src/views/dashboard-render";
import type { Substitution, TimetableSlot } from "../../src/api/timetable";
import type { QueueItem } from "../../src/review-queue/state";
import type { Mail } from "../../src/api/mails";

function entry(
  weekday: number,
  slot: number,
  subject: string,
  course = subject
): DashboardData["entries"][number] {
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

function baseData(now = new Date("2026-09-21T10:00:00+02:00")): DashboardData {
  // Woche: Mo 1+2 Mathe, 3 Latein; Di 1 Deutsch, 2+3 Sport ... Mo–Fr-Spalten
  return {
    entries: [
      entry(0, 1, "Mathe"),
      entry(0, 2, "Mathe"),
      entry(0, 3, "Latein"),
      entry(1, 1, "Deutsch"),
      entry(1, 2, "Sport"),
      entry(1, 3, "Sport"),
      entry(2, 1, "Physik"),
    ],
    slots: SLOTS,
    substs: [],
    now,
  };
}

describe("renderDashboard — Wochen-Grid Mo–Fr", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert 5 Tag-Spalten (Montag bis Freitag), grid-cols-5", () => {
    renderDashboard(container, baseData());
    const grid = container.querySelector(".iserv-dashboard-grid");
    expect(grid).toBeTruthy();
    const cols = grid!.querySelectorAll(".iserv-dashboard-day");
    expect(cols.length).toBe(5); // Mo-Fr only, kein Wochenende
    const headers = [...grid!.querySelectorAll(".iserv-dashboard-day-header")];
    expect(headers.length).toBe(5);
    expect(headers[0]!.textContent).toContain("Montag");
    expect(headers[4]!.textContent).toContain("Freitag");
    // Spalte zeigt auch das Datum (isoForWeekday)
    expect(headers[0]!.textContent).toContain("21.");
  });

  it("KEIN Doppelstunden-Merge: Mathe 1+2 sind zwei Zeilen mit echten Uhrzeiten", () => {
    renderDashboard(container, baseData());
    const monday = container.querySelector('[data-weekday="0"]');
    expect(monday).toBeTruthy();
    const rows = monday!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3); // Slot 1, 2, 3 — 1+2 NICHT gemerged
    expect(rows[0]!.textContent).toContain("1.");
    expect(rows[0]!.textContent).toContain("08:00–08:45"); // nur Slot 1
    expect(rows[0]!.textContent).not.toContain("08:00–09:35"); // keine Merge-Zeitspanne aufs Ende von Slot 2
    expect(rows[1]!.textContent).toContain("2.");
    expect(rows[1]!.textContent).toContain("08:50–09:35");
    expect(rows[2]!.textContent).toContain("3.");
    // keine Slot-Range-Merge-Labels irgendo
    expect(monday!.textContent).not.toContain("1./2.");
  });

  it("Freitag-Spalte ohne Einträge → 'Kein Unterricht', aber Spalte existiert", () => {
    renderDashboard(container, baseData());
    const friday = container.querySelector('[data-weekday="4"]');
    expect(friday).toBeTruthy();
    expect(friday!.textContent).toContain("Kein Unterricht");
  });

  it("Vertretungs-Farben wie Sidebar: Entfall → iserv-absence, Vertretung → iserv-substituted", () => {
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
    d.entries = d.entries.map((e) =>
      e.weekday === 0 && e.subject === "Latein"
        ? { ...e, course: "O Latein 12gN Sz" }
        : e
    );
    renderDashboard(container, d);
    const row = container.querySelector('[data-weekday="0"] tr.iserv-absence');
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("Entfall");
  });
});

describe("renderDashboard — Mails in Gänze + Such-Hook", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert ALLE gelieferten Mails (kein Kürzen, kein Dedup), Ungelesen-Badge", () => {
    const mails: Mail[] = [
      { id: "1", subject: "HA und Themen Klausur 7.10.", from: "Lehrer", date: "2026-09-26", snippet: "", flags: [] },
      { id: "2", subject: "Tabelle AG1", from: "Andere", date: "2026-09-25", snippet: "", flags: [] },
      { id: "3", subject: "HA und Themen Klausur 7.10.", from: "Nochwer", date: "2026-09-24", snippet: "", flags: [] },
    ];
    renderDashboard(container, { ...baseData(), mails, unread: 1 });
    const rows = container.querySelectorAll(".iserv-dashboard-mail-row");
    expect(rows.length).toBe(3); // sämtliche, auch doppelte subjects
    const sec = container.querySelector(".iserv-dashboard-mails");
    expect(sec!.textContent).toContain("Tabelle AG1");
    const badge = container.querySelector(".iserv-dashboard-unread-badge");
    expect(badge!.textContent).toContain("1");
  });

  it("Schwerkk: Such-Hook als Input, feuert onMailSearch (kein Client-Filter)", () => {
    const mails: Mail[] = [
      { id: 1, subject: "A", from: "x", date: "", snippet: "", flags: [] },
      { id: 2, subject: "B", from: "y", date: "", snippet: "", flags: [] },
    ];
    let got: string | null = null;
    renderDashboard(container, {
      ...baseData(),
      mails,
      unread: 0,
      mailSearchQuery: "",
      onMailSearch: (q) => {
        got = q;
      },
    });
    const input = container.querySelector(
      ".iserv-dashboard-mail-search"
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "klausur";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(got).toBe("klausur");
    // Beide Mails weiterhin voll gerendert (kein Client-Side-Filter)
    const rows = container.querySelectorAll(".iserv-dashboard-mail-row");
    expect(rows.length).toBe(2);
  });

  it("ohne onMailSearch wird kein Such-Input gerendert", () => {
    renderDashboard(container, baseData());
    expect(container.querySelector(".iserv-dashboard-mail-search")).toBeNull();
    // ohne Daten gar keine Mails-Sektion
    expect(container.querySelector(".iserv-dashboard-mails")).toBeNull();
  });

  it("Mail-Zeile feuert mailRowClick mit der Mail-ID (string, konsistent zur Sidebar)", () => {
    const mails: Mail[] = [
      { id: "42", subject: "Klick", from: "x", date: "", snippet: "", flags: [] },
    ];
    const clicked: string[] = [];
    renderDashboard(container, {
      ...baseData(),
      mails,
      mailRowClick: (id) => clicked.push(id),
    });
    const row = container.querySelector(".iserv-dashboard-mail-row") as HTMLElement;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toEqual(["42"]);
  });
});

describe("renderDashboard — Review-Queue (volle Breite, gespiegelt zur Sidebar)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("zeigt Queue-Zeilen mit Name+Fach, neueste zuerst", () => {
    const queue: QueueItem[] = [
      { id: "a", name: "old.pdf", path: "x", hash: "h1", subject: "Mathe", status: "neu" },
      { id: "b", name: "new.pdf", path: "y", hash: "h2", subject: "Latein", status: "neu" },
    ];
    renderDashboard(container, { ...baseData(), queue });
    const rows = container.querySelectorAll(".iserv-queue-row");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("new.pdf");
    expect(rows[0]!.textContent).toContain("Latein");
  });

  it("status-Badge wie in der Sidebar gespiegelt", () => {
    const queue: QueueItem[] = [
      { id: "a", name: "x.pdf", path: "x", hash: "h1", subject: "Mathe", status: "unsure" },
    ];
    renderDashboard(container, { ...baseData(), queue });
    const badge = container.querySelector(".iserv-queue-status");
    expect(badge!.textContent).toContain("unsure");
  });
});

describe("renderDashboard — Arbeiten (aktive, mit Countdown)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert aktive Arbeiten mit Tage-Countdown", () => {
    renderDashboard(container, {
      ...baseData(),
      exams: [
        { title: "Klausur Latein", daysLeft: 3 },
        { title: "Klausur Mathe", daysLeft: 1 },
      ],
    });
    const sec = container.querySelector(".iserv-dashboard-exams");
    expect(sec).toBeTruthy();
    expect(sec!.textContent).toContain("Klausur Latein");
    expect(sec!.textContent).toContain("in 3 Tagen");
    expect(sec!.textContent).toContain("in 1 Tag");
  });

  it("heute (daysLeft<=0) → 'heute'", () => {
    renderDashboard(container, {
      ...baseData(),
      exams: [{ title: "Klausur Sport", daysLeft: 0 }],
    });
    const sec = container.querySelector(".iserv-dashboard-exams");
    expect(sec!.textContent).toContain("heute");
  });

  it("ohne Arbeiten → keine Sektion", () => {
    renderDashboard(container, baseData());
    expect(container.querySelector(".iserv-dashboard-exams")).toBeNull();
  });
});

describe("renderDashboard — Callbacks", () => {
  it("Sektionen sind einklappbar (iserv-collapsed toggle)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const mails: Mail[] = [
      { id: 1, subject: "s", from: "f", date: "", snippet: "", flags: [] },
    ];
    renderDashboard(container, { ...baseData(), mails });
    const header = container.querySelector(
      ".iserv-dashboard-mails .iserv-section-header"
    ) as HTMLElement;
    header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const sec = container.querySelector(".iserv-dashboard-mails") as HTMLElement;
    expect(sec.classList.contains("iserv-collapsed")).toBe(true);
  });
});
