/**
 * Mobile-taugliche Base64-Helfer (ADR-0009 Follow-Up): ohne Node `Buffer`.
 * Utf-8-sicher via TextEncoder/TextDecoder + btoa/atob (DOM-Basis, läuft auf
 * Desktop-Electron und Obsidian Mobile identisch).
 */

/** Utf-8-String → Base64 (btoa erlaubt nur Latin1; Umweg über Bytes). */
export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Base64 → Utf-8-String; robust gegen Whitespace/Zeilenbrüche; misslungen → "". */
export function base64ToUtf8(raw: string): string {
  const cleaned = raw.replace(/\s+/g, "");
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

export const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length;
