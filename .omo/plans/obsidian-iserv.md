# ADR-0001: TypeScript with esbuild

## Status
Accepted

## Context
The original plugin was a single 1094-line `main.js` with no type safety, no modularity, and no build pipeline. As features grew (queue, exams, mails, PDF), the file became unmanageable. Subagents marked tasks "done" without writing code — a failure caught only by manual testing.

## Decision
- **TypeScript** for type safety and modularity
- **esbuild** for fast bundling to single `main.js`
- **No dist directory** — GitHub releases for distribution
- **vitest** for testing (fast, native ESM/TypeScript support)

## Consequences
- Type errors caught at compile time, not in Obsidian console
- Multiple source files (`src/`) compiled to single output
- `npm run build` → `main.js` at repo root (copy to vault for testing)
- `npm run test` → vitest with TypeScript support
- GitHub releases ship `main.js` + `styles.css` + `manifest.json`

---

# obsidian-iserv — Work Plan

## TL;DR
**Was:** Neues Repo `MLobsien/obsidian-iserv` mit TypeScript-Plugin. Login-Flow aus altem Repo kopieren, alle anderen Features neu implementieren basierend auf Erkenntnissen dieser Session.

**Warum:** Altes Repo hatte 1094-Zeilen-main.js ohne Typsicherheit, Features wurden von Agenten als "erledigt" markiert ohne Code zu schreiben. TypeScript + esbuild + vitest = saubere Basis.

**Ziel:** Vollständig funktionierendes Obsidian-Plugin mit Review-Queue, Exam-System, Mails, PDF-Preview, Study Plan — getestet und getippt.

---

## Repo-Setup

- [x] **S1. TypeScript + esbuild + vitest Setup**
  `package.json`, `tsconfig.json`, `esbuild.config.mjs`. vitest als Test-Runner. Build-Output: `main.js` am Repo-Root. `npm run deploy` copys to Schule vault.
  Blocks: —

- [ ] **S2. CONTEXT.md + ADRs anlegen**
  Domain-Glossary (CONTEXT.md). ADRs: TypeScript-Entscheidung, IServ API, Naming Conventions.
  Blocks: S1

- [ ] **S3. .gitignore + README + manifest.json**
  `.gitignore`: node_modules/, data.json, *.log. README mit Installation + Development.
  `manifest.json`: id=iserv-integration, name=IServ Integration, version=0.1.0, minAppVersion=1.12.2.
  Blocks: S1

---

## Session-Erkenntnisse (Implementierungs-Notizen)

### IServ Mail API (kritisches Wissen)
- Endpoint: `/iserv/mail/api/v2/account/<user>@<host>/message?mailbox[]=SU5CT1g`
- Response: `{ items: [...], offset: N, total: N, all: N }` — `total` = echte Postfach-Größe
- `content.rich[].content` ist **base64-codiertes HTML** → `Buffer.from(raw, 'base64').toString('utf-8')`
- Mail-Body-Endpoint: `/iserv/mail/api/v2/account/<email>/message/<id>/body`
- `from`-Feld: kann String, Objekt `{ personal, mailbox, host, bare_address }`, oder Array sein
- `&search=`-Parameter wird **still ignoriert** — kein Server-Side-Suche
- Spam-Filter: `onlySchoolEmails` filtert nach Domain
- Pagination: `offset=N`, `total` aus Response
- Ungelesen-Zähler: separater Aufruf oder aus `unreadCount()` API
- **Leere Mails**: Fallback-Text `"Leere Mail"` statt `"Nachricht konnte nicht geladen werden"`

### UI-Verhalten
- Jede Section (Stundenplan, Vertretungen, Aufgaben, Queue, Arbeiten) braucht **Empty-Fallback** mit `iserv-empty` CSS-Klasse
- Section darf NIE verschwinden — immer Header + Fallback zeigen
- Sidebar: Max 5 Mails, simple Ansicht. Dashboard: Volle Pagination mit "Zurück"/"Weiter"
- Search wurde entfernt (IServ ignoriert `&search=`) — nicht reimplementieren

