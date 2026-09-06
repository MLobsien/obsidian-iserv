# Lernmethodik & Planung: Evidenz + Schüler-Planungssysteme

**Ticket:** T9 (#12) — AutomationOS Effort  
**Datum:** 26.08.2026  
**Zweck:** Evidenzbasierte Lernmethodik + bestehende Schüler-Planungssysteme recherchieren, damit AutomationOS realistische Klausur-/Abitur-Vorbereitungsfenster bauen kann.

---

## 1. Evidenz: Spaced Repetition, Active Recall, Interleaving, Pomodoro

### 1.1 Practice Testing (Active Recall) — HOHE Wirksamkeit

**Dunlosky et al. (2013)** bewerteten 10 Lerntechniken in ihrem Monograph *„Improving Students' Learning With Effective Learning Techniques"* (Psychological Science in the Public Interest, Vol. 14, Issue 1). **Practice Testing** und **Distributed Practice** erhielten die höchste Nutzwertung („high utility"), da sie bei Lernenden verschiedenen Alters und Fähigkeitsstufen über viele Kriteriumsaufgaben und sogar in Bildungskontexten Leistungen steigern.
- Quelle: https://www.psychologicalscience.org/journals/pspi/1529100612453266/
- DOI: https://doi.org/10.1177/1529100612453266
- Volltext-PDF: http://iverson.cm.utexas.edu/courses/310M/Handouts/Dunlosky%20et%20al.%20-%202013%20-%20Improving%20Students%92%20Learning%20With%20Effective%20Learni.pdf

Eine **Meta-Analyse (242 Studien, 1.619 Effekte, 169.179 Teilnehmer)** von Hattie & Donoghue (2021, Frontiers in Education) bestätigt: Practice Testing (d = 0.74) und Distributed Practice (d = 0.85) sind die wirksamsten Techniken. Die Gesamteffektstärke aller 10 Techniken lag bei d = 0.56.
- Quelle: https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2021.581216/full

**Rowland (2014)** meta-analysierte 61 Studien zum Testing-vs.-Restudy-Effekt: d = 0.50 zugunsten des aktiven Abrufs; größer für Recall als für Recognition.
- Zitiert in: https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2021.581216/full

### 1.2 Distributed Practice (Spaced Repetition) — HOHE Wirksamkeit

**Cepeda et al. (2006)** — *„Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis"* (Psychological Bulletin, 132, 354–380). Meta-Analyse von 839 Bewertungen in 317 Experimenten (184 Artikel). **Kernbefund:** Die inter-study interval (ISI) und die retention interval (RI) wirken gemeinsam; die optimale ISI steigt, je länger die RI ist. Bei RI < 1 min sind ISIs < 1 min optimal; bei RI ≥ 6 Monaten sind ISIs ≥ 1 Monat optimal.
- Quelle: https://www.yorku.ca/ncepeda/publications/CPVWR2006.pdf
- Alternative: https://escholarship.org/content/qt3rr6q10c/qt3rr6q10c.pdf

**Cepeda et al. (2008)** — *„Spacing Effects in Learning: A Temporal Ridgeline of Optimal Retention"* (Psychological Science, 19(11), 1095–1102). Studie mit > 1.350 Personen, RI bis zu 1 Jahr. **Schlüsselzahlen für AutomationOS:**

| Retention Interval (Test-Distanz) | Optimaler Gap (interstudy) | Gap als % der RI |
|---|---|---|
| 7 Tage | ~1–3 Tage | ~20–40% |
| 35 Tage | ~8–11 Tage | ~23% |
| 70 Tage | ~12–21 Tage | ~17% |
| 350 Tage (≈1 Jahr) | ~21–27 Tage | ~5–10% |

Der optimale Gap steigt also mit der RI, aber als Prozentsatz der RI *sinkt* er. Der Effekt ist groß: Der optimale Gap vs. Null-Gap brachte +64% Recall (d = 1.1).
- Quelle: https://www.yorku.ca/ncepeda/publications/CVRWP2008.pdf
- DOI: https://doi.org/10.1111/j.1467-9280.2008.02209.x

**Praktische Leitlinie für AutomationOS:** Für eine Klausur in 1 Woche → Review-Gap von 1–3 Tagen. Für eine Klausur in 5 Wochen → Gap von ~8–11 Tagen. Für das Abitur (≥6 Monate) → Reviews im Abstand von mehreren Wochen bis Monaten. „Zu langer" Gap ist deutlich weniger schädlich als „zu kurzer" — Fehler in Richtung längerer Gaps sind sicherer.

### 1.3 Interleaving — MODERATE Wirksamkeit (materialabhängig)

**Dunlosky et al. (2013)** bewerteten Interleaved Practice als „moderate utility" — Effekte verallgemeinern über einige Variablen, aber die systematische Erforschung war 2013 noch am Anfang.
- Quelle: https://www.psychologicalscience.org/journals/pspi/1529100612453266/

**Brunmair & Richter (2019)** — Meta-Analyse (59 Studien, 238 Effekte). Gesamteffekt: **Hedges' g = 0.42** (moderat). Aber stark materialabhängig:
- Bilder/Gemälde: g = 0.67 (stark)
- Mathematikaufgaben: g = 0.34 (klein)
- Expositorische Texte: kein signifikanter Effekt
- Wortlisten: g = −0.39 (Blocking *besser* als Interleaving!)
- Quelle: https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf

**Rohrer, Dedrick, Hartwig & Stershic (2020)** — Präregistrierte cluster-randomisierte RCT mit 54 7. Klassen über 4 Monate. Interleaved-Gruppe outscored Blocked-Gruppe: 61% vs. 38%, **d = 0.83** (groß). Positiver Effekt bei allen 15 Lehrkräften.
- Quelle: http://uweb.cas.usf.edu/%7Edrohrer/pdfs/Rohrer_et_al_2020JEdPsych.pdf

**Rohrer, Dedrick & Burgess (2014)** — Interleaving hilft auch bei superficial unähnlichen Problemen (d = 1.05). Nicht auf visuell ähnliche Probleme beschränkt.
- Quelle: https://gwern.net/doc/psychology/spaced-repetition/2014-rohrer.pdf

**Firth, Rivers & Boyle (2021)** — Systematisches Review + Meta-Analyse (26 Studien). Memory-Effekt bis g = 0.65, Transfer-Effekt bis g = 0.66. Größter Nutzen bei subtilen Unterschieden zwischen Items.
- Quelle: https://doi.org/10.1002/rev3.3266

**Praktische Leitlinie für AutomationOS:** Interleaving ist besonders wirksam für **STEM-Fächer** (Mathe, Physik, Chemie) — verschiedene Aufgabentypen in einer Session mischen. Für **Sprachen/Vokabeln** ist Blocking teilweise besser (Wortlisten). Für **Kunst/Bildende Kunst** ist Interleaving sehr stark. AutomationOS sollte Interleaving pro Fächertyp unterschiedlich gewichten.

### 1.4 Pomodoro-Technik — EVIDENZ SCHWACH (keine RCTs für Lerneffizienz)

**Biwer et al. (2023)** — *„Understanding effort regulation: Comparing 'Pomodoro' breaks and self-regulated breaks"* (British Journal of Educational Psychology). Studierende in systematischen Break-Bedingungen (24 min work / 6 min break; 12 min work / 3 min break) waren **konzentrierter, motivierter und weniger erschöpft** als bei selbst-regulierten Pausen. Kein Unterschied bei investierter Mental-Effort oder Task-Completion. Systematische Pausen hatten Mood- und Efficiency-Benefits (gleicher Task-Completion in kürzerer Zeit).
- Quelle: https://bpspsychub.onlinelibrary.wiley.com/doi/10.1111/bjep.12593
- PubMed: https://pubmed.ncbi.nlm.nih.gov/36859717/

**MDPI-Studie (2025)** — *„Investigating the Effectiveness of Self-Regulated, Pomodoro, and Flowtime Break-Taking Techniques"* (Applied Sciences, 15(7), 861). Pomodoro-Pausen führten zu **schnellerem Fatigue-Anstieg** und schnellerem Motivationsabfall als selbst-regulierte Pausen, aber diese Unterschiede resultierten **nicht** in signifikanten Gesamtunterschieden bei Fatigue, Motivation, Produktivität, Task-Completion oder Flow. Keine der drei Techniken war der anderen überlegen.
- Quelle: https://www.mdpi.com/2076-328X/15/7/861
- PubMed: https://pubmed.ncbi.nlm.nih.gov/40723645/

**Scoping Review (2025, BMC Medical Education)** — 32 Studien (N = 5.270). 88% der Studien zeigten positive Outcomes, aber 57% nutzten validierte psychometrische Maße. Die meisten Effekte wurden durch subjektive Selbstberichte gemessen, nicht durch harte Lernleistung. Keine Studie fokussierte direkt auf PT in Anatomie-Kursen.
- Quelle: https://link.springer.com/article/10.1186/s12909-025-08001-0

**⚠️ Flag: Unsicher/unverifiziert** — Die Pomodoro-Technik hat keine starke Evidenz für verbesserte Lernleistung im Vergleich zu selbst-regulierten Pausen. Die Evidenz stützt Mood- und Konzentrations-Benefits, aber nicht notwendigerweise bessere Noten. AutomationOS sollte Pomodoro als *optionales* Feature anbieten, nicht als evidenzbasierte Kernmethode wie Spaced Repetition.

### 1.5 Realistische Vorlaufzeiten pro Klausurtyp

Basierend auf den obigen Evidenzen und praktischen Leitfäden (keine direkte Primärforschung zu „Stunden pro Klausurtyp"; folgende Werte sind konsolidierte Schätzungen aus mehreren Sekundärquellen):

| Klausurtyp | Empfohlener Vorlauf | Tägliche Stunden | Gesamtstunden | Methode |
|---|---|---|---|---|
| **Klausur (Klausur/Ex), STEM** (Mathe, Physik, Chemie) | 2–3 Wochen | 2–3h | 30–50h | Practice Problems + Interleaving + Spaced Reviews |
| **Klausur, Sprachen** (Englisch, Latein) | 1–2 Wochen | 1–2h | 15–25h | Active Recall (Vokabeln via SRS), Timed Writing |
| **Klausur, Geisteswissenschaften** (Deutsch, Geschichte) | 2–3 Wochen | 2h | 25–40h | Timed Essays, Active Recall, Concept Maps |
| **Abitur (gesamt)** | 3–6 Monate | variiert | 200–500h | Alle Techniken kombiniert, langfristige Spacing |

- Sekundärquelle für Stunden-Schätzungen: https://athenify.io/blog/how-long-study-for-exam
- Sekundärquelle für STEM-Praxis: https://schoolhouse.world/blog/how-to-develop-an-effective-study-schedule-for-big-exams

**⚠️ Flag:** Diese Stundenwerte sind nicht aus direkter empirischer Forschung abgeleitet, sondern konsolidierte Schätzungen aus Bildungs-Blogs und -Ratgebern. AutomationOS sollte sie als konfigurierbare Defaults verwenden, nicht als feste Regeln.

---

## 2. Terminplanung: Studienblöcke verteilen, Priorisierung, Spacing von Reviews

### 2.1 Priorisierungsmethoden

#### Eisenhower-Matrix für Studierende

Die Eisenhower-Matrix sortiert Aufgaben nach Dringlichkeit vs. Wichtigkeit in 4 Quadranten:
- **Q1 (Dringend + Wichtig):** Klausur diese Woche, fällige Hausaufgabe mit hohem Gewicht → *jetzt machen*
- **Q2 (Nicht dringend + Wichtig):** Abitur-Vorbereitung (3 Wochen entfernt), schwache Konzepte üben, Schlaf → *einplanen* (goldener Quadrant)
- **Q3 (Dringend + Nicht wichtig):** Gruppen-Chat, Formulare, Admin → *batchen/minimieren*
- **Q4 (Nicht dringend + Nicht wichtig):** Social Media, TV → *eliminieren*

**Erweiterung mit Grade-Weight-Regel:** Vor Platzierung in Q1 fragen: „Wie viel % der Note ist das wert? Wenn ich das vergesse, kann ich mich erholen?"
- Quelle (Studierenden-Template): https://4to.do/resources/templates/eisenhower-matrix-for-exam-preparation-template
- Quelle (Praxis-Leitfaden): https://www.collegenp.com/article/use-the-eisenhower-matrix-to-study-for-exams

#### Gewichtete Priorisierung (Exam-Weight × Current Grade)

Multi-Faktoren-Scoring (1–5 Skala pro Dimension):
1. **Klausurgewicht** (1 = 10%, 5 = 40–50% der Note)
2. **Aktueller Stand** (1 = durchgefallen, 5 = solides A → umgekehrt proportional: niedriger Stand = höhere Priorität)
3. **Aktuelle Beherrschung** (1 = völlig verloren, 5 = sicher)
4. **Dringlichkeit** (Tage bis Klausur)

Produkt oder Summe → Prioritätsranking → Zeit-Allokation.
- Quelle: https://studwy.com/blog/study-multiple-exams-at-once-without-burning-out

### 2.2 Studienblöcke über mehrere Klausuren verteilen

#### Interleaved Schedule (Tages-Rotation)

Anstatt ein Fach pro Tag: **Morgen = Fach A, Nachmittag = Fach B, Abend = Review Fach C.** Rotation verhindert, dass ein Fach „verschwindet" und implementiert automatisch Spaced Repetition.
- Quelle: https://studwy.com/blog/study-multiple-exams-at-once-without-burning-out

#### Time-Blocking mit 90-Minuten-Zyklen

Forschung zu ultradianen Rhythmen legt ~90-Minuten-Fokusblöcke nahe. **Regel:** Kein einzelnes Fach länger als 90 Minuten am Stück. Zwei 45-Minuten-Blöcke auf verschiedene Fächer produzieren mehr behaltenes Wissen als ein 90-Minuten-Block auf ein Fach.
- Quelle: https://getstudyedge.com/blog/how-to-study-for-multiple-exams-in-one-week

#### Back-to-Back Klausuren (konsekutive Tage)

Protokoll für zwei Klausuren an aufeinanderfolgenden Tagen:
- 3 Tage vor Klausur 1: 70/30 Split (Klausur 1 / Klausur 2)
- 2 Tage vor Klausur 1: 80/20 Split
- 1 Tag vor Klausur 1: 90/10 Split (ein 25-min Spaced-Review für Klausur 2)
- Nach Klausur 1: volle Fokus auf Klausur 2

Die 10–20% in der „späteren" Klausur während der „früheren" Phase zahlt sich aus, weil Retrieval-Pfade erhalten bleiben.
- Quelle: https://notesmakr.com/blog/how-to-study-for-multiple-exams

### 2.3 Spacing von Review-Sessions

Basierend auf Cepeda et al. (2008) (siehe Abschnitt 1.2):

| Tage bis Klausur | Optimaler Review-Abstand | Anzahl Reviews |
|---|---|---|
| 7 Tage | 1–3 Tage | 2–3 |
| 14 Tage | 3–5 Tage | 3–4 |
| 35 Tage | 8–11 Tage | 3–4 |
| 70 Tage | 12–21 Tage | 4–5 |
| 350+ Tage (Abitur) | 21–27+ Tage | 5+ (mit wachsenden Gaps) |

**Expanding-Schedule-Empfehlung:** Erste Reviews enger, spätere Reviews weiter. Z.B. für eine Klausur in 4 Wochen: Tag 1 (Lernen) → Tag 3 → Tag 8 → Tag 15 → Tag 25 → Klausur.
- Quelle (Cepeda 2008): https://www.yorku.ca/ncepeda/publications/CVRWP2008.pdf

**Wichtig:** Cepeda et al. (2006) fanden, dass **expanding intervals** (wachsende Gaps) entweder ähnliche oder leicht bessere Effekte produzieren wie fixed spacing. Fixed spacing ist jedoch einfacher zu planen.
- Quelle: https://www.yorku.ca/ncepeda/publications/CPVWR2006.pdf

---

## 3. SRP-Systeme: Bestehende Schüler-Planungstools

### 3.1 MyStudyLife

**Was es kann:**
- Klassen, Hausaufgaben, Klausuren, Noten und Aktivitäten in einem Kalender
- Rotierende und Block-Stundenpläne (Week A/B, Day A/B)
- Aufgaben nach Typ (Essay, Group Project, Reading, Revision) mit Teilfortschritt
- Smarte Erinnerungen vor Klasse, Klausur, fälligen Aufgaben
- Pomodoro-Fokus-Timer
- AI-Study-Coach „Scout" (Klausuren → Revision-Pläne, Wochenplanung per Chat)
- Noten-Tracking mit Trend-Anzeige
- Cloud-Sync (Web, iOS, Android), offline-fähig
- Family Connect (Eltern-Link)
- Klausur-Countdowns
- Quelle: https://mystudylife.com/tour/

**Was fehlt:**
- **Keine IServ/Schulplattform-Integration** (kein automatischer Import von Stundenplan/Noten aus dem deutschen Schulsystem)
- **Keine automatische Klausur-Vorbereitungsphase** (Scout kann Revision-Pläne erstellen, aber nicht automatisch basierend auf Spaced-Repitition-Evidenz)
- **Kein echter Abitur-Countdown** mit Phasen-Logik (Kursphase → Intensivphase → Prüfungsphase)
- **Keine Noten-abhängige Zeitgewichtung** (schwaches Fach = mehr Zeit)
- Keine SRS/Flashcard-Integration
- Quelle (Review mit Kritikpunkten): https://www.21stgenedtechtools.com/2025/07/mystudylife-review-digital-lifeline-for.html

### 3.2 Notion Student Templates

**Was sie können (variiert nach Template):**
- Kurse mit Lehrer, Raum, Credits, automatischem Notendurchschnitt
- Aufgaben-Board (Kanban: Not Started → In Progress → Done)
- Klausur-Tracker mit Datum, Ort, Themen, Countdown-Widget
- Automatische GPA/Notenberechnung (gewichtet, pro Semester + kumulativ)
- „What-if"-Rechner (welche Note brauche ich im Final?)
- Pomodoro-Timer-Widget
- Leseliste mit Fortschritt
- Wochenplaner mit täglichen Aufgaben
- Quelle: https://gabeocreative.com/product/notion-student-os
- Quelle: https://digitalset.co/notion-templates/students/exam-grades-tracker/
- Quelle: https://www.notioneverything.com/templates/the-ultimate-student-hub

**Was fehlt:**
- **Keine IServ-Integration** (manuelle Dateneingabe erforderlich)
- **Keine automatische Vorbereitungsphase** (kein Spaced-Repitition-Scheduling)
- **Kein Noten-Feed** aus der Schulplattform (Noten manuell eingeben)
- Keine SRS/Flashcard-Integration nativ (nur als Template nachbaubar)
- Templates sind statisch — kein adaptives Scheduling basierend auf Noten

### 3.3 Anki

**Was es kann:**
- Spaced Repetition mit **SM-2 Algorithmus** (Standard) und **FSRS** (neu, Machine-Learning-basiert)
- FSRS basiert auf dem „Three Component Model of Memory": Retrievability (R), Stability (S), Difficulty (D)
- FSRS reduziert Review-Load um 20–30% vs. SM-2 bei gleicher Retention
- Massive Shared-Deck-Bibliothek (USMLE, JLPT, IELTS, etc.)
- Open Source, kostenlos (iOS-App ~25$ einmalig)
- Vollständige Kontrolle über Learning Steps, Ease, Intervals
- Quelle (Algorithmus-Docs): https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html
- Quelle (Background): https://docs.ankiweb.net/background.html
- Quelle (SM-2 Original): https://www.super-memory.com/english/ol/sm2.htm

**Was fehlt:**
- **Keine Noten-Integration** (SRS kennt deine Schulnoten nicht)
- **Keine IServ/Schul-Integration**
- **Keine Klausur-Vorbereitungsphase** (SRS ist rein kartenbasiert, kennt keine Klausurtermine)
- **Kein Abitur-Countdown**
- Keine Terminplanung über mehrere Fächer
- Karte-Erstellung ist manueller Aufwand

### 3.4 RemNote

**Was es kann:**
- Notizen + Flashcards in *einer* App (Outliner-basiert, Bullets als Karten mit `::`)
- SRS mit FSRS und SM-2 (wählbar)
- Multi-Line Cards mit per-Item-Tracking (jeder Bullet wird separat gescheduled)
- Card Table zur Verwaltung tausender Karten
- Vollständiger Anki-Import (mit Review-History, Tags, Templates)
- AI-Quiz-Generator aus Notizen/PDFs
- Klausurdatum-basiertes Practice-Scheduling
- Quelle: https://www.remnote.com/
- Quelle (SRS-Feature): https://www.remnote.com/feature/ultimate-spaced-repetition
- Quelle (Algorithmus-Docs): https://help.remnote.com/en/articles/6026144-the-anki-sm-2-spaced-repetition-algorithm

**Was fehlt:**
- **Keine Noten-Integration**
- **Keine IServ/Schul-Integration**
- **Kein automatischer Klausur-Prep-Phase-Mechanismus** (kann Practice-Schedule an Klausurdatum anpassen, aber nicht automatisch Vorbereitungsphasen generieren)
- Steile Lernkurve (Outliner + SRS Mental-Model)
- Kein Abitur-Countdown

### 3.5 Mochi (mochi.cards)

**Was es kann:**
- Markdown-basierte Notizen + Flashcards + Spaced Repetition
- Bidirektionale Links (Zettelkasten-ähnlich)
- Tags, Filter, Saved Views
- AI-generierte Texte (Beispielsätze, Study-Prompts)
- Kostenlos, kein Sign-up nötig für Free-Tier
- Open-Source-Integrations auf GitHub
- Quelle: https://mochi.cards/
- Quelle (Docs): https://mochi.cards/docs/
- Quelle (GitHub): https://github.com/mochi-cards

**Was fehlt:**
- Kleines Ökosystem (keine große Shared-Deck-Bibliothek)
- **Keine Noten-Integration**
- **Keine IServ/Schul-Integration**
- **Keine Klausur-Vorbereitungsphase / kein Abitur-Countdown**
- Manuelles Karte-Erstelling

### 3.6 Todoist (für Studierende)

**Was es kann:**
- Task-Management mit 4 Prioritätsleveln (P1–P4)
- Projekte pro Fach, Sections (Exam Dates, Assignment Deadlines, Readings, Lecture Tasks)
- Recurring Tasks („Review Psychology notes every Tuesday 7pm")
- Natural Language Date Parsing
- Today- und Upcoming-Views
- Filter (`today & #Statistics`)
- Subtasks für große Aufgaben
- Dateianhänge, Kommentare, Links
- Kostenlose Version ausreichend für ≤5 Fächer
- Quelle: https://www.todoist.com/inspiration/todoist-guide-for-students
- Quelle (Templates): https://www.todoist.com/templates/student-planning

**Was fehlt:**
- **Keine Spaced Repetition** (keine SRS)
- **Keine Noten-Verfolgung**
- **Keine IServ-Integration**
- Keine Klausur-Vorbereitungsphasen
- Kein Abitur-Countdown
- Tasks isoliert von Notizen/Wissen

### 3.7 StudiPlaner / SchulPlaner (deutsche Apps)

**StudiPlaner** (Android, entwicklerherz):
- Organisationstool für Studierende: Semester, Kurse, Dozenten; Stundenplan, Wochenansicht; XML-Export
- Quelle: https://studiplaner.apps112.com/

**SchulPlaner** (iOS, schulplaner-app.com):
- Stundenplan & Hausaufgaben-App für Schüler
- Notenüberblick
- **Abi-Funktion:** Alle Abi-Noten über 4 Halbjahre + Abi-Klausur-Noten im Blick
- Flexible Klausurplanung (v5.1)
- Kostenlose Kernfunktionen
- Apple School Manager / MDM-Verteilung
- Quelle: https://schulplaner-app.com/de/

**Studiplaner.ch** (Schweizer Plattform):
- Fristen & Prüfungen, Aufgabenmanagement, Lernplanung, Notizen
- Quelle: https://studiplaner.ch/

**Was fehlt (alle deutschen Planer):**
- **Keine Spaced Repetition**
- **Keine automatische Klausur-Vorbereitungsphase**
- **Keine IServ-Integration** (obwohl IServ die führende deutsche Schulplattform ist)
- **Keine Noten-abhängige Zeitgewichtung**
- SchulPlaner hat Abi-Funktion, aber keinen Countdown mit Phasen-Logik

### 3.8 IServ (deutsche Schulplattform — Integrationsziel)

**Was IServ ist:**
- Führende Schulplattform in Deutschland, DSGVO-konform
- 50+ Module: Schulkommunikation, Organisation, Unterricht, Netzwerk/Gerätemanagement
- Digitaler Stundenplan + Vertretungsplan, Klassenbuch, Kalender, Hausaufgaben
- **Schnittstellen:** LDAP, OneRoster, OAuth, OpenID, SAML → Single-Sign-on
- **IDM API:** API-Platform mit JSON/OpenAPI-Dokumentation (Swagger UI, ReDoc)
- WebUntis Connector (Stundenplan-Sync)
- Microsoft Entra ID Connector
- Import-Modul für Schulverwaltungsprogramme
- Quelle: https://iserv.de/
- Quelle (Funktionen): https://iserv.de/die-iserv-schulplattform/funktionen
- Quelle (Schnittstellen): https://iserv.de/die-iserv-schulplattform/funktionen/identitaetsmanagement-und-schnittstellen
- Quelle (IDM API): https://idm.demo-iserv.de/iserv/idm/api/v1/docs?ui=redocs

**Relevanz für AutomationOS:** IServ bietet standardisierte Schnittstellen (LDAP, OneRoster, OAuth, OpenID, SAML) und eine dokumentierte IDM API. Ein Obsidian-basiertes System könnte über IServ's API Stundenpläne, Klausurtermine und potenziell Noten abrufen — aber IServ ist primär ein Lehrer/Admin-Tool, nicht für Schüler-Self-Service-Noten-Feed konzipiert. **Kein bekanntes öffentliches API für Schüler-Noten-Abruf** — dies muss verifiziert werden.

**⚠️ Flag:** Ob IServ einen API-Endpunkt für schülerseitigen Notenabruf bietet, konnte nicht verifiziert werden. Die IDM API dokumentiert Benutzer-/Gruppenverwaltung, nicht Noten. Noten-Integration über IServ ist möglicherweise nur über das Klassenbuch-Modul (WebUntis) oder manuell möglich.

### 3.9 Gap-Analyse: Was kein bestehendes Tool hat

| Feature | MyStudyLife | Notion Templates | Anki | RemNote | Mochi | Todoist | SchulPlaner |
|---|---|---|---|---|---|---|---|
| Stundenplan | ✅ | ❌ (manuell) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Hausaufgaben | ✅ | ✅ (manuell) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Noten-Tracking | ✅ | ✅ (manuell) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Klausur-Countdown | ✅ | ✅ (Widget) | ❌ | ❌ | ❌ | ❌ | ✅ (Abi) |
| Spaced Repetition | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Notizintegration | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ (begrenzt) |
| IServ-Integration | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Noten-Feed (autom.) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Auto Exam-Prep Phase | ⚠️ (Scout) | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| Abitur-Countdown | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ (Noten) |
| Noten-gewichtete Zeit | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Kein bestehendes Tool kombiniert:** IServ-Integration + Noten-Feed + automatische Klausur-Vorbereitungsphasen (basierend auf Spaced-Repitition-Evidenz) + Abitur-Countdown + Noten-abhängige Zeitgewichtung. **Das ist der Opportunity-Space für AutomationOS.**

---

## 4. Notenabhängigkeit: Studienzeit nach Fachnote gewichten

### 4.1 Response to Intervention (RTI) — Tiering-Modell

**RTI** ist ein präventives, gestuftes Interventionsmodell aus der Bildungsforschung (Teil von IDEA seit 2004):

- **Tier 1:** Hochwertige Kerninstruktion für *alle* Lernenden. Universelles Screening identifiziert Risikoschüler.
- **Tier 2:** Gezielte Kleingruppen-Intervention für Lernende, die in Tier 1 Schwierigkeiten zeigen. Typisch: 3–5x/Woche, 20–50 min, ≥5 Wochen Dauer.
- **Tier 3:** Intensive Einzeltutoring für Lernende, die in Tier 2 nicht vorankommen. ~75 zusätzliche Minuten/Woche. „Double-dosing" (Lektion in zwei 15-Minuten-Sessionen aufteilen). **Teaching to 90% mastery** vor Weiterführung. 10–30x mehr Practice-Opportunities als Peers.
- Quelle (WWC Practice Guide): https://ies.ed.gov/ncee/wwc/Docs/PracticeGuide/wwc_rrti_pg_rec03.pdf
- Quelle (RTI Tier Structures): https://onlinelibrary.wiley.com/doi/10.1111/j.1540-5826.2010.00319.x

**Übertragung auf AutomationOS:** Ein Planer kann Studienzeit nach Noten tier-en:
- **Tier 1 (Note ≥ gut/2):** Standard-Spacing, normale Review-Frequenz
- **Tier 2 (Note befriedigend/3–4):** Erhöhte Review-Frequenz, zusätzliche Practice-Sessions, Fokus auf identifizierte Schwachstellen
- **Tier 3 (Note ausreichend/5 oder mangelhaft/6):** Intensive Intervention — tägliche Practice, 10–30x mehr Wiederholungen, 90%-Mastery-Kriterium vor Weiterführung

### 4.2 Mastery Learning — Sequenzierungs-Modell

**Benjamin Bloom (1968)** — *„Learning for Mastery"*. Kernidee: Curriculum in Lerneinheiten zerlegen; nach hochwertiger Erstinstruktion formative Assessment durchführen; Schüler, die nicht gemeistert haben, erhalten **corrective instruction** (qualitativ anders, nicht einfach „rewteaching"); zweite parallele Formative Assessment als zweite Chance.

**Guskey & Jung** — *„RTI and Mastery Learning"*. Mastery Learning's corrective instruction ≈ RTI Tier 2. Korrekturaktivitäten addieren ~10–20% mehr Zeit zur Ursprungseinheit. Bloom argumentierte: intensive, individualisierte Hilfe *früh* in der Sequenz reduziert Remediationszeit in späteren Einheiten drastisch.
- Quelle: https://tguskey.com/wp-content/uploads/Mastery-Learning-4-RTI-and-Mastery-Learning-.pdf
- Quelle (Lessons of Mastery Learning): https://tguskey.com/wp-content/uploads/Mastery-Learning-3-Lessons-of-Mastery-Learning.pdf

**Meta-Analyse (Kulik, Kulik & Bangert-Drowns, 1990)** — 108 kontrollierte Evaluationen. Mastery Learning Programme haben positive Effekte auf Prüfungsleistungen: **d = 0.50–0.58** (≈ 50. auf 70. Perzentil). Effekte sind **stärker bei schwächeren Schülern**. Mastery-Programme erhöhen die Zeit auf instruktionalen Aufgaben um ~4%.
- Quelle: https://www.academia.edu/81783373/Effectiveness_of_Mastery_Learning_Programs_A_Meta-Analysis

### 4.3 Modell für AutomationOS: Noten-gewichtete Zeit-Allokation

Basierend auf RTI-Tiering und Mastery-Learning-Evidenz:

```
Zeitgewicht pro Fach = Basiszeit × Noten-Multiplikator × Klausurgewicht-Multiplikator

Noten-Multiplikator (deutsche Notenskala 1–6):
  Note 1 (sehr gut):     × 0.7  (weniger Zeit, Wartungs-Reviews)
  Note 2 (gut):          × 1.0  (Standard)
  Note 3 (befriedigend): × 1.3  (mehr Practice)
  Note 4 (ausreichend):  × 1.8  (intensive Intervention)
  Note 5 (mangelhaft):   × 2.5  (Tier 3: tägliche Practice, 90% mastery)
  Note 6 (ungenügend):   × 3.0  (maximale Intervention)

Klausurgewicht-Multiplikator:
  Klausur = 10% der Note:  × 0.5
  Klausur = 20% der Note:  × 1.0
  Klausur = 40% der Note:  × 1.5
  Abitur-Klausur:          × 2.0
```

**Mastery-Kriterium:** Bevor ein Themengebiet als „abgeschlossen" markiert wird, muss der Schüler in einem Self-Test ≥ 90% erreichen (analog RTI Tier 3 „teaching to 90% mastery"). Darunter → corrective instruction mit alternativen Materialien/Methoden.

**Spacing-Intensivierung bei schwachen Noten:**
- Note 1–2: Cepeda-Standard-Spacing (optimaler Gap nach RI)
- Note 3–4: Gap halbieren (hälsere Reviews)
- Note 5–6: Gap auf 1/3 reduzieren + tägliche Active-Recall-Practice (analog RTI Tier 3: 10–30x mehr Practice-Opportunities)

**⚠️ Flag:** Die spezifischen Multiplikatoren (×0.7, ×1.3, etc.) sind nicht direkt empirisch belegt, sondern aus den RTI/Mastery-Learning-Prinzipien abgeleitete Heuristiken. Die *Richtung* (schlechtere Note = mehr Zeit) ist durch RTI-Tiering und Mastery-Learning-Meta-Analysen gestützt (Effekte stärker bei schwächeren Schülern), aber die genauen Faktoren sind Konfigurationswerte, die von AutomationOS kalibriert werden sollten.

---

## Quellenverzeichnis (primäre Quellen)

1. Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving Students' Learning With Effective Learning Techniques. *Psychological Science in the Public Interest*, 14(1). https://doi.org/10.1177/1529100612453266
2. Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis. *Psychological Bulletin*, 132, 354–380. https://www.yorku.ca/ncepeda/publications/CPVWR2006.pdf
3. Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing Effects in Learning: A Temporal Ridgeline of Optimal Retention. *Psychological Science*, 19(11), 1095–1102. https://doi.org/10.1111/j.1467-9280.2008.02209.x
4. Brunmair, M. & Richter, T. (2019). Meta-Analysis of Interleaved Learning. https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf
5. Rohrer, D., Dedrick, R. F., Hartwig, M. K., & Stershic, B. C. (2020). A Randomized Controlled Trial of Interleaved Mathematics Practice. *Journal of Educational Psychology*. http://uweb.cas.usf.edu/%7Edrohrer/pdfs/Rohrer_et_al_2020JEdPsych.pdf
6. Rohrer, D., Dedrick, R. F., & Burgess, K. (2014). The benefit of interleaved mathematics practice is not limited to superficially similar kinds of problems. *Psychonomic Bulletin & Review*, 21, 1323–1330. https://gwern.net/doc/psychology/spaced-repetition/2014-rohrer.pdf
7. Firth, J., Rivers, I., & Boyle, J. (2021). A systematic review of interleaving as a concept learning strategy. https://doi.org/10.1002/rev3.3266
8. Hattie, J. & Donoghue, T. (2021). A Meta-Analysis of Ten Learning Techniques. *Frontiers in Education*. https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2021.581216/full
9. Biwer, F. et al. (2023). Understanding effort regulation: Comparing 'Pomodoro' breaks and self-regulated breaks. *British Journal of Educational Psychology*. https://doi.org/10.1111/bjep.12593
10. Anki Manual — Background & Algorithm. https://docs.ankiweb.net/background.html
11. Anki FAQs — What spaced repetition algorithm does Anki use? https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html
12. SuperMemo SM-2 Algorithm. https://www.super-memory.com/english/ol/sm2.htm
13. Guskey, T. R. & Jung, L. A. — RTI and Mastery Learning. https://tguskey.com/wp-content/uploads/Mastery-Learning-4-RTI-and-Mastery-Learning-.pdf
14. Guskey, T. R. — Lessons of Mastery Learning. https://tguskey.com/wp-content/uploads/Mastery-Learning-3-Lessons-of-Mastery-Learning.pdf
15. What Works Clearinghouse (IES) — Systematic Teaching in Tiers 2 and 3. https://ies.ed.gov/ncee/wwc/Docs/PracticeGuide/wwc_rrti_pg_rec03.pdf
16. Kulik, C-L. C., Kulik, J. A., & Bangert-Drowns, R. L. (1990). Effectiveness of Mastery Learning Programs: A Meta-Analysis. https://www.academia.edu/81783373/Effectiveness_of_Mastery_Learning_Programs_A_Meta-Analysis
17. IServ Schulplattform — Funktionen. https://iserv.de/die-iserv-schulplattform/funktionen
18. IServ — Identitätsmanagement & Schnittstellen. https://iserv.de/die-iserv-schulplattform/funktionen/identitaetsmanagement-und-schnittstellen
19. MyStudyLife — Features. https://mystudylife.com/tour/
20. RemNote — Ultimate Spaced Repetition. https://www.remnote.com/feature/ultimate-spaced-repetition
21. Mochi — Docs. https://mochi.cards/docs/
22. Todoist — A Student's Guide. https://www.todoist.com/inspiration/todoist-guide-for-students
23. SchulPlaner App. https://schulplaner-app.com/de/

---

## Flagged/Unverified Claims

- **Pomodoro-Evidenz:** Keine RCTs belegen überlegene Lernleistung vs. selbst-regulierte Pausen. Evidenz stützt Mood/Konzentration, nicht Noten.
- **Stunden-Schätzungen pro Klausurtyp:** Konsolidiert aus Sekundärquellen (Blogs/Ratgeber), nicht aus direkter empirischer Forschung.
- **Noten-Multiplikatoren (×0.7 bis ×3.0):** Heuristisch aus RTI/Mastery-Learning abgeleitet, nicht empirisch kalibriert.
- **IServ Noten-API:** Keine Bestätigung, dass IServ einen schülerseitigen Notenabruf über API ermöglicht. Die IDM API dokumentiert Benutzer-/Gruppenverwaltung, nicht Noten.
- **„Cramming"-Vergleich:** Cepeda et al. (2006) fanden, dass kurze „Cramming"-Sessions (wiederholte nicht-kontiguous Studie) von einzelnen Items als „spaced" gelten, was die Peterson-Paradox-Widerlegung erklärt. Dies bedeutet *nicht*, dass Cramming gleich wirksam ist wie optimales Spacing über Tage/Wochen.
