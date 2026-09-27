/**
 * Save-to-Vault (User-Kritik auf T22, ADR-0001-Fach-Ablage): Anlagen werden
 * NICHT stumm nach "Anlagen/" geschrieben. Der Ablage-Pfad wird aus Fach-
 * Vermutung (subject-guess, ADR-0001) + Template (review-queue/template.ts)
 * vorgeschlagen; der Nutzer bestätigt/ändert ihn in einem Save-Modal.
 *
 * Two obsidian-free layers (Seam-Split wie pdf-viewer.ts):
 * - Pure Logik (defaultVaultTargetPath, suggestVaultFolders, classifyKind).
 * - renderSaveToVault(container, opts): Inhalt des Save-Modals — Pfad-Input
 *   (default = Vorschlag), Speichern-Button, Abbrechen. Die Obsidian-Shell
 *   (SaveAttachmentModal in main.ts) wired nur Klicks → opts.onSave.
 *
 * Download-Pipeline (IServClient.request → stringToBytes → adapter.writeBinary)
 * bleibt unverändert — nur der Pfad kommt aus dem Modal statt fix "Anlagen/".
 */
import { guessSubject } from "../review-queue/subject-guess";
import {
  getDefaultTemplate,
  calculateSchoolYear,
  resolveTemplate,
  sanitizePath,
} from "../review-queue/template";

/** Anlagen-Klassen (steuert Preview-Zweig im Mail-Reader). */
export type AttachmentKind = "pdf" | "image" | "other";

export function classifyAttachment(mimetype: string, filename: string): AttachmentKind {
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (mimetype === "application/pdf" || ext === "pdf") return "pdf";
  if (mimetype.startsWith("image/")) return "image";
  return "other";
}

/** Vault-Fachordner-Namen aus einem Obsidian-Vault-ähnlichen File-Listing. */
export function suggestVaultFolders(entries: { path: string }[]): string[] {
  const names = new Set<string>();
  for (const e of entries) {
    const parts = e.path.split("/");
    if (parts.length > 1) names.add(parts[0]);
  }
  return [...names];
}

export interface VaultTargetContext {
  /** Mail-Betreff/IServ-Kursname (Fach-Vermutung Input). */
  subject: string;
  /** Vault-Fachordner-Namen (Reihenfolge = Vermutungs-Fallback). */
  vaultSubjects: string[];
  /** Ablage-Template ({{SUBJECT}}/Material/{{SCHOOLYEAR}} …). */
  template: string;
  /** Mail-Datum (School-Year-Basis; Default: heute). */
  now?: Date;
  /** Original-Dateiname (Fach-Vermutung Fallback). */
  filename?: string;
}

/**
 * Standard-Ablage-Pfad (Vorschlag, nie auto-write): Fach aus subject-guess
 * (Bearer = Mail-Betreff/Kurs, sonst Dateiname), Template aufgelöst.
 * Erweiterungen (Material/SCHOOLYEAR) bleiben im Template steckbar.
 */
export function defaultVaultTargetPath(ctx: VaultTargetContext): string {
  // Vermutungs-Auftrag: erst Mail-Betreff, Fallback Dateiname (beide setzen
  // sich gegen die Vault-Fachliste durch, ADR-0001 normalisiert Umlaute).
  const guessed =
    guessSubject(ctx.subject, ctx.vaultSubjects) ??
    guessSubject(ctx.filename ?? "", ctx.vaultSubjects) ??
    "Allgemein";
  const vars = {
    subject: guessed,
    schoolyear: calculateSchoolYear(ctx.now ?? new Date()),
    filename: ctx.filename ?? "",
  };
  return sanitizePath(resolveTemplate(ctx.template || getDefaultTemplate(), vars));
}

/** Ziel-Pfad + Dateiname → kompletter Ablage-Pfad (collisionsfrei genug). */
export function joinTargetPath(target: string, filename: string): string {
  return sanitizePath(`${target}/${filename}`);
}

