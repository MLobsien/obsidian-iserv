// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SwipeHandler, createDesktopButtons } from "../../src/review-queue/swipe";

function createElement(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function pointerEvent(
  el: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number
): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      clientX: x,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
    })
  );
}

describe("SwipeHandler", () => {
  let el: HTMLElement;
  let actions: string[];
  let handler: SwipeHandler;

  beforeEach(() => {
    el = createElement();
    actions = [];
    handler = new SwipeHandler(el, (a) => actions.push(a));
  });

  afterEach(() => {
    handler.destroy();
    el.remove();
  });

  it("detects swipe right (discard)", () => {
    pointerEvent(el, "pointerdown", 100);
    pointerEvent(el, "pointermove", 200);
    pointerEvent(el, "pointerup", 200);

    expect(actions).toEqual(["discard"]);
  });

  it("detects swipe left (keep)", () => {
    pointerEvent(el, "pointerdown", 200);
    pointerEvent(el, "pointermove", 100);
    pointerEvent(el, "pointerup", 100);

    expect(actions).toEqual(["keep"]);
  });

  it("detects tap (small dx)", () => {
    pointerEvent(el, "pointerdown", 100);
    pointerEvent(el, "pointermove", 103);
    pointerEvent(el, "pointerup", 103);

    expect(actions).toEqual(["tap"]);
  });

  it("does not trigger action if threshold not reached", () => {
    pointerEvent(el, "pointerdown", 100);
    pointerEvent(el, "pointermove", 140);
    pointerEvent(el, "pointerup", 140);

    expect(actions).toEqual([]);
  });
});

describe("createDesktopButtons", () => {
  it("creates three buttons with correct labels", () => {
    const container = createDesktopButtons(
      () => {},
      () => {},
      () => {}
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toBe("Behalten");
    expect(buttons[1].textContent).toBe("Verwerfen");
    expect(buttons[2].textContent).toBe("Unsicher");
  });

  it("triggers correct callbacks on click", () => {
    const keep = vi.fn();
    const discard = vi.fn();
    const unsure = vi.fn();
    const container = createDesktopButtons(keep, discard, unsure);
    const buttons = container.querySelectorAll("button");

    buttons[0].click();
    expect(keep).toHaveBeenCalledOnce();

    buttons[1].click();
    expect(discard).toHaveBeenCalledOnce();

    buttons[2].click();
    expect(unsure).toHaveBeenCalledOnce();
  });
});
