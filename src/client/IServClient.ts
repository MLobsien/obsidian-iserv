/**
 * IServClient - Handles authentication and session management for IServ API
 *
 * Login flow: POST form-encoded credentials to /iserv/auth/login,
 * capture Set-Cookie from the response, follow redirects.
 */

import https from 'https';
import http from 'http';

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

// ---------------------------------------------------------------------------
// CookieStore
// ---------------------------------------------------------------------------

export class CookieStore {
  private cookies = new Map<string, string>();

  /** Parse one or more Set-Cookie header values and store them. */
  parseSetCookie(header: string[] | string | undefined): void {
    if (!header) return;
    const lines = Array.isArray(header) ? header : [header];
    for (const line of lines) {
      const pair = line.split(';')[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  /** Get a cookie value by name, or undefined. */
  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /** Set a cookie directly. */
  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  /** Return a formatted "Cookie" header string: "k1=v1; k2=v2". */
  toHeader(): string {
    const pairs: string[] = [];
    this.cookies.forEach((value, name) => {
      pairs.push(`${name}=${value}`);
    });
    return pairs.join('; ');
  }

  /** Remove all cookies. */
  clear(): void {
    this.cookies.clear();
  }
}

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

class RateLimiter {
  private lastCall = 0;
  private readonly minInterval: number;

  constructor(minIntervalMs: number) {
    this.minInterval = minIntervalMs;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minInterval) {
      await new Promise((r) => setTimeout(r, this.minInterval - elapsed));
    }
    this.lastCall = Date.now();
  }
}

const RATE_LIMIT_INTERVAL_MS = 200; // Obere Grenze pro Client-Instanz; ADR-0005 will geteilt ~2 req/s — der JobRunner teilt sich eine Instanz

/** ADR-0005 Transport-Seam: abstrahiert den https/Node-Transport fuer Tests und Mobile-Adaption. */
export interface Transport {
  request(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<IServResponse>;
}

/** Write-Ausnahmen gemaess iserv-api.md: nur Login + unvermeidbare Telemetrie. */
const WRITE_ALLOWED_PATHS = new Set([
  '/iserv/auth/login',
  '/iserv/public/telemetry/heartbeat',
]);

// ---------------------------------------------------------------------------
// IServClient
// ---------------------------------------------------------------------------

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
    this.limiter = new RateLimiter(RATE_LIMIT_INTERVAL_MS);
    this.transport = transport ?? null;
  }

  /**
   * Login via POST to /iserv/auth/login und Folgen der Redirect-Kette,
   * bis IServSession gesetzt ist (iserv-api.md: Session landet erst ~8. Hop: 302/meta-refresh-Kette).
   * Hinweis: POST nur hier (Write-Ausnahme, s. WRITE_ALLOWED_PATHS).
   */
  async login(): Promise<IServResponse> {
    const form = new URLSearchParams();
    form.append('_username', this.config.username);
    form.append('_password', this.config.password);
    if (this.config.twoFactorToken) {
      form.append('_two_factor_token', this.config.twoFactorToken);
    }

    let resp = await this.transportRequest({
      method: 'POST',
      path: '/iserv/auth/login',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(form.toString()).toString(),
      },
      body: form.toString(),
    });
    this.captureCookies(resp);

    // Redirect-Kette folgen (302 + meta-refresh), bis IServSession da ist oder Obergrenze.
    const MAX_HOPS = 12;
    let hop = 0;
    while (!this.cookies.get('IServSession') && hop < MAX_HOPS) {
      const next = this.nextRedirectPath(resp);
      if (!next) break;
      resp = await this.transportRequest({ method: 'GET', path: next, headers: {} });
      this.captureCookies(resp);
      hop++;
    }

    return resp;
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
    return meta ? meta[1] : null;
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
