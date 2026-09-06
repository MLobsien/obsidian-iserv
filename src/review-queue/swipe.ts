export type SwipeAction = "keep" | "discard" | "tap";

export interface SwipeConfig {
  threshold: number;
  tapThreshold: number;
}

const DEFAULT_CONFIG: SwipeConfig = {
  threshold: 60,
  tapThreshold: 8,
};

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
    this.isDragging = true;
    this.startX = e.clientX;
    this.currentX = e.clientX;
    if (this.element.setPointerCapture) {
      this.element.setPointerCapture(e.pointerId);
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

    const dx = this.currentX - this.startX;
    const absDx = Math.abs(dx);

    this.element.style.transform = "";
    this.element.style.opacity = "";

    if (absDx < this.config.tapThreshold) {
      this.onAction("tap");
    } else if (dx > this.config.threshold) {
      this.onAction("discard");
    } else if (dx < -this.config.threshold) {
      this.onAction("keep");
    }
  }

  destroy(): void {
    this.element.removeEventListener("pointerdown", this.boundPointerDown);
  }
}

export function createDesktopButtons(
  onKeep: () => void,
  onDiscard: () => void,
  onUnsure: () => void
): HTMLElement {
  const container = document.createElement("div");
  container.className = "review-queue-buttons";

  const keepBtn = document.createElement("button");
  keepBtn.textContent = "Behalten";
  keepBtn.addEventListener("click", onKeep);

  const discardBtn = document.createElement("button");
  discardBtn.textContent = "Verwerfen";
  discardBtn.addEventListener("click", onDiscard);

  const unsureBtn = document.createElement("button");
  unsureBtn.textContent = "Unsicher";
  unsureBtn.addEventListener("click", onUnsure);

  container.appendChild(keepBtn);
  container.appendChild(discardBtn);
  container.appendChild(unsureBtn);

  return container;
}
