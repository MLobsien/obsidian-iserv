/**
 * NoticeCenter (T3/T4-Verkabelung): key-basiertes Notice-Dedup.
 *
 * Problem: Fehlerpfade feuern bei jedem Refresh/Tick ein `new Notice` —
 * dieselbe Meldung stapelt sich (Sidebar-Catch, Cred-Retry-Timer, Sync-Loop).
 *
 * `notifyOnce(key, text, timeout)` stellt ein Notice nur, wenn für diesen
 * Key keins offen ist (innerhalb des Timeouts). Zeitliche VerweжигUNG über
 * Date.now(); die Notice-Klasse ist injizierbar (Plugin: Obsidian Notice,
 * Tests: Fake), damit das Modul Node-testbar bleibt (ADR-0007 Seam-Pattern).
 */
export interface NoticeLike {
  /* Obsidian Notice ähnliche Instanz (nur erzeugen, kein weiterer Vertrag). */
}

export interface NoticeCenterOptions {
  /** Notice-Baustein (Produktion: obsidian.Notice; Tests: Fake-Klasse). */
  notice?: new (text: string, timeout?: number) => NoticeLike;
  /** Uhr in ms (Default: Date.now; Tests: vi.useFakeTimers). */
  now?: () => number;
}

interface OpenEntry {
  /** Verfallszeitpunkt (ms-Epoche), bis zu dem kein neues Notice für den Key kommt. */
  until: number;
}

/** Echte Obsidian-Notice als Default (Plugin-Kontext); in Node-Tests überschrieben. */
function defaultNoticeClass(): new (text: string, timeout?: number) => NoticeLike {
  // obsidian import lazily gehalten — im Bundle wird es von esbuild ersetzt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obsidian = (globalThis as { obsidian?: { Notice?: unknown } }).obsidian;
  const cls = obsidian?.Notice;
  if (!cls) {
    // Fail-soft: ohne Obsidian-Umgebung klein bleiben (kein Crash im Test).
    class NullNotice implements NoticeLike {
      constructor(_text: string, _timeout?: number) {}
    }
    return NullNotice;
  }
  return cls as new (text: string, timeout?: number) => NoticeLike;
}

export class NoticeCenter {
  private open: Map<string, OpenEntry> = new Map();
  private notice: new (text: string, timeout?: number) => NoticeLike;
  private now: () => number;

  constructor(deps: NoticeCenterOptions = {}) {
    this.notice = deps.notice ?? defaultNoticeClass();
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Zeigt `text` als Notice, außer für `key` ist noch ein Fenster offen.
   * Rückgabe: die neue Notice (oder null, wenn dedupliziert).
   */
  notifyOnce(key: string, text: string, timeout = 10_000): NoticeLike | null {
    const t = this.now();
    const entry = this.open.get(key);
    if (entry && t < entry.until) {
      return null; // Fenster offen → selbe Nachricht sammelt sich nicht
    }
    this.open.set(key, { until: t + Math.max(0, timeout) });
    const notice = new this.notice(text, timeout);
    return notice;
  }

  /** Dedup-Fenster für einen Key explizit schließen (z. B. nach Erfolg). */
  forget(key: string): void {
    this.open.delete(key);
  }

  /** Komplettes Fenster zurücksetzen (z. B. nach erfolgtem Sync). */
  forgetAll(): void {
    this.open.clear();
  }
}
