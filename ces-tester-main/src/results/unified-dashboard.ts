// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { embedJson } from './dashboard-generator.js';

/**
 * GP-DEMO-1 P1-4 — the unified before->after SPRS dashboard: the demo's
 * climactic single screen showing the SPRS needle moving, which the run-level
 * results dashboard (dashboard-generator.ts) deliberately does not provide
 * (that one is per-run scenario pass/fail; this one is the tenant-level
 * compliance-posture story). Same house style: self-contained, offline,
 * data inlined at generation time (`ces-tester demo:dashboard`).
 */

export type FindingStatus = 'met' | 'not_met' | 'partial' | 'not_assessed';
export type BeatStatus = 'pass' | 'fail' | 'staged';

export interface UnifiedDemoResult {
  tenant: string;
  /** ISO timestamp — passed in by the caller, never computed here. */
  generatedAt: string;
  /** GP-DEMO-1 iter5 one-SPRS rule: when the SPRS shown is EO's control-detail
   * score (not the certified Muster headline), this note is rendered under
   * the gauge so the number is never mistaken for the certified score. */
  sprsLabel?: string;
  sprs: { before: number; after: number; max: number };
  controls: { total: number; metBefore: number; metAfter: number };
  findings: Array<{
    control: string;
    title: string;
    statusBefore: FindingStatus;
    statusAfter: FindingStatus;
  }>;
  evidence: Array<{ name: string; kind: string; sha256?: string }>;
  beats: Array<{ id: number; label: string; status: BeatStatus; artifactRef?: string }>;
}

/**
 * Realistic demo-dib-small sample so `demo:dashboard` is runnable before the
 * live pipeline populates real data. Deliberately honest: the after-score is
 * a projection (91/110), not a perfect 110/110, and one finding remains
 * not_met after remediation.
 */
export const SAMPLE_UNIFIED_RESULT: UnifiedDemoResult = {
  tenant: 'demo-dib-small',
  generatedAt: '2026-07-28T00:00:00.000Z',
  sprs: { before: 39, after: 91, max: 110 },
  controls: { total: 110, metBefore: 61, metAfter: 94 },
  findings: [
    { control: '3.5.3', title: 'Multifactor Authentication', statusBefore: 'not_met', statusAfter: 'met' },
    { control: '3.13.11', title: 'Cryptographic Protection (FIPS-validated)', statusBefore: 'partial', statusAfter: 'met' },
    { control: '3.1.1', title: 'Limit System Access to Authorized Users', statusBefore: 'met', statusAfter: 'met' },
    { control: '3.4.2', title: 'Security Configuration Enforcement', statusBefore: 'not_met', statusAfter: 'partial' },
    { control: '3.3.1', title: 'Audit Logging', statusBefore: 'partial', statusAfter: 'met' },
    { control: '3.11.2', title: 'Vulnerability Scanning', statusBefore: 'not_met', statusAfter: 'not_met' },
  ],
  evidence: [
    { name: 'ssp-export-v1.pdf', kind: 'SSP export', sha256: 'be2634e9a008eb6f7dbe4c968499fc2b1c35aa451127e6c5e377bf4fe93d2ee7' },
    { name: 'poam-export-v1.pdf', kind: 'POA&M export', sha256: '708ef467ba18739f4da319d7952d53e8ebc018a14fa0fbe6887d1aafb836abe2' },
    { name: 'mfa-config-evidence.json', kind: 'MFA configuration snapshot', sha256: '40bf908d6213ac18dd087c5282115ccd46b23d162045ace065e83a4f2ee7d3c0' },
    { name: 'assessor-notes.txt', kind: 'assessor annotation', },
  ],
  beats: [
    { id: 0, label: 'seed tenant-stacksim demo profile (demo-dib-small) -> serve :4390', status: 'pass' },
    { id: 1, label: 'drive Muster wizard: assess -> discovery(sim) -> computeSprs -> export', status: 'pass' },
    { id: 2, label: 'Stamper apply+verify against :4390 (ledger-recorded)', status: 'pass', artifactRef: 'runs/demo/ledger-snapshot.json' },
    { id: 3, label: 'EO connect+assess + assessor-view/SSP/POA&M', status: 'staged' },
    { id: 4, label: 'unified results dashboard (before->after SPRS)', status: 'staged' },
  ],
};

