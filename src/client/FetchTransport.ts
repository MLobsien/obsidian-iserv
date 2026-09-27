/**
 * FetchTransport (ADR-0005 Transport-Seam): fetch-basierter Transport für
 * Obsidian Mobile (ADR-0009 Follow-Up) — gleiche Semantik wie IServClient.rawRequest,
 * aber ohne Node-Builtins (https/http), damit das Bundle auf mobile nicht crasht.
 *
 * Verantwortungs-Trennung (identisch zu rawRequest):
 * - Der Transport folgt 30x-Location-Ketten selbst (IServ-Login hoppt 301/302),
 *   sammelt Set-Cookie pro Hop (chainCookies) und gibt den FINALEN Response als
 *   IServResponse zurück — Status/Headers/Body 1:1, KEINE HTML-Interpretation
 *   im Transport. meta-refresh-Auflösung bleibt im IServClient
 *   (nextRedirectPath/resolveRedirect); liefert der Transport einen 3xx zurück
 *   (z.B. maxRedirects erschöpft), nimmt der Client-Loop die Kette nahtlos auf.
 * - Set-Cookie aller Hops wird in den Response-Headern zusammengeführt
 *   (mehrwertig als Array), damit captureCookies() im Client dieselben Cookies
 *   sieht, die rawRequest einzeln pro Hop geliefert hätte.
 *
 * Cookie-Handling: rawRequest spiegelt Set-Cookie in die EINE CookieStore-Instanz
 * des IServClient (`this.cookies.parseSetCookie(res.headers['set-cookie'])`) und
 * der Client sendet Cookies selbst via defaultHeaders('Cookie'). FetchTransport
 * braucht deshalb KEINEN eigenen CookieStore: er parst nur (parseSetCookieValues),
 * führt Cookies INNERHALB der Redirect-Kette pro Hop zusammen (chainCookies) und
 * überlässt das Capture dem Client. Derselbe IServClient kann Transporte frei
 * wechseln — Login + Session-Cookie-Handling identisch zum Default.
 *
 * Binär-Pipeline (Live-Fund 2026-09-27, PDF 0xFC→U+FFFD): Body-Bytes werden via
 * arrayBuffer() 1:1 gehalten — NIEMALS Buffer.toString()/UTF-8-Lossy.
 * requestBytes() liefert die Rohbytes als Uint8Array (Pendant zu
 * IServClient.rawBytesRequest für einen bytes-tragenden Transport-Vertrag);
 * request() dekodiert responsiv: Content-Type-/UTF-8-Sniffing entscheidet Text
 * (TextDecoder) vs Bytes (Latin1-bijektive Charcodes — bytegetreu, von
 * stringToBytes rekonstruierbar, im Gegensatz zu U+FFFD-Zerstörung).
 *
 * ADR-0009-Disziplin: KEINE Node-Imports, KEIN obsidian-Import (Testbarkeit wie
 * mobile/guard.ts); `import type` zum IServClient wird zur Compile-Zeit gelöscht
 * (kein Bundle-Load-Risiko). fetch ist in Electron-Renderer und Obsidian Mobile
 * (Capacitor/WebKit) global vorhanden.
 */

import type { Transport, IServResponse } from "./IServClient";

export interface FetchTransportConfig {
  hostname: string;
  port?: number;
  ssl?: boolean;
}

/** Ein "a=b"-Pair aus einem Set-Cookie-Header (alles nach dem ersten ";" weg). */
function cookiePair(line: string): string | null {
  const pair = line.split(";")[0]?.trim();
  if (!pair) return null;
  const eq = pair.indexOf("=");
  if (eq === -1) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;
  return `${name}=${value}`;
}

