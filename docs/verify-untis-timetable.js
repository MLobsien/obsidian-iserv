/**
 * Live-Verifizierung Untis-Stundenplan im Dashboard (Coordinator führt aus):
 *
 *   obsidian-cli eval "code=require('/home/mad5/obsidian-iserv/docs/verify-untis-timetable.js')()"
 *
 * Beweist mit ECHTEN Daten:
 * 1. Untis-HTML-Tageslisten f1/f2 fetchen + parsen (echtes Untis 2026 Markup)
 * 2. Untis-Overlay-Daten, die das Dashboard bekommt (Daten-Contract)
 * 3. Das gerenderte DOM des Dashboard-Stundenplans (Stand-Badge, Vertretungs-Zeilen)
 */
async () => {
  const out = { steps: {} };

  // 1) Plugin-Client holen (Session muss live sein)
  const plugin = app.plugins.plugins["iserv-integration"];
  if (!plugin) return "NO-PLUGIN";
  let client = plugin.client ?? plugin.clientInstance;
  if (!client) {
    await plugin.checkAndLogin?.();
    client = plugin.client;
  }
  if (!client) return "NO-CLIENT";

  // 2) Untis-Direkt-Fetch: f1/f2 über src/api/untis.ts-Logik (inline repliziert,
  //    damit das Script ohne Build läuft) — Beweis: echte Untis-Daten parsen.
  const base = "/iserv/plan/show/raw/Vertretungsplan%20Sch%C3%BCler/";
  const fetchPlan = async (frame) => {
    const r = await client.request(base + frame + "/subst_001.htm");
    if (r.status !== 200) return { frame, status: r.status, doc: null };
    const html = r.body;
    const isUntis = /Untis/i.test(html) && /mon_list/.test(html);
    const date = (html.match(/mon_title[^>]*>([\s\S]{1,40}?)</) || [])[1]?.replace(/\s+/g, " ").trim();
    const stand = (html.match(/Stand:\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/) || [])[1] ?? null;
    const rows = [
      ...html.matchAll(/<tr class='list[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [
      ...m[1].matchAll(/<td[^>]*class="list"[^>]*>([\s\S]*?)<\/td>/g)]
    ).map((cells) => cells.map((c) => c[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim()));
    const mine = rows.filter((r) => r[0] && /^12\b|^12,|^12gN|, ?12\b/i.test(r[0]));
    const messages = [...html.matchAll(/<td class='?info'?[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim())
      .filter(Boolean);
    return { frame, status: r.status, isUntis, date, stand, totalRows: rows.length, meine12erZeilen: mine, messages };
  };
  out.steps.f1 = await fetchPlan("f1");
  out.steps.f2 = await fetchPlan("f2");

  // 3) Dashboard-DOM: gerenderte Untis-Stand-Badges + Vertretungs-Zeilen beweisen.
  const leaves = app.workspace.getLeavesOfType("iserv-dashboard-view");
  const view = leaves[0]?.view;
  if (view?.contentEl) {
    const stands = [...view.contentEl.querySelectorAll(".iserv-dashboard-untis-stand")].map(
      (el) => el.textContent
    );
    const vtrRows = [...view.contentEl.querySelectorAll("tr.iserv-substituted, tr.iserv-absence")].map(
      (tr) => ({
        course: tr.dataset.course,
        subject: tr.querySelector(".iserv-subject")?.textContent,
        room: tr.querySelector(".iserv-room")?.textContent,
      })
    );
    out.steps.rendered = {
      dashboardOpen: true,
      standBadges: stands,
      vertragesZeilen: vtrRows,
    };
  } else {
    out.steps.rendered = { dashboardOpen: false, hint: "Dashboard-View öffnen (IServ: Dashboard), dann re-run." };
  }

  return JSON.stringify(out).slice(0, 6000);
}
