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
Kompakte Card-Stack-Ansicht als Drawer (nicht dauerhaft offen); Neuerungen kommen als Obsidian-Notice.
_Avoid_: Dauer-Sidebar, auto-open

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
