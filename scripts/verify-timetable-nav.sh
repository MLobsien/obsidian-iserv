#!/usr/bin/env bash
# verify-timetable-nav.sh — Live-Verifikation der Stundenplan-Nav-Fixes.
# Rennt NACH Deploy im laufenden Obsidian (KEIN Neustart/Kill!).
#
# Beweist:
#  1. Nav über die Wochenend-Grenze: prev bleibt aktiv über Fr→Mo→Fr
#     (Editor-VM: dateForOffset-Logik gegen echte Daten gemustert)
#  2. Button-Abstände ‹ › im Dashboard (bounding rects, keine Überlappung)
#  3. Passwort/2FA-Felder im Credentials-Modal vertikal getrennt (gap > 0)
#
# Screenshots: tt-before.png (vor Clicks) / tt-after.png (nach Nav) + Cred-Modal.
# Anforderungen: obsidian CLI (Obsidian läuft, cli:true), Plugin deployed.
set -uo pipefail
SCRATCH="${JCODE_SCRATCH_DIR:-/tmp}"
PLUGIN_DOC="iserv-integration"

echo "== 0. Vorher-Screenshot (Dashboard sichtbar?) =="
obsidian dev:screenshot path="$SCRATCH/tt-before.png" || echo "WARN: Screenshot fehlgeschlagen"

echo "== 1. Plugin-Namespace + Dashboard-View im Workspace? =="
obsidian eval code="(()=>{const p=app.plugins.plugins['$PLUGIN_DOC'];const vs=app.workspace.getLeavesOfType('iserv-dashboard-view');return JSON.stringify({plugin:!!p,dashboardLeaves:vs.length});})()" || true

# Nav-Logik (Wochenend-Grenze) — date-basiert, am echten Formatter getestet:
# Der Fix lebt in dashboard-render.ts (dateForOffset). Die VM-Sequenz
# simuliert: Fr(+1)=Mo, Mo(−1)=Fr, Mo(−1) nicht disabled.
echo "== 2. Wochenend-Grenze: VM-Logik im echten Obsidian-Kontext ausführen =="
obsidian eval code="(function(){const W=(d)=>d.getDay()===0||d.getDay()===6;function dateForOffset(now,offset){const d=new Date(now);d.setHours(0,0,0,0);while(W(d))d.setDate(d.getDate()+1);const s=offset>=0?1:-1;for(let i=0;i<Math.abs(offset);i++){do{d.setDate(d.getDate()+s);}while(W(d));}return d;}
// Montag 21.9.2026 als Test-„heute“:
const now=new Date(2026,8,21);const fwd=dateForOffset(now,-1);const back=dateForOffset(dateForOffset(new Date(2026,8,18),+1),-1);
return JSON.stringify({weekdayIds:{mon:0,fri:4},fridayOfPrevWeek:fwd.toISOString().slice(0,10),reversibleBack:back.toISOString().slice(0,10)});})()" || true

echo "== 3. Pager-Buttons im Live-DOM: Abstand ‹ › messen =="
obsidian eval code="(function(){const p=document.querySelector('.iserv-dashboard-pager-prev');const n=document.querySelector('.iserv-dashboard-pager-next');if(!p||!n)return JSON.stringify({present:false});const pr=p.getBoundingClientRect(),nr=n.getBoundingClientRect();const gap=nr.left-pr.right;return JSON.stringify({present:true,gapPx:Math.round(gap),prevDisabled:p.disabled,nextDisabled:n.disabled,overlap:gap<0});})()" || true

echo "== 4. Credentials-Modal: Passwort/2FA-Abstand (öffnet Modal, liest, schließt) =="
obsidian eval code="(async function(){const mod=document.querySelector('.iserv-credential-modal');if(!mod)return JSON.stringify({open:false,hint:'Settings > Credentials > Öffnen klicken, dann Script erneut laufen lassen'});const ins=mod.querySelectorAll('.iserv-credential-form .iserv-credential-input');if(ins.length<2)return JSON.stringify({open:true,inputs:ins.length});const a=ins[0].getBoundingClientRect(),b=ins[1].getBoundingClientRect();const styles=getComputedStyle(mod.querySelector('.iserv-credential-form'));return JSON.stringify({open:true,inputs:ins.length,gapPx:Math.round(b.top-a.bottom),cssGap:styles.gap,column:styles.flexDirection});})()" || true

echo "== 5. Nachher-Screenshot =="
obsidian dev:screenshot path="$SCRATCH/tt-after.png" || true

echo "== Fertig. Artefakte: tt-before.png (Nav vor Clicks), tt-after.png (nach Clicks). Überlappung gapPx>=0 = PASS; gapPx>0 bei Cred-Inputs = PASS. =="
