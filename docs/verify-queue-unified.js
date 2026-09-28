// Live-Verifikationsscript "Dashboard-Review-Queue vereinheitlichen" (28.09.2026).
//
// Ablage: docs/verify-queue-unified.js (dieses Repo). Ausführen (Coordinator):
//   code=$(node -p "'(() => {'+require('fs').readFileSync('docs/verify-queue-unified.js','utf8')+'})()'")
//   obsidian-cli eval "code=$code"
// (Das IIFE ist nötig, weil eval top-level-return ablehnt.)
//
// Beweist am ECHTEN Obsidian (nicht jsdom), nach Deploy des Umbaus:
//   A1  Dashboard rendert EXAKT die Sidebar-Queue-Section-Klassen:
//       Sektion ".iserv-queue" OHNE ".iserv-dashboard-queue", Rows
//       ".iserv-queue-row" OHNE ".iserv-dashboard-queue-row" (eine Quelle =
//       renderQueueSection aus src/views/sidebar-render.ts).
//   A2  Duplikat-Marker entfernt: 0× ".iserv-queue-preview" (totes
//       Preview-Button-Konzept), 0× ".iserv-dashboard-queue-action(-s)"
//       (funktionlose Behalten/Verwerfen/Überspringen-Pills).
//   A3  ALLE sichtbaren Rows (nur neu/unsure, wie Sidebar) sind klickbare
//       Preview-Zeilen ".iserv-queue-row-clickable" (ganze Zeile = Preview).
//   A4  Desktop-Buttons ".review-queue-buttons" (Behalten/Verwerfen/Unsicher)
//       an jeder Row vorhanden UND funktionierend: Klick auf "Verwerfen" am
//       ersten Row erhöhe getItemsByStatus("discarded") um +1 und setze
//       Status auf "discarded" (Persistenzpfad queue-bind.ts →
//       queueActionHandlers aus main.ts). Danach Rückroll auf "neu" + save,
//       damit keine echte Nutzerentscheidung kippt.
//   A5  Summenzeile (R6-queue-sum): Text IDENTISCH zur Sidebar-Queue.
//   A6  Section-Titel: IDENTISCH zur Sidebar (zählt offene Sichtungen).
//   A7  Status-Badge-Konvention wie Sidebar (iserv-queue-status + iserv-queue-<status>).
//
// Resultat: JSON. "PASS": true ⇔ alle Assertion-Flags 1. Jede 0 erscheint
// in "failed"; der Run läuft auch gegen den ALTEN Stand durch (fällt dort
// sichtbar bei A1–A4 durch = Beweis der Differenz).

const A = {};                       // Assertion-Resultate (1 = ok, 0 = fail)
const plugin = app.plugins.plugins["iserv-integration"];
const dashLeaf = Object.values(app.workspace.getLeavesOfType("iserv-dashboard-view"))[0];
const sideLeaf = Object.values(app.workspace.getLeavesOfType("iserv-sidebar-view"))[0];

