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
 * künftiger npm-PDF-Viewer-Adapter) geladen ist, zeichnet der Viewer echte
 * Seiten — das ist der vorbereitete Swap-Pfad, keine API-Änderung nötig.
 *
 * Bytes-Zugriff (T3-Hash-Download-Konvention, kein Vault-Write): der Caller
 * übergibt `fetchBytes` (async → ArrayBuffer) oder den Inline-Datenstring;
 * IServ-URLs (iserv/file/-/…) brauchen die Plugin-Session, also lädt nur der
 * Caller die Bytes — dieser Renderer bleibt DOM-pur.
 */
import type { QueueItem } from "../review-queue/state";
import { classifyQueueItem, type PdfPreviewKind } from "../review-queue/pdf-preview";

/** pdf.js-Library-Contract (gelanden via Obsidian `loadPdfJs()`). */
export interface PdfJsLib {
  getDocument(src: unknown): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getViewport(opts: { scale: number }): { width: number; height: number };
        render(opts: {
          canvasContext: CanvasRenderingContext2D;
          viewport: unknown;
        }): { promise: Promise<void> };
      }>;
    }>;
  };
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
} as const;

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
  header.appendChild(actions);

  root.appendChild(header);

  // Body: PDF-Canvas (pdf.js injection) / Bild / Fallback (PDFium-Skelett).
  const body = document.createElement("div");
  body.className = CLASS.body;

  if (kind !== "pdf") {
    if (kind === "image") {
      const img = document.createElement("img");
      img.className = CLASS.img;
      img.alt = filename;
      if (url) img.src = url;
      body.appendChild(img);
    } else {
      const fb = document.createElement("div");
      fb.className = CLASS.fallback;
      fb.textContent =
        "Keine Inline-Vorschau möglich — bitte extern öffnen.";
      body.appendChild(fb);
    }
    root.appendChild(body);
    container.appendChild(root);
    return;
  }

  // PDF-Zweig: Canvas-Skelett rendern, Füllung via Injektion.
  const status = document.createElement("div");
  status.className = CLASS.status;
  status.textContent = STATUS_texts.loading;

  const pageNav = document.createElement("div");
  pageNav.className = CLASS.pageNav;
  pageNav.textContent = "";
  pageNav.hidden = true;

  const page = document.createElement("div");
  page.className = CLASS.page;
  const canvas = document.createElement("canvas");
  canvas.className = CLASS.canvas;
  page.appendChild(canvas);

  body.appendChild(status);
  body.appendChild(pageNav);
  body.appendChild(page);

  root.appendChild(body);
  container.appendChild(root);

  // Keine pdf.js-Injection: Skelett + Status-Text (Conditional Guard).
  if (!loadPdf) {
    status.textContent = STATUS_texts.noPdfJs;
    status.classList.add(CLASS.pdfMissing);
    return;
  }

  // pdf.js-Rendere (asynchron, ohne Obsidian-API; Fehler → Status-Zeile),
  startPdfRender(page, pageNav, status, canvas, fetchBytes, loadPdf);
}

/** Asyncer pdf.js-Render auf das Skelett-Canvas (Erste Seite + Seitenzahl). */
async function startPdfRender(
  page: HTMLElement,
  pageNav: HTMLElement,
  status: HTMLElement,
  canvas: HTMLCanvasElement,
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
    const firstPage = await doc.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1.0 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Echter Render (Obsidian/Electron: Context vorhanden; jsdom ohne
      // node-canvas liefert null — die Seitenzahl snackt trotzdem).
      await firstPage.render({
        canvasContext: ctx,
        viewport,
      } as never).promise;
    }
    pageNav.textContent = `Seite 1 / ${doc.numPages}`;
    pageNav.hidden = false;
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
