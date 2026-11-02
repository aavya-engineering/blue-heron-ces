#!/usr/bin/env node
// W8-DSH (PLAN.md §4): the static proof-run dashboard.
//   node scripts/dashboard.mjs [--root <WS>] [--out <html>]
// Reads only files: expected-outputs\<slug>\proof-runs\*\{verify,scorecard-<slug>,GAPS-<slug>}.json (muster-partial keeps its
// runs in expected-outputs\proof-runs\), <WS>\out\{verify,summary,scorecard-<slug>,GAPS-<slug>}.json and the Instrument
// stylesheet <WS>\ces\ces-shared\ui\ces-ui.css. Writes <WS>\dashboard\proof-runs.html: self-contained (AD-6: inline
// ces-ui.css, embedded JSON, no external URL), vanilla JS. Per scenario: proof-run history (verify passes and failing
// checks, scorecard rows vs thresholds, GAPS counts and filterable rows); current out\ vs the newest baseline (flipped checks).
// Then runs identity-scan.ps1 -Path <html>; on a hit it deletes the output and exits 1.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { thresholdsFor, SCENARIO_OF_SLUG } from './scorecard.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = path.dirname(SCRIPTS_DIR);
const ROOT_SLUG = 'muster-partial';

const readJsonOrNull = (file) => {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
};
const rel = (from, to) => path.relative(from, to).split(path.sep).join('/');

// ---------- run ordering: nb-run<N><suffix>-... (run 65c after 65b after 65) ----------
export function runSortKey(name) {
  const m = /run(\d+)([a-z]*)/i.exec(name);
  return m ? [Number(m[1]), m[2].toLowerCase(), name] : [-1, '', name];
}
export function compareRuns(a, b) {
  const x = runSortKey(a), y = runSortKey(b);
  if (x[0] !== y[0]) return x[0] - y[0];
  if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1;
  return x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0;
}

