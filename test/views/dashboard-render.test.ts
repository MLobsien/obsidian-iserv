// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  renderDashboard,
  dayForOffset,
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

describe("renderDashboard — Day-Pager (eine Tag-Spalte, T26-Kritik)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert NUR EINE Tag-Spalte (heute, Mo 21.9.), keine 5 Spalten", () => {
    renderDashboard(container, baseData());
    const cols = container.querySelectorAll(".iserv-dashboard-day");
    expect(cols.length).toBe(1);
    expect(container.querySelector(".iserv-dashboard-grid")).toBeNull();
    expect(cols[0]!.dataset.weekday).toBe("0");
    const header = container.querySelector(
      ".iserv-dashboard-day-header"
    );
    expect(header!.textContent).toContain("Montag");
    expect(header!.textContent).toContain("21.");
  });

  it("Sektion-Titel bleibt statisch 'Stundenplan' (Datum nur im Day-Header, Runde 4: kein Doppel-Datum)", () => {
    renderDashboard(container, baseData());
    const title = container.querySelector(
      ".iserv-dashboard-timetable .iserv-section-title"
    );
    expect(title!.textContent).toBe("Stundenplan");
    // Datum steckt jetzt NUR im Day-Header (Montag, 21. Sept.) — Runde 4.
    const dayHead = container.querySelector(
      ".iserv-dashboard-day-header"
    );
    expect(dayHead!.textContent).toContain("21. Sept");
  });

  it("Pager-Buttons ‹/› mit Aria-Labels vorhanden", () => {
    renderDashboard(container, baseData());
    const prev = container.querySelector(
      ".iserv-dashboard-pager-prev"
    ) as HTMLButtonElement;
    const next = container.querySelector(
      ".iserv-dashboard-pager-next"
    ) as HTMLButtonElement;
    expect(prev).toBeTruthy();
    expect(next).toBeTruthy();
    expect(prev.getAttribute("aria-label")).toBe("Vorheriger Schultag");
    expect(next.getAttribute("aria-label")).toBe("Nächster Schultag");
  });

  it("Klick auf › feuert onOffsetChange(1), ‹ feuert (−1)", () => {
    const calls: number[] = [];
    renderDashboard(container, {
      ...baseData(),
      onOffsetChange: (o) => calls.push(o),
    });
    const prev = container.querySelector(
      ".iserv-dashboard-pager-prev"
    ) as HTMLElement;
    const next = container.querySelector(
      ".iserv-dashboard-pager-next"
    ) as HTMLElement;
    next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    prev.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toEqual([1, -1]);
  });

  it("dayOffset=2 zeigt Mittwoch (Do, 23.9.)", () => {
    renderDashboard(container, { ...baseData(), dayOffset: 2 });
    const header = container.querySelector(".iserv-dashboard-day-header");
    expect(header!.textContent).toContain("Mittwoch");
    expect(header!.textContent).toContain("23.");
  });

  it("Wochenende wird übersprungen: Freitag +1 → Montag nächster Woche", () => {
    // Friday 2026-09-25
    renderDashboard(container, {
      ...baseData(new Date("2026-09-25T10:00:00+02:00")),
      entries: [entry(4, 1, "Sport"), entry(0, 1, "Mathe")],
      dayOffset: 1,
    });
    const header = container.querySelector(".iserv-dashboard-day-header");
    expect(header!.textContent).toContain("Montag");
    expect(header!.textContent).toContain("28.");
  });

  it("‹ auch am Montag aktiv (Nav-Bugfix: kein Einsperren mehr, Mo ‹ = Fr der Vorwoche)", () => {
    // heute = Montag: prev/next bleiben aktiv, ‹ zeigt jetzt datumsbasiert auf Fr 18.
    renderDashboard(container, baseData());
    const prev = container.querySelector(
      ".iserv-dashboard-pager-prev"
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
  });

  it("Reversibilität über die Wochenend-Grenze: Mo ‹ = Fr der Vorwoche, Mo › = Di", () => {
    // Montag 21.9.2026: ‹ → Freitag 18.9. (Wochenende übersprungen),
    // wieder › → Montag 21. — kein Zustand, in dem zurück nicht mehr geht.
    let clicked: number[] = [];
    renderDashboard(container, {
      ...baseData(new Date("2026-09-21T10:00:00+02:00")),
      onOffsetChange: (o) => clicked.push(o),
    });
    const prev = container.querySelector(
      ".iserv-dashboard-pager-prev"
    ) as HTMLElement;
    prev.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toEqual([-1]);
    // datumsbasiert: offset −1 vom Montag = Freitag 18. (Kein Sa/So)
    expect(dayForOffset(new Date("2026-09-21T10:00:00"), -1)).toBe(4);
  });

  it("Fr › Mo über das Wochenende und zurück Mo ‹ Fr — die Sackgasse ist weg", () => {
    // Freitag 25.9. +1 = Montag 28. (Wochenende übersprungen); von dort
    // muss ‹ wieder erreichbar sein (nicht disabled, feuert −1).
    let clicks = 0;
    renderDashboard(container, {
      ...baseData(new Date("2026-09-25T10:00:00+02:00")),
      entries: [entry(4, 1, "Sport"), entry(0, 1, "Mathe")],
      dayOffset: 1, // zeigt Montag 28.
      onOffsetChange: () => (clicks += 1),
    });
    const prev = container.querySelector(
      ".iserv-dashboard-pager-prev"
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    prev.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toBe(1);
  });

  it("Wochenende als 'heute': Sa zeigt Montag (+0-Raster), ‹ = Freitag", () => {
    // Samstag 26.9.2026: Raster zeigt Montag 28., ‹ → Freitag 25.9.
    renderDashboard(container, {
      ...baseData(new Date("2026-09-26T10:00:00+02:00")),
      entries: [entry(0, 1, "Mathe")],
    });
    const prev = container.querySelector(
      ".iserv-dashboard-pager-prev"
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
  });

  it("dayForOffset: Schultag-Raster Mo–Fr, nie Sa/So", () => {
    // Mi 2026-09-23: +2 → Freitag, +3 → Montag (Sa+So übersprungen)
    expect(dayForOffset(new Date("2026-09-23T10:00:00"), 2)).toBe(4);
    expect(dayForOffset(new Date("2026-09-23T10:00:00"), 3)).toBe(0);
    expect(dayForOffset(new Date("2026-09-23T10:00:00"), -1)).toBe(1); // voriger Schultag = Dienstag
    // Samstag rastet auf Montag weiter
    expect(dayForOffset(new Date("2026-09-26T10:00:00"), 0)).toBe(0);
  });
});

describe("renderDashboard — Day-Column-Inhalte (Pager: nur angezeigter Tag)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
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

  it("Freitag (dayOffset=4) ohne Einträge → 'Kein Unterricht', aber Spalte existiert", () => {
    renderDashboard(container, { ...baseData(), dayOffset: 4 });
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

  it("rendert ALLE gelieferten Mails (kein Kürzen, kein Dedup), Ungelesen-Zeilen-Hilite (Issue #6: kein String-Badge mehr)", () => {
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
    // Issue #6: Badge weg, stattdessen Zeilen-Klasse für Ungelesene (flags leer ⇒ Flag-Logik).
    expect(container.querySelector(".iserv-dashboard-unread-badge")).toBeNull();
    expect(container.querySelectorAll(".iserv-dashboard-mail-unread").length).toBeGreaterThan(0);
  });

  it("Schwerkk: Such-Hook als Input, feuert onMailSearch (kein Client-Filter, debounced)", async () => {
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
    // Debounce 300ms (Runde 4: kein Refetch pro Keystroke):
    await new Promise((r) => setTimeout(r, 350));
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

describe("Day-Pager: echtes Datum über Wochen hinweg (Bugfix: 28.-Loop)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("Freitag +3 Schultage → Mittwoch 30. (nicht 30. der aktuellen Woche falsch gerundet)", () => {
    renderDashboard(container, {
      ...baseData(new Date("2026-09-25T10:00:00+02:00")),
      entries: [entry(2, 1, "Sport")],
      dayOffset: 3,
    });
    const header = container.querySelector(".iserv-dashboard-day-header");
    // Fr 25. +1 = Mo 28., +2 = Di 29., +3 = Mi 30.
    expect(header!.textContent).toContain("30.");
  });

  it("Zwei Wochen weiter: Montag nach Fr +5 → Mo 05.10. (Korrektur Regression)", () => {
    renderDashboard(container, {
      ...baseData(new Date("2026-09-25T10:00:00+02:00")),
      entries: [entry(0, 1, "Sport")],
      dayOffset: 6,
    });
    const header = container.querySelector(".iserv-dashboard-day-header");
    // Fr 25. +5 Schultage = Mo 05.10. (28,29,30,1,2 = Fr02; +1 = Mo05)
    // de-DE-Format ohne führende Null (Runde 4: '5. Okt.')
    expect(header!.textContent).toContain("5. Okt");
  });
});

describe("renderDashboard — Issue #8 (Freistunden + Lehrer)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("Freistunden-Zeile dezente Form: 'Freistunde'-Text, Klasse iserv-free, Slot+Zeit gefüllt, Fach/Raum leer", () => {
    const d = baseData(new Date("2026-09-21T10:00:00+02:00")); // Mo
    // Mo: Mathe 1+2, Latein 3 → Slot 4 frei (Raster 4 Slots)
    d.freeSlots = [{ slot: 4, weekday: 0 }];
    renderDashboard(container, d);
    const free = container.querySelector('[data-weekday="0"] tr.iserv-free');
    expect(free).toBeTruthy();
    expect(free!.querySelector(".iserv-free-subject")!.textContent).toBe("Freistunde");
    expect(free!.querySelector(".iserv-slot")!.textContent).toBe("4.");
    expect(free!.querySelector(".iserv-time")!.textContent).toBe("10:45–11:30");
    expect(free!.querySelector(".iserv-room")!.textContent).toBe("");
  });

  it("Freistunde steht in Slot-Reihenfolge ZWISCHEN den Unterrichtszeilen (kein Doppelstunden-Merge gebrochen: Mathe bleibt 2 Zeilen)", () => {
    const d = baseData(new Date("2026-09-21T10:00:00+02:00"));
    d.entries = [entry(0, 1, "Mathe"), entry(0, 4, "Latein")];
    d.freeSlots = [
      { slot: 2, weekday: 0 },
      { slot: 3, weekday: 0 },
    ];
    renderDashboard(container, d);
    const rows = [...container.querySelectorAll('[data-weekday="0"] tbody tr')];
    const klasses = rows.map((r) => r.className);
    expect(klasses).toEqual([
      "iserv-row iserv-normal",
      "iserv-row iserv-free",
      "iserv-row iserv-free",
      "iserv-row iserv-normal",
    ]);
    const subjects = rows.map((r) => r.querySelector(".iserv-subject")!.textContent);
    expect(subjects[0]).toContain("Mathe");
    expect(subjects[3]).toContain("Latein");
  });

  it("Lehrer-Zeile 'Vorname Nachname' unter dem Fach (strukturierte forename/surname)", () => {
    const d = baseData(new Date("2026-09-21T10:00:00+02:00"));
    d.entries = d.entries.map((e) =>
      e.weekday === 0 && e.slot === 1
        ? { ...e, teacher: { forename: "Kathrin", surname: "Schulz", displayname: "Schulz Kathrin", externalId: "Sz" } }
        : e
    );
    renderDashboard(container, d);
    const firstRow = container.querySelector('[data-weekday="0"] tbody tr')!;
    const teacher = firstRow.querySelector(".iserv-teacher");
    expect(teacher).toBeTruthy();
    expect(teacher!.textContent).toBe("Kathrin Schulz");
  });

  it("ohne freeSlots (undefined) keine iserv-free-Zeilen (fail-soft)", () => {
    const d = baseData();
    renderDashboard(container, d);
    expect(container.querySelector("tr.iserv-free")).toBeNull();
  });
});

