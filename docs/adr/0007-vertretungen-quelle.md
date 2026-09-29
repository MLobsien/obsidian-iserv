# Vertretungen-Quelle: DieschulApp-JSON primär (current-timetable), Untis-HTML als Detail-Overlay

**Update 29.09.2026 (Issue #7, Live-Verifikation am echten IServ):** Die
DieschulApp-JSON-Stundenplane sind die neue Primärquelle:

- `current-timetable/?date=YYYY-MM-DD&week=true&substitutions=true` → 200
  (die 404 vom 01.09.2026 ist NICHT mehr reproduzierbar) für JEDES Datum:
  heute bis +365 Tage UND Rückblick; Antwort = `{entries, vacations, schoolEvents}`.
  **Reichweiten-Caveat:** das ist eine Wochen-Vorlage, Ferientage liefern
  trotzdem 34 Entries — Ferientage werden über das mitgelieferte `vacations`-
  Array unterdrückt (timetable-json: isOnVacation/schoolDaysOfWeek).
- Ausfälle erscheinen als Entries mit `substitutionType` ("substituted"/
  "class-absence") + `originalTimeTableEntry` (echtes Fach/Lehrer/Raum) und
  LEEREM Ersatzfach (`courseSubject.subject: null`, teachers leer) — die
  „`-` als Fach"-Zeilen der Untis-Listen hier als leeres Fach modelliert,
  nie als Phantom-Fach rendern.
- `substitutions/` (JSON) reicht bis zu Schultagen VORAUS (Live: 2026-10-05
  bei Abfrage am 29.09.) — der „nur retrospektiv"-Befund vom 01.09.2026
  gilt so nicht mehr; bleibt Sekundär-Cross-Check mit stattlichem
  `substitutionType`-Signal.
- **Gruppenordner-Anker für Review-Queue-Fachvorschläge (R2):** der
  Files-Ordner unter `Groups/` trägt EXAKT den Kursnamen aus
  `courseSubject.course.name` (Live: "O Latein 12gN Sz" ↔
  `Groups/O Latein 12gN Sz/[Adventskalender 2024, Caesar, …]`). `groups/`
  selbst kennt nur „… Schüler/Eltern/Lehrer"-Suffixed-Namen (4550 rows) —
  der Kursname selbst genügt, `subjectFromGroup` extrahiert das Fach.

Der Untis-HTML-Pläne-Pfad (`src/api/untis.ts`, f1=heute/f2=morgen,
f3+ = IServ-404-Shell) bleibt als DETAIL-OVERLAY bestehen: Vertreter-Name
und Tagesmeldungen (abwesende Lehrer) kommen in der JSON-Form NICHT mit
realey-Detail — Untis bleibt für die feineren Vertretungs-Details zuerst.
Die JSON-Schicht (`src/api/timetable-json.ts`, Node-testbar, kein
Obsidian-Import) drifted die Reichweiten-/Ferientag-Daten.

**Parse-Tech:** `DOMParser` + `querySelector` (Chromium-Renderer — kein Dependency, kein Build-Step); Regex nur für Text-Anker (Stand-Timestamp aus textContent); XML-Parser ungeeignet (Legacy-HTML mit &nbsp;/unclosed Tags); jsdom/cheerio/parse5 = Dependency-Verstoß (T7/T8: keine Build-Pipeline). **Node-Testbarkeit via Seam-Split:** dünner `parseHtml(html)`-DOMParser-Wrapper (läuft nur im Plugin) + reine `docToPlan(doc)`-Extraktion (th↔td positional, Zeile→Objekt, Klassen-Filter) — in Node mit Fake-DOM-Stubs testbar; Read-Only-Guard-Tests bleiben Node-runnable.

Heute-Tabelle (T7) auf Pläne f1+f2 rebasiert (Art korrekt, Tagesmeldungen, Klassen-Filter, Stand-Polling 15 min); Due-Shift (T4/ADR-0002) robust über Pläne-Entfall-Parsing (oder Welle-1-niedrigaufwandig substitutions/-class-absence mit Reliability-Caveat). Stundenplan **„gilt ab 07.09.2026"** — Weekday-Maps nicht über dieses Datum cachen.

**Status:** accepted (superseded-primary; Untis-HTML als Detail-Overlay)

**Considered options:** substitutionBoardMessages (leer — nein); current-timetable?substitutions (404 — nein); substitutions/ primär (retrospektiv, kein Vertreter — nur Cross-Check); Regex-Markup-Parsing (Anti-Pattern — nur Text-Anker); XML-Parser (chokest an Legacy-HTML); jsdom/cheerio (Dependency/Build-Verstoß).

**Consequences:** Welle 1 baut Untis-HTML-Fetcher+Parser (Seam-Split) + Stand-Timestamp-Polling; Spalten-Set an einem normalen Tag re-verifizieren (Projektwoche = Listen leer); weitere Tage vermutlich subst_002.htm; iserv-api.md-Merge (Pläne-Kette, current-timetable-404, substitutions/-Felder) erst nach History-Scrub.