export function renderUnifiedDashboard(r: UnifiedDemoResult): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${r.tenant} — Unified SPRS Dashboard</title>
<style>
  :root{
    --bg:#0a1930; --panel:#10233f; --raised:#142a4a; --panel-2:#0d1e37;
    --line:#1e3a5c; --accent:#3b9bff; --amber:#ffb454; --green:#3ddc97;
    --bad:#ff7597; --ink:#dce8f7; --muted:#9db2cc; --dim:#93a8c4;
  }
  @media (prefers-color-scheme: light){
    :root{
      --bg:#f4f7fb; --panel:#ffffff; --raised:#eef2f8; --panel-2:#f8fafc;
      --line:#d7e0ec; --accent:#1f6fd6; --amber:#b9720a; --green:#178a56;
      --bad:#c02851; --ink:#152238; --muted:#4c5c74; --dim:#5c6c82;
    }
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{background:var(--bg);color:var(--ink);font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;font-size:15px;line-height:1.45;}
  .wrap{max-width:1200px;margin:0 auto;padding:14px 26px 40px;}
  .eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.9px;color:var(--accent);font-weight:700;}
  .num{font-variant-numeric:tabular-nums;}
  header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;}
  header h1{font-size:21px;font-weight:600;margin:0;letter-spacing:.2px;}
  header h1 .ces{color:var(--accent);}
  .meta{color:var(--muted);font-size:12.5px;}
  .meta strong{color:var(--ink);}
  .dimnote{color:var(--dim);font-size:11.5px;margin:4px 0 14px;}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.8px;color:var(--accent);margin:26px 0 10px;}

  .sprs-panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:20px 24px;margin:14px 0;}
  .sprs-values{display:flex;align-items:baseline;gap:22px;flex-wrap:wrap;}
  .sprs-value{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;}
  .sprs-value .big{display:block;font-size:38px;font-weight:700;color:var(--ink);line-height:1.1;margin-top:2px;}
  .sprs-delta{font-size:20px;font-weight:700;padding:4px 12px;border-radius:6px;}
  .sprs-delta.up{color:var(--green);border:1px solid var(--green);}
  .gauge{position:relative;height:22px;border-radius:11px;background:var(--raised);border:1px solid var(--line);margin-top:16px;overflow:hidden;}
  .gauge .fill-before{position:absolute;top:0;left:0;bottom:0;background:var(--muted);opacity:.55;}
  .gauge .fill-after{position:absolute;top:0;left:0;bottom:0;background:var(--accent);}
  .gauge .marker{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink);}
  .gauge-labels{display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-top:4px;}

  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0;}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 16px;}
  .tile .big{font-size:30px;font-weight:700;line-height:1.1;}
  .tile .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-top:2px;}

  table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:13.5px;}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);}
  th{background:var(--raised);font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);}
  tr:last-child td{border-bottom:none;}
  .badge{display:inline-block;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;}
  .badge.met{color:var(--green);border:1px solid var(--green);}
  .badge.partial{color:var(--amber);border:1px solid var(--amber);}
  .badge.notmet{color:var(--bad);border:1px solid var(--bad);}
  .badge.notassessed{color:var(--dim);border:1px solid var(--dim);}
  .sprs-note{font-size:11.5px;color:var(--dim);margin-top:10px;}
  .badge.beat-pass{color:var(--green);border:1px solid var(--green);}
  .badge.beat-fail{color:var(--bad);border:1px solid var(--bad);}
  .badge.beat-staged{color:var(--amber);border:1px solid var(--amber);}
  .mono{font-family:Consolas,monospace;font-size:12.5px;word-break:break-all;}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><span class="ces">${r.tenant}</span> — Unified SPRS Dashboard</h1>
    <span class="meta">generated <strong id="gen-at"></strong></span>
  </header>
  <div class="dimnote">Static snapshot generated by <code>ces-tester demo:dashboard</code>. Fully offline; the after-score is a projection, not a certified assessment.</div>

  <div class="eyebrow">SPRS score</div>
  <div class="sprs-panel">
    <div class="sprs-values">
      <div class="sprs-value">Before<span class="big num" id="sprs-before"></span></div>
      <div class="sprs-value">After<span class="big num" id="sprs-after"></span></div>
      <div class="sprs-delta up num" id="sprs-delta"></div>
      <div class="sprs-value" style="margin-left:auto">Max<span class="big num" id="sprs-max"></span></div>
    </div>
    <div class="gauge">
      <div class="fill-before" id="gauge-before"></div>
      <div class="fill-after" id="gauge-after"></div>
      <div class="marker" id="gauge-marker-before"></div>
      <div class="marker" id="gauge-marker-after"></div>
    </div>
    <div class="gauge-labels"><span>0</span><span id="gauge-max-label"></span></div>
    <div class="sprs-note" id="sprs-note" style="display:none"></div>
  </div>

  <div class="eyebrow">Controls met</div>
  <div class="tiles" id="control-tiles"></div>

  <h2>Findings — before vs after</h2>
  <table id="findings-table">
    <thead><tr><th>Control</th><th>Title</th><th>Before</th><th>After</th></tr></thead>
    <tbody></tbody>
  </table>

  <h2>Evidence</h2>
  <table id="evidence-table">
    <thead><tr><th>Name</th><th>Kind</th><th>SHA-256</th></tr></thead>
    <tbody></tbody>
  </table>

  <h2>Demo beats</h2>
  <table id="beats-table">
    <thead><tr><th>#</th><th>Label</th><th>Status</th><th>Artifact</th></tr></thead>
    <tbody></tbody>
  </table>
