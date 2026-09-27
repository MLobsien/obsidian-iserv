/**
 * Mobile-Plattform-Erkennung (ADR-0009): dünner, testbarer Wrapper um
 * obsidian.Platform.isMobileApp. obsidian-frei im Test: der Provider ist
 * injizierbar (setIsMobileProvider), der Default liest Platform nur lazily
 * (require("obsidian") — im esbuild-Bundle ersetzt, in Node-Tests fail-soft
 * false, da kein Obsidian-Umfeld existiert).
 */
type IsMobileFn = () => boolean;

function readObsidianPlatform(): { isMobileApp?: boolean } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any =
      typeof require === "function" ? require("obsidian") : undefined;
    return (mod?.Platform ?? (globalThis as any).obsidian?.Platform) ?? null;
  } catch {
    return null;
  }
}

function defaultProvider(): boolean {
  return !!readObsidianPlatform()?.isMobileApp;
}

let provider: IsMobileFn = defaultProvider;

/** Liefert true, wenn das Plugin unter Obsidian Mobile (iOS/Android) läuft. */
export function getIsMobile(): boolean {
  return provider();
}

/** Test-Seam: Provider ersetzen (null = zurück zum Default). */
export function setIsMobileProvider(fn: IsMobileFn | null): void {
  provider = fn ?? defaultProvider;
}
