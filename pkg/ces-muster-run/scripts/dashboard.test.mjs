// W8-DSH tests (PLAN.md §4): the static proof-run dashboard.
//   node --test scripts/dashboard.test.mjs
// Self-contained: every fixture is synthetic (fictional tenant and run names) and written to a fresh temp folder. The
// identity gate is stubbed except in the two Windows-only tests that call the real identity-scan.ps1 on a fixture page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareRuns, discoverScenarios, flippedChecks, summarizeVerify, summarizeGaps, collectData, renderHtml, inlineCss,
  jsonForScript, buildDashboard, scenarioLabel,
} from './dashboard.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const check = (id, pass, detail = `detail ${id}`) => ({ id, title: `title ${id}`, pass, detail });
const verify = (scenario, checks) => ({ pass: checks.every((c) => c.pass), scenario, baseline: 'summary.json', harness: 'tester', checks });
const scorecard = (slug, pass) => ({
  schema: 'ces-muster-run/scorecard@1', scenario: slug, thresholdSource: 'fixture', pass,
  rows: [
    { id: 'SC-1', title: 'P0 rows', value: {}, detail: '7/7', threshold: { minPassed: 7 }, status: 'pass' },
    { id: 'SC-4', title: 'presence-only', value: {}, detail: pass ? '1/10 = 10 %' : '9/10 = 90 %', threshold: { maxPct: 25 }, status: pass ? 'pass' : 'fail' },
    { id: 'SC-5', title: 'placeholders', value: null, detail: 'n/a', threshold: { exempt: true }, status: 'exempt' },
  ],
});
const gapRow = (id, source, module, owner, extra = {}) => ({ weight: 3, control: 'AC.L2-3.1.1', id, source, module, item: `item ${id}`, needs: `needs ${id}`, have: `have ${id}`, owner, ...extra });
const gaps = (slug, rows) => ({ schema: 'ces-muster-run/gaps@1', scenario: slug, rowCount: rows.length, bySource: {}, byModule: {}, byOwner: {}, scorecard: [], notes: [], rows });
const CSS = "@import url('https://fonts.example.invalid/css2?family=Plex');\n:root { --co-bg: #fff; }\n[data-theme=\"dark\"] { --co-bg: #000; }\n";

function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

// A workspace with: muster-partial runs 9 and 10b at expected-outputs\proof-runs\, s1-mach runs 2 and 11, a bundle dir
// (no proof-runs, ignored) and out\ holding a muster-partial run with one check broken and one fixed vs run 10b.
function fixture({ leak = '' } = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'w8-dsh-'));
  const pkg = path.join(ws, 'pkg', 'ces-muster-run');
  const eo = path.join(pkg, 'expected-outputs');
  writeJson(path.join(eo, 'proof-runs', 'nb-run9-mp-w1', 'verify.json'), verify('muster-partial', [check('V1', true), check('V2', false)]));
  const r10 = path.join(eo, 'proof-runs', 'nb-run10b-mp-w2');
  writeJson(path.join(r10, 'verify.json'), verify('muster-partial', [check('V1', true), check('V2', false), check('V3', true)]));
  writeJson(path.join(r10, 'scorecard-muster-partial.json'), scorecard('muster-partial', true));
  writeJson(path.join(r10, 'GAPS-muster-partial.json'), gaps('muster-partial', [gapRow('G-a1', 'documentary', 'content', 'founder content'), gapRow('G-a2', 'unsure', 'Muster', 'BHD')]));
  fs.writeFileSync(path.join(eo, 'proof-runs', 'nb-run5-verify.json'), '{}');
  writeJson(path.join(eo, 's1-mach', 'proof-runs', 'nb-run11-s1-w1', 'verify.json'), verify('s1-mach', [check('V1', true)]));
  writeJson(path.join(eo, 's1-mach', 'proof-runs', 'nb-run2-s1-w0', 'verify.json'), verify('s1-mach', [check('V1', false)]));
  writeJson(path.join(eo, 's1-mach', 'proof-runs', 'nb-run11-s1-w1', 'GAPS-s1-mach.json'), gaps('s1-mach', [gapRow('G-a1', 'documentary', 'content', 'founder content')]));
  fs.mkdirSync(path.join(eo, 'bundle', '01-plans'), { recursive: true });
  const out = path.join(ws, 'out');
  writeJson(path.join(out, 'verify.json'), verify('muster-partial', [check('V1', false, `broken for Northwind Fabrication${leak}`), check('V2', true), check('V3', true), check('V4', true)]));
  writeJson(path.join(out, 'summary.json'), { scenario: 'muster-partial', directives_total: 110, stamper: { status: 'partial', total_tasks: 110, completed: 109, failed: 1, failed_tasks: ['XX.L2-1.1.1.example'] }, eo_assess: { controls_met: 80, controls_not_met: 5, controls_partial: 0, controls_not_assessed: 25, sprs_score: 51 } });
  writeJson(path.join(out, 'scorecard-muster-partial.json'), scorecard('muster-partial', false));
  writeJson(path.join(out, 'GAPS-muster-partial.json'), gaps('muster-partial', [gapRow('G-a1', 'documentary', 'content', 'founder content'), gapRow('G-a3', 'orphan', 'Stamper', 'BHD', { group: 'policy-fixture.md' })]));
  const cssFile = path.join(ws, 'ces', 'ces-shared', 'ui', 'ces-ui.css');
  fs.mkdirSync(path.dirname(cssFile), { recursive: true });
  fs.writeFileSync(cssFile, CSS);
  return { ws, pkg, out, cssFile };
}
const pageData = (html) => JSON.parse(/<script type="application\/json" id="dashboard-data">([\s\S]*?)<\/script>/.exec(html)[1]);

