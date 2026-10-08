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

describe("DeniedFoldersStore: selektives Zulassen (Issue #17 Punkt 4)", () => {
  it("allowed Sub-Ordner gewinnt gegen denied Ancestor (längster Präfix)", async () => {
    const { store } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    s.deny("Groups/O Latein 12gN Sz");
    s.allow("Groups/O Latein 12gN Sz/Lektion 7");
    expect(s.isDenied("Groups/O Latein 12gN Sz/Lektion 7/Vokabeln.pdf")).toBe(false);
    expect(s.isDenied("Groups/O Latein 12gN Sz/Memes/x.pdf")).toBe(true);
  });

  it("allow nimmt deny am gleichen Pfad zurück (kein Doppel-Eintrag)", async () => {
    const { store } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    s.deny("Groups/O A");
    s.allow("Groups/O A");
    expect(s.isDenied("Groups/O A/file.pdf")).toBe(false);
    expect(s.list()).toEqual([]);
    expect(s.listAllowed()).toEqual(["Groups/O A"]);
  });

  it("unallow fällt auf geerbt zurück (Deny-Ancestor greift wieder)", async () => {
    const { store } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    s.deny("Groups/O B");
    s.allow("Groups/O B/Sub");
    s.unallow("Groups/O B/Sub");
    expect(s.isDenied("Groups/O B/Sub/x.pdf")).toBe(true);
  });

  it("allowed-Liste persistiert + Reload (neuer Key)", async () => {
    const { store } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    s.allow("Groups/O C/Sub");
    await s.save();
    const s2 = new DeniedFoldersStore(store);
    await s2.load();
    expect(s2.listAllowed()).toEqual(["Groups/O C/Sub"]);
  });

  it("deny räumt gleichen Pfad aus allowed (Sub-Allows bleiben)", async () => {
    const { store } = makeStore();
    const s = new DeniedFoldersStore(store);
    await s.load();
    s.allow("Groups/O D");
    s.allow("Groups/O D/Sub");
    s.deny("Groups/O D");
    // Sub-Allow bleibt: gleiche Tiefe? Nein — Sub ist TIEFER als Deny → allowed gewinnt.
    expect(s.isDenied("Groups/O D/Sub/x.pdf")).toBe(false);
    expect(s.isDenied("Groups/O D/y.pdf")).toBe(true);
  });
});
