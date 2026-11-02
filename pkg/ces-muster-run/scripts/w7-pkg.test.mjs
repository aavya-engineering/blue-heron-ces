// W7-PKG tests (PLAN.md §5 V60-V71, the V59 AdminOps rule, GAPS review rows, SC-8a --exclude-honest-nulls):
//   node --test scripts/w7-pkg.test.mjs
// Self-contained: every fixture is synthetic (fictional names) and written to a fresh temp folder; the only package files read
// are customers\s3-def\deficiencies.json and the mx-helpers.mjs / bundle.mjs sources (read only). Nothing in the workspace is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInputs, computeScorecard, renderTable, parseArgs, sc8aSplit, loadHonestNulls, DEFAULT_HONEST_NULLS_FILE, resolveHonestNullsArg } from './scorecard.mjs';
import { buildGaps, gapId, REVIEW_MARKERS } from './gaps.mjs';
import {
  judgeV60, judgeV61, judgeV62, judgeV63, judgeV64, judgeV65, judgeV66, judgeV67, judgeV68, judgeV69, judgeV70, judgeV71,
  btcShapeProblems, builtinsOnly, sifHours, registerW4Checks, aoTierCalls, aoTwoPersonMode,
} from './verify-w4.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
// A stand-in for ces-shared canonicalSha256 (the judges take the function; the real one is imported by verify.mjs).
const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const SLUG = 's1-mach';

// ---------- V60 ----------
const cuiArtifact = { ces: { artifact: 'cui_boundary_output', version: '1.0' }, cui_boundary: { zones: ['enclave'] } };
const cuiEnv = (art = cuiArtifact) => ({ cesId: 'ces-1', schema_id: 'muster:cui-boundary-output', artifact_id: 'cui-boundary-ces-1', version: '1.0', hash_sha256: hash(art), artifact: art });
const cuiRef = () => ({ artifact: 'cui_boundary_output', version: '1.0', schema_id: 'muster:cui-boundary-output', artifact_id: 'cui-boundary-ces-1', hash_sha256: hash(cuiArtifact) });
const v60ok = () => ({
  slug: SLUG, boundary: { skipped: null, cui_boundary_ref: { artifact_id: 'cui-boundary-ces-1', hash_sha256: hash(cuiArtifact), schema_id: 'muster:cui-boundary-output' }, no_reference_reason: null },
  pushed: [`manual-mission-plan-${SLUG}-T1.json`, `cui-boundary-${SLUG}-T1.json`], envelope: cuiEnv(), mpRef: cuiRef(), recompute: hash,
  stamperRef: { artifact_id: 'cui-boundary-ces-1', hash_sha256: hash(cuiArtifact), verified: true },
});
test('V60: one pushed CUI Boundary whose hash = recomputed = MP reference, Stamper verified; each break fails', () => {
  assert.equal(judgeV60(v60ok()).pass, true, judgeV60(v60ok()).detail);
  const brk = (fn) => { const i = v60ok(); fn(i); return judgeV60(i); };
  assert.match(brk((i) => { i.pushed.push(`cui-boundary-${SLUG}-T2.json`); }).detail, /holds 2 cui-boundary/);
  assert.match(brk((i) => { i.envelope = cuiEnv({ ...cuiArtifact, extra: 1 }); }).detail, /envelope hash .* != MP/);
  assert.match(brk((i) => { i.envelope.hash_sha256 = i.mpRef.hash_sha256; i.envelope.artifact = { tampered: true }; }).detail, /canonicalSha256\(artifact\) .* != envelope hash/);
  assert.match(brk((i) => { i.mpRef.artifact_id = 'cui-boundary-other'; }).detail, /artifact_id cui-boundary-ces-1 != MP cui-boundary-other/);
  assert.match(brk((i) => { i.stamperRef = { ...i.stamperRef, verified: false, reason: 'CUI Boundary file not found' }; }).detail, /Stamper recorded verified false \(CUI Boundary file not found\)/);
  assert.match(brk((i) => { i.stamperRef = null; }).detail, /Stamper recorded no variables\._cui_boundary_ref/);
  assert.match(brk((i) => { i.recompute = null; }).detail, /not importable/);
});
test('V60: skip path (no_reference_reason) passes only with no file and no reference fields; a pre-W7-MX2 trace fails', () => {
  const skip = { slug: SLUG, boundary: { skipped: 'no_cui', cui_boundary_ref: null, no_reference_reason: 'no_cui' }, pushed: [], mpRef: { artifact: 'cui_boundary_output' } };
  const r = judgeV60(skip);
  assert.equal(r.pass, true); assert.match(r.detail, /^skipped boundary \(plan-trace\.json no_reference_reason: no_cui\)/);
  assert.match(judgeV60({ ...skip, pushed: [`cui-boundary-${SLUG}-T1.json`] }).detail, /but cui-boundary-s1-mach-T1\.json pushed/);
  assert.equal(judgeV60({ ...skip, mpRef: cuiRef() }).pass, false);
  const old = judgeV60({ slug: SLUG, boundary: { sim_decision: null, skipped: null, boundary_zones: 28 }, pushed: [] });
  assert.equal(old.pass, false); assert.match(old.detail, /before W7-MX2/);
  assert.equal(judgeV60({ slug: SLUG, boundary: null }).pass, false);
});

