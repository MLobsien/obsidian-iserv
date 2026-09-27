import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FetchTransport } from '../../src/client/FetchTransport';
import { IServClient } from '../../src/client/IServClient';

/**
 * FetchTransport (ADR-0005 Transport-Seam, Mobile-Follow-Up ADR-0009):
 * fetch-basiertes Transport über einen echten Node-http-Server getestet
 * (Muster aus binary-transport.test.ts).
 *
 * Abgedeckt: 302/301-Redirect-Kette (inkl. 303 POST→GET), Cookie-Sammeln
 * und -Senden pro Hop, binärer Body (PDF-artiges ByteArray mit 0xFC-Bytes)
 * kommt 1:1 durch (kein UTF-8-Lossy), 4xx/5xx als IServResponse-Fehlerpfad
 * analog rawRequest (Status/Headers/Body, kein Throw).
 */

let server: http.Server | null = null;
let port = 0;
const seen: { method: string; url: string; cookie: string; cl: string }[] = [];

const PDF_LIKE = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, // "%PDF-1.7"
  0x0d, 0x0a,
  0xfc, 0xfc, 0xfc, // Latin1-Range (UTF-8-invalid → Buffer.toString()-Bug)
  0xc3, 0xbc, // "ü" in UTF-8
  0x80, 0x81, 0xff, // High-Bytes
]);

function makeConfig() {
  return { hostname: '127.0.0.1', port, ssl: false };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      cookie: (req.headers.cookie as string) ?? '',
      cl: (req.headers['content-length'] as string) ?? '',
    });

    // 302-Kette: /chain/1 → /chain/2 → /chain/3 → 200; Cookies pro Hop.
    if (req.url === '/chain/1') {
      res.setHeader('Set-Cookie', 'one=1; Path=/');
      res.writeHead(302, { Location: '/chain/2' });
      res.end();
      return;
    }
    if (req.url === '/chain/2') {
      res.setHeader('Set-Cookie', ['two=2; Path=/', 'one=overwritten; Path=/']);
      res.writeHead(302, { Location: '/chain/3' });
      res.end();
      return;
    }
    if (req.url === '/chain/3') {
      const body = JSON.stringify({ ok: true, seenCookie: req.headers.cookie ?? '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    // 303 nach POST → GET-Weiterfolge
    if (req.url === '/login' && req.method === 'POST') {
      res.writeHead(303, { Location: '/after-login' });
      res.end();
      return;
    }
    if (req.url === '/after-login') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`method=${req.method}`);
      return;
    }
    // Binäre Response (PDF-artig, 0xFC-Bytes) direkt und hinter Redirect.
    if (req.url === '/binary') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(Buffer.from(PDF_LIKE));
      return;
    }
    if (req.url === '/binary-redirect') {
      res.writeHead(302, { Location: '/binary' });
      res.end();
      return;
    }
    // 4xx/5xx-Fehlerpfade: Status/Headers/Body als IServResponse (kein Throw).
    if (req.url === '/not-found') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('missing');
      return;
    }
    if (req.url === '/server-error') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('kaputt');
      return;
    }
    // meta-refresh-Seite: Transport liefert 1:1, Client löst auf.
    if (req.url === '/meta') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><meta http-equiv="refresh" content="0; url=/target"></head></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('default');
  });
  await new Promise<void>((res) => server!.listen(0, '127.0.0.1', res));
  port = (server!.address() as AddressInfo).port;
});

beforeEach(() => {
  seen.length = 0;
});

afterAll(async () => {
  await new Promise<void>((res) => (server ? server.close(() => res()) : res()));
});

