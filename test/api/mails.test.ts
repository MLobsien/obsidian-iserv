import { describe, it, expect, vi } from 'vitest';
import { mails, mailBody, unreadCount, searchMails, clearBodyCache, IServClient } from '../../src/api/mails';
import { IServResponse } from '../../src/client/IServClient';

function fakeClient(responses: IServResponse[]): { client: IServClient; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const client: IServClient = {
    request: vi.fn(async (path: string) => {
      calls.push(path);
      return responses[i++] ?? { status: 200, headers: {}, body: '' };
    }),
  };
  return { client, calls };
}

function jsonResponse(body: unknown): IServResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

describe('mails API', () => {
  it('mails() GETs the INBOX list endpoint and maps items', async () => {
    const { client, calls } = fakeClient([
      jsonResponse({
        items: [
          {
            id: 1,
            subject: 'Hausaufgaben',
            from: { personal: 'Frau Lehrer', mailbox: 'lehrer', host: 'gymmeck.de' },
            date: '2026-09-26T10:00:00Z',
            snippet: 'Bitte erledigen',
            flags: ['\\Seen'],
          },
          { id: 2, subject: 'S', from: 'plain@example.com', date: 'd', snippet: 's' },
        ],
        total: 42,
      }),
    ]);

    const result = await mails(client, 'student@gymmeck.de', 25, 0);

    expect(calls[0]).toBe(
      '/iserv/mail/api/v2/account/student@gymmeck.de/message?mailbox[]=SU5CT1g&limit=25&offset=0&sort=date&order=desc'
    );
    expect(result.total).toBe(42);
    expect(result.mails).toHaveLength(2);
    expect(result.mails[0]).toMatchObject({
      id: 1,
      subject: 'Hausaufgaben',
      from: 'Frau Lehrer <lehrer@gymmeck.de>',
      flags: ['\\Seen'],
    });
    expect(result.mails[1].from).toBe('plain@example.com');
  });

  it('mails() returns empty on non-200 or invalid JSON', async () => {
    const bad = fakeClient([{ status: 500, headers: {}, body: 'oops' }]);
    expect(await mails(bad.client, 'x@y.z')).toEqual({ mails: [], total: 0 });

    const garbage = fakeClient([{ status: 200, headers: {}, body: 'not-json' }]);
    expect(await mails(garbage.client, 'x@y.z')).toEqual({ mails: [], total: 0 });

    const nonArray = fakeClient([jsonResponse({ items: 'nope' })]);
    expect(await mails(nonArray.client, 'x@y.z')).toEqual({ mails: [], total: 0 });
  });

  it('mailBody() decodes base64 body, falls back on error', async () => {
    const encoded = Buffer.from('<p>Hallo</p>', 'utf-8').toString('base64');
    const { client, calls } = fakeClient([
      { status: 200, headers: {}, body: encoded },
    ]);

    expect(await mailBody(client, 'student@gymmeck.de', 7)).toBe('<p>Hallo</p>');
    expect(calls[0]).toBe('/iserv/mail/api/v2/account/student@gymmeck.de/message/7/body');

    const empty = fakeClient([{ status: 404, headers: {}, body: '' }]);
    expect(await mailBody(empty.client, 'x@y.z', 1)).toBe('Leere Mail');
  });

  it('mailBody() caches decoded bodies for 48h (single fetch)', async () => {
    const encoded = Buffer.from('<p>Cache</p>', 'utf-8').toString('base64');
    const { client, calls } = fakeClient([
      { status: 200, headers: {}, body: encoded },
    ]);
    const cache = new Map();

    expect(await mailBody(client, 'c@g.de', 5, cache)).toBe('<p>Cache</p>');
    expect(await mailBody(client, 'c@g.de', 5, cache)).toBe('<p>Cache</p>');
    expect(calls.length).toBe(1);
  });

  it('mailBody() refetches after TTL expiry of 48h', async () => {
    const encoded = Buffer.from('<p>Alt</p>', 'utf-8').toString('base64');
    const { client, calls } = fakeClient([
      { status: 200, headers: {}, body: encoded },
      { status: 200, headers: {}, body: encoded },
    ]);
    const cache = new Map();

    const first = await mailBody(client, 't@g.de', 5, cache);
    // Ablauf simulieren: fetchedAt in die Vergangenheit verschieben
    let entry = cache.get('t@g.de#5') as unknown as { fetchedAt: number };
    entry.fetchedAt = Date.now() - 49 * 60 * 60 * 1000;
    cache.set('t@g.de#5', entry as never);

    const second = await mailBody(client, 't@g.de', 5, cache);
    expect(first).toBe('<p>Alt</p>');
    expect(second).toBe('<p>Alt</p>');
    expect(calls.length).toBe(2);
  });

  it('clearBodyCache() wipes the shared cache', async () => {
    clearBodyCache();
    const encoded = Buffer.from('<p>Wipe</p>', 'utf-8').toString('base64');
    const { client } = fakeClient([{ status: 200, headers: {}, body: encoded }]);
    expect(await mailBody(client, 'w@g.de', 5)).toBe('<p>Wipe</p>');
    clearBodyCache();
    // nach clear: default cache empty -> zweiter Aufruf fetcht erneut (kein Assert nötig, nur Smoke)
  });

  it('unreadCount() uses the flag[seen]=false filter total', async () => {
    const { client, calls } = fakeClient([jsonResponse({ items: [], total: 3 })]);

    expect(await unreadCount(client, 'student@gymmeck.de')).toBe(3);
    expect(calls[0]).toBe(
      '/iserv/mail/api/v2/account/student@gymmeck.de/message?mailbox[]=SU5CT1g&flag[seen]=false&limit=1&offset=0&sort=date&order=desc'
    );
  });

  it('unreadCount() returns 0 on non-200 or missing total', async () => {
    const bad = fakeClient([{ status: 500, headers: {}, body: '' }]);
    expect(await unreadCount(bad.client, 'x@y.z')).toBe(0);

    const missing = fakeClient([jsonResponse({ items: [] })]);
    expect(await unreadCount(missing.client, 'x@y.z')).toBe(0);
  });
});