// ---------- discovery ----------
export function scenarioLabel(slug) {
  return SCENARIO_OF_SLUG[slug] ? `${SCENARIO_OF_SLUG[slug]} · ${slug}` : slug === ROOT_SLUG ? `mp · ${slug}` : slug;
}
export function discoverScenarios(pkgDir) {
  const eo = path.join(pkgDir, 'expected-outputs');
  const out = [];
  const add = (slug, prDir) => {
    if (!fs.existsSync(prDir)) return;
    const runs = fs.readdirSync(prDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(compareRuns);
    out.push({ slug, proofRunsDir: prDir, runs });
  };
  add(ROOT_SLUG, path.join(eo, 'proof-runs'));
  if (fs.existsSync(eo)) {
    for (const d of fs.readdirSync(eo, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
      if (d === 'proof-runs') continue;
      add(d, path.join(eo, d, 'proof-runs'));
    }
  }
  return out;
}

// ---------- summaries ----------
export function summarizeVerify(v) {
  if (!v || !Array.isArray(v.checks)) return null;
  return {
    pass: v.pass === true,
    harness: v.harness ?? null,
    total: v.checks.length,
    passed: v.checks.filter((c) => c.pass).length,
    checks: v.checks.map((c) => ({ id: c.id, title: c.title, pass: c.pass === true, detail: c.pass ? undefined : c.detail })),
  };
}
export function summarizeScorecard(sc, slug, pkgDir) {
  if (!sc || !Array.isArray(sc.rows)) return null;
  const current = thresholdsFor(slug, pkgDir).thresholds ?? {};
  const counts = {};
  for (const r of sc.rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    pass: sc.pass === true,
    thresholdSource: sc.thresholdSource ?? null,
    counts,
    rows: sc.rows.map((r) => ({ id: r.id, title: r.title, status: r.status, detail: r.detail, threshold: r.threshold ?? current[r.id] ?? {} })),
  };
}
const GAP_FIELDS = ['id', 'weight', 'control', 'source', 'module', 'owner', 'item', 'needs', 'have', 'group', 'task'];
// Rows are pooled across runs (gap ids come from content, so most rows repeat run to run); each run lists pool indexes.
export function summarizeGaps(g, pool) {
  if (!g || !Array.isArray(g.rows)) return null;
  const idx = g.rows.map((r) => {
    const o = {};
    for (const k of GAP_FIELDS) if (r[k] !== undefined && r[k] !== null) o[k] = r[k];
    const key = JSON.stringify(o);
    if (!pool.index.has(key)) { pool.index.set(key, pool.rows.length); pool.rows.push(o); }
    return pool.index.get(key);
  });
  return { rowCount: g.rowCount ?? g.rows.length, bySource: g.bySource ?? {}, byModule: g.byModule ?? {}, byOwner: g.byOwner ?? {}, rows: idx };
}
export function loadRun(dir, slug, pkgDir, pool) {
  return {
    verify: summarizeVerify(readJsonOrNull(path.join(dir, 'verify.json'))),
    scorecard: summarizeScorecard(readJsonOrNull(path.join(dir, `scorecard-${slug}.json`)), slug, pkgDir),
    gaps: summarizeGaps(readJsonOrNull(path.join(dir, `GAPS-${slug}.json`)), pool),
  };
}

// Checks whose result differs between the baseline and the current verify (plus checks only one side has).
export function flippedChecks(base, cur) {
  if (!base || !cur) return [];
  const b = new Map(base.checks.map((c) => [c.id, c]));
  const c = new Map(cur.checks.map((x) => [x.id, x]));
  const ids = [...b.keys(), ...[...c.keys()].filter((k) => !b.has(k))];
  const out = [];
  for (const id of ids) {
    const x = b.get(id), y = c.get(id);
    let kind = null;
    if (x && !y) kind = 'removed';
    else if (!x && y) kind = 'added';
    else if (x.pass !== y.pass) kind = y.pass ? 'fixed' : 'broke';
    if (kind) out.push({ id, kind, title: (y ?? x).title, baseline: x ? x.pass : null, current: y ? y.pass : null, detail: y?.detail ?? null });
  }
  return out;
}

export function collectData({ root, pkgDir = PKG_DIR, now = new Date() }) {
  const pool = { rows: [], index: new Map() };
  const scenarios = discoverScenarios(pkgDir).map((s) => ({
    slug: s.slug,
    label: scenarioLabel(s.slug),
    dir: rel(pkgDir, s.proofRunsDir),
    runs: s.runs.map((name) => ({ name, ...loadRun(path.join(s.proofRunsDir, name), s.slug, pkgDir, pool) })),
  }));
  const outDir = path.join(root, 'out');
  const cv = readJsonOrNull(path.join(outDir, 'verify.json'));
  const summary = readJsonOrNull(path.join(outDir, 'summary.json'));
  let current = null;
  const slug = cv?.scenario ?? summary?.scenario ?? null;
  if (cv || summary) {
    const run = slug ? loadRun(outDir, slug, pkgDir, pool) : { verify: summarizeVerify(cv), scorecard: null, gaps: null };
    const scen = scenarios.find((s) => s.slug === slug);
    const baseRun = scen && scen.runs.length ? scen.runs[scen.runs.length - 1] : null;
    current = {
      slug,
      label: slug ? scenarioLabel(slug) : 'unknown scenario',
      ...run,
      summary: summary ? {
        stamper: summary.stamper ? { status: summary.stamper.status, completed: summary.stamper.completed, total: summary.stamper.total_tasks, failed: summary.stamper.failed, failedTasks: summary.stamper.failed_tasks ?? [] } : null,
        sprs: summary.eo_assess?.sprs_score ?? null,
        eo: summary.eo_assess ? { met: summary.eo_assess.controls_met, notMet: summary.eo_assess.controls_not_met, partial: summary.eo_assess.controls_partial, notAssessed: summary.eo_assess.controls_not_assessed } : null,
        directives: summary.directives_total ?? null,
      } : null,
      baseline: baseRun ? baseRun.name : null,
      flipped: baseRun ? flippedChecks(baseRun.verify, run.verify) : [],
    };
  }
  return { schema: 'ces-muster-run/dashboard@1', generatedAt: now.toISOString(), scenarios, current, gapPool: pool.rows };
}

// ---------- page ----------
export function inlineCss(css) {
  // AD-6: no external URL. The Google Fonts @import is dropped; the token stacks fall back to system faces.
  return css.replace(/^\s*@import\s+url\([^)]*\)\s*;?\s*$/gm, '/* (web-font import removed: self-contained page) */');
}
const BS = String.fromCharCode(92);
export const jsonForScript = (data) => JSON.stringify(data).split('<').join(`${BS}u003c`)
  .split(String.fromCharCode(0x2028)).join(`${BS}u2028`).split(String.fromCharCode(0x2029)).join(`${BS}u2029`);

const PAGE_CSS = `
:root { color-scheme: light; }
[data-theme="dark"] { color-scheme: dark; }
.ces-header { padding: 0 16px; }
.ces-header .header-company { overflow: hidden; text-overflow: ellipsis; }
.ces-header .version { font-family: var(--co-font-mono); font-size: 11px; opacity: 0.8; white-space: nowrap; }
.mark { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1.5px solid var(--co-header-icon); color: var(--co-header-icon); font-family: var(--co-font-mono); font-size: 10px; font-weight: 500; }
main { max-width: 1280px; margin: 0 auto; padding: 0 16px 32px; }
.tabs { display: flex; gap: 2px; overflow-x: auto; border-bottom: 1px solid var(--co-border); margin: 0 -16px 16px; padding: 8px 16px 0; background: var(--co-surface); position: sticky; top: 0; z-index: 2; scrollbar-width: thin; }
.tab { font-family: var(--co-font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--co-text-muted); background: none; border: none; border-bottom: 2px solid transparent; padding: 6px 12px 8px; cursor: pointer; white-space: nowrap; }
.tab:hover { color: var(--co-text); }
.tab[aria-selected="true"] { color: var(--co-primary); border-bottom-color: var(--co-primary); }
.tab .dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; vertical-align: 1px; }
.dot.ok { background: var(--co-compliant); } .dot.bad { background: var(--co-violation); } .dot.na { background: var(--co-border-strong); }
.section { margin: 0 0 20px; }
.section > .ces-titleblock { margin-bottom: 10px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 12px; }
.kpi { padding: 10px 12px; border-left: 3px solid var(--co-border-strong); }
.kpi.ok { border-left-color: var(--co-compliant); } .kpi.bad { border-left-color: var(--co-violation); } .kpi.warn { border-left-color: var(--co-risk); }
.kpi .v { font-family: var(--co-font-mono); font-size: 20px; font-weight: 500; line-height: 1.3; }
.kpi .s { font-size: 12px; color: var(--co-text-muted); }
.wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table.ledger { width: 100%; border-collapse: collapse; font-size: 13px; }
.ledger th { text-align: left; font-family: var(--co-font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--co-text-muted); padding: 8px 10px; border-bottom: 1.5px solid var(--co-border); background: var(--co-bg-elevated); white-space: nowrap; }
.ledger td { padding: 7px 10px; border-bottom: 1px solid var(--co-border); vertical-align: top; }
.ledger td.id, .ledger td.num { font-family: var(--co-font-mono); font-size: 12px; white-space: nowrap; }
.ledger td.num { text-align: right; }
.ledger td.wide { min-width: 240px; color: var(--co-text-secondary); }
[data-theme="dark"] .ledger td.wide { color: var(--co-text-muted); }
.ledger tr.pick { cursor: pointer; }
.ledger tr.pick td:first-child { border-left: 3px solid transparent; }
.ledger tr.pick:hover td { background: var(--co-bg-elevated); }
.ledger tr.pick[aria-selected="true"] td { background: var(--co-primary-subtle); }
.ledger tr.pick[aria-selected="true"] td:first-child { border-left-color: var(--co-designation); }
.ledger tr.pick:focus-visible { outline: 2px solid var(--co-primary-focus); outline-offset: -2px; }
.ids { display: flex; flex-wrap: wrap; gap: 4px; }
.badge { font-family: var(--co-font-mono); font-size: 11px; }
.badge-na { background: var(--co-bg-elevated); color: var(--co-text-muted); }
.bar { position: relative; height: 6px; min-width: 80px; background: var(--co-violation-bg); margin-top: 4px; }
.bar > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--co-compliant); }
.muted { color: var(--co-text-muted); }
.empty { padding: 14px 12px; color: var(--co-text-muted); font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 10px 12px; font-size: 12px; }
.chips .grp { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--co-border); border-bottom: 1px solid var(--co-border); background: var(--co-bg-elevated); align-items: center; }
.filters input, .filters select { font: 13px var(--co-font-sans); color: var(--co-text); background: var(--co-surface); border: 1px solid var(--co-border-strong); border-radius: 0; height: 32px; padding: 0 8px; min-width: 0; }
.filters input { flex: 1 1 200px; }
.filters select { flex: 0 1 160px; }
.filters .count { font-family: var(--co-font-mono); font-size: 11px; color: var(--co-text-muted); margin-left: auto; white-space: nowrap; }
details.cell summary { cursor: pointer; color: var(--co-primary); font-size: 12px; }
details.cell p { margin: 6px 0 0; }
.foot { font-size: 11px; color: var(--co-text-muted); margin-top: 24px; }
@media (max-width: 640px) {
  .ces-header .header-company { display: none; }
  .ledger td.wide { min-width: 200px; }
  .kpi .v { font-size: 17px; }
}
`;

/* eslint-disable no-undef */
function clientMain() {
  const DATA = JSON.parse(document.getElementById('dashboard-data').textContent);
  const app = document.getElementById('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORAGE_KEY = 'ces-theme';
  const getTheme = () => { try { return localStorage.getItem(STORAGE_KEY) || 'dark'; } catch (e) { return 'dark'; } };
  const applyTheme = (t) => { if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme'); };
  applyTheme(getTheme());
  document.getElementById('ces-theme-toggle').addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* storage unavailable: theme still flips for this view */ }
    applyTheme(next);
  });

  const STATUS_BADGE = { pass: 'badge-compliant', fail: 'badge-violation', exempt: 'badge-review', 'not computed': 'badge-risk' };
  const badge = (text, cls) => `<span class="badge ${cls}">${esc(text)}</span>`;
  const passBadge = (p) => (p === null || p === undefined ? badge('—', 'badge-na') : p ? badge('pass', 'badge-compliant') : badge('fail', 'badge-violation'));
  const tb = (title, designator) => `<div class="ces-titleblock"><span class="tb-title">${esc(title)}</span>${designator ? `<span class="tb-designator">${esc(designator)}</span>` : ''}</div>`;
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
  const bar = (a, b) => `<div class="bar" aria-hidden="true"><i style="width:${pct(a, b)}%"></i></div>`;
  const fmtThreshold = (th) => {
    if (!th || !Object.keys(th).length) return '—';
    if (th.exempt) return 'exempt';
    const parts = [];
    for (const [k, v] of Object.entries(th)) {
      if (k === 'minPassed') parts.push(`≥ ${v} rows`);
      else if (k === 'minPct') parts.push(`≥ ${v} %`);
      else if (k === 'maxPct') parts.push(`≤ ${v} %`);
      else if (k === 'maxJson') parts.push(`JSON ≤ ${v}`);
      else if (k === 'maxDocx') parts.push(`DOCX ≤ ${v}`);
      else if (k === 'minPolicies') parts.push(`policies ≥ ${v}`);
      else if (k === 'minOdps') parts.push(`ODPs ≥ ${v}`);
      else if (k === 'maxTcp') parts.push(`TCP ≤ ${v}`);
      else if (k === 'rows') parts.push(`rows ${v.join(', ')}`);
      else if (k === 'all' && v) parts.push('all');
      else if (k === 'exact' && v) parts.push('exact');
      else parts.push(`${k} ${JSON.stringify(v)}`);
    }
    return parts.join('; ');
  };
  const verifyCell = (v) => (v ? `<span class="id">${v.passed}/${v.total}</span>${bar(v.passed, v.total)}` : '<span class="muted">no verify.json</span>');
  const failIds = (v) => {
    if (!v) return '—';
    const f = v.checks.filter((c) => !c.pass);
    return f.length ? `<div class="ids">${f.map((c) => badge(c.id, 'badge-violation')).join('')}</div>` : badge('all pass', 'badge-compliant');
  };
  const scoreCell = (s) => {
    if (!s) return '<span class="muted">—</span>';
    const c = s.counts;
    return `${passBadge(s.pass)} <span class="muted">${c.pass ?? 0} pass${c.fail ? ` · ${c.fail} fail` : ''}${c.exempt ? ` · ${c.exempt} exempt` : ''}${c['not computed'] ? ` · ${c['not computed']} n/c` : ''}</span>`;
  };

  // ----- tabs -----
  const tabs = [{ key: 'overview', label: 'Overview', dot: null }].concat(DATA.scenarios.map((s) => {
    const last = s.runs[s.runs.length - 1];
    return { key: s.slug, label: s.label, dot: last && last.verify ? (last.verify.pass ? 'ok' : 'bad') : 'na' };
  }));
  const state = { tab: 'overview', run: {}, filters: {} };
  try { const h = decodeURIComponent(location.hash.slice(1)); if (tabs.some((t) => t.key === h)) state.tab = h; } catch (e) { /* ignore */ }

  function renderTabs() {
    return `<nav class="tabs" role="tablist" aria-label="Scenarios">${tabs.map((t) => `<button class="tab" role="tab" type="button" data-tab="${esc(t.key)}" aria-selected="${t.key === state.tab}">${t.dot ? `<span class="dot ${t.dot}" aria-hidden="true"></span>` : ''}${esc(t.label)}</button>`).join('')}</nav>`;
  }

  // ----- overview -----
  function renderCurrent() {
    const c = DATA.current;
    if (!c) return `<div class="section">${tb('Current out\\ vs newest baseline')}<div class="panel empty">No out\\verify.json or out\\summary.json.</div></div>`;
    const scen = DATA.scenarios.find((s) => s.slug === c.slug);
    const base = scen && c.baseline ? scen.runs.find((r) => r.name === c.baseline) : null;
    const v = c.verify, bv = base && base.verify;
    const kpi = (cls, value, sub) => `<div class="panel kpi ${cls}"><div class="eyebrow">${sub[0]}</div><div class="v">${value}</div><div class="s">${sub[1]}</div></div>`;
    const broke = c.flipped.filter((f) => f.kind === 'broke').length, fixed = c.flipped.filter((f) => f.kind === 'fixed').length;
    let html = `<div class="section">${tb('Current out\\ vs newest baseline', `${c.label} · baseline ${c.baseline ?? 'none'}`)}<div class="kpis">`;
    html += kpi(v ? (v.pass ? 'ok' : 'bad') : '', v ? `${v.passed}/${v.total}` : '—', ['Verify, out\\', bv ? `baseline ${bv.passed}/${bv.total}` : 'no baseline verify']);
    html += kpi(broke ? 'bad' : c.flipped.length ? 'warn' : 'ok', String(c.flipped.length), ['Flipped checks', `${broke} broke · ${fixed} fixed · ${c.flipped.length - broke - fixed} added/removed`]);
    html += kpi(c.scorecard ? (c.scorecard.pass ? 'ok' : 'bad') : '', c.scorecard ? (c.scorecard.pass ? 'within' : 'outside') : '—', ['Scorecard', c.scorecard ? `${c.scorecard.counts.pass ?? 0} pass · ${c.scorecard.counts.fail ?? 0} fail` : 'no scorecard in out\\']);
    const bg = base && base.gaps;
    html += kpi('', c.gaps ? String(c.gaps.rowCount) : '—', ['GAPS rows', bg ? `baseline ${bg.rowCount} (${c.gaps ? (c.gaps.rowCount - bg.rowCount >= 0 ? '+' : '') + (c.gaps.rowCount - bg.rowCount) : '?'})` : 'no baseline GAPS']);
    const sm = c.summary;
    if (sm && sm.stamper) html += kpi(sm.stamper.failed ? 'warn' : 'ok', `${sm.stamper.completed}/${sm.stamper.total}`, ['Stamper tasks', `${esc(sm.stamper.status)}${sm.stamper.failedTasks.length ? ' · ' + esc(sm.stamper.failedTasks.join(', ')) : ''}`]);
    if (sm && sm.sprs !== null) html += kpi('', String(sm.sprs), ['SPRS (EO assess)', sm.eo ? `${sm.eo.met} met · ${sm.eo.notMet} not met · ${sm.eo.partial} partial · ${sm.eo.notAssessed} n/a'd` : '']);
    html += '</div>';
    if (!c.flipped.length) html += `<div class="panel empty">${c.baseline ? 'No check flipped against the newest baseline.' : 'No proof run for this scenario to compare against.'}</div>`;
    else {
      html += `<div class="panel wrap"><table class="ledger"><thead><tr><th>Check</th><th>Change</th><th>Baseline</th><th>Current</th><th>Title / current detail</th></tr></thead><tbody>`;
      const KIND = { broke: 'badge-violation', fixed: 'badge-compliant', added: 'badge-review', removed: 'badge-risk' };
      for (const f of c.flipped) html += `<tr><td class="id">${esc(f.id)}</td><td>${badge(f.kind, KIND[f.kind])}</td><td>${passBadge(f.baseline)}</td><td>${passBadge(f.current)}</td><td class="wide">${esc(f.title)}${f.detail ? `<div class="muted">${esc(f.detail)}</div>` : ''}</td></tr>`;
      html += '</tbody></table></div>';
    }
    return html + '</div>';
  }
  function renderOverview() {
    let html = renderCurrent();
    html += `<div class="section">${tb('Scenarios', `${DATA.scenarios.length} scenarios · ${DATA.scenarios.reduce((n, s) => n + s.runs.length, 0)} proof runs`)}<div class="panel wrap"><table class="ledger"><thead><tr><th>Scenario</th><th>Runs</th><th>Newest run</th><th>Verify</th><th>Failing checks</th><th>Scorecard</th><th>GAPS</th></tr></thead><tbody>`;
    for (const s of DATA.scenarios) {
      const r = s.runs[s.runs.length - 1];
      html += `<tr class="pick" tabindex="0" data-go="${esc(s.slug)}"><td class="id">${esc(s.label)}</td><td class="num">${s.runs.length}</td><td class="id">${r ? esc(r.name) : '—'}</td><td>${r ? verifyCell(r.verify) : '—'}</td><td>${r ? failIds(r.verify) : '—'}</td><td>${r ? scoreCell(r.scorecard) : '—'}</td><td class="num">${r && r.gaps ? r.gaps.rowCount : '—'}</td></tr>`;
    }
    return html + '</tbody></table></div></div>';
  }

  // ----- scenario -----
  function renderScenario(s) {
    const runs = s.runs.slice().reverse();
    if (!state.run[s.slug] && runs.length) state.run[s.slug] = runs[0].name;
    let html = `<div class="section">${tb(`Proof-run history · ${s.label}`, `${s.dir} · ${s.runs.length} runs`)}<div class="panel wrap"><table class="ledger" aria-label="Proof runs"><thead><tr><th>Run</th><th>Verify</th><th>Failing checks</th><th>Scorecard</th><th>GAPS</th></tr></thead><tbody>`;
    for (const r of runs) html += `<tr class="pick" tabindex="0" data-run="${esc(r.name)}" aria-selected="${r.name === state.run[s.slug]}"><td class="id">${esc(r.name)}</td><td>${verifyCell(r.verify)}</td><td>${failIds(r.verify)}</td><td>${scoreCell(r.scorecard)}</td><td class="num">${r.gaps ? r.gaps.rowCount : '—'}</td></tr>`;
    if (!runs.length) html += '<tr><td colspan="5" class="empty">No proof runs.</td></tr>';
    html += '</tbody></table></div></div>';
    const run = s.runs.find((r) => r.name === state.run[s.slug]);
    if (run) html += renderRunDetail(s, run);
    return html;
  }
  function renderRunDetail(s, run) {
    let html = '';
    const v = run.verify;
    const failing = v ? v.checks.filter((c) => !c.pass) : [];
    html += `<div class="section">${tb('Failing verify checks', `${run.name}${v ? ` · ${v.passed}/${v.total} pass` : ''}`)}`;
    if (!v) html += '<div class="panel empty">No verify.json in this run.</div>';
    else if (!failing.length) html += '<div class="panel empty">Every check passes.</div>';
    else {
      html += '<div class="panel wrap"><table class="ledger"><thead><tr><th>Check</th><th>Title</th><th>Detail</th></tr></thead><tbody>';
      for (const c of failing) html += `<tr><td class="id">${esc(c.id)}</td><td>${esc(c.title)}</td><td class="wide">${esc(c.detail)}</td></tr>`;
      html += '</tbody></table></div>';
    }
    html += '</div>';
    const sc = run.scorecard;
    html += `<div class="section">${tb('Scorecard vs thresholds', sc ? `thresholds: ${sc.thresholdSource ?? '—'}` : run.name)}`;
    if (!sc) html += '<div class="panel empty">No scorecard in this run (scorecards start with wave W4).</div>';
    else {
      html += '<div class="panel wrap"><table class="ledger"><thead><tr><th>Row</th><th>Status</th><th>Threshold</th><th>Measured</th></tr></thead><tbody>';
      for (const r of sc.rows) html += `<tr><td class="id" title="${esc(r.title)}">${esc(r.id)}</td><td>${badge(r.status, STATUS_BADGE[r.status] || 'badge-na')}</td><td class="id">${esc(fmtThreshold(r.threshold))}</td><td class="wide"><div>${esc(r.title)}</div><div class="muted">${esc(r.detail)}</div></td></tr>`;
      html += '</tbody></table></div>';
    }
    html += '</div>';
    html += renderGaps(s, run);
    return html;
  }
  function renderGaps(s, run) {
    const g = run.gaps;
    let html = `<div class="section">${tb('GAPS', g ? `${g.rowCount} rows` : run.name)}`;
    if (!g) return html + '<div class="panel empty">No GAPS file in this run.</div></div>';
    const chipGroup = (name, obj) => `<div class="grp"><span class="eyebrow">${name}</span>${Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => badge(`${k} ${n}`, 'badge-na')).join('')}</div>`;
    const rows = g.rows.map((i) => DATA.gapPool[i]);
    const opts = (k) => Array.from(new Set(rows.map((r) => r[k]).filter((x) => x !== undefined))).sort();
    const key = `${s.slug}|${run.name}`;
    const f = state.filters[key] || (state.filters[key] = { q: '', source: '', module: '', owner: '' });
    const sel = (k, label) => `<select data-f="${k}" aria-label="${label}"><option value="">${label}: all</option>${opts(k).map((o) => `<option${o === f[k] ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    html += `<div class="panel"><div class="chips">${chipGroup('source', g.bySource)}${chipGroup('module', g.byModule)}${chipGroup('owner', g.byOwner)}</div>`;
    html += `<div class="filters"><input type="search" data-f="q" placeholder="Filter: id, control, item, needs, have" aria-label="Filter GAPS rows" value="${esc(f.q)}">${sel('source', 'Source')}${sel('module', 'Module')}${sel('owner', 'Owner')}<span class="count" data-count></span></div>`;
    html += `<div class="wrap"><table class="ledger" data-gaps="${esc(key)}"><thead><tr><th>Id</th><th>Wt</th><th>Control</th><th>Source</th><th>Module</th><th>Owner</th><th>Item / needs / have</th></tr></thead><tbody></tbody></table></div></div></div>`;
    return html;
  }
  function fillGaps() {
    const t = app.querySelector('table[data-gaps]');
    if (!t) return;
    const key = t.getAttribute('data-gaps');
    const [slug, name] = key.split('|');
    const run = DATA.scenarios.find((s) => s.slug === slug).runs.find((r) => r.name === name);
    const f = state.filters[key];
    const q = f.q.trim().toLowerCase();
    const all = run.gaps.rows.map((i) => DATA.gapPool[i]);
    const hit = all.filter((r) => (!f.source || r.source === f.source) && (!f.module || r.module === f.module) && (!f.owner || r.owner === f.owner)
      && (!q || [r.id, r.control, r.item, r.needs, r.have, r.group, r.task].some((x) => x && String(x).toLowerCase().includes(q))))
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const shown = hit.slice(0, 500);
    t.tBodies[0].innerHTML = shown.map((r) => `<tr><td class="id">${esc(r.id)}</td><td class="num">${esc(r.weight)}</td><td class="id">${esc(r.control ?? '—')}</td><td>${esc(r.source)}</td><td>${esc(r.module)}</td><td>${esc(r.owner)}</td><td class="wide"><div>${esc(r.item)}${r.group ? ` <span class="muted">(${esc(r.group)})</span>` : ''}</div><details class="cell"><summary>needs / have</summary><p><span class="eyebrow">needs</span> ${esc(r.needs)}</p><p><span class="eyebrow">have</span> ${esc(r.have)}</p></details></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No row matches.</td></tr>';
    app.querySelector('[data-count]').textContent = `${hit.length} of ${all.length}${hit.length > shown.length ? ` (first ${shown.length} shown)` : ''}`;
  }

  function render() {
    const s = DATA.scenarios.find((x) => x.slug === state.tab);
    app.innerHTML = renderTabs() + (s ? renderScenario(s) : renderOverview()) + `<div class="foot">Generated ${esc(DATA.generatedAt)} from expected-outputs\\ proof runs and out\\. Static page: rerun scripts\\dashboard.mjs to refresh.</div>`;
    fillGaps();
  }
  const activate = (el) => {
    if (el.dataset.tab) { state.tab = el.dataset.tab; try { history.replaceState(null, '', '#' + encodeURIComponent(state.tab)); } catch (e) { /* ignore */ } render(); app.querySelector('.tab[aria-selected="true"]')?.focus(); }
    else if (el.dataset.go) { state.tab = el.dataset.go; try { history.replaceState(null, '', '#' + encodeURIComponent(state.tab)); } catch (e) { /* ignore */ } render(); window.scrollTo(0, 0); }
    else if (el.dataset.run) { state.run[state.tab] = el.dataset.run; render(); app.querySelector(`tr[data-run="${CSS.escape(el.dataset.run)}"]`)?.focus(); }
  };
  app.addEventListener('click', (e) => { const el = e.target.closest('[data-tab],[data-go],[data-run]'); if (el) activate(el); });
  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('tr[data-go],tr[data-run]');
    if (el) { e.preventDefault(); activate(el); }
  });
  app.addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.f;
    if (!k) return;
    const key = app.querySelector('table[data-gaps]').getAttribute('data-gaps');
    state.filters[key][k] = e.target.value;
    fillGaps();
  });
  render();
}
/* eslint-enable no-undef */

export function renderHtml(data, css) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proof-run Dashboard</title>
<style>
${inlineCss(css)}
</style>
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="ces-header">
  <div class="header-brand"><span class="mark" aria-hidden="true">CES</span>CES <span class="header-company">Muster run &mdash; proof-run dashboard</span></div>
  <div class="header-controls"><span class="version">${data.generatedAt.slice(0, 16).replace('T', ' ')}Z</span><button id="ces-theme-toggle" type="button" title="Toggle light/dark theme" aria-label="Toggle light/dark theme">&#9680;</button></div>
</header>
<main id="app"><noscript><p class="empty">This dashboard needs JavaScript.</p></noscript></main>
<script type="application/json" id="dashboard-data">${jsonForScript(data)}</script>
<script>(${clientMain.toString()})();</script>
</body>
</html>
`;
}

// ---------- identity gate ----------
export function runIdentityScan(file, pkgDir = PKG_DIR) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(pkgDir, 'scripts', 'identity-scan.ps1'), '-Path', file], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`.trim() };
}

export function buildDashboard({ root, pkgDir = PKG_DIR, outFile = path.join(root, 'dashboard', 'proof-runs.html'), cssFile = path.join(root, 'ces', 'ces-shared', 'ui', 'ces-ui.css'), scan = runIdentityScan, now = new Date() }) {
  const data = collectData({ root, pkgDir, now });
  const html = renderHtml(data, fs.readFileSync(cssFile, 'utf8'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  // Orchestrator (2026-10-29): identity-scan.ps1 misses Windows user paths inside embedded JSON, where backslashes are
  // doubled. Pre-scan the page text for that form (and AppData) before the PowerShell scan.
  const pre = /[A-Za-z]:\\{2,}Users\\{2,}|\\{2,}AppData\\{2,}/i.exec(html);
  const s = pre ? { ok: false, output: `pre-scan: escaped local user path in embedded data (${pre[0]})` } : scan(outFile, pkgDir);
  if (!s.ok) fs.rmSync(outFile, { force: true });
  return { ok: s.ok, outFile, scanOutput: s.output, bytes: Buffer.byteLength(html), data };
}

export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  const root = path.resolve(a.root ?? path.join(PKG_DIR, '..', '..'));
  return { root, outFile: a.out ? path.resolve(a.out) : path.join(root, 'dashboard', 'proof-runs.html') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const o = parseArgs(process.argv.slice(2));
  const r = buildDashboard(o);
  console.log(r.scanOutput);
  if (!r.ok) {
    console.error(`dashboard: identity scan failed; ${r.outFile} deleted`);
    process.exitCode = 1;
  } else {
    console.log(`dashboard: ${r.data.scenarios.length} scenarios, ${r.data.scenarios.reduce((n, s) => n + s.runs.length, 0)} proof runs, ${r.data.current ? `out\\ = ${r.data.current.slug}, ${r.data.current.flipped.length} flipped vs ${r.data.current.baseline}` : 'no out\\'}; ${r.bytes} bytes`);
    console.log(`written: ${r.outFile}`);
  }
}