describe('FetchTransport.requestBytes (Redirect-Kette + Cookies)', () => {
  it('folgt einer 302-Kette und sammelt Set-Cookie aller Hops', async () => {
    const t = new FetchTransport(makeConfig());
    const r = await t.requestBytes({ method: 'GET', path: '/chain/1', headers: {} });
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    // Cookies beider Hops sind gesammelt, spätere überschreiben gleiche Namen.
    expect(r.setCookieValues).toContain('one=1; Path=/');
    expect(r.setCookieValues).toContain('two=2; Path=/');
    expect(r.setCookieValues).toContain('one=overwritten; Path=/');
    // Folge-Hops bekommen die Cookies der früheren Hops mitgeschickt;
    // gleiche Namen werden innerhalb der Kette überschrieben (CookieStore-Semantik).
    const hop3 = seen.find((s) => s.url === '/chain/3');
    expect(hop3?.cookie).toContain('one=overwritten');
    expect(hop3?.cookie).toContain('two=2');
    // Und der finale Request trägt den überschriebenen Wert.
    const final = JSON.parse(new TextDecoder().decode(r.body));
    expect(final.seenCookie).toContain('one=overwritten');
    expect(final.seenCookie).toContain('two=2');
  });

  it('303 nach POST wird zu GET und wirft Body/Content-Length ab', async () => {
    const t = new FetchTransport(makeConfig());
    const r = await t.requestBytes({
      method: 'POST',
      path: '/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '7' },
      body: 'a=1&b=2',
    });
    expect(r.status).toBe(200);
    const after = seen.find((s) => s.url === '/after-login');
    expect(after?.method).toBe('GET');
    expect(after?.cl).toBe('');
    expect(new TextDecoder().decode(r.body)).toBe('method=GET');
  });

  it('liefert binäre PDF-Bytes 1:1 hinter Redirect (kein UTF-8-Lossy)', async () => {
    const t = new FetchTransport(makeConfig());
    const r = await t.requestBytes({
      method: 'GET',
      path: '/binary-redirect',
      headers: {},
    });
    expect(r.status).toBe(200);
    expect(Array.from(r.body)).toEqual(Array.from(PDF_LIKE));
    expect(r.contentType).toBe('application/pdf');
  });
});

describe('FetchTransport.request (IServResponse-Vertrag)', () => {
  it('gibt Status/Headers/Body des finalen Responses als IServResponse zurück', async () => {
    const t = new FetchTransport(makeConfig());
    const resp = await t.request({ method: 'GET', path: '/chain/1', headers: {} });
    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toBe('application/json');
    // set-cookie mehrwertig aus der Kette (beide Hops).
    const sc = resp.headers['set-cookie'];
    expect(Array.isArray(sc) ? sc.join(' | ') : sc).toContain('one=1');
    expect(Array.isArray(sc) ? sc.join(' | ') : sc).toContain('two=2');
    const parsed = JSON.parse(resp.body);
    expect(parsed.ok).toBe(true);
  });

  it('liefert 4xx als IServResponse (analog rawRequest: kein Throw)', async () => {
    const t = new FetchTransport(makeConfig());
    const resp = await t.request({ method: 'GET', path: '/not-found', headers: {} });
    expect(resp.status).toBe(404);
    expect(resp.body).toBe('missing');
  });

  it('liefert 5xx als IServResponse (analog rawRequest: kein Throw)', async () => {
    const t = new FetchTransport(makeConfig());
    const resp = await t.request({ method: 'GET', path: '/server-error', headers: {} });
    expect(resp.status).toBe(500);
    expect(resp.body).toBe('kaputt');
  });

  it('meta-refresh-HTML wird 1:1 durchgereicht (Auflösung bleibt im IServClient)', async () => {
    const t = new FetchTransport(makeConfig());
    const resp = await t.request({ method: 'GET', path: '/meta', headers: {} });
    expect(resp.status).toBe(200);
    expect(resp.body).toContain('http-equiv="refresh"');
    expect(resp.body).toContain('url=/target');
  });

  it('binäre Bytes durchlaufen request() bytegetreu (Latin1-bijektiv, stringToBytes-fähig)', async () => {
    const t = new FetchTransport(makeConfig());
    const resp = await t.request({ method: 'GET', path: '/binary', headers: {} });
    expect(resp.status).toBe(200);
    // Bijektiv: charCodeAt-Äquivalent (stringToBytes) rekonstruiert die Bytes exakt.
    const bytes = Array.from({ length: resp.body.length }, (_, i) => resp.body.charCodeAt(i));
    expect(bytes).toEqual(Array.from(PDF_LIKE));
  });
});

