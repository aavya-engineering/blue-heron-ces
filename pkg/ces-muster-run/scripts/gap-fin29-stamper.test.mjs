// FIN-29 (finishing plan PH-2 harness): the Stamper judges V115, V116, V117, V126 (verify-fin29-stamper.mjs) over
// fixture records shaped like ces-tester src/flow/fin29-stamper.ts writes. Temp folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { judgeV115, judgeV116, judgeV117, judgeV126, frontOf, fin29StamperChecks, KEY_VAULT_ENTRY, E0_DP2_ACCEPT, E0_DP2_REFUSE, E8R_CALLS } from './verify-fin29-stamper.mjs';

const T = 'tester';
const e0 = () => ({
  schema: 'ces-tester/e0-clean-tenant@1', taken: '2026-11-01T00:00:00Z', tenant_slug: 'clean-g5-e0', scenario: 'clean-g5', ran: true,
  bootstrap: { rc: 0, record_file: 'out/e0/tenants/live/clean-g5-e0.json', record_kind: 'live', cert_source: 'store', cert_thumbprint: 'A'.repeat(40), cert_non_exportable: true, cert_removed: true,
    permissions: { granted: 20, skipped: 0, failed: 0, held: ['Sites.FullControl.All'] }, held_lines: ['[HELD] Sites.FullControl.All (Office 365 SharePoint Online): held'], break_glass: { verified: true },
    security_defaults: 'disabled_by_operator', licence_lines: ['[OK] Licence check: G5 (25 seats)'], licence_record: null },
  preflight: { stopped: true, checks: [{ phase: 'tenant_readiness', name: 'Break-glass accounts', status: 'ok' }, { name: 'Sites.FullControl.All (Office 365 SharePoint Online)', status: 'held' }, { name: 'Teams Administrator', status: 'held' }], held: ['Sites.FullControl.All (Office 365 SharePoint Online)', 'Teams Administrator'], break_glass: [], errors: [] },
  baseline_pass1: { stopped: true, injected: 'New-AzVirtualNetwork', complete: { type: 'baseline_complete', failed: 1, cost_gated_off: 5 },
    cost_gate: [{ entryId: 'baseline.StorageAccount', allowed: false }], errors: [{ resourceName: 'vnet-1', error: 'transient fault' }, { resourceName: 'snet-1', error: 'dependency vnet-1 failed' }], progress: [],
    cost_evidence: [{ entry_id: 'baseline.StorageAccount', dp: 2, outcome: 'refused' }] },
  baseline_pass2: { stopped: true, injected: null, complete: { failed: 0, cost_gated_off: 3, recurring_enabled: [E0_DP2_ACCEPT] }, cost_gate: [], errors: [], progress: [],
    cost_evidence: [{ entry_id: E0_DP2_ACCEPT, dp: 2, outcome: 'accepted' }, { entry_id: E0_DP2_REFUSE, dp: 2, outcome: 'refused' }], dp1: { [E0_DP2_ACCEPT]: 200, [E0_DP2_REFUSE]: 200 } },
});
const e8r = () => ({
  schema: 'ces-tester/e8r-lifecycle@1', tenant_slug: 's1-mach', plan_id: 'P', halted_plan_id: 'P-e8r', private_pipeline_root: 'out/e8r/pl',
  calls: E8R_CALLS.map((call) => ({ call, rc: 0, ok: true, detail: 'ok', ...(call === 'validate' ? { total_tasks: 110 } : {}), ...(call === 'halted_execute' ? { report_status: 'failed' } : {}),
    ...(call === 'resume' ? { prior_status: 'failed', done_before: 0, recurring_cost_line: 'Recurring cost enabled by this run: none' } : {}), ...(call === 'rollback' ? { target: 'stacksim on loopback 127.0.0.1:4390', detail: 'reversed 0' } : {}) })),
});
const e8t = () => ({
  schema: 'ces-tester/e8t-cli-terminal@1', tenant_slug: 's2-eng',
  dp1: { rc: 0, answers: [{ rule: 'dp1-typed', answer: KEY_VAULT_ENTRY }], evidence: [] },
  translate: { rc: 0, acked: [KEY_VAULT_ENTRY], gated_off: [] },
  gates: { approve: 'manual-A', approve_control: 'AT.L2-3.2.1', reject: 'manual-B', reject_control: 'AT.L2-3.2.2', other_controls: ['SC.L2-3.13.10'] },
  pass_a: { plan_id: 'P-e8t-a', rc: 0, timed_out: false, answers: [{ rule: 'gate-decision', answer: 'yes', task_id: 'manual-A' }, { rule: 'gate-decision', answer: 'no', task_id: 'manual-B' }, { rule: 'dp2-typed', answer: 'x' }], verdicts: { 'AT.L2-3.2.1': 'sat', 'AT.L2-3.2.2': 'not_sat' } },
  pass_b: { plan_id: 'P-e8t-b', rc: 0, timed_out: false, answers: [{ rule: 'dp2-typed', answer: 'y' }], verdicts: {} },
  cost_evidence: [{ entry_id: KEY_VAULT_ENTRY, dp: 1, outcome: 'accepted' }, { entry_id: KEY_VAULT_ENTRY, dp: 2, outcome: 'refused' }, { entry_id: KEY_VAULT_ENTRY, dp: 2, outcome: 'accepted' }],
});
const e8g = () => ({
  schema: 'ces-tester/e8g-gui-cost@1', tenant_slug: 's3-def',
  items: { status: 200, item: { entry_id: KEY_VAULT_ENTRY, acked: false, estimate: '$0-$0.50' } },
  translate_without_dp1: { status: 200, gated_off: [KEY_VAULT_ENTRY], acked: [] }, dp1: { status: 200, ok: true }, translate_with_dp1: { status: 200, gated_off: [], acked: [KEY_VAULT_ENTRY] },
  run: { stopped: true, task_approvals: 1, pending_seen: [{ entryId: KEY_VAULT_ENTRY, expected: `${KEY_VAULT_ENTRY} $0-$0.50` }], answer: { status: 200, outcome: 'accepted' } },
  cost_evidence: [{ entry_id: KEY_VAULT_ENTRY, dp: 1, outcome: 'accepted' }, { entry_id: KEY_VAULT_ENTRY, dp: 2, outcome: 'accepted' }],
});
const j = (fn, record, extra = {}) => fn({ record, stale: null, row: { id: 'x', status: 'ok' }, harness: T, ...extra });

