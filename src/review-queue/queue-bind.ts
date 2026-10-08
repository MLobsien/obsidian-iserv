/**
 * Queue-Swipe-Wiring (ADR-0008): verbindet SwipeHandler + Desktop-Buttons
 * mit den gerenderten Queue-Zeilen (`.iserv-queue-row`).
 *
 * - Swipe links = behalten, rechts = verwerfen (Primäresteuerung)
 * - Tap = pdf.js-Preview öffnen (onOpenPreview) — NUR der Tap
 * - Desktop (kein `pointer: coarse`): zusätzlich Behalten/Verwerfen/Unsicher-Buttons
 * - updateQueueRowStatus setzt/entfernt das Status-Badge einer Zeile
 *
 * Issue #5 (User 29.09.2026): nach Keep/Discard/Unsicher slided die Zeile
 * sichtbar raus (transform+opacity+height, CSS-Variable --iserv-swipe-out-ms)
 * und WIRD DANACH aus dem DOM entfernt — kein Badge-Zustand, kein Refresh-
 * Delay. Der synthetische Click derselben Geste wird unterdrückt (Suppression
 * gilt JETZT für ALLE Aktionen, nicht mehr nur für den Tap).
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
  /**
   * Konzept-NEU (Issue #12, Teil 2d): GANZEN Kursordner verwerfen (alle
   * offenen Items der Gruppe discarded + Ordner in DeniedFoldersStore).
   * Payload RAW-Gruppen-Segment + IServ-Ordnerpfad + Item-IDs (folder-groups.ts).
   * Undefiniert = kein Ordner-Verwerfen-UI (Alt-Verhalten).
   */
  onFolderDiscard?: (folder: { group: string; folderPath: string; itemIds: string[] }) => void;
  /**
   * Issue #17 Punkt 4 (Konzept-NEU): Sub-Ordner-Feinschnitt — Erlauben oder
   * Verwerfen eines einzelnen Unterordners (unterhalb eines Kursordners).
   * decision "allow" = DeniedFoldersStore.allow (hebt Deny-Ancestor auf),
   * "deny" = wie onFolderDiscard, nur auf den Sub-Ordner begrenzt.
   */
  onSubFolderDecide?: (d: {
    folderPath: string;
    label: string;
    itemIds: string[];
    decision: "allow" | "deny";
  }) => void;
  /**
   * Issue #5: Slide-out-Vorbereitung. Der Binder markiert die Zeile per
   * CSS-Klasse + CSS-Variablen (--iserv-swipe-dx) und entfernt sie nach der
   * Übersetzung selbst (transitionend + Fallback-Timeout). onKeep/onDiscard
   * feuern SYNCHRON beim Gestenende (Persistenz startet sofort), die Zeile
   * verschwindet danach animiert statt per Full-Section-Rerender-Verzögerung.
   */
}

export type QueueRowStatus = "neu" | "kept" | "discarded" | "unsure";

/**
 * Runde-6-Fix (User 28.09.2026, „zwei Klicks zum Schließen"): erweitert um
 * Issue #5 — dersynthetische Click nach JEDER Swipe-/Pointer-Geste (nicht nur
 * Tap) muss unterdrückt werden: früher feuerte der Zeilen-Klick-Listener den
 * Swipe-Ende-Click als Preview. Der Guard prüft jetzt ein Action-Flag
 * (`data-iserv-acted-at`): frisch (< 500 ms) ⇒ Click gehört zur bereits
 * interpretierten Geste (Tap → Preview, Swipe → Aktion) ⇒ unterdrücken.
 */
const TAP_FLAG = "iservTapAt";
/** Max. Abstand (ms) zwischen Gestenende und synthetischem Click. */
const TAP_FLAG_WINDOW_MS = 500;
const SLIDE_OUT_MS = 260;
const SLIDE_OUT_CLASS = "iserv-queue-row-out";

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

function rowById(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `.iserv-queue-row[data-id="${CSS.escape(id)}"]`
  );
}

/** Aktuelles translateX (px) aus der inline-Transformation lesen. */
function parseTranslateX(row: HTMLElement): number | null {
  const t = row.style.transform || "";
  const m = /translateX\((-?[\d.]+)px\)/.exec(t);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Issue #5 (Ziele 3+4): echte Slide-out-Animation + sofortiges Aufräumen.
 * Die Zeile bekommt dx als CSS-Variable (--iserv-swipe-dx) und die Klasse
 * `iserv-queue-row-out`; styles.css animiert transform (auf Zielseite raus) +
 * opacity + height/margin (Stack zieht sich zusammen). Nach transitionend
 * (Fallback: SLIDE_OUT_MS-Timeout) entfernt sich die Zeile aus dem DOM.
 */
function slideOutRow(container: HTMLElement, id: string, dx: number): void {
  const row = rowById(container, id);
  if (!row) return;
  // Swipe-Richtung als Ziel translateX: 2 Felder weiter als der Finger.
  const targetDx = Math.sign(dx || 1) * Math.max(Math.abs(dx) + 60, 140);
  row.style.setProperty("--iserv-swipe-dx", `${targetDx}px`);
  row.classList.add(SLIDE_OUT_CLASS);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    row.remove();
  };
  row.addEventListener("transitionend", remove, { once: true });
  window.setTimeout(remove, SLIDE_OUT_MS + 120);
}

