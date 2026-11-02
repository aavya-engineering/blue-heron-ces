// Gap closure VER-1 tests (GAP-CLOSURE-PLAN.md §5 V74, V75): node --test scripts/gap-vchecks.test.mjs
// V74 runs against ces-shared's BUILT guard (<WS>\ces\ces-shared\dist\security\psGuard.js) and, for the S1 test, the W8 S1
// executable plan under <WS>\evidence; a test whose file is absent is skipped with the path. V75 fixtures are synthetic.
// Nothing in the workspace is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { judgeV74, judgeV75, planCommands, aoTemplates, singleLiteralSpans, BREAKOUT_PAYLOADS } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, '..', '..', '..');
const GUARD = path.join(WS, 'ces', 'ces-shared', 'dist', 'security', 'psGuard.js');
const S1_PLAN = path.join(WS, 'evidence', 'w8-s1-eu-5', 'ui', 'spa', 'executable-plan.json');
const guard = fs.existsSync(GUARD) ? await import(pathToFileURL(GUARD).href) : null;
const noGuard = guard ? false : `built guard absent: ${GUARD}`;

const src = (template, where = 'T') => ({ where, template });
// A guard whose renderPs substitutes naively (no escaping, no rejection): every breakout must be caught.
const leaky = guard ? { ...guard, renderPs: (t, vars) => guard.psContext(t).reduceRight((s, ph) => (Object.hasOwn(vars, ph.name) ? s.slice(0, ph.start) + vars[ph.name] + s.slice(ph.end) : s), t) } : null;

test('V74 payload table: 40+ payloads, each refused by the double-quoted guard', { skip: noGuard }, () => {
  assert.ok(BREAKOUT_PAYLOADS.length >= 40, `${BREAKOUT_PAYLOADS.length}`);
  for (const p of BREAKOUT_PAYLOADS) assert.throws(() => guard.psDoubleQuotedSafe(p), JSON.stringify(p));
});

test('V74 lexer: single literals, doubled quotes, here-strings, quotes inside double-quoted text and $( )', () => {
  const s = "Get-X -A 'it''s' -B \"a'b $('in') c\" # 'cmt'\n$h = @'\nraw 'x'\n'@; 'end'";
  const spans = singleLiteralSpans(s).map((sp) => [s.slice(sp.start, sp.end), sp.kind]);
  assert.deepEqual(spans, [["it''s", 'single'], ['in', 'single'], ["raw 'x'", 'here-single'], ['end', 'single']]);
  assert.deepEqual(singleLiteralSpans("'open"), []);
});

test('V74: the built guard gives zero passes over single, double, bare, here-single and mixed spots', { skip: noGuard }, () => {
  const sources = [
    src("Set-Thing -Name '{name}' -Id '{name}'"),
    src('Set-Thing -Name "{display}"'),
    src('Set-Thing -Id {id} -Group ${group}'),
    src("$b = @'\n{body}\n'@; Set-Thing -Body $b"),
    src("Set-Thing -A '{mixed}' -B {mixed}"),
    src("Set-Thing -A ‘{smart}’"),
    src("Get-Thing | Where-Object { $_.Name -eq '{x}' } | ForEach-Object { \"$($_.Id): {y}\" }"),
  ];
  const r = judgeV74({ aoSources: sources.slice(0, 4), aoCommands: 4, planSources: sources.slice(4), guard });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /0 passes/);
  assert.match(r.detail, /AO 4 commands, 4 templates/);
  assert.match(r.detail, /plan 3 commands/);
  assert.match(r.detail, /single-quoted [1-9]\d* contained/);
  assert.match(r.detail, /double\/bare [1-9]\d* rejected/);
});

test('V74: a leaky renderer is caught in single, double and bare spots', { skip: noGuard }, () => {
  for (const t of ["Set-Thing -Name '{n}'", 'Set-Thing -Name "{n}"', 'Set-Thing -Name {n}', "$b = @'\n{n}\n'@"]) {
    const r = judgeV74({ aoSources: [src(t)], planSources: [], guard: leaky });
    assert.equal(r.pass, false, t);
    assert.match(r.detail, /[1-9]\d* breakout/, t);
  }
});

