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

/**
 * Runde-6-Fix (User 28.09.2026, „zwei Klicks zum Schließen"): der Tap auf
 * eine Queue-Zeile wird DOPPELT gefeuert — einmal vom SwipeHandler
 * (pointerdown/pointerup → onAction("tap") → onOpenPreview) und einmal vom
 * Browser-Synthetisat: zu derselben Geste dispatcht der Browser nach pointerup
 * ein `click`-Event, das der Zeilen-Klick-Listener (sidebar-render.ts,
 * `.iserv-queue-row-clickable`) ebenfalls in onPreview übersetzt. Ergebnis:
 * ZWEI gestapelte PdfViewerModals pro Klick — das Schließen wirkt deshalb wie
 * „zwei Klicks" (der erste ESC-/Overlay-Klick schließt nur das oberste Modal).
 *
 * Strategie (eine, dokumentiert, nur hier in queue-bind.ts):
 * - handleSwipe setzt im Tap-Zweig einen Zeitstempel-Flag am Row
 *   (`data-iserv-tap-at`, performance.now-Basis) und öffnet die Preview GENAU
 *   HIER (Swipe-Interpretation hat Vorrang vor dem Click-Synthetisat).
 * - bindQueueRows registriert pro Container EINEN Click-Listener in der
 *   CAPTURE-Phase (Parent-Knoten der Rows): dort läuft er garantiert vor
 *   allen Ziel-Phasen-Listenern — z. B. dem Zeilen-Klick-Listener aus
 *   sidebar-render.ts, der denselben Click sonst als zweite Preview
 *   interpretieren würde. Findet der Listener das Tap-Flag: Flag wird immer
 *   gelöscht (kein „vergessener" Zustand); IST das Flag frisch (< 500 ms
 *   bzw. TAP_FLAG_WINDOW_MS → der Click gehört zur Tap-Geste), wird er per
 *   stopImmediatePropagation beendet. Ein späterer echter Klick (> 500 ms)
 *   läuft normal und öffnet die Vorschau erneut.
 * - Desktop-Buttons: eigener Bubble-Suppressor am `.review-queue-buttons`-
 *   Container (addBubbleSuppression) — verhindert, dass Behalten/Verwerfen/
 *   Unsicher-Klicks in der Zeile zusätzlich als Preview interpretiert werden.
 * sidebar-render.ts bleibt unverändert; Keyboard-Preview (Enter/Space am Row)
 * läuft wie gehabt über keydown, nicht click.
 */
const TAP_FLAG = "iservTapAt";
/** Max. Abstand (ms) zwischen Tap-pointerup und synthetischem Click. */
const TAP_FLAG_WINDOW_MS = 500;

/** performance.now-Fallback (ähnliche Umgebung hat möglicherweise keinen Clock). */
function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Kein Touch-Gerät → Desktop-Buttons zusätzlich zum Swipe anbieten. */
function isDesktop(): boolean {
  const mq =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)")
      : undefined;
  return !mq?.matches;
}

/**
 * Interne Brücke: handleSwipe markiert nach einem erkannten Tap die Zeile mit
 * dem dataset-Flag, damit der nachfolgende synthetische Click (dieselbe
 * Geste!) capture-seitig unterdrückt wird statt erneut die Preview zu öffnen.
 */
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
    // Tap: Zeitstempel-Flag setzen (vom Capture-Click-Listener unten gelesen)
    // und die Preview GENAU HIER öffnen — der synthetische Click derselben
    // Geste wird unterdrückt, statt ein zweites Modal zu stapeln.
    const row = container.querySelector<HTMLElement>(
      `.iserv-queue-row[data-id="${CSS.escape(id)}"]`
    );
    if (row) row.dataset[TAP_FLAG] = String(nowMs());
    opts.onOpenPreview?.(id);
  }
}

/** Status-Semantik der Aktionen: behalten → kept, verwerfen → discarded. */
const ACTION_STATUS = {
  keep: "kept",
  discard: "discarded",
  unsure: "unsure",
} as const;

/**
 * Tap-Guard (Runde-6-Fix-Dokumentation s. Modulkopf): EIN Capture-Listener
 * auf dem Container (Eltern-Knoten aller `.iserv-queue-row`) fängt routende
 * Clicks ab, BEVOR sie Ziel-Phasen-Listener sehen (u. a. den Zeilen-Klick-
 * Listener aus sidebar-render.ts). Frisches `data-iserv-tap-at` (< 500 ms)
 * ⇒ der Click gehört zur bereits interpretierten Tap-Geste: unterdrücken.
 * Sonst (alter/verwaister Flag oder späterer echter Klick): durchlassen.
 * Das Flag wird in jedem Fall gelöscht (kein veralteter Zustand).
 */
function addContainerTapGuard(container: HTMLElement): void {
  container.addEventListener(
    "click",
    (ev) => {
      const target = ev.target as HTMLElement | null;
      const row = target?.closest?.<HTMLElement>(".iserv-queue-row");
      if (!row) return;
      const tapAt = Number(row.dataset[TAP_FLAG] ?? "0");
      if (!tapAt) return;
      delete row.dataset[TAP_FLAG];
      if (nowMs() - tapAt < TAP_FLAG_WINDOW_MS) {
        // Derselbe press wie der Swipe-Tap → Preview schon offen.
        ev.stopImmediatePropagation();
      }
    },
    { capture: true }
  );
}

/**
 * Desktop-Buttons: eigener Bubble-Suppressor am Button-Container. Die
 * Button-Callbacks laufen am Button (target phase) selbst; der stopPropagation
 * im Bubble des Containers verhindert NUR noch das Aufsteigen in die Zeile —
 * ohne ihn würde der Zeilen-Preview-Listener (sidebar-render.ts) jede
 * Behalten/Verwerfen-Klicks zusätzlich als Vorschau interpretieren.
 */
function addBubbleSuppression(buttons: HTMLElement): void {
  buttons.addEventListener("click", (ev) => ev.stopPropagation());
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

  addContainerTapGuard(container);

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
      const buttons = createDesktopButtons(
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
      );
      addBubbleSuppression(buttons);
      row.appendChild(buttons);
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
