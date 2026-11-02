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
import type { ScenarioResult } from './result-shape.js';
import type { RunSummary } from './run-summary.js';
import { scenarioHistories, type ScenarioHistory } from './flaky.js';

/**
 * PLAN.md M4 tasks 2-3: the static, self-contained results dashboard, house
 * style (ces-strategy/competitors/ces-competitive-dashboard.html pattern — no
 * server, no build step, no external assets). Data is INLINED at generation
 * time (Planner's no-backend philosophy; also load-bearing offline: browsers
 * block fetch() of local JSON under file://, so inlining is what makes the
 * "open directly as a file:// URL, fully offline" acceptance gate possible at
 * all). Regenerate after runs with `ces-tester dashboard`.
 */

export interface DashboardData {
  generated_at: string;
  /** Completed + in-flight run summaries, oldest first. */
  runs: RunSummary[];
  /** Full §7.1 results for the LATEST COMPLETED run's scenarios (drill-down). */
  latest_results: ScenarioResult[];
  histories: ScenarioHistory[];
}

/** Reads every runs/<id>/summary.json (plus live.json for runs still in
 * flight — a live.json with no summary.json), oldest first by started_at.
 * Unreadable/malformed entries are skipped, not fatal (runs/ is a working
 * directory, not a curated store). */
export async function collectRunSummaries(runsRoot: string): Promise<RunSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(runsRoot);
  } catch {
    return [];
  }
  const summaries: RunSummary[] = [];
  for (const entry of entries) {
    const dir = path.join(runsRoot, entry);
    for (const name of ['summary.json', 'live.json']) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as RunSummary;
        if (parsed && typeof parsed.run_id === 'string' && Array.isArray(parsed.scenarios)) {
          summaries.push(parsed);
        }
        break; // summary.json wins; live.json only when no summary exists
      } catch {
        // missing or malformed — try the next candidate / skip the run
      }
    }
  }
  return summaries.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

async function readLatestRunResults(runsRoot: string, latest: RunSummary | undefined): Promise<ScenarioResult[]> {
  if (!latest) return [];
  const results: ScenarioResult[] = [];
  for (const s of latest.scenarios) {
    try {
      const p = s.result_path
        ? path.join(runsRoot, ...s.result_path.split('/'))
        : path.join(runsRoot, latest.run_id, s.scenario_id, 'result.json');
      results.push(JSON.parse(await fs.readFile(p, 'utf8')) as ScenarioResult);
    } catch {
      // crash rows have no result.json — drill-down simply omits them
    }
  }
  return results;
}

export async function buildDashboardData(runsRoot: string, now: Date = new Date()): Promise<DashboardData> {
  const runs = await collectRunSummaries(runsRoot);
  const completed = runs.filter((r) => !r.in_progress);
  const latest = completed[completed.length - 1];
  return {
    generated_at: now.toISOString(),
    runs,
    latest_results: await readLatestRunResults(runsRoot, latest),
    histories: scenarioHistories(runs),
  };
}

/** Inline-embed guard: `</script>` (or a stray `<!--`) inside the data would
 * terminate the script block and break the page. */