describe("R2-K2: Untis-'---'-Ausfälle (Issue #8-Form)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("Untis-Row mit subject '---' → Entfall-Dekor, Fach bleibt Original (nie '---' als Fach)", () => {
    const d = baseData(new Date("2026-09-21T10:00:00+02:00"));
    d.untis = {
      today: [{ klassen: "12", slots: [1, 2], teacher: "---", subject: "---", art: "Entfall", insteadOfTeacher: "Xa" }],
      tomorrow: null,
      messages: [],
      classTokens: ["12"],
    };
    d.entries = d.entries.filter((e) => e.weekday === 0);
    d.entries = d.entries.map((e) =>
      e.weekday === 0 && e.slot === 1 ? { ...e, teacher: { forename: "Julia", surname: "Krüger", displayname: "Krüger Julia", externalId: "Kü" } } : e
    );
    renderDashboard(container, d);
    const row = container.querySelector('[data-weekday="0"] tbody tr')!;
    expect(row.className).toContain("iserv-absence");
    expect(row.querySelector(".iserv-subject")!.textContent!).toContain("Mathe");
    expect(row.querySelector(".iserv-subject")!.textContent!).toContain("Entfall");
    expect(row.textContent!).not.toContain("---");
  });

  it("Untis-Fallback ohne JSON: kein '---' im gerenderten Fachtext", () => {
    const d = baseData(new Date("2026-09-21T10:00:00+02:00"));
    d.untis = {
      today: [
        { klassen: "12", slots: [1], teacher: "---", subject: "---", art: "Entfall", insteadOfTeacher: "Xa" },
        { klassen: "12", slots: [2], teacher: "Ma", subject: "Mat2", art: "Unterr.", insteadOfTeacher: "Kü" },
      ],
      messages: [],
      classTokens: ["12"],
    };
    d.entries = d.entries.filter((e) => e.weekday === 0 && e.slot === 1);
    renderDashboard(container, d);
    const subj = container.querySelector('[data-weekday="0"] tbody tr .iserv-subject')!;
    expect(subj.textContent!).not.toContain("---");
  });
});

