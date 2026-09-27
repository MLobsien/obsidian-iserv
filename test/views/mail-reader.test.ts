// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderMailReader } from "../../src/views/mail-reader";
import type { Mail } from "../../src/api/mails";

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
