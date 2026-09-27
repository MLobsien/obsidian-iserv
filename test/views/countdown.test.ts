// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  renderCountdownPanel,
  type CountdownItem,
} from "../../src/views/countdown";
import { computeStatus } from "../../src/exams/exam-status";
import { ExamType } from "../../src/exams/template";

const NOW = new Date("2026-09-27T12:00:00");

function item(partial: Partial<CountdownItem> = {}): CountdownItem {
  return {
    id: "exam-1",
    title: "Klausur Latein",
    type: ExamType.Klausur,
    date: new Date("2026-10-01T08:00:00"), // 4 Tage nach NOW
    points: 15, // Klausurfenster 10 Tage → im Fenster
    ...partial,
  };
}

describe("renderCountdownPanel — Struktur (ADR-0006 Dashboard-Panel)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert Panel 'Arbeiten & Countdown' mit Titel, Badge, X Tage", () => {
    renderCountdownPanel(container, [item()], {}, { now: NOW });
    const panel = container.querySelector(".iserv-countdown");
    expect(panel).toBeTruthy();
    expect(panel!.querySelector(".iserv-countdown-title")!.textContent).toBe(
      "Arbeiten & Countdown"
    );
    const row = panel!.querySelector(".iserv-countdown-row") as HTMLElement;
    expect(row.dataset.id).toBe("exam-1");
    expect(row.querySelector(".iserv-countdown-label")!.textContent).toBe(
      "Klausur Latein"
    );
    expect(row.querySelector(".iserv-countdown-days")!.textContent).toBe(
      "4 Tage"
    );
  });

  it("1 Tag → '1 Tag', 0/approaching → 'heute'", () => {
    renderCountdownPanel(
      container,
      [item({ id: "a", date: new Date("2026-09-28T08:00:00") })],
      {},
      { now: NOW }
    );
    expect(
      container.querySelector(".iserv-countdown-days")!.textContent
    ).toBe("1 Tag");
  });

  it("heute (Termin = now-Tag) → 'heute'", () => {
    renderCountdownPanel(
      container,
      [item({ id: "a", date: new Date("2026-09-27T08:00:00") })],
      {},
      { now: NOW }
    );
    expect(
      container.querySelector(".iserv-countdown-days")!.textContent
    ).toBe("heute");
  });

  it("leere Liste → Panel mit Leerzustand", () => {
    renderCountdownPanel(container, [], {}, { now: NOW });
    const panel = container.querySelector(".iserv-countdown");
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("Keine Arbeiten");
  });

  it("eine Zeile pro Arbeit", () => {
    renderCountdownPanel(
      container,
      [
        item({ id: "a", title: "A" }),
        item({ id: "b", title: "B", date: new Date("2026-10-14T08:00:00") }),
      ],
      {},
      { now: NOW }
    );
    expect(container.querySelectorAll(".iserv-countdown-row").length).toBe(2);
  });
});

describe("renderCountdownPanel — Status-Badge + Farbcodes (computeStatus)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("im Fenster → Badge in-vorbereitung mit accent-Klasse", () => {
    renderCountdownPanel(container, [item()], {}, { now: NOW });
    const badge = container.querySelector(".iserv-countdown-status") as HTMLElement;
    expect(badge.textContent).toBe("in Vorbereitung");
    expect(badge.className).toContain("iserv-countdown-status-in-vorbereitung");
  });

  it("vor Fensterstart → Badge geplant (muted-Klasse)", () => {
    renderCountdownPanel(
      container,
      [item({ id: "a", date: new Date("2026-11-30T08:00:00") })],
      {},
      { now: NOW }
    );
    const badge = container.querySelector(".iserv-countdown-status") as HTMLElement;
    expect(badge.textContent).toBe("geplant");
    expect(badge.className).toContain("iserv-countdown-status-geplant");
  });

  it("Farbcode-Klassen je Status (muted/accent/success/warning)", () => {
    const cases: Array<[string, string]> = [
      ["geplant", "iserv-countdown-status-geplant"],
      ["in-vorbereitung", "iserv-countdown-status-in-vorbereitung"],
      ["fertig", "iserv-countdown-status-fertig"],
      ["verschoben", "iserv-countdown-status-verschoben"],
    ];
    for (const [status, cls] of cases) {
      const c = document.createElement("div");
      document.body.appendChild(c);
      renderCountdownPanel(
        c,
        [item({ id: "x", status })],
        {},
        { now: NOW }
      );
      const badge = c.querySelector(".iserv-countdown-status") as HTMLElement;
      expect(badge.className).toContain(cls);
      c.remove();
    }
  });

  it("Importierter (F5) Status gewinnt (F5-override)", () => {
    renderCountdownPanel(
      container,
      [item({ id: "a", status: "verschoben" })],
      {},
      { now: NOW }
    );
    const badge = container.querySelector(".iserv-countdown-status") as HTMLElement;
    expect(badge.textContent).toBe("verschoben");
  });
});

describe("renderCountdownPanel — Badge-Klick = Status-Cycle (onStatusChange)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("Klick auf Badge feuert onStatusChange(examId, nextStatus)", () => {
    const calls: Array<[string, string]> = [];
    renderCountdownPanel(
      container,
      [item()],
      { onStatusChange: (id, s) => calls.push([id, s]) },
      { now: NOW }
    );
    const badge = container.querySelector(".iserv-countdown-status") as HTMLElement;
    badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toEqual([["exam-1", "fertig"]]);
  });

  it("Klick-Cycle folgt der Reihenfolge geplant → in-vorbereitung → fertig → verschoben → geplant", () => {
    // direkt: Übergangslogik über cycleStatus (rein funktional).
    const seq = ["geplant", "in-vorbereitung", "fertig", "verschoben"] as const;
    for (let i = 0; i < seq.length; i++) {
      const c = document.createElement("div");
      document.body.appendChild(c);
      const calls: Array<[string, string]> = [];
      renderCountdownPanel(
        c,
        [item({ id: "e", status: seq[i] })],
        { onStatusChange: (id, s) => calls.push([id, s]) },
        { now: NOW }
      );
      (c.querySelector(".iserv-countdown-status") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      expect(calls[0]![1]).toBe(seq[(i + 1) % seq.length]);
      c.remove();
    }
  });
});

describe("renderCountdownPanel — Status-Ableitung via computeStatus", () => {
  it("Konsistenz: gerenderter Badge = computeStatus(Exam, now)", () => {
    const exam = item({ date: new Date("2026-11-30T08:00:00") });
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderCountdownPanel(container, [exam], {}, { now: NOW });
    const badge = container.querySelector(".iserv-countdown-status") as HTMLElement;
    const expected = computeStatus(
      { id: exam.id, type: exam.type, date: exam.date, points: exam.points },
      NOW
    );
    expect(badge.className).toContain(`iserv-countdown-status-${expected}`);
  });
});
