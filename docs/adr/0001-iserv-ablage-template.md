# Ablage-Template statt fester Ordnerstruktur für IServ-Dateien

IServ-Dateien landen nicht blind und nicht in einer fest verdrahteten Struktur. Stattdessen: konfigurierbares **Ablage-Template** (Ordner-Pfad) mit Variablen, Default `{{SUBJECT}}/Material/{{SCHOOLYEAR}}`. Base = aktiver Notiz-Ordner nur bei Fach-Übereinstimmung mit `{{SUBJECT}}`, sonst Vault-Root; Prefix-Wächler verhindert `Chemie/Chemie/…`. Review-Queue (versteckte `queue.json` + Sidebar) erzwingt die aktive Entscheidung pro Datei. Dedup per SHA-256 (kein etag/WebDAV auf gymmeck.de). Verworfen-Einträge TTL 48h, kein Undo.

**Status:** accepted

**Considered options:** (a) Fach-Root flat, (b) fest `Fach/Material/<Schuljahr>/`, (c) IServ-Ordner spiegeln, (d) konfigurierbares Template — gewählt (d) mit Default (b), weil Philosophien wechseln dürfen und der Vault keine vorgeschriebene Struktur erzwingen soll.

**Consequences:** Plugin braucht Template-Setting + Variable-Resolver; bestehende Root-PDFs werden nicht auto-migriert; Bau der Queue ist T8, diese ADR bindet die Regel.
