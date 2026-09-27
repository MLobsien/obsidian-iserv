/**
 * Mail API client for IServ Mail system.
 *
 * Uses the `/iserv/mail/api/v2/` JSON endpoints.
 */

import type { IServResponse } from "../client/IServClient";

const API_BASE = "/iserv/mail/api/v2/";

/** Minimal shape of an IServ client with a `request` method. */
export interface IServClient {
  request(
    path: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> }
  ): Promise<IServResponse>;
}

export interface Mail {
  id: number;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  flags: string[];
}

function normalizeFrom(from: unknown): string {
  if (typeof from === 'string') return from;
  if (from && typeof from === 'object') {
    const f = from as {
      personal?: string;
      mailbox?: string;
      host?: string;
      bare_address?: string;
    };
    if (f.personal && f.mailbox && f.host) {
      return `${f.personal} <${f.mailbox}@${f.host}>`;
    }
    if (f.bare_address) return f.bare_address;
    if (f.mailbox && f.host) return `${f.mailbox}@${f.host}`;
    return JSON.stringify(from);
  }
  return String(from);
}

function parseJson(resp: IServResponse): Record<string, unknown> | null {
  if (resp.status !== 200) return null;
  try {
    const parsed: unknown = JSON.parse(resp.body);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function mails(
  client: IServClient,
  email: string,
  limit = 25,
  offset = 0
): Promise<{ mails: Mail[]; total: number }> {
  try {
    const response = await client.request(
      `${API_BASE}account/${email}/message?mailbox[]=SU5CT1g&limit=${limit}&offset=${offset}&sort=date&order=desc`
    );

    const data = parseJson(response);
    if (!data || !Array.isArray(data.items)) {
      return { mails: [], total: 0 };
    }

    const mails: Mail[] = data.items.map((raw: unknown) => {
      const item = raw as Record<string, unknown>;
      return {
        id: item.id as number,
        subject: String(item.subject ?? ""),
        from: normalizeFrom(item.from),
        date: String(item.date ?? ""),
        snippet: String(item.snippet ?? ""),
        flags: Array.isArray(item.flags) ? (item.flags as string[]) : [],
      };
    });

    return { mails, total: Number(data.total) || 0 };
  } catch {
    return { mails: [], total: 0 };
  }
}

export async function mailBody(
  client: IServClient,
  email: string,
  id: number
): Promise<string> {
  try {
    const response = await client.request(
      `${API_BASE}account/${email}/message/${id}/body`
    );

    const raw = response.body;
    if (response.status !== 200 || !raw) return "Leere Mail";
    return Buffer.from(raw, 'base64').toString('utf-8') || "Leere Mail";
  } catch {
    return "Leere Mail";
  }
}

export async function unreadCount(
  client: IServClient,
  email: string
): Promise<number> {
  try {
    // Ungelesen-Filter laut Doku: message?flag[seen]=false → response.total
    const response = await client.request(
      `${API_BASE}account/${email}/message?mailbox[]=SU5CT1g&flag[seen]=false&limit=1&offset=0&sort=date&order=desc`
    );

    const data = parseJson(response);
    if (!data) return 0;
    const total = Number(data.total);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}