// ---------- V61 ----------
const btc = (fails = 2) => ({
  ces: { artifact: 'btc_confirmation_output', version: '1.0', generated_on: '2026-10-29', btc_bank_version: '1.0', activation_package_version: '1.0' },
  btc_confirmation: {
    answers: { 'BTC.ID.001': { question_id: 'BTC.ID.001', answer: 'yes', mode: 'operator_inference', evidence_ids: [], captured_at: '2026-10-29T00:00:00Z' } },
    evidence_refs: [], risk_flags: [], decision_log: [],
    gate_status: Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`DV-0${i + 1}`, { domain: `D${i}`, pass: i >= fails, reason: i >= fails ? 'ok' : 'not answered' }])),
  },
});
const btcWarn = (n) => [...Array.from({ length: n }, (_, i) => `BTC gate "DV-0${i + 1}" (D${i}) failed: not answered`), 'CONSISTENCY_CUI_IDENTITY_VS_BTC_GATE: CUI Boundary says identity is isolated, but BTC identity gate failed.'];
test('V61: the BTC file parses as the vendored type; failed gates = MP gate_summary.fail = plan BTC gate warnings (CONSISTENCY lines not counted)', () => {
  const ok = judgeV61({ btc: btc(2), btcFile: 'btc-confirmation-s1-mach-T1.json', mpRef: { gate_summary: { total: 3, pass: 1, fail: 2 } }, warnings: btcWarn(2) });
  assert.equal(ok.pass, true, ok.detail); assert.match(ok.detail, /2 failed gates = MP gate_summary\.fail = 2 plan BTC gate warnings/);
  assert.match(judgeV61({ btc: btc(2), btcFile: 'b.json', mpRef: { gate_summary: { fail: 3 } }, warnings: btcWarn(2) }).detail, /failed gates 2 != MP gate_summary\.fail 3/);
  assert.match(judgeV61({ btc: btc(2), btcFile: 'b.json', mpRef: { gate_summary: { fail: 2 } }, warnings: btcWarn(1) }).detail, /!= plan-trace\.json BTC gate warnings 1/);
  assert.match(judgeV61({ btc: null, mpRef: { gate_summary: { fail: 5 } } }).detail, /holds no btc-confirmation/);
  const skip = judgeV61({ btc: null, mpRef: null }); assert.equal(skip.pass, true); assert.match(skip.detail, /no BTC Confirmation built/);
  const bad = btc(1); bad.ces.artifact = 'other'; bad.btc_confirmation.gate_status['DV-01'].pass = 'no';
  assert.deepEqual(btcShapeProblems(bad), ['ces.artifact other (want btc_confirmation_output)', 'gate_status.DV-01 malformed']);
  assert.deepEqual(btcShapeProblems(btc()), []);
});

// ---------- V62 ----------
const KINDS = { si_baseline: 'si-baseline-', tcp: 'tcp-', readiness_posture: 'readiness-posture-', policy_inputs_profile: 'policy-inputs-profile-', policy_set_manifest: 'policy-set-manifest-', cui_boundary: 'cui-boundary-' };
const v62fixture = () => {
  const files = { [`manual-mission-plan-${SLUG}-T.json`]: {}, [`tenant-manifest-${SLUG}-T.json`]: {}, [`infrastructure-manifest-${SLUG}-T.json`]: {} };
  const inputs = {};
  for (const [k, pfx] of Object.entries(KINDS)) {
    const art = { kind: k }; files[`${pfx}${SLUG}-T.json`] = { artifact_id: `${k}-1`, hash_sha256: hash(art), artifact: art };
    inputs[`${k}_ref`] = { artifact_id: `${k}-1`, hash_sha256: hash(art) };
  }
  return { files, inputs };
};
const v62 = ({ files, inputs }, boundary = null) => judgeV62({ plansFiles: Object.keys(files), readEnv: (f) => files[f], mpInputs: inputs, recompute: hash, boundary });
test('V62: the six hand-off envelopes are MP-referenced (same id and hash, recomputed); nine pushed files with the IM', () => {
  const r = v62(v62fixture());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /^6 hand-off envelopes MP-referenced with the same id and hash \(recomputed\): si_baseline, tcp, readiness_posture, policy_inputs_profile, policy_set_manifest, cui_boundary; 9 pushed files$/);
  let f = v62fixture(); delete f.inputs.policy_set_manifest_ref.hash_sha256;
  assert.match(v62(f).detail, /policy-set-manifest-s1-mach-T\.json unreferenced/);
  f = v62fixture(); delete f.files[`cui-boundary-${SLUG}-T.json`];
  assert.match(v62(f).detail, /inputs\.cui_boundary_ref references cui_boundary-1 but no cui-boundary-\* was pushed/);
  f = v62fixture(); f.files[`si-baseline-${SLUG}-T.json`].artifact = { kind: 'changed' };
  assert.match(v62(f).detail, /si-baseline-s1-mach-T\.json: canonicalSha256\(artifact\) differs/);
  f = v62fixture(); f.inputs.tcp_ref.artifact_id = 'tcp-2';
  assert.match(v62(f).detail, /tcp-s1-mach-T\.json: id \/ hash differ from inputs\.tcp_ref/);
});
test('V62: not built = no TCP, or the CUI Boundary skipped with a reason; a missing CUI Boundary without a reason fails (R1, before W7-MX2)', () => {
  let f = v62fixture(); delete f.files[`tcp-${SLUG}-T.json`]; delete f.inputs.tcp_ref;
  assert.equal(v62(f).pass, true); assert.match(v62(f).detail, /not built: tcp \(no TCP built\)/);
  f = v62fixture(); delete f.files[`cui-boundary-${SLUG}-T.json`]; f.inputs.cui_boundary_ref = { artifact: 'cui_boundary_output' };
  assert.equal(v62(f, { no_reference_reason: 'no_cui' }).pass, true);
  const r = v62(f);
  assert.equal(r.pass, false); assert.match(r.detail, /no cui-boundary-\* pushed and no inputs\.cui_boundary_ref hash/);
});

// ---------- V63 ----------
const e7aOf = (ops, extra = {}) => ({ schema: 'ces-tester/adminops-e7a@1', tenant_slug: 's3-def', requestor_upn: 'op@t.example', approver_upn: 'appr@t.example', registry_resources: { operator_upn: 'tm:operatorUPN (discovered)', breakglass_user_id: 'tm:breakGlassUserId (answered)' }, ops, ...extra });
test('V63: no op "not run"; every resources key and parameter has a provenance', () => {
  const ok = e7aOf([{ op: 'A-02', tier: 'T2', kind: 'write', params: [{ name: 'upn', from: 'resources.offboard_upn', value: 'x@t.example', provenance: 'discovered (GET /v1.0/users)' }], ok: true }]);
  assert.equal(judgeV63({ e7a: ok }).pass, true, judgeV63({ e7a: ok }).detail);
  const nr = e7aOf([{ op: 'A-10', tier: 'T2', kind: 'write', params: [], ok: false, detail: 'not run: the registry record lacks targetUPN <- resources.standing_admin_upn' }]);
  assert.match(judgeV63({ e7a: nr }).detail, /^A-10: not run: the registry record lacks targetUPN/);
  const unk = e7aOf([{ op: 'A-21', params: [{ name: 'leaverWorkflowId', from: 'resources.leaver_workflow_id', value: 'wf-1', provenance: 'unknown' }], ok: true }]);
  assert.match(judgeV63({ e7a: unk }).detail, /parameters without a provenance: A-21 leaverWorkflowId <- resources\.leaver_workflow_id/);
  const empty = e7aOf([], { registry_resources: { approver_upn: '' } });
  assert.match(judgeV63({ e7a: empty }).detail, /resources without a provenance: approver_upn/);
});

