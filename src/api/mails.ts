/**
 * Mail API client for IServ Mail system.
 *
 * Uses the `/iserv/mail/api/v2/` JSON endpoints.
 */

export type { IServClient, parseResponseBody } from "./shared-client";
import { IServClient, parseResponseBody } from "./shared-client";

const API_BASE = "/iserv/mail/api/v2/";

export interface Mail {
  /** Zusammengesetzte ID (accountId/mailboxId/uid), stabil für Body-Fetches. */
  id: number | string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  flags: string[];
  /** True, wenn ungelesen (kein gelesen-Flag). */
  unread?: boolean;
}

function normalizeFrom(from: unknown): string {
  // IServ v2 liefert ein Array von Kontakt-Objekten (Live-Verifiziert 2026-09-27).
  if (Array.isArray(from)) {
    return from.map(normalizeFrom).filter(Boolean).join(", ");
  }
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

function normalizeId(id: unknown): number | string {
  // id ist ein Objekt {accountId, mailboxId, uid} — stabil als String.
  if (id && typeof id === 'object') {
    const i = id as { uid?: unknown; mailboxId?: unknown };
    if (i.uid !== undefined) return String(i.uid);
    return JSON.stringify(id);
  }
  if (typeof id === 'number' || typeof id === 'string') return id;
  return String(id ?? "");
}


export interface MailListOptions {
  /** Spam-Filter: nur Absender der Schul-Domain (ADR-0008/Plan "onlySchoolEmails"). */
  onlySchool?: boolean;
  /** Schul-Domain (z. B. "gymmeck.de"); Default: aus Email-Adresse ableiten. */
  schoolHost?: string;
}

/** Absender-Domain aus einer normalisierten Absenderangabe extrahieren. */
export function senderDomain(from: string): string | null {
  const match = from.match(/<([^>]+)@([^>\.\s]+(?:\.[^>\.\s]+)*)>/);
  if (match) return match[2].toLowerCase();
  const plain = from.match(/([^@\s,]+)@([^@\s,]+)/);
  return plain ? plain[2].toLowerCase() : null;
}

/** Spam-Filter (onlySchoolEmails): externe Absender raus; leerer Absender bleibt. */
export function filterSchoolEmails(
  mails: Mail[],
  schoolHost: string
): Mail[] {
  const host = schoolHost.toLowerCase();
  return mails.filter((m) => {
    const domain = senderDomain(m.from);
    if (!domain) return true; // keine Absender-Domain → nicht als Spam einstufbar
    return domain === host;
  });
}

export async function mails(
  client: IServClient,
  email: string,
  limit = 25,
  offset = 0,
  opts?: MailListOptions
): Promise<{ mails: Mail[]; total: number }> {
  try {
    const response = await client.request(
      `${API_BASE}account/${email}/message?mailbox[]=SU5CT1g&limit=${limit}&offset=${offset}&sort=date&order=desc`
    );

    const data = parseResponseBody(response);
    if (!data || !Array.isArray(data.items)) {
      return { mails: [], total: 0 };
    }

    let mails: Mail[] = data.items.map((raw: unknown) => {
      const item = raw as Record<string, unknown>;
      return {
        id: normalizeId(item.id),
        subject: String(item.subject ?? ""),
        from: normalizeFrom(item.from),
        date: String(item.date ?? ""),
        snippet: String(item.snippet ?? ""),
        flags: Array.isArray(item.flags) ? (item.flags as string[]) : [],
      };
    });

    if (opts?.onlySchool) {
      const host = opts.schoolHost ?? email.split("@")[1] ?? "";
      if (host) mails = filterSchoolEmails(mails, host);
    }
    return { mails, total: Number(data.total) || 0 };
  } catch {
    return { mails: [], total: 0 };
  }
}

// ---------------------------------------------------------------------------
// Body-Cache mit TTL (Plan T9: "Body-Cache mit TTL (48h)"); gleiche 48h-Konstante
// wie Review-Queue-Discard-Cache (ADR-0001).
// ---------------------------------------------------------------------------

const BODY_TTL_MS = 48 * 60 * 60 * 1000;

interface CacheEntry {
  body: string;
  fetchedAt: number;
  /** Anlagen-Metadaten gehören zum Detail — Cache-Hit darf sie nicht verwerfen. */
  attachments?: MailAttachmentMeta[];
}

const bodyCache = new Map<string, CacheEntry>();

/** Test-Hilfe: Cache leeren (Client-Shapes sind pro Session unterschiedlich). */
export function clearBodyCache(): void {
  bodyCache.clear();
}

function cacheKey(email: string, id: number | string): string {
  return `${email}#${id}`;
}

/**
 * Mail-Body laden (T9, verifizierter Detail-Endpoint 2026-09-27):
 * GET /iserv/mail/api/v2/account/<email>/mailbox/<mailboxId>/message/<uid>
 * → {envelope, content: {rich: [{contentType:'html', content: BASE64}],
 *   plain: [{content: TEXT}]}, attachments, ...}
 *
 * Mail-Body-Hierarchie (CONTEXT.md): rich (Base64-decoded) → plain →
 * „Leere Mail". HTML wird standardmäßig sanitizert (Skripte/Styles/Event-
 * Handler raus); Sanitize ist abschaltbar (Tests, Viewer mit eigenem Sandbox-Kontext).
 */
export interface MailBodyOptions {
  /** HTML-Sanitization ausschalten (Default: an). */
  sanitize?: boolean;
}

/** Alle aktiven/unkontrollierten Inhalte aus HTML-Mail-Bodies entfernen. */
export function sanitizeMailHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/<\/?\s*(script|style|iframe|object|embed|link|meta)[^>]*>/gi, "");
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((el) => el.remove());
  // Event-Handler-Attribute und javascript:-URLs raus
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

