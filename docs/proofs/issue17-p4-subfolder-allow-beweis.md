# Issue #17 Punkt 4 — Selektives Ordner-Zulassen (Live-Beweis)

**Datum:** 08.10.2026 · **Commits:** ee72d6f (P4-Feature) · **Screenshot:** `issue17-p4-subfolder-allow.png`

## Feature

- `DeniedFoldersStore`: denied + allowed Sets, `isDenied` = **längster segment-exakter Matching-Präfix gewinnt** (`allow` schlägt deny bei ≥ Tiefe; `deny` räumt gleichen Pfad aus allowed; `unallow` = zurück auf geerbt). Persistenz: neuer Key `review-queue-allowed-folders`, Alt-Bestand unverändert.
- Render: Sub-Ordner-Zeilen (`↳ 1. Semester (N)`) unter den Gruppen-Köpfen mit „Erlauben"/„Verwerfen", Host via `onSubFolderDecide` + verallgemeinertem Confirm-Modal („Ordner zulassen?" + `mod-cta` für allow).

## Live-Beweiskette (obsidian-cli eval am echten Obsidian + IServ, Plugin-Reload via disable/enable)

1. **Setup:** Physik-Kurs denied (`store.deny("Groups/O Physik 12eN Sü")` + save) → `physikDenied: true`.
2. **DOM:** Sub-Zeilen im echten View: `subs: 2` (`Groups/O Physik 12eN Sü/1. Semester`, `Groups/O Chemie 12eN Hn/UE AltTS`), je 1 Erlauben-Button.
3. **Action (echter Klick):** `.iserv-queue-subfolder-allow` am Physik-Sub → **Confirm-Modal** korrekt: „Ordner zulassen? … wird dauerhaft zugelassen — Dateien darunter landen wieder in der Review-Queue … (6 offene Dateien betroffen)".
4. **OK-Klick:** Log-Zeile `queue-subfolder-allow: Groups/O Physik 12eN Sü/1. Semester (6 Items)`.
5. **Store-Wirkung:** `allowed: ["Groups/O Physik 12eN Sü/1. Semester"]`, `denied: ["Groups/O Physik 12eN Sü"]` → `subDenied: false`, `siblingDenied: true` (longest-prefix) ✅.
6. **Nachwirken:** 6 Physik/Sub-Items offen (status neu) in der Queue; Log-entry + Notice gefeuert; Denied-Liste persisted.

## Tests

`denied-folders.test.ts` +5 (longest-prefix, allow-über-deny am gleichen Pfad, unallow→geerbt, allowed-Persistenz+Reload, deny räumt gleichen allowed-Pfad), `folder-groups.test.ts` +1 (Sub-Gruppierung inkl. Direct-File-Auschluss). **760/760**, `tsc` clean.

## Cleanup (Test-Zustände deniable retour)

Physik/Chemie denies via allow+unallow gehoben, discarded Items auf „neu" zurück, `deniedList: []`, `allowed: []`.
