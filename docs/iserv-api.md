# IServ API-Referenz — gymmeck.de (non-invasiv reverse-engineert)

> **Stand**: 2026-08-22 · **Methode**: live beobachtete Requests der offiziellen IServ-Weboberfläche (Stundenplan, Kalender, E-Mail, Dateien, Pläne), HAR-Analyse, gezielte GET-Proben im Browser-Kontext. **Kein einziger schreibender Request** außer Login + Telemetrie-Heartbeat (automatisch, unvermeidbar). Keine Credentials in diesem Dokument. · **Aktualisiert 01.09.2026** (Live-Spike T11/T12: Pläne-Untis-HTML, Exercise-Aufgaben, Korrekturen — neue Sektionen unten).
>
> **Zweck**: Grundlage für AutomationOS (T1 im Wayfinder) — IServ nie wieder öffnen müssen. Alles hier ist **lesend** verifiziert.

## Sicherheitsregeln (immer)

- **Nur GET/PROPFIND.** Keine POST/PUT/DELETE außer Login + unvermeidbarer Telemetrie.
- **Kein Crawling**, keine Massenabrufe. Rate: wenige Requests pro Sekunde, nur was manuell auch sinnvoll wäre.
- **Nichts in git**: Credentials, Cookies, personenbezogene Daten gehören nicht ins Repo.
- Session-Cookie `IServSession` (HttpOnly) nach Login; 2FA-Token wird nach Login **nicht** wiederverwendet.

## Auth & Session

| Schritt | Request | Details |
|---|---|---|
| Login-Formular | `GET /iserv/auth/login` | liefert `_username`/`_password`-Form + `_target_path` |
| Login | `POST /iserv/auth/login` | Form-URL-encoded: `_username`, `_password`, optional `_two_factor_token`; Redirect via `_target_path` |
| 2FA (falls aktiv) | `POST /iserv/auth/login` | zweiter POST mit `_two_factor_token` (TOTP) |
| Session-Cookie | — | `IServSession` (HttpOnly, SameSite); TTL unbekannt, bleibt über Stunden stabil |
| Dashboard | `GET /iserv/` | 200 nach Login; enthält Modul-Links, E-Mail-Zähler, Aufgaben, News |

**Beobachtet**: Login leitet durch `/iserv/auth/auth` (OIDC-Flow mit JWT-State) → `/iserv/`. Cookie-Jar in `scripts/nextDue.js` zeigt den gleichen Ablauf (bewährt).

