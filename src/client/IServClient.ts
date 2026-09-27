/**
 * IServClient - Handles authentication and session management for IServ API
 *
 * Login flow: POST form-encoded credentials to /iserv/auth/login,
 * capture Set-Cookie from the response, follow redirects.
 */

import https from 'https';
import http from 'http';
import { CookieStore } from './CookieStore';
import { RateLimiter, sharedRateLimiter } from './RateLimiter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IServConfig {
  hostname: string;
  port?: number;
  ssl?: boolean;
  username: string;
  password: string;
  /** Optional TOTP-Token; wird als _two_factor_token beim Login mitgeschickt. */
  twoFactorToken?: string;
}

export interface IServResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
}

/** ADR-0005 Transport-Seam: abstrahiert den https/Node-Transport für Tests und Mobile-Adaption. */
export interface Transport {
  request(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<IServResponse>;
}

/** Write-Ausnahmen gemäß iserv-api.md: nur Login + unvermeidbare Telemetrie. */
const WRITE_ALLOWED_PATHS = new Set([
  '/iserv/auth/login',
  '/iserv/public/telemetry/heartbeat',
  // Read-semantische Suche-POSTs (Query-Objekte im Body; ändern nichts serverseitig):
  '/iserv/todo/api/v1/task/search',
]);

export class IServClient {
  private readonly config: IServConfig;
  private readonly cookies: CookieStore;
  private readonly limiter: RateLimiter;
  private readonly transport: Transport | null;

  constructor(
    config: IServConfig,
    /** ADR-0005 Transport-Seam: injizierbar fuer Tests und Mobile-Adaption (Default: Node https). */
    transport?: Transport
  ) {
    this.config = {
      port: 443,
      ssl: true,
      ...config,
    };
    this.cookies = new CookieStore();
    this.limiter = sharedRateLimiter();
    this.transport = transport ?? null;
  }

  /**
   * Login via POST to /iserv/auth/login und Folgen der Redirect-Kette,
   * bis IServSession gesetzt ist (iserv-api.md: Session landet erst ~8. Hop: 302/meta-refresh-Kette).
   * Hinweis: POST nur hier (Write-Ausnahme, s. WRITE_ALLOWED_PATHS).
   */
  async login(): Promise<IServResponse> {
    this.cookies.clear();

    // Login-Präludium (iserv-api.md): GET-Formular zuerst — setzt Session-Vorbereitung
    // und liefert _target_path-Kontext. Der bewährte Pfad hängt an _target_path=/iserv/timetable/.
    const loginForm =
      '/iserv/auth/login?_target_path=/iserv/timetable/';
    const referer = this.baseUrl() + loginForm;
    let resp = await this.transportRequest({
      method: 'GET',
      path: loginForm,
      headers: this.defaultHeaders({ Referer: this.baseUrl() + '/' }),
    });
    this.captureCookies(resp);

    // Login-POST (bewährt aus scripts/nextDue.js): Form + Referer, 2FA-Body wenn gesetzt.
    const form = new URLSearchParams();
    form.append('_username', this.config.username);
    form.append('_password', this.config.password);
    let postBody = form.toString();
    resp = await this.transportRequest({
      method: 'POST',
      path: loginForm,
      headers: this.defaultHeaders({
        Referer: referer,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postBody).toString(),
      }),
      body: postBody,
    });
    this.captureCookies(resp);

    // 2FA-Fall: Login-Antwort enthält das _two_factor_token-Formular (iserv-api.md:
    // 2FA als zweiter POST zum Login). Erst erkennen, dann Token mitschicken.
    if (resp.body && /_two_factor_token/.test(resp.body)) {
      if (!this.config.twoFactorToken) {
        throw new Error('2FA erforderlich — TOTP-Token in Settings hinterlegen.');
      }
      postBody = postBody + '&_two_factor_token=' +
        encodeURIComponent(this.config.twoFactorToken);
      resp = await this.transportRequest({
        method: 'POST',
        path: loginForm,
        headers: this.defaultHeaders({
          Referer: referer,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postBody).toString(),
        }),
        body: postBody,
      });
      this.captureCookies(resp);
    }

    // Redirect-Kette folgen (302 + meta-refresh), bis IServSession da ist oder Obergrenze.
    // iserv-api.md-Ökonomie: ~6-9 Hops (302, meta-refresh, 301, 302, meta-refresh, 302, 200).
    const MAX_HOPS = 12;
    let hop = 0;
    while (!this.cookies.get('IServSession') && hop < MAX_HOPS) {
      const next = this.nextRedirectPath(resp);
      if (!next) break;
      // location kann absolut oder relativ sein — relativ-URLs zur API-Basis auflösen.
      const pathNext = this.resolveRedirect(next);
      resp = await this.transportRequest({
        method: 'GET',
        path: pathNext,
        headers: this.defaultHeaders({ Referer: referer }),
      });
      this.captureCookies(resp);
      hop++;
    }

