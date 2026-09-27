/**
 * Mail-Reader-Modal-Inhalt (T9/Punkt 2, ADR-0008) — obsidian-freies Modul
 * (Seam-Split à la ADR-0007): rendert den Inhalt; Modal-Öffnung wired main.ts.
 *
 * Der Body-Endpoint ist UNBESTÄTIGT (Spike #20: alle /body-Varianten 404en).
 * Der Caller übergibt body entsprechend entweder das Snippet oder einen
 * Platzhalter-String; leeren/Whitespace-Body fängt der Renderer zusätzlich
 * mit einem eigenen Platzhalter ab.
 */
import type { Mail, MailAttachmentMeta } from "../api/mails";
import { formatMailDate } from "./format-date";

const BODY_PLACEHOLDER = "Body lädt (Endpoint-Spike offen)";

export function renderMailReader(
  container: HTMLElement,
  mail: Mail,
  body?: string,
  attachments?: MailAttachmentMeta[]
): void {
  container.replaceChildren();

  const root = document.createElement("div");
  root.className = "iserv-mail-reader";

  const subject = document.createElement("div");
  subject.className = "iserv-mail-reader-subject";
  subject.textContent = mail.subject;

  const meta = document.createElement("div");
  meta.className = "iserv-mail-reader-meta";

  const from = document.createElement("span");
  from.className = "iserv-mail-reader-from";
  from.textContent = mail.from;

  const date = document.createElement("span");
  date.className = "iserv-mail-reader-date";
  date.textContent = formatMailDate(mail.date);

  meta.appendChild(from);
  meta.appendChild(date);

  const bodyEl = document.createElement("div");
  bodyEl.className = "iserv-mail-reader-body";
  const trimmed = (body ?? "").trim();
  if (trimmed) {
    // Body ist HTML-String vom IServ-Endpoint (mailBody decodiert base64).
    bodyEl.innerHTML = trimmed;
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "iserv-mail-reader-body-placeholder";
    placeholder.textContent = BODY_PLACEHOLDER;
    bodyEl.appendChild(placeholder);
  }

  root.appendChild(subject);
  root.appendChild(meta);
  root.appendChild(bodyEl);
  if (attachments && attachments.length > 0) {
    root.appendChild(renderAttachments(attachments));
  }
  container.appendChild(root);
}

/** Anlagen-Sektion: eine Zeile je Part (Dateiname/Größe), Inline-Media mit cid. */
export function renderAttachments(
  attachments: MailAttachmentMeta[]
): HTMLElement {
  const section = document.createElement("div");
  section.className = "iserv-mail-reader-attachments";
  const label = document.createElement("div");
  label.className = "iserv-mail-reader-attachments-label";
  label.textContent = "Anlagen";
  section.appendChild(label);
  for (const att of attachments) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "iserv-mail-reader-attachment-row";
    if (att.url) row.dataset.url = att.url;
    const display = att.filename.trim() || (att.cid ? `Inline (${att.mimetype})` : "Anlage");
    row.dataset.filename = display;
    if (att.cid) {
      row.dataset.cid = att.cid;
      row.classList.add("iserv-mail-reader-attachment-inline");
    }
    const name = display;
    const nameEl = document.createElement("span");
    nameEl.className = "iserv-mail-reader-attachment-name";
    nameEl.textContent = name;
    const sizeEl = document.createElement("span");
    sizeEl.className = "iserv-mail-reader-attachment-size";
    sizeEl.textContent = formatBytes(att.size);
    row.appendChild(nameEl);
    row.appendChild(sizeEl);
    section.appendChild(row);
  }
  return section;
}

/** Byte-Größe kompakt (KB/MB). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
