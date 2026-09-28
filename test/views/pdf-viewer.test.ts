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
    expect(pageNav.textContent).toContain("Seite 1/3");
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

describe("renderPdfViewer — Multi-Page (T: alle Seiten, Lazy, Page-Nav)", () => {
  /**
   * fakeLib mit per-Seiten-Tracking: fetchedPages = getPage-Aufrufe
   * (jsdom ohne canvas-npm liefert getContext -> null, daher ist getPage
   * der beobachtbare Lazy-Marker; renderedPages bleibt dort leer).
   */
  function makeFakeLib(
    numPages: number,
    fetchedPages: number[],
    renderedPages: number[] = []
  ): PdfJsLib {
    return {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages,
          getPage: (n: number) => {
            fetchedPages.push(n);
            return Promise.resolve({
              getViewport: () => ({ width: 612, height: 792 }),
              render: () => {
                renderedPages.push(n);
                return { promise: Promise.resolve() };
              },
            });
          },
        }),
      }),
    };
  }

  function pagenavText(c: HTMLElement): string {
    return c.querySelector(".iserv-pdf-viewer-pagenav")!.textContent ?? "";
  }

  function pageNavButtons(c: HTMLElement): {
    prev: HTMLButtonElement | null;
    next: HTMLButtonElement | null;
  } {
    const nav = c.querySelector(".iserv-pdf-viewer-pagenav")!;
    const btns = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"));
    const prev = btns.find((b) => b.textContent === "‹") ?? null;
    const next = btns.find((b) => b.textContent === "›") ?? null;
    return { prev, next };
  }

  it(
    "Multi-Page-Renderer: N Canvas-Skelette wenn loadPdfLib geliefert" +
      " (Mock 3 Seiten)",
    async () => {
      const c = document.createElement("div");
      const rendered: number[] = [];
      renderPdfViewer(c, makeItem(), {
        url: "u",
        filename: "a.pdf",
        loadPdfLib: () => Promise.resolve(makeFakeLib(3, rendered)),
        fetchBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      });
      await new Promise((r) => setTimeout(r, 0));
      // 3 Seiten → 3 Page-Container mit je einem Canvas
      const pages = c.querySelectorAll(".iserv-pdf-viewer-page");
      expect(pages.length).toBe(3);
      const canvases = c.querySelectorAll<HTMLCanvasElement>(
        ".iserv-pdf-viewer-canvas"
      );
      expect(canvases.length).toBe(3);
      canvases.forEach((cv) => {
        expect(cv.width).toBe(612);
        expect(cv.height).toBe(792);
      });
    }
  );

  it(
    "Page-Navigation ‹ › feuert und Status zeigt 'Seite 2/3'" +
      " (Klick + Tastatur)",
    async () => {
      const c = document.createElement("div");
      document.body.appendChild(c); // Tastatur-Guard: root.isConnected
      const fetched: number[] = [];
      renderPdfViewer(c, makeItem(), {
        url: "u",
        filename: "a.pdf",
        loadPdfLib: () => Promise.resolve(makeFakeLib(3, fetched)),
        fetchBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      });
      await new Promise((r) => setTimeout(r, 0));

      const { prev, next } = pageNavButtons(c);
      expect(prev).toBeTruthy();
      expect(next).toBeTruthy();
      // Pfeile im Status: „Seite N/total" inklusive ‹›-Buttons
      expect(pagenavText(c)).toContain("Seite 1/3");
      expect(pagenavText(c)).not.toContain("Seite 2/3");
      // › → Seite 2
      next!.click();
      expect(pagenavText(c)).toContain("Seite 2/3");
      expect(pagenavText(c)).not.toContain("Seide 1/3");
      expect(pagenavText(c)).not.toContain("Seite 1/3");
      // Keyboard: ArrowRight → Seite 3
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
      expect(pagenavText(c)).toContain("Seite 3/3");
      // Keyboard: ArrowLeft → zurück auf Seite 2
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
      );
      expect(pagenavText(c)).toContain("Seite 2/3");
      // ‹ → Seite 1
      prev!.click();
      expect(pagenavText(c)).toContain("Seite 1/3");
      c.remove();
    }
  );

  it(
    "ohne loadPdfLib bleibt der Skelett-Fallback (Canvas=1, Extern-Button)" +
      " — kein Multi-Page",
    async () => {
      const c = document.createElement("div");
      renderPdfViewer(c, makeItem(), { url: "u", filename: "a.pdf" });

      expect(
        c.querySelectorAll(".iserv-pdf-viewer-page").length
      ).toBe(1);
      expect(
        c.querySelectorAll<HTMLCanvasElement>(".iserv-pdf-viewer-canvas")
          .length
      ).toBe(1);
      expect(c.querySelector(".iserv-pdf-viewer-extern")).toBeTruthy();
      // Kein Multi-Page-Navigation: nur Guard-Status, pagenav bleibt hidden
      const nav = c.querySelector(".iserv-pdf-viewer-pagenav")!;
      expect((nav as HTMLElement).hidden).toBe(true);
      expect(nav.querySelectorAll("button")).toHaveLength(0);
      const status = c.querySelector(".iserv-pdf-viewer-status")!;
      expect(status.textContent).toContain("PDF.js");
    }
  );

  it(
    "Lazy-Rendering: vorn max. 3 Seiten vorgemerkt," +
      " ferne Seiten erst nach Klick ›"
  , async () => {
    const c = document.createElement("div");
    const fetched: number[] = [];
    renderPdfViewer(c, makeItem(), {
      url: "u",
      filename: "a.pdf",
      loadPdfLib: () => Promise.resolve(makeFakeLib(6, fetched)),
      fetchBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    });
    await new Promise((r) => setTimeout(r, 0));
    // Prerender-Budget: zuerst nur Seite 1-3, Ferne (4-6) bleiben lazy
    const initial = new Set(fetched);
    expect(initial.size).toBeLessThanOrEqual(3);
    expect(initial.has(1)).toBe(true);
    expect(initial.has(4)).toBe(false);
    expect(initial.has(6)).toBe(false);
    // 3× › bis Seite 4: Budget wandert mit, ferne Seiten erst bei Klick
    const nav = c.querySelector(".iserv-pdf-viewer-pagenav")!;
    const nextBtn = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => b.textContent === "›")!;
    // Klick 1 → Seite 2: Fenster 2–4 (Seite 4 ja, 5 noch lazy)
    nextBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetched).toContain(4);
    expect(fetched).not.toContain(5);
    // Klick 2 → Seite 3: Fenster 3–5 (5 ja, 6 noch lazy)
    nextBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetched).toContain(5);
    expect(fetched).not.toContain(6);
    // Klick 3 → Seite 4: Fenster 4–6 (letzte Seiten rücken nach)
    nextBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.textContent).toContain("Seite 4/6");
    expect(fetched).toContain(6);
  }
  );
});
describe("renderPdfViewer — image/other-Zweige", () => {
  it("kind: image → <img> mit alt-Text; Bytes via fetchBytes → Blob-URL (Runde 5 live-Fix: kein app://-src)", async () => {
    const c = document.createElement("div");
    renderPdfViewer(
      c,
      makeItem({ name: "foto.png", path: "Files/Bio/foto.png" }),
      {
        url: "u",
        filename: "foto.png",
        kind: "image",
        // Echtes PNG-Signatur-Bytes (live-Fix: Blob-URL statt img.src=url).
        fetchBytes: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }
    );
    const img = c.querySelector<HTMLImageElement>(".iserv-pdf-viewer-img");
    expect(img).toBeTruthy();
    expect(img!.alt).toBe("foto.png");
    // Blob-URL wird asynchron gesetzt (nicht 'u' — das wäre das app://-Bug).
    await new Promise((r) => setTimeout(r, 10));
    const src = img!.getAttribute("src") ?? "";
    expect(src.startsWith("blob:") || src.startsWith("data:image/")).toBe(true);
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
