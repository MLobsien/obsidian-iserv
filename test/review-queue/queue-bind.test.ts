// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bindQueueRows,
  updateQueueRowStatus,
} from "../../src/review-queue/queue-bind";

type MatchMediaStub = (query: string) => { matches: boolean };

function setCoarse(stub: MatchMediaStub): void {
  (window as unknown as { matchMedia: MatchMediaStub }).matchMedia = stub;
}

function installDesktopMatchMedia(): void {
  setCoarse(() => ({ matches: false }));
}

function queueRow(id: string, name: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "iserv-queue-row";
  row.dataset.id = id;
  row.textContent = name;
  document.body.appendChild(row);
  return row;
}

function pointerSwipe(el: HTMLElement, fromX: number, toX: number): void {
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

describe("bindQueueRows", () => {
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

  it("attach Swipe-Handler: links = keep, rechts = discard (IDs aus dataset)", () => {
    queueRow("a", "a.pdf");
    queueRow("b", "b.pdf");
    bindQueueRows(document.body, cbs);

    pointerSwipe(document.querySelector<HTMLElement>('[data-id="a"]')!, 200, 100);
    expect(cbs.onKeep).toHaveBeenCalledWith("a");

    pointerSwipe(document.querySelector<HTMLElement>('[data-id="b"]')!, 100, 200);
    expect(cbs.onDiscard).toHaveBeenCalledWith("b");
  });

  it("Tap ruft onOpenPreview mit der Zeilen-ID", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    pointerSwipe(row, 100, 103); // unter tapThreshold
    expect(cbs.onOpenPreview).toHaveBeenCalledWith("a");
    expect(cbs.onKeep).not.toHaveBeenCalled();
  });

  it("Desktop (pointer: coarse falsch): fügt pro Zeile Behalten/Verwerfen/Unsicher-Buttons ein", () => {
    queueRow("a", "a.pdf");
    queueRow("b", "b.pdf");
    bindQueueRows(document.body, cbs);

    const btnGroups = document.body.querySelectorAll(".review-queue-buttons");
    expect(btnGroups.length).toBe(2);

    const rowA = document.querySelector<HTMLElement>('[data-id="a"]')!;
    const [keepBtn, discardBtn, unsureBtn] =
      rowA.querySelectorAll<HTMLButtonElement>(".review-queue-buttons button");
    keepBtn.click();
    expect(cbs.onKeep).toHaveBeenCalledWith("a");
    discardBtn.click();
    expect(cbs.onDiscard).toHaveBeenCalledWith("a");
    unsureBtn.click();
    expect(cbs.onUnsure).toHaveBeenCalledWith("a");
  });

  it("Touch-Gerät (pointer: coarse): keine Desktop-Buttons, Swipe weiter aktiv", () => {
    setCoarse(() => ({ matches: true }));
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);

    expect(
      document.body.querySelectorAll(".review-queue-buttons").length
    ).toBe(0);

    pointerSwipe(
      document.querySelector<HTMLElement>('[data-id="a"]')!,
      200,
      100
    );
    expect(cbs.onKeep).toHaveBeenCalledWith("a");
  });

  it("ohne onOpenPreview: Tap ist kein Fehler (Callback-Weg entfällt)", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, {
      onKeep: cbs.onKeep,
      onDiscard: cbs.onDiscard,
      onUnsure: cbs.onUnsure,
    });
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    expect(() => pointerSwipe(row, 100, 103)).not.toThrow();
    expect(cbs.onOpenPreview).not.toHaveBeenCalled();
  });

  it("Bind-Callbacks setzen das Status-Badge (keep/discarded/unsure) an der Zeile", () => {
    queueRow("a", "a.pdf");
    queueRow("b", "b.pdf");
    bindQueueRows(document.body, cbs);

    pointerSwipe(document.querySelector<HTMLElement>('[data-id="a"]')!, 200, 100);
    expect(cbs.onKeep).toHaveBeenCalledWith("a");
    expect(
      document.querySelector('[data-id="a"] .iserv-queue-status')?.textContent
    ).toBe("kept");

    pointerSwipe(document.querySelector<HTMLElement>('[data-id="b"]')!, 100, 200);
    expect(
      document.querySelector('[data-id="b"] .iserv-queue-status')?.textContent
    ).toBe("discarded");

    const rowA = document.querySelector<HTMLElement>('[data-id="a"]')!;
    rowA.querySelectorAll<HTMLButtonElement>(".review-queue-buttons button")[2]!.click();
    expect(cbs.onUnsure).toHaveBeenCalledWith("a");
    expect(
      document.querySelector('[data-id="a"] .iserv-queue-status')?.textContent
    ).toBe("unsure");
  });
});

describe("updateQueueRowStatus", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("setzt Status-Badge an der Zeile mit passender ID", () => {
    queueRow("a", "a.pdf");
    updateQueueRowStatus(document.body, "a", "kept");

    const badge = document.body.querySelector(
      '[data-id="a"] .iserv-queue-status'
    ) as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("kept");
    expect(badge.classList.contains("iserv-queue-kept")).toBe(true);
  });

  it("ersetzt vorhandenes Badge statt zu stapeln", () => {
    queueRow("a", "a.pdf");
    updateQueueRowStatus(document.body, "a", "kept");
    updateQueueRowStatus(document.body, "a", "unsure");

    const badges = document.body.querySelectorAll(
      '[data-id="a"] .iserv-queue-status'
    );
    expect(badges.length).toBe(1);
    const badge = badges[0] as HTMLElement;
    expect(badge.textContent).toBe("unsure");
    expect(badge.classList.contains("iserv-queue-unsure")).toBe(true);
  });

  it("entfernt das Badge bei status neu", () => {
    queueRow("a", "a.pdf");
    updateQueueRowStatus(document.body, "a", "kept");
    updateQueueRowStatus(document.body, "a", "neu");
    expect(
      document.body.querySelectorAll('[data-id="a"] .iserv-queue-status').length
    ).toBe(0);
  });

  it("fehlerhafte/fehlende ID ist no-op", () => {
    queueRow("a", "a.pdf");
    expect(() => updateQueueRowStatus(document.body, "nope", "kept")).not.toThrow();
    expect(
      document.body.querySelectorAll('[data-id="a"] .iserv-queue-status').length
    ).toBe(0);
  });
});
