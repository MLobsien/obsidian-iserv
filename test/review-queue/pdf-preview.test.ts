import { describe, it, expect } from "vitest";
import {
  buildPdfPreviewUrl,
  classifyQueueItem,
} from "../../src/review-queue/pdf-preview";
import type { QueueItem } from "../../src/review-queue/state";

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: overrides.id ?? "item-1",
    name: overrides.name ?? "file.pdf",
    path: overrides.path ?? "Files/Mathematik/Arbeitsblatt.pdf",
    hash: overrides.hash ?? "abc123",
    subject: overrides.subject ?? "Mathe",
    status: overrides.status ?? "neu",
    target: overrides.target,
  };
}

describe("buildPdfPreviewUrl", () => {
  it("erzeugt Download-URL nach file/-/<pfad>-Konvention (ADR-0005/0004)", () => {
    const item = makeItem({ path: "Files/Mathematik/Arbeitsblatt.pdf" });
    const preview = buildPdfPreviewUrl(item);
    expect(preview.url).toBe(
      "iserv/file/-/Files%2FMathematik%2FArbeitsblatt.pdf"
    );
  });

  it("URL-encodiert Sonderzeichen und Leerzeichen im Pfad", () => {
    const item = makeItem({ path: "Files/Chemie Nahrung/Übung 2.pdf" });
    const preview = buildPdfPreviewUrl(item);
    expect(preview.url).toBe(
      "iserv/file/-/Files%2FChemie%20Nahrung%2F%C3%9Cbung%202.pdf"
    );
  });

  it("klassifiziert pdf-Items als kind: pdf", () => {
    const preview = buildPdfPreviewUrl(makeItem({ name: "dok.pdf" }));
    expect(preview.kind).toBe("pdf");
  });

  it("klassifiziert Bild-Items als kind: image", () => {
    for (const name of ["foto.png", "scan.JPG", "graphik.jpeg", "icon.webp"]) {
      expect(buildPdfPreviewUrl(makeItem({ name })).kind).toBe("image");
    }
  });

  it("klassifiziert andere Items als kind: other", () => {
    for (const name of ["notizen.md", "tabelle.docx", "daten.csv", "archiv.zip"]) {
      const preview = buildPdfPreviewUrl(makeItem({ name }));
      expect(preview.kind).toBe("other");
    }
  });

  it("Groß-/Kleinschreibung der Endung ignorieren, Pfad-Fallback ohne name", () => {
    expect(buildPdfPreviewUrl(makeItem({ name: "Dok.PDF" })).kind).toBe("pdf");
    // kein Name-Endpunkt → path entscheidet
    expect(
      classifyQueueItem({
        id: "x",
        name: "",
        path: "Files/bild.png",
        hash: "h",
        subject: "s",
        status: "neu",
      })
    ).toBe("image");
  });

  it("URL mit Base64-kodiertem Pfad aus api/list (id-Feld) funktioniert", () => {
    // api/list liefert id = Base64 des Pfads; der Download endet trotzdem
    // auf dem dekodierten Pfad (file/-/<pfad>) — hier der Roundtrip-Check.
    const decodedPath = Buffer.from("RmlsZXM=", "base64").toString("utf-8");
    expect(decodedPath).toBe("Files");
    const item = makeItem({ path: decodedPath + "/a.pdf" });
    expect(buildPdfPreviewUrl(item).url).toBe("iserv/file/-/Files%2Fa.pdf");
  });
});