export interface SaveToVaultOptions {
  /** Vorschlag-Pfad (defaultVaultTargetPath). */
  suggestedPath: string;
  /** Dateiname der Anlage. */
  filename: string;
  /** Größe-Label (Headerzeile). */
  sizeLabel?: string;
  /** Vault-Fachordner (User-Kritik Runde 4: Auswahl statt Freitext-Pfad).
   *  Setzt einen Select + editierbaren Dateinamen statt Pfad-Input. */
  folderOptions?: string[];
  /** Speichern-Callback (Obsidian-Shell wired realen Ablage-Pfad). */
  onSave: (targetPath: string) => void;
  /** Abbrechen-Callback (optional; Modal-Shell macht ihr close selbst). */
  onCancel?: () => void;
}

const CLASS = {
  root: "iserv-save-to-vault",
  header: "iserv-save-to-vault-header",
  row: "iserv-save-to-vault-row",
  input: "iserv-save-to-vault-input",
  folder: "iserv-save-to-vault-folder",
  filename: "iserv-save-to-vault-filename",
  actions: "iserv-save-to-vault-actions",
  save: "iserv-save-to-vault-save",
  cancel: "iserv-save-to-vault-cancel",
  hint: "iserv-save-to-vault-hint",
} as const;

/** Top-Level-Fach aus suggestedPath ('Mathematik/Material/x' → 'Mathematik'). */
export function folderOfPath(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? "";
}

/**
 * Rendert den Save-Modal-Inhalt (File-Pfad-Input + Buttons). Purer DOM,
 * jsdom-testbar; die Speichern-Ablage (adapter.writeBinary) bleibt im Caller.
 */
export function renderSaveToVault(
  container: HTMLElement,
  opts: SaveToVaultOptions
): void {
  container.replaceChildren();

  const root = document.createElement("div");
  root.className = CLASS.root;

  const header = document.createElement("div");
  header.className = CLASS.header;
  header.textContent = `Anlage speichern: ${opts.filename}`;
  root.appendChild(header);

  const label = document.createElement("div");
  label.className = CLASS.hint;
  label.textContent = "Zielpfad (Vorschlag aus Fach-Vermutung):";
  root.appendChild(label);

  const row = document.createElement("div");
  row.className = CLASS.row;

  if (opts.folderOptions && opts.folderOptions.length > 0) {
    const folderSelect = document.createElement("select");
    folderSelect.className = CLASS.folder;
    for (const f of opts.folderOptions) {
      const o = document.createElement("option");
      o.value = f;
      o.textContent = f;
      folderSelect.appendChild(o);
    }
    // Vorschlagsordner treffen wenn in Optionen, sonst erster Ordner.
    const suggestedFolder = folderOfPath(opts.suggestedPath);
    folderSelect.value = opts.folderOptions.includes(suggestedFolder)
      ? suggestedFolder
      : opts.folderOptions[0];
    row.appendChild(folderSelect);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = CLASS.filename;
    nameInput.value = opts.filename;
    row.appendChild(nameInput);
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.className = CLASS.input;
    input.value = opts.suggestedPath;
    input.placeholder = "Fach/Material/2026-27";
    row.appendChild(input);
  }

  /** Ziel-Pfad live aus den Controls (keine Event-Closures — jsdom/Reihen-
   *  folge-sicher): Ordner-Select + Dateiname, bzw. Freitext-Pfad. */
  const targetValue = (): string => {
    const folderSel = row.querySelector<HTMLSelectElement>("." + CLASS.folder);
    if (folderSel) {
      const folder = folderSel.value;
      const name =
        row
          .querySelector<HTMLInputElement>("." + CLASS.filename)
          ?.value.trim() ?? opts.filename;
      return name === "" || folder === name ? folder : `${folder}/${name}`;
    }
    return (
      row.querySelector<HTMLInputElement>("." + CLASS.input)?.value.trim() ?? ""
    );
  };

  const actions = document.createElement("div");
  actions.className = CLASS.actions;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = CLASS.cancel;
  cancel.textContent = "Abbrechen";
  cancel.addEventListener("click", () => opts.onCancel?.());

  const save = document.createElement("button");
  save.type = "button";
  save.className = CLASS.save;
  save.textContent = "Speichern";
  save.dataset.suggestedPath = opts.suggestedPath;
  save.addEventListener("click", () => {
    opts.onSave(targetValue());
  });

  actions.appendChild(cancel);
  actions.appendChild(save);
  row.appendChild(actions);
  root.appendChild(row);

  container.appendChild(root);
}
