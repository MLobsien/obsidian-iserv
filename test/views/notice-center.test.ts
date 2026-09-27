// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  NoticeCenter,
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
