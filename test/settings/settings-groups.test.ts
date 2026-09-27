/**
 * T23: Settings-Gruppen-Invarianten.
 *
 * - Jeder Top-Level-Key von DEFAULT_SETTINGS taucht in mindestens einer Gruppe auf
 *   (ggf. via Sub-Key eines strukturierten Settings wie jobIntervals).
 * - Gruppenformat: type-Limitierung ("text" | "toggle" | "textarea"),
 *   nicht-leere Titel/Settings.
 */
import { DEFAULT_SETTINGS, type IServSettings } from "../../src/settings/settings-types";
import { SETTING_GROUPS } from "../../src/settings/settings-groups";

const VALID_TYPES = new Set(["text", "toggle", "textarea", "select"] as const);

describe("settings-groups", () => {
  it("jeder DEFAULT_SETTINGS-Key taucht in mindestens einer Gruppe auf", () => {
    const known = new Set(
      SETTING_GROUPS.flatMap((g) => g.settings.map((s) => s.key))
    );
    const missing: string[] = [];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (value !== null && typeof value === "object") {
        // Strukturierte Settings: Sub-Keys als eigene Control-Slots akzeptieren
        // (Runde 4: a.b-Keys wie jobIntervals.core statt rohem JSON-Block).
        const subs = Object.keys(value as Record<string, unknown>);
        if (subs.length > 0 && subs.every((s) => known.has(`${key}.${s}`))) {
          continue;
        }
      }
      if (!known.has(key)) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it("Gruppenformat: type-Limitierung, nicht-leere Titel/Settings", () => {
    expect(SETTING_GROUPS.length).toBeGreaterThan(0);
    for (const group of SETTING_GROUPS) {
      expect(typeof group.title).toBe("string");
      expect(group.title.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(group.settings)).toBe(true);
      for (const setting of group.settings) {
        expect(VALID_TYPES.has(setting.type)).toBe(true);
        expect(setting.key.trim().length).toBeGreaterThan(0);
        expect(setting.name.trim().length).toBeGreaterThan(0);
        expect(typeof setting.desc).toBe("string");
        expect(setting.desc.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("erwartete Gruppen existieren (Konto/Mail/Review-Queue/Sonstiges)", () => {
    const titles = SETTING_GROUPS.map((g) => g.title);
    for (const expected of ["Konto", "Mail", "Review-Queue", "Sonstiges"]) {
      expect(titles).toContain(expected);
    }
  });

  it("Props-Keys bleiben synchron mit IServSettings (Struktur-Guard)", () => {
    // Kann kompilieren nur, wenn beider Seiten typgleich sind — schützt den
    //DEFAULT-Abgleich, wenn IServSettings sich später ändert.
    const sample: IServSettings = { ...DEFAULT_SETTINGS };
    expect(Object.keys(sample).length).toBeGreaterThan(0);
  });
});

describe("settings-groups: strukturierte Keys (User-Kritik Runde 4: kein JSON)", () => {
  it("jobIntervals + prepWindowBaseDays als Sub-Key-Felder (a.b), nicht als ein JSON-Block", () => {
    const keys = SETTING_GROUPS.flatMap((g) => g.settings.map((s) => s.key));
    for (const expected of [
      "jobIntervals.core",
      "jobIntervals.mails",
      "jobIntervals.exercises",
      "prepWindowBaseDays.Klausur",
      "prepWindowBaseDays.Klassenarbeit",
      "prepWindowBaseDays.Abitur",
    ]) {
      expect(keys).toContain(expected);
    }
    // Kein roher JSON-Block-Key mehr:
    expect(keys).not.toContain("jobIntervals");
    expect(keys).not.toContain("prepWindowBaseDays");
  });

  it("gradesScale ist select mit points|grades", () => {
    const spec = SETTING_GROUPS.flatMap((g) => g.settings).find(
      (s) => s.key === "gradesScale"
    );
    expect(spec?.type).toBe("select");
    expect(spec?.options?.map((o) => o.value)).toEqual(["points", "grades"]);
  });

  it("select-Specs haben immer options", () => {
    for (const s of SETTING_GROUPS.flatMap((g) => g.settings)) {
      if (s.type === "select") {
        expect(Array.isArray(s.options)).toBe(true);
        expect((s.options ?? []).length).toBeGreaterThan(0);
      }
    }
  });
});
