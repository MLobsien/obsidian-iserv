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

/**
 * Runde-6-Fix („zwei Klicks zum Schließen"): der Tap des SwipeHandlers lässt
 * den Browser nach pointerup ein Synthetisat-`click` auf dieselbe Geste
 * dispatchen; ohne Suppression würde der Zeilen-Klick-Listener
 * (sidebar-render.ts) ein ZWEITES PdfViewerModal stapeln. Der Capture-Guard
 * in bindQueueRows muss das Synthetisat fressen, echte spätere Klicks aber
 * durchlassen (sonst wäre die Vorschau nach dem ersten Schließen tot).
 */
describe("Runde-6: Tap/Click-Doppelfeuer-Suppression", () => {
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

  it("Tap + synthetischer Click → onOpenPreview GENAU EINMAL (kein Doppelfeuer)", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    // pointerdown/up = Tap-Geste (SwipeHandler feuert onOpenPreview).
    pointerSwipe(row, 100, 103);
    // Browser-Synthetisat derselben Geste: click (bubbles) kurz danach.
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cbs.onOpenPreview).toHaveBeenCalledTimes(1);
  });

  it("echter späterer Klick wird nicht mehr geblockt (Flag gelöscht)", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    // Tap + synthetischer Click: Preview einmal, Flag danach IMMER weg …
    pointerSwipe(row, 100, 103);
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cbs.onOpenPreview).toHaveBeenCalledTimes(1);
    expect(row.dataset.iservTapAt).toBeUndefined();
    // … daher blockt der Guard den nächsten echten Klick nicht: onOpenPreview
    // feuert aber nur aus handleSwipe (tap) — die Zeilen-Preview-Route liegt
    // bei sidebar-render. Hier: Vorschau bleibt GENAU 1 Aufruf, kein Stapel.
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cbs.onOpenPreview).toHaveBeenCalledTimes(1);
    // Neue Tap-Geste (z. B. zweiter Tipp) öffnet natürlich wieder:
    pointerSwipe(row, 100, 103);
    expect(cbs.onOpenPreview).toHaveBeenCalledTimes(2);
  });

  it("Click ohne vorherigen Tap bleibt unangetastet (Desktop-Maus-Route)", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Guard greift nicht ein — der Zeilen-Listener (sidebar-render) würde feuern.
    expect(cbs.onOpenPreview).not.toHaveBeenCalled();
    expect(cbs.onKeep).not.toHaveBeenCalled();
    expect(row.dataset.iservTapAt).toBeUndefined();
  });

  it("Guard frisst auch Button-Click-Fenster (Keep bleibt funktionsfähig)", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    const keepBtn = row.querySelector<HTMLButtonElement>(
      ".review-queue-buttons button"
    )!;
    keepBtn.click();
    expect(cbs.onKeep).toHaveBeenCalledWith("a");
    // Kein Preview-Doppelfeuer durch den Button-Click:
    expect(cbs.onOpenPreview).not.toHaveBeenCalled();
  });
});

/**
 * Runde-6-Zusatz: Cmd-Klick/Modifier-Klicks und Multi-Row-Interactions sind
 * hier nicht betroffen — die Testfälle konzentrieren sich auf die Suppression
 * und Regression an der Row-/Button-Route.
 */
describe("Runde-6: Tap/Click-Doppelfeuer-Suppression (Teil 2, Sweep)", () => {
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

  it("Tap + synthetischer Click: Preview GENAU EINMAL, danach reopen via echtem Klick", () => {
    queueRow("a", "a.pdf");
    bindQueueRows(document.body, cbs);
    const row = document.querySelector<HTMLElement>('[data-id="a"]')!;
    pointerSwipe(row, 100, 103); // tap → preview
    row.dispatchEvent(new MouseEvent("click", { bubbles: true })); // synth
    expect(cbs.onOpenPreview).toHaveBeenCalledTimes(1);
    // Frisches Flag nach demSynthetisat: der nächste echte Klick MUSS wieder
    // durchgehen (guard frisst nur das Synthetisat derselben Geste).
    pointerSwipe(row, 100, 103); // neuer Tap → onOpenPreview erneut
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cbs.onOpenPreview).toHaveBeenCalledTimes(2);
  });
});
