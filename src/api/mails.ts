/**
 * Mail API client for IServ Mail system.
 *
 * Uses the `/iserv/mail/api/v2/` JSON endpoints.
 */

export type { IServClient, parseResponseBody } from "./shared-client";
import { IServClient, parseResponseBody } from "./shared-client";
import { base64ToUtf8 } from "../base64";

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
    // Spam-Filter + Pagination-Lücke (User-Kritik Runde 4): Filter läuft NACH
    // Fetch — eine Seite kann dadurch kollabieren ("nur 4 Mails, nicht blät-
    // terbar"). Falls die gefilterte Seite unter limit fällt und Server noch
    // mehr hat, holen wir geordnet nach (max. 3 Nachzügler-Fetches).
    const host = opts?.onlySchool
      ? opts.schoolHost ?? email.split("@")[1] ?? ""
      : "";
    let all: Mail[] = [];
    let fetchOffset = offset;
    let total = 0;
    for (let hop = 0; hop <= 3; hop++) {
      const response = await client.request(
        `${API_BASE}account/${email}/message?mailbox[]=SU5CT1g&limit=${limit}&offset=${fetchOffset}&sort=date&order=desc`
      );
      const data = parseResponseBody(response);
      if (!data || !Array.isArray(data.items)) break;
      total = Number(data.total) || 0;
      // Server-Rohseitenlänge VOR Filterung: nur sie sagt, ob der Server
      // die Seite vollständig geliefert hat (rawCount < limit ⇒ Ende).
      const rawCount = data.items.length;
      let page: Mail[] = data.items.map((raw: unknown) => {
        const item = raw as Record<string, unknown>;
        return {
          id: normalizeId(item.id),
          subject: String(item.subject ?? ""),
          from: normalizeFrom(item.from),
          date: String(item.date ?? ""),
          snippet: String(item.snippet ?? ""),
          flags: Array.isArray(item.flags) ? (item.flags as string[]) : [],
          // R6 (swan/Coordinator): IServ v2 liefert read:boolean — invertiert
          // = unread. Ohne dieses Mapping war Mail.unread IMMER undefined,
          // der "Aktuell"-Ungelesen-Filter (Runde 6) traf nie zu.
          unread: item.read === false ? true : item.read === true ? false : undefined,
        };
      });
      if (host) page = filterSchoolEmails(page, host);
      all = all.concat(page);
      fetchOffset += limit;
      const enough = !host || rawCount < limit || fetchOffset >= total;
      if (enough) break;
    }
    return { mails: all, total };
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

/** Base64-HTML-Part dekodieren (robust gegen Whitespace/Zeilenbrüche; mobile-tauglich, kein Buffer). */
function decodeBase64Part(raw: string): string {
  return base64ToUtf8(raw);
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

/**
 * Part-Download-URL dynamisch konstruiert (iserv-api.md verifiziert):
 * GET /iserv/mail/api/v2/account/<email>/mailbox/<mailboxId>/message/<uid>/part/<partId>
 * Mailbox ist bei der INBOX-Kette fix SU5CT1g (Base64 von "INBOX").
 */
function buildPartUrl(
  email: string | undefined,
  uid: string | number | undefined,
  partId: string
): string | null {
  if (!email || uid === undefined || uid === null || uid === "") return null;
  return `${API_BASE}account/${email}/mailbox/SU5CT1g/message/${uid}/part/${partId}`;
}

interface RawMediaPart {
  data?: { filename?: string; mimetype?: string; size?: number; partId?: string; contentId?: string };
  // Tolerante Top-Level-Felder (Server-Shape-Rauschen, Battletest Runde 5):
  // manche Detail-Responses liefern die Metadata flach statt im data-Wrapper.
  filename?: string;
  mimetype?: string;
  size?: number;
  partId?: string | number;
  contentId?: string;
  fullName?: string; // rare Alias
  fullPath?: string;
  attachmentUrl?: string;
}

/**
 * Anlagen-Mapping (tolerant, Battletest Runde 5):
 * - Primär der dokumentierte Live-Shape: data.{filename,mimetype,size,partId,contentId}.
 * - Zusätzlich akzeptiert: flache Felder (partId direkt am Objekt) — data hat
 *   Vorrang, flache Felder sind nur Fallback (kein Shape-Rauschen-Verlust).
 * - URL-Fallback: attachmentUrl fehlt → verifizierte part-URL aus uid+partId
 *   konstruiert (iserv-api.md: …/message/<uid>/part/<partId>), nie still null.
 */
export interface MailDetail {
  body: string;
  attachments: MailAttachmentMeta[];
}

function toAttachmentMeta(
  raw: RawMediaPart,
  /** Fallback-URL-Kontext: email + uid (aus mailDetail). */
  ctx?: { email?: string; uid?: string | number }
): MailAttachmentMeta | null {
  const d = raw?.data ?? {};
  const flach = raw ?? {};
  // data.* vorziehen, flache Felder als Fallback (Shape-Rauschen).
  const partId = String(d.partId ?? flach.partId ?? "");
  if (!partId || partId === "undefined") return null;
  const url = flach.attachmentUrl ?? buildPartUrl(ctx?.email, ctx?.uid, partId);
  return {
    filename: String(d.filename ?? flach.filename ?? flach.fullName ?? ""),
    mimetype: String(d.mimetype ?? flach.mimetype ?? "application/octet-stream"),
    size: Number(d.size ?? flach.size ?? 0),
    partId,
    url,
    cid: d.contentId ? String(d.contentId) : (flach.contentId ? String(flach.contentId) : null),
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
      .map((raw) => toAttachmentMeta(raw, { email, uid: id }))
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
    const host = opts?.onlySchool ? opts.schoolHost ?? email.split("@")[1] ?? "" : "";
    let all: Mail[] = [];
    let fetchOffset = offset;
    let total = 0;
    for (let hop = 0; hop <= 3; hop++) {
      const qparts = [
        ...parts.filter(
          (p) =>
            !p.startsWith("limit=") &&
            !p.startsWith("offset=") &&
            !p.startsWith("sort=") &&
            !p.startsWith("order=")
        ),
        `limit=${limit}`,
        ...(fetchOffset > 0 ? ["offset=" + fetchOffset] : []),
        "sort=date",
        "order=desc",
      ];
      const response = await client.request(
        `${API_BASE}account/${email}/message?${qparts.join("&")}`
      );
      const data = parseResponseBody(response);
      if (!data || !Array.isArray(data.items)) break;
      total = Number(data.total) || 0;
      // Server-Rohseitenlänge VOR Filterung: nur sie sagt, ob der Server
      // die Seite vollständig geliefert hat (rawCount < limit ⇒ Ende).
      const rawCount = data.items.length;
      let page: Mail[] = data.items.map((raw: unknown) => {
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
      if (host) page = filterSchoolEmails(page, host);
      all = all.concat(page);
      fetchOffset += limit;
      if (!host || rawCount < limit || fetchOffset >= total) break;
    }
    return { mails: all, total };
  } catch {
    return { mails: [], total: 0 };
  }
}