describe("renderDashboard — Issue #13: NULL-Fach-Zeilen (Untis-'-'-Form) nie leer rendern", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("NULL-Fach-Entry mit Partner (Plan-Entry, weekday2 slot3): Partner-Fach + 'Entfall'-Dekor statt leerer Zeile", () => {
    // Mi 23.9.2026: Englisch slot 3 NULL-Fach-Entry + Partner-Plan-Entry.
    // Subst-Bridge: courseName = Original-Kurs (fach aus originalTimeTableEntry).
    const d = baseData(new Date("2026-09-23T10:00:00+02:00"));
    d.entries = [
      { ...entry(2, 3, "Englisch", "O Englisch 12gN Ha"), teacher: { forename: "Daren", surname: "Hansen", displayname: "Hansen Daren", externalId: "Ha" } },
      entry(2, 4, "Sport", "O Sport 12 Ha"),
    ];
    // NULL-Fach-Entry: subject "" (SidebarEntry-Form von courseSubject.subject = null).
    d.entries[0].subject = "";
    d.freeSlots = undefined;
    // Substitutions-Dekor: Überschneidung mit Bridge-Kursname (Slot 3).
    d.substs = [
      {
        id: 9001,
        createdAt: "",
        channel: { name: "O Sport 12 Ha", type: "course" },
        channels: [],
        date: { date: "2026-09-23 00:00:00.000", timezone: "Europe/Berlin" },
        hour: 4,
        subject: "",
        substitutionType: "substituted",
        displayMessageForStudents: "",
        courseName: "O Sport 12 Ha",
      },
    ];
    renderDashboard(container, d);
    const rows = [...container.querySelectorAll('[data-weekday="2"] tbody tr')];
    expect(rows.length).toBe(2);
    // Keine Zeile mit leerem Fach.
    for (const r of rows) {
      const subj = r.querySelector(".iserv-subject")!.textContent || "";
      expect(subj.trim().length).toBeGreaterThan(0);
      expect(subj).not.toBe("");
    }
    // Slot-4-Zeile: Partner-Fach 'Sport' + Vertretungs-Dekor.
    const sportRow = rows.find((r) => r.querySelector(".iserv-slot")!.textContent === "4.")!;
    expect(sportRow.querySelector(".iserv-subject")!.textContent).toContain("Sport");
    expect(sportRow.className).toContain("iserv-substituted");
  });
});