export function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function generateDashboardHtml(data: DashboardData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ces-tester Results Dashboard</title>
<style>
  :root{
    --bg:#0a1930; --panel:#10233f; --raised:#142a4a; --panel-2:#0d1e37;
    --line:#1e3a5c; --accent:#3b9bff; --amber:#ffb454; --green:#3ddc97;
    --bad:#ff7597; --ink:#dce8f7; --muted:#9db2cc; --dim:#93a8c4;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{background:var(--bg);color:var(--ink);font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;font-size:15px;line-height:1.45;}
  .wrap{max-width:1480px;margin:0 auto;padding:14px 26px 40px;}
  .eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.9px;color:var(--accent);font-weight:700;}
  .num{font-variant-numeric:tabular-nums;}
  header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;}
  header h1{font-size:21px;font-weight:600;margin:0;letter-spacing:.2px;}
  header h1 .ces{color:var(--accent);}
  .meta{color:var(--muted);font-size:12.5px;}
  .meta strong{color:var(--ink);}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0;}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 16px;}
  .tile .big{font-size:30px;font-weight:700;line-height:1.1;}
  .tile .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-top:2px;}
  .pass{color:var(--green);} .fail{color:var(--bad);} .crash{color:var(--amber);} .flaky{color:var(--amber);}
  table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:13.5px;}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);}
  th{background:var(--raised);font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);}
  tr:last-child td{border-bottom:none;}
  .badge{display:inline-block;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;}
  .badge.pass{border:1px solid var(--green);}
  .badge.fail{border:1px solid var(--bad);}
  .badge.crash{border:1px solid var(--amber);}
  .badge.flaky{border:1px solid var(--amber);}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.8px;color:var(--accent);margin:26px 0 10px;}
  details{background:var(--panel-2);border:1px solid var(--line);border-radius:8px;margin:8px 0;}
  details>summary{cursor:pointer;padding:10px 14px;font-weight:600;}
  details[open]>summary{border-bottom:1px solid var(--line);}
  .detail-body{padding:10px 14px;}
  .strip{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px;}
  .runcell{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:150px;}
  .runcell .rid{font-size:11.5px;color:var(--muted);word-break:break-all;}
  .runcell .rate{font-size:20px;font-weight:700;}
  .runcell .seq{font-size:12px;letter-spacing:2px;}
  .runcell.inflight{border-style:dashed;border-color:var(--amber);}
  a{color:var(--accent);}
  code{background:var(--raised);border-radius:4px;padding:1px 5px;font-size:12.5px;}
  .mono{font-family:Consolas,monospace;font-size:12.5px;}
  .dimnote{color:var(--dim);font-size:11.5px;margin:4px 0 14px;}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><span class="ces">ces-tester</span> Results Dashboard</h1>
    <span class="meta">generated <strong id="gen-at"></strong> · <span id="run-count"></span> run(s) on record</span>
  </header>
  <div class="dimnote">Static snapshot generated by <code>ces-tester dashboard</code> — regenerate after runs. Fully offline; ledger snapshot links resolve relative to the repo's <code>runs/</code> directory.</div>

  <div class="eyebrow">Latest run</div>
  <div id="latest-meta" class="meta" style="margin:4px 0 2px"></div>
  <div class="tiles" id="tiles"></div>
  <table id="scenario-table">
    <thead><tr><th>Scenario</th><th>Status</th><th>Assertions</th><th>Diverged</th><th>SET subs</th><th>Duration</th><th>History</th></tr></thead>
    <tbody></tbody>
  </table>

  <h2>Per-scenario detail (latest run)</h2>
  <div id="details"></div>

  <h2>Run history</h2>
  <div class="strip" id="history-strip"></div>

  <h2>Scenario history &amp; flake detection</h2>
  <table id="flaky-table">
    <thead><tr><th>Scenario</th><th>Runs</th><th>Pass</th><th>Fail</th><th>Crash</th><th>Verdict sequence (old→new)</th><th>Assessment</th></tr></thead>
    <tbody></tbody>
  </table>
