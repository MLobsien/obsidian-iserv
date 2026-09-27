import { describe, it, expect, vi } from 'vitest';
import { mails, mailBody, unreadCount, IServClient } from '../../src/api/mails';
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
