/**
 * Queue-PDF-Preview-URLs (T15, ADR-0005 Welle-2-Politur, ADR-0004 Preview-Pfad):
 * reine URL/Klassifikationslogik, kein DOM, kein Obsidian.
 *
 * Download-URL convention (docs/iserv-api.md): `file/-/<pfad>` unterhalb des
 * IServ-Basispfads (`/iserv/`). Pfade URL-encodiert, damit Leerzeichen/UTF-8
 * im Pfad gültig bleiben.
 */
import type { QueueItem } from "./state";

export type PdfPreviewKind = "pdf" | "image" | "other";

export interface PdfPreview {
  kind: PdfPreviewKind;
  /** IServ-Download-URL (`iserv/file/-/<pfad>`), relativ zum Host-Origin. */
  url: string;
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
]);

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

export function classifyQueueItem(item: QueueItem): PdfPreviewKind {
  const ext = extensionOf(item.name || item.path);
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "other";
}

/**
 * Download-URL + Mime-Klassifikation für eine Queue-Datei.
 *
 * Live-Fix (Runde 5, User 28.09.2026): URL braucht den FÜHRENDEN Slash
 * (`/iserv/file/-/...`) — ohne ihn antwortet nginx mit 400 (Fehler-Templée),
 * mit ihm kommt die echte Datei (200, bytegetreu). Zusätzlich pro Pfad-
 * Segment encodieren: encodeURIComponent über den Gesamtpfad würde die
 * `/`-Trenner mit encodieren. Bittere Lektion: war nie am echten IServ
 * getestet — jetzt live verifiziert (Klausurvorbereitung.pdf, 121 KB).
 */
export function buildPdfPreviewUrl(item: QueueItem): PdfPreview {
  return {
    kind: classifyQueueItem(item),
    url: `/iserv/file/-/${encodeIservPath(item.path)}`,
  };
}

/** Poolpfad → /iserv/file-Kompatible URL: Segmente einzeln encodiert. */
export function encodeIservPath(path: string): string {
  return path
    .split("/")
    .filter((seg) => seg !== "")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}
