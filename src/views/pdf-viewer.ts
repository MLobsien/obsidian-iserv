/**
 * PDF-Vollviewer (T21, ADR-0004 Welle 2 „PDFium-Vollviewer") — obsidian-freies
 * Modul (Seam-Split wie mail-reader.ts): rendert den Inhalt eines
 * Vollviewer-Modals; die Obsidian-Modal-Shell (80vw) wired src/main.ts
 * (PDFViewerModal, Muster MailReaderModal).
 *
 * Renderpfad (ADR-0004): Canvas-Rendering über pdf.js statt iframe/embed —
 * `loadPdfJs()` (Obsidian-Bundle, kein zweites pdfjs-dist) wird via Option
 * `loadPdfLib` INJEZIERT; als Naiv-Fallback ohne Injektion wird das erste
 * Seiten-Canvas-Skelett + „Extern öffnen" gerendert (T22-Route), ohne npm-Ab-
 * hängigkeit zu brauchen. Conditional Guard: sobald `loadPdfLib` (oder ein
 * künftiger npm-PDF-Viewer-Adapter) geladen ist, zeichnet der Viewer ALLE
 * Seiten als Multi-Page-Renderer (‹›-Buttons + Tastatur, „Seite N/total") —
 * lazy mit Budget (max. 3 Seiten vorgerendert, Rest beim Navigieren).
 *
 * Bytes-Zugriff (T3-Hash-Download-Konvention, kein Vault-Write): der Caller
 * übergibt `fetchBytes` (async → ArrayBuffer) oder den Inline-Datenstring;
 * IServ-URLs (iserv/file/-/…) brauchen die Plugin-Session, also lädt nur der
 * Caller die Bytes — dieser Renderer bleibt DOM-pur.
 */
import type { QueueItem } from "../review-queue/state";
import { classifyQueueItem, type PdfPreviewKind } from "../review-queue/pdf-preview";

/** pdf.js-Library-Contract (gelanden via Obsidian `loadPdfJs()`). */
export interface PdfJsPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
  }): { promise: Promise<void> };
}

export interface PdfJsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
}

export interface PdfJsLib {
  getDocument(src: unknown): { promise: Promise<PdfJsDocument> };
}

export interface PdfViewerOptions {
  url: string;
  filename: string;
  kind?: PdfPreviewKind;
  /** Optional: Queue-Kontext (Fach-Token für die Kopfzeile). */
  subject?: string;
  /** Lädt pdf.js asynchron; Library-Contract s. PdfJsLib (Obsidian loadPdfJs). */
  loadPdfLib?: () => Promise<PdfJsLib>;
  /** Lädt die PDF-Bytes (Uint8Array) — Caller-Bridge (Session-Cookies). */
  fetchBytes?: () => Promise<Uint8Array | null>;
  /**_thumbnail async: Vorschau-/Seitenrenderer-Note */
  /** T22: externes Öffnen (Desktop-Fallback, window.open außen wired main.ts). */
  onOpenExternally?: () => void;
  /** Anlagen-Kritik (User): Preview first, dann expliziter Save-Dialog im Viewer. */
  onSaveToVault?: () => void;
}

/** CSS-Klassen (eindeutiger Präfix `iserv-pdf-viewer-`) — styles.css-Doku. */
const CLASS = {
  root: "iserv-pdf-viewer",
  header: "iserv-pdf-viewer-header",
  title: "iserv-pdf-viewer-title",
  actions: "iserv-pdf-viewer-actions",
  pageNav: "iserv-pdf-viewer-pagenav",
  body: "iserv-pdf-viewer-body",
  page: "iserv-pdf-viewer-page",
  canvas: "iserv-pdf-viewer-canvas",
  img: "iserv-pdf-viewer-img",
  fallback: "iserv-pdf-viewer-fallback",
  extButton: "iserv-pdf-viewer-extern",
  status: "iserv-pdf-viewer-status",
  pdfMissing: "iserv-pdf-viewer-pdfjs-missing",
} as const;

const STATUS_texts = {
  loading: "Lade PDF …",
  noPdfJs: (
    "PDF.js konnte nicht geladen werden — im Zweifel extern öffnen."
  ) as string,
  externHint: "Extern öffnen",
  pageLabel: "Seite",
  prevPage: "Vorherige Seite",
  nextPage: "Nächste Seite",
  arrowPrev: "‹",
  arrowNext: "›",
} as const;

/**
 * Lazy-Budget (Multi-Page): max. so viele Seiten werden eager vorgerendert;
 * der Rest wird erst beim Navigieren (Klick/Tastatur) gezeichnet.
 */
const PRERENDER_BUDGET = 3;

function formatBytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Rendert einen isolierten Vollviewer-Inhalt in den Container (Modal-Content).
 * Reine DOM-Operationen, kein Obsidian-Import — jsdom-testbar (ADR-0004).
 */
export function renderPdfViewer(
  container: HTMLElement,
  item: QueueItem | { url: string; filename: string; subject?: string },
  opts: PdfViewerOptions = {} as PdfViewerOptions
): void {
  const url =
    opts.url ?? (item as { url: string }).url ?? "";
  const filename =
    opts.filename ?? (item as { filename?: string }).filename ?? "";
  const kind = opts.kind ?? "pdf";
  const subject = opts.subject ?? (item as { subject?: string }).subject ?? "";
  const loadPdf = opts.loadPdfLib;
  const fetchBytes = opts.fetchBytes;
  const onOpenExternally = opts.onOpenExternally;
  const onSaveToVault = opts.onSaveToVault;

  container.replaceChildren();

  const root = document.createElement("div");
  root.className = CLASS.root;

  // Kopfzeile: Dateiname (+ Fach), Aktion rechts (T22 extern-Fallback).
  const header = document.createElement("div");
  header.className = CLASS.header;

  const title = document.createElement("div");
  title.className = CLASS.title;
  title.textContent = filename || "Anhang";
  header.appendChild(title);

  if (subject) {
    const subj = document.createElement("span");
    subj.className = "iserv-pdf-viewer-subject";
    subj.textContent = subject;
    header.appendChild(subj);
  }

  const actions = document.createElement("div");
  actions.className = CLASS.actions;
  const externBtn = document.createElement("button");
  externBtn.type = "button";
  externBtn.className = CLASS.extButton;
  externBtn.textContent = STATUS_texts.externHint;
  if (url) externBtn.dataset.url = url;
  externBtn.addEventListener("click", () => {
    onOpenExternally?.();
  });
  actions.appendChild(externBtn);
  if (onSaveToVault) {
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "iserv-save-attachment-btn";
    saveBtn.textContent = "Im Vault speichern …";
    saveBtn.addEventListener("click", () => {
      onSaveToVault();
    });
    actions.appendChild(saveBtn);
  }
  header.appendChild(actions);

  root.appendChild(header);

  // Body: PDF-Canvas (pdf.js injection) / Bild / Fallback (PDFium-Skelett).
  const body = document.createElement("div");
  body.className = CLASS.body;

  if (kind !== "pdf") {
    if (kind === "image") {
      // Live-Fix (Runde 5): img.src = url zeigt auf app://obsidian.md/... —
      // niemals cookiegetreue IServ-Bytes. Stattdessen fetchBytes → Blob-URL
      // (Muster mail-attachments, main.ts Image-Anlage-Preview).
      const img = document.createElement("img");
      img.className = CLASS.img;
      img.alt = filename;
      img.textContent = "Lade Bildvorschau ...";
      body.appendChild(img);
      void (async () => {
        let bytes: Uint8Array | null = null;
        try {
          bytes = fetchBytes ? await fetchBytes() : null;
        } catch {
          bytes = null;
        }
        if (bytes && bytes.length > 0) {
          const copied = new Uint8Array(bytes);
          const blob = new Blob([copied.buffer as ArrayBuffer], {
            type: "image/jpeg",
          });
          // Blob-URL falls verfügbar (Electron/WebKit); jsdom-Test-Env kennt
          // kein createObjectURL → Fallback Daten-URL (base64).
          img.src =
            typeof URL.createObjectURL === "function"
              ? URL.createObjectURL(blob)
              : `data:image/jpeg;base64,${btoa(
                  String.fromCharCode(...copied)
                )}`;
        } else {
          img.replaceWith(
            Object.assign(document.createElement("div"), {
              className: CLASS.fallback,
              textContent:
                "Keine Bildvorschau möglich (keine Bytes) — bitte extern öffnen.",
            })
          );
        }
      })();
    } else {
      // Runde 5 (User 28.09.2026): Plaintext/MD-Fallback statt Sackgasse —
      // Bytes laden (Caller-Bridge wie PDF) und als Text anzeigen; schlägt
      // das fehl (binary/noise), bleibt der dezente Extern-Hinweis.
      const fb = document.createElement("div");
      fb.className = CLASS.fallback;
      fb.textContent = "Lade Textvorschau ...";
      body.appendChild(fb);
      void renderOtherPreview(fb, fetchBytes);
    }
    root.appendChild(body);
    container.appendChild(root);
    return;
  }

  // PDF-Zweig: Seiten-Skelett(e) rendern, Füllung via Injektion.
  const status = document.createElement("div");
  status.className = CLASS.status;
  status.textContent = STATUS_texts.loading;

  const pageNav = document.createElement("div");
  pageNav.className = CLASS.pageNav;
  pageNav.textContent = "";
  pageNav.hidden = true;

  // Wrapper für N Seiten-Container (Fallback: 1 Seite, Multi-Page: N).
  const pagesWrap = document.createElement("div");
  pagesWrap.className = "iserv-pdf-viewer-pages";
  const page = document.createElement("div");
  page.className = CLASS.page;
  const canvas = document.createElement("canvas");
  canvas.className = CLASS.canvas;
  page.appendChild(canvas);
  pagesWrap.appendChild(page);

  body.appendChild(status);
  body.appendChild(pageNav);
  body.appendChild(pagesWrap);

  root.appendChild(body);
  container.appendChild(root);

  // Keine pdf.js-Injection: Skelett + Status-Text (Conditional Guard).
  if (!loadPdf) {
    status.textContent = STATUS_texts.noPdfJs;
    status.classList.add(CLASS.pdfMissing);
    return;
  }

  // pdf.js-Rendere (asynchron, ohne Obsidian-API; Fehler → Status-Zeile),
  startPdfRender(root, pagesWrap, pageNav, status, fetchBytes, loadPdf);
}

