// @vitest-environment node
/**
 * Konzept-NEU (Issue #12, maple-Freigabe 08.10): Das Threshold-Fenster
 * (auto/neu nach Review-Frist, Runde 5) fällt KOMPLETT weg — Ziel-Liste =
 * ALLE Kursordner-Dateien ohne Vault-Duplikate und ohne abgelehnte Ordner,
 * alle Items status "neu". Alt-Dateien sind KEIN eigener Row-Typ mehr;
 * "kein Einzelfeedback für Alt" wird ersetzt durch Ordner-Ablehnung
 * (deniedFolders-Kollektiv, Konzept-NEU-Kernel denied-folders.ts) und die
 * Kurs-Anker-Whitelist (courseFolderFilter). Archiv der Fenster-Semantik:
 * git-Historie dieser Datei (blob her in "$JCODE_SCRATCH_DIR/threshold-orig.ts").
 */
import { describe, it, expect } from "vitest";
import {
  fetchQueueItems,
  QUEUE_FEED_ROOT,
} from "../../src/review-queue/files-feed";
import type { FileEntry } from "../../src/review-queue/files-feed";

function entry(id: string, name: string, iso: string, group = "AG Informatik Ja"): FileEntry {
  return {
    id,
    name: { text: name },
    type: { id: "File" },
    path: { link: "", text: `${group}/Verschiedenes` },
    date: iso,
  };
}

interface FakeResp { status: number; headers: Record<string, string>; body: string }

function clientWith(entriesByCall: FileEntry[][]) {
  const paths: string[] = [];
  let call = 0;
  return {
    paths,
    request: async (path: string): Promise<FakeResp> => {
      paths.push(path);
      const entries = entriesByCall[Math.min(call, entriesByCall.length - 1)];
      call += 1;
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ data: entries, writable: false, breadcrumbs: [] }),
      };
    },
  };
}

describe("QUEUE_FEED_ROOT (Kritik 1: Lehrer-Dateien in Groups)", () => {
  it("Default-Root ist 'Groups' — nicht mehr Files", () => {
    expect(QUEUE_FEED_ROOT).toBe("Groups");
  });

  it("fetchQueueItems listet default 'Groups' an (ohne now/dateFromMs — Fenster weg)", async () => {
    const c = clientWith([[]]);
    await fetchQueueItems(c as never);
    expect(c.paths[0]).toContain("/iserv/file/api/list/");
    expect(decodeURIComponent(c.paths[0].replace("/iserv/file/api/list/", ""))).toBe("Groups");
  });
});

describe("fetchQueueItems Konzept-NEU: alle Kursordner-Dateien 'neu' (Fenster weg)", () => {
  it("alte UND frische Datei MIT Fach → beide 'neu' (kein 'auto' mehr)", async () => {
    const entries = [
      entry("id-old", "Vorlesung2024.pdf", "2024-02-19T10:00:00+00:00"),
      entry("id-new", "Trassierung.pdf", "2026-09-22T08:00:00+00:00"),
    ];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      queueGroupMap: { "AG Informatik Ja": "Informatik" },
    });
    expect(items.map((i) => [i.name, i.subject, i.status])).toEqual([
      ["Vorlesung2024.pdf", "Informatik", "neu"],
      ["Trassierung.pdf", "Informatik", "neu"],
    ]);
  });

  it("Datei MIT Kursordner aber OHNE ableitbares Fach → subject leer, bleibt 'neu' (Kurs-Anker genügt)", async () => {
    const entries = [entry("id-ag", "HeroSkript2023.pdf", "2023-01-01T00:00:00+00:00")];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      queueGroupMap: {},
      courseFolderFilter: ["AG Informatik Ja"], // Kurs-Anker: Whitelist, subject egal
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "HeroSkript2023.pdf", subject: "", status: "neu" });
  });

  it("ohne courseFolderFilter: ohne Fach → raus (Alt-Fallback-Feed, Push-Konvention)", async () => {
    const entries = [entry("id-ag", "HeroSkript2023.pdf", "2023-01-01T00:00:00+00:00")];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      queueGroupMap: {},
    });
    expect(items).toEqual([]);
  });

  it("ohne parsebares Datum → trotzdem 'neu' (Datum ist kein Filter-Kriterium mehr)", async () => {
    const entries = [entry("u", "unlesbar.pdf", "gar-kein-datum")];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      queueGroupMap: { "AG Informatik Ja": "Informatik" },
    });
    expect(items[0]?.status).toBe("neu");
    expect(items[0]?.subject).toBe("Informatik");
  });
});
