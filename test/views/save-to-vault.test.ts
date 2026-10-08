// @vitest-environment jsdom
/**
 * Save-to-Vault-Tests: pure Logik (defaultVaultTargetPath, suggestVaultFolders,
 * classifyAttachment) + Save-Modal-Inhalt (renderSaveToVault).
 *
 * Invarianten (User-Kritik T22-Follow-Up):
 * - Anlage → Vorschlagspfad aus Fach-Vermutung + Template, NIE stabiles "Anlagen/".
 * - Speichern passiert nur auf expliziten Button mit dem (editierbaren) Pfad.
 */
import { describe, it, expect, vi } from "vitest";
import {
  defaultVaultTargetPath,
  suggestVaultFolders,
  classifyAttachment,
  joinTargetPath,
  previewFullPath,
  renderSaveToVault,
} from "../../src/views/save-to-vault";

describe("classifyAttachment", () => {
  it("PDFs (Mime + Endung, Groß/Klein) → pdf", () => {
    expect(classifyAttachment("application/pdf", "x.pdf")).toBe("pdf");
    expect(classifyAttachment("", "Dok.PDF")).toBe("pdf");
  });
  it("Bilder (Mime) → image; Rest → other", () => {
    expect(classifyAttachment("image/png", "x")).toBe("image");
    expect(classifyAttachment("application/zip", "a.zip")).toBe("other");
    expect(classifyAttachment("text/plain", "")).toBe("other");
  });
});

describe("suggestVaultFolders", () => {
  it("leitet Top-Level-Ordner aus Pfaden ab (dedupliziert)", () => {
    expect(
      suggestVaultFolders([
        { path: "Schule/Mathe/Material.md" },
        { path: "Schule/Deutsch/HA.md" },
        { path: "Notizen.md" },
      ])
    ).toEqual(["Schule"]);
  });

  it("leere/flache Liste → leere Vorschläge", () => {
    expect(suggestVaultFolders([{ path: "Notizen.md" }])).toEqual([]);
    expect(suggestVaultFolders([])).toEqual([]);
  });
});

