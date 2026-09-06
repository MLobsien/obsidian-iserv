# HA-Due-Shift: lokal auto, remote als Vorschlag

Bei Ausfall einer Stunde verschiebt sich die HA-Fälligkeit (`Bis/<dd>`) auf die nächste *tatsächliche* Stunde (via `current-timetable/?substitutions=true`, nicht statischer Stundenplan). **Lokale** HA-Notizen: das `Bis/<dd>`-Frontmatter wird **automatisch** aktualisiert — der Shift ist ein deterministisch abgeleitetes Feld aus verifizierten Vertretungsdaten, keine Sync-Freigabe (bewusste Ausnahme vom "kein Blind-Sync"-Prinzip aus T3/ADR-0001). **Remote IServ-Aufgaben** (inkl. Vertretungsaufgaben): nur ein **ein-Klick-Vorschlag**, kein auto-Write — fremd-zugewiesene Daten werden nicht heimlich modifiziert. Stunden-gebundene Aufgaben sind shift-fähig; fix-datierte (API-Datum ohne Stunden-Bezug) werden nicht verschoben.

**Status:** accepted

**Considered options:** (a) auto für beides, (b) Vorschlag für beides, (c) manuell für beides — gewählt: lokal auto + remote Vorschlag, weil lokale Notes eigene, deterministisch ableitbare Felder sind, während remote Daten fremd-zugewiesen bleiben und einen Bestätigungsschritt verdienen.

**Consequences:** Due-Logik braucht zwei Pfade (lokal frontmatter-write, remote suggestion-only); Aufgaben-Referenzierung im Sidebar (Lesson-Row → Aufgabe); Fix-Datum-Erkennung pro Aufgabe nötig.