test('V117 green on a full record; each clause turns it red', () => {
  assert.equal(j(judgeV117, e0()).pass, true, j(judgeV117, e0()).detail);
  const r1 = e0(); r1.bootstrap.cert_non_exportable = false;
  assert.match(j(judgeV117, r1).detail, /EXPORTABLE/);
  const r2 = e0(); r2.bootstrap.licence_lines = [];
  assert.match(j(judgeV117, r2).detail, /slice not landed: no licence check/);
  const r3 = e0(); r3.baseline_pass1.complete.cost_gated_off = 0;
  assert.match(j(judgeV117, r3).detail, /cost_gated_off=0/);
  const r4 = e0(); r4.baseline_pass1.errors = [{ resourceName: 'snet', error: 'dependency vnet-1 failed' }];
  assert.match(j(judgeV117, r4).detail, /not reported as a failure/);
  const r5 = e0(); r5.preflight.held = ['Teams Administrator'];
  assert.match(j(judgeV117, r5).detail, /Sites\.FullControl\.All held/);
  const r6 = e0(); r6.baseline_pass2.cost_evidence = [];
  assert.match(j(judgeV117, r6).detail, /no accepted dp:2 record/);
});

test('V117: a skipped E0 (profile not built, no pwsh) is red with the reason; the mx harness passes as not run', () => {
  assert.match(judgeV117({ record: null, row: { id: 'E0', status: 'skipped', detail: 'slice not landed: FIN-21 clean-g5 profile not built (x)' }, harness: T }).detail, /^slice not landed/);
  const s = judgeV117({ record: null, row: { id: 'E0', status: 'skipped', detail: 'PowerShell 7 (pwsh) is not installed' }, harness: T });
  assert.equal(s.pass, false);
  assert.match(s.detail, /E0 skipped: PowerShell 7/);
  assert.equal(judgeV117({ record: null, harness: 'mx' }).pass, true);
  assert.match(judgeV117({ record: null, row: null, harness: T }).detail, /no record/);
  assert.match(judgeV117({ record: e0(), stale: 'stale artefact', harness: T }).detail, /stale/);
});