test('V74: a guard that misclassifies a bare spot as single-quoted is caught by the independent lexer', { skip: noGuard }, () => {
  const ctx = (t) => guard.psContext(t).map((ph) => ({ ...ph, context: 'single', quote: "'" }));
  const dbl = (v) => [...v].map((ch) => ("'‘’‚‛".includes(ch) ? ch + ch : ch)).join('');
  const wrong = { ...guard, psContext: ctx, renderPs: (t, vars) => ctx(t).reduceRight((s, ph) => (Object.hasOwn(vars, ph.name) ? s.slice(0, ph.start) + dbl(vars[ph.name]) + s.slice(ph.end) : s), t) };
  const r = judgeV74({ aoSources: [src('Set-Thing -Name {n}')], planSources: [], guard: wrong });
  assert.equal(r.pass, false);
  assert.match(r.detail, /not inside one single-quoted literal/);
});

test('V74 floors: missing guard, missing plan, too few payloads, an unblocked payload and a vacuous run all fail', { skip: noGuard }, () => {
  assert.equal(judgeV74({ aoSources: [], planSources: [], guard: null }).pass, false);
  assert.match(judgeV74({ aoSources: [src("'{a}'")], planSources: null, guard }).detail, /executable plan not loaded/);
  assert.match(judgeV74({ aoSources: [src("'{a}'")], planSources: [], guard, payloads: BREAKOUT_PAYLOADS.slice(0, 10) }).detail, /10 payloads/);
  assert.match(judgeV74({ aoSources: [src("'{a}'")], planSources: [], guard, payloads: [...BREAKOUT_PAYLOADS, 'plain'] }).detail, /hold no double-quoted-blocklist char/);
  assert.match(judgeV74({ aoSources: [src('Get-Thing')], planSources: [], guard }).detail, /vacuous/);
});

test('V74 sources: planCommands and aoTemplates collect the executed command strings only', () => {
  const plan = { execution_graph: [{ id: 't1', action: { command: "Set-A '{x}'", args: { _get_command: 'Get-A', _evidence_commands: ['E1'], powershell_commands: ['P1'], _sub_commands: [{ id: 's1', set_command: 'S', get_command: 'G', evidence_commands: ['SE'], destructive_guard: { preview_command: 'PV', exclusion_checks: ['X1'] }, lookup: { source: 'not-a-command' } }] } } }] };
  assert.deepEqual(planCommands(plan).map((x) => x.template), ["Set-A '{x}'", 'Get-A', 'E1', 'P1', 'S', 'G', 'SE', 'PV', 'X1']);
  const ao = aoTemplates((c) => ({ set_command: c.id === 'A' ? 'Set-A {x}' : '', get_command: 'Get-A', evidence_commands: ['Get-MgUser'] }), [{ id: 'A' }, { id: 'B' }]);
  assert.deepEqual(ao.map((x) => x.where), ['AO A:set_command', 'AO A:get_command', 'AO A:evidence_commands[0]', 'AO B:get_command', 'AO B:evidence_commands[0]']);
});

test('V74: the W8 S1 executable plan passes with the built guard', { skip: noGuard || (fs.existsSync(S1_PLAN) ? false : `S1 plan absent: ${S1_PLAN}`) }, () => {
  const plan = JSON.parse(fs.readFileSync(S1_PLAN, 'utf8').replace(/^﻿/, ''));
  const r = judgeV74({ aoSources: [], planSources: planCommands(plan), guard, kinds: { operatorUPN: 'upn', breakGlassUPN: 'upn', approverUPN: 'upn' } });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /plan [1-9]\d* commands/);
  assert.match(r.detail, /[1-9]\d* renders/);
});

