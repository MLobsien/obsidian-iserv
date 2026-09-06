# AGENTS.md

Anleitung für Coding-Agenten, die in diesem Repo arbeiten.

## Was ist dieses Repo?

Ein Obsidian-Vault mit Schulnotizen (Fächer: Chemie, Deutsch, Englisch, Kunst, Latein, Mathe, Physik, Politik). Kein Software-Projekt. Die Arbeit hier ist: Notizen pflegen, Lernmaterial organisieren, Aufgaben planen.

## Agent skills

Dieses Repo nutzt die [Matt Pocock Engineering Skills](https://github.com/mattpocock/skills) (installiert unter `.agents/skills/`). Sie strukturieren Planung, Triage und Ausführung von Arbeit in diesem Repo. Vor der Nutzung die passenden Skill-Dateien lesen; die wichtigsten Einstiege:

- `ask-matt` – welcher Skill passt zu meiner Situation? (Router)
- `wayfinder` – große Vorhaben als Map aus Decision-Tickets auf dem Issue-Tracker planen
- `grill-me` / `grilling` — Pläne und Ideen stress-testen, bevor gebaut wird
- `to-spec` / `to-tickets` — aus Gesprächen Spezifikationen und Tickets machen
- `triage` — Issues und PRs klassifizieren
- `handoff` — Arbeit kompakt für den nächsten Agenten übergeben

### Issue tracker

Alle Issues/Tickets für dieses Repo leben in GitHub Issues (MLobsien/Schule), bedient über die `gh` CLI. Details und Kommandos: `docs/agents/issue-tracker.md`.

### Triage labels

Die fünf Triage-Rollen als GitHub-Labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Mapping-Tabelle: `docs/agents/triage-labels.md`.

### Domain docs

Single-context: eine `CONTEXT.md` im Repo-Root, ADRs unter `docs/adr/` (beide werden lazy durch `/domain-modeling` erzeugt — nicht im Voraus anlegen). Konsum-Regeln: `docs/agents/domain.md`.