/**
 * Interne Brücke: handleSwipe markiert nach dem Gestenende die Zeile mit dem
 * Action-Flag (vom Capture-Click-Listener unten gelesen, unterdrückt den
 * synthetischen Click derselben Geste). Bei keep/discard: Slide-out + Callback.
 */
function handleSwipe(
  action: SwipeAction,
  id: string,
  container: HTMLElement,
  opts: QueueBindOptions
): void {
  if (action === "keep" || action === "discard") {
    // Aktion SOFORT (Persistenz stoppt nicht auf die Animation).
    if (action === "keep") opts.onKeep(id);
    else opts.onDiscard(id);
    const row = rowById(container, id);
    if (row) row.dataset[TAP_FLAG] = String(nowMs());
    updateQueueRowStatus(container, id, ACTION_STATUS[action]);
    // Slide-Richtung: dx aus der SwipeHandler-Transformation, falls vorhanden
    // (aktuelle translateX), sonst Signum anhand der Aktion.
    const dxNow = row ? parseTranslateX(row) ?? 0 : 0;
    slideOutRow(container, id, dxNow || (action === "keep" ? -80 : 80));
  } else {
    // Tap: Zeitstempel-Flag setzen (vom Capture-Click-Listener unten gelesen)
    // und die Preview GENAU HIER öffnen — der synthetische Click derselben
    // Geste wird unterdrückt, statt ein zweites Modal zu stapeln.
    const row = rowById(container, id);
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
 * Tap-Guard (Runde-6-Fix-Dokumentation s. Modulkopf, erweitert um Issue #5):
 * EIN Capture-Listener auf dem Container (Eltern-Knoten aller
 * `.iserv-queue-row`) fängt routende Clicks ab, BEVOR sie Ziel-Phasen-Listener
 * sehen. Frisches Gesten-Flag (< 500 ms) ⇒ der Click gehört zur bereits
 * interpretierten Geste (TAP-Preview oder Swipe-Aktion): unterdrücken. Sonst:
 * durchlassen (echter späterer Klick bleibt voll funktionsfähig).
 */
function addGestureClickGuard(container: HTMLElement): void {
  container.addEventListener(
    "click",
    (ev) => {
      const target = ev.target as HTMLElement | null;
      // Clicks, die aus der Desktop-Button-Gruppe kommen, sind eigenständige
      // Aktionen (Behalten/Verwerfen/Unsicher) — NIEMALS als Preview
      // interpretieren (Bubble-Suppressor am Buttons-Container übernimmt das
      // in der Bubble-Phase), aber auch NIEMALS das Gesten-Flag einer anderen
      // Geste fressen (Test-Pfad: keepBtn.click() direkt nach keep → discard).
      if (target?.closest?.(".review-queue-buttons")) return;
      const row = target?.closest?.<HTMLElement>(".iserv-queue-row");
      if (!row) return;
      const tapAt = Number(row.dataset[TAP_FLAG] ?? "0");
      if (!tapAt) return;
      delete row.dataset[TAP_FLAG];
      if (nowMs() - tapAt < TAP_FLAG_WINDOW_MS) {
        // Derselbe Press wie die bereits interpretierte Geste → suppress.
        ev.stopImmediatePropagation();
      }
    },
    { capture: true }
  );
}

/**
 * Desktop-Buttons: eigener Bubble-Suppressor am Button-Container (stoppt das
 * Aufsteigen des Klicks in die Zeile) — verhindert, dass Behalten/Verwerfen/
 * Unsicher-Klicks vom Zeilen-Preview-Listener (sidebar-render.ts) als
 * Vorschau interpretiert werden.
 */
function addBubbleSuppression(buttons: HTMLElement): void {
  buttons.addEventListener("click", (ev) => ev.stopPropagation());
}

/** Button-Aktion (Desktop): Zeile raussliden lassen + Callback sofort. */
function actWithSlide(
  container: HTMLElement,
  id: string,
  action: "keep" | "discard" | "unsure",
  opts: QueueBindOptions
): void {
  // Persistenz SOFORT (nicht auf die Animationszeit warten).
  if (action === "keep") opts.onKeep(id);
  else if (action === "discard") opts.onDiscard(id);
  else opts.onUnsure(id);
  const row = rowById(container, id);
  if (row) row.dataset[TAP_FLAG] = String(nowMs()); // Kill synthetischen Click
  if (action === "unsure") {
    // Unsicher bleibt sichtbar (Badge genügt) — kein Slide-out nötig.
    updateQueueRowStatus(container, id, ACTION_STATUS.unsure);
    return;
  }
  updateQueueRowStatus(container, id, ACTION_STATUS[action]);
  slideOutRow(container, id, action === "keep" ? -1 : 1);
}

/**
 * Bindet alle `.iserv-queue-row` in container an Swipe + Desktop-Buttons.
 * IDs kommen aus `dataset.id`.
 */
export function bindQueueRows(
  container: HTMLElement,
  opts: QueueBindOptions
): void {
  const desktop = isDesktop();

  addGestureClickGuard(container);

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
        () => actWithSlide(container, id, "keep", opts),
        () => actWithSlide(container, id, "discard", opts),
        () => actWithSlide(container, id, "unsure", opts)
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
  const row = rowById(container, id);
  if (!row) return;

  row.querySelector(".iserv-queue-status")?.remove();

  if (status === "neu") return;

  const badge = document.createElement("span");
  badge.className = `iserv-queue-status iserv-queue-${status}`;
  badge.textContent = status;
  row.appendChild(badge);
}
