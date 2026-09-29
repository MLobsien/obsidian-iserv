/**
 * RequestUrlTransport (ADR-0005 Transport-Seam, ADR-0009 Mobile): requestUrl-basierter
 * Transport für Obsidian Mobile — KORRIGIERT die fetch-Transport-Annahme (Issue #4,
 * Live-Beweise 29.09.2026, echtes Obsidian + echtes IServ):
 *
 * 1. fetch() aus dem Renderer wirft am echten Obsidian `TypeError: Failed to fetch`
 *    gegen hosts OHNE CORS-Header (Beweis: Echo-Server MIT Access-Control-Allow-Origin
 *    → 200 OK; gymmeck.de → TypeError in ~17ms, keine securitypolicyviolation-Events).
 *    IServ sendet keine CORS-Header → der CORS-Precheck wirft BEVOR redirects existieren.
 *    Das ist die Root-Cause der echten Mobile-Logs ("Load failed" ohne Hop-Zeile,
 *    09:28/10:00) — kein WKWebView-redirect-manual-Bug. Chromium und WebKit erzwingen
 *    CORS identisch (Web-Standard) → gilt auch am echten iOS.
 * 2. requestUrl (Main-Process-Transport, CORS-frei) läuft am echten IServ:
 *    - GET + voller Cookie-Header → 200 JSON (users/me live verifiziert)
 *    - Cookie-Header wird 1:1 durchgereicht (Echo-Server-Beweis)
 *    - set-cookie mehrwertig als Array sichtbar (Capture möglich)
 * 3. BEGRENZUNG (live bewiesen, nicht geraten): der Login-POST wird über den
 *    Chromium-h2-Stack vom echten IServ ABGEWIESEN (302 zurück zum Login-Formular +
 *    IServAuthRemember/REMEMBERME statt Weiterleitung zur Ziel-App; oder 401/200-Formular).
 *    Node-h1.1 mit EXAKT denselben Headern → 302 → /iserv/timetable/ (Erfolg).
 *    Node-http2 mit denselben Headern → Abweisung. IServ lehnt Login-POSTs über
 *    HTTP/2-Requests ab; requestUrl hat keine Option, h1.1 zu erzwingen.
 *    → Login auf mobile nur via Desktop-Session-Weitergabe (IServ-Cookie-Zeile,
 *    ALLE Cookies — nur IServSession reicht NICHT, live 401 bewiesen) oder bis
 *    am echten iOS-Gerät bewiesen ist, dass NSURLSession-h2 den Login-POST akzeptiert.
 *
 * ADR-0009-Disziplin: KEIN top-level Node-Import, obsidian nur lazy im Funktionskörper
 * (das esbuild-Bundle hat 'obsidian' als external — require('obsidian') löst der
 * Plugin-Loader, wie FetchTransport es mit keinem obsidian-Import macht).
 */

import type { Transport, IServResponse } from "./IServClient";

export interface RequestUrlTransportConfig {
  hostname: string;
  port?: number;
  ssl?: boolean;
}

interface RequestUrlParamLike {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  contentType?: string;
  throw?: boolean;
}

interface RequestUrlResponseLike {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
}

type RequestUrlFn = (
  request: RequestUrlParamLike | string
) => RequestUrlResponseLike & PromiseLike<RequestUrlResponseLike>;

