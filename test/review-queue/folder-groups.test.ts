// @vitest-environment node
/** Konzept-NEU Folder-Reject-UI (Issue #12, Teil 2d): pure Layer. */
import { describe, it, expect } from "vitest";
import {
  groupQueueByFolder,
  folderDiscardPayload,
  groupQueueBySubFolder,
  groupQueueBySubPath,
  coursesWithOpen,
} from "../../src/review-queue/folder-groups";
import type { QueueItem } from "../../src/review-queue/state";

function item(id: string, path: string, status: QueueItem["status"] = "neu"): QueueItem {
  return {
    id,
    name: "f.pdf",
    path,
    hash: id,
    subject: "",
    status,
  };
}

describe("groupQueueByFolder", () => {
  it("gruppiert offene Items nach Gruppen-Segment (erste Ebene unter Groups)", () => {
    const groups = groupQueueByFolder([
      item("a", "Groups/O Latein 12gN Sz/Vokabeln.pdf"),
      item("b", "Groups/O Latein 12gN Sz/Memes/x.pdf"),
      item("c", "Groups/O Kunst 12gN Gh/Bild.pdf"),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["O Latein 12gN Sz", "O Kunst 12gN Gh"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("nur offene Items (neu/unsure); kept/discarded/auto ignorieren", () => {
    const groups = groupQueueByFolder([
      item("a", "Groups/O A/X.pdf", "kept"),
      item("b", "Groups/O A/Y.pdf", "discarded"),
      item("c", "Groups/O A/Z.pdf", "auto"),
      item("d", "Groups/O A/Offen.pdf", "neu"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["d"]);
  });

  it("Items ohne Gruppen-Segment laufen NICHT in eine Gruppe", () => {
    const groups = groupQueueByFolder([item("a", "/lost.pdf"), item("b", "OnlyName.pdf")]);
    expect(groups).toEqual([]);
  });

  it("Reihenfolge = erster Auftreten (Set-Semantik)", () => {
    const groups = groupQueueByFolder([
      item("a", "Groups/O B 1/x.pdf"),
      item("b", "Groups/O A 1/y.pdf"),
      item("c", "Groups/O B 1/z.pdf"),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["O B 1", "O A 1"]);
  });
});

describe("folderDiscardPayload", () => {
  it("Payload = Gruppe + alle offenen Item-IDs + Ordnerpfad mit Feed-Root", () => {
    const queue = [
      item("a", "Groups/O Latein 12gN Sz/Vokabeln.pdf"),
      item("b", "Groups/O Latein 12gN Sz/Memes/x.pdf"),
      item("kept", "Groups/O Latein 12gN Sz/Alt.pdf", "kept"),
    ];
    const [g] = groupQueueByFolder(queue);
    expect(folderDiscardPayload(g)).toEqual({
      group: "O Latein 12gN Sz",
      itemIds: ["a", "b"],
      folderPath: "Groups/O Latein 12gN Sz",
    });
  });
});

describe("groupQueueBySubFolder (Issue #17 Punkt 4)", () => {
  it("gruppiert offene Items nach Sub-Ordner (2. Ebene) unter der Gruppe", () => {
    const queue = [
      item("a", "Groups/O Latein 12gN Sz/Lektion 7/Vokabeln.pdf"),
      item("b", "Groups/O Latein 12gN Sz/Lektion 7/Grammatik.pdf"),
      item("c", "Groups/O Latein 12gN Sz/Memes/x.pdf"),
      item("d", "Groups/O Latein 12gN Sz/DirektImKurs.pdf"),
      item("kept", "Groups/O Latein 12gN Sz/Lektion 7/Alt.pdf", "kept"),
    ];
    const [g] = groupQueueByFolder(queue);
    const subs = groupQueueBySubFolder(g);
    expect(subs.map((s) => [s.sub, s.folderPath])).toEqual([
      ["Lektion 7", "Groups/O Latein 12gN Sz/Lektion 7"],
      ["Memes", "Groups/O Latein 12gN Sz/Memes"],
    ]);
    expect(subs[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("coursesWithOpen (Issue #22 R5-2)", () => {
  it("listet ALLE Kurse mit offenen Items alphabetisch, auch Ein-Item-Kurse", () => {
    const mk = (id: string, path: string): QueueItem => ({ id, name: `${id}.pdf`, path, hash: id, subject: "", status: "neu" });
    const queue = [
      mk("a", "Groups/O Latein 12gN Sz/Memes/x.pdf"),
      mk("b", "Groups/O Chemie 12eN Hn/UE AltTS/x.pdf"),
      mk("c", "Groups/O Englisch 12gN Ha/Nur-eine.pdf"),
      mk("d", "Groups/Auto/done.pdf"),
    ];
    queue[3].status = "kept";
    const courses = coursesWithOpen(queue);
    expect(courses.map((c) => c.group)).toEqual([
      "O Chemie 12eN Hn",
      "O Englisch 12gN Ha",
      "O Latein 12gN Sz",
    ]);
    expect(courses[1].items.length).toBe(1); // Ein-Item-Kurs NICHT versteckt
  });
});