</div>
<script id="unified-data" type="application/json">__DATA__</script>
<script>
(function(){
  var DATA = JSON.parse(document.getElementById('unified-data').textContent);
  var esc = function(s){ var d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; };
  var statusCls = function(s){ return s==='met'?'met':(s==='partial'?'partial':(s==='not_assessed'?'notassessed':'notmet')); };
  var statusLbl = function(s){ return s==='met'?'met':(s==='partial'?'partial':(s==='not_assessed'?'not assessed':'not met')); };

  document.getElementById('gen-at').textContent = DATA.generatedAt;
  if (DATA.sprsLabel) {
    var note = document.getElementById('sprs-note');
    note.textContent = DATA.sprsLabel;
    note.style.display = '';
  }

  document.getElementById('sprs-before').textContent = DATA.sprs.before;
  document.getElementById('sprs-after').textContent = DATA.sprs.after;
  document.getElementById('sprs-max').textContent = DATA.sprs.max;
  var delta = DATA.sprs.after - DATA.sprs.before;
  document.getElementById('sprs-delta').textContent = (delta>=0?'+':'') + delta;
  document.getElementById('gauge-max-label').textContent = DATA.sprs.max;

  var pctBefore = DATA.sprs.max ? Math.max(0, Math.min(100, 100*DATA.sprs.before/DATA.sprs.max)) : 0;
  var pctAfter = DATA.sprs.max ? Math.max(0, Math.min(100, 100*DATA.sprs.after/DATA.sprs.max)) : 0;
  document.getElementById('gauge-before').style.width = pctBefore + '%';
  document.getElementById('gauge-after').style.width = pctAfter + '%';
  document.getElementById('gauge-marker-before').style.left = pctBefore + '%';
  document.getElementById('gauge-marker-after').style.left = pctAfter + '%';

  var tiles = [
    { v: DATA.controls.total, l: 'total controls' },
    { v: DATA.controls.metBefore, l: 'met before' },
    { v: DATA.controls.metAfter, l: 'met after' },
    { v: DATA.controls.metAfter - DATA.controls.metBefore, l: 'delta' },
  ];
  document.getElementById('control-tiles').innerHTML = tiles.map(function(t){
    return '<div class="tile"><div class="big num">'+esc(t.v)+'</div><div class="lbl">'+esc(t.l)+'</div></div>';
  }).join('');

  document.querySelector('#findings-table tbody').innerHTML = DATA.findings.map(function(f){
    return '<tr><td class="mono">'+esc(f.control)+'</td><td>'+esc(f.title)+'</td>'+
      '<td><span class="badge '+statusCls(f.statusBefore)+'">'+esc(statusLbl(f.statusBefore))+'</span></td>'+
      '<td><span class="badge '+statusCls(f.statusAfter)+'">'+esc(statusLbl(f.statusAfter))+'</span></td></tr>';
  }).join('') || '<tr><td colspan="4" class="dimnote">No findings recorded.</td></tr>';

  document.querySelector('#evidence-table tbody').innerHTML = DATA.evidence.map(function(e){
    return '<tr><td>'+esc(e.name)+'</td><td>'+esc(e.kind)+'</td><td class="mono">'+(e.sha256 ? esc(e.sha256) : '—')+'</td></tr>';
  }).join('') || '<tr><td colspan="3" class="dimnote">No evidence recorded.</td></tr>';

  document.querySelector('#beats-table tbody').innerHTML = DATA.beats.map(function(b){
    return '<tr><td class="num">'+esc(b.id)+'</td><td>'+esc(b.label)+'</td>'+
      '<td><span class="badge beat-'+esc(b.status)+'">'+esc(b.status)+'</span></td>'+
      '<td class="mono">'+(b.artifactRef ? esc(b.artifactRef) : '—')+'</td></tr>';
  }).join('');
})();
</script>
</body>
</html>
`.replace('__DATA__', embedJson(r));
}

export async function writeUnifiedDashboard(r: UnifiedDemoResult, outPath: string): Promise<string> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, renderUnifiedDashboard(r), 'utf8');
  return outPath;
}