// ---------- V64 ----------
const a19 = (policy, extra = {}) => ({
  op: 'A-19', tier: 'T3', kind: 'write', ok: true,
  params: [{ name: 'policyDisplayName', from: `resources.${policy}`, value: policy, provenance: 'discovered' }, { name: 'breakGlassUserId', from: 'resources.breakglass_user_id', value: 'user-60', provenance: 'tm:breakGlassUserId (answered)' }],
  calls: [{ call: 'request', ok: true, success: true }, { call: 'approve', ok: true }, { call: 'apply', ok: true, success: true }], confirm: { pass: true, actual: '["user-60"]' }, ...extra,
});
const custCA = [{ policy_id: 'caPolicy-1', name: 'S3-CA01 Require MFA - all users' }, { policy_id: 'caPolicy-2', name: 'S3-CA02 Require MFA - administrators' }];
const caRead = (excl = ['user-60']) => [
  { id: 'caPolicy-1', displayName: 'S3-CA01 Require MFA - all users', state: 'enabledForReportingButNotEnforced', conditions: { users: { includeUsers: ['All'], excludeUsers: excl } } },
  { id: 'caPolicy-2', displayName: 'S3-CA02 Require MFA - administrators', state: 'enabledForReportingButNotEnforced', conditions: { users: { includeRoles: ['r'], excludeUsers: excl } } },
  { id: 'CMMC-SessionTimeout', displayName: 'CMMC-SessionTimeout', state: 'enabled', conditions: { users: { excludeUsers: ['user-60'] } } },
];
const v64ok = () => ({ slug: 's3-def', e7a: e7aOf([a19('breakglass_ca_policy_1'), a19('breakglass_ca_policy_2')]), caPolicies: caRead(), customerPolicies: custCA, d04: { id: 'S3-D04', resolved: true, fixerActed: 'AdminOps A-19 x2 in E7A (confirmed)' } });
test('V64 (S3): both customer policies exclude the break-glass id; A-19 x2 at T3, approver != requestor, confirmed; S3-D04 fixed', () => {
  assert.equal(judgeV64(v64ok()).pass, true, judgeV64(v64ok()).detail);
  const brk = (fn) => { const i = v64ok(); fn(i); return judgeV64(i).detail; };
  assert.match(brk((i) => { i.e7a.ops.pop(); }), /1 A-19 runs in E7A \(want 2\)/);
  assert.match(brk((i) => { i.e7a.ops[0].tier = 'T2'; }), /A-19 #1 tier T2 \(want T3\)/);
  assert.match(brk((i) => { i.e7a.ops[1].confirm = { pass: false, actual: '[]' }; }), /A-19 #2 confirming read failed \(\[\]\)/);
  assert.match(brk((i) => { i.e7a.ops[1].calls = i.e7a.ops[1].calls.filter((c) => c.call !== 'approve'); }), /A-19 #2 calls not ok: approve/);
  assert.match(brk((i) => { i.e7a.approver_upn = i.e7a.requestor_upn; }), /approver equals the requestor/);
  assert.match(brk((i) => { i.caPolicies = caRead([]); }), /S3-CA01 Require MFA - all users excludes \[\] \(not user-60\)/);
  assert.match(brk((i) => { i.caPolicies = null; }), /no E7B conditionalAccess read/);
  assert.match(brk((i) => { i.d04 = { resolved: false, fixerActed: 'still open' }; }), /V59 does not count S3-D04 fixed \(still open\)/);
  const s1 = judgeV64({ slug: 's1-mach' }); assert.equal(s1.pass, true); assert.match(s1.detail, /not S3/);
});

// W9-C1 (2P-H): two-person approval OFF (the default): A-19 x2 is a dry run then an apply, no approver; the mode is the
// one the AO rows recorded (verify.mjs passes modeOf from ces.db; the default reads the E7A call records' relayed copy).
const offCalls = [{ call: 'dry_run', ok: true, two_person_mode: 'off' }, { call: 'apply', ok: true, success: true, two_person_mode: 'off' }];
const v64off = () => ({ ...v64ok(), e7a: e7aOf([a19('breakglass_ca_policy_1', { calls: offCalls.map((c) => ({ ...c })) }), a19('breakglass_ca_policy_2', { calls: offCalls.map((c) => ({ ...c })) })], { approver_upn: null }) });
test('V64 (S3), two-person OFF: A-19 x2 at T3 as dry run + apply with no approver passes; ON rules still bind when the rows say on', () => {
  const r = judgeV64(v64off());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /two-person approval OFF: dry run \+ apply, no approver/);
  const brk = (fn, extra = {}) => { const i = { ...v64off(), ...extra }; fn(i); return judgeV64(i).detail; };
  assert.match(brk((i) => { i.e7a.ops[0].calls = i.e7a.ops[0].calls.filter((c) => c.call !== 'dry_run'); }), /A-19 #1 calls not ok: dry_run/);
  assert.match(brk((i) => { i.e7a.ops[1].confirm = { pass: false, actual: '[]' }; }), /A-19 #2 confirming read failed/);
  assert.match(brk((i) => { i.e7a.ops[0].tier = 'T2'; }), /A-19 #1 tier T2 \(want T3\)/);
  // modeOf (the AO rows) outranks the call records: rows that say 'on' demand request + approve and an approver.
  const on = judgeV64({ ...v64off(), modeOf: () => 'on' });
  assert.equal(on.pass, false);
  assert.match(on.detail, /A-19 #1 calls not ok: request, approve/);
  assert.match(on.detail, /approver missing/);
  // The ON fixture with rows that record 'on' still passes.
  assert.equal(judgeV64({ ...v64ok(), modeOf: () => 'on' }).pass, true);
});

test('W9-C1 (2P-H) helpers: aoTwoPersonMode and aoTierCalls', () => {
  assert.equal(aoTwoPersonMode(['off', 'off']), 'off');
  assert.equal(aoTwoPersonMode(['off', 'on']), 'on');
  assert.equal(aoTwoPersonMode(['off', undefined]), 'on');
  assert.equal(aoTwoPersonMode([]), 'on');
  assert.deepEqual(aoTierCalls('T2'), [['dry_run', 'dry_run'], ['apply', 'executed']]);
  assert.deepEqual(aoTierCalls('T2', 'on'), [['dry_run', 'dry_run'], ['apply', 'executed']]);
  assert.deepEqual(aoTierCalls('T3', 'on'), [['request', 'blocked_pending_approval'], ['apply', 'executed']]);
  assert.deepEqual(aoTierCalls('T3', 'off'), [['dry_run', 'dry_run'], ['apply', 'executed']]);
});

// ---------- V65 ----------
const leaverWf = (sched = true) => ({ id: 'wf-3', displayName: 'T1 Leaver - disable account', category: 'leaver', isEnabled: true, isSchedulingEnabled: sched, tasks: [{ taskDefinitionId: '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950', displayName: 'Disable user account', isEnabled: true }] });
const v65ok = () => ({
  slug: 's1-mach', driftCtl: { controlId: 'PS.L2-3.9.2', change: 'improvement', previous: { status: 'not_met' }, current: { status: 'met' } },
  sspCtl: { control_id: 'PS.L2-3.9.2', status: 'met', assessmentFinding: 'Leaver (T1 Leaver - disable account) and mover (T1 Mover) workflows enabled and scheduled; 2 disabled account(s), none holding a directory role' },
  workflows: [leaverWf(), { id: 'wf-2', displayName: 'T1 Mover', category: 'mover', isEnabled: true, isSchedulingEnabled: true, tasks: [] }],
  e7a: e7aOf([{ op: 'A-21', tier: 'T2', kind: 'write', ok: true, confirm: { pass: true, actual: 'true' } }]),
});
test('V65 (S1, S2): not met at E7 pass 3, met at E7B; the named leaver is enabled, scheduled, with a disable task; A-21 confirmed', () => {
  assert.equal(judgeV65(v65ok()).pass, true, judgeV65(v65ok()).detail);
  const brk = (fn) => { const i = v65ok(); fn(i); return judgeV65(i).detail; };
  assert.match(brk((i) => { i.driftCtl = null; }), /not in the E7B drift/);
  assert.match(brk((i) => { i.workflows[0] = leaverWf(false); }), /'T1 Leaver - disable account': category leaver, isEnabled true, isSchedulingEnabled false, disable task true/);
  assert.match(brk((i) => { i.workflows[0].tasks = [{ taskDefinitionId: 'other', displayName: 'Send email' }]; }), /disable task false/);
  assert.match(brk((i) => { i.sspCtl.assessmentFinding = 'No enabled, scheduled leaver workflow that disables or deletes the account.'; }), /names no enabled, scheduled leaver/);
  assert.match(brk((i) => { i.e7a.ops[0].confirm.pass = false; }), /A-21 confirming read failed/);
  assert.match(brk((i) => { i.e7a = e7aOf([]); }), /no A-21 op in E7A/);
  assert.match(judgeV65({ slug: 's3-def' }).detail, /not S1 \/ S2/);
});

// ---------- V66 ----------
test('V66 (ruling 1): a positive EO source or a met finding naming a built-in policy fails; discovery yes on built-ins alone fails', () => {
  const builtIn = JSON.stringify({ Name: 'Office365 AntiPhish Default', IsDefault: true });
  const configured = JSON.stringify([{ Name: 'Office365 AntiPhish Default', IsDefault: true }, { Name: 'T1 Anti-phish', IsDefault: false }]);
  assert.equal(builtinsOnly(builtIn), true); assert.equal(builtinsOnly(configured), false); assert.equal(builtinsOnly('not json'), null);
  assert.equal(builtinsOnly(JSON.stringify({ Identity: 'Built-In Protection Policy' })), true);
  const base = { snapshotControls: [{ control_id: 'SC.L2-3.13.15', sources: [{ type: 'discovery', result: 'missing', detail: 'IsDefault: true only' }] }], sspControls: [], facts: [], observations: [] };
  assert.equal(judgeV66(base).pass, true, judgeV66(base).detail);
  assert.match(judgeV66({ ...base, snapshotControls: [{ control_id: 'SI.L1-3.14.2', sources: [{ type: 'evidence_import', result: 'imported', detail: 'Malware filter Built-In Protection Policy enabled' }] }] }).detail, /SI\.L1-3\.14\.2: EO source evidence_import\/imported names a built-in policy/);
  assert.match(judgeV66({ ...base, sspControls: [{ control_id: 'SC.L2-3.13.15', status: 'met', assessmentFinding: 'policy "IsDefault": true' }] }).detail, /met, and the SSP finding names a built-in policy/);
  const disc = (cap) => ({ ...base, facts: [{ question_id: 'RR-ACT-SC_L2_3_13_15', answer: 'yes' }], observations: [{ control_id: 'SC.L2-3.13.15', derived_posture: 'met', ran_entry_ids: ['SC.L2-3.13.15.anti-phish'], raw_capture_ref: 'captures/a.txt' }], captureText: () => cap });
  assert.match(judgeV66(disc(builtIn)).detail, /discovery yes from built-ins alone \(SC\.L2-3\.13\.15\.anti-phish\)/);
  assert.equal(judgeV66(disc(configured)).pass, true);
  const nocap = judgeV66(disc(null)); assert.equal(nocap.pass, true); assert.match(nocap.detail, /no capture readable: not judged/);
});

// ---------- V67 ----------
const sif = (value, type = 'hours') => ({ signInFrequency: { isEnabled: true, type, value } });
const caS1 = () => [
  { displayName: 'T1-CA09 Session lifetime 12h - browser', state: 'enabled', sessionControls: sif(12) },
  { displayName: 'CMMC-SessionTimeout', state: 'enabled', sessionControls: sif(8) },
];
const baselineRow = { id: 'G-x', source: 'policy-reconciliation', control: 'AC.L2-3.1.11', item: 'CES.BASELINE sign_in_frequency_hours', have: 'Policy states at most 8 hours (CES baseline, founder ruling 2; sign_in_frequency_hours); tenant configured 12 hours (conditionalAccess store record r1)' };
test('V67 (ruling 2): a 12 h policy -> CMMC-SessionTimeout at <= 8 h, no credit on the 12 h policy, a CES.BASELINE row naming both values; skip otherwise', () => {
  assert.equal(sifHours({ sessionControls: sif(2, 'days') }), 48); assert.equal(sifHours({}), null);
  const ok = { caPolicies: caS1(), sspCtl: { assessmentFinding: "Session timeout: 'CMMC-SessionTimeout' at 8 h" }, gapsRows: [baselineRow] };
  assert.equal(judgeV67(ok).pass, true, judgeV67(ok).detail);
  assert.match(judgeV67({ ...ok, sspCtl: { assessmentFinding: "'T1-CA09 Session lifetime 12h - browser' at 12 h" } }).detail, /credits the weaker policy/);
  assert.match(judgeV67({ ...ok, gapsRows: [] }).detail, /no GAPS CES\.BASELINE reconciliation row naming 8 hours and 12 hours/);
  const c = caS1(); c[1].sessionControls = sif(12);
  assert.match(judgeV67({ ...ok, caPolicies: c }).detail, /CMMC-SessionTimeout enabled at 12 h \(want enabled, <= 8 h\)/);
  const skip = judgeV67({ caPolicies: [caS1()[1]], gapsRows: [] }); assert.equal(skip.pass, true); assert.match(skip.detail, /nothing to check/);
  const reportOnly = caS1(); reportOnly[0].state = 'enabledForReportingButNotEnforced';
  assert.equal(judgeV67({ caPolicies: reportOnly, gapsRows: [] }).pass, true);
  assert.match(judgeV67({ caPolicies: [caS1()[1]], profileOdps: { sign_in_frequency_hours: '12' }, gapsRows: [] }).detail, /no GAPS CES\.BASELINE reconciliation row naming the answered 12 hours/);
  assert.equal(judgeV67({ caPolicies: null }).pass, false);
});

// ---------- V68 ----------
const evs = (...types) => types.map((type) => ({ type }));
const passesOk = () => ['E7 pass 1', 'E7 pass 2', 'E7 pass 3', 'E7B'].map((name) => ({ name, events: evs('assess_start', 'assess_summary', 'assess_done') }));
test('V68: every pass ends with a terminal event; every respawn line is followed by a retried-fetch outcome', () => {
  const log = (s) => [{ file: 'out/logs/E7-eo.err', text: s }, { file: 'out/logs/E7-eo.out', text: 'Evidence Ops v0.1.0 - Starting...\n' }];
  assert.equal(judgeV68({ passes: passesOk(), logs: log('') }).pass, true);
  const p = passesOk(); p[3].events = evs('assess_start', 'signal_fetch', 'mx_stream_error');
  assert.match(judgeV68({ passes: p, logs: log('') }).detail, /E7B ends with mx_stream_error, not a terminal event/);
  const p2 = passesOk(); p2[3].events = evs('assess_start', 'assess_error');
  assert.equal(judgeV68({ passes: p2, logs: log('') }).pass, true);
  const p3 = passesOk(); p3[1].events = null;
  assert.match(judgeV68({ passes: p3, logs: log('') }).detail, /E7 pass 2: no events/);
  const resp = '[SessionFactory] Process died during execute for graph, respawning (attempt 1/5)\n[EO SessionManager] session respawn; command in flight: graph session: Get-MgUser\n';
  const done = '[EO SessionManager] fetch after a session respawn succeeded (factory re-queue): Get-MgUser\n';
  assert.equal(judgeV68({ passes: passesOk(), logs: log(resp + done) }).pass, true);
  assert.match(judgeV68({ passes: passesOk(), logs: log(resp) }).detail, /out\/logs\/E7-eo\.err: a respawn with no retried-fetch outcome after it/);
  assert.match(judgeV68({ passes: passesOk(), logs: log(done + resp) }).detail, /a respawn with no retried-fetch outcome/);
  assert.equal(judgeV68({ passes: passesOk(), logs: [{ file: 'err', text: resp }, { file: 'out', text: done }] }).pass, true);
  assert.match(judgeV68({ passes: passesOk(), logs: [] }).detail, /no EO log/);
});

// ---------- V69 + scorecard --exclude-honest-nulls ----------
const facts = (n, unsure) => Array.from({ length: n }, (_, i) => ({ question_id: `RR-ACT-AC_L2_3_1_${i + 1}`, question_text: `Status of AC.L2-3.1.${i + 1}?`, answer: i < unsure ? 'unsure' : 'yes', provenance: 'auto_detected', confidence: 'high' }));
function tmpRun({ slug = SLUG, readiness = null, ssp = null, snapshot = null, honest = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w7pkg-'));
  const root = path.join(tmp, 'ws'), out = path.join(root, 'out'), pkg = path.join(tmp, 'pkg');
  const w = (p, d) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d)); };
  w(path.join(out, 'ssp.json'), ssp ?? { sspId: 's', generatedAt: '2026-10-29T00:00:00.000Z', controlImplementations: [] });
  if (readiness) w(path.join(out, 'plan', `readiness-result-${slug}.json`), readiness);
  if (snapshot) w(path.join(out, 'eo-package', 'evidence-package-T1', 'assessments', 'latest-snapshot.json'), snapshot);
  let hf = null; if (honest) { hf = path.join(tmp, 'honest-nulls.json'); w(hf, honest); }
  fs.mkdirSync(pkg, { recursive: true });
  return { root, out, pkg, slug, hf };
}
const scOf = (m, withFile = true) => { const inp = loadInputs({ root: m.root, slug: m.slug, runDir: m.out, pkgDir: m.pkg, honestNullsFile: withFile ? m.hf : null }); return { inp, sc: computeScorecard(inp, m.pkg) }; };
test('SC-8a --exclude-honest-nulls: default off changes nothing; with the file the honest nulls leave the denominator, keep their GAPS unsure rows with the reason, and are printed', () => {
  const honest = [{ control: 'AC.L2-3.1.1', reason: 'the role list does not show who is limited to which transactions' }, { control: 'AC.L2-3.1.2', reason: 'empty by design (PIM-eligible)', scenarios: ['s2-eng'] }, { control: 'AC.L2-3.1.3', reason: 'tooling, not training' }];
  const m = tmpRun({ readiness: { facts: facts(10, 3) }, honest });
  const off = scOf(m, false).sc.rows.find((r) => r.id === 'SC-8a');
  assert.deepEqual([off.value.unsure, off.value.of, off.status, 'honestNulls' in off.value], [3, 10, 'fail', false]);
  assert.doesNotMatch(off.detail, /FQ-1/);
  const { inp, sc } = scOf(m);
  const on = sc.rows.find((r) => r.id === 'SC-8a');
  // AC.L2-3.1.2's entry is limited to s2-eng: on s1-mach only AC.L2-3.1.1 and AC.L2-3.1.3 are excluded.
  assert.deepEqual([on.value.unsure, on.value.of, on.value.pct, on.status], [1, 8, 12.5, 'pass']);
  assert.deepEqual(on.value.honestNulls.applied.map((h) => [h.control, h.answer]), [['AC.L2-3.1.1', 'unsure'], ['AC.L2-3.1.3', 'unsure']]);
  assert.match(on.detail, /; FQ-1 honest nulls excluded 2 \(2 unsure: AC\.L2-3\.1\.1 \(the role list does not show who is limited to which transactions\); AC\.L2-3\.1\.3 \(tooling, not training\)\)$/);
  assert.equal(on.value.excluded.count, 0);
  const table = renderTable(sc);
  assert.match(table, /SC-8a honest nulls excluded \(FQ-1, .*honest-nulls\.json\): 2\n {2}AC\.L2-3\.1\.1 +unsure +the role list/);
  const g = buildGaps(inp, sc);
  const u = g.rows.filter((r) => r.source === 'unsure');
  assert.equal(u.length, 3);
  assert.match(u.find((r) => r.control === 'AC.L2-3.1.1').have, /; honest null \(FQ-1\): the role list .* \(excluded from SC-8a\)$/);
  assert.equal(u.find((r) => r.control === 'AC.L2-3.1.2').reason, undefined);
  // V69 on these.
  assert.equal(judgeV69({ slug: SLUG, sc8a: on, gapsRows: g.rows }).pass, true, judgeV69({ slug: SLUG, sc8a: on, gapsRows: g.rows }).detail);
  assert.match(judgeV69({ slug: SLUG, sc8a: on, gapsRows: g.rows }).detail, /2 excluded: AC\.L2-3\.1\.1 \(the role list/);
  assert.match(judgeV69({ slug: SLUG, sc8a: on, gapsRows: [] }).detail, /AC\.L2-3\.1\.1: no GAPS unsure row with its reason/);
  const v = judgeV69({ slug: SLUG, sc8a: off, gapsRows: [] });
  assert.equal(v.pass, false); assert.match(v.detail, /FQ-1 disposition not applied \(--exclude-honest-nulls off\)/);
  assert.match(judgeV69({ slug: 's3-def', sc8a: off }).detail, /not S1 \/ S2/);
  // An interview answer for the question keeps it counted (as ruling R-1); a reasonless entry throws.
  const split = sc8aSplit({ ...inp, answers: [{ question_id: 'RR-ACT-AC_L2_3_1_1', answer: 'yes' }] });
  assert.equal(split.excluded.filter((f) => f.honestNull).length, 1);
  fs.writeFileSync(m.hf, JSON.stringify([{ control: 'AC.L2-3.1.1' }]));
  assert.throws(() => loadHonestNulls(m.hf, SLUG), /every honest null needs a control and a reason/);
  assert.equal(parseArgs(['--scenario', SLUG, '--exclude-honest-nulls', m.hf]).honestNullsFile, path.resolve(m.hf));
  // PH-11 Q4 (founder 2026-11-01): FQ-1 applies by default with the shipped list; "off" turns it off.
  assert.equal(parseArgs(['--scenario', SLUG]).honestNullsFile, DEFAULT_HONEST_NULLS_FILE);
  assert.equal(parseArgs(['--scenario', SLUG, '--exclude-honest-nulls', 'off']).honestNullsFile, null);
  assert.equal(resolveHonestNullsArg(undefined), DEFAULT_HONEST_NULLS_FILE);
  assert.equal(resolveHonestNullsArg('OFF'), null);
});

test('PH-11 Q4: the shipped FQ-1 list loads, every entry has a control and a reason, and it applies per scenario', () => {
  assert.equal(path.basename(DEFAULT_HONEST_NULLS_FILE), 'honest-nulls-fq1.json');
  const s1 = loadHonestNulls(DEFAULT_HONEST_NULLS_FILE, 's1-mach'), s2 = loadHonestNulls(DEFAULT_HONEST_NULLS_FILE, 's2-eng');
  assert.equal(s1.controls.size, 11); assert.equal(s2.controls.size, 13);
  assert.ok(!s1.controls.has('IR.L2-3.6.2') && s2.controls.has('IR.L2-3.6.2') && s2.controls.has('SC.L2-3.13.10'));
  assert.match(s1.controls.get('AT.L2-3.2.3'), /tooling, not awareness training/);
  // Q4 ruled on V69 (S1, S2 only): the shipped list moves nothing on S3 or mp.
  assert.equal(loadHonestNulls(DEFAULT_HONEST_NULLS_FILE, 's3-def').controls.size, 0);
  assert.equal(loadHonestNulls(DEFAULT_HONEST_NULLS_FILE, 'muster-partial').controls.size, 0);
});

// ---------- GAPS review rows, CES.BASELINE, V57, V70 ----------
const REVIEW = REVIEW_MARKERS[0];
const iaNameOnly = `User and device identification: the device read (/devices) was not read or was empty; ${REVIEW}: user-57 (shopfloor@t1.example, 'Shop Floor Terminal (shared login)') (managed devices with this primary user: 1)`;
test('GAPS (W7-PKG): a name-only shared-login hit is one review row per control (SSP or snapshot source); CES.BASELINE is a policy-reconciliation row; V57 leaves both out', async () => {
  const ssp = { sspId: 's', generatedAt: '2026-10-29T00:00:00.000Z', controlImplementations: [{ control_id: 'IA.L1-3.5.1', status: 'met', weight: 5, assessmentFinding: 'User and Device Identification Evidence (state not verified)' }, { control_id: 'AC.L2-3.1.11', status: 'met', weight: 1 }],
    policyReconciliation: [{ controlId: 'AC.L2-3.1.11', odpId: 'CES.BASELINE', odpKey: 'sign_in_frequency_hours', policyValue: 'at most 8 hours (CES baseline, founder ruling 2; sign_in_frequency_hours)', tenantValue: '12 hours', sourceRows: ["CA policy 'T1-CA09 Session lifetime 12h - browser' signInFrequency 12 hours"], readReference: 'conditionalAccess store record r1' }] };
  const snapshot = { snapshotId: 'snap-1', controls: [{ control_id: 'IA.L1-3.5.1', status: 'met', statusRationale: 'Tier 4 decides', sources: [{ type: 'discovery', result: 'no_query', detail: iaNameOnly }, { type: 'discovery', result: 'no_query', detail: iaNameOnly }] }] };
  const m = tmpRun({ ssp, snapshot });
  const { inp, sc } = scOf(m, false);
  const g = buildGaps(inp, sc);
  const rv = g.rows.filter((r) => r.source === 'review');
  assert.equal(rv.length, 1);
  assert.deepEqual([rv[0].id, rv[0].control, rv[0].item, rv[0].module, rv[0].owner, rv[0].weight], [gapId('review', 'IA.L1-3.5.1', REVIEW), 'IA.L1-3.5.1', REVIEW, 'EvidenceOps', 'founder content', 5]);
  assert.match(rv[0].have, /^Review finding \(shared-login name, not corroborated\): user-57/);
  const pr = g.rows.find((r) => r.source === 'policy-reconciliation');
  assert.deepEqual([pr.control, pr.item], ['AC.L2-3.1.11', 'CES.BASELINE sign_in_frequency_hours']);
  assert.match(pr.have, /^Policy states at most 8 hours .*; tenant configured 12 hours/);
  assert.equal(judgeV67({ caPolicies: caS1(), sspCtl: { assessmentFinding: 'CMMC-SessionTimeout 8 h' }, gapsRows: g.rows }).pass, true);
  // V57 through registerW4Checks: the newest proof run had the loop rows only; the review and reconciliation rows are left out.
  const loop = g.rowCount - 2;
  fs.mkdirSync(path.join(m.pkg, 'expected-outputs', SLUG, 'proof-runs', 'nb-run1'), { recursive: true });
  fs.writeFileSync(path.join(m.pkg, 'expected-outputs', SLUG, 'proof-runs', 'nb-run1', `GAPS-${SLUG}.json`), JSON.stringify({ generatedAt: '2026-10-28T00:00:00.000Z', rowCount: loop }));
  const checks = {};
  const w4 = await registerW4Checks((id, title, fn) => { checks[id] = fn(); }, { root: m.root, slug: SLUG, out: m.out, pkgDir: m.pkg });
  assert.equal(checks.V57.pass, true, checks.V57.detail);
  assert.match(checks.V57.detail, new RegExp(`^${loop} rows now vs ${loop} in nb-run1 \\(\\+0\\); 1 policy-reconciliation rows excluded .*; 1 review rows excluded \\(EO review findings, not loop gaps\\)$`));
  assert.equal(w4.gaps.rowCount, g.rowCount); assert.ok(w4.sc.rows.length >= 10);
  // V70 on the same input: a name-only hit with its review row passes; without the row it fails.
  const snapCtl = snapshot.controls[0];
  assert.equal(judgeV70({ sspCtl: ssp.controlImplementations[0], snapCtl, gapsRows: g.rows }).pass, true);
  assert.match(judgeV70({ sspCtl: ssp.controlImplementations[0], snapCtl, gapsRows: [] }).detail, /a name-only shared-login hit with no GAPS review row/);
});
test('V70: not met on a shared-login name needs the managed-device corroboration; other not-met reasons and no hit pass', () => {
  const corroborated = { control_id: 'IA.L1-3.5.1', status: 'not_met', assessmentFinding: 'User and device identification: 1 enabled account(s) named as a shared or generic login and primary user of more than one managed device, so its actions are not traceable to one person: user-57 (shopfloor@t1.example) on 4 devices (T1-SF-01, T1-SF-02, T1-SF-03, T1-SF-04)' };
  const r = judgeV70({ sspCtl: corroborated, gapsRows: [] }); assert.equal(r.pass, true, r.detail); assert.match(r.detail, /corroborated: managed devices/);
  const nameOnly = { control_id: 'IA.L1-3.5.1', status: 'not_met', assessmentFinding: 'User and device identification: 1 enabled account(s) named as a shared or generic login, so its actions are not traceable to one person: user-57 (shopfloor@t1.example)' };
  assert.match(judgeV70({ sspCtl: nameOnly, gapsRows: [] }).detail, /^not met on a shared-login name without a corroborating signal/);
  assert.equal(judgeV70({ sspCtl: { status: 'not_met', assessmentFinding: 'User and device identification: duplicate user principal name(s): a@t.example' }, gapsRows: [] }).pass, true);
  assert.equal(judgeV70({ sspCtl: { status: 'met', assessmentFinding: 'ok' }, gapsRows: [] }).pass, true);
  assert.match(judgeV70({ sspCtl: { status: 'met' }, gapsRows: [{ id: 'G-r', source: 'review', control: 'IA.L1-3.5.1' }] }).detail, /GAPS review row G-r without a name-only hit/);
});

// ---------- V71 ----------
test('V71: Stamper\'s E6 record of the Muster predicate\'s lookup agrees with EO at E7, or GAPS names both bases', () => {
  const sat = { registryEntry: { entry_id: 'AC.L1-3.1.1.ca-mfa-compliant-device' }, complianceVerdict: 'SAT', metadata: { postcheckMode: 'state' } };
  assert.match(judgeV71({ stamperRec: sat, discoveryAnswer: 'no', eoStatus: 'met' }).detail, /^agree: Stamper E6 AC\.L1-3\.1\.1\.ca-mfa-compliant-device SAT \(postcheckMode state\) -> met; EO at E7 met$/);
  const d = judgeV71({ stamperRec: sat, eoStatus: 'not_met', gapsRows: [] });
  assert.equal(d.pass, false); assert.match(d.detail, /no GAPS reconciliation row on AC\.L1-3\.1\.1 naming both bases/);
  const row = { id: 'G-ac', source: 'policy-reconciliation', control: 'AC.L1-3.1.1', item: 'basis', needs: 'reconcile', have: 'Muster predicate ca-mfa-compliant-device met; EvidenceOps caEnforcementEvaluator not_met' };
  assert.equal(judgeV71({ stamperRec: sat, eoStatus: 'not_met', gapsRows: [row] }).pass, true);
  assert.equal(judgeV71({ stamperRec: null, discoveryAnswer: 'no', eoStatus: 'not_met' }).pass, true);
  assert.equal(judgeV71({ stamperRec: null, discoveryAnswer: 'unsure', eoStatus: 'met' }).pass, false);
  assert.equal(judgeV71({ stamperRec: sat, eoStatus: null }).pass, false);
});

// ---------- V59: the AdminOps confirming read ----------
test('V59 (W7-PKG): an AdminOps deficiency is fixed when every named write op applied and confirmed, whatever the control status; one failed run keeps it open', () => {
  const ssp = { sspId: 's', generatedAt: '2026-10-29T00:00:00.000Z', controlImplementations: [{ control_id: 'AC.L2-3.1.7', status: 'not_met', weight: 1 }] };
  const m = tmpRun({ slug: 's3-def', ssp });
  const def = { schema: 'test', slug: 's3-def', deficiencies: [{ id: 'T-D04', title: 't', controls: ['AC.L2-3.1.7'], what_is_wrong: 'break-glass in no exclusion (fictional)', fixer: 'AdminOps', e7a_op: 'A-19 break-glass exclusion (T3) x2', gaps_row: { source: 'deficiency', module: 'AdminOps', control: 'AC.L2-3.1.7', item: 'T-D04', needs: 'n', have: 'h', owner: 'BHD' }, gaps_also: [], match: [], stamper_entries: [] }] };
  fs.mkdirSync(path.join(m.pkg, 'customers', 's3-def'), { recursive: true });
  fs.writeFileSync(path.join(m.pkg, 'customers', 's3-def', 'deficiencies.json'), JSON.stringify(def));
  const run = (ops) => { fs.writeFileSync(path.join(m.out, 'adminops-e7a.json'), JSON.stringify(e7aOf(ops))); const { inp, sc } = scOf(m, false); return buildGaps(inp, sc); };
  let g = run([a19('breakglass_ca_policy_1'), a19('breakglass_ca_policy_2')]);
  const x = g.deficiencies.rows[0];
  assert.deepEqual([x.resolved, x.fixerActed, x.note, x.fallbackRow], [true, 'AdminOps A-19 x2 in E7A (confirmed)', 'fixed: confirming read passed (control not_met, decided on other objects)', null]);
  assert.equal(g.bySource.deficiency, undefined);
  g = run([a19('breakglass_ca_policy_1'), a19('breakglass_ca_policy_2', { confirm: { pass: false, actual: '[]' } })]);
  assert.deepEqual([g.deficiencies.rows[0].resolved, g.deficiencies.rows[0].fixerActed], [false, 'still open']);
  assert.equal(g.bySource.deficiency, 1);
  g = run([]);
  assert.deepEqual(g.deficiencies.unsurfaced, ['T-D04']);
});

// ---------- package data and harness edits (read only) ----------
test('customers\\s3-def\\deficiencies.json: S3-D04 is AdminOps A-19 (no match keyword, no Stamper entry); D06, D11, D12, D13, D14 predict not_met', () => {
  const d = JSON.parse(fs.readFileSync(path.join(PKG, 'customers', 's3-def', 'deficiencies.json'), 'utf8'));
  const by = Object.fromEntries(d.deficiencies.map((x) => [x.id, x]));
  assert.equal(by['S3-D04'].fixer, 'AdminOps');
  assert.deepEqual(String(by['S3-D04'].e7a_op).match(/\b[A-Z]-\d{2}\b/g), ['A-19']);
  assert.deepEqual([by['S3-D04'].match, by['S3-D04'].stamper_entries], [[], []]);
  for (const id of ['S3-D06', 'S3-D11', 'S3-D12', 'S3-D13', 'S3-D14']) {
    assert.match(by[id].expected_status.e7, /^not_met/, id); assert.match(by[id].expected_status.e7b, /^not_met/, id);
    assert.match(by[id].detect, /^EO \w+Evaluator/, id);
  }
  assert.match(by['S3-D12'].detect, /primary user of more than one managed device/);
  assert.equal(d.deficiencies.length, 17);
});
test('mx-helpers.mjs pushes cui_boundary; bundle.mjs persists btc-confirmation- and maps cui-boundary- to cui_boundary_ref', () => {
  const mx = fs.readFileSync(path.join(HERE, 'mx-helpers.mjs'), 'utf8');
  assert.match(mx, /const handoff = \{[\s\S]*?cui_boundary: 'cui-boundary-',[\s\S]*?\};/);
  const b = fs.readFileSync(path.join(HERE, 'bundle.mjs'), 'utf8');
  assert.match(b, /const HANDOFF = \{[^}]*'cui-boundary-': 'cui_boundary_ref' \};/);
  assert.match(b, /const persisted = \[\.\.\.Object\.keys\(HANDOFF\), 'tenant-config-profile-', 'btc-confirmation-'\]/);
});
