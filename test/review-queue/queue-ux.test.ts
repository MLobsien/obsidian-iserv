// @vitest-environment jsdom
/**
 * Issue #5 (User 29.09.2026): Review-Queue UX — Behalten/Verwerfen/Unsicher
 * öffnet KEINE Preview, Swipe-Ende unterdrückt den synthetischen Click,
 * Zeilen sliden animiert raus und entfernen sich aus dem DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bindQueueRows,
  updateQueueRowStatus,
} from "../../src/review-queue/queue-bind";

type MatchMediaStub = (query: string) => { matches: boolean };

function installDesktopMatchMedia(): void {
  (window as unknown as { matchMedia: MatchMediaStub }).matchMedia = () => ({
    matches: false,
  });
}

function queueRow(id: string, name: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "iserv-queue-row";
  row.dataset.id = id;
  row.textContent = name;
  document.body.appendChild(row);
  return row;
}

function pointerSeq(
  el: HTMLElement,
  fromX: number,
  toX: number
): void {
  el.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: fromX,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
    })
  );
  el.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: toX,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
    })
  );
  el.dispatchEvent(
    new PointerEvent("pointerup", {
      clientX: toX,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
    })
  );
}

describe("Issue #5: Preview-Suppression bei Aktionen", () => {
  let cbs: {
    onKeep: ReturnType<typeof vi.fn>;
    onDiscard: ReturnType<typeof vi.fn>;
    onUnsure: ReturnType<typeof vi.fn>;
    onOpenPreview: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    document.body.replaceChildren();
    installDesktopMatchMedia();
    cbs = {
      onKeep: vi.fn(),
      onDiscard: vi.fn(),
      onUnsure: vi.fn(),
      onOpenPreview: vi.fn(),
    };
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("Behalten-Button-Klick: onKeep feuert, KEIN onOpenPreview", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const btn = document
      .querySelector<HTMLElement>('[data-id="a"]')!
      .querySelector<HTMLButtonElement>(".iserv-queue-btn-keep")!;
    btn.click();
    expect(cbs.onKeep).toHaveBeenCalledWith("a");
    expect(cbs.onOpenPreview).not.toHaveBeenCalled();
  });

  it("Verwerfen-Button-Klick: onDiscard feuert, KEIN Preview", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    document
      .querySelector<HTMLElement>('[data-id="a"]')!
      .querySelector<HTMLButtonElement>(".iserv-queue-btn-discard")!
      .click();
    expect(cbs.onDiscard).toHaveBeenCalledWith("a");
    expect(cbs.onOpenPreview).not.toHaveBeenCalled();
  });

  it("Unsicher-Button: onUnsure, Zeile bleibt (Badge, kein Slide-out)", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    row
      .querySelector<HTMLButtonElement>(".iserv-queue-btn-unsure")!
      .click();
    expect(cbs.onUnsure).toHaveBeenCalledWith("a");
    expect(row.classList.contains("iserv-queue-row-out")).toBe(false);
    expect(
      row.querySelector(".iserv-queue-status.iserv-queue-unsure")
    ).toBeTruthy();
  });

  it("fertiggestellter Swipe + synthetischer Click: KEIN Preview-Doppelfeuer", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    pointerSeq(row, 100, 200); // discard-Geste
    expect(cbs.onDiscard).toHaveBeenCalledWith("a");
    // Browser-Synthetisat derselben Geste (früher → zwei gestapelte Modals):
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cbs.onOpenPreview).not.toHaveBeenCalled();
  });

  it("echter Zeilen-Klick NACH einer Aktion bleibt funktionsfähig", () => {
    // unsure bleibt in der Queue (kein Slide-out) → Zeile bleibend klickbar.
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    row
      .querySelector<HTMLButtonElement>(".iserv-queue-btn-unsure")!
      .click();
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Der Zeilen-Preview-Listener (sidebar-render.ts) ist hier nicht gebunden;
    // assert: Guard hat den echten Klick nicht gefressen (kein Flag mehr da).
    expect(row.dataset.iservTapAt).toBeUndefined();
  });
});

describe("Issue #5: Slide-out-Animation + sofortiger Stack-Abräum", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    installDesktopMatchMedia();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("Keep-Button: Zeile bekommt out-Klasse + dx-Richtung und entfernt sich nach der Animation", async () => {
    queueRow("a", "a.pdf");
    const onKeep = vi.fn();
    bindQueueRows(document.body, {
      onKeep,
      onDiscard: vi.fn(),
      onUnsure: vi.fn(),
      onOpenPreview: vi.fn(),
    });
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    row.querySelector<HTMLButtonElement>(".iserv-queue-btn-keep")!.click();
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(row.classList.contains("iserv-queue-row-out")).toBe(true);
    const dx = row.style.getPropertyValue("--iserv-swipe-dx");
    expect(dx).toMatch(/px$/);
    expect(parseInt(dx, 10)).toBeLessThan(0); // keep → nach links raus
    //.transitionend (opacity) entfernt die Zeile:
    row.dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(row.isConnected).toBe(false);
  });

  it("Discard-Swipe: Slide nach rechts, Fallback-Timeout entfernt die Zeile", () => {
    queueRow("b", "b.pdf");
    const onDiscard = vi.fn();
    bindQueueRows(document.body, {
      onKeep: vi.fn(),
      onDiscard,
      onUnsure: vi.fn(),
      onOpenPreview: vi.fn(),
    });
    const row = document.querySelector<HTMLElement>('[data-id="b"]')!;
    pointerSeq(row, 100, 200);
    expect(row.classList.contains("iserv-queue-row-out")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(row.isConnected).toBe(false);
  });

  it("keep-Callback feuert SOFORT beim Gestenende (nicht erst nach der Animation)", () => {
    queueRow("c", "c.pdf");
    const onKeep = vi.fn();
    bindQueueRows(document.body, {
      onKeep,
      onDiscard: vi.fn(),
      onUnsure: vi.fn(),
      onOpenPreview: vi.fn(),
    });
    const row = document.querySelector<HTMLElement>('[data-id="c"]')!;
    row.querySelector<HTMLButtonElement>(".iserv-queue-btn-keep")!.click();
    expect(onKeep).toHaveBeenCalledTimes(1); // synchron vor dem Timeout
    vi.advanceTimersByTime(600);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});

describe("issue #5: updateQueueRowStatus bleibt kompatibel", () => {
  it("Badge an existierender Zeile setzen", () => {
    queueRow("x", "x.pdf");
    updateQueueRowStatus(document.body, "x", "kept");
    expect(
      document.querySelector('[data-id="x"] .iserv-queue-status.iserv-queue-kept')
    ).toBeTruthy();
  });
});
