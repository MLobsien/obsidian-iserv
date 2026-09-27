/**
 * Vault-Fachordner-Listing (User-Kritik-Fix zu T22): Top-Level-Ordner des
 * Obsidian-Vaults als Fach-Vermutungs-Basis (ADR-0001). Obsidian-API-Brücke
 * (app.vault), SEHR klein gehalten — alles Weitere pure in save-to-vault.ts.
 */
import type { TAbstractFile } from "obsidian";

/** Top-Level-Ordner-Namen des Vaults (Reihenfolge = Browse-Reihenfolge). */
export function getAllVaultSubjects(app: {
  vault: { getAllLoadedFiles(): TAbstractFile[] };
}): string[] {
  const names = new Set<string>();
  for (const f of app.vault.getAllLoadedFiles()) {
    if (!f.name) continue;
    // TFolder hat children ([]), TFile nicht — struktureller Check ohne import.
    if ("children" in f) names.add(f.name);
  }
  return [...names];
}
