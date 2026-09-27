# Schule / AutomationOS

Obsidian-Vault als Schulzentrale: IServ liefert nur Daten; Entscheidungen und Ablage liegen im Vault.

## Language

**Sync-Kandidat**:
Eine IServ-Datei, die auf eine aktive Entscheidung wartet, bevor sie im Vault landet.
_Avoid_: Import, Download, Auto-Sync-Datei

**Review-Queue**:
Die versteckte Liste der Sync-Kandidaten (Plugin-State `queue.json`), gerendert in der IServ-Sidebar.
_Avoid_: Inbox, Import-Ordner, Review-Queue.md (sichtbare Notiz)

**Ablage-Template**:
Konfigurierbarer Ordner-Pfad mit Variablen (`{{SUBJECT}}`, `{{SCHOOLYEAR}}`, …), der bestimmt, wohin behaltene Dateien landen.
_Avoid_: feste Ordnerstruktur, IServ-Spiegel

**Fach-Vermutung**:
Vorgeschlagenes Ziel-Fach aus dem IServ-Kurs-/Gruppennamen (norm-match auf Vault-Fachordner), nie auto-apply.
_Avoid_: Auto-Mapping, hardcodiertes Fach

**Begleitpaar**:
MD-Notiz und zugehöriges PDF (PDF = Quelle, MD = Bearbeitung); keine Inhaltsdublette.
_Avoid_: Duplikat, Kopie

**Dublettenstatus**:
Klassifikation eines Sync-Kandidaten gegen Vault-Bestand per SHA-256 der Bytes (nie nur Dateiname).
_Avoid_: Dateiname-Match, etag (auf gymmeck.de nicht verfügbar)

**Discard-Cache**:
TTL-begrenzte Liste verworfener Datei-Hashes; nach Ablauf kann dieselbe Datei wieder als Sync-Kandidat erscheinen.
_Avoid_: Blacklist, Undo-Liste

**Aufgabe**:
Remote IServ-Task aus dem Aufgaben-Modul (inkl. Vertretungsaufgaben); fremd-zugewiesen, ohne Vault-Datei, im Sidebar als eigener Eintrag.
_Avoid_: Hausaufgabe (lokal), IServ-Task-Datei

**HA-Kern**:
Fusion aus lokalen HA-Notizen und remote IServ-Aufgaben inkl. Fälligkeits- und Status-Logik.
_Avoid_: HA-Liste, Aufgaben-Modul (alleine)

**Due-Shift**:
Asymmetrische Verschiebung der Fälligkeit bei Ausfall: lokal auto-update des `Bis/<dd>`-Frontmatters; remote Aufgabe nur als ein-Klick-Vorschlag.
_Avoid_: Blind-Shift, auto-rewrite remote

**Startseite-Aggregat**:
Daten-Vertrag (offene HA + remote Aufgaben + Mails + due/überfällig), den die Startseite (T7) rendert; T4 liefert nur die Daten, nicht das UI.
_Avoid_: Dashboard (das ist T7), Startseite-Layout

**Keychain-Cred**:
IServ-Credential (host/user/pass), gespeichert via Electron `safeStorage` (OS-Secret-Store); nie im Vault/`data.json`. fail-closed wenn kein Secret-Service (`basic_text`).
_Avoid_: Plaintext-Cred, data.json-Passwort, keytar (archived)

**Cred-Scrub**:
Entfernen geleakter Credentials aus git-History (`git filter-repo`/BFG + force-push); kein `.gitignore`-Band-Aid — cred-free ist Code-Invariante.
_Avoid_: gitignore-Maskierung, History-Reset

**Session-Cookie**:
`IServSession`-Cookie, persistiert wie ein Credential (im Keychain); stilles Re-Login nur bei Expiry.
_Avoid_: Session-State, Login-Token

**Dashboard-Leaf**:
Volle AutomationOS-Ansicht im Grid-Layout (on-command, ohne Stats-Reihe); auf iPad die primäre Fläche.
_Avoid_: Startseite (Layout), Custom Frame

**Sidebar-Peek**:
Kompakte Card-Stack-Ansicht als Drawer für schnellen Zugriff (z. B. eine Datei im Unterricht herausziehen und behalten); nichts ist sidebar-exklusiv — jede Info existiert auch im Dashboard, nur kompakter; Neuerungen kommen als Obsidian-Notice; Sektionen einklappbar (Zustand wird nicht persistiert).
_Avoid_: Dauer-Sidebar, Sidebar als einzige Quelle, Freezes

