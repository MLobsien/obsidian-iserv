# AGENTS.md

Anleitung für Coding-Agenten, die in diesem Repo arbeiten.

## Was ist dieses Repo?

Dieses Repo ist **zwei Dinge**:

1. Ein Obsidian-Plugin-Repo (`MLobsien/obsidian-iserv`): Obsidian-IServ-Plugin, deployt nach `/home/mad5/Schule/.obsidian/plugins/iserv-integration/`.
2. Ein Obsidian-Vault (`/home/mad5/Schule`, eigenes Git) mit Schulnotizen. Kein allgemeines Notizprojekt.

## ⛔ HARD GATE — Live-Verifikation vor JEDEM Commit/Push/Deploy

(User-Forderung 28.09.2026 nach nicht erkanntem broken Feature — standing rule)

**Nichts user-sichtbares (UI-Render, Feed, Preview, Command, Setting, Notice) geht ohne
Live-Verifikation am ECHTEN Obsidian + ECHTEN IServ in einen Commit, Push oder Deploy.**

- Unit-Tests (vitest) sind **keine Feature-Verifikation** — sie verifizieren Logik, nicht Wirken.
- Live-Verifikation = obsidian-cli `eval` am laufenden Obsidian (Plugin NICHT neustarten,
  NIE killen; reload via `app.plugins.disablePlugin` + `enablePlugin` geht).
- Jede Verifikation: konkrete Beweis-Aussage (z. B. „Canvas 4 Seiten gezeichnet",
  „JPEG 3840×5120 als Blob", „TXT inline") — nicht „hab deployed".
- Beweis-Zeile in Commit-Message und Issue-Kommentar.
- Swarm-Worker können NICHT live verifizieren → **der Coordinator verifiziert auch die
  Worker-Arbeit beim Integrieren**. „Geht bei mir" zählt nicht.

Diese Regel ist nicht verhandelbar. Ein Commit ohne Live-Beweis wird als Fehler gezählt.

## Agent skills

Dieses Repo nutzt die [Matt Pocock Engineering Skills](https://github.com/mattpocock/skills)
(installiert unter `.agents/skills/`). Vor der Nutzung die passenden Skill-Dateien lesen.

- `ask-matt` – welcher Skill passt zu meiner Situation?
- `wayfinder` – große Vorhaben als Map aus Decision-Tickets planen
- `grill-me` / `grilling` — Pläne stress-testen
- `to-spec` / `to-tickets` — Spezifikationen aus Gesprächen
- `triage` — Issues klassifizieren
- `handoff` — Arbeit kompakt übergeben

### Issue tracker

Issues leben in GitHub Issues (MLobsien/obsidian-iserv), bedient über `gh` CLI
(`docs/agents/issue-tracker.md`).

### Triage labels

`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
Mapping: `docs/agents/triage-labels.md`.

### Domain docs

ADRs unter `docs/adr/` (0005 Read-Only-Write-Gate, 0007 best-effort feeds, 0008
Queue-UI-Konventionen, 0009 mobile transport), API-Doku in `docs/iserv-api.md`.