**Login-Ökonomie (01.09.2026, Live-Spike)**: direkt `GET /iserv/auth/login` funktioniert (die nextDue.js-`/iserv/timetable/`-Präludium-Variante hängt an einem JS-Redirect-Interstitial). `IServSession` landet erst ~5. Hop nach dem Login-POST (GET → POST → 302 → meta-refresh → 301 → 302 → meta-refresh → 302 → 200; Cookie bei Request #8) → ein Login ≈ 8–9 Requests. **Session persistieren** statt pro Sync neu einloggen.

---

## DieschulApp API (`/iserv/dieschulapp/api/1.0/`)

JSON, `Accept: application/json`, Session-Cookie. Basis-Pfad überall `https://gymmeck.de/iserv/dieschulapp/api/1.0/`.

| Endpoint | Methode | Status | Zweck / Antwort-Kopf |
|---|---|---|---|
| `users/me` | GET | 200 | eigene Person: `{id, school, forename, surname, displayname, ...}`; mit `?fields=`-Filter erweiterbar (id, displayname, externalId, isAdmin, roles, mainCourse, courses, children) |
| `timetable-entries/` | GET | 200 | alle Unterrichtsstunden: `[{id, courseSubject:{teachers:[{displayname, externalId}], subject:{name, acronym, hexColor}, course:{...}}, weekday, ...}]` |
| `substitutions/` | GET | 200 | Vertretungen: `[{id, createdAt, channel:{name,type}, channels[], date, ...}]` — 01.09.2026: nur retrospektiv (~2 Wochen, keine Voraus-Daten); Felder + `substitutionType` siehe Pläne-Modul-Sektion |
| `substitutionBoardMessages/` | GET | 200 | Aushang-Meldungen; Filter: `?filterBy=validFromDate:smallerOrEqualThan(YYYY-MM-DD),validTillDate:greaterOrEqualThan(YYYY-MM-DD)` (pro Tag aufrufen) — ⚠ 01.09.2026: liefert literal `[]` (ungefiltert + je Tag) → Sackgasse, siehe Pläne-Modul-Sektion |
| `current-timetable/` | GET | 200 | **Stundenplan + Vertretung kombiniert**: `?date=YYYY-MM-DD&week=true&substitutions=true&filterBy=courseSubject.course:in(<kurs-ids>|…)` — das Kern-Endpoint für „Was habe ich wann, was fällt aus" — ⚠ **01.09.2026: `?substitutions=true` → 404 verifiziert; T12** (Vertretungen stattdessen via Pläne-Untis-HTML, siehe Pläne-Modul-Sektion) |
| `timetable-slots/` | GET | 200 | Zeitraster: `?filterBy=type:is(lesson)` |
| `timetable-blocks/` | GET | 200 | Blöcke: `?orderBy=name` |
| `timetableblock-datetime-ranges/` | GET | 200 | Block-Zeiten |
| `messages/` | GET | 200 | Nachrichten/Feed: `[]` (leer bei mir — Endpoint existiert) |
| `tasks/` | GET | 200 | Aufgaben: `[]` (leer bei mir — Endpoint existiert) — ⚠ 01.09.2026: **Dead End** (echt leer + jedes `filterBy` → 500 „Slim Application Error"); Aufgaben via Exercise-Modul, siehe Aufgaben-Sektion |
| `groups/` | GET | 200 | Gruppen: `[{id, name}, …]` (Schulfamilie, Kurse) |
| `vacations/` | GET | 200 | Ferien: `[{id, name, startDate, endDate}, …]` |
| `timetable/` | GET | 200 | leer (Alias?) |
| `students/` | GET | 200 | Schüler (Eltern-Sicht): `?fields=id,forename,surname,displayname,mainCourse,courses` |
| `school-settings/` | GET | 200 | Schul-Konfig |
| `ofrep/v1/evaluate/flags` | POST | 200 | Feature-Flags (unvermeidlich beim UI-Load) |

**Nicht vorhanden (404, probiert)**: `grades/`, `grade/`, `mail/`, `emails/`, `calendar/`, `calendar/events/`, `events/`, `news/`, `newsfeed/`, `files/`, `file/`, `appointments/`, `contacts/`, `absence/`, `dashboard/`, `school/`, `holidays/`, `plan/`, `plans/`, `menu/`, `settings/`.

---

## Kalender (`/iserv/calendar/`)

| Endpoint | Methode | Status | Zweck |
|---|---|---|---|
| `feed/calendar-multi?start=YYYY-MM-DD&end=YYYY-MM-DD` | GET | 200 | **Termine** als JSON: Map `{"/<user>/home": [{id, uid, recurrenceId, hash, title, start, end, allDay, ...}]}` — auch ICS-UIDs enthalten |
| `api/eventsources` | GET | 200 | verfügbare Kalender: `[{label, id, subscription, color, url: "/iserv/calendar/feed/calendar?cal=...", type}]` |
| `api/upcoming` | GET | 200 | kommende Termine (Dashboard) |
| `api/last_view` | GET | 200 | letzte View (dayGridMonth) |
| `calendar4/plugin?plugin=holiday&start=…&end=…` | GET | 200 | Ferien-Plugin: `[{id, title, start, end, allDay, plugin:"holiday"}]` |
| `calendar4/plugin?plugin=exam-plan&start=…&end=…` | GET | 200 | **Klausurplan-Plugin** (für Zeitraum leer, Endpoint existiert) — für Arbeitstracking entscheidend! |
| `create_simple`, `import/upload`, `scheduling/invitation/all` | GET | 200 | UI-Endpoints (Formulare) |

Hinweis: `feed/calendar?cal=<kalender-id>` liefert offenbar auch ICS (`text/calendar`), falls gewünscht.

---

## E-Mail (`/iserv/mail/api/v2/`)

| Endpoint | Methode | Zweck |
|---|---|---|
| `account/<email>/message?mailbox[]=SU5CT1g&limit=25&offset=0&sort=date&order=desc` | GET | **Nachrichtenliste** (Mailbox = Base64, z. B. `SU5CT1g` = `INBOX`); liefert JSON mit Betreff, Absender, Datum — `<email>` = eigene IServ-Mailadresse |
| `account/<email>/mailbox/SU5CT1g/quota` | GET | Postfach-Quota |
| `setting/signature` | GET | Signatur-Einstellung |

Basis für Mail-Feed im AutomationOS. `SU5CT1g` ist `Buffer.from("INBOX").toString("base64")`.

---

## Dateien (`/iserv/file/`)

| Endpoint | Methode | Zweck |
|---|---|---|
| `- /Files` | GET | HTML-Datei-Manager (Root) |
| `api/list?id=<base64>` | GET | **Verzeichnisliste (JSON)**: `{data:[{id, name:{text,link}, size, type:{id:"Folder"/"File"}, thumbnail, owner, date, path}], writable, breadcrumbs}` — `id` = Base64 des Pfads (z. B. `RmlsZXM=` = `Files`); `?id=<pfad-base64>` für Unterordner |
| `- /<pfad>` | GET | Einzelne Datei / Download (folgt Link aus `api/list`) |

**WebDAV ist deaktiviert**: `PROPFIND /iserv/webdav/`, `/iserv/dav/` → alle 404. Die offizielle Doku (doku.iserv.eu) beschreibt WebDAV generisch, diese Instanz hat es nicht freigeschaltet → **nicht für AutomationOS nutzbar**; stattdessen `file/api/list` verwenden.

---

## Weitere Module

| Endpoint | Methode | Status | Zweck |
|---|---|---|---|
| `/iserv/plan/overview` | GET | 200 | **Vertretungsplan** als HTML („Vertretungsplan Schüler", Format HTML) — parsebar, aktuell kein JSON-Endpoint gefunden |
| `/iserv/notification/api/v1/notifications` | GET | 200 | Benachrichtigungen (Badges) |
| `/iserv/notification/api/v1/notifications/sse?since=…&lastId=…` | GET (SSE) | 200 | **Live-Event-Stream** — Echtzeit-Updates (E-Mail, Aufgaben) |
| `/iserv/app/navigation/badges` | GET | 200 | Nav-Badges (ungelesene Zähler) |
| `/iserv/todo/api/v1/task/search` | POST | 200 | Aufgaben-Suche (Todo-Modul; leeres JSON → 422, braucht valides Query-Objekt) |
| `/iserv/public/telemetry/heartbeat` | POST | 200 | Telemetrie (automatisch, unvermeidbar) |

---

## Pläne-Modul (Vertretungsplan, Untis-HTML) — Stand: 01.09.2026 (Live-Spike T11/T12)

**Primärquelle für Vertretungen** (T12): autoritativ, tagesaktuell (`Stand:`-Timestamp 07:29, 60s self-refresh), unterscheidet Entfall/Vertretung/Art in eigenen Spalten, liefert den **tatsächlichen Vertreter** (DieSchulApp-API hat ihn nicht) + Tagesmeldungen. Jahrelang stabiles Untis-Markup.

Kette (4 Ebenen tief, `plan/overview` ist nur der Index):

| Schritt | Request | Details |
|---|---|---|
| Index | `GET /iserv/plan/overview` | nur Modul-Index („Vertretungsplan Schüler", Format HTML) |
| IServ-Shell | `GET /iserv/plan/show/Vertretungsplan%20Sch%C3%BCler` | HTML-Shell mit iframe |
| Raw | `GET /iserv/plan/show/raw/…` | 301/302-Redirects |
| Untis-Frameset | `…/subst_001.htm` | Untis-2026-Frameset |
| Tageslisten | `…/f1/subst_001.htm` (heute) · `…/f2/subst_001.htm` (morgen) · `subst_title.htm` | zu parsen |

HTML-Struktur der Tageslisten:

- `div.mon_title` → Datum + Wochentag
- `Stand: …` → Publish-Timestamp — regex-Anker, billige Change-Detection fürs Polling (15-min-Cadence reicht)
- `table.info` („Nachrichten zum Tag") → Tagesmeldungen + abwesende Lehrer
- `table.mon_list` → Vertretungs-Zeilen: `tr.list.odd|.even`, positionale `td.list`-Zellen, Header via `th.list`; leer = „Keine Vertretungen"

Parse-Skizze: nach Login `…/raw/<plan>/f1|f2/subst_001.htm` fetchen → mon_title/info/mon_list parsen (th↔td positional); Whole-School-Zeilen auf Klassen-Tokens filtern (12gN/12eN aus `timetable-entries/`).

Flags:

- Stundenplan **„gilt ab 07.09.2026"** (neue Version nach Projektwoche) — Weekday-Maps nicht über dieses Datum cachen; `timetable-entries/` neu fetchen.
- Weitere Tage vermutlich `subst_002.htm` (Untis-Standard, unverifiziert).
- Exaktes Spalten-Set (Klasse/Stunde/Fach/Raum/Vertreter/Art/Mitteilung) an einem normalen Schultag re-verifizieren — in der Projektwoche waren beide Listen leer.

### `substitutions/` (JSON) — nur Sekundär-Cross-Check

Nur retrospektiv (~2 Wochen Rückblick, **keine Voraus-Daten**). Vertretungs-Lehrer/Fach **leer**; vorhanden: `room`, `insteadOfTeacher`, `date`+`hour`, **`substitutionType`** (`class-absence` = Entfall, `substituted` = Vertretung), `displayMessageForStudents`. ⚠ Consumer, der `substitutionType` ignoriert, rendert Entfälle als generische Vertretungen ohne Lehrer/Fach. Hybrid-Rolle: `substitutionType=="class-absence"` ist maschinenfreundlich für die Entfall-Erkennung — nie primäre Display-Quelle. Gleiche Session bedient beide Quellen.

### `substitutionBoardMessages/` — Sackgasse

Literal `[]` (ungefiltert und je Tag 30.08.–02.09.) — trägt weder Untis-Zeilen noch Tagesmeldungen. Unbrauchbar.

---

## Aufgaben (Classic-Exercise-Modul) — Stand: 01.09.2026 (Live-Spike T11/T12)

**`dieschulapp/api/1.0/tasks/` = Dead End** (korrigiert die T4-Annahme „tasks/ nimmt course-Filter"):

- `200 []` ist **echt leer** — der Endpoint ist das Backend der DieSchulApp-App; das Aufgaben-Feature hat keinen Classic-IServ-Datenzustrom (dito `messages/`).
- **Jedes `filterBy` → 500 „Slim Application Error"** (auch `zzzNotAField:in(1)`) — der Crash sitzt in der Filter-Verarbeitung selbst; „einfach Parameter ergänzen" ist kein gangbarer Weg.
- Kein JSON-Endpoint für Aufgaben: `dieschulapp/api/1.0/exercises/` → 404, `exercise/api/v1/…` → 404.

**Aufgaben kommen aus dem Classic-Exercise-Modul (HTML)**: `GET /iserv/exercise` (Liste) + `exercise/enter`, `exercise/show/<id>` — parsebar wie `plan/overview` (akzeptiertes Pattern).

Feldstruktur (offizielle IServ-Doku): Titel, Beschreibung, Starttermin, **Endtermin (= Due-Date)**, Toleranzdatum, Abgabetyp, Musterlösung (erst nach Toleranz), **Kurs-/Gruppen-Kontext** — **KEINE Lesson/Stunden-Referenz**, der Due-Shift-Join läuft Kurs → Stundenplan (exakt die nextDue-Logik) —, pro-Schüler-Status (offen/abgegeben), Ersteller = Lehrkraft.

Nebenfund: To-dos offiziell per CalDAV lesbar (`/caldav/<user>/todos/`) — To-dos ≠ Aufgaben.

---

## Vollständige Modul-Map (alle 29 Module, 2026-08-22)

Alle Module des Accounts + ihre beobachteten API-Aufrufe (GET, live verifiziert).

### Kernmodule (Schulalltag)

| Modul | URL | API-Endpunkte |
|---|---|---|
| **E-Mail** | `/iserv/mail` | `mail/api/v2/account/<email>/message?mailbox[]=<b64>&limit=25&offset=0&sort=date&order=desc` (Liste), `mailbox/<b64>/quota`, `setting/signature`, `mail/api/v2/account/:primary/message?flag[seen]=false` (ungelesen) |
| **Dateien** | `/iserv/file/-/Files` | `file/api/list?id=<b64>` (JSON-Listing), `file/-/<pfad>` (Download), `thumbnail/<b64>/<mtime>` (Vorschau) — **WebDAV deaktiviert** (404) |
| **Kalender** | `/iserv/calendar` | `calendar/feed/calendar-multi?start&end`, `calendar/api/eventsources`, `calendar/api/upcoming?includeSubscriptions=true&limit=14`, `calendar/api/last_view`, `calendar4/plugin?plugin=holiday|exam-plan` |
| **Stundenplan** | `/iserv/dsa-timetable/timetable` | `dieschulapp/api/1.0/current-timetable/?date&week=true&substitutions=true&filterBy=…`, `timetable-slots/`, `timetable-blocks/`, `timetableblock-datetime-ranges/`, `students/` |
| **Pläne (Vertretung)** | `/iserv/plan/overview` | HTML; `substitutionBoardMessages/?filterBy=validFromDate…validTillDate…` (JSON, je Tag) — 01.09.2026: Untis-HTML-Kette + Parse-Skizze → Pläne-Modul-Sektion; substitutionBoardMessages = Sackgasse |
| **Aufgaben (Tutor)** | `/iserv/exercise` | `exercise/enter`, `exercise/show/<id>` (HTML); `dieschulapp/api/1.0/tasks/` (JSON, leer) — 01.09.2026: tasks/ = Dead End (filterBy→500) → Exercise-HTML ist die Quelle |
| **To-do** | `/iserv/todo/home` | `todo/api/v1/task/search` (POST, Query), `todo/_components/ToDoListComponent` (POST, Fragment) |
| **Speicher** | — | `du/account` (JSON), `profile/diskusage` (HTML) |

### Kommunikation & Content

| Modul | Endpoints |
|---|---|
| **Foren** | `/iserv/forums` (HTML), Badge `forum`; kein separater JSON-Endpoint gefunden |
| **News** | `/iserv/news`, `news/show/<id>`, `news/category/<id>` (HTML) |
| **Messenger** | **Matrix**: `/_matrix/client/v3/capabilities`, `/_matrix/client/v3/sync?filter&timeout&since`, `/_matrix/client/v3/profile/<userId>`, `/_matrix/client/v3/pushrules/`, `/_matrix/client/versions`, `/_matrix/client/v3/voip/turnServer`; dazu `messenger/authenticate`, `messenger/api/lookup/account` |
| **Pinnwände** | `dieschulapp/api/1.0/pinboards/`, `dieschulapp/api/1.0/channels/` |
| **Umfragen** | `/iserv/poll` (HTML) |
| **Verteilerlisten** | `/iserv/mailinglist` (HTML) |
| **Texte (Etherpad)** | `/iserv/etherpad` (HTML, extern eingebettet) |
| **Tafeln** | `/iserv/excalidraw/` (HTML) |
| **Office** | `/iserv/office` (HTML) |

### Verwaltung & Extras

| Modul | Endpoints |
|---|---|
| **Abwesenheiten (Eltern)** | `user-requests-to-school/not-attend/{bus,afternoon-care,kindergarten,lunch}/?fields=…`, `user-requests-to-school/student-absences/`, `sickNotes/?fields=…`, `sickNotes/userSelection/`, `services/` |
| **Adressbuch** | `/iserv/addressbook/personal` (HTML) |
| **Gruppenansicht** | `/iserv/groupview` (HTML) |
| **Kurswahlen** | `/iserv/courseselection` (HTML) |
| **Schulbücher/Ausleihe** | **Extern**: `ausleihe.gymmeck.de/` (Angular) + `ausleihe-api.gymmeck.de/me`, `/serverconfig`, `/schoolyears/current` |
| **Videokonferenz** | `videoconference/api/health` (Health-Check) |
| **Eduplaces** | Redirect zu `app.eduplaces.de` (OIDC) — extern |
| **Drucken** | `/iserv/print` (HTML) |
| **Formulare** | `/iserv/althaus-fm/form` (HTML, Plugin) |
| **CASIO** | extern (casio-education.eu, OIDC-Login) |
| **Hilfe/Impressum** | `/iserv/help`, `/iserv/app/legal` |
| **Konto** | `account/my`, `account/settings`, `account/info/last_logins` |

### System & Notification

| Endpoint | Zweck |
|---|---|
| `notification/api/v1/notifications` + `notifications/sse?since=…&lastId=…` | Benachrichtigungen + Live-Stream (SSE) |
| `app/navigation/badges` | Ungelesen-Zähler je Modul (JSON: `{exercise, mail, forum}`) |
| `tour/api/tour/?module=portal-web` | Tour/Hilfe |
| `public/telemetry/heartbeat` | Telemetrie (POST, automatisch) |
| **Swagger/OpenAPI** | **existiert nicht**: `/iserv/dieschulapp/api/1.0/docs`, `/docs`, `/swagger`, `/api-docs`, `/openapi.json` → alle 404 |

---

---

## AutomationOS-relevante Datenquellen (Zusammenfassung)

| Bedarf (Destination) | Endpoint |
|---|---|
| Stundenplan + Ausfälle kombiniert | `current-timetable/?date=…&week=true&substitutions=true&filterBy=…` — ⚠ 01.09.2026: `?substitutions=true` → 404; Vertretungen via Pläne-Untis-HTML |
| Vertretungsplan-Meldungen je Tag | `substitutionBoardMessages/?filterBy=…` (oder `plan/overview` HTML) — ⚠ 01.09.2026: substitutionBoardMessages = literal [] (Sackgasse) → Pläne-Untis-HTML |
| Klausuren / Arbeiten | `calendar4/plugin?plugin=exam-plan` + `feed/calendar-multi` |
| Ferien | `vacations/`, `calendar4/plugin?plugin=holiday` |
| E-Mails | `mail/api/v2/account/<email>/message?mailbox[]=SU5CT1g…` + SSE-Notifications |
| Dateien (Review-Queue) | `file/api/list?id=<base64>` + Download via `file/-/<pfad>` |
| Aufgaben | `tasks/` + `todo/api/v1/task/search` — ⚠ 01.09.2026: tasks/ = Dead End → Exercise-HTML (`/iserv/exercise`) |
| Benachrichtigungen (Live) | `notification/api/v1/notifications/sse` |
| Noten | **kein Endpoint gefunden** (404 auf alle Kandidaten) — Noten liegen nicht in der Schüler-DieschulApp-API; → T1-Erkenntnis fürs AutomationOS: Noten-Feed muss woanders her (manuell?) |

## Offene Fragen (für AutomationOS-Tickets)

1. **Noten**: kein API-Zugang gefunden — wie kommen Noten ins System (manuell, T10)?
2. **`tasks/` und `messages/` liefern `[]`** — leer, weil nichts vorhanden, oder brauchen sie Parameter? (UI zeigt „Aufgaben" mit Inhalt → vermutlich Parameter) → **01.09.2026 beantwortet**: echt leer (kein Classic-Datenzustrom) + jedes filterBy → 500; Aufgaben kommen aus dem Exercise-Modul, siehe Aufgaben-Sektion
3. `plan/overview` ist HTML — Parsing nötig; gibt es doch einen JSON-Endpoint unter anderem Namen? → **01.09.2026 beantwortet**: kein JSON-Endpoint gefunden; Untis-HTML-Kette hinter `plan/show/raw/…`, siehe Pläne-Modul-Sektion
4. SSE-Notifications: Auth-Token/`since`-Handling für dauerhafte Subscriptions.

## Anhang: Methodik

- Browser: headless Chromium 149 (NixOS), CDP auf Port 9224, Session via `agent-browser connect`
- HAR-Dateien: 4 Batches (`har-batch1` Login+Proben, `har-timetable`, `har-calendar`, `har-files`) — Requests gefiltert (CSS/JS/Bilder raus), dedupliziert
- Jede Endpoint-Familie durch die echte UI ausgelöst (nur Navigation), zusätzlich gezielte GET-Proben
- Keine Credentials/Payloads im Repo; Passwort ausschließlich im agent-browser Vault (`auth save iserv`)