test('runs order by number, then suffix', () => {
  assert.deepEqual(['nb-run65c-s1', 'nb-run9-x', 'nb-run65-s1', 'nb-run65b-s1', 'nb-run10-x'].sort(compareRuns), ['nb-run9-x', 'nb-run10-x', 'nb-run65-s1', 'nb-run65b-s1', 'nb-run65c-s1']);
});

test('discovery: root proof-runs is muster-partial; slug dirs with proof-runs; loose files and bundle ignored', () => {
  const { pkg } = fixture();
  const s = discoverScenarios(pkg);
  assert.deepEqual(s.map((x) => x.slug), ['muster-partial', 's1-mach']);
  assert.deepEqual(s[0].runs, ['nb-run9-mp-w1', 'nb-run10b-mp-w2']);
  assert.deepEqual(s[1].runs, ['nb-run2-s1-w0', 'nb-run11-s1-w1']);
  assert.equal(scenarioLabel('s1-mach'), 'S1 · s1-mach');
  assert.equal(scenarioLabel('muster-partial'), 'mp · muster-partial');
});

test('verify summary keeps detail for failing checks only', () => {
  const v = summarizeVerify(verify('x', [check('V1', true), check('V2', false)]));
  assert.equal(v.passed, 1); assert.equal(v.total, 2); assert.equal(v.pass, false);
  assert.equal(v.checks[0].detail, undefined); assert.equal(v.checks[1].detail, 'detail V2');
  assert.equal(summarizeVerify(null), null);
});

test('flipped checks: broke, fixed, added, removed', () => {
  const base = summarizeVerify(verify('x', [check('V1', true), check('V2', false), check('V9', true)]));
  const cur = summarizeVerify(verify('x', [check('V1', false), check('V2', true), check('V10', true)]));
  assert.deepEqual(flippedChecks(base, cur).map((f) => [f.id, f.kind, f.baseline, f.current]),
    [['V1', 'broke', true, false], ['V2', 'fixed', false, true], ['V9', 'removed', true, null], ['V10', 'added', null, true]]);
  assert.deepEqual(flippedChecks(null, cur), []);
});

test('GAPS rows are pooled across runs', () => {
  const pool = { rows: [], index: new Map() };
  const a = summarizeGaps(gaps('x', [gapRow('G-1', 's', 'm', 'o'), gapRow('G-2', 's', 'm', 'o')]), pool);
  const b = summarizeGaps(gaps('x', [gapRow('G-2', 's', 'm', 'o'), gapRow('G-3', 's', 'm', 'o')]), pool);
  assert.equal(pool.rows.length, 3);
  assert.deepEqual(a.rows, [0, 1]); assert.deepEqual(b.rows, [1, 2]);
});