test('V126', () => {
  assert.equal(j(judgeV126, e8r()).pass, true, j(judgeV126, e8r()).detail);
  const r = e8r(); r.calls.find((c) => c.call === 'resume').recurring_cost_line = null;
  assert.match(j(judgeV126, r).detail, /recurring_cost\.line/);
  const r2 = e8r(); r2.calls = r2.calls.filter((c) => c.call !== 'rollback');
  assert.match(j(judgeV126, r2).detail, /rollback: not run/);
  const r3 = e8r(); r3.calls.find((c) => c.call === 'rollback').target = 'live tenant';
  assert.match(j(judgeV126, r3).detail, /not the loopback simulator/);
});

test('V116 and the D-5 narrowing', () => {
  assert.equal(j(judgeV116, e8t()).pass, true, j(judgeV116, e8t()).detail);
  const r = e8t(); r.pass_a.verdicts['AT.L2-3.2.1'] = 'not_sat';
  assert.match(j(judgeV116, r).detail, /spread to the approved gate/);
  const r2 = e8t(); r2.cost_evidence = r2.cost_evidence.filter((e) => e.outcome !== 'refused');
  assert.match(j(judgeV116, r2).detail, /no refused dp:2/);
  const r3 = e8t(); r3.pass_a.answers = r3.pass_a.answers.filter((a) => a.rule !== 'dp2-typed');
  assert.match(j(judgeV116, r3).detail, /no DP-2 prompt in pass A/);
  assert.equal(judgeV116({ record: null, row: { id: 'E8T', status: 'skipped', detail: 'not this scenario: the terminal leg runs on s2-eng' }, harness: T }).pass, true);
});

test('V115', () => {
  assert.equal(j(judgeV115, e8g()).pass, true, j(judgeV115, e8g()).detail);
  const r = e8g(); r.translate_without_dp1.gated_off = [];
  assert.match(j(judgeV115, r).detail, /did not drop/);
  const r2 = e8g(); r2.run.pending_seen = [];
  assert.match(j(judgeV115, r2).detail, /no DP-2 dialog/);
  const r3 = e8g(); r3.run.answer = { status: 403, outcome: 'refused' };
  assert.match(j(judgeV115, r3).detail, /HTTP 403/);
});

test('frontOf: wrong schema and a record note are red', () => {
  assert.match(frontOf({ record: { schema: 'x' }, harness: T, schema: 'y', label: 'E0' }).done.detail, /schema x/);
  assert.match(frontOf({ record: { schema: 'y', note: 'E0 stopped: boom' }, harness: T, schema: 'y', label: 'E0' }).done.detail, /boom/);
});

test('fin29StamperChecks reads out/ and tester-run.json and returns the four rows', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fin29-st-v-'));
  fs.writeFileSync(path.join(d, 'cli-terminal.json'), JSON.stringify(e8t()));
  fs.writeFileSync(path.join(d, 'tester-run.json'), JSON.stringify({ steps: [{ id: 'E0', status: 'skipped', detail: 'slice not landed: FIN-21 clean-g5 profile not built' }, { id: 'E8G', status: 'skipped', detail: 'not this scenario: s3-def' }] }));
  const vctx = { out: d, harness: T, exists: (f) => fs.existsSync(f), readJson: (f) => JSON.parse(fs.readFileSync(f, 'utf8')), staleOf: () => null };
  const rows = await fin29StamperChecks(vctx);
  assert.deepEqual(rows.map((r) => r.id), ['V115', 'V116', 'V117', 'V126']);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.V115.pass, true);
  assert.equal(by.V116.pass, true, by.V116.detail);
  assert.equal(by.V117.pass, false);
  assert.match(by.V126.detail, /no record/);
});