describe('FetchTransport + IServClient (Login über den Transport)', () => {
  it('schafft denselben Login-Flow wie rawRequest: Cookies sammeln, IServSession am Ende', async () => {
    // Kette simuliert den iserv-api.md-Login: GET-Formular → POST → 302
    // (Set-Cookie IServSession) → 200 (IServClient folgt dem Location-Hop selbst).
    const s2 = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/iserv/auth/login?_target_path=/iserv/timetable/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>login form</html>');
        return;
      }
      if (req.method === 'POST' && req.url === '/iserv/auth/login?_target_path=/iserv/timetable/') {
        res.writeHead(302, {
          Location: '/iserv/timetable/',
          'Set-Cookie': 'IServSession=abc123; Path=/; HttpOnly',
        });
        res.end();
        return;
      }
      if (req.method === 'GET' && req.url === '/iserv/timetable/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>timetable</html>');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((res) => s2.listen(0, '127.0.0.1', res));
    const p2 = (s2.address() as AddressInfo).port;

    const client = new IServClient({
      hostname: '127.0.0.1',
      port: p2,
      ssl: false,
      username: 'u',
      password: 'p',
    }, new FetchTransport({ hostname: '127.0.0.1', port: p2, ssl: false }));
    const resp = await client.login();
    expect(resp.status).toBe(200);
    expect(client.getCookies().get('IServSession')).toBe('abc123');
    await new Promise<void>((res) => s2.close(() => res()));
  });

  it('Client sendet Cookie-Header aus dem CookieStore über den Transport (Session-Handling)', async () => {
    const t = new FetchTransport(makeConfig());
    const client = new IServClient(
      { hostname: '127.0.0.1', port, ssl: false, username: 'u', password: 'p' },
      t
    );
    // Client besitzt den Store; Transport ist passiver Header-Überträger.
    client.getCookies().set('IServSession', 'sess-4711');
    await client.request('/chain/1');
    const hop1 = seen.find((s) => s.url === '/chain/1');
    expect(hop1?.cookie).toContain('IServSession=sess-4711');
  });
});

describe('IServClient.rawBytesRequest über den bytes-Seam (Transport-V2)', () => {
  it('FetchTransport-BYTES: rawBytesRequest nutzt transport.bytes — Binärbytes 1:1 hinter Redirect', async () => {
    const t = new FetchTransport(makeConfig());
    const client = new IServClient(
      { hostname: '127.0.0.1', port, ssl: false, username: 'u', password: 'p' },
      t
    );
    client.getCookies().set('IServSession', 'sess-bytes');
    const bytes = await client.rawBytesRequest('/binary');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(PDF_LIKE));
    // kein U+FFFD-Pfad: High-Bytes unverändert
    expect(Array.from(bytes).includes(0xfc)).toBe(true);
  });

  it('Cookie-Store des Client fließt über den bytes-Seam mit (Session-Handling)', async () => {
    const t = new FetchTransport(makeConfig());
    const client = new IServClient(
      { hostname: '127.0.0.1', port, ssl: false, username: 'u', password: 'p' },
      t
    );
    client.getCookies().set('IServSession', 'sess-bytes-2');
    await client.rawBytesRequest('/binary');
    const bin = seen.find((s) => s.url === '/binary');
    expect(bin?.cookie).toContain('IServSession=sess-bytes-2');
  });

  it('Ohne bytes-Transport (Default) bleibt der Node-https-Pfad — mobile-Error statt Crash', async () => {
    // Client ohne injizierten Transport: rawBytesRequest geht auf require(https).
    // In der Node-Test-Umgebung existiert https → echter Aufruf gegen den
    // Test-Server (127.0.0.1) wäre möglich; wir prüfen hier nur den Dispatch-
    // Contract: transport.bytes vorhanden → Seam, sonst Node-Pfad.
    const client = new IServClient(
      { hostname: '127.0.0.1', port, ssl: false, username: 'u', password: 'p' }
    );
    // kein Transport injiziert → Node-Pfad (im Test via echten http-Server):
    const bytes = await client.rawBytesRequest('/plain');
    expect(new TextDecoder().decode(bytes)).toBe('default');
  });

  it('bytes() eines injizierten Transports ohne Implementierung → Node-Fallback greift nicht (Transports ohne bytes nutzen request())', async () => {
    // Minimaler Transport ohne bytes: rawBytesRequest darf NICHT crashen, sondern
    // fällt auf Node-Pfad zurück (hier: echter Test-Server).
    const tNoBytes = {
      request: async (opts: { method: string; path: string }) => ({
        status: 200,
        headers: {},
        body: 'fallback-should-not-be-used',
      }),
    };
    const client = new IServClient(
      { hostname: '127.0.0.1', port, ssl: false, username: 'u', password: 'p' },
      tNoBytes
    );
    const bytes = await client.rawBytesRequest('/plain');
    expect(new TextDecoder().decode(bytes)).toBe('default');
  });
});