</div>
<script id="dashboard-data" type="application/json">__DATA__</script>
<script>
(function(){
  var DATA = JSON.parse(document.getElementById('dashboard-data').textContent);
  var esc = function(s){ var d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; };
  var fmtMs = function(ms){ return (ms==null) ? '—' : (ms>=1000 ? Math.round(ms/1000)+'s' : ms+'ms'); };
  var glyph = function(st){ return st==='pass' ? '●' : (st==='fail' ? '✕' : '▲'); };

  document.getElementById('gen-at').textContent = DATA.generated_at;
  var completed = DATA.runs.filter(function(r){ return !r.in_progress; });
  document.getElementById('run-count').textContent = completed.length + ' completed' + (DATA.runs.length>completed.length ? ' + ' + (DATA.runs.length-completed.length) + ' in flight' : '');
  var latest = completed[completed.length-1];

  if (latest) {
    document.getElementById('latest-meta').innerHTML = 'run <strong>'+esc(latest.run_id)+'</strong> · started '+esc(latest.started_at)+(latest.completed_at ? ' · completed '+esc(latest.completed_at) : '');
    var t = latest.totals;
    var rate = t.total ? Math.round(100*t.pass/t.total) : 0;
    var tiles = [
      {v:t.total, l:'scenarios', c:''},
      {v:t.pass, l:'pass', c:'pass'},
      {v:t.fail, l:'fail', c:'fail'},
      {v:t.crash, l:'crash', c:'crash'},
      {v:rate+'%', l:'pass rate', c: rate===100?'pass':(rate>0?'crash':'fail')}
    ];
    document.getElementById('tiles').innerHTML = tiles.map(function(x){
      return '<div class="tile"><div class="big num '+x.c+'">'+esc(x.v)+'</div><div class="lbl">'+esc(x.l)+'</div></div>';
    }).join('');

    var hist = {};
    DATA.histories.forEach(function(h){ hist[h.scenario_id]=h; });
    document.querySelector('#scenario-table tbody').innerHTML = latest.scenarios.map(function(s){
      var h = hist[s.scenario_id];
      var histCell = h ? (h.flaky ? '<span class="badge flaky">flaky</span> ' : '') + '<span class="mono">'+h.pass_count+'/'+h.runs_seen+' pass</span>' : '—';
      return '<tr><td>'+esc(s.scenario_id)+'</td>'+
        '<td><span class="badge '+esc(s.status)+' '+esc(s.status)+'">'+esc(s.status)+'</span></td>'+
        '<td class="num">'+(s.assertions_pass!=null ? '<span class="pass">'+s.assertions_pass+'✓</span> <span class="fail">'+s.assertions_fail+'✗</span>' : '—')+'</td>'+
        '<td class="num">'+(s.diverged_count!=null?s.diverged_count:'—')+'</td>'+
        '<td class="num">'+(s.set_sub_count!=null?s.set_sub_count:'—')+'</td>'+
        '<td class="num">'+fmtMs(s.duration_ms)+'</td>'+
        '<td>'+histCell+'</td></tr>';
    }).join('');

    document.getElementById('details').innerHTML = DATA.latest_results.map(function(r){
      var rows = r.assertions.map(function(a){
        return '<tr><td>'+esc(a.stage)+'</td><td><span class="badge '+esc(a.result)+' '+esc(a.result)+'">'+esc(a.result)+'</span></td><td>'+esc(a.check)+'</td><td class="mono">'+(a.expected!==undefined ? 'expected '+esc(JSON.stringify(a.expected))+' · ' : '')+'actual '+esc(a.actual===undefined?'—':(typeof a.actual==='string'?a.actual:JSON.stringify(a.actual)))+'</td></tr>';
      }).join('');
      var div = r.diverged_commands.length
        ? '<h4 style="margin:12px 0 6px">Diverged commands ('+r.diverged_commands.length+')</h4><table><thead><tr><th>Command (ledger-sourced)</th><th>Expected</th><th>Actual</th></tr></thead><tbody>'+
          r.diverged_commands.map(function(d){ return '<tr><td class="mono">'+esc(d.command)+'</td><td class="mono">'+esc(JSON.stringify(d.expected))+'</td><td class="mono">'+esc(typeof d.actual==='string'?d.actual:JSON.stringify(d.actual))+'</td></tr>'; }).join('')+'</tbody></table>'
        : '<div class="dimnote" style="margin-top:10px">No diverged commands.</div>';
      var ledger = r.stacksim_ledger_ref && r.stacksim_ledger_ref.indexOf('unavailable')===-1
        ? '<div style="margin-top:8px">Ledger snapshot: <a href="../runs/'+esc(r.stacksim_ledger_ref)+'">'+esc(r.stacksim_ledger_ref)+'</a></div>'
        : '<div class="dimnote" style="margin-top:8px">Ledger snapshot unavailable for this scenario.</div>';
      return '<details><summary><span class="badge '+esc(r.status)+' '+esc(r.status)+'">'+esc(r.status)+'</span> '+esc(r.scenario_id)+' <span class="meta num">('+fmtMs(r.duration_ms)+(r.set_sub_count!=null?' · '+r.set_sub_count+' SET subs':'')+')</span></summary>'+
        '<div class="detail-body"><table><thead><tr><th>Stage</th><th>Result</th><th>Check</th><th>Expected / actual</th></tr></thead><tbody>'+rows+'</tbody></table>'+div+ledger+'</div></details>';
    }).join('') || '<div class="dimnote">No detailed results available for the latest run.</div>';
  } else {
    document.getElementById('latest-meta').textContent = 'No completed runs on record yet.';
  }

  document.getElementById('history-strip').innerHTML = DATA.runs.map(function(r){
    var t=r.totals, rate=t.total?Math.round(100*t.pass/t.total):0;
    var seq = r.scenarios.map(function(s){ return '<span class="'+esc(s.status)+'" title="'+esc(s.scenario_id)+': '+esc(s.status)+'">'+glyph(s.status)+'</span>'; }).join('');
    return '<div class="runcell'+(r.in_progress?' inflight':'')+'"><div class="rid">'+esc(r.run_id)+(r.in_progress?' · IN FLIGHT':'')+'</div><div class="rate num '+(rate===100?'pass':(rate>0?'crash':'fail'))+'">'+rate+'%</div><div class="seq">'+seq+'</div><div class="rid num">'+t.pass+'/'+t.total+' pass · '+esc(r.started_at.slice(0,16).replace('T',' '))+'</div></div>';
  }).join('') || '<div class="dimnote">No runs recorded.</div>';

  document.querySelector('#flaky-table tbody').innerHTML = DATA.histories.map(function(h){
    var assess = h.flaky
      ? '<span class="badge flaky">flaky</span> <span class="meta">mixed verdicts on identical inputs</span>'
      : (h.pass_count===h.runs_seen ? '<span class="badge pass">stable pass</span>' : '<span class="badge fail">consistent fail</span>');
    var seq = h.sequence.map(function(st){ return '<span class="'+esc(st)+'">'+glyph(st)+'</span>'; }).join(' ');
    return '<tr><td>'+esc(h.scenario_id)+'</td><td class="num">'+h.runs_seen+'</td><td class="num pass">'+h.pass_count+'</td><td class="num fail">'+h.fail_count+'</td><td class="num crash">'+h.crash_count+'</td><td class="seq">'+seq+'</td><td>'+assess+'</td></tr>';
  }).join('') || '<tr><td colspan="7" class="dimnote">No completed runs.</td></tr>';
})();
</script>
</body>
</html>
`.replace('__DATA__', embedJson(data));
}

export async function writeDashboard(runsRoot: string, outPath: string, now: Date = new Date()): Promise<string> {
  const data = await buildDashboardData(runsRoot, now);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, generateDashboardHtml(data), 'utf8');
  return outPath;
}
