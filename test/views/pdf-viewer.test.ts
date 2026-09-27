// @vitest-environment jsdom
/**
 * T21-Tests: renderPdfViewer (obsidian-frei, ADR-0004 Welle 2).
 *
 * Struktur-Asserts auf das Modal-Inhalt-DOM:
 * - Header (Titel/Fach) + „Extern öffnen"-Button (T22-Fallbacks)
 * - kind: pdf → Canvas-Skelett + Conditional-Guard (ohne Injektion →
 *   pdfjs-missing-Status, kein Crash), mit Injektion → Seitenzahl/Canvas-Füllung
 * - kind: image → <img>, kind: other → Fallback-Text (wie MailReader-Anhang)
 */
import { describe, it, expect, vi } from "vitest";
import {
  renderPdfViewer,
  attachmentSizeLabel,
  viewerKindForItem,
  type PdfJsLib,
} from "../../src/views/pdf-viewer";
import type { QueueItem } from "../../src/review-queue/state";

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "item-1",
    name: overrides.name ?? "Arbeitsblatt.pdf",
    path: overrides.path ?? "Files/Mathematik/Arbeitsblatt.pdf",
    hash: overrides.hash ?? "abc",
    subject: overrides.subject ?? "Mathe",
    status: overrides.status ?? "neu",
    target: overrides.target,
  };
}

describe("renderPdfViewer — pdf-Zweig (Vollviewer-Struktur)", () => {
  it("rendert Header mit Dateiname + Fach und Extern-Button (data-url)", () => {
    const c = document.createElement("div");
    const item = makeItem();
    renderPdfViewer(c, item, {
      url: "https://gymmeck.de/iserv/file/-/Files%2FMathematik%2FArbeitsblatt.pdf",
      filename: item.name,
      subject: item.subject,
    });

    const root = c.querySelector(".iserv-pdf-viewer");
    expect(root).toBeTruthy();
    expect(root!.querySelector(".iserv-pdf-viewer-title")?.textContent).toBe(
      "Arbeitsblatt.pdf"
    );
    expect(root!.querySelector(".iserv-pdf-viewer-subject")?.textContent).toBe(
      "Mathe"
    );
    const btn = root!.querySelector<HTMLButtonElement>(
      ".iserv-pdf-viewer-extern"
    );
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toContain("Extern öffnen");
    expect(btn!.dataset.url).toContain("/iserv/file/-/");
  });

  it("pdf ohne pdf.js-Injektion: Skelett-Canvas + Conditional-Guard-Status (kein Crash)", () => {
    const c = document.createElement("div");
    renderPdfViewer(c, makeItem(), { url: "u", filename: "a.pdf" });

    // Canvas-Skelett ist da
    expect(
      c.querySelector(".iserv-pdf-viewer-body .iserv-pdf-viewer-canvas")
    ).toBeTruthy();
    // Status-Zeile meldet fehlende pdf.js (Guard), kein� Extern-Fallback ersetzt sie
    const status = c.querySelector(".iserv-pdf-viewer-status")!;
    expect(status.textContent).toContain("PDF.js");
    expect(status.classList.contains("iserv-pdf-viewer-pdfjs-missing")).toBe(
      true
    );
  });

  it("Exter-Button feuert onOpenExternally einmal (T22-Fallback-Draht)", () => {
    const c = document.createElement("div");
    const onOpenExternally = vi.fn();
    renderPdfViewer(c, makeItem(), {
      url: "u",
      filename: "a.pdf",
      onOpenExternally,
    });
    (
      c.querySelector<HTMLButtonElement>(".iserv-pdf-viewer-extern")!
    ).click();
    expect(onOpenExternally).toHaveBeenCalledTimes(1);
  });

  it("mit pdf.js-Injektion + Bytes: Canvas gefüllt, Seitenzahl 1/N, Status leer", async () => {
    const c = document.createElement("div");
    const ctxCalls: string[] = [];
    const fakeLib: PdfJsLib = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 3,
          getPage: () =>
            Promise.resolve({
              getViewport: () => ({ width: 612, height: 792 }),
              render: ({ canvasContext }: { canvasContext: unknown }) => {
                ctxCalls.push(String(canvasContext !== null));
                return { promise: Promise.resolve() };
              },
            }),
        }),
      }),
    };
    renderPdfViewer(c, makeItem(), {
      url: "u",
      filename: "a.pdf",
      loadPdfLib: () => Promise.resolve(fakeLib),
      fetchBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    });
    // asyncer Render-Pfad: erst微 Skeleton, dann befüllt (Await Motorcycle)
    await new Promise((r) => setTimeout(r, 0));
    const canvas = c.querySelector<HTMLCanvasElement>(
      ".iserv-pdf-viewer-canvas"
    )!;
    expect(canvas.width).toBe(612);
    expect(canvas.height).toBe(792);
    const pageNav = c.querySelector(".iserv-pdf-viewer-pagenav")!;
    expect(pageNav.textContent).toContain("1 / 3");
    expect((pageNav as HTMLElement).hidden).toBe(false);
    // Status nach erfolgreichem (oder context-loser jsdom-)Renderpath leer
    // Status-Zeile:, erfolgreiches Rendern leert sie
    const status = c.querySelector(".iserv-pdf-viewer-status") as HTMLElement;
    expect(status.textContent).toBe("");
    // jsdom (ohne canvas-npm) liefert getContext → null: Render-Zweig läuft
    // leer, aber Struktur/Seitenzahl/Status sind das hier getestete Contract.
  });

  it("Bytes-Nicht-ladbar (fetchBytes → null): Guard-Zweig extern-Fallback", async () => {
    const c = document.createElement("div");
    renderPdfViewer(c, makeItem(), {
      url: "u",
      filename: "a.pdf",
      loadPdfLib: () => Promise.reject(new Error("no lib")),
      fetchBytes: () => Promise.resolve(null),
    });
    await new Promise((r) => setTimeout(r, 0));
    const status = c.querySelector(".iserv-pdf-viewer-status")!;
    expect(status.textContent).toContain("fehlgeschlagen");
    expect(status.classList.contains("iserv-pdf-viewer-pdfjs-missing")).toBe(
      true
    );
  });
});

