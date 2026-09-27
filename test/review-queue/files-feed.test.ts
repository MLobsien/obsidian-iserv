// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  parseFileListing,
  fetchQueueItems,
  FILES_LIST_PATH,
  type FileEntry,
} from "../../src/review-queue/files-feed";
import type { QueueItem } from "../../src/review-queue/state";

function base64(path: string): string {
  return Buffer.from(path, "utf8").toString("base64");
}

interface FakeResp {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function clientWithListing(entries: FileEntry[], status = 200) {
  const paths: string[] = [];
  return {
    paths,
    request: async (path: string): Promise<FakeResp> => {
      paths.push(path);
      return {
        status,
        headers: {},
        body: JSON.stringify({ data: entries, writable: false, breadcrumbs: [] }),
      };
    },
  };
}

const E1: FileEntry = {
  id: "a1",
  name: "Chemie-Periodensystem.pdf",
  type: { id: "File" },
  path: "/Chemie/Chemie-Periodensystem.pdf",
  size: 123,
  date: "2026-09-20",
};

const E2: FileEntry = {
  id: "a2",
  name: "Mathe-Analysis-Skript.pdf",
  type: { id: "File" },
  path: "/Mathematik/Mathe-Analysis-Skript.pdf",
  size: 456,
  date: "2026-09-21",
};

const FOLDER: FileEntry = {
  id: "f1",
  name: "Ordner",
  type: { id: "Folder" },
  path: "/Ordner",
  size: 0,
  date: "2026-09-20",
};

describe("parseFileListing", () => {
  it("akzeptiert das file/api/list-JSON (data-Array)", () => {
    const out = parseFileListing(JSON.stringify({ data: [E1], writable: false }));
    expect(out).toEqual([E1]);
  });

  it("fail-soft bei Non-JSON, fehlendem data oder nicht-Objekt-Einträgen", () => {
    expect(parseFileListing("kein json")).toEqual([]);
    expect(parseFileListing("{}")).toEqual([]);
    expect(
      parseFileListing(JSON.stringify({ data: [E1, "kaputt", null] }))
    ).toEqual([E1]);
  });
});

describe("fetchQueueItems", () => {
  it("fragt file/api/list mit base64-Pfad an (iserv-api.md: id=<b64>)", async () => {
    const c = clientWithListing([]);
    await fetchQueueItems(c as never);
    expect(c.paths).toEqual([
      `${FILES_LIST_PATH}?id=${base64("Files")}`,
    ]);
  });

  it("nur type=File-Einträge landen in der Queue (Ordner raus)", async () => {
    const c = clientWithListing([E1, FOLDER, E2]);
    const items = await fetchQueueItems(c as never);
    expect(items.map((i) => i.id).sort()).toEqual(["a1", "a2"]);
  });

  it("QueueItem-Vertrag: name/path/hash=id, status=neu, Fach-Vermutung aus vaultSubjects", async () => {
    const c = clientWithListing([E1]);
    const items = await fetchQueueItems(c as never, {
      vaultSubjects: ["Chemie", "Mathematik"],
    });
    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({
      id: "a1",
      name: "Chemie-Periodensystem.pdf",
      path: "/Chemie/Chemie-Periodensystem.pdf",
      hash: "a1",
      subject: "Chemie",
      status: "neu",
    });
  });

  it("ohne Fach-Treffer bleibt subject leer (Fach-Vermutung, nie auto-apply)", async () => {
    const c = clientWithListing([E1]);
    const items = await fetchQueueItems(c as never, { vaultSubjects: ["Kunst"] });
    expect(items[0].subject).toBe("");
  });

  it("dedupliziert gegen bestehende Queue-IDs (kein Zweit-Eintrag gleicher Datei)", async () => {
    const existing: QueueItem[] = [
      {
        id: "a1",
        name: "Chemie-Periodensystem.pdf",
        path: "/Chemie/Chemie-Periodensystem.pdf",
        hash: "a1",
        subject: "Chemie",
        status: "kept",
      },
    ];
    const c = clientWithListing([E1, E2]);
    const items = await fetchQueueItems(c as never, { existing });
    expect(items.map((i) => i.id)).toEqual(["a2"]);
  });

  it("Non-200 oder Client-Fehler → leere Liste (best-effort Feed)", async () => {
    const c = clientWithListing([E1], 500);
    expect(await fetchQueueItems(c as never)).toEqual([]);
    const broken = {
      request: async () => {
        throw new Error("net down");
      },
    };
    expect(await fetchQueueItems(broken as never)).toEqual([]);
  });
});