### Login-Flow
- POST `/iserv/auth/login?_target_path=/iserv/timetable/` mit `_username` + `_password`
- 2FA: `_two_factor_token` wenn `/_two_factor_token` im Response
- Meta-Refresh-Redirects nach Login (IServ nutzt diese)
- Session-Check: `IServSession` Cookie muss im Jar sein, sonst `/users/me` als Fallback
- Cookies: IServAuthSession, IServAuthSID, IServSession, IServSAT, IServSATId, DSASESSID
- Desktop: Node `https`-Modell für volle Cookie-Kontrolle (Obsidian `requestUrl` schluckt Set-Cookie)

### Naming Convention (Pflicht)
- Code: Englisch (Variablen, Funktionen, Klassen, Kommentare)
- User-facing Strings: Deutsch (Notices, UI-Labels, Empty States)
- `s.arbeiten` → `s.exams`
- `Vorbereitungsfenster` → `Prep Window`
- `Lernplan` → `Study Plan`
- `Fachindex` → `Subject Index`

### Bekannte Fallstricke
- `mails()` muss `{ mails, total }` zurückgeben, nicht `[]` — sonst crasht Destructuring
- Early Returns in `mails()` müssen auch `{ mails: [], total: 0 }` statt `[]` sein
- `exercises()` parsed HTML — kann nicht JSON.parse() verwenden
- Exercise-Status-Filter: `status !== "abgegeben"` nötig, sonst leere Liste
- Sidebar Sections: `if (data.length)` → else mit Empty-Fallback, nie einfach verstecken

---

## Implementation Tasks

### Wave 1: Foundation
- [x] **S1. TypeScript + esbuild + vitest Setup**
  `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.mts` created and verified
  `main.js` built successfully via `npm run build`
  Blocks: —
- [ ] **T1. IServClient (Login-Flow kopiert + getippt)**
  `src/client/IServClient.ts`: Login-POST, Cookie-Jar, Rate-Limiter, Node-HTTPS-Transport, Session-Persistenz. Typos für Config, Response, API-Responses. Login-Flow aus altem `main.js` L154-406 kopieren und typisieren.
  Tests: Mock-rq, Login-Mock, Cookie-Capture, Rate-Limiter, 2FA-Flow.
  Blocks: S1
- [ ] **T2. CredStore (safeStorage + localStorage)**
  `src/client/CredStore.ts`: Desktop=safeStorage (encrypt/decrypt), Mobile=localStorage. Cipher-Blob Persistenz via Plugin `loadData`/`saveData`. Failsafe bei fehlendem safeStorage.
  Tests: Encrypt/Decrypt, localStorage-Fallback, Clear.
  Blocks: S1
- [ ] **T3. Plugin-Entry-Point + Settings**
  `src/plugin.ts`: IServPlugin extends Plugin. onload: register Views, Commands, Ribbon Icon, Settings Tab, Interval. makeClient(), sync(). `src/views/settings.ts`: IServSettingTab + CredentialModal.
  Tests: Plugin-Load, Settings-Render.
  Blocks: T1, T2
- [ ] **T4. Sync Orchestrator + Notice Dedup**
  `src/core/sync.ts`: sync() — parallel timetable/subs/mails/exercises, Signature-Vergleich, Notice-Priorität (Subs > HA > Mails > Files). `src/core/notices.ts`: dedup-Logik.
  Tests: Dedup (gleiche Signatur → kein Notice), Priorität.
  Blocks: T3
- [ ] **T1. IServClient (Login-Flow kopiert + getippt)**
  `src/client/IServClient.ts`: Login-POST, Cookie-Jar, Rate-Limiter, Node-HTTPS-Transport, Session-Persistenz. Typos für Config, Response, API-Responses. Login-Flow aus altem `main.js` L154-406 kopieren und typisieren.
  Tests: Mock-rq, Login-Mock, Cookie-Capture, Rate-Limiter, 2FA-Flow.
  Blocks: S1