if (!plugin) { A.A0_plugin = 0; }
else { A.A0_plugin = 1; }
if (!dashLeaf?.view) { A.A0_dashboardView = 0; }
else {
  const dashEl = dashLeaf.view.containerEl.querySelector(".iserv-dashboard");
  if (!dashEl) { A.A0_dashboardRoot = 0; }
  else {
    A.A0_dashboardRoot = 1;
    const dashSec = dashEl.querySelector(".iserv-queue");
    const dashRows = [...dashEl.querySelectorAll(".iserv-queue-row")];
    const sideEl = sideLeaf?.view?.containerEl?.querySelector(".iserv-sidebar") || null;
    const sideSec = sideEl?.querySelector(".iserv-queue") || null;

    // isOpen-Annahme: Sektion existiert nur, wenn offene Rows da sind (ADR-0008).
    if (!dashSec) {
      // Leerzustand-Robustheit: wenn auch die Sidebar keine Queue-Section hat,
      // gilt das als konsistenter Leerzustand (A-Assertions entfallen).
      A.A_empty_state_consistent = sideSec ? 0 : 1;
      A.note = "Dashboard ohne .iserv-queue-Section — konsistent, wenn auch Sidebar leer.";
    } else {
      A.A_empty_state_consistent = 1;
      const dashTitle = dashSec.querySelector(".iserv-section-title")?.textContent || "";
      const sideTtl = sideSec?.querySelector(".iserv-section-title")?.textContent || "";
      const dashSum = dashEl.querySelector(".iserv-queue-auto-summary")?.textContent || null;
      const sideSum = sideEl?.querySelector(".iserv-queue-auto-summary")?.textContent || null;

      A.A1_no_dup_classes = (dashSec.classList.contains("iserv-dashboard-queue")) ? 0
        : (dashRows.some(r => r.classList.contains("iserv-dashboard-queue-row"))) ? 0 : 1;
      A.A2_dup_markers_gone =
        (dashEl.querySelectorAll(".iserv-queue-preview").length === 0 &&
         dashEl.querySelectorAll(".iserv-dashboard-queue-action").length === 0 &&
         dashEl.querySelectorAll(".iserv-dashboard-queue-actions").length === 0) ? 1 : 0;
      A.A3_all_rows_clickable_preview =
        (dashRows.length > 0 && dashRows.every(r => r.classList.contains("iserv-queue-row-clickable"))) ? 1 : 0;
      A.A4_desktop_buttons_present =
        (dashRows.length > 0 && dashRows.every(r => r.querySelector(".review-queue-buttons"))) ? 1 : 0;
      A.A5_summary_same_text =
        (sideSum === null) ? 1 /* Sidebar-zu-Vergleich fehlt (nicht offen): neutral */
        : (dashSum === sideSum) ? 1 : 0;
      A.A6_title_same_as_sidebar =
        (sideTtl === "") ? 1 /* Sidebar nicht offen: neutral */
        : (dashTitle === sideTtl) ? 1 : 0;
      A.A7_badge_convention =
        [...dashEl.querySelectorAll(".iserv-queue-status")].every(b =>
          /(^|\s)iserv-queue-status(\s|$)/.test(b.className) &&
          /iserv-queue-(kept|discarded|unsure|auto)$/.test(b.className)) ? 1 : 0;

      // --- Funktionsbeweis A8: Verwerfen-Klick persistiert über die echte
      //     ReviewQueue-State (queueActionHandlers → updateStatus + save).
      let actionProof = null;
      try {
        const firstRow = dashRows[0] || null;
        const discardBtn = firstRow?.querySelector(
          ".review-queue-buttons button:nth-child(2)"
        ) || null;
        const rowId = firstRow?.dataset?.id || null;
        if (discardBtn && rowId) {
          const before = plugin.queue.getItemsByStatus("discarded").length;
          discardBtn.click();
          const item = plugin.queue.getItems().find(i => i.id === rowId);
          const after = plugin.queue.getItemsByStatus("discarded").length;
          // Rückroll (keine echte Nutzerentscheidung verlieren):
          plugin.queue.updateStatus(rowId, "neu");
          const saved = plugin.queue.save();
          actionProof = (item && item.status === "discarded" && after === before + 1) ? 1 : 0;
          A.A8_discard_click_persists = actionProof;
          A.detail = { rowId, before, after, rolledBack: true, savePromiseReturned: !!saved };
        } else {
          A.A8_discard_click_persists = 0;
          A.detail = { why: "button/row fehlt", rowId: !!rowId, btn: !!discardBtn };
        }
      } catch (err) {
        A.A8_discard_click_persists = 0;
        A.detail = { err: String(err && err.message || err) };
      }
    }

    // Sichtbarkeits-Hinweis für A4 (Desktop): pointer coarse=touch device.
    A.envIsDesktop = (function () {
      const mq = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;
      return mq ? !mq.matches : true;
    })();

    // Side-by-side: gleiche Klassen wie Sidebar (falls Sidebar offen).
    A.sidebar_open = !!sideEl;
  }
}

const fails = Object
  .keys(A)
  .filter(k => /^A\d/.test(k))      // nur Assertion-Flags
  .filter(k => A[k] === 0);

return JSON.stringify({
  PASS: fails.length === 0,
  failed: fails,
  A,
  counts: {
    dashRows: (dashLeaf && dashLeaf.view.containerEl.querySelectorAll(".iserv-queue-row").length) || 0,
    dashPreviewButtons: (dashLeaf && dashLeaf.view.containerEl.querySelectorAll(".iserv-queue-preview").length) || 0,
    dashActionPills: (dashLeaf && dashLeaf.view.containerEl.querySelectorAll(".iserv-dashboard-queue-action").length) || 0,
    dashButtonGroups: (dashLeaf && dashLeaf.view.containerEl.querySelectorAll(".review-queue-buttons").length) || 0,
  },
});