describe("renderPdfViewer — image/other-Zweige", () => {
  it("kind: image → <img> mit alt-Text + URL", () => {
    const c = document.createElement("div");
    renderPdfViewer(
      c,
      makeItem({ name: "foto.png", path: "Files/Bio/foto.png" }),
      { url: "u", filename: "foto.png", kind: "image" }
    );
    const img = c.querySelector<HTMLImageElement>(".iserv-pdf-viewer-img");
    expect(img).toBeTruthy();
    expect(img!.alt).toBe("foto.png");
    expect(img!.getAttribute("src")).toBe("u");
  });

  it("kind: other → Fallback-Hinweis, kein Canvas/kein img", () => {
    const c = document.createElement("div");
    renderPdfViewer(c, makeItem({ name: "tabelle.docx" }), {
      url: "u",
      filename: "tabelle.docx",
      kind: "other",
    });
    expect(c.querySelector(".iserv-pdf-viewer-fallback")?.textContent).toContain(
      "extern öffnen"
    );
    expect(c.querySelector(".iserv-pdf-viewer-canvas")).toBeNull();
  });
});

describe("Viewer-Helfer", () => {
  it("viewerKindForItem nutzt die T15-Klassifikation (pdf/image/other)", () => {
    expect(viewerKindForItem(makeItem({ name: "x.pdf" }))).toBe("pdf");
    expect(viewerKindForItem(makeItem({ name: "x.png" }))).toBe("image");
    expect(viewerKindForItem(makeItem({ name: "x.zip" }))).toBe("other");
  });

  it("attachmentSizeLabel formatiert Bytes kompakt", () => {
    expect(attachmentSizeLabel(12)).toBe("12 B");
    expect(attachmentSizeLabel(2048)).toBe("2 KB");
    expect(attachmentSizeLabel(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