- [ ] **T2. CredStore (safeStorage + localStorage)**
  `src/client/CredStore.ts`: Desktop=safeStorage (encrypt/decrypt), Mobile=localStorage. Cipher-Blob Persistenz via Plugin `loadData`/`saveData`. Failsafe bei fehlendem safeStorage.
  Tests: Encrypt/Decrypt, localStorage-Fallback, Clear.
  Blocks: S1
- [ ] **T3. Plugin-Entry-Point + Settings**
  `src/plugin.ts`: IServPlugin extends Plugin. onload: register Views, Commands, Ribbon Icon, Settings Tab, Interval. makeClient(), sync(). `src/views/settings.ts`: IServSettingTab + CredentialModal.
  Tests: Plugin-Load, Settings-Render.
  Blocks: T1, T2
- [ ] **T4. Sync Orchestrator + Notice Dedup**
  `src/core/sync.ts`: sync() — parallel timetable/subs/mails/exercises, Signature-Vergleich, Notice-Priorität (Subs > HA > Mails > Files). `src/core/notices.ts`: dedup-Logik.
  Tests: Dedup (gleiche Signatur → kein Notice), Priorität.
  Blocks: T3


- [ ] **T1. IServClient (Login-Flow kopiert + getippt)**
  `src/client/IServClient.ts`: Login-POST, Cookie-Jar, Rate-Limiter, Node-HTTPS-Transport, Session-Persistenz. Typos für Config, Response, API-Responses. Login-Flow aus altem `main.js` L154-406 kopieren und typisieren.
  Tests: Mock-rq, Login-Mock, Cookie-Capture, Rate-Limiter, 2FA-Flow.
  Blocks: S1

- [ ] **T2. CredStore (safeStorage + localStorage)**
  `src/client/CredStore.ts`: Desktop=safeStorage (encrypt/decrypt), Mobile=localStorage. Cipher-Blob Persistenz via Plugin `loadData`/`saveData`. Failsafe bei fehlendem safeStorage.
  Tests: Encrypt/Decrypt, localStorage-Fallback, Clear.
  Blocks: S1

- [ ] **T3. Plugin-Entry-Point + Settings**
  `src/plugin.ts`: IServPlugin extends Plugin. onload: register Views, Commands, Ribbon Icon, Settings Tab, Interval. makeClient(), sync(). `src/views/settings.ts`: IServSettingTab + CredentialModal.
  Tests: Plugin-Load, Settings-Render.
  Blocks: T1, T2

- [ ] **T4. Sync Orchestrator + Notice Dedup**
  `src/core/sync.ts`: sync() — parallel timetable/subs/mails/exercises, Signature-Vergleich, Notice-Priorität (Subs > HA > Mails > Files). `src/core/notices.ts`: dedup-Logik.
  Tests: Dedup (gleiche Signatur → kein Notice), Priorität.
  Blocks: T3

### Wave 2: Core Views + Basic API

- [ ] **T5. Timetable + Substitutions API**
  `src/api/timetable.ts`: `timetable()` + `substitutions()` via `/iserv/dieschulapp/api/1.0/`. Typos für Entry, Slot, Substitution. Parsing von `weekday`, `timeTableSlot`, `room`.
  Tests: Mock-API, Parsing, Filter nach Wochentag.
  Blocks: T1

- [ ] **T6. Sidebar-View (Stundenplan + Vertretungen + Empty Fallbacks)**
  `src/views/SidebarView.ts`: Render mit `el()`/`txt()`-Helfern. Stundenplan-Tabelle, Vertretungs-Badges. **Jede Section hat Empty-Fallback** (`iserv-empty` Klasse).
  Tests: DOM-Stubs, Empty-State-Rendering.
  Blocks: T5

- [ ] **T7. Dashboard-View (Grid-Layout)**
  `src/views/DashboardView.ts`: 2-Spalten-Grid. Col1: Stundenplan + Vertretungen. Col2: Nachrichten + Aufgaben + Queue. Responsive CSS. **Empty Fallbacks für alle Sections**.
  Tests: Grid-Render, Empty-States.
  Blocks: T5

- [ ] **T8. Exercise API + HTML-Parser**
  `src/api/exercises.ts`: HTML-Parser für `/iserv/exercise`. Felder: id, title, course, due, status. Filter: `status !== "abgegeben"`.
  Tests: HTML-Fixture, Parsing, Filter.
  Blocks: T1

