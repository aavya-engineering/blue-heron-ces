// FIN-29 (finishing plan PH-2 harness): verify-fin29-ao.mjs, the judges of V77 (E7S, the AO sweep) and V127 (E9A, AO's
// surfaces), on hand-made records shaped like ces-tester's ao-sweep-run.ts / fin29-ao.ts output. No run needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV77, judgeV127, fin29AoChecks, V77_APPLY_FLOOR } from './verify-fin29-ao.mjs';
import { runFin29Checks } from './verify-fin29.mjs';

const steps = { E1: { started: '2026-11-01T10:00:00.000Z' }, E7B: { ended: '2026-11-01T10:20:00.000Z' }, E8F: { ended: '2026-11-01T10:30:00.000Z' } };
const call = (op, kind, extra = {}) => ({ call: kind, rc: 0, ok: true, success: true, mode: kind === 'apply' ? 'live' : 'dry_run', evidence_row_id: `${op}:${kind}`, two_person_mode: 'off', error_class: null, ...extra });
const op = (id, tier = 'T2', o = {}) => ({ op: id, tier, params: [], calls: [call(id, 'dry_run'), ...(o.dry ? [] : [call(id, 'apply')])], dry_run_ok: true, applied: !o.dry, ...(o.dry ? { apply_skipped: 'recurring cost' } : {}) });
const sweep = (ops, extra = {}) => ({
  schema: 'ces-tester/ao-sweep@1', slug: 's1-mach', taken: '2026-11-01T10:40:00.000Z', started: '2026-11-01T10:31:00.000Z', ended: '2026-11-01T10:39:00.000Z',
  tenant_id: 'sim-tenant-s1-mach', two_person_approval: 'off', expected_commands: ops.length, apply_floor: 0,
  totals: { dry_run_ok: ops.length, apply_skipped: ops.filter((o) => o.apply_skipped).length }, ops, ...extra,
});
const rowsFor = (rec) => new Map(rec.ops.flatMap((o) => o.calls.map((c) => [c.evidence_row_id, { tenantId: rec.tenant_id, metadata: { requestorUPN: 'op', approverUPN: c.call === 'apply' ? 'ap' : undefined }, evidence: { metadata: { twoPersonApproval: { mode: rec.two_person_approval } } } }])));

test('V77: not judged off S1; red without the record', () => {
  assert.equal(judgeV77({ slug: 's2-eng' }).pass, true);
  assert.match(judgeV77({ slug: 's1-mach' }).detail, /no out\/ao-sweep\.json/);
});

test('V77: a full sweep (every registry id dry-run, applies over the floor, rows in ces.db) is green', () => {
  const rec = sweep([op('A-01'), op('A-03', 'T3'), op('F-12', 'T3', { dry: true })]);
  const rows = rowsFor(rec);
  const r = judgeV77({ slug: 's1-mach', record: rec, steps, registryIds: ['A-01', 'A-03', 'F-12'], rowOf: (id) => rows.get(id) ?? null, dbReadable: true });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /2 applied/);
  assert.equal(V77_APPLY_FLOOR, 0);
});

test('V77: a registry id missing, a binding or guard error, a not-run op, a lost row each go red', () => {
  const rec = sweep([op('A-01')]);
  const rows = rowsFor(rec);
  assert.match(judgeV77({ slug: 's1-mach', record: rec, steps, registryIds: ['A-01', 'A-02'], rowOf: (id) => rows.get(id), dbReadable: true }).detail, /not in the sweep: A-02/);
  const bad = sweep([{ ...op('A-01'), dry_run_ok: false, applied: false, calls: [call('A-01', 'dry_run', { error_class: 'binding', error: 'Parameter binding failed' })] }]);
  assert.match(judgeV77({ slug: 's1-mach', record: bad, steps, registryIds: ['A-01'], rowOf: (id) => rowsFor(bad).get(id), dbReadable: true }).detail, /binding error/);
  const guard = sweep([{ ...op('A-01'), calls: [call('A-01', 'dry_run'), call('A-01', 'apply', { error_class: 'guard', error: 'PowerShell injection guard' })] }]);
  assert.match(judgeV77({ slug: 's1-mach', record: guard, steps, registryIds: ['A-01'], rowOf: (id) => rowsFor(guard).get(id), dbReadable: true }).detail, /guard error/);
  const nr = sweep([{ op: 'A-10', tier: 'T2', calls: [], dry_run_ok: false, applied: false, not_run: 'inputs not bound: targetUPN <- resources.standing_admin_upn' }]);
  assert.match(judgeV77({ slug: 's1-mach', record: nr, steps, registryIds: ['A-10'], dbReadable: true, rowOf: () => null }).detail, /1 not run: A-10/);
  assert.match(judgeV77({ slug: 's1-mach', record: rec, steps, registryIds: ['A-01'], rowOf: () => null, dbReadable: true }).detail, /not in ces\.db/);
});

