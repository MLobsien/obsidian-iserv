// @vitest-environment jsdom
/**
 * T9/T10-Tests: Pagination-Komponente (src/views/paginate.ts).
 * - paginate(): Slicing auf der angegebenen page/pageSize
 * - totalPages-Grenzfälle (leere Liste, Rest-Seite, page-Klemmung)
 * - renderPagination(): DOM-Struktur (Buttons ‹ 1 2 3 ›) + onPage-Callback bei Klick
 * (DOM-Tests daher @vitest-environment jsdom; paginate selbst ist pure.)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  paginate,
  renderPagination,
  renderBrowseButtons,
  MAIL_PAGE_SIZE,
} from "../../src/views/paginate";

describe("paginate — Slicing", () => {
  const list25 = Array.from({ length: 25 }, (_, i) => i + 1); // 1..25

  it("schneidet die angefrage Seite heraus (0-basiert)", () => {
    expect(paginate(list25, 0, 10).items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(paginate(list25, 1, 10).items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(paginate(list25, 2, 10).items).toEqual([21, 22, 23, 24, 25]); // Rest-Seite
  });

  it("MAIL_PAGE_SIZE ist 10 (Task-Vorgabe)", () => {
    expect(MAIL_PAGE_SIZE).toBe(10);
  });

  it("leere Liste: totalPages=1, page=0, items=[]", () => {
    const r = paginate([], 0, 10);
    expect(r.items).toEqual([]);
    expect(r.totalPages).toBe(1);
    expect(r.page).toBe(0);
    expect(r.total).toBe(0);
  });

  it("genau eine volle Seite: totalPages=1", () => {
    const r = paginate([1, 2, 3], 0, 10);
    expect(r.items).toEqual([1, 2, 3]);
    expect(r.totalPages).toBe(1);
    expect(r.total).toBe(3);
  });

  it("Seitengrenze: pageSize=10 → je 10 Items pro Seite", () => {
    expect(paginate(list25, 0, 10).items).toHaveLength(10);
    expect(paginate(list25, 0, 10).totalPages).toBe(3);
  });

  it("page außerhalb des Bereichs wird geklemmt", () => {
    expect(paginate(list25, 99, 10).page).toBe(2);
    expect(paginate(list25, -5, 10).page).toBe(0);
    expect(paginate(list25, 99, 10).items).toEqual([21, 22, 23, 24, 25]);
  });

  it("nicht-endliche/krumme page/pageSize führen zu gültigen Werten (kein Throw)", () => {
    expect(paginate(list25, Number.NaN, 10).page).toBe(0);
    expect(paginate(list25, 0, Number.NaN).items).toEqual([1]); // pageSize → 1
    expect(paginate(list25, 1.7, 10).items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]); // floor(1.7)=1
    expect(paginate(list25, 0, 0).totalPages).toBe(25); // pageSize → 1
  });

  it("nimmt keine Änderungen am Input vor (Länge bleibt)", () => {
    paginate(list25, 1, 10);
    expect(list25).toHaveLength(25);
  });
});

describe("renderPagination — DOM-Struktur + onPage-Callback", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert ‹ Buttons 1..N › mit ARIA-Labels", () => {
    renderPagination(container, { page: 1, totalPages: 3 });
    const nav = container.querySelector("nav.iserv-pagination");
    expect(nav).toBeTruthy();
    expect(nav!.getAttribute("aria-label")).toBe("Seitennavigation");

    const btns = nav!.querySelectorAll<HTMLButtonElement>("button");
    // prev + 3 Seiten + next
    expect(btns).toHaveLength(5);
    expect(btns[0].textContent).toBe("‹");
    expect(btns[0].getAttribute("aria-label")).toBe("Vorherige Seite");
    expect(btns[btns.length - 1].textContent).toBe("›");
    expect(btns[btns.length - 1].getAttribute("aria-label")).toBe("Nächste Seite");
    const pages = [...btns].slice(1, -1).map((b) => b.textContent);
    expect(pages).toEqual(["1", "2", "3"]);
    // aktive Seite auf 1 (0-basiert page=1)
    const active = nav!.querySelector<HTMLButtonElement>(".iserv-pagination-active");
    expect(active!.getAttribute("aria-current")).toBe("page");
  });

  it("Klick auf Seitenzahl feuert onPage mit der 0-basierten Ziel-Seite", () => {
    const onPage = vi.fn();
    renderPagination(container, { page: 0, totalPages: 3, onPage });
    const p2 = container.querySelector<HTMLButtonElement>(".iserv-pagination-page[data-page='2']")!;
    expect(p2.textContent).toBe("3"); // 0-basiert 2 → Button-Label 3
    p2.click();
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("prev/next feuern onPage(page ± 1); an Grenzen disabled (kein Call, kein Abdunkeln)", () => {
    const onPage = vi.fn();
    renderPagination(container, { page: 1, totalPages: 3, onPage });

    const prev = container.querySelector<HTMLButtonElement>(".iserv-pagination-prev")!;
    const next = container.querySelector<HTMLButtonElement>(".iserv-pagination-next")!;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    next.click();
    expect(onPage).toHaveBeenCalledWith(2);
    prev!.click();
    expect(onPage).toHaveBeenCalledWith(0);

    // Grenzen: Seite 0 → prev disabled; letzte → next disabled; disabled feuert nicht
    const c0 = document.createElement("div");
    document.body.appendChild(c0);
    renderPagination(c0, { page: 0, totalPages: 3, onPage });
    expect(c0.querySelector<HTMLButtonElement>(".iserv-pagination-prev")!.disabled).toBe(true);
    expect(c0.querySelector<HTMLButtonElement>(".iserv-pagination-next")!.disabled).toBe(false);

    const cLast = document.createElement("div");
    document.body.appendChild(cLast);
    renderPagination(cLast, { page: 2, totalPages: 3, onPage });
    expect(cLast.querySelector<HTMLButtonElement>(".iserv-pagination-next")!.disabled).toBe(true);
    cLast.querySelector<HTMLButtonElement>(".iserv-pagination-next")!.click();
    expect(onPage).toHaveBeenCalledTimes(2); // kein zusätzlicher Aufruf
  });

  it("ohne onPage ist Klick kein Fehler", () => {
    renderPagination(container, { page: 0, totalPages: 2 });
    const pageBtn = container.querySelector<HTMLButtonElement>(".iserv-pagination-page")!;
    expect(() => pageBtn.click()).not.toThrow();
  });

  it("Sliding Window: viele Seiten → maxButtons Buttons, Fenster um die aktive Seite", () => {
    renderPagination(container, { page: 5, totalPages: 20, maxButtons: 5 });
    const pages = [...container.querySelectorAll<HTMLButtonElement>(".iserv-pagination-page")];
    expect(pages).toHaveLength(5);
    expect(pages.map((b) => b.textContent)).toEqual(["4", "5", "6", "7", "8"]); // zentriert um page=5
  });

  it("eine einzige Seite: nur aktive Seite, prev/next disabled", () => {
    renderPagination(container, { page: 0, totalPages: 1 });
    const pages = [...container.querySelectorAll<HTMLButtonElement>(".iserv-pagination-page")];
    expect(pages).toHaveLength(1);
    expect(pages[0].textContent).toBe("1");
    expect(container.querySelector<HTMLButtonElement>(".iserv-pagination-prev")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".iserv-pagination-next")!.disabled).toBe(true);
  });
});

describe("renderBrowseButtons — server-seitiges Blättern (T9/T10, User-Feedback)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert ‹ Ältere Mails / Neuere Mails › mit ARIA-Labels", () => {
    renderBrowseButtons(container, { page: 1 });
    const nav = container.querySelector("nav.iserv-mail-browse");
    expect(nav).toBeTruthy();
    const older = nav!.querySelector<HTMLButtonElement>(".iserv-pagination-older")!;
    const newer = nav!.querySelector<HTMLButtonElement>(".iserv-pagination-newer")!;
    expect(older.textContent).toContain("Ältere Mails");
    expect(newer.textContent).toContain("Neuere Mails");
    expect(older.getAttribute("aria-label")).toBe("Ältere Mails laden");
    expect(newer.getAttribute("aria-label")).toBe("Neuere Mails laden");
  });

  it("Ältere-Button feuert onPage(page + 1)", () => {
    const onPage = vi.fn();
    renderBrowseButtons(container, { page: 0, onPage });
    const older = container.querySelector<HTMLButtonElement>(".iserv-pagination-older")!;
    older.click();
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("Neuere-Button feuert onPage(page - 1), disabled auf Seite 0", () => {
    const onPage = vi.fn();
    renderBrowseButtons(container, { page: 2, onPage });
    const newer = container.querySelector<HTMLButtonElement>(".iserv-pagination-newer")!;
    expect(newer.disabled).toBe(false);
    newer.click();
    expect(onPage).toHaveBeenCalledWith(1);

    const c0 = document.createElement("div");
    document.body.appendChild(c0);
    renderBrowseButtons(c0, { page: 0, onPage });
    expect(c0.querySelector<HTMLButtonElement>(".iserv-pagination-newer")!.disabled).toBe(true);
    c0.querySelector<HTMLButtonElement>(".iserv-pagination-newer")!.click();
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it("Ältere-Button disabled bei hasOlder=false (letzte server-seitige Seite)", () => {
    const onPage = vi.fn();
    renderBrowseButtons(container, { page: 2, hasOlder: false, onPage });
    expect(container.querySelector<HTMLButtonElement>(".iserv-pagination-older")!.disabled).toBe(true);
    container.querySelector<HTMLButtonElement>(".iserv-pagination-older")!.click();
    expect(onPage).not.toHaveBeenCalled();
  });

  it("ohne onPage ist Klick kein Fehler", () => {
    renderBrowseButtons(container, { page: 0 });
    expect(() =>
      container.querySelector<HTMLButtonElement>(".iserv-pagination-older")!.click()
    ).not.toThrow();
  });
});