// ---------- V75 ----------
const E1 = '2026-10-30T11:27:04.240Z';
const goodSteps = () => ({ E1: { rc: 0, started: E1 }, E7A: { rc: 0, started: '2026-10-30T11:34:21.351Z' }, TESTER: { rc: 0 }, AUTH: { rc: 0 } });
const goodE7a = () => ({ ok: true, started: '2026-10-30T11:34:21.973Z', ops: [{ op: 'A-11', ok: true }] });
const goodProbe = () => ({
  schema: 'mx-e2e/auth-probe@1', taken: '2026-10-30T11:50:00.000Z',
  ao: { url: 'http://127.0.0.1:3000', up: true, health: { status: 200, body: { status: 'ok', version: '1', registryLoaded: true, auth: 'ENFORCED', bind: '127.0.0.1' } }, api_no_token: { status: 401 }, api_with_token: { status: 200, body: null } },
  eo: { url: 'http://127.0.0.1:4002', up: true, health_no_token: { status: 401 }, health: { status: 200, body: { status: 'ok' } }, api_no_token: { status: 401 } },
  // FIN-42 V75 clause (b): AO once more from a DPAPI module-secret store, no env token.
  ao_store: { url: 'http://127.0.0.1:3000', store: 'out/fin42/module-secrets.dpapi', names: ['CES_AO_AUTH_TOKEN'], generated: true, env_token: false, up: true, health: { status: 200, body: { status: 'ok', auth: 'ENFORCED', bind: '127.0.0.1' } }, api_no_token: { status: 401 }, store_removed: true },
});
const v75 = (over = {}) => judgeV75({ probe: goodProbe(), steps: goodSteps(), e7a: goodE7a(), ...over });

test('V75: a good probe passes and reports bind without judging it', () => {
  const r = v75();
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /bind "127\.0\.0\.1" \(reported, not judged\)/);
  const p = goodProbe(); p.ao.health.body.bind = '0.0.0.0';
  assert.equal(v75({ probe: p }).pass, true);
  delete p.ao.health.body.bind;
  assert.equal(v75({ probe: p }).pass, true);
});

test('V75: an absent or stale probe file fails with a clear reason', () => {
  const r = judgeV75({ probe: null, steps: goodSteps(), e7a: goodE7a() });
  assert.equal(r.pass, false);
  assert.match(r.detail, /no out\/auth-probe\.json/);
  assert.match(v75({ stale: 'stale artefact from an earlier run: auth-probe.json' }).detail, /stale artefact/);
});

test('V75: each judged field flipped fails', () => {
  const flips = [
    (p) => { p.ao.health.body.auth = 'LOOPBACK_TRUSTED'; },
    (p) => { p.ao.health.status = 500; },
    (p) => { p.ao.api_no_token.status = 200; },
    (p) => { p.ao.api_with_token.status = 401; },
    (p) => { p.ao.up = false; },
    (p) => { p.eo.up = false; },
    (p) => { p.eo.api_no_token.status = 200; },
    (p) => { p.eo.health.status = 401; },
    (p) => { p.schema = 'other'; },
    (p) => { p.error = 'boom'; },
    (p) => { p.taken = '2026-10-29T00:00:00.000Z'; },
    (p) => { delete p.ao_store; },
    (p) => { p.ao_store.error = 'generator refused'; },
    (p) => { p.ao_store.generated = false; },
    (p) => { p.ao_store.env_token = true; },
    (p) => { p.ao_store.up = false; },
    (p) => { p.ao_store.health.status = 500; },
    (p) => { p.ao_store.health.body.auth = 'LOOPBACK_TRUSTED'; },
    (p) => { p.ao_store.api_no_token.status = 200; },
    (p) => { p.ao_store.store_removed = false; },
  ];
  for (const f of flips) { const p = goodProbe(); f(p); assert.equal(v75({ probe: p }).pass, false, f.toString()); }
  const s1 = goodSteps(); s1.E7A.rc = 1; assert.equal(v75({ steps: s1 }).pass, false);
  const s2 = goodSteps(); delete s2.E7A; assert.equal(v75({ steps: s2 }).pass, false);
  const s3 = goodSteps(); s3.TESTER.rc = 1; assert.equal(v75({ steps: s3 }).pass, false);
  assert.equal(v75({ e7a: null }).pass, false);
  assert.equal(v75({ e7a: { ...goodE7a(), ok: false } }).pass, false);
  assert.equal(v75({ e7a: { ...goodE7a(), started: '2026-10-30T10:00:00.000Z' } }).pass, false);
});