/**
 * Asyncer pdf.js-Render: Multi-Page-Renderer (alle Seiten als Canvas-Skelette,
 * ‹›-Navigation + Tastatur, Status „Seite N/total" unten) mit Lazy-Budget —
 * nur max. PRERENDER_BUDGET Seiten werden eager gezeichnet, der Rest erst
 * bei Navigation (onClick/onKey). Einmal gezeichnete Seiten bleiben stehen.
 */
async function startPdfRender(
  root: HTMLElement,
  pagesWrap: HTMLElement,
  pageNav: HTMLElement,
  status: HTMLElement,
  fetchBytes: (() => Promise<Uint8Array | null>) | undefined,
  loadPdf: () => Promise<PdfJsLib>
): Promise<void> {
  try {
    const lib = await loadPdf();
    let source: unknown = null;
    if (typeof fetchBytes === "function") {
      source = await fetchBytes();
    } else {
      source = { data: null };
    }
    if (!source) {
      status.textContent =
        "PDF-Bytes nicht ladbar — extern öffnen als Fallback (T22).";
      status.classList.add(CLASS.pdfMissing);
      return;
    }
    const doc = await lib.getDocument(source).promise;
    if (doc.numPages < 1) {
      status.textContent = "PDF ohne Seiten — extern öffnen.";
      status.classList.add(CLASS.pdfMissing);
      return;
    }

    // Multi-Page-Skelett: N Seiten-Container mit je einem Canvas.
    pagesWrap.replaceChildren();
    const canvases: HTMLCanvasElement[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pageDiv = document.createElement("div");
      pageDiv.className = CLASS.page;
      const cv = document.createElement("canvas");
      cv.className = CLASS.canvas;
      pageDiv.appendChild(cv);
      pagesWrap.appendChild(pageDiv);
      canvases.push(cv);
    }

    // Navigations-Zeile unten: ‹ Seite N/total › (Theme-Klassen, styles.css
    // bleibt unberührt — iserv-pdf-viewer-pagenav existiert bereits).
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = STATUS_texts.arrowPrev;
    prevBtn.setAttribute("aria-label", STATUS_texts.prevPage);
    const pageLabel = document.createElement("span");
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = STATUS_texts.arrowNext;
    nextBtn.setAttribute("aria-label", STATUS_texts.nextPage);
    pageNav.replaceChildren(prevBtn, pageLabel, nextBtn);
    pageNav.hidden = false;

    // Lazy-State: gerendert-Flag je Seite + In-Flight-Guard (kein Doppel-Render
    // auf demselben Canvas bei schnellen Klicks).
    const rendered = new Array<boolean>(doc.numPages).fill(false);
    const inFlight = new Map<number, Promise<void>>();
    let current = 1;

    const reportRenderError = (err: unknown): void => {
      status.textContent = `PDF-Rendering fehlgeschlagen: ${String(err).slice(
        0,
        80
      )}`;
      status.classList.add(CLASS.pdfMissing);
      status.hidden = false;
    };

    const drawPage = (n: number): Promise<void> => {
      if (n < 1 || n > doc.numPages || rendered[n - 1]) {
        return Promise.resolve();
      }
      const pending = inFlight.get(n);
      if (pending) return pending;
      const job = (async () => {
        const pageObj = await doc.getPage(n);
        const viewport = pageObj.getViewport({ scale: 1.0 });
        const cv = canvases[n - 1];
        cv.width = viewport.width;
        cv.height = viewport.height;
        const ctx = cv.getContext("2d");
        if (ctx) {
          // Echter Render (Obsidian/Electron: Context vorhanden; jsdom ohne
          // node-canvas liefert null — Canvas-Größe/Nav trotzdem konsistent).
          // intent 'print' statt 'display': der Display-Pfad von pdf.js
          // 5.3.34 (Obsidian 1.13) hängt unlösbar (live verifiziert 2026-09-27,
          // Klausurplan-Mail 1786); print rendert dieselben Seiteninhalte.
          await pageObj.render({
            canvasContext: ctx,
            viewport,
            intent: "print",
          } as never).promise;
        }
        rendered[n - 1] = true;
      })()
        .catch(reportRenderError)
        .finally(() => {
          inFlight.delete(n);
        });
      inFlight.set(n, job);
      return job;
    };

    // Vorrender-Fenster: [current, current+BUDGET-1] (Lazy-Budget, Rest onClick).
    const prerenderAhead = async (): Promise<void> => {
      const last = Math.min(doc.numPages, current + PRERENDER_BUDGET - 1);
      for (let n = current; n <= last; n++) {
        await drawPage(n);
      }
    };

    const updateNav = (): void => {
      pageLabel.textContent = `${STATUS_texts.pageLabel} ${current}/${doc.numPages}`;
      prevBtn.disabled = current <= 1;
      nextBtn.disabled = current >= doc.numPages;
    };

    const go = (n: number): void => {
      current = Math.max(1, Math.min(doc.numPages, n));
      updateNav();
      void prerenderAhead();
    };

    prevBtn.addEventListener("click", () => {
      go(current - 1);
    });
    nextBtn.addEventListener("click", () => {
      go(current + 1);
    });

    // Tastatur-Navigation (Pfeiltasten); räumt sich selbst ab, sobald der
    // Viewer nicht mehr im DOM hängt (Modal zu → Listener weg).
    const onKey = (ev: KeyboardEvent): void => {
      if (!root.isConnected) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (ev.key === "ArrowRight") {
        ev.preventDefault();
        go(current + 1);
      } else if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        go(current - 1);
      }
    };
    document.addEventListener("keydown", onKey);

    // Initial: Seite 1 (+ Lazy-Fenster) zeichnen, Nav sichtbar schalten.
    updateNav();
    await prerenderAhead();
    status.textContent = "";
    status.hidden = true;
  } catch (err) {
    status.textContent = `PDF-Rendering fehlgeschlagen: ${String(err).slice(0, 80)}`;
    status.classList.add(CLASS.pdfMissing);
  }
}

