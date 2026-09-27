/**
 * Queue-Swipe-Wiring (ADR-0008): verbindet SwipeHandler + Desktop-Buttons
 * mit den gerenderten Queue-Zeilen (`.iserv-queue-row`).
 *
 * - Swipe links = behalten, rechts = verwerfen (Primäresteuerung)
 * - Tap = pdf.js-Preview öffnen (onOpenPreview)
 * - Desktop (kein `pointer: coarse`): zusätzlich Behalten/Verwerfen/Unsicher-Buttons
 * - updateQueueRowStatus setzt/entfernt das Status-Badge einer Zeile
 */
import {
  SwipeHandler,
  createDesktopButtons,
  type SwipeAction,
} from "./swipe";

export interface QueueBindOptions {
  onKeep: (id: string) => void;
  onDiscard: (id: string) => void;
  onUnsure: (id: string) => void;
  onOpenPreview?: (id: string) => void;
}

export type QueueRowStatus = "neu" | "kept" | "discarded" | "unsure";

/** Status-Semantik der Aktionen: behalten → kept, verwerfen → discarded. */
const ACTION_STATUS = {
  keep: "kept",
  discard: "discarded",
  unsure: "unsure",
} as const;

/** Kein Touch-Gerät → Desktop-Buttons zusätzlich zum Swipe anbieten. */
function isDesktop(): boolean {
  const mq =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)")
      : undefined;
  return !mq?.matches;
}

function handleSwipe(
  action: SwipeAction,
  id: string,
  container: HTMLElement,
  opts: QueueBindOptions
): void {
  if (action === "keep" || action === "discard") {
    updateQueueRowStatus(container, id, ACTION_STATUS[action]);
    if (action === "keep") opts.onKeep(id);
    else opts.onDiscard(id);
  } else {
    opts.onOpenPreview?.(id);
  }
}

/**
 * Bindet alle `.iserv-queue-row` in container an Swipe + Desktop-Buttons.
 * IDs kommen aus `dataset.id`. Die Aktion-Callbacks setzen optimistisch das
 * Status-Badge an der Zeile (Persistenz macht der Koordinator),
 * bevor der übergebene Callback läuft.
 */
export function bindQueueRows(
  container: HTMLElement,
  opts: QueueBindOptions
): void {
  const desktop = isDesktop();

  for (const row of Array.from(
    container.querySelectorAll<HTMLElement>(".iserv-queue-row")
  )) {
    const id = row.dataset.id;
    if (!id) continue;

    const swipe = new SwipeHandler(row, (action) =>
      handleSwipe(action, id, container, opts)
    );
    (row as HTMLElement & { __swipe?: SwipeHandler }).__swipe = swipe;

    if (desktop) {
      row.appendChild(
        createDesktopButtons(
          () => {
            updateQueueRowStatus(container, id, "kept");
            opts.onKeep(id);
          },
          () => {
            updateQueueRowStatus(container, id, "discarded");
            opts.onDiscard(id);
          },
          () => {
            updateQueueRowStatus(container, id, "unsure");
            opts.onUnsure(id);
          }
        )
      );
    }
  }
}

/**
 * Setzt das Status-Badge (kept/discarded/unsure) an der Queue-Zeile `id`
 * bzw. entfernt es bei `neu`. No-op, wenn die Zeile fehlt.
 */
export function updateQueueRowStatus(
  container: HTMLElement,
  id: string,
  status: QueueRowStatus
): void {
  const row = container.querySelector<HTMLElement>(
    `.iserv-queue-row[data-id="${CSS.escape(id)}"]`
  );
  if (!row) return;

  row.querySelector(".iserv-queue-status")?.remove();

  if (status === "neu") return;

  const badge = document.createElement("span");
  badge.className = `iserv-queue-status iserv-queue-${status}`;
  badge.textContent = status;
  row.appendChild(badge);
}