test('V77 (PH-12): a dry-run-ok op whose apply was not kept dry and did not apply is red and named; kept-dry and not-applicable ops are not', () => {
  // R-F9 S1 shape: A-01 and F-08 applied 404, hidden behind "87 applied (floor 0)".
  const failed = { ...op('A-01'), applied: false, detail: 'Invoke-StacksimResolve : The remote server returned an error: (404) Not Found.' };
  const rec = sweep([failed, op('A-03', 'T3'), op('F-12', 'T3', { dry: true })]);
  const r = judgeV77({ slug: 's1-mach', record: rec, steps, registryIds: ['A-01', 'A-03', 'F-12'], rowOf: (id) => rowsFor(rec).get(id), dbReadable: true });
  assert.equal(r.pass, false);
  assert.match(r.detail, /1 apply\(ies\) failed: A-01: Invoke-StacksimResolve : The remote server returned an error: \(404\) Not Found\./);
  assert.match(r.detail, /1 applied \(floor 0\), 1 kept dry \(recurring cost or scenario\), 1 apply failed/);
  const na = { op: 'B-08', tier: 'T2', calls: [], dry_run_ok: false, applied: false, not_applicable: 'no Android policy; discovery: android_app_protection_policy_id: no simulator object: none' };
  const ok = sweep([op('A-03', 'T3'), op('F-12', 'T3', { dry: true }), na]);
  const g = judgeV77({ slug: 's1-mach', record: ok, steps, registryIds: ['A-03', 'F-12', 'B-08'], rowOf: (id) => rowsFor(ok).get(id), dbReadable: true });
  assert.equal(g.pass, true, g.detail);
  assert.match(g.detail, /0 apply failed/);
});

test('V77: the floor only rises (the record cannot lower the judge\'s); a sweep before E8F ended is red', () => {
  const rec = sweep([op('A-01', 'T2', { dry: true })], { apply_floor: 0 });
  const rows = rowsFor(rec);
  assert.match(judgeV77({ slug: 's1-mach', record: rec, steps, registryIds: ['A-01'], rowOf: (id) => rows.get(id), dbReadable: true, floor: 1 }).detail, /applied 0 < floor 1/);
  assert.match(judgeV77({ slug: 's1-mach', record: { ...rec, apply_floor: 5 }, steps, registryIds: ['A-01'], rowOf: (id) => rows.get(id), dbReadable: true }).detail, /floor 5/);
  assert.match(judgeV77({ slug: 's1-mach', record: { ...rec, started: '2026-11-01T10:25:00.000Z' }, steps, registryIds: ['A-01'], rowOf: (id) => rows.get(id), dbReadable: true }).detail, /before E8F ended/);
});

test('V77: Tier 3 by the two-person mode (OFF rows say off; ON needs an approval and an approver other than the requestor)', () => {
  const off = sweep([{ ...op('A-03', 'T3'), calls: [call('A-03', 'dry_run', { two_person_mode: undefined }), call('A-03', 'apply')] }]);
  assert.match(judgeV77({ slug: 's1-mach', record: off, steps, registryIds: ['A-03'], rowOf: (id) => rowsFor(off).get(id), dbReadable: true }).detail, /do not record two-person mode off/);
  const on = sweep([{ op: 'A-03', tier: 'T3', params: [], dry_run_ok: true, applied: true, calls: [call('A-03', 'request', { two_person_mode: 'on' }), { call: 'approve', ok: true, rc: 0 }, call('A-03', 'apply', { two_person_mode: 'on' })] }], { two_person_approval: 'on' });
  const rows = rowsFor(on);
  assert.equal(judgeV77({ slug: 's1-mach', record: on, steps, registryIds: ['A-03'], rowOf: (id) => rows.get(id), dbReadable: true }).pass, true);
  const same = new Map([...rows].map(([k, v]) => [k, { ...v, metadata: { requestorUPN: 'op', approverUPN: 'op' } }]));
  assert.match(judgeV77({ slug: 's1-mach', record: on, steps, registryIds: ['A-03'], rowOf: (id) => same.get(id), dbReadable: true }).detail, /approver equals the requestor/);
});