    return resp;
  }

  /** Origin-URL der Instanz (für Referer/Location-Auflösung). */
  private baseUrl(): string {
    const proto = this.config.ssl ? 'https' : 'http';
    const port = this.config.port ?? (this.config.ssl ? 443 : 80);
    return `${proto}://${this.config.hostname}${
      (this.config.ssl ? port !== 443 : port !== 80) ? ':' + port : ''
    }`;
  }

  /** Öffentliche Origin (T22 extern öffnen: window.open mit absoluter URL). */
  hostOrigin(): string {
    return this.baseUrl();
  }

  /** Optionaler Basis-Header je Request (User-Agent + gemerkte Cookies). */
  private defaultHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 iserv-obsidian',
      Accept: '*/*',
      ...extra,
    };
    const cookieHeader = this.cookies.toHeader();
    if (cookieHeader) h['Cookie'] = cookieHeader;
    return h;
  }

  /** Set-Cookie jedes Responses einsammeln, unabhaengig vom transport. */
  private captureCookies(resp: IServResponse): void {
    this.cookies.parseSetCookie(
      resp.headers['set-cookie'] as string | string[] | undefined,
    );
  }

  /** Extrahiere den naechsten Redirect-Pfad (302 Location oder meta-refresh) oder null. */
  private nextRedirectPath(resp: IServResponse): string | null {
    const loc = resp.headers['location'];
    if (loc && resp.status >= 300 && resp.status < 400) {
      return Array.isArray(loc) ? loc[0] : loc;
    }
    const meta = resp.body.match(
      /<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>]+)/i
    );
    // HTML-Escapes auflösen (&amp; → &), sonst wächst der OIDC-state-Query-Parameter
    // über die Hops an (verifiziert gegen gymmeck.de: nextLen 17→798→2055→414 URI Too Long).
    return meta ? meta[1].replace(/&amp;/g, '&') : null;
  }

  /** Location/meta-refresh-Value in einen Pfad auflösen (absolut → path?query). */
  private resolveRedirect(next: string): string {
    try {
      const url = new URL(next.replace(/&amp;/g, '&'), this.baseUrl());
      return url.pathname + url.search;
    } catch {
      return next;
    }
  }

  /** rawRequest oder injizierter Transport. */
  private transportRequest(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<IServResponse> {
    if (this.transport) return this.transport.request(opts);
    return this.rawRequest(opts);
  }

  /** Rate-limited request. Automatically sends stored cookies. Read-Only-Guard aktiv (ADR-0005). */
  async request(path: string, options: RequestOptions = {}): Promise<IServResponse> {
    const method = (options.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && !WRITE_ALLOWED_PATHS.has(path)) {
      throw new Error(
        `Read-Only-Guard (ADR-0005): ${method} ${path} ist nicht erlaubt — ` +
        'nur GET/HEAD auf IServ; POST nur Login + Telemetrie-Heartbeat.'
      );
    }
    await this.limiter.wait();

    const headers: Record<string, string> = { ...options.headers };
    const cookieHeader = this.cookies.toHeader();
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    let body: string | undefined;
    if (options.body) {
      if (typeof options.body === 'string') {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      }
    }

    const resp = await this.rawRequest({
      method: options.method ?? 'GET',
      path,
      headers,
      body,
    });

    // Auto-capture Set-Cookie from every response
    this.cookies.parseSetCookie(
      resp.headers['set-cookie'] as string | string[] | undefined,
    );

    return resp;
  }

  /** Low-level request using Node https/http modules. No rate-limiting. */
  rawRequest(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<IServResponse> {
    return new Promise((resolve, reject) => {
      const mod = this.config.ssl ? https : http;
      const port = this.config.port ?? (this.config.ssl ? 443 : 80);

      const req = mod.request(
        {
          hostname: this.config.hostname,
          port,
          path: opts.path,
          method: opts.method,
          headers: opts.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            const resp: IServResponse = {
              status: res.statusCode ?? 0,
              headers: res.headers,
              body,
            };

            // Capture Set-Cookie from raw responses too
            this.cookies.parseSetCookie(
              res.headers['set-cookie'] as string | string[] | undefined,
            );

            resolve(resp);
          });
        },
      );

      req.on('error', reject);

      if (opts.body) {
        req.write(opts.body);
      }
      req.end();
    });
  }

  /** Expose cookieStore for callers that need it. */
  getCookies(): CookieStore {
    return this.cookies;
  }
}