### Wave 3: Mails (Session-Erkenntnisse)

- [ ] **T9. Mail API (Pagination + Base64-Decode + Body)**
  `src/api/mails.ts`: `mails(limit, offset)` → `{ mails, total }`. `mailBody(id)` → decodierte HTML. Base64-Decode von `content.rich[].content`. Spam-Filter (`onlySchoolEmails`). `unreadCount()`. Body-Cache mit TTL (48h).
  **Leere Mails**: Fallback `"Leere Mail"`.
  Tests: Mock-API (items/total), Base64-Decode, Spam-Filter, Cache-TTL, Empty-Body.
  Blocks: T1

- [ ] **T10. Mail-Reader-Modal + Pagination**
  `src/views/MailReaderModal.ts`: Body-Popup bei Klick. `iserv-mail-reader-body` CSS (overflow-wrap). Dashboard: Pagination mit "Zurück"/"Weiter", 15 Mails pro Seite. Sidebar: Max 5 Mails, keine Pagination.
  Tests: Modal-Render, Pagination-Logik.
  Blocks: T9

### Wave 4: Review Queue

- [ ] **T11. Queue-State + queue.json**
  `src/review-queue/state.ts`: `{ items: [{ id, name, path, hash, subject, status: "neu"|"kept"|"discarded"|"unsure", target? }] }` in settings. Status-Updates, Persistenz.
  Tests: Add, Update, Persist.
  Blocks: —

- [ ] **T12. SHA-256-Dedup + Discard-Cache**
  `src/review-queue/dedup.ts`: SHA-256 über Bytes. Pre-Filter: name+size+mtime. Discard-Cache mit TTL (48h).
  Tests: Byte-identisch → Dup, TTL-Ablauf.
  Blocks: T11

- [ ] **T13. Ablage-Template-Resolver**
  `src/review-queue/template.ts`: Variablen: `{{SUBJECT}}/{{COURSE}}/{{DATE}}/{{TIME}}/{{SCHOOLYEAR}}/{{TEACHER}}/{{FILENAME}}`. Default: `{{SUBJECT}}/Material/{{SCHOOLYEAR}}`. SchoolYear: Monat≥8 → `YYYY/YY+1`. Kollision: `(<hash>)`-Suffix.
  Tests: Render, Idempotent, August-Grenze, Kollision.
  Blocks: T11

- [ ] **T14. Swipe-Handler + Desktop-Buttons**
  `src/review-queue/swipe.ts`: Touch: `pointerdown/move/up`, dx>60px=Swipe, dx<8px=Tap. Links=behalten, Rechts=verwerfen. Desktop: Buttons "Behalten"/"Verwerfen"/"Unsicher".
  Tests: dx-Mapping, Tap-vs-Swipe, Button-Click.
  Blocks: T11

- [ ] **T15. Queue-Rendering (Sidebar + Dashboard)**
  Sidebar: Queue-Sektion mit Cards, Swipe/Buttons. Dashboard: Gleiche Cards. Preview-Expand bei Tap.
  Tests: Render mit DOM-Stubs.
  Blocks: T11, T14

### Wave 5: Exam System

- [ ] **T16. Exam-Template + 4-State-Machine**
  `src/exams/template.ts`: Template `Exam <Title>.md`. Frontmatter: type, date, subject, status. Status-Machine: planned→in-prep (auto), in-prep→done (manuell), any→postponed (manuell, triggert Recalc).
  Tests: Template-Validierung, State-Transitions.
  Blocks: —

- [ ] **T17. Prep-Window-Engine**
  `src/exams/prep-window.ts`: `Window = Base(type) × Multiplikator(points)`. Basen: Klausur 14d, Ex 10d, Test 5d, Presentation 7d, Abi 183d. Multiplikator: linear 15P→×0.7 … 0P→×3.0. Setting `gradesScale: points|grades`.
  Tests: Formel, Basen, Noten-Skala.
  Blocks: T16

