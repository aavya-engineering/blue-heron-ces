// PH-5 (R-F2 red closure, agent R-MX): the package-side fixes. V117's freshness reference (verify-gap.mjs
// runWindowStart), V77's evidenced "not applicable" state (verify-fin29-ao.mjs judgeV77), V116's pseudo-console host
// (conpty-run.ps1 calls Add-Type module-qualified, CRLF only), and R-EO's V81 / V128 diffs. No run needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWindowStart, stepStartMs, V81_INTERVIEW_EXPECTED } from './verify-gap.mjs';
import { judgeV77 } from './verify-fin29-ao.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- V117 ----------
test('V117: the freshness reference is E0 start when E0 ran, else E1; neither -> not judged', () => {
  const e0 = '2026-11-01T00:36:33.635Z';
  const e1 = '2026-11-01T00:36:41.522Z';
  assert.deepEqual(runWindowStart({ E0: { started: e0 }, E1: { started: e1 } }), { ms: Date.parse(e0), step: 'E0', started: e0 });
  assert.deepEqual(runWindowStart({ E1: { started: e1 } }), { ms: Date.parse(e1), step: 'E1', started: e1 });
  assert.ok(Number.isNaN(runWindowStart({}).ms));
  assert.equal(stepStartMs('/Date(1761957393635)/'), 1761957393635);
  assert.equal(stepStartMs('2026-11-01T00:36:41.522'), Date.parse(e1), 'no zone: read as UTC');
});

test('V117: E0\'s own artefact (written 1 ms before E1) is fresh; a file from before E0 is still stale', () => {
  const ref = runWindowStart({ E0: { started: '2026-11-01T00:36:33.635Z' }, E1: { started: '2026-11-01T00:36:41.522Z' } }).ms;
  const stale = (mtimeMs) => mtimeMs < ref;
  assert.equal(stale(Date.parse('2026-11-01T00:36:41.521Z')), false, 'R-F2: e0-clean-tenant.json, 1 ms before E1');
  assert.equal(stale(Date.parse('2026-11-01T00:30:00.000Z')), true, 'an earlier run\'s file');
});

test('V117: verify.mjs judges staleness against runWindowStart and names the step', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.match(src, /const freshRef = runWindowStart\(steps\);/);
  assert.match(src, /before this run's \$\{freshRef\.step\} start \$\{freshRef\.started\}/);
});

// ---------- V77 ----------
const steps = { E1: { started: '2026-11-01T10:00:00.000Z' }, E7B: { ended: '2026-11-01T10:20:00.000Z' }, E8F: { ended: '2026-11-01T10:30:00.000Z' } };
const call = (op, kind) => ({ call: kind, rc: 0, ok: true, success: true, mode: kind === 'apply' ? 'live' : 'dry_run', evidence_row_id: `${op}:${kind}`, two_person_mode: 'off', error_class: null });
const op = (id) => ({ op: id, tier: 'T2', params: [], calls: [call(id, 'dry_run'), call(id, 'apply')], dry_run_ok: true, applied: true });
const na = (id, why) => ({ op: id, tier: 'T2', params: [], calls: [], dry_run_ok: false, applied: false, not_applicable: why });
const sweep = (ops) => ({
  schema: 'ces-tester/ao-sweep@1', slug: 's1-mach', taken: '2026-11-01T10:40:00.000Z', started: '2026-11-01T10:31:00.000Z', ended: '2026-11-01T10:39:00.000Z',
  tenant_id: 'sim-tenant-s1-mach', two_person_approval: 'off', expected_commands: ops.length, apply_floor: 0,
  totals: { dry_run_ok: ops.filter((o) => o.dry_run_ok).length, apply_skipped: 0, not_applicable: ops.filter((o) => o.not_applicable).length }, ops,
});
const rowsFor = (rec) => new Map(rec.ops.flatMap((o) => o.calls.map((c) => [c.evidence_row_id, { tenantId: rec.tenant_id, metadata: {} }])));

test('V77: an op not applicable with the discovery\'s absence proof is green and counted', () => {
  const rec = sweep([op('A-01'), na('A-10', 'no standing Global Administrator; discovery: standing_admin_upn: no simulator object: standing GA')]);
  const rows = rowsFor(rec);
  const r = judgeV77({ slug: 's1-mach', record: rec, steps, registryIds: ['A-01', 'A-10'], rowOf: (id) => rows.get(id) ?? null, dbReadable: true });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /1 not applicable \(resource absent: A-10\)/);
});

test('V77: "not applicable" without the proof, or with calls made, is red', () => {
  const noProof = sweep([na('A-10', 'no standing Global Administrator')]);
  assert.match(judgeV77({ slug: 's1-mach', record: noProof, steps, registryIds: ['A-10'], rowOf: () => null, dbReadable: true }).detail, /without the discovery's absence proof: A-10/);
  const withCalls = sweep([{ ...na('A-10', 'x; discovery: standing_admin_upn: no simulator object: y'), calls: [call('A-10', 'dry_run')] }]);
  const rows = rowsFor(withCalls);
  assert.match(judgeV77({ slug: 's1-mach', record: withCalls, steps, registryIds: ['A-10'], rowOf: (id) => rows.get(id) ?? null, dbReadable: true }).detail, /without the discovery's absence proof/);
});

test('V77: a real binding error still fails beside a not-applicable op', () => {
  const bad = { ...op('F-12'), dry_run_ok: false, applied: false, calls: [{ ...call('F-12', 'dry_run'), error_class: 'binding', error: 'Parameter binding failed: publicIpName' }] };
  const rec = sweep([bad, na('A-10', 'x; discovery: standing_admin_upn: no simulator object: y')]);
  const rows = rowsFor(rec);
  const r = judgeV77({ slug: 's1-mach', record: rec, steps, registryIds: ['F-12', 'A-10'], rowOf: (id) => rows.get(id) ?? null, dbReadable: true });
  assert.equal(r.pass, false);
  assert.match(r.detail, /binding error\(s\): F-12/);
});

// ---------- V116 ----------
test('V116: conpty-run.ps1 compiles its host with the module-qualified Add-Type and stays CRLF only', () => {
  const b = fs.readFileSync(path.join(HERE, 'conpty-run.ps1'));
  const text = b.toString('latin1');
  assert.match(text, /^Microsoft\.PowerShell\.Utility\\Add-Type -TypeDefinition \$src -Language CSharp\r$/m);
  assert.doesNotMatch(text, /^Add-Type /m, 'a bare Add-Type is shadowed by the simulator\'s fake Microsoft.Graph.Authentication');
  assert.equal((text.match(/\n/g) ?? []).length, (text.match(/\r\n/g) ?? []).length, 'CRLF only');
});

// ---------- R-EO diffs E and B ----------
test('V81 (R-EO diff E): the interview pins carry PI.PER.012 on S1/S2', () => {
  assert.deepEqual(V81_INTERVIEW_EXPECTED, { 's1-mach': 143, 's2-eng': 144, 's3-def': 105, 'muster-partial': 0 });
});
