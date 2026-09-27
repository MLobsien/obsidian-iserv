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

/** Log-Eintrag des RAM-Ringpuffers (Panel-Quelle, Issue #1 Abschnitt 1). */
export interface NoticeEntry {
  /** Dedup-Key. */
  key: string;
  /** Meldungstext (wie an die Notice gegangen). */
  message: string;
  /** ms-Epoche des notifyOnce-Aufrufs. */
  at: number;
  /** Optionales Level (z. B. "error"); Rendering: Level-Klasse. */
  level?: "info" | "warn" | "error" | string;
}

/** Kapazität des RAM-Ringpuffers (komplett im RAM, Issue #1: "global gemerkt im RAM"). */
const LOG_CAPACITY = 50;

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
  /** RAM-Ringpuffer der tatsächlich gestellten Notices (neueste zuletzt). */
  private log: NoticeEntry[] = [];
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
    this.log.push({ key, message: text, at: t });
    if (this.log.length > LOG_CAPACITY) {
      this.log.splice(0, this.log.length - LOG_CAPACITY);
    }
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

  /**
   * Letzte n Log-Einträge des RAM-Ringpuffers, neueste zuerst (Panel-Quelle).
   *forget/forgetAll tangieren das Dedup-Fenster, nicht das Log.
   */
  recent(n: number): NoticeEntry[] {
    const count = Math.max(0, Math.floor(n));
    return this.log.slice(-count).reverse().map((e) => ({ ...e }));
  }
}

/* ------------------------------------------------------------------ *
 * Panel-Renderer (obsidian-frei, DOM rein/DOM raus — ADR-0004/0008)   *
 * ------------------------------------------------------------------ */

export interface NoticeCenterRenderOptions {
  /** Maximal anzuzeigende Meldungen (Default 5). */
  n?: number;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Panel „Aktuelle Meldungen“: die letzten N gemerkten Meldungen mit Zeit.
 * Leerer Zustand: GAR NICHTS rendern (kein leeres Panel). Eigene Klassen-
 * Familie iserv-notice-center-*, obsidian-frei wie PDF-Viewer/Countdown.
 */
export function renderNoticeCenter(
  container: HTMLElement,
  notices: NoticeEntry[],
  opts: NoticeCenterRenderOptions = {}
): void {
  if (notices.length === 0) return; // kein leeres Panel

  const n = Math.max(1, Math.floor(opts.n ?? 5));

  const panel = document.createElement("div");
  panel.className = "iserv-notice-center";

  const header = document.createElement("div");
  header.className = "iserv-notice-center-header";
  const title = document.createElement("span");
  title.className = "iserv-notice-center-title";
  title.textContent = "Aktuelle Meldungen";
  header.appendChild(title);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "iserv-notice-center-body";
  panel.appendChild(body);

  const shown = [...notices]
    .sort((a, b) => b.at - a.at) // neueste zuerst
    .slice(0, n);

  for (const entry of shown) {
    const row = document.createElement("div");
    row.className = "iserv-notice-center-row";
    if (entry.level) {
      row.classList.add(`iserv-notice-center-level-${entry.level}`);
    }

    const msg = document.createElement("span");
    msg.className = "iserv-notice-center-message";
    msg.textContent = entry.message;

    const time = document.createElement("span");
    time.className = "iserv-notice-center-time";
    time.textContent = formatTime(entry.at);

    row.appendChild(msg);
    row.appendChild(time);
    body.appendChild(row);
  }

  container.appendChild(panel);
}
