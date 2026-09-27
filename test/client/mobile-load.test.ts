import { describe, it, expect, vi } from 'vitest';

/**
 * Mobile-Load-Garantie (ADR-0009-Konsequenz, Battletest Runde 5 Follow-Up):
 * Das Bundle darf beim Modul-Load KEINE Node-Builtins top-level require'n
 * (https/http) — sonst crasht das Plugin in Obsidian Mobile, bevor die
 * Mobile-Gates greifen. rawRequest löst die Module deshalb lazy auf.
 *
 * Wir verifizieren das auf Source-Ebene (statische Garantie), weil vitest
 * selbst Node läuft und Imports dort immer auflösbar sind.
 */
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('Mobile-Load-Garantie: keine top-level Node-Builtins', () => {
  it('IServClient importiert https/http NICHT top-level', () => {
    const src = read('../../src/client/IServClient.ts');
    expect(src).not.toMatch(/^import\s+\w+\s+from\s+['"]https['"]/m);
    expect(src).not.toMatch(/^import\s+\w+\s+from\s+['"]http['"]/m);
  });

  it('main.ts importiert https/http NICHT (tote Imports)', () => {
    const src = read('../../src/main.ts');
    expect(src).not.toMatch(/^import\s+\w+\s+from\s+['"]https['"]/m);
    expect(src).not.toMatch(/^import\s+\w+\s+from\s+['"]http['"]/m);
  });

  it('IServClient.rawRequest löst https/http lazy auf (im Funktionskörper)', () => {
    const src = read('../../src/client/IServClient.ts');
    const rawIdx = src.indexOf('rawRequest(');
    expect(rawIdx).toBeGreaterThan(0);
    const body = src.slice(rawIdx, src.indexOf('getCookies()'));
    expect(body).toMatch(/require\s*===\s*["']function["']/);
    expect(body).toMatch(/\("https"\)|\('https'\)/);
  });
});

describe('Mobile-taugliche Base64 (ohne top-level Buffer-Fallback-Notwendigkeit)', () => {
  it('decodeBase64Part nutzt DOM-Base64 (atob), nicht Buffer.from', () => {
    const src = read('../../src/api/mails.ts');
    expect(src).not.toMatch(/Buffer\.from\(cleaned/);
  });

  it('files-feed baut Base64-IDs ohne Buffer', () => {
    const src = read('../../src/review-queue/files-feed.ts');
    expect(src).not.toMatch(/Buffer\.from\(path/);
  });
});
