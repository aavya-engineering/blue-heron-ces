// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AssessorViewHtml — renders the composed AssessorView as a self-contained, offline HTML page.
// Pivotable primary axis (Objective / Practice / Family / Approach / Persona / Status), filter, and
// a drill-in panel that clicks straight into evidence (WORM), SSP narrative, mission steps, SPRS,
// and the POA&M lifecycle. CES brand, light + dark. No external deps.
import type { AssessorView, AdminOpsSection, AdminOpsRowKind } from './AssessorViewComposer.js';

const escHtml = (v: unknown): string =>
  (v == null ? '' : String(v)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const KIND_CLASS: Record<AdminOpsRowKind, string> = {
  executed: 'b-met', executed_not_sat: 'b-not_met', failed: 'b-not_met', denied: 'b-not_met',
  pending: 'b-not_assessed', rejected: 'b-not_met', preview: '',
};

/**
 * W4-EO1 (AE-R5): server-rendered AdminOps section. Each row carries data-ao-kind and
 * data-ao-evidence so the page (and tests) can tell evidence from previews, denials and pending
 * items. Dry runs are shown as previews, never as evidence. Tenant-scoped by the composer.
 */
export function renderAdminOpsSectionHtml(section: AdminOpsSection | undefined): string {
  if (!section) return '';
  const head = '<section id="adminops" class="aosec"><div class="sec">AdminOps executions for this tenant ('
    + section.rows.length + ')</div>'
    + '<p class="muted">Only live, executed, satisfied actions count as evidence. Dry runs are previews. '
    + 'Denied, pending and rejected actions are shown for the record and never count as evidence.</p>';
  if (!section.rows.length) return head + '<div class="ev plain">No AdminOps actions recorded for this tenant.</div></section>';
  const rows = section.rows.map(r =>
    '<tr class="ao-row ao-' + r.kind + '" data-ao-kind="' + r.kind + '" data-ao-evidence="' + (r.isEvidence ? 'true' : 'false') + '"'
    + ' data-command="' + escHtml(r.commandId) + '">'
    + '<td><span class="badge ' + KIND_CLASS[r.kind] + '">' + escHtml(r.label) + '</span></td>'
    + '<td class="mono">' + escHtml(r.commandId) + '</td>'
    + '<td class="mono">' + r.controlIds.map(escHtml).join(', ') + '</td>'
    + '<td>' + escHtml(r.outcome) + '</td>'
    + '<td>' + escHtml(r.mode === 'dry_run' ? 'dry run (preview)' : r.mode) + '</td>'
    + '<td class="mono">' + escHtml(r.correlationId ?? '—') + '</td>'
    + '<td class="mono">' + escHtml(r.timestamp) + '</td>'
    + '<td>' + escHtml(r.approverUPN ?? '—') + '</td>'
    + '</tr>').join('');
  return head + '<div class="aotable"><table><thead><tr><th>Status</th><th>Command</th><th>Controls</th><th>Outcome</th>'
    + '<th>Mode</th><th>Correlation id</th><th>Timestamp</th><th>Approver</th></tr></thead><tbody>'
    + rows + '</tbody></table></div></section>';
}

export function renderAssessorHtml(view: AssessorView): string {
  const payload = JSON.stringify(view).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CES · Assessor Determination Viewer</title>
<style>
  /* CES "Instrument" Design Language v2 — token VALUES inlined literally.
     This report must stay self-contained and offline (no stylesheet link, no font
     @import), so it carries the values rather than the --co-* names. Canonical
     source: ces-shared/ui/ces-ui.css — keep the two in step when tokens change.
     Local var NAMES are unchanged so the JS below (var(--sat), var(--other))
     keeps resolving. Contrast annotations mirror the canonical file. */
  :root{ --navy:#1b2a4a;          /* header fill — white text 13.5:1 */
    --designation:#502b85;        /* CUI-banner purple keel — constant across themes */
    --fill:#1b2a4a;               /* filled-control bg under white text */
    --heron:#4a6fa5;              /* link/accent text — 5.11:1 on #ffffff */
    --gold:#f5b74a;               /* brand gold — 7.96:1 on the navy header */
    --bg:#f4f6f9; --card:#ffffff; --ink:#0f172a; --muted:#55647a;
    --line:#7c8ba1; --hover:#edf1f7;
    --sat:#047857;  --sat-bg:#dcfce7;
    --other:#b91c1c; --other-bg:#fee2e2;
    --na:#b45309;   --na-bg:#fef3c7;
    --skip:#55647a; --skip-bg:#eef1f5;
    --radius:0px;
    --font-sans:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    --font-display:'Barlow Condensed','Arial Narrow','Helvetica Neue Condensed',sans-serif;
    --font-mono:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace; }
  /* Dark: same names, different values. Filled surfaces take the DEEP shades —
     the light tints here are tuned as TEXT on dark bg and fail under white text. */
  html[data-theme="dark"]{ --navy:#0d1526; --fill:#2a4370; --heron:#7ea0d6;
    --bg:#0b1220; --card:#121c2e; --ink:#f2f6fc; --muted:#96a6bd;
    --line:#3a4e6e; --hover:#1a2c4a;
    --sat:#34d399;  --sat-bg:#064e3b;
    --other:#fca5a5; --other-bg:#7f1d1d;
    --na:#fbbf24;   --na-bg:#78350f;
    --skip:#96a6bd; --skip-bg:#1c2a44; }
  *{box-sizing:border-box} body{margin:0;font-family:var(--font-sans);font-size:14px;line-height:1.5;background:var(--bg);color:var(--ink)}
  header{background:var(--navy);color:#fff;padding:18px 26px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-bottom:2px solid var(--designation)}
  header .brand{font-family:var(--font-display);text-transform:uppercase;letter-spacing:.03em;font-weight:700;font-size:22px}
  header .brand small{display:block;font-family:var(--font-sans);text-transform:none;letter-spacing:0;font-weight:400;font-size:12px;opacity:.85}
  header .meta{margin-left:auto;text-align:right;font-size:13px;opacity:.92}
  .themebtn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:var(--gold);border-radius:var(--radius);padding:6px 14px;cursor:pointer;font-family:var(--font-sans);font-size:13px}
  main{max-width:1200px;margin:0 auto;padding:22px 20px 60px}
  .kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:12px 16px;min-width:120px}
  .kpi .n{font-size:24px;font-weight:700;line-height:1} .kpi .l{font-family:var(--font-display);font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-top:5px}
  .kpi.blk .n{color:var(--other)}
  .controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
  .axis{display:flex;gap:4px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:4px}
  .axis button{border:none;background:none;color:var(--muted);padding:7px 13px;border-radius:var(--radius);cursor:pointer;font-family:var(--font-sans);font-size:13px;font-weight:600}
  .axis button.on{background:var(--fill);color:#fff}
  #q{flex:1;min-width:200px;padding:9px 13px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);color:var(--ink);font-family:var(--font-sans);font-size:14px}
  .group{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:10px;overflow:hidden}
  .ghead{padding:11px 15px;display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600;font-size:14px}
  .ghead:hover{background:var(--hover)} .ghead .c{margin-left:auto;font-weight:400;color:var(--muted);font-size:12px}
  .gbody{display:none;border-top:1px solid var(--line)} .group.open .gbody{display:block}
  .row{padding:9px 15px 9px 26px;display:flex;align-items:center;gap:10px;cursor:pointer;border-bottom:1px solid var(--line);font-size:13.5px}
  .row:last-child{border-bottom:none} .row:hover{background:var(--hover)}
  .row .id{font-weight:600;font-family:var(--font-mono);white-space:nowrap}
  .row .t{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  /* Badges follow the Instrument .badge-* idiom: square, tint bg + semantic text
     (never white on a solid fill — that is what failed AA in dark mode). */
  .badge{display:inline-block;padding:2px 9px;border-radius:var(--radius);font-size:11px;font-weight:600;white-space:nowrap;background:var(--skip-bg);color:var(--skip)}
  .b-satisfied,.b-met{background:var(--sat-bg);color:var(--sat)} .b-other_than_satisfied,.b-not_met{background:var(--other-bg);color:var(--other)}
  .b-not_assessed{background:var(--na-bg);color:var(--na)} .b-partial{background:linear-gradient(135deg,var(--sat-bg) 50%,var(--na-bg) 50%);color:var(--ink)}
  .blkchip{background:var(--other-bg);color:var(--other);border-radius:var(--radius);font-size:10px;font-weight:700;padding:1px 6px;margin-left:2px}
  .src{font-size:10px;color:var(--heron);border:1px solid var(--heron);border-radius:var(--radius);padding:1px 6px}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:flex-start;justify-content:center;padding:38px 16px;overflow:auto;z-index:50}
  .overlay.open{display:flex} .modal{background:var(--card);border-radius:var(--radius);max-width:820px;width:100%;border:1px solid var(--line);box-shadow:0 4px 16px rgba(0,0,0,.10)}
  .modal h3{margin:0;padding:16px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;font-size:16px;font-family:var(--font-mono)}
  .modal .x{margin-left:auto;cursor:pointer;font-size:22px;color:var(--muted);background:none;border:none} .modal .body{padding:18px 22px}
  .kv{display:grid;grid-template-columns:150px 1fr;gap:6px 14px;font-size:14px;margin:8px 0} .kv .k{color:var(--muted)}
  .sec{margin:16px 0 6px;font-family:var(--font-display);font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:5px}
  .ev{display:block;padding:8px 11px;border:1px solid var(--line);border-radius:var(--radius);margin:6px 0;font-size:13px}
  .ev a{color:var(--heron);text-decoration:none;font-family:var(--font-mono)} .ev .worm{font-size:11px;color:var(--sat);margin-left:8px}
  .ev.plain{color:var(--muted)}
  .method{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:var(--radius);padding:1px 7px;margin:0 3px 3px 0;color:var(--muted)}
  .narr{font-size:13.5px;background:var(--hover);border-left:3px solid var(--designation);padding:9px 12px;border-radius:var(--radius);white-space:pre-wrap}
  .poam{font-size:13px;border:1px solid var(--line);border-radius:var(--radius);padding:9px 12px} .poam.closed{border-color:var(--sat)}
  a.tealref{color:var(--heron);cursor:pointer} .muted{color:var(--muted)}
  .aosec{margin:0 0 18px} .aotable{overflow-x:auto;background:var(--card);border:1px solid var(--line)}
  .aotable table{border-collapse:collapse;width:100%;font-size:12.5px} .aotable th,.aotable td{padding:6px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  .aotable th{font-family:var(--font-display);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
  .mono{font-family:var(--font-mono)} tr.ao-preview td{color:var(--muted);font-style:italic}
</style></head>
<body>
<header>
  <div class="brand">CES · Assessor Determination Viewer<small>Unified objectives · approach · evidence — CMMC 2.0 Level 2</small></div>
  <div class="meta" id="meta"></div>
  <button class="themebtn" onclick="tt()">◐ Theme</button>
</header>
<main>
  <div class="kpis" id="kpis"></div>
  ${renderAdminOpsSectionHtml(view.adminOps)}
  <div class="controls">
    <div class="axis" id="axis"></div>
    <input id="q" placeholder="filter by id, statement, narrative…" oninput="render()">
  </div>
  <div id="list"></div>
</main>
<div class="overlay" id="ov" onclick="if(event.target===this)cl()"><div class="modal"><h3 id="mt"></h3><div class="body" id="mb"></div></div></div>
<script id="data" type="application/json">${payload}</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent);
const objById={},ctlById={}; for(const o of D.objectives)objById[o.objectiveId]=o; for(const c of D.controls)ctlById[c.controlId]=c;
function esc(s){return(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
const FAM={AC:'Access Control',AT:'Awareness & Training',AU:'Audit & Accountability',CM:'Config Mgmt',IA:'Identification & Auth',IR:'Incident Response',MA:'Maintenance',MP:'Media Protection',PS:'Personnel Security',PE:'Physical Protection',RA:'Risk Assessment',CA:'Security Assessment',SC:'System & Comms Protection',SI:'System & Info Integrity'};
const SRC={'tenant-suite':'tenant test probe','digital-signal':'automated tenant signal',personnel:'personnel screening',training:'awareness training',policy:'signed policy',disposition:'mission-plan disposition',none:'not yet assessed'};

document.getElementById('meta').innerHTML='Tenant <b>'+esc(D.tenantId)+'</b><br>SPRS '+D.sprs.score+' / 110 · '+new Date(D.generatedAt).toLocaleString();
document.getElementById('kpis').innerHTML=[
  ['SPRS score',D.sprs.score,''],['Objectives',D.summary.objectivesTotal,''],
  ['Satisfied',D.summary.objectivesSatisfied,''],['Deficiencies',D.summary.deficiencies,''],
  ['Cert-blockers',D.summary.certificationBlockers,D.summary.certificationBlockers?'blk':''],
  ['Open POA&M',D.summary.openPoamItems,''],['Auto-closed',D.summary.autoClosedPoamItems,''],['Evidence refs',D.summary.evidenceRefs,'']
].map(([l,n,cl])=>'<div class="kpi '+cl+'"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');

// ---- axes: each returns groups [{key,label,count,items:[{type,id,label,status,extra}]}] ----
const AXES={
  Objective:()=>groupBy(D.objectives.map(o=>leafO(o)),i=>i.ctl,k=>k+' · '+esc(ctlById[k]?ctlById[k].status:'')),
  Practice:()=>[{key:'all',label:'All 110 practices',items:D.controls.map(c=>leafC(c))}],
  Family:()=>groupBy(D.controls.map(c=>leafC(c)),i=>i.fam,k=>k+' — '+(FAM[k]||'')),
  Approach:()=>groupBy(D.objectives.map(o=>leafO(o)),i=>i.src,k=>SRC[k]||k),
  Persona:()=>{const g={};for(const c of D.controls)for(const p of c.personas){(g[p]=g[p]||[]).push(leafC(c))}return Object.keys(g).sort().map(k=>({key:k,label:k,items:g[k]}))},
  Status:()=>groupBy(D.objectives.map(o=>leafO(o)),i=>i.status,k=>k.replace(/_/g,' '))
};
function leafO(o){return{type:'obj',id:o.objectiveId,ctl:o.controlId,fam:o.family,src:o.source,status:o.status,blk:o.certificationBlocker,label:o.statement,hay:(o.objectiveId+' '+o.statement).toLowerCase()}}
function leafC(c){return{type:'ctl',id:c.controlId,ctl:c.controlId,fam:c.family,src:'',status:c.status,blk:c.certificationBlocker,label:(c.narrative||'').slice(0,120)||FAM[c.family],hay:(c.controlId+' '+(c.narrative||'')).toLowerCase()}}
function groupBy(items,keyf,labelf){const g={};for(const it of items){const k=keyf(it);(g[k]=g[k]||[]).push(it)}return Object.keys(g).sort().map(k=>({key:k,label:labelf(k),items:g[k]}))}

let axis='Objective';
document.getElementById('axis').innerHTML=Object.keys(AXES).map(a=>'<button class="'+(a===axis?'on':'')+'" onclick="setAxis(\\''+a+'\\')">'+a+'</button>').join('');
function setAxis(a){axis=a;document.querySelectorAll('.axis button').forEach(b=>b.classList.toggle('on',b.textContent===a));render()}

function render(){
  const q=(document.getElementById('q').value||'').toLowerCase().trim();
  const groups=AXES[axis]();
  document.getElementById('list').innerHTML=groups.map((g,gi)=>{
    const items=q?g.items.filter(i=>i.hay.includes(q)):g.items;
    if(!items.length)return'';
    const rows=items.map(i=>'<div class="row" onclick="open'+(i.type==='obj'?'O':'C')+'(\\''+esc(i.id)+'\\')">'+
      '<span class="badge b-'+i.status+'">'+i.status.replace(/_/g,' ')+'</span>'+
      '<span class="id">'+esc(i.id)+'</span>'+(i.blk?'<span class="blkchip">5pt</span>':'')+
      (i.src?'<span class="src">'+esc(SRC[i.src]||i.src)+'</span>':'')+
      '<span class="t">'+esc(i.label)+'</span></div>').join('');
    const open=q?'open':(gi<2?'open':'');
    return'<div class="group '+open+'"><div class="ghead" onclick="this.parentNode.classList.toggle(\\'open\\')">'+esc(g.label)+
      '<span class="c">'+items.length+'</span></div><div class="gbody">'+rows+'</div></div>';
  }).join('')||'<p class="muted">No matches.</p>';
}

function evHtml(e){ if(e.wormVerifiable)return'<div class="ev"><a href="'+e.href+'" target="_blank">'+esc(e.label)+'</a><a class="worm" href="'+e.verifyHref+'" target="_blank">✓ verify (WORM)</a></div>';
  return'<div class="ev plain">'+esc(e.label)+' <span class="muted">(reference — not a resolvable WORM artifact)</span></div>'; }
function poamHtml(p){ if(!p)return''; const cls=p.status==='closed'?'closed':''; return'<div class="sec">POA&M lifecycle</div><div class="poam '+cls+'">'+
  '<b>'+p.status.toUpperCase()+'</b>'+(p.autoClosed?' <span class="worm" style="color:var(--sat)">auto-closed on remediation</span>':'')+
  '<br>opened '+esc(p.openedAt)+(p.closedAt?' · closed '+esc(p.closedAt):' · last seen '+esc(p.lastSeenAt))+' · '+p.historyDepth+' event(s)</div>'; }
function ctlBlock(c){ if(!c)return''; let h='';
  if(c.narrative){h+='<div class="sec">SSP implementation narrative</div><div class="narr">'+esc(c.narrative)+'</div>';}
  h+='<div class="sec">Evidence ('+c.evidence.length+') · WORM</div>'+(c.evidence.length?c.evidence.map(evHtml).join(''):'<div class="ev plain">No evidence references on this control yet.</div>');
  if(c.missionSteps.length){h+='<div class="sec">Approach — mission-plan steps</div>'+c.missionSteps.map(s=>'<div class="ev">'+esc(s.what)+(s.owner?' <span class="muted">— '+esc(s.owner)+'</span>':'')+'</div>').join('');}
  if(c.adminOps&&c.adminOps.length){h+='<div class="sec">AdminOps actions ('+c.adminOps.length+')</div>'+c.adminOps.map(r=>'<div class="ev'+(r.isEvidence?'':' plain')+'"><span class="badge">'+esc(r.label)+'</span> <span class="mono">'+esc(r.commandId)+'</span> · '+esc(r.outcome)+' · '+esc(r.correlationId||'—')+' · '+esc(r.timestamp)+(r.approverUPN?' · approver '+esc(r.approverUPN):'')+'</div>').join('');}
  if(c.personas.length){h+='<div class="sec">Owned by personas</div><div>'+c.personas.map(p=>'<span class="method">'+esc(p)+'</span>').join('')+'</div>';}
  return h; }

function openO(id){const o=objById[id];const c=ctlById[o.controlId];
  document.getElementById('mt').innerHTML=esc(o.objectiveId)+(o.certificationBlocker?' <span class="blkchip">5pt cert-blocker</span>':'')+'<button class="x" onclick="cl()">×</button>';
  let h='<div class="kv"><div class="k">Determination</div><div>'+esc(o.statement)+'</div>'+
    '<div class="k">Methods</div><div>'+o.methods.map(m=>'<span class="method">'+esc(m)+'</span>').join('')+'</div>'+
    '<div class="k">Status</div><div><span class="badge b-'+o.status+'">'+o.status.replace(/_/g,' ')+'</span></div>'+
    '<div class="k">Provenance</div><div>'+esc(SRC[o.source]||o.source)+' — '+esc(o.rationale)+'</div>'+
    '<div class="k">Practice</div><div><a class="tealref" onclick="openC(\\''+esc(o.controlId)+'\\')">'+esc(o.controlId)+'</a> · SPRS weight '+o.weight+'</div></div>';
  h+=poamHtml(o.poam)+ctlBlock(c);
  document.getElementById('mb').innerHTML=h;document.getElementById('ov').classList.add('open');}
function openC(id){const c=ctlById[id];
  document.getElementById('mt').innerHTML=esc(c.controlId)+(c.certificationBlocker?' <span class="blkchip">5pt</span>':'')+'<button class="x" onclick="cl()">×</button>';
  let h='<div class="kv"><div class="k">Family</div><div>'+esc(c.family)+' — '+esc(FAM[c.family]||'')+'</div>'+
    '<div class="k">Status</div><div><span class="badge b-'+c.status+'">'+c.status.replace(/_/g,' ')+'</span>'+(c.disposition?' <span class="method">'+esc(c.disposition)+'</span>':'')+'</div>'+
    '<div class="k">SPRS</div><div>weight '+c.weight+' · '+(c.pointsAtRisk?('<b style="color:var(--other)">'+c.pointsAtRisk+' pts at risk</b>'):'0 at risk (met)')+'</div>'+
    '<div class="k">Determinations</div><div>'+c.objectiveIds.map(oid=>'<a class="tealref" onclick="openO(\\''+esc(oid)+'\\')">'+esc(oid.split(/[\\[]/)[1]?('['+oid.split('[')[1]):oid)+'</a>').join(' ')+'</div></div>';
  h+=ctlBlock(c);
  document.getElementById('mb').innerHTML=h;document.getElementById('ov').classList.add('open');}
function cl(){document.getElementById('ov').classList.remove('open')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')cl()});
function tt(){const h=document.documentElement;h.dataset.theme=h.dataset.theme==='dark'?'light':'dark'}
render();
</script></body></html>`;
}