- [ ] **T18. Subject Index + Grades-Modal**
  `src/exams/grades.ts`: Fachindex in data.json. +2 Wochen nach Exam: persistent Notice + Dashboard-Task. Modal für Eintrag (0-15 Punkte oder Note). Schreibt Fachindex.
  Tests: Trigger, Task-Persistenz, Modal-Schreibvorgang.
  Blocks: T16, T17

- [ ] **T19. Countdown-Panel + Override**
  `src/exams/countdown.ts`: Dashboard-Panel "Exams & Countdown". Exam-Liste + Status + "X Tage". Status jederzeit manuell (Klick). Postponed → Fenster neu berechnet.
  Tests: Panel-Render, Override, Recalc.
  Blocks: T16, T17, T18

### Wave 6: Study Plan + PDF + Polish

- [ ] **T20. Study Plan Scaffold**
  `src/study-plan/scaffold.ts`: Bei Phasen-Start: alle MD-Notizen im Fachordner (inkl. Material/, rekursiv) seit letzter Exam als Link-Liste in `Study Plan <Exam>.md`. Fallback: Schuljahresbeginn (1.8.).
  Tests: Datum-Filter, Fallback, Link-Format, Rekursion.
  Blocks: T16

- [ ] **T21. PDF.js Inline-Preview**
  `src/utils/pdf.ts`: `loadPdfJs()` (Obsidian-bereitgestellt). Erste Seite als Canvas + Seiten-Pager. Bytes aus Hash-Download. In Queue-Cards bei Tap.
  Tests: Mock-pdfjs, Canvas-Rendering.
  Blocks: T11

- [ ] **T22. PDFium-Vollviewer**
  `src/utils/pdfium.ts`: iframe mit blob-URL. In separatem Leaf/Modal.
  Tests: iframe rendert PDF.
  Blocks: T21

- [ ] **T23. Settings-Redesign**
  Neue Settings: `discardCacheTtl`, `emailCacheTtl`, `gradesScale`, `prepWindowBases`, `ablageTemplate`, `onlySchoolEmails`.
  Tests: Settings-Render, Defaults.
  Blocks: T11-T22

- [ ] **T24. Integration + Manual QA**
  JobRunner: Core 15 / Mails 15 / Exercises 30 / Files 60 min. Auto-Login. Sync now + pro-Modul-Kommandos. Manuelles QA in Obsidian: Plugin-Load, Auto-Login, Views rendern, Notices funktionieren.
  Blocks: T1-T23

---

## Dependencies
```
S1 (TS Setup) ─── S2 (CONTEXT) ─── S3 (gitignore)
    │
    ├── T1 (Client) ── T2 (CredStore) ── T3 (Plugin) ── T4 (Sync)
    │     │
    │     ├── T5 (Timetable) ── T6 (Sidebar) ── T7 (Dashboard)
    │     │
    │     ├── T8 (Exercises)
    │     │
    │     └── T9 (Mails) ── T10 (Mail Reader)
    │
    └── T11 (Queue State) ── T12 (Dedup) ── T13 (Template)
          │                 └── T14 (Swipe) ── T15 (Queue UI)
          │
          └── T16 (Exam) ── T17 (Prep Window) ── T18 (Grades)
                │                               └── T19 (Countdown)
                │
                └── T20 (Study Plan)
                │
                └── T21 (PDF.js) ── T22 (PDFium)
                │
                └── T23 (Settings) ── T24 (Integration)
```

---

## Commit-Strategie
Ein Commit pro Task (conventional: `feat:`, `fix:`, `test:`, `chore:`). Jede Wave = ein PR.

## Verification
- `npm run typecheck` nach jedem Task (keine TS-Fehler)
- `npm test` nach jedem Task (alle Tests grün)
- Manuelles QA in Obsidian nach T24
- Keine Credentials in Logs/Repo

---

## Dateien
- `src/` — TypeScript-Quelldateien
- `test/` — Vitest-Tests
- `docs/` — API-Doku, ADRs
- `main.js` — Build-Output (am Repo-Root)
- `styles.css` — CSS
- `manifest.json` — Obsidian-Plugin-Manifest