**Job-Modul**:
Geplante Einheit im JobRunner (Name, Intervall, run, Toggle); manueller Trigger pro Modul; geteilter Rate-Limiter.
_Avoid_: Monolith-Sync, Cron-Job

**Welle**:
Release-Abschnitt des AutomationOS-Baus (0 Inzidenz → 1 MVP → 2 Polish → 3 Arbeiten/Vorbereitung); Welle 0 strikt vor allen weiteren Commits.
_Avoid_: Phase, Sprint

**Vorbereitungsfenster**:
Zeitraum vor einer Arbeit (Termin − Fenster), in dem die Vorbereitungsphase läuft; Fenster = Basis(Art) × Punkte-Multiplikator.
_Avoid_: Vorlauf pauschal, fester Start

**Lernplan-Scaffold**:
Auto-generierte Link-Liste aller Fachordner-Notizen seit der letzten Arbeit (gleichen Fachs) in `Lernplan <Arbeit>.md`; User verfeinert manuell.
_Avoid_: Lernplan-Vorlage (leer), AI-Generierung

**Fachindex**:
Interne Punkte-Map je Fach (in `data.json`, getrackt); Grundlage des Multiplikators; Eintrag per Modal nach +2-Wochen-Notice/Task.
_Avoid_: Noten-Notiz, keychain

**Doppelstunden-Merge**:
Kompaktionsregel der Sidebar: aufeinanderfolgende Slots desselben Fachs werden zu einer Zeile (Anfang 1. – Ende letzter Slot, z. B. „3./4., 09:55–11:30“); eine Zeile pro Stunde im Dashboard merged nie.
_Avoid_: Slot-Aneinanderreihung, Doppel-Card

**Nächster-Schultag-Regel**:
Nach Abschluss der letzten Unterrichtsstunde (Schultag-Ende; Ausfälle) zeigt die Sidebar den Stundenplan des nächsten Schultages (Wochenende/Feiertage überbrückt, Label „Morgen“); der Stundenplan wird nicht über das aktuelle Datum hinaus geglaubt.
_Avoid_: Leerzustand am Wochenende, Fest-Uhrzeit-Schulschluss

**Queue-Zeile**:
Die kompakte Sidebar-Darstellung eines Sync-Kandidaten (Name + Fach-Vermutung in einer Zeile, Swipe primär); Tap öffnet die pdf.js-Preview als Modal, kein Inline-Expand.
_Avoid_: Sidebar-Card, Inline-Expand

**Server-Suche**:
Mail- und Aufgabensuche immer über den IServ-Server (dedizierter Endpoint), nie als Client-Side-Filter über zufällig geladene Listen; geladene Listen bevorzugen den nativen Endpoint.
_Avoid_: Client-Side-Filter, „alle laden und filtern“

**Mail-Body-Hierarchie**:
Der Mail-Reader rendert den reichhaltigsten verifizierten Teil der Mail: HTML-Teil (entschlüsselt aus Base64) vor Klartext vor Leer-Fallback. Sanitization entfernt aktive Inhalte (Skripte, Event-Handler, externe Styles), bevor HTML in das Modal kommt.
_Avoid_: „Leere Mail“ als Normalfall, ungesanntes HTML

**Cred-RAM-Cache**:
Entschlüsselte Credentials leben nur im Speicher der laufenden Plugin-Session. Bei verschlossenem Secret-Store (z. B. KeePassXC-DB zu) laufen schon geloggte Sessions weiter; neue Logins scheitern dezent, bis wieder entsperrt ist. Kein Plaintext-Persist, ADR-0003 bleibt unangetastet.
_Avoid_: Plaintext auf Platte, Credential-Neuladen pro Request

**Mobile-Gate (ADR-0009)**:
Auf Obsidian Mobile (iOS/Android) läuft das Plugin ohne Node/Electron: Netzwerk-Transport (IServClient.rawRequest) und safeStorage-Login sind gesperrt, vault-only-Features (Review-Queue aus queue.json, GradeStore, StudyPlan-Note, NoticeCenter, Views mit letztem Stand) bleiben aktiv. Garantie: das Bundle lädt ohne Node-Builtins (https/http lazy, kein Buffer; statische Tests in test/client/mobile-load.test.ts).
_Avoid_: Auto-Sync auf mobile, fetch-Transport-Zusatz im Desktop-Pfad (Alternativ-Entscheidung, nicht Gate)
