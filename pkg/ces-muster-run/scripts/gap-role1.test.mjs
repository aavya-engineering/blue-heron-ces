// Depth plan ROLE-1 tests (DEPTH-REPORT-AND-PLAN.md §3 ROLE-1, §5 V100): node --test scripts/gap-role1.test.mjs
// Founder ruling 2026-10-30: Muster only collects data and writes the plan; it receives no execution results. V86 is
// retired (never judged); V100 checks, at harness scope, that the results loop is gone. The mx-e2e.ps1 wiring is checked
// by text (CRLF kept). Nothing in the workspace is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV86, V86_RETIRED, judgeV100, V100_ROUTES_NOTE } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- V86 (retired) ----------
test('V86 reports RETIRED for any input and is never judged', () => {
  assert.equal(V86_RETIRED, 'RETIRED (founder ruling 2026-10-30)');
  for (const args of [undefined, {}, { results: null, report: null, plan: null }, { results: { schema: 'x' }, stale: 'stale' }]) {
    const r = judgeV86(args);
    assert.deepEqual(r, { pass: true, retired: true, detail: V86_RETIRED });
  }
});

test('verify.mjs V86 block reads no evidence and pushes the retired entry; V100 is wired', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.ok(!src.includes('musterResultsFile'), 'V86 no longer reads out/muster-results.json');
  assert.ok(!/judgeV86\(\{/.test(src), 'judgeV86 gets no evidence');
  assert.match(src, /const r = gapmod\.judgeV86\(\); checks\.push\(\{ id: 'V86'/);
  assert.match(src, /check\('V100', /);
  assert.match(src, /gapmod\.judgeV100\(\{ e6: steps\.E6 \?\? null/);
});

// ---------- V100 ----------
const good = (over = {}) => ({
  e6: { rc: 0, overrides: 'not-needed', muster_api_url: false },
  musterResultsPresent: false,
  directiveStatusFiles: [],
  resultsManifest: 'pl/Stamper/plan-data/s1-mach/state/execution-results-mplan_1.json',
  report: { resultsManifest: { totalControls: 4, delivery: { status: 'skipped', reason: 'no Muster endpoint configured (CES_MUSTER_API_URL unset)' } } },
  ...over,
});

test('V100 passes with no Muster URL at E6, no read-back, no status sidecar, the manifest present (delivery skipped or absent)', () => {
  const r = judgeV100(good());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /E6 ran without CES_MUSTER_API_URL/);
  assert.match(r.detail, /execution-results-mplan_1\.json present/);
  assert.match(r.detail, /Stamper delivery skipped/);
  assert.ok(r.detail.endsWith(V100_ROUTES_NOTE));
  const after = judgeV100(good({ report: { resultsManifest: { totalControls: 4 } } }));
  assert.equal(after.pass, true, after.detail);
  assert.match(after.detail, /Stamper delivery absent/);
  assert.equal(judgeV100(good({ report: null })).pass, true);
});

test('V100 fails on each sign of the results loop, and on a missing or stale E6 record', () => {
  const cases = [
    [{ e6: null }, /no steps\.json E6 record/],
    [{ e6: { rc: 0, overrides: 'not-needed', muster_results: { read: true } } }, /has no muster_api_url .*dist\/ not rebuilt/],
    [{ e6: { rc: 0, muster_api_url: true } }, /E6 ran with CES_MUSTER_API_URL set/],
    [{ musterResultsPresent: true }, /out\/muster-results\.json exists/],
    [{ directiveStatusFiles: ['pl/Stamper/plan-data/s1-mach/state/directive-status-mplan_1.json'] }, /1 directive-status file\(s\): pl\/Stamper/],
    [{ resultsManifest: null }, /no execution-results-\*\.json manifest/],
    [{ report: { resultsManifest: { delivery: { status: 'delivered', httpStatus: 200 } } } }, /delivery is "delivered"/],
  ];
  for (const [over, re] of cases) {
    const r = judgeV100(good(over));
    assert.equal(r.pass, false, JSON.stringify(over));
    assert.match(r.detail, re);
    assert.ok(r.detail.endsWith(V100_ROUTES_NOTE));
  }
});

// ---------- harness wiring (mx-e2e.ps1, -Harness mx path) ----------
test('mx-e2e.ps1 ROLE-1: E6 runs Stamper without CES_MUSTER_API_URL, records muster_api_url, keeps no owner record, reads nothing back; muster-api still serves E8F secrets; CRLF kept', () => {
  const raw = fs.readFileSync(path.join(HERE, 'mx-e2e.ps1'), 'utf8');
  assert.ok(!/(^|[^\r])\n/.test(raw), 'CRLF only');
  const src = raw.replace(/\r\n/g, '\n');
  assert.ok(!src.includes('Save-MusterResults'));
  assert.ok(!src.includes("schema = 'mx-e2e/muster-results@1'"));
  assert.ok(!src.includes('/api/plan/status'));
  assert.ok(!src.includes('muster-owner.json'));
  assert.ok(!/\$env:CES_MUSTER_API_URL\s*=/.test(src), 'CES_MUSTER_API_URL is never set');
  const e6 = src.slice(src.indexOf('# ---------- E6: Stamper execute on the sim'), src.indexOf('# ---------- E8.5:'));
  const clear = e6.indexOf('Remove-Item Env:CES_MUSTER_API_URL, Env:CES_MUSTER_API_TOKEN -ErrorAction SilentlyContinue');
  const probe = e6.indexOf('$musterApiUrlSet = [bool]$env:CES_MUSTER_API_URL');
  const exec = e6.indexOf("Invoke-Logged 'E6-execute'");
  assert.ok(clear > 0 && clear < probe && probe < exec, `${clear} ${probe} ${exec}`);
  assert.match(e6, /Record 'E6' \$rc \$t @\{ overrides = .*; muster_api_url = \$musterApiUrlSet \}/);
  assert.ok(!e6.includes('$ownerBytes'));
  // FLOW-5 (a) / API-3a unchanged: E3 starts muster-api, only a non-API push stops it at E4, the Stamper secret source stays.
  assert.match(src, /if \(\$mode -ne 'api'\) \{ Stop-Tree \$apiProc; \$apiProc = \$null; \$MusterToken = \$null \}/);
  assert.match(src, /function Use-StamperSecret \{ if \(\$MusterToken -and \$apiProc -and -not \$apiProc\.HasExited\) \{ \$env:CES_MUSTER_SECRETS_URL = \$MusterUrl/);
  // The per-run cleanup still removes an older run's muster-results.json (V100 would fail on it).
  assert.match(src, /muster-results\\\.json\|eo-records\\\.json\|/);
});
