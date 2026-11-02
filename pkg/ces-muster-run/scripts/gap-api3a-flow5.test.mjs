// Gap closure API-3a / FLOW-5 tests (GAP-CLOSURE-PLAN.md §4 G-API, G-FLOW; §5 V88): node --test scripts/gap-api3a-flow5.test.mjs
// plan-compile.mjs (E3's muster-api client) against a stub fetch; the V88 judge and plan comparison over synthetic fixtures;
// the harness wiring in mx-e2e.ps1 by text (CRLF kept). Writes only under the OS temp folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBody, writeCompiledFiles, runCompile, PLAN_COMPILE_SCHEMA } from './plan-compile.mjs';
import { judgeV88, v88ComparePlans, v88Normalize, v88ReadPlanDir, V88_RECORD_SCHEMA } from './verify-gap.mjs';
import { HARNESS_GENERATED_KEYS } from './overrides-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gap-api3a-'));

// ---------- plan-compile.mjs ----------
test('compileBody: sends the file texts and only the options given', () => {
  assert.deepEqual(compileBody({ slug: 's1', discoveryText: '{}' }), { tenant_slug: 's1', max_reads: 2, discovery: '{}' }); // FIN-17 SP-7: E6 + E8F
  assert.deepEqual(
    compileBody({ slug: 's3', discoveryText: '{}', orgContentText: '{"a":1}', answersText: '[]', stacks: ['m365_e5_gcc', 'microsoft_intune'], tenantHarvest: 'off' }),
    { tenant_slug: 's3', max_reads: 2, discovery: '{}', org_content: '{"a":1}', interview_answers: '[]', stacks: ['m365_e5_gcc', 'microsoft_intune'], tenant_harvest: 'off' },
  );
});

