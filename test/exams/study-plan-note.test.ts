/**
 * writeStudyPlanNote (T20, ADR-0006/0008): idempotente Note-Erzeugung via
 * injectable Vault-Adapter (kein Obsidian-Import). Pfad-Konvention:
 * Lernplan/<Fach>/<due>-<Titel>.md; exists → 'existing' (no overwrite).
 */
import { describe, it, expect, vi } from "vitest";
import { writeStudyPlanNote, studyPlanNotePath } from "../../src/exams/study-plan-note";
import type { VaultNoteAdapter } from "../../src/exams/study-plan-note";

function makeVault() {
  const files = new Map<string, string>();
  const adapter: VaultNoteAdapter = {
    exists: (p) => files.has(p),
    create: async (p, c) => {
      files.set(p, c);
    },
    modify: async (p, c) => {
      files.set(p, c);
    },
  };
  return { files, adapter };
}

const baseInput = {
  examTitle: "Klausur 7.10.",
  examDate: "2026-10-07",
  subject: "Politik",
  notizenNoten: ["Politik/Notizen/Verfassungsorgane.md"],
};

describe("studyPlanNotePath", () => {
  it("Lernplan/<Fach>/<due>-<Titel>.md mit Pfad-Sanitizing", () => {
    expect(studyPlanNotePath(baseInput)).toBe(
      "Lernplan/Politik/2026-10-07-Klausur 7.10..md"
    );
  });

  it("sanitize entfernt Pfadtrenner im Fach und Titel", () => {
    expect(studyPlanNotePath({ ...baseInput, subject: "Politik/WiPo" })).toBe(
      "Lernplan/Politik-WiPo/2026-10-07-Klausur 7.10..md"
    );
  });
});

describe("writeStudyPlanNote", () => {
  it("erzeugt Note mit Frontmatter/Sections und meldet created", async () => {
    const { files, adapter } = makeVault();
    const r = await writeStudyPlanNote(adapter, baseInput);
    expect(r.status).toBe("created");
    expect(r.path).toBe("Lernplan/Politik/2026-10-07-Klausur 7.10..md");
    const c = files.get(r.path) ?? "";
    expect(c).toContain('exam: Klausur 7.10.');
    expect(c).toContain("subject: Politik");
    expect(c).toContain("due: 2026-10-07");
    expect(c).toContain("status: geplant");
    expect(c).toContain("## Material");
    expect(c).toContain("[[Politik/Notizen/Verfassungsorgane.md]]");
    expect(c).toContain("## Lernplan");
    expect(c).toContain("Session 1");
  });

  it("exists → 'existing', Inhalt unangetastet (no overwrite)", async () => {
    const { files, adapter } = makeVault();
    await writeStudyPlanNote(adapter, baseInput);
    const before = files.get("Lernplan/Politik/2026-10-07-Klausur 7.10..md");
    const r = await writeStudyPlanNote(adapter, baseInput);
    expect(r.status).toBe("existing");
    expect(files.get(r.path)).toBe(before);
  });
});
