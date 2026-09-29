/**
 * CookieStore - In-Memory-Cookie-Verwaltung für die IServ-Kette.
 * Gekapselt in eigener Datei (Review-Fund "Set-Cookie-Capture 3x"/Duplikat):
 * `IServClient` besitzt genau eine Instanz und macht Capture über
 * `parseSetCookie`/`get`.
 */

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

  /**
   * Komplette "Cookie"-Header-Zeile importieren (k=v; k2=v2) — mobile
   * Session-Weitergabe (Issue #4, Live-Beweis 29.09.2026): NUR IServSession
   * reicht dem echten IServ NICHT (users/me → 401), die KONJUNKTION aller
   * Kette-Cookies (IServAuthSession/IServAuthSID/IServSession/IServSAT/
   * IServSATId/DSASESSID) ergibt 200. Desktop-Pfad nutzt das NICHT (Legacy-
   * Format bleibt: nur IServSession) — Aufrufer entscheidet per Präfix.
   */
  parseCookieHeader(header: string): void {
    if (!header) return;
    for (const part of header.split(';')) {
      const pair = part.trim();
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