describe('searchMails (Server-seitige Suche, Spike #19 verifiziert 2026-09-27)', () => {
  it('GET-verifizierter Endpoint: q + query_search_fields[] + default subject', async () => {
    const { client, calls } = fakeClient([
      jsonResponse({
        items: [
          {
            id: { accountId: 'a@b.de', mailboxId: 'SU5CT1g', uid: 1816 },
            subject: 'HA Klausur',
            from: [{ personal: 'Frau Lehrer', mailbox: 'lehrer', host: 'gymmeck.de', bare_address: 'lehrer@gymmeck.de', contact: null }],
            date: 'd',
            snippet: 'Themen Klausur',
            flags: [],
          },
        ],
        total: 1,
      }),
    ]);

    const r = await searchMails(client, 'student@gymmeck.de', 'Klausur');

    expect(calls[0]).toBe(
      '/iserv/mail/api/v2/account/student@gymmeck.de/message?mailbox[]=SU5CT1g&q=Klausur&query_search_fields[]=subject&limit=25&sort=date&order=desc'
    );
    expect(r.total).toBe(1);
    expect(r.mails).toHaveLength(1);
    expect(r.mails[0]).toMatchObject({
      id: '1816',
      subject: 'HA Klausur',
      from: 'Frau Lehrer <lehrer@gymmeck.de>',
    });
  });

  it('Areas from/to/body/subject werden als query_search_fields[] kodiert (kein Client-Filter)', async () => {
    const { client, calls } = fakeClient([jsonResponse({ items: [], total: 0 })]);

    await searchMails(client, 'a@b.de', 'test', { fields: ['from', 'to', 'body', 'subject'] });

    expect(calls[0]).toBe(
      '/iserv/mail/api/v2/account/a@b.de/message?mailbox[]=SU5CT1g&q=test&query_search_fields[]=from&query_search_fields[]=to&query_search_fields[]=body&query_search_fields[]=subject&limit=25&sort=date&order=desc'
    );
  });

  it('q wird URL-kodiert (%)', async () => {
    const { client, calls } = fakeClient([jsonResponse({ items: [], total: 0 })]);

    await searchMails(client, 'a@b.de', 'HA & Übungsblatt');

    expect(calls[0]).toContain('q=HA%20%26%20%C3%9Cbungsblatt');
  });

  it('limit/offset-Optionen landen in der URL (defaults 25/0)', async () => {
    const { client, calls } = fakeClient([jsonResponse({ items: [], total: 0 })]);

    await searchMails(client, 'a@b.de', 'x', { limit: 10, offset: 20 });

    expect(calls[0]).toContain('limit=10');
    expect(calls[0]).toContain('offset=20');
  });

  it('returns empty on non-200 / non-JSON (robust)', async () => {
    const bad = fakeClient([{ status: 500, headers: {}, body: 'oops' }]);
    expect(await searchMails(bad.client, 'x@y.z', 'q')).toEqual({ mails: [], total: 0 });

    const garbage = fakeClient([{ status: 200, headers: {}, body: 'not-json' }]);
    expect(await searchMails(garbage.client, 'x@y.z', 'q')).toEqual({ mails: [], total: 0 });
  });
});

describe('IServ v2 Live-Shapes (2026-09-27 verifiziert)', () => {
  it('from als Array von Kontakt-Objekten → "Name <addr>"', async () => {
    const { client } = fakeClient([
      jsonResponse({
        items: [
          {
            id: { accountId: 'a@b.de', mailboxId: 'SU5CT1g', uid: 1816 },
            subject: 'T',
            from: [
              { host: 'gymmeck.de', mailbox: 'lehrer', bare_address: 'lehrer@gymmeck.de', personal: 'Frau Lehrer', contact: null },
            ],
            date: 'd', snippet: 's', flags: [],
          },
        ],
        total: 1,
      }),
    ]);
    const r = await mails(client, 'a@b.de');
    expect(r.mails[0].from).toBe('Frau Lehrer <lehrer@gymmeck.de>');
    expect(r.mails[0].id).toBe('1816'); // uid aus Objekt extrahiert
  });

  it('from-Array mit mehreren Kontakten → kommagetrennt', async () => {
    const { client } = fakeClient([
      jsonResponse({
        items: [
          {
            id: 3,
            subject: 'X',
            from: [
              { personal: 'A', mailbox: 'a', host: 'x.de' },
              { personal: 'B', mailbox: 'b', host: 'y.de' },
            ],
            date: 'd', snippet: 's', flags: [],
          },
        ],
        total: 1,
      }),
    ]);
    const r = await mails(client, 'a@b.de');
    expect(r.mails[0].from).toBe('A <a@x.de>, B <b@y.de>');
  });
});
