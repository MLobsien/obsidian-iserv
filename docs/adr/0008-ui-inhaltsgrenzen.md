# UI-Inhaltsgrenzen: zwei Ansichten derselben Daten (Sidebar kompakt, Dashboard vollständig)

Diese ADR löst den Konflikt zwischen ADR-0004 („Dashboard = primäre Fläche, Sidebar = Peek-Drawer") und dem Plan (T6/T7/T15: „Dashboard: gleiche Cards") durch eine Inhalts-Grenze: **keine Sidebar-Exklusivität**. Jede Info existiert in beiden Flächen, die Sidebar zeigt sie kompakt, das Dashboard vollständig und breit; Swipe-Konzept bleibt in beiden.

## Sidebar (Peek, kompakte Version aller Infos)

- **Reihenfolge der Abschnitte:** Stundenplan → Review-Queue (Zeilen) → Benachrichtigungen (Mails, Aufgaben, aktive Arbeiten). Abschnitte einklappbar; der Einklapp-Zustand wird **nicht** persistiert.
- **Stundenplan:** Tabelle, eine Zeile pro Unterrichtseinheit; Doppelstunden werden per Fach-Merge zu einer Zeile zusammengefasst (Zeitformat „3./4., 09:55–11:30“ = Anfang der 1. – Ende der letzten Slot). Farbsemantic: **rot = Ausfall** (ganze Zeile als Hintergrund), **orange = Vertretung**. Freistunden werden angezeigt und regulär (ohne Hervorhebung) dargestellt. Am Wochenende gibt es **keine Sektion Stundenplan** (kein Leerzustand-Text).
- **Nächster-Schultag-Regel:** Nach dem Ende des Schultages (Ende der letzten Unterrichtsstunde, Ausfälle berücksichtigt) zeigt die Sidebar den Stundenplan des **nächsten** Schultages, auch über Wochenende/Feiertage; das Label wechselt auf „Morgen"/Datum. Der Stundenplan wird nicht gecached (kann sich ändern).
- **Review-Queue:** kompakte **Zeilen** (Name + Fach-Vermutung), Swipe primär (behalten/verwerfen/unsicher), Tap öffnet die **pdf.js-Preview als Modal** (kein Inline-Expand); sortiert **neueste zuerst**. Verworfene Dateien bekommen **keinen eigenen Abschnitt** (Discard-Cache bleibt unsichtbar verwaltet; Wiederherstellen-Feature „erstmal verschieben").
- **Benachrichtigungen:** Mails (Kurzliste) + **nicht erledigte Aufgaben** + **aktive Arbeiten** als Kurzhinweis („Arbeit XY in Z Tagen“). Zustand-Diff nach Lese-/Erledigt-Aktionen **optimistisch im UI entfernen und zusätzlich per Pull** bestätigen (beides, c).

## Dashboard (vollständige, breite Darstellung)

- **Stundenplan:** ganze Woche (Mo–Fr) als **Tag-Spalten nebeneinander** (eine Zeile pro Stunde, echte Uhrzeiten, **keine** Doppelstunden-Merge), Wochenenden nicht angezeigt. Vertretungen werden je nachdem angezeigt, wie weit sie verfügbar sind.
- **Mail + Aufgaben in Gänze:** vollständige Listen (nicht Kompakt-Feed), mit Suche. Die Suche wird **server-seitig** eingebaut: Recherche-Ticket identifiziert zuerst den nativen Mail-Such-Endpoint (analog `todo/api/v1/task/search`); es wird **kein Client-Side-Mock** eingebaut, der später wieder entfernt werden müsste. Der verdächtige URL-Parameter aus dem früheren Spike war nicht aus einer Doku, sondern vermutlich ausgedacht.
- **Arbeiten:** nur **aktuelle** Arbeiten (im Vorbereitungsfenster); ADR-0006 bleibt (Status, Fachindex, Noten-Tracking) — kein „alle im Schuljahr"-Liste.
- **Dashboard verwendet die ganze Breite (Grid)** wie in ADR-0004; „Doppelstunden-Merge" ist eine Sidebar-Regel.

## Verhältnis zu ADR-0004

ADR-0004 bleibt in Kraft für: Swipe-Primär-Queue, pdf.js-Preview, No-Stats-Reihe, No-Countdown im MVP. **Geändert** durch diese ADR: Peek-Detail-Level (jetzt vollständige kompakte Daten incl. Stundenplan+Queue+Benachrichtigungen statt nur Neuerungen), Preview als Modal statt Inline-Expand in der Sidebar (Inline-Expand bleibt eine Dashboard-Option), Queue als Zeilen statt Cards in der Sidebar.

**Status:** accepted

**Considered options:**
- Client-Side-Filter über geladene Mails bis der Endpoint gefunden ist (User-Veto: „Baue keinen Mock ein, den wir eh wegmachen" — nein)
- Einklapp-Zustand persistieren (nicht nötig — nein)
- Festes Zeitschema für „Schulschluss" (brüchig bei Ausfällen/Kurztagen — nein)
- „Gleiche Cards in Sidebar und Dashboard" (Plan T6/T7 — ersetzt durch diese ADR)
- Verworfene Dateien verwalten (Discard-Revision im Dashboard) — User: „erstmal verschieben, nicht einplanen" → open question, nicht gebaut

**Consequences:** Der Plan T6/T7/T15 muss neu beschrieben werden (nicht mehr „gleiche Cards"). Die Queue braucht einen pdf.js-Preview-Modal-Trigger, der die Pumping-and-Swiping UI nicht zerstört. Mail-Suche ist eine **Blocker-Dependency** für die Dashboard-Mail-Suche (kein MVP-Ersatz).
