// @vitest-environment jsdom
/**
 * Dateibrowser-Tests (Issue #11): reine Logik (Breadcrumb, Sortierung) +
 * jsdom-Rendering (Klick-Kette Ordner/Datei/Breadcrumb), kein Obsidian.
 */
import { describe, it, expect } from "vitest";
import {
  FILES_BROWSER_ROOT,
  filesBreadcrumb,
  sortBrowserEntries,
  renderFilesBrowser,
} from "../../src/views/files-browser";
import { parseFileListing } from "../../src/review-queue/files-feed";

const folder = (name: string) => ({
  id: `b64:${name}`,
  name: { text: name },
  type: { id: "Folder" },
  path: { text: "Gruppen" },
});
const file = (name: string, size = 1024) => ({
  id: `f64:${name}`,
  name: { text: name },
  type: { id: "File" },
  size,
  path: { text: "Gruppen" },
});

describe("filesBreadcrumb", () => {
  it("Root → genau ein Crumb", () => {
    expect(filesBreadcrumb(FILES_BROWSER_ROOT)).toEqual([
      { label: "Gruppen", path: "Groups" },
    ]);
  });

  it("Unterordner → ackern Crumbs mit kumulativen Pfaden", () => {
    const crumbs = filesBreadcrumb("Groups/Physik/Klausuren");
    expect(crumbs.map((c) => c.path)).toEqual([
      "Groups",
      "Groups/Physik",
      "Groups/Physik/Klausuren",
    ]);
    expect(crumbs.map((c) => c.label)).toEqual(["Gruppen", "Physik", "Klausuren"]);
  });
});

describe("sortBrowserEntries", () => {
  it("Ordner zuerst, Dateien danach (Server-Reihenfolge innerhalb stabil)", () => {
    const out = sortBrowserEntries([file("b.pdf"), folder("Z"), folder("A"), file("a.pdf")]);
    expect(
      out.map((e: any) => e.name.text)
    ).toEqual(["Z", "A", "b.pdf", "a.pdf"]);
  });
});

describe("renderFilesBrowser (jsdom)", () => {
  function render(entries: unknown[], cwd = "Groups") {
    const container = document.createElement("div") as HTMLElement;
    const events: string[] = [];
    renderFilesBrowser(container, {
      cwd,
      entries: entries as never,
      onNavigate: (p) => events.push(`nav:${p}`),
      onFileOpen: (f) => events.push(`open:${f.path}`),
    });
    return { container, events };
  }

  it("root: Folder-Row klick → nav auf Groups/<Name>", () => {
    const { container, events } = render([folder("Physik")]);
    const row = container.querySelector(".iserv-files-browser-row-folder")!;
    (row as HTMLElement).click();
    expect(events).toEqual(["nav:Groups/Physik"]);
  });

  it("File-Row klick → open mit vollem Pfad cwd/name", () => {
    const { container, events } = render([file("Klausur.pdf")], "Groups/Physik");
    const row = container.querySelector(".iserv-files-browser-row-file")!;
    (row as HTMLElement).click();
    expect(events).toEqual(["open:Groups/Physik/Klausur.pdf"]);
  });

  it("Breadcrumb-Klick navigiert zur Ebene", () => {
    const { container, events } = render([folder("x")], "Groups/Physik/Klausuren");
    const crumbs = Array.from(container.querySelectorAll(".iserv-files-browser-crumb"))
      .filter((c) => !c.classList.contains("is-current")) as HTMLElement[];
    crumbs[0].click(); // "Gruppen" → Root
    expect(events).toContain("nav:Groups");
  });

  it("Ladestatus + Fehlerzeile fail-soft", () => {
    const c1 = document.createElement("div");
    renderFilesBrowser(c1, { cwd: "Groups", entries: [], loading: true });
    expect(c1.textContent).toContain("Lade Ordner");
    const c2 = document.createElement("div");
    renderFilesBrowser(c2, { cwd: "Groups", entries: [], error: "kein Netz" });
    expect(c2.textContent).toContain("kein Netz");
  });

  it("Server-Listing-JSON wird von parseFileListing verarbeitet (Integration über Feed-Parser)", () => {
    const body = JSON.stringify({
      data: [folder("Physik"), file("Klausur.pdf")],
      breadcrumbs: [],
    });
    expect(parseFileListing(body)).toHaveLength(2);
  });
});
