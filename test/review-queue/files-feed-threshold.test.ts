// @vitest-environment node
/**
 * Runde 5 (User-Kritik 28.09.2026, 14:08):
 * Threshold = konfigurierbare Review-Frist in Tagen (default 7). Innerhalb
 * → "neu" (einzeln reviewen), älter → "auto" (automatisch entschieden,
 * KEIN Einzelfeedback für Alt-Dateien). dateFromMs:null = aus (Tests).
 */
import { describe, it, expect } from "vitest";
import {
  fetchQueueItems,
  isWithinThreshold,
  entryIsoDate,
  QUEUE_FEED_ROOT,
} from "../../src/review-queue/files-feed";
import type { FileEntry } from "../../src/review-queue/files-feed";

function entry(id: string, name: string, iso: string, group = "AG Informatik Ja"): FileEntry {
  // Runde 6: object-Form wie live — text = ORDNER-Breadcrumb (Runde 5-Fix),
  // Gruppe = Fach-Anker; Datei-Regex-Fallback schlägt hier bewusst fehl.
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

// Fixnow: 2026-09-28T14:00 lokal (+02:00).
const NOW = new Date("2026-09-28T14:00:00+02:00");

describe("QUEUE_FEED_ROOT (Kritik 1: Lehrer-Dateien in Groups)", () => {
  it("Default-Root ist 'Groups' — nicht mehr Files", () => {
    expect(QUEUE_FEED_ROOT).toBe("Groups");
  });

  it("fetchQueueItems listet default 'Groups' an", async () => {
    const c = clientWith([[]]);
    await fetchQueueItems(c as never, { now: NOW, dateFromMs: null });
    expect(c.paths[0]).toContain("/iserv/file/api/list/");
    expect(decodeURIComponent(c.paths[0].replace("/iserv/file/api/list/", ""))).toBe("Groups");
  });
});

describe("isWithinThreshold: Review-Frist in Tagen", () => {
  it("Datei von heute liegt im 7-Tage-Fenster", () => {
    const e = entry("a", "neu.pdf", "2026-09-28T08:00:00+02:00");
    expect(isWithinThreshold(e, NOW, 7)).toBe(true);
  });

  it("Datei vor 6 Tagen liegt noch im Fenster", () => {
    const e = entry("b", "alt.pdf", "2026-09-22T09:00:00+02:00");
    expect(isWithinThreshold(e, NOW, 7)).toBe(true);
  });

  it("Datei vor 8 Tagen liegt außerhalb (→ auto)", () => {
    const e = entry("c", "old.pdf", "2026-09-20T09:00:00+02:00");
    expect(isWithinThreshold(e, NOW, 7)).toBe(false);
  });

  it("ohne parsebares Datum → außerhalb (fail-closed)", () => {
    const e = entry("d", "x.pdf", "kein-datum");
    expect(isWithinThreshold(e, NOW, 7)).toBe(false);
  });
});

describe("fetchQueueItems: Threshold-Fenster → auto/neu (Kritik: kein Einzelfeedback für Alt)", () => {
  it("alte Datei MIT Fach → status:'auto' (Row), frische → 'neu'; alt OHNE Fach → raus (Runde 6)", async () => {
    const entries = [
      entry("id-old", "Vorlesung2024.pdf", "2024-02-19T10:00:00+00:00"),
      entry("id-new", "Trassierung.pdf", "2026-09-22T08:00:00+00:00"),
    ];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      now: NOW,
      dateFromMs: undefined,
      thresholdDays: 7,
      queueGroupMap: { "AG Informatik Ja": "Informatik" },
    });
    expect(items.map((i) => [i.name, i.subject, i.status])).toEqual([
      ["Vorlesung2024.pdf", "Informatik", "auto"],
      ["Trassierung.pdf", "Informatik", "neu"],
    ]);
  });

  it("Runde 6 (User 17:41): alt UND ohne Fach → NICHT in der Queue (keine auto-Berge)", async () => {
    const entries = [entry("id-ag", "HeroSkript2023.pdf", "2023-01-01T00:00:00+00:00")];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      now: NOW,
      dateFromMs: undefined,
      thresholdDays: 7,
      queueGroupMap: {},
    });
    expect(items).toEqual([]);
  });

  it("thresholdDays:3 → 5 Tage alt ist noch 'neu'", async () => {
    const entries = [entry("m", "mitte.pdf", "2026-09-26T08:00:00+00:00")];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      now: NOW,
      thresholdDays: 3,
    });
    expect(items[0]?.status).toBe("neu");
  });

  it("dateFromMs:null = Threshold aus (alles 'neu')", async () => {
    const entries = [entry("o", "alt.pdf", "2020-01-01T00:00:00+00:00")];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      now: NOW,
      dateFromMs: null,
    });
    expect(items[0]?.status).toBe("neu");
  });

  it("ohne parsebares Datum → 'auto' (fail-closed)", async () => {
    const entries = [entry("u", "unlesbar.pdf", "gar-kein-datum")];
    const items = await fetchQueueItems(clientWith([entries]) as never, {
      now: NOW,
      thresholdDays: 7,
      queueGroupMap: { "AG Informatik Ja": "Informatik" },
    });
    expect(items[0]?.status).toBe("auto");
    expect(items[0]?.subject).toBe("Informatik");
  });
});
