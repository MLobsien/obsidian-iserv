/**
 * Pagination-Komponente (T9/T10) — pure, obsidian-frei (Seam-Split à la ADR-0007).
 *
 * Zwei Ebenen:
 * - `paginate()` — pure Slicing-Logik: Liste → Seitenfenster + totalPages (geklemmt).
 * - `renderPagination()` — DOM-Factory: knopfbasiert ‹ 1 2 3 ›, ARIA-Labels.
 *
 * Theme-Variablen leben in styles.css (.iserv-pagination*), keine Obsidian-Imports
 * → Node-testbar (#vitest-environment jsdom für die DOM-Tests).
 *
 * Nur UI-Ebene: die server-seitige Suche (searchMails, q= + limit/offset, Spike #19
 * verifiziert) bleibt unverändert — diese Komponente paginiert die lokal gelieferte
 * Liste im View.
 */

/** Mail-Seitengröße (T9/T10: pageSize=10 pro Request/Seite). */
export const MAIL_PAGE_SIZE = 10;

/**
 * Seitengröße der Browser-Buttons (Sidebar-Kontext): Wie viele Mails pro
 * server-seitigem Fetch. refreshSidebar(page) mapped page → limit/offset.
 */
export const SIDEBAR_PAGE_SIZE = 10;

/**
 * Button-Paar für server-seitiges Blättern (User-Feedback: "Buttons, um ältere
 * Mails zu browsen"): ‹ Ältere Mails / Neuere Mails ›. page ist 0-basiert und
 * wird vom View geliefert (State im ViewModel); disabled an den Grenzen.
 * Seitenzahl-Buttons entfallen bewusst — bei limit/offset-Fetches ist die
 * Gesamtseitenzahl oft unbekannt/teuer.
 */
export function renderBrowseButtons(
  container: HTMLElement,
  opts: {
    page: number;
    hasNewer?: boolean;
    hasOlder?: boolean;
    onPage?(page: number): void;
  }
): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "iserv-pagination iserv-mail-browse";
  nav.setAttribute("role", "navigation");
  nav.setAttribute("aria-label", "Mails durchblättern");

  const older = document.createElement("button");
  older.type = "button";
  older.className = "iserv-pagination-btn iserv-pagination-older";
  older.textContent = "‹ Ältere Mails";
  older.setAttribute("aria-label", "Ältere Mails laden");
  older.disabled = opts.hasOlder === false;
  if (!older.disabled && opts.onPage) {
    older.addEventListener("click", () => opts.onPage?.(opts.page + 1));
  }
  nav.appendChild(older);

  const newer = document.createElement("button");
  newer.type = "button";
  newer.className = "iserv-pagination-btn iserv-pagination-newer";
  newer.textContent = "Neuere Mails ›";
  newer.setAttribute("aria-label", "Neuere Mails laden");
  newer.disabled = opts.page <= 0 || opts.hasNewer === false;
  if (!newer.disabled && opts.onPage) {
    newer.addEventListener("click", () => opts.onPage?.(opts.page - 1));
  }
  nav.appendChild(newer);

  container.appendChild(nav);
  return nav;
}

export interface PaginateResult<T> {
  /** Slice der aktuellen Seite. */
  items: T[];
  /** Aktuelle Seite (0-basiert), geklemmt auf [0, totalPages - 1]. */
  page: number;
  /** Gesamtseiten, immer >= 1 (auch für eine leere Liste). */
  totalPages: number;
  /** Gesamtzahl der Items über alle Seiten. */
  total: number;
}

/** Nicht-endliche/nicht-positive Werte auf 1 klemmen. */
function positiveInt(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

/**
 * Pure Slicing-Logik: `items` in Blöcke à `pageSize` teilen, Seite `page`
 * (0-basiert) zurückgeben. page wird auf den gültigen Bereich geklemmt,
 * pageSize <= 0/NaN wird wie pageSize=1 behandelt — keinThrow, garantiert
 * gültige Result-Werte.
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number
): PaginateResult<T> {
  const size = positiveInt(pageSize);
  const list = items ?? [];
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const raw = Number.isFinite(page) ? Math.floor(page) : 0;
  const current = Math.min(Math.max(raw, 0), totalPages - 1);
  return {
    items: list.slice(current * size, (current + 1) * size),
    page: current,
    totalPages,
    total: list.length,
  };
}

export interface PaginationRenderOptions {
  /** 0-basierte aktuelle Seite. */
  page: number;
  totalPages: number;
  /** Klick auf eine Seitenzahl/‹/› → Ziel-Seite (0-basiert). */
  onPage?(page: number): void;
  /** aria-label des nav-Containers. Default "Seitennavigation". */
  ariaLabel?: string;
  /** Max. Anzahl Seitenzahl-Buttons (Sliding Window). Default 7. */
  maxButtons?: number;
}

/**
 * Sliding Window an Seitenindizes (0-basiert), zentriert um `page`, geklemmt
 * an [0, totalPages-1]. Bei totalPages <= maxButtons einfach alle Seiten.
 */
function pageWindow(
  page: number,
  totalPages: number,
  maxButtons: number
): number[] {
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  const half = Math.floor(maxButtons / 2);
  const start = Math.min(Math.max(0, page - half), totalPages - maxButtons);
  return Array.from({ length: maxButtons }, (_, i) => start + i);
}

/**
 * DOM-Factory der Pagination: nav.iserv-pagination mit prev/next und
 * Seitenzahl-Buttons. prev/next sind auf den Grenzen disabled, die aktive
 * Seite trägt aria-current="page". Ruft renderPagination nie selbst auf —
 * der View hält den Seitenzustand (ViewModel) und rendert in onPage neu.
 */
export function renderPagination(
  container: HTMLElement,
  opts: PaginationRenderOptions
): HTMLElement {
  const totalPages = Math.max(1, Math.floor(opts.totalPages) || 1);
  const rawPage = Number.isFinite(opts.page) ? Math.floor(opts.page) : 0;
  const page = Math.min(Math.max(rawPage, 0), totalPages - 1);
  const maxButtons = Math.max(1, Math.floor(opts.maxButtons ?? 7));

  const nav = document.createElement("nav");
  nav.className = "iserv-pagination";
  nav.setAttribute("role", "navigation");
  nav.setAttribute("aria-label", opts.ariaLabel ?? "Seitennavigation");

  const makeBtn = (
    cls: string,
    label: string,
    ariaLabel: string,
    target: number,
    disabled: boolean
  ): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `iserv-pagination-btn ${cls}`;
    btn.textContent = label;
    btn.setAttribute("aria-label", ariaLabel);
    btn.dataset.page = String(target);
    if (disabled) btn.disabled = true;
    if (!disabled && opts.onPage) {
      btn.addEventListener("click", () => opts.onPage?.(target));
    }
    nav.appendChild(btn);
    return btn;
  };

  makeBtn(
    "iserv-pagination-prev",
    "‹",
    "Vorherige Seite",
    page - 1,
    page <= 0
  );

  for (const idx of pageWindow(page, totalPages, maxButtons)) {
    const isActive = idx === page;
    const btn = makeBtn(
      "iserv-pagination-page",
      String(idx + 1),
      `Seite ${idx + 1}`,
      idx,
      false
    );
    if (isActive) {
      btn.classList.add("iserv-pagination-active");
      btn.setAttribute("aria-current", "page");
      btn.disabled = true;
    }
  }

  makeBtn(
    "iserv-pagination-next",
    "›",
    "Nächste Seite",
    page + 1,
    page >= totalPages - 1
  );

  container.appendChild(nav);
  return nav;
}