test('V75: EO tokenless /api/health and steps AUTH are reported, not judged', () => {
  const p = goodProbe(); p.eo.health_no_token.status = 200;
  const s = goodSteps(); s.AUTH.rc = 1;
  const r = v75({ probe: p, steps: s });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /EO tokenless \/api\/health 200; steps AUTH rc 1/);
});

test('verify.mjs registers V74 and V75 through verify-gap.mjs', () => {
  const v = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.match(v, /import\('\.\/verify-gap\.mjs'\)/);
  assert.match(v, /check\('V74'/);
  assert.match(v, /check\('V75'/);
  assert.match(v, /'ces-shared', 'dist', 'security', 'psGuard\.js'/);
  assert.equal(v.includes('\r'), false, 'verify.mjs stays LF');
});

// ---------- V75 clause (b) (FIN-42 / SP-4) ----------
test('V75 (b): the module-secret-store probe is judged and named in the pass detail; its absence fails with a clear reason', () => {
  const r = v75();
  assert.equal(r.pass, true, r.detail);
  assert.ok(r.detail.includes('(b) AO from the DPAPI module-secret store (no env token)'), r.detail);
  const p = goodProbe(); delete p.ao_store;
  assert.ok(v75({ probe: p }).detail.includes('(b) no ao_store in the probe'));
  const q = goodProbe(); q.ao_store.health.body.auth = 'LOOPBACK_TRUSTED';
  assert.ok(v75({ probe: q }).detail.includes('(b) AO /api/health auth "LOOPBACK_TRUSTED" (want "ENFORCED")'));
});

test('V75 (b): mx-e2e.ps1 writes the store under out, starts AO without CES_AO_AUTH_TOKEN, deletes the store, stays CRLF-only', () => {
  const raw = fs.readFileSync(path.join(HERE, 'mx-e2e.ps1'), 'utf8');
  assert.ok(!/[^\r]\n/.test(raw), 'a bare LF line ending');
  const start = raw.indexOf('function Invoke-AuthProbeStore');
  const end = raw.indexOf('function Invoke-AuthProbe {');
  assert.ok(start > -1 && end > start, 'Invoke-AuthProbeStore is defined before Invoke-AuthProbe');
  const fn = raw.slice(start, end);
  assert.ok(fn.includes("Join-Path $OUT 'fin42'"));
  assert.ok(fn.includes('& $gen -Path $store -NoAcl -Force -Names CES_AO_AUTH_TOKEN'));
  assert.ok(fn.indexOf('Remove-Item Env:CES_AO_AUTH_TOKEN') < fn.indexOf("Start-Bg 'AUTH-ao-store'"), 'the env token is removed before AO starts');
  assert.ok(fn.includes('$env:CES_MODULE_SECRETS_PATH = $store'));
  assert.ok(fn.indexOf('Remove-Item $dir -Recurse -Force') > fn.indexOf('finally {'), 'the store is removed in finally');
  assert.ok(!/loadModuleSecrets|Unprotect|Write-Host/.test(fn), 'the probe never reads or prints the store value');
  assert.ok(raw.includes('$probe.ao_store = Invoke-AuthProbeStore $aoUrl\r\n  $probe | ConvertTo-Json'));
  assert.ok(raw.includes("-and ($probe.ao_store.health.body.auth -eq 'ENFORCED') -and ($probe.ao_store.api_no_token.status -eq 401)"));
});
