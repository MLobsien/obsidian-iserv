// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderMailReader, renderAttachments } from "../../src/views/mail-reader";
import type { Mail, MailAttachmentMeta } from "../../src/api/mails";

const MAIL: Mail = {
  id: "1816",
  subject: "HA und Themen Klausur 7.10.",
  from: "Frau Lehrer <lehrer@gymmeck.de>",
  date: "2026-09-26",
  snippet: "Bitte erledigen",
  flags: [],
};

describe("renderMailReader (Mail-Reader-Modal-Inhalt)", () => {
  it("rendert Header (Betreff, Von, Datum) und Body als HTML-String", () => {
    const c = document.createElement("div");
    renderMailReader(c, MAIL, "<p>Hallo Klasse</p>");

    const root = c.querySelector(".iserv-mail-reader");
    expect(root).toBeTruthy();
    expect(root!.querySelector(".iserv-mail-reader-subject")?.textContent).toBe(
      MAIL.subject
    );
    expect(root!.querySelector(".iserv-mail-reader-from")?.textContent).toBe(
      MAIL.from
    );
    expect(root!.querySelector(".iserv-mail-reader-date")?.textContent).toContain(
      "26.09"
    );
    const body = root!.querySelector(".iserv-mail-reader-body") as HTMLElement;
    expect(body.innerHTML).toContain("<p>Hallo Klasse</p>");
  });

  it("leerer Body → Platzhalter (Endpoint-Spike #20 offen)", () => {
    const c = document.createElement("div");
    renderMailReader(c, MAIL, "");
    const body = c.querySelector(".iserv-mail-reader-body") as HTMLElement;
    expect(body.textContent).toContain("Body lädt");
  });

  it("leerer Body über undefined → gleicher Platzhalter", () => {
    const c = document.createElement("div");
    renderMailReader(c, MAIL);
    const body = c.querySelector(".iserv-mail-reader-body") as HTMLElement;
    expect(body.textContent).toContain("Body lädt");
  });

  it("Body mit nur Whitespace → Platzhalter, kein leerer Container", () => {
    const c = document.createElement("div");
    renderMailReader(c, MAIL, "   ");
    const body = c.querySelector(".iserv-mail-reader-body") as HTMLElement;
    expect(body.textContent).toContain("Body lädt");
  });
});

describe('renderMailReader — Anlagen', () => {
  it('keine Anlagen → keine Anlagen-Sektion', () => {
    const root = document.createElement('div');
    renderMailReader(root, MAIL, '<p>Hallo Klasse</p>');
    expect(root.querySelector('.iserv-mail-reader-attachments')).toBeNull();
  });

  it('Anlagen → Liste mit Name/Größe + Download-Buttons', () => {
    const root = document.createElement('div');
    renderMailReader(root, MAIL, '<p>Body</p>', [
      {
        filename: 'PONS_LOGO.pdf',
        mimetype: 'application/pdf',
        size: 97765,
        partId: '2',
        url: '/iserv/mail/api/v2/account/s@g.de/mailbox/SU5CT1g/message/1/part/2',
        cid: null,
      },
      {
        filename: '',
        mimetype: 'image/jpeg',
        size: 146184,
        partId: '3',
        url: '/iserv/mail/api/v2/account/s@g.de/mailbox/SU5CT1g/message/1/part/3',
        cid: 'abc@x',
      },
    ]);
    const section = root.querySelector('.iserv-mail-reader-attachments');
    expect(section).not.toBeNull();
    const rows = root.querySelectorAll('.iserv-mail-reader-attachment-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('PONS_LOGO.pdf');
    expect((rows[0] as HTMLElement).dataset.url).toContain('/part/2');
    expect(rows[1].dataset.cid).toBe('abc@x');
  });
});

describe('renderMailReader — Anlagen-Klick-Callback (Preview-Kette, Battletest Runde 5)', () => {
  const ATT: MailAttachmentMeta = {
    filename: 'Klausurplan Jahrgang 12_2026-27.pdf',
    mimetype: 'application/pdf',
    size: 97765,
    partId: '2',
    url: '/iserv/mail/api/v2/account/s@g.de/mailbox/SU5CT1g/message/1786/part/2',
    cid: null,
  };

  it('Klick auf Anlagen-Zeile feuert onAttachmentClick mit row-Daten (URL/Filename/Mime)', () => {
    const onAttachmentClick = vi.fn();
    const c = document.createElement('div');
    renderMailReader(c, MAIL, '<p>Body</p>', [ATT], { onAttachmentClick });

    const row = c.querySelector(
      '.iserv-mail-reader-attachment-row'
    ) as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.dataset.url).toContain('/message/1786/part/2');

    row.click();

    expect(onAttachmentClick).toHaveBeenCalledTimes(1);
    expect(onAttachmentClick).toHaveBeenCalledWith(
      ATT.url,
      ATT.filename,
      ATT.mimetype
    );
  });

  it('Klick feuert mit dem angezeigten (getrimmten) Dateinamen, auch bei Inline-Fallback', () => {
    const onAttachmentClick = vi.fn();
    const c = document.createElement('div');
    const inline: MailAttachmentMeta = {
      filename: '',
      mimetype: 'image/jpeg',
      size: 146184,
      partId: '3',
      url: '/iserv/mail/api/v2/account/s@g.de/mailbox/SU5CT1g/message/7/part/3',
      cid: 'abc@x',
    };
    renderMailReader(c, MAIL, '<p>Body</p>', [inline], { onAttachmentClick });

    (
      c.querySelector('.iserv-mail-reader-attachment-row') as HTMLElement
    ).click();

    expect(onAttachmentClick).toHaveBeenCalledWith(inline.url, 'Inline (image/jpeg)', 'image/jpeg');
  });

  it('ohne Callback klickt die Zeile safe (kein Crash) — Legacy-Pfad', () => {
    const c = document.createElement('div');
    renderMailReader(c, MAIL, '<p>Body</p>', [ATT]);
    const row = c.querySelector(
      '.iserv-mail-reader-attachment-row'
    ) as HTMLElement;
    expect(() => row.click()).not.toThrow();
  });

  it('renderAttachments nimmt optionalen opts-Callback direkt (wiederverwendbar)', () => {
    const onAttachmentClick = vi.fn();
    const c = document.createElement('div');
    const section = renderAttachments([ATT], { onAttachmentClick });
    c.appendChild(section);
    (c.querySelector('.iserv-mail-reader-attachment-row') as HTMLElement).click();
    expect(onAttachmentClick).toHaveBeenCalledWith(ATT.url, ATT.filename, ATT.mimetype);
  });
});