describe("defaultVaultTargetPath (Fach-Vermutung + Template)", () => {
  it("Vault-Fach matcht am Dateinamen (Mathematik-Kontext), Betreff-Fallback", () => {
    const p = defaultVaultTargetPath({
      subject: "HA und Themen Klausur",
      vaultSubjects: ["Mathematik", "Deutsch", "Chemie"],
      template: "{{SUBJECT}}/Material/{{SCHOOLYEAR}}",
      now: new Date("2026-09-26T10:00:00+02:00"),
      filename: "Mathematik-Blatt05.pdf",
    });
    expect(p).toBe("Mathematik/Material/2026/27");
  });

  it("kein Match → Fallback 'Allgemein' (niemals 'Anlagen/')", () => {
    const p = defaultVaultTargetPath({
      subject: "Information zur Schulbuslinie",
      vaultSubjects: ["Mathematik"],
      template: "{{SUBJECT}}/Material/{{SCHOOLYEAR}}",
      now: new Date("2026-09-26T10:00:00+02:00"),
    });
    expect(p).toBe("Allgemein/Material/2026/27");
    expect(p).not.toContain("Anlagen");
  });

  it(" Somerset-Fallback: Dateiname setzt Fach-Vermutung fort, wenn Betreff nichts ergibt", () => {
    const p = defaultVaultTargetPath({
      subject: "Elternbrief Hausaufgaben",
      vaultSubjects: ["Latein"],
      template: "{{SUBJECT}}",
      filename: "Latein-Vokabeln.pdf",
    });
    expect(p).toContain("Latein");
  });

  it("Sanitize: Pfad ohne doppelte/leading Slashes", () => {
    const p = defaultVaultTargetPath({
      subject: "",
      vaultSubjects: [],
      template: "//{{SUBJECT}}//Material",
      filename: "",
    });
    expect(p).not.toMatch(/^\/|\/\//);
  });
});

describe("joinTargetPath", () => {
  it("kombiniert Ziel + Dateiname, sanitiziert", () => {
    expect(joinTargetPath("Mathematik/Material", "Übungsblatt.pdf")).toBe(
      "Mathematik/Material/Übungsblatt.pdf"
    );
    expect(joinTargetPath("Ziel/", "a.pdf")).toBe("Ziel/a.pdf");
  });
});

describe("renderSaveToVault (Save-Modal-Inhalt)", () => {
  it("rendert Header + Vorschlagspfad als Input-Value", () => {
    const c = document.createElement("div");
    renderSaveToVault(c, {
      suggestedPath: "Mathematik/Material/2026/27",
      filename: "Übungsblatt.pdf",
      onSave: () => undefined,
    });
    expect(
      c.querySelector(".iserv-save-to-vault-header")?.textContent
    ).toContain("Übungsblatt.pdf");
    const input = c.querySelector<HTMLInputElement>(
      ".iserv-save-to-vault-input"
    )!;
    expect(input.value).toBe("Mathematik/Material/2026/27");
  });

  it("Speichern-Button ruft onSave mit dem (editierten) Pfad", () => {
    const c = document.createElement("div");
    const onSave = vi.fn();
    renderSaveToVault(c, {
      suggestedPath: "Allgemein",
      filename: "a.pdf",
      onSave,
    });
    const input = c.querySelector<HTMLInputElement>(
      ".iserv-save-to-vault-input"
    )!;
    input.value = "Chemie/Klausuren/2026-27";
    (
      c.querySelector<HTMLButtonElement>(".iserv-save-to-vault-save")!
    ).click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("Chemie/Klausuren/2026-27");
  });

  it("Abbrechen ruft onCancel (optional, kein onSave)", () => {
    const c = document.createElement("div");
    const onSave = vi.fn();
    const onCancel = vi.fn();
    renderSaveToVault(c, {
      suggestedPath: "x",
      filename: "a.pdf",
      onSave,
      onCancel,
    });
    (
      c.querySelector<HTMLButtonElement>(".iserv-save-to-vault-cancel")!
    ).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("leere Pfadeingabe → onSave mit '' (Caller entscheidet Fallback)", () => {
    const c = document.createElement("div");
    const onSave = vi.fn();
    renderSaveToVault(c, { suggestedPath: "x", filename: "a.pdf", onSave });
    const input = c.querySelector<HTMLInputElement>(
      ".iserv-save-to-vault-input"
    )!;
    input.value = "   ";
    (
      c.querySelector<HTMLButtonElement>(".iserv-save-to-vault-save")!
    ).click();
    expect(onSave).toHaveBeenCalledWith("");
  });
});

describe("renderSaveToVault: Ordner-Select + Dateiname (User-Kritik Runde 4)", () => {
  it("mit folderOptions: select statt Pfad-Freitext, Dateiname editierbar", () => {
    const c = document.createElement("div");
    const onSave = vi.fn();
    renderSaveToVault(c, {
      suggestedPath: "Mathematik/Material/2026/27",
      filename: "Blatt05.pdf",
      folderOptions: ["Allgemein", "Mathematik", "Deutsch"],
      onSave,
    });
    const select = c.querySelector<HTMLSelectElement>(
      ".iserv-save-to-vault-folder"
    )!;
    expect(select).not.toBeNull();
    expect(select.value).toBe("Mathematik");
    const opts = [...select.options].map((o) => o.value);
    expect(opts).toEqual(["Allgemein", "Mathematik", "Deutsch"]);
    const name = c.querySelector<HTMLInputElement>(
      ".iserv-save-to-vault-filename"
    )!;
    expect(name.value).toBe("Blatt05.pdf");
    (c.querySelector<HTMLButtonElement>(".iserv-save-to-vault-save")!).click();
    expect(onSave).toHaveBeenCalledWith("Mathematik/Blatt05.pdf");
  });

  it("Select-Wechsel + Dateiname-Edit fliesst in onSave ein", () => {
    const c = document.createElement("div");
    const onSave = vi.fn();
    renderSaveToVault(c, {
      suggestedPath: "Allgemein",
      filename: "a.pdf",
      folderOptions: ["Allgemein", "Chemie"],
      onSave,
    });
    const select = c.querySelector<HTMLSelectElement>(
      ".iserv-save-to-vault-folder"
    )!;
    select.value = "Chemie";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const name = c.querySelector<HTMLInputElement>(
      ".iserv-save-to-vault-filename"
    )!;
    name.value = "Klausur.pdf";
    (c.querySelector<HTMLButtonElement>(".iserv-save-to-vault-save")!).click();
    expect(onSave).toHaveBeenCalledWith("Chemie/Klausur.pdf");
  });

  it("ohne folderOptions: Freitext-Pfad wie gehabt (Rückwärtskompatibilität)", () => {
    const c = document.createElement("div");
    const onSave = vi.fn();
    renderSaveToVault(c, {
      suggestedPath: "X/Y",
      filename: "a.pdf",
      onSave,
    });
    expect(
      c.querySelector<HTMLInputElement>(".iserv-save-to-vault-input")
    ).not.toBeNull();
    expect(
      c.querySelector<HTMLSelectElement>(".iserv-save-to-vault-folder")
    ).toBeNull();
  });
});

describe("renderSaveToVault: vollständiger Pfad sichtbar (Issue #16)", () => {
  it("Breadcrumb-Zeile zeigt kompletten Pfad (Ordner-Segmente + Dateiname)", () => {
    const c = document.createElement("div");
    renderSaveToVault(c, {
      suggestedPath: "Mathematik/Material/2026/27",
      filename: "Blatt05.pdf",
      folderOptions: ["Allgemein", "Mathematik", "Deutsch"],
      onSave: () => undefined,
    });
    const label = c.querySelector(".iserv-save-to-vault-path")?.textContent ?? "";
    expect(label).toContain("Vollständiger Pfad:");
    // ALLE Ordner-Segmente + Dateiname im Text (maple-Layout-Assertion).
    expect(label).toContain("Mathematik");
    expect(label).toContain("Blatt05.pdf");
  });

  it("Select-Wechsel zeichnet den Pfad LIVE nach (Klasse ersetzt)", () => {
    const c = document.createElement("div");
    renderSaveToVault(c, {
      suggestedPath: "Allgemein",
      filename: "a.pdf",
      folderOptions: ["Allgemein", "Chemie"],
      onSave: () => undefined,
    });
    const label = c.querySelector(".iserv-save-to-vault-path") as HTMLElement;
    expect(label.textContent).toContain("Allgemein/a.pdf");
    const select = c.querySelector<HTMLSelectElement>(
      ".iserv-save-to-vault-folder"
    )!;
    select.value = "Chemie";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(label.textContent).toContain("Chemie/a.pdf");
    // Freitext-Pfad-Variante updated ebenfalls (input-Event).
    const name = c.querySelector<HTMLInputElement>(
      ".iserv-save-to-vault-filename"
    )!;
    name.value = "Klausur.pdf";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    expect(label.textContent).toContain("Chemie/Klausur.pdf");
  });

  it("Freitext-Modus (ohne folderOptions): Pfad-Zeile folgt dem Input", () => {
    const c = document.createElement("div");
    renderSaveToVault(c, {
      suggestedPath: "X/Y",
      filename: "a.pdf",
      onSave: () => undefined,
    });
    const label = c.querySelector(".iserv-save-to-vault-path") as HTMLElement;
    expect(label.textContent).toContain("X/Y");
    const input = c.querySelector<HTMLInputElement>(
      ".iserv-save-to-vault-input"
    )!;
    input.value = "Ziemlich/Tiefer/Pfad/Blatt.pdf";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(label.textContent).toContain("Ziemlich/Tiefer/Pfad/Blatt.pdf");
  });
});

describe("previewFullPath", () => {
  it("kombiniert Ordner + Dateiname, trimmt Slashes", () => {
    expect(previewFullPath("Mathematik", "Blatt05.pdf")).toBe(
      "Mathematik/Blatt05.pdf"
    );
    expect(previewFullPath("/Ordner/", "a.pdf")).toBe("Ordner/a.pdf");
    expect(previewFullPath("f", " a.pdf ")).toBe("f/a.pdf");
  });
});