/** Base64-HTML-Part dekodieren (robust gegen Whitespace/Zeilenbrüche). */
function decodeBase64Part(raw: string): string {
  const cleaned = raw.replace(/\s+/g, "");
  try {
    return Buffer.from(cleaned, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

export async function mailBody(
  client: IServClient,
  email: string,
  id: number | string,
  /** injizierbar für Tests; Default: prozessweiter Cache, TTL 48h */
  cache?: Map<string, CacheEntry>,
  opts?: MailBodyOptions
): Promise<string> {
  const store = cache ?? bodyCache;
  const key = cacheKey(email, id);

  const cached = store.get(key);
  if (cached && Date.now() - cached.fetchedAt < BODY_TTL_MS) {
    return cached.body;
  }

  const fallback = () => {
    const empty = "Leere Mail";
    store.set(key, { body: empty, fetchedAt: Date.now() });
    return empty;
  };

  try {
    const response = await client.request(
      `${API_BASE}account/${email}/mailbox/SU5CT1g/message/${id}`
    );
    if (response.status !== 200) return fallback();
    const data = JSON.parse(response.body) as {
      content?: {
        rich?: Array<{ contentType?: string; content?: string }>;
        plain?: Array<{ content?: string }>;
      };
    };
    const rich = (data.content?.rich ?? []).filter((p) => p?.content);
    if (rich.length > 0) {
      const html = rich.map((p) => decodeBase64Part(String(p.content))).join("");
      if (html.trim() === "") return fallback();
      const body = opts?.sanitize === false ? html : sanitizeMailHtml(html);
      store.set(key, { body, fetchedAt: Date.now() });
      return body;
    }
    const plain = (data.content?.plain ?? []).map((p) => String(p.content ?? "")).join("\n\n");
    if (plain.trim() === "") return fallback();
    const body = plainToHtml(plain);
    store.set(key, { body, fetchedAt: Date.now() });
    return body;
  } catch {
    return fallback();
  }
}

/**
 * Plain-Text-Mail → HTML: Zeilenumbrüche sichtbar halten (\n → <br>) und
 * versehentliches HTML escapen ( Nuggets wie "<b> harmful" im Text laufen sonst
 * als Tag durch). Obsidian-Renderer kollabieren \n in innerHTML.
 */
export function plainToHtml(plain: string): string {
  const escaped = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br>");
}

export interface MailAttachmentMeta {
  filename: string;
  mimetype: string;
  size: number;
  partId: string;
  /** Download-URL (verifizierter part-Endpoint); null wenn nicht verlinkt. */
  url: string | null;
  /** contentId für Inline-Media (cid:-Verweise im HTML); null bei normalen Anlagen. */
  cid: string | null;
}

export interface MailDetail {
  body: string;
  attachments: MailAttachmentMeta[];
}

interface RawMediaPart {
  data?: { filename?: string; mimetype?: string; size?: number; partId?: string; contentId?: string };
  attachmentUrl?: string;
}

function toAttachmentMeta(raw: RawMediaPart): MailAttachmentMeta | null {
  const d = raw?.data ?? {};
  const partId = String(d.partId ?? "");
  if (!partId) return null;
  return {
    filename: String(d.filename ?? ""),
    mimetype: String(d.mimetype ?? "application/octet-stream"),
    size: Number(d.size ?? 0),
    partId,
    url: raw.attachmentUrl ? String(raw.attachmentUrl) : null,
    cid: d.contentId ? String(d.contentId) : null,
  };
}

/**
 * Body + Anlagen in einem Aufruf (Reader braucht beides; spart Doppel-Fetch).
 * Body-Logik identisch zu mailBody (Hierarchie rich → plain → „Leere Mail").
 */
export async function mailDetail(
  client: IServClient,
  email: string,
  id: number | string,
  cache?: Map<string, CacheEntry>,
  opts?: MailBodyOptions
): Promise<MailDetail> {
  const store = cache ?? bodyCache;
  const key = cacheKey(email, id);
  const cached = store.get(key);
  if (cached && Date.now() - cached.fetchedAt < BODY_TTL_MS) {
    return { body: cached.body, attachments: cached.attachments ?? [] };
  }
  try {
    const response = await client.request(
      `${API_BASE}account/${email}/mailbox/SU5CT1g/message/${id}`
    );
    if (response.status !== 200) return { body: "Leere Mail", attachments: [] };
    const data = JSON.parse(response.body) as {
      content?: {
        rich?: Array<{ contentType?: string; content?: string }>;
        plain?: Array<{ content?: string }>;
      };
      attachments?: RawMediaPart[];
      inlineMedia?: RawMediaPart[];
      unknownMedia?: RawMediaPart[];
    };
    const attachments = [
      ...(data.attachments ?? []),
      ...(data.inlineMedia ?? []),
      ...(data.unknownMedia ?? []),
    ]
      .map(toAttachmentMeta)
      .filter((a): a is MailAttachmentMeta => a !== null);
    const rich = (data.content?.rich ?? []).filter((p) => p?.content);
    if (rich.length > 0) {
      const html = rich.map((p) => decodeBase64Part(String(p.content))).join("");
      const body = html.trim() === "" ? "Leere Mail" : opts?.sanitize === false ? html : sanitizeMailHtml(html);
      store.set(key, { body, fetchedAt: Date.now(), attachments });
      return { body, attachments };
    }
    const plain = (data.content?.plain ?? []).map((p) => String(p.content ?? "")).join("\n\n");
    if (plain.trim() === "") return { body: "Leere Mail", attachments };
    const body = plainToHtml(plain);
    store.set(key, { body, fetchedAt: Date.now(), attachments });
    return { body, attachments };
  } catch {
    return { body: "Leere Mail", attachments: [] };
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

    const data = parseResponseBody(response);
    if (!data) return 0;
    const total = Number(data.total);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Server-seitige Suche (ADR-0008, Spike #19 verifiziert 2026-09-27):
// GET /iserv/mail/api/v2/account/<email>/message?mailbox[]=SU5CT1g&q=<text>
//   &query_search_fields[]=subject&limit=25&sort=date&order=desc
// Areas: from/to/body/subject. Filter passiert auf dem Server — kein
// Client-Side-Filter über geladene Listen (User-Veto in ADR-0008).
// ---------------------------------------------------------------------------

export type MailSearchField = "from" | "to" | "body" | "subject";

export interface MailSearchOptions extends MailListOptions {
  fields?: MailSearchField[];
  limit?: number;
  offset?: number;
}

export async function searchMails(
  client: IServClient,
  email: string,
  q: string,
  opts?: MailSearchOptions
): Promise<{ mails: Mail[]; total: number }> {
  const fields = opts?.fields?.length ? opts.fields : (["subject"] as const);
  const limit = opts?.limit ?? 25;
  const offset = opts?.offset ?? 0;

  // Manuelles Encoding: URLSearchParams kodiert "[]" zu %5B%5D, der
  // verifizierte IServ-Endpoint erwartet aber rohe mailbox[]/query_search_fields[].
  const parts: string[] = [
    "mailbox[]=SU5CT1g",
    `q=${encodeURIComponent(q)}`,
    ...fields.map((f) => `query_search_fields[]=${f}`),
    `limit=${limit}`,
    "sort=date",
    "order=desc",
  ];
  if (offset > 0) parts.push(`offset=${offset}`);
  const query = parts.join("&");

  try {
    const response = await client.request(`${API_BASE}account/${email}/message?${query}`);

    const data = parseResponseBody(response);
    if (!data || !Array.isArray(data.items)) {
      return { mails: [], total: 0 };
    }

    const mails: Mail[] = data.items.map((raw: unknown) => {
      const item = raw as Record<string, unknown>;
      return {
        id: normalizeId(item.id),
        subject: String(item.subject ?? ""),
        from: normalizeFrom(item.from),
        date: String(item.date ?? ""),
        snippet: String(item.snippet ?? ""),
        flags: Array.isArray(item.flags) ? (item.flags as string[]) : [],
      };
    });

    let out = mails;
    if (opts?.onlySchool) {
      const host = opts.schoolHost ?? email.split("@")[1] ?? "";
      if (host) out = filterSchoolEmails(out, host);
    }
    return { mails: out, total: Number(data.total) || 0 };
  } catch {
    return { mails: [], total: 0 };
  }
}
