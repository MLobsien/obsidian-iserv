# Issue #12 — Proof: Queue-Feed am core-Job-Pfad (Fix dd45712)

Datum: 2026-10-08 12:43 CEST · ENV: echtes Obsidian (Desktop, vault Schule) + echtes IServ (gymmeck.de)

Fix: dd45712 `fix(review-queue): Queue-Feed am core-Job-Pfad koppeln (onCoreSync-Hook)`

## Beweis-Kette

1. **Root-Cause** (vor dem Fix, 12:26-12:33): Server-Listing der 8 heutigen/morgigen Kursordner
   (file/api/list, depth≤8) = 333 Dateien total / 16 innerhalb der 7-Tage-Frist (cutoff 2026-10-01),
   inkl. AB13/14/15ATS Chemie (Upload HEUTE 11:24). Queue-Bestand zuvor: 364 Items, nur 3 "neu",
   die frischesten fehlten komplett. → Code-Lesebeweis: coreModule.run() ohne feedQueueFromFiles.
2. **Fix-Weg**: JobModuleFactoryDeps.onCoreSync (fail-silent try/catch), Host bindet
   feedQueueFromFiles in mobile + desktop Deps. Deploy + `obsidian-cli plugin:reload id=iserv-integration`,
   Leaves rebuild (setViewState sidebar/dashboard) — Obsidian NICHT neu gestartet.
3. **Live-Beweis nach dem Fix** (12:40:45 `core.trigger()`):
   - iserv-sync-log.md: neue Zeile `queue-feed: 0 neu, 0 patched, 0 gedroppt` am Ende des core-Laufs
     (nach `prefetch: done in 3846ms` — die queue-feed-Zeile 126 ist die vom core-Modul-Hook).
     Vor dem Fix schrieb core.trigger() NIE eine queue-feed-Zeile.
   - Queue-Eval: total=379, alle 7 Muster-Dateien (AB13/14/15ATS Chemie, Abiaufgaben Funktionsscharen,
     Iphigenie Erster Aufzug, Musteranalyse Rembrandt, Vergleich Steen 2) im Bestand, Status "neu"
     (nicht abgelehnt), Subjekte korrekt (Chemie×3, Mathematik, Deutsch, Kunst×2).
   - Screenshot: docs/proofs/issue12-fix-corehook-queue.png — Review-Queue (18) im Dashboard zeigt
     u. a. AB13ATS/AB14ATS/AB15ATS (Chemie), Musteranalyse/Vergleich S (Kunst), Iphigenie (Deutsch),
     Abiaufgaben/Übliche (Mathematik) mit Behalten/Verwerfen/Unsicher-Pills.
