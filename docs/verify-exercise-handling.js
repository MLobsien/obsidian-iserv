/**
 * Live-Verifikationsscript "Aufgaben in Obsidian machbar" (Welle 2,
 * 28.09.2026). Beweist am ECHTEN Obsidian + ECHTEN IServ:
 *
 *   A1  Detail-Modal-DOM: ".iserv-exercise-details" existiert als Kind der
 *       geöffneten Modal-Unterlage (Obsidian: .modal-container im Body) und
 *       der Systembrowser bleibt zu (A6-Spy).
 *   A2  Kopfdaten: ".iserv-exercise-details-title" enthaelt den Namen der
 *       ECHTEN Aufgabe, ".iserv-exercise-details-meta" enthaelt Fach bzw.
 *       Frist (Quelle: Sidebar-Daten via plugin.refreshSidebar()).
 *   A3  Sanitization: das Body-Target ".iserv-exercise-details-body" enthaelt
 *       KEIN <script>/<iframe>, KEIN on*-Attribut, KEINE javascript:-href —
 *       der Renderer nutzt nur textContent (kein innerHTML-Pfad).
 *   A4  Submit-UI: ".iserv-exercise-details-textarea" (textarea),
 *       ".iserv-exercise-details-confirm" (checkbox) und
 *       ".iserv-exercise-details-btn" — Button disabled OHNE Checkbox
 *       (ADR-0005-Fussnote: bewusster Write, kein Silent-Submit).
 *   A5  Submit-UI FUNKTIONSFÄHIG ohne echten Write (rhino-Vorgabe
 *       28.09.2026): Textarea vorbefüllen, Checkbox bestätigen → Button
 *       enabled. Beweis: enable-Zustand wechselt korrekt; KEIN btn.click()
 *       — der finale Abgabe-POST bleibt dem User im echten Modal
 *       vorbehalten (Absenden-Klick). Kein Side-Effect am IServ.
 *   A6  Kein window.open im Klick-Pfad (Spy um A1/A5).
 *
 * Ablage: docs/verify-exercise-handling.js (dieses Repo). Ausfuehren
 * (Coordinator, nach Deploy):
 *   obsidian-cli eval "code=$(cat docs/verify-exercise-handling.js)"
 *
 * Resultat: JSON. "PASS": true ⇔ alle A-Flags = 1; jede 0 steht in "failed"
 * mit Detail. KEINE echte Abgabe im Script (rhino-Vorgabe): A5 beweist die
 * Submit-UI bis zum freigegebenen Button, NICHT den Write-POST.
 */