/** Queue-Item → Viewer-Eingang (Klassifikation via T15 pdf-preview). */
export function viewerKindForItem(item: QueueItem): PdfPreviewKind {
  return classifyQueueItem(item);
}

/**
 * Größen-Demo-Helfer (nur für Header-Badge des Callers): formatiert Bytes
 * kompakt; im Vollviewer selbst noch nicht im Kopf verankert (Platz).
 */
export function attachmentSizeLabel(bytes: number): string {
  return formatBytesLabel(bytes);
}


/**
 * Runde 5 (User 28.09.2026): Plaintext-Fallback für "other"-Dateien — Bytes
 * laden und als <pre> anzeigen; markdown/plain werden 1:1 gerendert (kein
 * HTML-Import). Non-Text-Bytes (High-Binary-Anteil übel, z. B. zip/docx
 * Rohdaten) bleiben fail-soft beim Hinweis stehen.
 */
async function renderOtherPreview(
  target: HTMLElement,
  fetchBytes?: () => Promise<Uint8Array | null>
): Promise<void> {
  if (!fetchBytes) {
    target.textContent = "Keine Inline-Vorschau möglich — bitte extern öffnen.";
    return;
  }
  let bytes: Uint8Array | null = null;
  try {
    bytes = await fetchBytes();
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length === 0) {
    target.textContent = "Keine Inline-Vorschau möglich (keine Bytes) — bitte extern öffnen.";
    return;
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // Binary-Sniff: U+FFFD-Erzeugung + Control-Chars-Dichte ho → Kein Text.
  const bad =
    (text.match(/\uFFFD/g) || []).length > text.length * 0.02 ||
    (text.slice(0, 2000).match(/[\u0000-\u0008\u000E\u001F]/g) || []).length > 20;
  if (bad) {
    target.textContent = "Keine Inline-Vorschau möglich — bitte extern öffnen.";
    return;
  }
  target.textContent = ""; // Lange-Text-Speicher: <pre> scrollt.
  const pre = document.createElement("pre");
  pre.className = "iserv-pdf-viewer-plaintext";
  pre.textContent = text;
  target.appendChild(pre);
}
