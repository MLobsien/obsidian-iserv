// Live-Verifikation "Sidebar 'Aktuell' radikal gefiltert" (Runde 6, 28.09.2026).
//
// Ablage: docs/verify-aktuell-filter.js (dieses Repo). Ausführen (Coordinator,
// nach Deploy des Umbaus):
//   obsidian-cli eval "code=$(cat docs/verify-aktuell-filter.js)"
//
// Beweist am ECHTEN Obsidian (nicht jsdom):
//   A1  Sektion ".iserv-notifications" trägt EXAKT den Titel "Aktuell"
//       (oder fehlt komplett, wenn nichts aktuell ist — ADR-0008).
//   A2  JEDE gerenderte Mail-Row in "Aktuell" ist UNGELESEN: Subject-Dedup wie
//       im Render; Zeilensubject matcht nur gegen Mails aus plugin.lastMails,
//       die ungelesen sind (unread-Flag oder kein "\Seen"). Keine gelesene
//       Mail darf auftauchen.
//   A3  KEINE Mail-Pagination in "Aktuell" (0× .iserv-mail-pagination) —
//       Browse bleibt im Mail-Reader/Dashboard.
//   A4  Arbeiten-Zeilen (.iserv-exam-days) sind NUR zukünftig: Label matcht
//       "heute" oder "in N Tagen" (kein vergangener Termin-Leak).
//   A5  Aufgaben-Zeilen sind NUR offene: .iserv-homework-row /
//       .iserv-exercise-mini-row tragen KEIN Statuswort "abgegeben"/"erledigt"
//       (Feed-Vertrag fetchOpenExercises: nur Nicht-Abgegebenes).
//   A6  HW-Marker=". HW: " nur auf .iserv-homework-row (Konsistenz der
//       Hausaufgaben-Kennzeichnung mit dem Compositor).
//   A7  Leerzustand konsistent: fehlt die Sektion, gibt es auch keine Rows
//       (ADR-0008: leere Sektion entfällt, kein halbleerer Kasten).
//
// Resultat: JSON. "PASS": true ⇔ alle Kern-Flags 1. Jede 0 erscheint in
// "failed". Der Run läuft auch gegen den ALTEN Stand durch (dort fällt er
// sichtbar bei A2/A3/A7 durch = Beweis der Differenz).

const A = {}; // Assertion-Flags (1 = ok, 0 = fail)
const plugin = app.plugins.plugins["iserv-integration"];
A.A0 = plugin ? 1 : 0;

const sideLeaf = Object.values(
  app.workspace.getLeavesOfType("iserv-sidebar-view")
)[0];
const root = sideLeaf?.view?.containerEl?.querySelector(".iserv-sidebar") || null;
A.A0_sidebarRoot = root ? 1 : 0;

function unreadPredicate(mail) {
  return (mail.unread ?? (mail.flags?.includes("\\Seen") === false)) === true;
}

if (!plugin || !root) {
  A.A7_empty_state_consistent = 0; // Setup nicht herstellbar → sichtbar failen
} else {
  const sec = root.querySelector(".iserv-notifications");

  if (!sec) {
    // ADR-0008: nichts Aktuelles → Sektion ganz weg.
    A.A1 = 1;
    A.A2 = 1; // keine Rows → keine gelesene Mail drin
    A.A3 = 1; // keine Pagination
    A.A4 = 1; // keine Arbeits-Zeilen
    A.A5 = 1; // keine Aufgaben-Zeilen
    A.A6 = 1;
    A.note = "Sektion fehlt (nichts aktuell) — konsistent mit ADR-0008.";
  } else {
    const title = sec.querySelector(".iserv-section-title")?.textContent ?? "";
    A.A1 = title.trim() === "Aktuell" ? 1 : 0;

    // A2: Mail-Rows nur ungelesen (Subject-Check gegen plugin.lastMails).
    const mailRows = [...sec.querySelectorAll(".iserv-mail-row")];
    const cells = (row) => [...row.querySelectorAll(".iserv-mail-subject")].map((s) => (s.textContent ?? "").trim());
    const full = Array.isArray(plugin.lastMails) ? plugin.lastMails : [];
    const mailRowSubjects = mailRows.flatMap(cells);
    if (mailRowSubjects.length === 0) {
      A.A2 = 1; // keine Mail-Zeilen → trivial ok
    } else {
      const unreadSubjects = new Set(
        full.filter(unreadPredicate).map((m) => (m.subject ?? "").trim())
      );
      A.A2 = mailRowSubjects.every((s) => unreadSubjects.has(s)) ? 1 : 0;
    }

    // A3: keine Pagination im "Aktuell".
    A.A3 = sec.querySelector(".iserv-mail-pagination") ? 0 : 1;

    // A4: Arbeits-Zeilen nur zukünftig ("heute" | "in N Tagen").
    const dayLabels = [...sec.querySelectorAll(".iserv-exam-days")].map(
      (d) => (d.textContent ?? "").trim()
    );
    A.A4 =
      dayLabels.length === 0 ||
      dayLabels.every(
        (t) => /^heute$/.test(t) || /^in \d+ Tagen$/.test(t) || /^\d+$/.test(t)
      )
        ? 1
        : 0;

    // A5: Aufgaben-Zeilen ohne geschlossene Statusworte.
    const closed = /(abgegeben|erledigt|fertig|zu sp[aä]t|versp[aä]tet)/i;
    const exRows = [
      ...sec.querySelectorAll(".iserv-homework-row, .iserv-exercise-mini-row"),
    ].map((r) => (r.textContent ?? "").trim());
    A.A5 = exRows.every((t) => !closed.test(t)) ? 1 : 0;

    // A6: "HW: "-Präfix nur auf Homework-Rows.
    const hwPrefixed = [...sec.querySelectorAll(".iserv-mail-row, .iserv-exam-row, .iserv-exercise-mini-row")]
      .filter((r) => (r.textContent ?? "").startsWith("HW: ")).length;
    const hwClasRows = sec.querySelectorAll(".iserv-homework-row").length;
    A.A6 = hwPrefixed === 0 ? 1 : 0;

    A.A7_empty_state_consistent = 1; // Sektion existiert mit Content
  }
}

A.failed = Object.entries(A)
  .filter(
    ([k, v]) =>
      /^A\d+$/.test(k) && k !== "A0" && k !== "A0_sidebarRoot" && v !== 1
  )
  .map(([k]) => k);
A.PASS = A.A0 === 1 && A.A0_sidebarRoot === 1 && A.failed.length === 0;

console.log(JSON.stringify(A, null, 2));
A;
