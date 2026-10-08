import { describe, it, expect } from "vitest";
import {
  normalizeDenyPath,
  DeniedFoldersStore,
  DENIED_FOLDERS_KEY,
} from "../../src/review-queue/denied-folders";

/** In-Memory PluginDataStore (Vertrag wie state.test.ts). */
function makeStore(initial: Record<string, unknown> = {}): {
  store: import("../../src/review-queue/state").PluginDataStore;
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    store: {
      loadData: async () => ({ ...data }),
      saveData: async (d) => {
        for (const k of Object.keys(data)) delete data[k];
        Object.assign(data, d);
      },
    },
  };
}

describe("normalizeDenyPath", () => {
  it("kollabiert Slashes, trimmt Ränder", () => {
    expect(normalizeDenyPath("/Groups//O Latein 12gN Sz/Memes/")).toBe(
      "Groups/O Latein 12gN Sz/Memes"
    );
    expect(normalizeDenyPath("Groups")).toBe("Groups");
  });
});

describe("DeniedFoldersStore (Issue #12 Konzept-NEU)", () => {
  it("leerer Store lädt [] und ist nicht abgelehnend", async () => {
    const { store } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    expect(s.size).toBe(0);
    expect(s.isDenied("Groups/O Latein 12gN Sz/LateinMemes/x.pdf")).toBe(false);
  });

  it("deny → isDenied für Ordner UND alles darunter (Segment-Prefix)", async () => {
    const { store } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    s.deny("Groups/O Latein 12gN Sz/LateinMemes");
    // Ordner selbst + unter ihm:
    expect(s.isDenied("Groups/O Latein 12gN Sz/LateinMemes")).toBe(true);
    expect(s.isDenied("Groups/O Latein 12gN Sz/LateinMemes/meme.jpg")).toBe(true);
    expect(s.isDenied("Groups//O Latein 12gN Sz/LateinMemes//a/b")).toBe(true);
    // Pfad-Doppelgänger mit anderem Segment: NICHT abgelehnt
    expect(s.isDenied("Groups/O Latein 12gN Sz/LateinMemesExtra/a.pdf")).toBe(false);
    // Elternteil: nicht abgelehnt
    expect(s.isDenied("Groups/O Latein 12gN Sz")).toBe(false);
  });

  it("allow nimmt Ablehnung zurück", async () => {
    const { store } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    s.deny("Groups/A/B");
    expect(s.isDenied("Groups/A/B/c")).toBe(true);
    expect(s.allow("Groups/A/B")).toBe(true);
    expect(s.isDenied("Groups/A/B/c")).toBe(false);
    expect(s.allow("Groups/A/B")).toBe(false); // schon weg
  });

  it("persistiert über Plugin.saveData (fs-Gate-Kontrakt) und lädt erneut", async () => {
    const { store, data } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    s.deny("Groups//X  ");
    await s.save();
    expect(data[DENIED_FOLDERS_KEY]).toEqual(["Groups/X"]);

    const s2 = new DeniedFoldersStore(store);
    await s2.load();
    expect(s2.list()).toEqual(["Groups/X"]);
    expect(s2.isDenied("Groups/X/file.pdf")).toBe(true);
  });

  it("malformed Persistenz (kein Array) → fail-soft leer", async () => {
    const { store } = makeStore({ [DENIED_FOLDERS_KEY]: "nope" });
    const s = new DeniedFoldersStore(store);
    await s.load();
    expect(s.size).toBe(0);
  });
});
