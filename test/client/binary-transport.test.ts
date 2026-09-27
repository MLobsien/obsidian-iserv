import { describe, it, expect, afterAll } from 'vitest';
import { IServClient } from '../../src/client/IServClient';
import * as http from 'node:http';

/**
 * Binär-Transport (Live-Fund 2026-09-27, Klausurplan-Mail 1786):
 * rawRequest konvertiert den Body via Buffer.concat().toString() (UTF-8 lossy) —
 * 8855/24650 Bytes des PDFs waren U+FFFD; stringToBytes kann das nie rekonstruieren
 * → PDF-Canvas bleibt weiß. rawBytesRequest liefert Uint8Array 1:1.
 * Test fährt einen echten Node-http-Server hoch (Binary-Response) und verifiziert
 * den Byte-Roundtrip über den Transport.
 */

let server: http.Server | null = null;
let port = 0;

const PAYLOAD = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, // "%PDF-1.7"
  0x0d, 0x0a,
  0xfc, 0xfc, 0xfc, // Latin1-Range (wäre UTF-8-invalid)
  0xc3, 0xbc, // "ü" in UTF-8
  0x80, 0x81, 0xff, // High-Bytes
]);

afterAll(async () => {
  await new Promise<void>((res) => (server ? server.close(() => res()) : res()));
});

describe('rawBytesRequest (binäre Response ohne UTF-8-Lossy)', () => {
  it('liefert exakt die übertragenen Bytes als Uint8Array', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(Buffer.from(PAYLOAD));
    });
    await new Promise<void>((res) => server!.listen(0, '127.0.0.1', res));
    port = (server!.address() as { port: number }).port;

    const client = new IServClient({
      hostname: '127.0.0.1',
      port,
      ssl: false,
      username: 'u',
      password: 'p',
    });
    const bytes = await client.rawBytesRequest('/tmp/test.pdf');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(PAYLOAD));
  });
});