export class FetchTransport implements Transport {
  private readonly baseUrl: string;
  private readonly maxRedirects: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    cfg: FetchTransportConfig,
    options: { maxRedirects?: number; fetchImpl?: typeof fetch } = {}
  ) {
    const ssl = cfg.ssl ?? true;
    const port = cfg.port ?? (ssl ? 443 : 80);
    const proto = ssl ? "https" : "http";
    const defaultPort = ssl ? 443 : 80;
    this.baseUrl = `${proto}://${cfg.hostname}${port !== defaultPort ? ":" + port : ""}`;
    this.maxRedirects = options.maxRedirects ?? 12;
    // Wrapper (nicht Direktreferenz): globalThis.fetch erst beim Call auflösen —
    // testbar injizierbar, kein Load-Time-Zugriff.
    this.fetchImpl =
      options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  /**
   * Set-Cookie-Werte eines Responses lesen — getSetCookie() wo verfügbar
   * (mehrwertig unverlustlich), Fallback get('set-cookie') (Node/undici liefert
   * Arrays; Browser-Join wird an Cookie-Grenzen gesplittet, Expires-Daten mit
   * Kommawert brechen die Heuristik nicht, weil bis zum nächsten ";" kein "=" folgt).
   */
  static parseSetCookieValues(headers: Headers): string[] {
    const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
    if (typeof anyHeaders.getSetCookie === "function") {
      return anyHeaders.getSetCookie();
    }
    const raw = headers.get("set-cookie");
    if (!raw) return [];
    return raw
      .split(/,(?=\s*[^;,=\s]+=[^;,]*[;,\r\n]|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Set-Cookie-Werte → "Cookie"-Header (nur name=value, wie CookieStore.parseSetCookie). */
  static cookieHeaderFrom(values: string[]): string {
    const pairs: string[] = [];
    for (const v of values) {
      const pair = cookiePair(v);
      if (pair) pairs.push(pair);
    }
    return pairs.join("; ");
  }

  /** Set-Cookie-Werte des letzten request()-Laufs (alle Hops, Reihenfolge der Kette). */
  lastSetCookieValues: string[] = [];

  async request(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<IServResponse> {
    const bytes = await this.requestBytes(opts);
    this.lastSetCookieValues = bytes.setCookieValues;

    // Header 1:1 übernehmen (lowercase wie rawRequest/res.headers), set-cookie
    // mehrwertig aus der CHAIN (alle Hops — nicht nur der finale Hop).
    const headers: Record<string, string | string[] | undefined> = {};
    bytes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "set-cookie") return;
      const prev = headers[lower];
      headers[lower] = prev !== undefined ? `${prev}, ${value}` : value;
    });
    if (bytes.setCookieValues.length === 1) headers["set-cookie"] = bytes.setCookieValues[0];
    else if (bytes.setCookieValues.length > 1) headers["set-cookie"] = bytes.setCookieValues;

    // Body: binäre Bytes 1:1 halten; Text responsiv dekodieren (render-chain).
    const u8 = bytes.body;
    const body = this.looksTextual(u8, bytes.contentType)
      ? new TextDecoder("utf-8").decode(u8)
      : FetchTransport.bytesToLosslessString(u8);

    return { status: bytes.status, headers, body };
  }

  /**
   * Binärvariante: derselbe Redirect-Ketten-Request, Rohbytes 1:1 als Uint8Array —
   * Pendant zu IServClient.rawBytesRequest (kein Text-Drift, kein U+FFFD).
   * setCookieValues = alle Set-Cookie der Kette (Reihenfolge; spätere Hops
   * überschreiben gleiche Namen — Semantik wie CookieStore.parseSetCookie).
   */
  async requestBytes(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{
    status: number;
    headers: Headers;
    body: Uint8Array;
    contentType: string;
    setCookieValues: string[];
  }> {
    // Cookie-Evolution innerhalb der Kette (rawRequest-Äquivalent: pro Hop
    // capturen und auf Folge-Hops senden). Caller-Cookie-Header ist Basis;
    // in der Kette gesetzte Cookies ergänzen/überschreiben nach Name.
    const chainCookies = new Map<string, string>();
    const callerCookie = opts.headers["Cookie"] ?? opts.headers["cookie"];
    if (callerCookie) {
      for (const pair of callerCookie.split(";")) {
        const p = cookiePair(pair);
        if (p) {
          const eq = p.indexOf("=");
          chainCookies.set(p.slice(0, eq), p.slice(eq + 1));
        }
      }
    }

    let currentPath = opts.path;
    let currentMethod = opts.method;
    let currentBody = opts.body;
    const chainSetCookie: string[] = [];
    let hop = 0;

    for (;;) {
      const headers: Record<string, string> = { ...opts.headers };
      if (chainCookies.size > 0) {
        headers["Cookie"] = FetchTransport.cookieHeaderFrom(
          Array.from(chainCookies).map(([k, v]) => `${k}=${v}`)
        );
      }
      if (currentBody === undefined) {
        // GET nach Redirect: Body-bezogene Header abwerfen (sonst invalide).
        delete headers["Content-Length"];
        delete headers["content-length"];
        delete headers["Content-Type"];
        delete headers["content-type"];
      }

      const url = this.absolute(currentPath);
      const resp = await this.fetchImpl(url, {
        method: currentMethod,
        // manual: wir folgen der Kette selbst — Cookie-Evolution pro Hop
        // (wie rawRequest einzeln pro transportRequest-Hop), keine opaque
        // opaqueredirect-Responses (Browser-Fall), Status bleibt beobachtbar.
        redirect: "manual",
        headers,
        body: currentBody,
      });

      const sc = FetchTransport.parseSetCookieValues(resp.headers);
      chainSetCookie.push(...sc);
      for (const v of sc) {
        const pair = cookiePair(v);
        if (pair) {
          const eq = pair.indexOf("=");
          chainCookies.set(pair.slice(0, eq), pair.slice(eq + 1));
        }
      }

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        if (loc && hop < this.maxRedirects) {
          // Location absolut oder relativ → Pfad?query (analog IServClient.resolveRedirect;
          // &amp;-Escapes in meta-refresh löst der CLIENT, hier reines Location-Following).
          currentPath = this.toPath(loc, url);
          if (
            resp.status === 303 ||
            ((resp.status === 301 || resp.status === 302) && currentMethod === "POST")
          ) {
            currentMethod = "GET";
            currentBody = undefined;
          }
          hop++;
          continue;
        }
      }

      const buf = new Uint8Array(await resp.arrayBuffer());
      return {
        status: resp.status,
        headers: resp.headers,
        body: buf,
        contentType: resp.headers.get("content-type") ?? "",
        setCookieValues: chainSetCookie,
      };
    }
  }

  /** Pfad?query einer (absoluten|relativen) Location relativ zur Request-URL. */
  private toPath(loc: string, fromUrl: string): string {
    try {
      const u = new URL(loc, fromUrl);
      return u.pathname + u.search;
    } catch {
      return loc;
    }
  }

  private absolute(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseUrl}${path.startsWith("/") ? path : "/" + path}`;
  }

  /** Heuristik: Text-Body (HTML/JSON/XML/Text) vs binär (PDF/Bild/gzip/…). */
  private looksTextual(bytes: Uint8Array, contentType: string): boolean {
    const ct = contentType.toLowerCase();
    if (ct) {
      return (
        ct.startsWith("text/") ||
        ct.includes("json") ||
        ct.includes("xml") ||
        ct.includes("html") ||
        ct.includes("xhtml") ||
        ct.includes("urlencoded") ||
        ct.includes("javascript")
      );
    }
    // Kein Content-Type: Sniffing — gültiges UTF-8 ohne NULs = Text; Decode-Fehler
    // (fatal: true) = binäre Bytes (PDF, Bilder, gzip — niemals U+FFFD-risikant).
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return !text.includes("\u0000");
    } catch {
      return false;
    }
  }

  /**
   * Bytes → String OHNE UTF-8-Lossy: Latin1-bijektive Charcodes (byte↔charcode),
   * d.h. stringToBytes/charCodeAt kann die Bytes 1:1 rekonstruieren — im
   * Gegensatz zum Buffer.toString()-Bug (0xFC → U+FFFD, irreversibel).
   */
  static bytesToLosslessString(bytes: Uint8Array): string {
    let out = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      let sub = "";
      const end = Math.min(i + CHUNK, bytes.length);
      for (let j = i; j < end; j++) sub += String.fromCharCode(bytes[j]);
      out += sub;
    }
    return out;
  }
}

/**
 * Factory für main.ts (plattformabhängige Wahl, ADR-0009): baut aus derselben
 * IServConfig-Teilmenge (hostname/port/ssl) wie der Node-Default-Transport.
 */
export function makeFetchTransport(
  cfg: FetchTransportConfig,
  options?: { maxRedirects?: number; fetchImpl?: typeof fetch }
): FetchTransport {
  return new FetchTransport(cfg, options);
}
