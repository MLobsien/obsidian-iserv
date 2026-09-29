export type SwipeAction = "keep" | "discard" | "tap";

export interface SwipeConfig {
  threshold: number;
  tapThreshold: number;
}

const DEFAULT_CONFIG: SwipeConfig = {
  threshold: 60,
  tapThreshold: 8,
};

/** Desktop-Aktion-Buttons: Pointer dort ist keine Swipe-/Tap-Geste (Issue #5). */
export const SWIPE_ORIGIN_BUTTONS = "review-queue-buttons";

/** Prüft über den composed path, ob die Geste in der Button-Gruppe beginnt. */
function originIsButtons(e: PointerEvent): boolean {
  return e
    .composedPath()
    .some(
      (el) =>
        el instanceof Element &&
        (el.classList?.contains(SWIPE_ORIGIN_BUTTONS) ||
          !!el.closest?.(`.${SWIPE_ORIGIN_BUTTONS}`))
    );
}

export class SwipeHandler {
  private element: HTMLElement;
  private onAction: (action: SwipeAction) => void;
  private config: SwipeConfig;
  private startX = 0;
  private currentX = 0;
  private isDragging = false;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(
    element: HTMLElement,
    onAction: (action: SwipeAction) => void,
    config?: Partial<SwipeConfig>
  ) {
    this.element = element;
    this.onAction = onAction;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);

    this.element.addEventListener("pointerdown", this.boundPointerDown);
  }

  private onPointerDown(e: PointerEvent): void {
    // Issue #5 (User: „Preview geht bei Behalten/Verwerfen auf"): echter
    // Mauspointer auf den Desktop-Buttons zielt das Button-Element IN der
    // Zeile. Ohne Guard interpretiert pointerup dx=0 als „tap" →
    // onOpenPreview feuerte bei jedem Button-Klick eine zweite Preview.
    // Pointer-Presses auf der Button-Gruppe sind KEINE Swipe-/Tap-Geste:
    if (originIsButtons(e)) return;
    this.isDragging = true;
    this.startX = e.clientX;
    this.currentX = e.clientX;
    // Issue #5 (Live-Fund): setPointerCapture wirft NotFoundError für
    // nicht existierende pointerIds (z. B. synthetische Events) im echten
    // Chromium — der Handler starb an der Stelle und die move/up-Listener
    // wurden nie registriert (Geste tot). Fail-soft: nur versuchen.
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      /* PointerCapture optional — Geste läuft auch ohne */
    }
    this.element.addEventListener("pointermove", this.boundPointerMove);
    this.element.addEventListener("pointerup", this.boundPointerUp);
    this.element.addEventListener("pointercancel", this.boundPointerUp);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDragging) return;
    this.currentX = e.clientX;
    const dx = this.currentX - this.startX;
    this.element.style.transform = `translateX(${dx}px)`;
    this.element.style.opacity = String(1 - Math.abs(dx) / 200);
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.element.removeEventListener("pointermove", this.boundPointerMove);
    this.element.removeEventListener("pointerup", this.boundPointerUp);
    this.element.removeEventListener("pointercancel", this.boundPointerUp);

    // Issue #5: die Geste kann ÜBER die Buttons gezogen enden (Release über
    // „Behalten"). Auch dann: kein tap, kein Preview, kein Doppelaktion —
    // nur die Visualisierung zurücksetzen.
    if (originIsButtons(e)) {
      this.element.style.transform = "";
      this.element.style.opacity = "";
      return;
    }

    const dx = this.currentX - this.startX;
    const absDx = Math.abs(dx);
    // Issue #5 (Animation): die Transient-Styles werden NICHT mehr sofort
    // geleert — der Slide-out im Container-atur Transformer (queue-bind.ts)
    // übernimmt die Position und animiert weiter raus. Bei Tap ist das
    // Reset sofort ok (keine Aktion).
    if (absDx < this.config.tapThreshold) {
      this.element.style.transform = "";
      this.element.style.opacity = "";
      this.onAction("tap");
    } else if (dx > this.config.threshold) {
      this.onAction("discard");
    } else if (dx < -this.config.threshold) {
      this.onAction("keep");
    } else {
      // Zwischen tapThreshold und threshold: zurückswipen (kein snap-out).
      this.element.style.transform = "";
      this.element.style.opacity = "";
    }
  }

  destroy(): void {
    this.element.removeEventListener("pointerdown", this.boundPointerDown);
  }
}

/**
 * Erstellt die Desktop-Aktion-Buttons (Behalten/Verwerfen/Unsicher). Für das
 * nth-child-Farb-Semantics ist je Button eine explizite Klasse gesetzt
 * (iserv-queue-btn-keep etc.) — nth-child-Selektoren in styles.css bleiben
 * kompatibel.
 */
function actionButton(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add(cls);
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

export function createDesktopButtons(
  onKeep: () => void,
  onDiscard: () => void,
  onUnsure: () => void
): HTMLElement {
  const container = document.createElement("div");
  container.className = "review-queue-buttons";

  container.appendChild(actionButton("iserv-queue-btn-keep", "Behalten", onKeep));
  container.appendChild(actionButton("iserv-queue-btn-discard", "Verwerfen", onDiscard));
  container.appendChild(actionButton("iserv-queue-btn-unsure", "Unsicher", onUnsure));

  return container;
}
