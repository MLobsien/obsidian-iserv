# Vertretungen-Quelle: Pläne-Untis-HTML primär (DOMParser), substitutions/ als Cross-Check

Vertretungen kommen primär aus dem **Pläne-Modul als Untis-2026-Frameset-HTML** (`/iserv/plan/show/raw/Vertretungsplan Schüler/f1|f2/subst_001.htm` — Kette: plan/overview-Index → show-Shell → iframe raw → Frameset → Tageslisten): autoritativ, tagesaktuell (Stand-Timestamp, 60s self-refresh), unterscheidet Entfall/Vertretung in eigenen Spalten, liefert den **tatsächlichen Vertreter** + Tagesmeldungen (abwesende Lehrer), jahrelang stabiles Markup. `substitutionBoardMessages/` = Sackgasse (literal `[]`); `current-timetable/?substitutions=true` = **404** auf dieser Instanz (korrigiert T1-Doku und T4s ursprüngliche Due-Quelle); `substitutions/` = nur retrospektiv (~2 Wochen), Vertretungs-Lehrer/Fach leer, aber `substitutionType` ("class-absence" = Entfall) maschinenfreundlich → **Sekundär-Cross-Check für Entfall-Erkennung, nie primäre Display-Quelle**.

**Parse-Tech:** `DOMParser` + `querySelector` (Chromium-Renderer — kein Dependency, kein Build-Step); Regex nur für Text-Anker (Stand-Timestamp aus textContent); XML-Parser ungeeignet (Legacy-HTML mit &nbsp;/unclosed Tags); jsdom/cheerio/parse5 = Dependency-Verstoß (T7/T8: keine Build-Pipeline). **Node-Testbarkeit via Seam-Split:** dünner `parseHtml(html)`-DOMParser-Wrapper (läuft nur im Plugin) + reine `docToPlan(doc)`-Extraktion (th↔td positional, Zeile→Objekt, Klassen-Filter) — in Node mit Fake-DOM-Stubs testbar; Read-Only-Guard-Tests bleiben Node-runnable.

Heute-Tabelle (T7) auf Pläne f1+f2 rebasiert (Art korrekt, Tagesmeldungen, Klassen-Filter, Stand-Polling 15 min); Due-Shift (T4/ADR-0002) robust über Pläne-Entfall-Parsing (oder Welle-1-niedrigaufwandig substitutions/-class-absence mit Reliability-Caveat). Stundenplan **„gilt ab 07.09.2026"** — Weekday-Maps nicht über dieses Datum cachen.

**Status:** accepted

**Considered options:** substitutionBoardMessages (leer — nein); current-timetable?substitutions (404 — nein); substitutions/ primär (retrospektiv, kein Vertreter — nur Cross-Check); Regex-Markup-Parsing (Anti-Pattern — nur Text-Anker); XML-Parser (chokest an Legacy-HTML); jsdom/cheerio (Dependency/Build-Verstoß).

**Consequences:** Welle 1 baut Untis-HTML-Fetcher+Parser (Seam-Split) + Stand-Timestamp-Polling; Spalten-Set an einem normalen Tag re-verifizieren (Projektwoche = Listen leer); weitere Tage vermutlich subst_002.htm; iserv-api.md-Merge (Pläne-Kette, current-timetable-404, substitutions/-Felder) erst nach History-Scrub.
