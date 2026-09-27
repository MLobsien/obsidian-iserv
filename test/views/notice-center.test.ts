// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  NoticeCenter,
  renderNoticeCenter,
  type NoticeEntry,
  type NoticeLike,
} from "../../src/views/notice-center";

/** Beobachtbare Fake-Notice (system boundary: Obsidian-Baustein wird injiziert). */
function makeNoticeSpy(): {
  impl: new (text: string, timeout?: number) => NoticeLike;
  created: { text: string; timeout?: number }[];
} {
  const created: { text: string; timeout?: number }[] = [];
  const impl = class {
    text: string;
    timeout?: number;
    constructor(text: string, timeout?: number) {
      this.text = text;
      this.timeout = timeout;
      created.push({ text, timeout });
    }
  };
  return { impl, created };
}

describe("NoticeCenter.notifyOnce", () => {
  let center: NoticeCenter;

  beforeEach(() => {
    center = new NoticeCenter({ notice: makeNoticeSpy().impl });
  });

  it("zeigt dieselbe key-basierte Nachricht zweimal innerhalb des Timeouts nur einmal", () => {
    const n1 = center.notifyOnce("login-fail", "IServ: Login fehlgeschlagen", 5000);
    const n2 = center.notifyOnce("login-fail", "IServ: Login fehlgeschlagen", 5000);
    expect(n1).not.toBeNull();
    expect(n2).toBeNull(); // zweiter Aufruf innerhalb timeout → kein neues Notice
  });

  it("unterschiedliche Keys erscheinen jeweils", () => {
    expect(center.notifyOnce("a", "Eins")).not.toBeNull();
    expect(center.notifyOnce("b", "Zwei")).not.toBeNull();
  });

  it("nach forget(key) erscheint dieselbe Nachricht wieder", () => {
    expect(center.notifyOnce("k", "IServ: Sync abgeschlossen.", 5000)).not.toBeNull();
    center.forget("k");
    expect(center.notifyOnce("k", "IServ: Sync abgeschlossen.", 5000)).not.toBeNull();
  });

  it("nach Ablauf des Timeouts erscheint dieselbe Nachricht wieder", () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      expect(center.notifyOnce("k", "M", 1000)).not.toBeNull();
      vi.setSystemTime(new Date(start + 1100));
      expect(center.notifyOnce("k", "M", 1000)).not.toBeNull();
      vi.useRealTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it("übergibt Text und Timeout an die injizierte Notice-Klasse", () => {
    const spy = makeNoticeSpy();
    const c = new NoticeCenter({ notice: spy.impl });
    c.notifyOnce("k", "IServ: Secret-Store verfügbar — verbunden.", 4000);
    expect(spy.created).toEqual([
      { text: "IServ: Secret-Store verfügbar — verbunden.", timeout: 4000 },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("NoticeCenter.recent — RAM-Ringpuffer", () => {
  let center: NoticeCenter;

  beforeEach(() => {
    center = new NoticeCenter({ notice: makeNoticeSpy().impl });
  });

  it("notifies via notifyOnce unverändert und loggt Metadaten {key, message, at}", () => {
    const c = new NoticeCenter({ notice: makeNoticeSpy().impl, now: () => 1234 });
    c.notifyOnce("k", "Hallo", 5000);
    expect(c.recent(10)).toEqual([
      { key: "k", message: "Hallo", at: 1234 },
    ]);
  });

  it("recent(n) liefert die letzten n Einträge, neueste zuerst", () => {
    let t = 0;
    const c = new NoticeCenter({ notice: makeNoticeSpy().impl, now: () => (t += 1) });
    c.notifyOnce("a", "Erste", 100_000);
    c.notifyOnce("b", "Zweite", 100_000);
    c.notifyOnce("c", "Dritte", 100_000);
    expect(c.recent(2)).toEqual([
      { key: "c", message: "Dritte", at: 3 },
      { key: "b", message: "Zweite", at: 2 },
    ]);
  });

  it("deduplizierter Aufruf innerhalb des Fensters wird NICHT nochmal geloggt", () => {
    const c = new NoticeCenter({ notice: makeNoticeSpy().impl, now: () => 7 });
    c.notifyOnce("k", "M", 60_000);
    c.notifyOnce("k", "M", 60_000); // dedup → null
    expect(c.recent(10)).toHaveLength(1);
  });

  it("forget schließt das Dedup-Fenster, Ringpuffer-Eintrag bleibt", () => {
    const c = new NoticeCenter({ notice: makeNoticeSpy().impl, now: () => 1 });
    c.notifyOnce("k", "A", 1000);
    c.forget("k");
    c.notifyOnce("k", "B", 1000);
    const rec = c.recent(10);
    expect(rec).toEqual([
      { key: "k", message: "B", at: 1 },
      { key: "k", message: "A", at: 1 },
    ]);
  });

  it("Ringpuffer samt Logmöglichkeit: forgetAll löscht nur das Fenster, Log bleibt (RAM-niveau reicht)", () => {
    const c = new NoticeCenter({ notice: makeNoticeSpy().impl, now: () => 1 });
    c.notifyOnce("k", "A", 1000);
    c.forgetAll();
    expect(c.recent(10)).toEqual([{ key: "k", message: "A", at: 1 }]);
  });
});

describe("renderNoticeCenter — obsidian-freies Panel", () => {
  function entry(overrides: Partial<NoticeEntry> = {}): NoticeEntry {
    return {
      key: overrides.key ?? "k",
      message: overrides.message ?? "Sync fehlgeschlagen",
      at: overrides.at ?? Date.parse("2026-09-27T12:34:00"),
      ...overrides,
    };
  }

  it("rendert bei 0 Einträgen GAR NICHTS (kein leeres Panel)", () => {
    const c = document.createElement("div");
    const before = c.childNodes.length;
    renderNoticeCenter(c, []);
    expect(c.childNodes.length).toBe(before);
    expect(c.querySelector(".iserv-notice-center")).toBeNull();
  });

  it("rendert Panel mit Titel „Aktuelle Meldungen“ und Meldung + Zeit", () => {
    const c = document.createElement("div");
    renderNoticeCenter(c, [entry()]);
    const panel = c.querySelector(".iserv-notice-center");
    expect(panel).toBeTruthy();
    expect(
      panel!.querySelector(".iserv-notice-center-title")?.textContent
    ).toContain("Aktuelle Meldungen");
    const row = panel!.querySelector(".iserv-notice-center-row");
    expect(row?.textContent).toContain("Sync fehlgeschlagen");
    expect(
      panel!.querySelector(".iserv-notice-center-time")?.textContent
    ).toContain("12:34");
  });

  it("zeigt die letzten 5 (default N) Meldungen, neueste zuerst; Option count verstellbar", () => {
    const c = document.createElement("div");
    const notices = Array.from({ length: 7 }, (_, i) =>
      entry({ key: `k${i}`, message: `M${i}`, at: Date.parse("2026-09-27T12:0" + i + ":00") })
    );
    renderNoticeCenter(c, notices);
    expect(c.querySelectorAll(".iserv-notice-center-row").length).toBe(5);
    expect(
      c.querySelector(".iserv-notice-center-row")?.textContent
    ).toContain("M6");

    const c2 = document.createElement("div");
    renderNoticeCenter(c2, notices, { n: 2 });
    expect(c2.querySelectorAll(".iserv-notice-center-row").length).toBe(2);
  });

  it("level wirft eine Level-Klasse auf die Zeile (.iserv-notice-center-level-error)", () => {
    const c = document.createElement("div");
    renderNoticeCenter(c, [entry({ level: "error" })]);
    const row = c.querySelector(".iserv-notice-center-row");
    expect(row?.classList.contains("iserv-notice-center-level-error")).toBe(true);
  });
});

describe("NoticeCenter.forgetAll", () => {
  let center: NoticeCenter;

  beforeEach(() => {
    center = new NoticeCenter({ notice: makeNoticeSpy().impl });
  });

  it("setzt das komplette Dedup-Fenster zurück (z. B. nach Sync)", () => {
    center.notifyOnce("x", "A");
    center.notifyOnce("y", "B");
    center.forgetAll();
    expect(center.notifyOnce("x", "A")).not.toBeNull();
    expect(center.notifyOnce("y", "B")).not.toBeNull();
  });
});