/** requestUrl lazily aus dem obsidian-Modul — kein top-level require (Mobile-Load). */
function resolveRequestUrl(): RequestUrlFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req: any = typeof require === "function" ? require : null;
  if (req) {
    try {
      const obs = req("obsidian");
      if (obs && typeof obs.requestUrl === "function") return obs.requestUrl;
    } catch {
      /*fällt durch auf globalThis-Fallback*/
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const obs = g?.obsidian ?? g?.window?.obsidian;
  if (obs && typeof obs.requestUrl === "function") return obs.requestUrl;
  throw new Error(
    "requestUrl nicht verfügbar (Transport nur im echten Obsidian-Loader nutzbar)."
  );
}

export class RequestUrlTransport implements Transport {
  private readonly baseUrl: string;

  /** Diagnose-Hook (wie FetchTransport.onHopLog) — requestUrl folgt redirects intern. */
  onHopLog?: (msg: string) => void;

  constructor(cfg: RequestUrlTransportConfig) {
    const ssl = cfg.ssl ?? true;
    const port = cfg.port ?? (ssl ? 443 : 80);
    const proto = ssl ? "https" : "http";
    const defaultPort = ssl ? 443 : 80;
    this.baseUrl = `${proto}://${cfg.hostname}${
      port !== defaultPort ? ":" + port : ""
    }`;
  }

  private note(msg: string): void {
    try {
      this.onHopLog?.(msg);
    } catch {
      /* Log-Hook darf nie brechen */
    }
  }

  async request(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<IServResponse> {
    const requestUrl = resolveRequestUrl();
    const url = /^https?:\/\//i.test(opts.path)
      ? opts.path
      : `${this.baseUrl}${opts.path.startsWith("/") ? opts.path : "/" + opts.path}`;
    this.note(`requrl ${opts.method} ${opts.path}`);
    try {
      const res = (await requestUrl({
        url,
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
        throw: false,
      })) as RequestUrlResponseLike;
      // Header 1:1 übernehmen (lowercase wie rawRequest). set-cookie: requestUrl
      // liefert die Werte (live bewiesen als Array bei 200er-API-Antwort) — falls
      // Obsidian mehrere Werte aneinanderhängt, splittet der Client-Parser korrekt.
      const headers: Record<string, string | string[] | undefined> = {};
      for (const [key, value] of Object.entries(res.headers ?? {})) {
        const lower = key.toLowerCase();
        // set-cookie: mehrwertig halten — requestUrl liefert Array (live bewiesen).
        if (lower === "set-cookie") {
          headers[lower] = Array.isArray(value)
            ? (value as string[])
            : // Manche Obsidian-Versionen joinen: an Cookie-Grenzen splitten.
              splitJoinedSetCookie(String(value));
          continue;
        }
        headers[lower] = value;
      }
      this.note(
        `requrl FINAL ${opts.method} ${opts.path} -> ${res.status} bytes=${(res.text ?? "").length}`
      );
      return {
        status: res.status,
        headers,
        body: res.text ?? "",
      };
    } catch (err) {
      this.note(`requrl-FAIL ${opts.method} ${opts.path}: ${String(err).slice(0, 80)}`);
      throw err;
    }
  }

  /**
   * Binärvariante (Transport-V2): requestUrl.arrayBuffer 1:1 (kein Text-Detour,
   * kein U+FFFD — gleiche Disziplin wie FetchTransport.requestBytes).
   */
  async bytes(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ body: Uint8Array }> {
    const requestUrl = resolveRequestUrl();
    const url = /^https?:\/\//i.test(opts.path)
      ? opts.path
      : `${this.baseUrl}${opts.path.startsWith("/") ? opts.path : "/" + opts.path}`;
    this.note(`requrl-bytes GET ${opts.path}`);
    try {
      const res = (await requestUrl({
        url,
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
        throw: false,
      })) as RequestUrlResponseLike;
      const ab = res.arrayBuffer ?? new ArrayBuffer(0);
      return { body: new Uint8Array(ab) };
    } catch (err) {
      this.note(`requrl-bytes-FAIL ${opts.path}: ${String(err).slice(0, 80)}`);
      throw err;
    }
  }
}

/**
 * Fallback-Parser: wenn Obsidian set-cookie mehrwertig als EINEN String liefert
 * (Join), an Cookie-Grenzen splitten — gleiche Heuristik wie
 * FetchTransport.parseSetCookieValues (Expires-Daten mit Kommawert brechen nicht,
 * weil bis zum nächsten ";" kein "=" folgt).
 */
function splitJoinedSetCookie(raw: string): string[] {
  return raw
    .split(/,(?=\s*[^;,=\s]+=[^;,]*[;,\r\n]|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Factory für main.ts (plattformabhängige Wahl, ADR-0009). */
export function makeRequestUrlTransport(
  cfg: RequestUrlTransportConfig
): RequestUrlTransport {
  return new RequestUrlTransport(cfg);
}