test('writeCompiledFiles: utf8 and base64, sub-folders, and refuses a name that leaves the plan folder', () => {
  const d = tmp();
  try {
    const w = writeCompiledFiles(path.join(d, 'plan'), [
      { name: 'manual-mission-plan-s1-T.json', encoding: 'utf8', content: '{"x":1}' },
      { name: 'policies/p.docx', encoding: 'base64', content: Buffer.from([1, 2, 3]).toString('base64') },
    ]);
    assert.equal(fs.readFileSync(path.join(d, 'plan', 'manual-mission-plan-s1-T.json'), 'utf8'), '{"x":1}');
    assert.deepEqual([...fs.readFileSync(path.join(d, 'plan', 'policies', 'p.docx'))], [1, 2, 3]);
    assert.equal(w[1].bytes, 3);
    assert.match(w[0].sha256, /^[0-9a-f]{64}$/);
    assert.throws(() => writeCompiledFiles(path.join(d, 'plan'), [{ name: '../escape.json', encoding: 'utf8', content: '' }]), /outside the plan folder/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('runCompile: posts to /api/plan/compile with the bearer token; writes the files and a value-free record', async () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, 'disc.json'), '{"manifest":{}}');
    const calls = [];
    const ref = 'secretref:one-time:11111111-2222-3333-4444-555555555555';
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { status: 200, text: async () => JSON.stringify({ summary: 'plan_files=1', initial_password_ref: ref, files: [{ name: 'tenant-manifest-s1-T.json', encoding: 'utf8', content: '{}' }, { name: 'manual-mission-plan-s1-T.json', encoding: 'utf8', content: '{}' }] }) };
    };
    const rc = await runCompile({ api: 'http://127.0.0.1:4011', token: 'tok', slug: 's1', disc: path.join(d, 'disc.json'), out: path.join(d, 'plan'), record: path.join(d, 'rec.json'), stacks: 'a,b' }, fetchImpl);
    assert.equal(rc, 0);
    assert.equal(calls[0].url, 'http://127.0.0.1:4011/api/plan/compile');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(calls[0].init.body), { tenant_slug: 's1', max_reads: 2, discovery: '{"manifest":{}}', stacks: ['a', 'b'] });
    const rec = JSON.parse(fs.readFileSync(path.join(d, 'rec.json'), 'utf8'));
    assert.equal(rec.schema, PLAN_COMPILE_SCHEMA);
    assert.equal(rec.http_status, 200);
    assert.equal(rec.initial_password_ref, ref);
    assert.equal(rec.files.length, 2);
    assert.ok(!JSON.stringify(rec).includes('"value"'));
    const bad = await runCompile({ api: 'http://x', token: 't', slug: 's1', disc: path.join(d, 'disc.json'), out: path.join(d, 'plan2'), record: path.join(d, 'rec2.json') },
      async () => ({ status: 422, text: async () => JSON.stringify({ error: 'plan compile failed', detail: 'blocked' }) }));
    assert.equal(bad, 1);
    assert.match(JSON.parse(fs.readFileSync(path.join(d, 'rec2.json'), 'utf8')).error, /plan compile failed: blocked/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------- V88 plan comparison ----------
const REF_A = 'secretref:one-time:aaaaaaaa-1111-2222-3333-444444444444';
const REF_B = 'secretref:one-time:bbbbbbbb-1111-2222-3333-444444444444';
const side = (ts, ces, gid, ref, traceRef, extra = {}) => [
  { name: `manual-mission-plan-s1-${ts}.json`, kind: 'json', text: JSON.stringify({ ces: { cesId: ces, createdAt: '2026-10-30T18:16:54.225Z' }, inputs: { snapshot_id: `snapshot_${gid}`, hash_sha256: (ces === 'tPyoPlhnmLAOSMKCrQwpG' ? 'a' : 'b').repeat(64) }, ...extra }) },
  { name: `infrastructure-manifest-s1-${ts}.json`, kind: 'json', text: JSON.stringify({ infrastructure: { secret_references: [{ variable: 'initialPassword', form: 'one_time_operator_held', ref }], scope: `/subscriptions/sub_${gid}` } }) },
  { name: `cui-boundary-s1-${ts}.json`, kind: 'json', text: JSON.stringify({ artifact_id: `cui-boundary-${ces}`, generated_epoch: `si_baseline_${ts === '2026-10-30T18-16-54-225Z' ? '1793384214072' : '1793384216054'}` }) },
  { name: 'plan-trace.json', kind: 'json', text: JSON.stringify({ initial_password_ref: traceRef, files: { missionPlan: `manual-mission-plan-s1-${ts}.json` } }) },
  { name: 'policies/access-control-policy.docx', kind: 'docx', text: 'Access Control Policy\nEffective 2026-10-30T18:16:54Z\n' },
  { name: 'policies/access-control-policy.md', kind: 'text', text: `# Access Control Policy\nPlan ${ces}\n` },
];
const api = side('2026-10-30T18-16-54-225Z', 'tPyoPlhnmLAOSMKCrQwpG', 'mvvannso_ws1msfh', REF_A, 'issued by muster-api (sim-only; muster-api holds the value)');
const script = side('2026-10-30T18-16-56-208Z', 'V0sR7QbcSLR30baeHTp8u', 'mvvanpbq_c48xvfi', REF_B, 'generated (sim-only, headless runner)');

test('v88ComparePlans: equal minus timestamps, ids, hashes, epochs and the trace\'s initial_password_ref', () => {
  const c = v88ComparePlans(api, script);
  assert.deepEqual({ compared: c.compared, onlyApi: c.onlyApi, onlyScript: c.onlyScript, differing: c.differing }, { compared: 6, onlyApi: [], onlyScript: [], differing: [] });
});

test('v88ComparePlans: a real difference, a missing file and an extra key are reported', () => {
  const changed = side('2026-10-30T18-16-54-225Z', 'tPyoPlhnmLAOSMKCrQwpG', 'mvvannso_ws1msfh', REF_A, 'issued', { directive: 'implement' });
  const c = v88ComparePlans(changed, script);
  assert.equal(c.differing.length, 1);
  assert.match(c.differing[0].where, /keys differ: directive/);
  const md = api.map((f) => (f.kind === 'text' ? { ...f, text: '# Access Control Policy\nPlan for someone else\n' } : f));
  assert.match(v88ComparePlans(md, script).differing[0].where, /^line 2$/);
  const fewer = v88ComparePlans(api.slice(1), script);
  assert.equal(fewer.onlyScript.length, 1);
  assert.match(fewer.onlyScript[0], /^manual-mission-plan-s1-<ts>\.json$/);
});

test('v88Normalize: run-variant tokens only', () => {
  assert.equal(v88Normalize('x-2026-10-30T18-16-54-225Z.json at 2026-10-30T18:16:54.225Z'), 'x-<ts>.json at <ts>');
  assert.equal(v88Normalize('task_AC.L1-3.1.1_mvvannuo_rkszk8h'), 'task_AC.L1-3.1.1_<gid>');
  assert.equal(v88Normalize('access-control-policy'), 'access-control-policy');
});

test('v88ReadPlanDir: kinds by extension; null when absent', async () => {
  const d = tmp();
  try {
    fs.mkdirSync(path.join(d, 'reports'));
    fs.writeFileSync(path.join(d, 'a.json'), '{}');
    fs.writeFileSync(path.join(d, 'reports', 'r.html'), '<p>x</p>');
    fs.writeFileSync(path.join(d, 'b.bin'), Buffer.from([0]));
    const r = await v88ReadPlanDir(d, () => 'docx text');
    assert.deepEqual(r.map((f) => [f.name, f.kind]).sort(), [['a.json', 'json'], ['b.bin', 'binary'], ['reports/r.html', 'text']]);
    assert.equal(await v88ReadPlanDir(path.join(d, 'nope'), () => ''), null);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------- judgeV88 ----------
const REF = 'secretref:one-time:11111111-2222-3333-4444-555555555555';
const good = (over = {}) => ({
  steps: { E3: { rc: 0, mode: 'api', script_twin_rc: 0 } },
  record: { schema: V88_RECORD_SCHEMA, http_status: 200, initial_password_ref: REF, files: [{ name: 'a.json', sha256: 'h1' }] },
  recordStale: null,
  planFileSha: { 'a.json': 'h1' },
  compare: { compared: 64, onlyApi: [], onlyScript: [], differing: [], examples: [] },
  twinRc: 0,
  logs: { 'logs/E3-plan.out': 'MX_SUMMARY plan_files=12', 'steps.json': '{}', 'tester-run.json': '{"commands":["CES_MUSTER_SECRETS_URL=http://127.0.0.1:4011"]}' },
  overridesLog: { mode: 'not-needed', harness_generated: [] },
  tm: { tenant_manifest: { tenant_identity: { operatorUPN: 'op@x' } } },
  im: { infrastructure: { stamper_variable_map: {}, secret_references: [{ variable: 'initialPassword', form: 'one_time_operator_held', ref: REF }] } },
  plan: { variables: { initialPassword: '<<CES_SECRET:initialPassword>>', _secret_references: [{ variable: 'initialPassword', form: 'one_time_operator_held', ref: REF }] } },
  e6Out: `Secret reference ${REF} for initialPassword: resolved from muster-api (held in memory only)\n`,
  ...over,
});

test('judgeV88: passes on a muster-api compile, an equal twin, no harness password, the reference pushed and resolved', () => {
  const r = judgeV88(good());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /64 plan files equal/);
  const tmOnly = judgeV88(good({ im: null, tm: { tenant_manifest: { provisioning_inputs: { initial_password_ref: { variable: 'initialPassword', form: 'one_time_operator_held', ref: REF } } } } }));
  assert.equal(tmOnly.pass, true, tmOnly.detail);
});

test('judgeV88: each part fails on its own', () => {
  const cases = [
    [{ steps: { E3: { rc: 0 } } }, /\(a\) E3 did not compile through muster-api/],
    [{ record: null }, /\(a\) no out\/plan-compile\.json/],
    [{ record: { ...good().record, http_status: 422, error: 'plan compile failed' } }, /HTTP 422/],
    [{ planFileSha: { 'a.json': 'other' } }, /out\/plan files differ from what the route returned/],
    [{ compare: null, twinRc: 1 }, /\(b\) no out\/plan-script .*exited 1/],
    [{ compare: { compared: 3, onlyApi: [], onlyScript: [], differing: [{ name: 'x.json', where: '$.a' }], examples: [{ name: 'x.json', where: '$.a' }] } }, /\(b\) 1 of 3 files differ.*x\.json at \$\.a/],
    [{ logs: { 'logs/E4-push.out': 'STAMPER_INITIAL_PASSWORD=<run-only>' } }, /\(c\) .*logs\/E4-push\.out/],
    [{ overridesLog: { harness_generated: ['initialPassword'] } }, /\(c\) E6-overrides\.json still lists/],
    [{ e6Out: 'Secret input initialPassword: supplied from STAMPER_INITIAL_PASSWORD (held in memory only)\n' }, /\(c\) E6 took initialPassword from the harness environment/],
    [{ im: { infrastructure: { secret_references: [] } } }, /\(d\) neither the pushed TM/],
    [{ im: { infrastructure: { secret_references: [{ variable: 'initialPassword', form: 'one_time_operator_held', ref: REF.replace('1111', '9999') }] } } }, /\(d\) the pushed reference is not E3's/],
    [{ im: { infrastructure: { stamper_variable_map: { initialPassword: 'Plain-Value-1' }, secret_references: good().im.infrastructure.secret_references } } }, /\(d\) a plain initialPassword in IM/],
    [{ e6Out: 'Secret reference x for initialPassword: NOT resolved by muster-api (HTTP 404)\n' }, /\(e\) .*NOT resolved/],
  ];
  for (const [over, re] of cases) {
    const r = judgeV88(good(over));
    assert.equal(r.pass, false, `expected a failure for ${JSON.stringify(over).slice(0, 80)}`);
    assert.match(r.detail, re);
  }
});

// ---------- harness wiring (text) ----------
const ps1 = fs.readFileSync(path.join(HERE, 'mx-e2e.ps1'), 'utf8');
test('mx-e2e.ps1 stays CRLF-only', () => {
  assert.ok(!/[^\r]\n/.test(ps1), 'a bare LF line ending');
});
test('FLOW-5 (a): no harness-generated initialPassword; Stamper gets the muster-api secret source at E6 and E8F', () => {
  assert.ok(!/New-InitialPassword\s*\{/.test(ps1) && !/\$env:STAMPER_INITIAL_PASSWORD\s*=/.test(ps1));
  assert.match(ps1, /function Use-StamperSecret \{ if \(\$MusterToken .*\$env:CES_MUSTER_SECRETS_URL = \$MusterUrl; \$env:CES_MUSTER_SECRETS_TOKEN = \$MusterToken/);
  assert.equal((ps1.match(/Use-SimEnv; Use-StamperSecret/g) ?? []).length, 3);
  assert.deepEqual([...HARNESS_GENERATED_KEYS], []);
});
test('API-3a: E3 compiles through plan-compile.mjs; muster-api starts at E3 and is not stopped at E6', () => {
  assert.match(ps1, /\$apiProc = Start-Bg 'E3-muster-api'/);
  assert.match(ps1, /Join-Path \$PSScriptRoot 'plan-compile\.mjs'/);
  assert.match(ps1, /Invoke-Logged 'E3-plan-script' .*plan-from-discovery\.ts/);
  const e6 = ps1.slice(ps1.indexOf('# ---------- E6:'), ps1.indexOf('# ---------- E8.5:'));
  assert.ok(!/Stop-Tree \$apiProc/.test(e6), 'E6 still stops muster-api');
});
test('FLOW-5 (b): the E4 fallback copies every envelope', () => {
  const m = /foreach \(\$pfx in @\(([^)]*)\)\)/.exec(ps1);
  const pfx = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  for (const p of ['manual-mission-plan', 'tenant-manifest', 'infrastructure-manifest', 'si-baseline', 'tcp', 'readiness-posture', 'policy-inputs-profile', 'policy-set-manifest', 'cui-boundary']) assert.ok(pfx.includes(p), p);
});
test('harness fix: the EC reset also clears ec_* rows with ces-tester\'s compiled helper', () => {
  assert.match(ps1, /\$helper = Join-Path \$CES 'ces-tester\\dist\\src\\flow\\ec-reset\.js'/);
  assert.match(ps1, /m\.clearEcRows\(process\.argv\[2\]\)/);
  const e85 = ps1.slice(ps1.indexOf("Remove-Item -Recurse -Force (Join-Path $PL 'EvidenceCollector')"));
  assert.match(e85.split('\n')[1], /EC reset: \$\(Clear-EcRows\)/);
});