const __verify = (async () => {
const A = {};
const detail = {};
const plugin = app.plugins.plugins["iserv-integration"];
if (!plugin) {
  return JSON.stringify({ PASS: false, failed: ["A0_plugin"], A: { A0_plugin: 0 } });
}
A.A0_plugin = 1;

// KEINE echte Abgabe im Verify-Script (rhino-Vorgabe 28.09.2026): A5 belegt
// nur die Submit-UI-Fähigkeit bis zum freigegebenen Button — der finale
// Abgabe-POST passiert NUR, wenn der USER im echten Modal auf "Abgeben"
// klickt. Das Script ausgeführt am laufenden Obsidian löst also keinen
// Write am IServ aus.

// --- window.open-Spy (A6): Der Klick-Pfad darf den Systembrowser nicht nutzen.
const openCalls = [];
const origOpen = window.open;
window.open = function (...args) { openCalls.push(String(args[0] || "")); return null; };

try {
  // --- Echte offene Aufgabe beschaffen (User-Forderung: ECHTE Aufgaben).
  await plugin.refreshSidebar();
  await new Promise((r) => setTimeout(r, 400));
  const sideLeaf = Object.values(app.workspace.getLeavesOfType("iserv-sidebar-view"))[0];
  const sideEl = sideLeaf?.view?.containerEl?.querySelector(".iserv-sidebar") || null;
  const rows = sideEl ? [...sideEl.querySelectorAll(".iserv-exercise-row")] : [];
  if (rows.length === 0) {
    return JSON.stringify({ PASS: false, failed: ["A0_task_row"], A: { ...A, A0_task_row: 0 }, detail: { why: "keine offenen Aufgaben im Sidebar-Feed (IServ leer?)" } });
  }
  const row = rows[0];
  const task = {
    id: row.dataset.id || "",
    name: row.querySelector(".iserv-exercise-name")?.textContent || "",
    subject: row.querySelector(".iserv-exercise-subject")?.textContent || "",
    dueDate: row.querySelector(".iserv-exercise-due")?.textContent || "",
  };
  detail.task = task;

  // --- A1-A4: Klick auf die Row öffnet das Detail-Modal (GET show/<id> ist
  //     read-only; der Abgabe-POST läuft NUR beim User-Klick auf "Abgeben").
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 1500));
  const modalEl = document.querySelector(".modal-container .iserv-exercise-details");
  A.A1_detail_modal_dom = modalEl ? 1 : 0;
  if (modalEl) {
    const title = modalEl.querySelector(".iserv-exercise-details-title")?.textContent || "";
    const meta = modalEl.querySelector(".iserv-exercise-details-meta")?.textContent || "";
    A.A2_title_and_meta =
      (title.includes(task.name) && (meta.includes(task.subject) || meta.includes(task.dueDate))) ? 1 : 0;
    const bodyEl = modalEl.querySelector(".iserv-exercise-details-body");
    const injections = bodyEl
      ? bodyEl.querySelectorAll("script, iframe, object, embed").length +
        [...bodyEl.querySelectorAll("*")].filter((n) =>
          [...n.attributes].some((at) => /^on/i.test(at.name) || (/^(href|src)$/i.test(at.name) && /^\s*javascript:/i.test(at.value)))
        ).length
      : -1;
    A.A3_sanitized_body = injections === 0 ? 1 : 0;
    detail.injectionCount = injections;
    const ta = modalEl.querySelector(".iserv-exercise-details-textarea");
    const cb = modalEl.querySelector(".iserv-exercise-details-confirm input, input.iserv-exercise-details-confirm");
    const cbInput = cb && cb.type === "checkbox" ? cb : (modalEl.querySelector(".iserv-exercise-details-confirm input[type=checkbox]"));
    const btn = modalEl.querySelector(".iserv-exercise-details-btn");
    detail.submitUi = { ta: !!ta, cb: !!cbInput, btn: !!btn, btnDisabledNoConfirm: btn ? btn.disabled : null };
    A.A4_submit_ui_disabled_without_confirm =
      (ta && cbInput && btn && btn.disabled === true) ? 1 : 0;

    // --- A5: Submit-UI Funktionen beweisen — OHNE echte Abgabe (rhino-Forderung:
    //     der finale Abgabe-POST passiert nur beim USER-Klick im echten Modal).
    if (ta && cbInput && btn) {
      const textEl = ta;
      textEl.value = "Abgabe aus Obsidian (Live-Check " + new Date().toISOString() + ")";
      textEl.dispatchEvent(new Event("input", { bubbles: true }));
      cbInput.checked = true;
      cbInput.dispatchEvent(new Event("change", { bubbles: true }));
      const btnEnabled = btn.disabled === false;
      const statusEl = modalEl.querySelector(".iserv-exercise-details-status")?.textContent || "";
      detail.a5 = { btnEnabled, statusLine: statusEl };
      // Bewusst KEIN btn.click(): es wird KEIN Abgabe-POST ausgeführt.
      A.A5_submit_ui_armed_no_write =
        (btnEnabled && statusEl !== "") ? 1 : 0;
      // Aufräumen: Checkbox zurück (Modal geht ohnehin zu) — kein Seiteneffekt.
      cbInput.checked = false;
      cbInput.dispatchEvent(new Event("change", { bubbles: true }));
      textEl.value = "";
    } else {
      A.A5_submit_ui_armed_no_write = 0;
      detail.why = "Submit-UI unvollstaendig (ta/cb/btn)";
    }
  }
  A.A6_no_window_open = openCalls.length === 0 ? 1 : 0;
  detail.openCalls = openCalls;

  // Aufräumen: Detail-Modal schließen (ESC) — kein IServ-Side-Effect (A5 hat
  // bewusst NICHT abgesendet).
  const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(esc);
  document.querySelector(".modal-close-button")?.click();
} catch (err) {
  detail.error = String((err && err.message) || err);
} finally {
  window.open = origOpen;
}

const fails = Object.keys(A).filter((k) => /^A\d/.test(k) && A[k] === 0);
return JSON.stringify({ PASS: fails.length === 0, failed: fails, A, detail });
})();
return __verify;