const surfaces = (over = {}) => ({
  schema: 'ces-tester/ao-surfaces@1', slug: 's1-mach', taken: '2026-11-01T10:35:00.000Z', two_person_approval: 'off', registry_commands: 97,
  ops: { read: 'A-08', l2: 'A-08', write: 'A-18' },
  mcp: { ran: true, tools: ['ao_list_commands', 'ao_get_command', 'ao_execute', 'ao_approvals', 'ao_approve'], strict_cmmc_in_schema: true, list_count: 97, get_command_id: 'A-08', dry_run: { mode: 'DRY_RUN', success: true, outcome: 'dry_run', evidence_row_id: 'A-08:mcp', two_person_mode: 'off', error: null }, apply_blocked: { mode: 'DRY_RUN', live_apply_blocked: true, error: null } },
  cli: { list: { rc: 0, count: 97 }, show: { rc: 0, id: 'A-08' }, approvals: { rc: 0, line: 'No pending approvals.' } },
  rails: [
    { rail: 'sim_only', tenant: 'fin29-v127-live', op: 'A-08', rc: 0, success: false, outcome: 'denied_sim_only', evidence_row_id: 'A-08:rail', evidence_persisted: true, two_person_mode: 'off' },
    { rail: 'cmmc_scope', tenant: 'fin29-v127-l1', op: 'A-08', rc: 0, success: false, outcome: 'denied_cmmc', evidence_row_id: 'A-08:cmmc', evidence_persisted: true, two_person_mode: 'off' },
    { rail: 'web_apply_guard', tenant: 's1-mach', op: 'A-18', http: 428, outcome: 'failed', evidence_row_id: 'A-18:guard', evidence_persisted: true, two_person_mode: 'off' },
  ],
  web: { port: 4014, up: true },
  ...over,
});
const anyRow = () => ({ tenantId: 't', metadata: {} });

test('V127: MCP + CLI + three evidenced refusals with the run\'s two-person mode is green', () => {
  const r = judgeV127({ record: surfaces(), steps, registryCount: 97, rowOf: anyRow, dbReadable: true });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /web apply guard 428/);
});

test('V127: a refusal row without the two-person mode names the AO gap; a missing 428, a wrong count, an unblocked MCP apply go red', () => {
  const s = surfaces();
  s.rails[0].two_person_mode = null;
  s.rails[1].two_person_mode = null;
  assert.match(judgeV127({ record: s, steps, registryCount: 97, rowOf: anyRow, dbReadable: true }).detail, /carry no two-person mode: sim_only, cmmc_scope .*CommandExecutor/);
  const t = surfaces();
  t.rails[2] = { rail: 'web_apply_guard', tenant: 's1-mach', op: 'A-18', note: 'ports 4014-4019 all held' };
  assert.match(judgeV127({ record: t, steps, registryCount: 97, rowOf: anyRow, dbReadable: true }).detail, /web_apply_guard .*not refused/);
  assert.match(judgeV127({ record: surfaces(), steps, registryCount: 96, rowOf: anyRow, dbReadable: true }).detail, /returned 97 \(want 96\)/);
  const u = surfaces();
  u.mcp.apply_blocked = { mode: 'LIVE', live_apply_blocked: false };
  assert.match(judgeV127({ record: u, steps, registryCount: 97, rowOf: anyRow, dbReadable: true }).detail, /not held to a dry run/);
  assert.match(judgeV127({ record: surfaces(), steps, registryCount: 97, rowOf: () => null, dbReadable: true }).detail, /not in ces\.db/);
  assert.match(judgeV127({}).detail, /no out\/ao-surfaces\.json/);
});

test('fin29AoChecks reads out/ and the registry; the hub runs the module and returns V77 and V127 rows', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fin29-ao-'));
  const out = path.join(root, 'out');
  fs.mkdirSync(out, { recursive: true });
  const ces = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'ces');
  fs.writeFileSync(path.join(out, 'ao-surfaces.json'), JSON.stringify(surfaces()));
  const vctx = { root, out, ces, slug: 's2-eng', steps, harness: 'tester', exists: (f) => fs.existsSync(f), readJson: (f) => JSON.parse(fs.readFileSync(f, 'utf8')), staleOf: () => null, db: () => null };
  const rows = await fin29AoChecks(vctx);
  assert.deepEqual(rows.map((r) => r.id), ['V77', 'V127']);
  assert.equal(rows[0].pass, true); // S2: not run here
  assert.match(rows[1].detail, /ces\.db not readable/);
  const hub = await runFin29Checks(vctx);
  assert.ok(hub.some((r) => r.id === 'V77' && r.pass));
  assert.ok(hub.some((r) => r.id === 'V127'));
});