test('collectData: history, scorecard thresholds, current out\\ vs the newest baseline', () => {
  const { ws, pkg } = fixture();
  const d = collectData({ root: ws, pkgDir: pkg, now: new Date('2026-01-02T03:04:05Z') });
  const mp = d.scenarios[0];
  assert.equal(mp.dir, 'expected-outputs/proof-runs');
  assert.equal(mp.runs[0].scorecard, null);
  assert.deepEqual(mp.runs[1].scorecard.rows.map((r) => [r.id, r.status]), [['SC-1', 'pass'], ['SC-4', 'pass'], ['SC-5', 'exempt']]);
  assert.deepEqual(mp.runs[1].scorecard.rows[1].threshold, { maxPct: 25 });
  assert.equal(d.current.slug, 'muster-partial');
  assert.equal(d.current.baseline, 'nb-run10b-mp-w2');
  assert.deepEqual(d.current.flipped.map((f) => [f.id, f.kind]), [['V1', 'broke'], ['V2', 'fixed'], ['V4', 'added']]);
  assert.equal(d.current.summary.sprs, 51);
  assert.equal(d.current.gaps.rowCount, 2);
  assert.equal(d.gapPool.length, 3);
  assert.equal(d.generatedAt, '2026-01-02T03:04:05.000Z');
  assert.ok(!JSON.stringify(d).includes(ws), 'no absolute path in the embedded data');
});

test('page: self-contained, inline Instrument css without the font import, embedded JSON round-trips', () => {
  const { ws, pkg } = fixture();
  const d = collectData({ root: ws, pkgDir: pkg });
  d.scenarios[0].runs[0].verify.checks[1].detail = '</script><b>x</b>';
  const html = renderHtml(d, CSS);
  assert.ok(!/https?:\/\//.test(html), 'no external URL');
  assert.ok(!/<link\b/.test(html) && !/<script[^>]+src=/.test(html));
  assert.ok(html.includes('[data-theme="dark"] { --co-bg: #000; }'));
  assert.ok(!inlineCss(CSS).includes('@import'));
  assert.ok(html.includes('id="ces-theme-toggle"') && html.includes("'ces-theme'"));
  assert.ok(html.includes('name="viewport"'));
  assert.deepEqual(pageData(html), JSON.parse(JSON.stringify(d)));
  assert.equal(jsonForScript({ a: '</script>' }), '{"a":"\\u003c/script>"}');
  assert.ok(!html.includes(ws));
});

test('build: writes the page when the identity gate passes', () => {
  const { ws, pkg } = fixture();
  const seen = [];
  const r = buildDashboard({ root: ws, pkgDir: pkg, scan: (f) => { seen.push(f); return { ok: true, output: 'clean' }; } });
  assert.equal(r.ok, true);
  assert.equal(r.outFile, path.join(ws, 'dashboard', 'proof-runs.html'));
  assert.deepEqual(seen, [r.outFile]);
  assert.ok(fs.existsSync(r.outFile));
});

test('build: a gate hit deletes the output', () => {
  const { ws, pkg } = fixture();
  const r = buildDashboard({ root: ws, pkgDir: pkg, scan: () => ({ ok: false, output: '1 hit' }) });
  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(r.outFile));
});

const win = process.platform === 'win32';
test('real identity-scan.ps1: clean fixture page passes', { skip: !win && 'Windows PowerShell only' }, () => {
  const { ws } = fixture();
  const r = buildDashboard({ root: ws, pkgDir: PKG });
  assert.equal(r.ok, true, r.scanOutput);
  assert.ok(fs.existsSync(r.outFile));
});
// Slash form: inside embedded JSON a backslash path is written C:\\Users\\..., which the scan's backslash pattern does not match.
test('real identity-scan.ps1: a local profile path in the data is a hit; output deleted', { skip: !win && 'Windows PowerShell only' }, () => {
  const { ws } = fixture({ leak: ' at C:/Users/example/notes.txt' });
  const r = buildDashboard({ root: ws, pkgDir: PKG });
  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(r.outFile));
});
