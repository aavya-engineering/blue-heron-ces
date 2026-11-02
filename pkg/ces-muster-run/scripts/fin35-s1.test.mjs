// FIN-35 S-1 (GD-e, LOG-FIN-28 §3 S-1): the harness half of "stop writing the three unread envelopes to Stamper's plans
// folder". V62 reads the three Stamper-stored kinds from the plans folder and the three EO-only kinds from EO's newest
// intake receipt; V84 accepts EO-only receipt parts that match the MP references; V122 (c) judges GD-e. Fictional values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { judgeV62, readEoIntake, EO_ONLY_HANDOFF } from './verify-w4.mjs';
import { judgeV84, V84_EO_ONLY_KINDS } from './verify-gap.mjs';
import { judgeV122 } from './verify-fin29.mjs';

const SLUG = 's1-mach';
const hash = (a) => crypto.createHash('sha256').update(JSON.stringify(a)).digest('hex');
const KINDS = { si_baseline: 'si-baseline-', tcp: 'tcp-', readiness_posture: 'readiness-posture-', policy_inputs_profile: 'policy-inputs-profile-', policy_set_manifest: 'policy-set-manifest-', cui_boundary: 'cui-boundary-' };

/** A plans folder with the three Stamper-stored kinds only, and an EO intake folder with all six (as after S-1). */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fin35-s1-'));
  const eo = path.join(root, 'eo');
  const rdir = path.join(eo, 'intake', SLUG, 'intake-20261031T120000000Z');
  fs.mkdirSync(rdir, { recursive: true });
  const files = { [`manual-mission-plan-${SLUG}-T.json`]: {}, [`tenant-manifest-${SLUG}-T.json`]: {} };
  const inputs = {};
  const items = [];
  for (const [k, pfx] of Object.entries(KINDS)) {
    const art = { kind: k };
    const env = { artifact_id: `${k}-1`, hash_sha256: hash(art), artifact: art };
    inputs[`${k}_ref`] = { artifact_id: `${k}-1`, hash_sha256: hash(art) };
    if (!EO_ONLY_HANDOFF.includes(k)) files[`${pfx}${SLUG}-T.json`] = env;
    fs.writeFileSync(path.join(rdir, `${k}.json`), JSON.stringify(env));
    items.push({ kind: k, stored_as: `${k}.json`, file_name: `${pfx}${SLUG}-T.json`, sha256: 'x', artifact_id: env.artifact_id, hash_sha256: env.hash_sha256 });
  }
  fs.writeFileSync(path.join(rdir, 'receipt.json'), JSON.stringify({ receipt_id: 'intake-20261031T120000000Z', items }));
  return { root, eo, rdir, files, inputs };
}
const v62 = (f, intake) => judgeV62({ plansFiles: Object.keys(f.files), readEnv: (n) => f.files[n], mpInputs: f.inputs, recompute: hash, intake, readIntake: (p) => JSON.parse(fs.readFileSync(p, 'utf8')) });

test('S-1: the EO-only kinds match muster-api planHandoff.ts (EO_ONLY_KINDS minus the interim profile)', () => {
  assert.deepEqual([...EO_ONLY_HANDOFF].sort(), ['readiness_posture', 'si_baseline', 'tcp']);
  assert.deepEqual([...V84_EO_ONLY_KINDS].sort(), [...EO_ONLY_HANDOFF].sort());
});

test('readEoIntake: the newest receipt, each stored part by kind; null without one', () => {
  const f = fixture();
  const older = path.join(f.eo, 'intake', SLUG, 'intake-20261030T000000000Z');
  fs.mkdirSync(older);
  fs.writeFileSync(path.join(older, 'receipt.json'), JSON.stringify({ receipt_id: 'old', items: [] }));
  const i = readEoIntake(f.eo, SLUG);
  assert.equal(i.receiptId, 'intake-20261031T120000000Z');
  assert.deepEqual(Object.keys(i.files).sort(), Object.keys(KINDS).sort());
  assert.equal(readEoIntake(f.eo, 'other'), null);
  assert.equal(readEoIntake(path.join(f.root, 'none'), SLUG), null);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('V62 (S-1): three kinds from the plans folder, three from EO intake, all MP-referenced', () => {
  const f = fixture();
  const r = v62(f, readEoIntake(f.eo, SLUG));
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /^6 hand-off envelopes .*si_baseline \(EO intake\), tcp \(EO intake\), readiness_posture \(EO intake\), policy_inputs_profile, policy_set_manifest, cui_boundary/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('V62 (S-1): an EO-only file left in the plans folder, a missing intake, or an intake hash that differs from the MP fails', () => {
  let f = fixture();
  f.files[`si-baseline-${SLUG}-T.json`] = { artifact_id: 'si_baseline-1' };
  assert.match(v62(f, readEoIntake(f.eo, SLUG)).detail, /EO-only envelope\(s\) in Stamper's plans folder \(GD-e\): si-baseline-s1-mach-T\.json/);
  fs.rmSync(f.root, { recursive: true, force: true });
  f = fixture();
  const r = v62(f, null);
  assert.equal(r.pass, false);
  assert.match(r.detail, /no EO intake receipt/);
  fs.rmSync(f.root, { recursive: true, force: true });
  f = fixture();
  f.inputs.readiness_posture_ref.hash_sha256 = 'f'.repeat(64);
  assert.match(v62(f, readEoIntake(f.eo, SLUG)).detail, /readiness_posture\.json: id \/ hash differ from inputs\.readiness_posture_ref/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('V62 without the intake argument keeps the pre-S-1 behaviour (all six from the plans folder)', () => {
  const f = fixture();
  const r = judgeV62({ plansFiles: Object.keys(f.files), readEnv: (n) => f.files[n], mpInputs: f.inputs, recompute: hash });
  assert.equal(r.pass, false);
  assert.match(r.detail, /inputs\.si_baseline_ref references si_baseline-1 but no si-baseline-\* was pushed/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('V84 (S-1): EO-only receipt parts are accepted when they carry the MP reference; otherwise named', () => {
  const pushed = [`manual-mission-plan-${SLUG}-T.json`];
  const planFiles = { [pushed[0]]: { sha256: 'a' } };
  const mpInputs = { si_baseline_ref: { artifact_id: 'si-1', hash_sha256: 'h1' } };
  const record = (items) => ({ schema: 'ces-tester/eo-intake@1', status: 'delivered', http: 201, receipt: { receipt_id: 'r1', items, policies: {} } });
  const ok = judgeV84({ record: record([{ kind: 'mission_plan', file_name: pushed[0], sha256: 'a' }, { kind: 'si_baseline', file_name: `si-baseline-${SLUG}-T.json`, artifact_id: 'si-1', hash_sha256: 'h1' }]), pushResponse: { pushed }, planFiles, mpInputs });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /EO-only parts si_baseline match the MP references \(GD-e\)/);
  const bad = judgeV84({ record: record([{ kind: 'mission_plan', file_name: pushed[0], sha256: 'a' }, { kind: 'si_baseline', file_name: 'x', artifact_id: 'si-1', hash_sha256: 'zz' }]), pushResponse: { pushed }, planFiles, mpInputs });
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /EO-only receipt part\(s\) whose hash or id differ from the MP reference: si_baseline/);
  // A non-EO-only extra part is still "extra".
  const extra = judgeV84({ record: record([{ kind: 'mission_plan', file_name: pushed[0], sha256: 'a' }, { kind: 'cui_boundary', file_name: 'c.json' }]), pushResponse: { pushed }, planFiles, mpInputs });
  assert.match(extra.detail, /receipt parts with no pushed file: cui_boundary/);
});

test('V122 (c): GD-e judged: no EO-only file in plans, EO intake names all six (TCP / boundary only when referenced)', () => {
  const base = { plannerDirExists: false, rootPkg: { workspaces: [], scripts: {} }, unitGate: { suites: [{ suite: 'ces-muster' }] } };
  const f = fixture();
  const intake = readEoIntake(f.eo, SLUG);
  const ok = judgeV122({ ...base, gdE: true, plansFiles: Object.keys(f.files), intake });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /\(c\) GD-e: no EO-only envelope in Stamper's plans folder; EO intake intake-20261031T120000000Z names 6 hand-off kinds/);
  const stray = judgeV122({ ...base, gdE: true, plansFiles: [...Object.keys(f.files), `tcp-${SLUG}-T.json`], intake });
  assert.match(stray.detail, /still holds EO-only envelope\(s\): tcp-s1-mach-T\.json/);
  const lacking = { ...intake, receipt: { ...intake.receipt, items: intake.receipt.items.filter((i) => i.kind !== 'tcp') } };
  assert.match(judgeV122({ ...base, gdE: true, plansFiles: Object.keys(f.files), intake: lacking }).detail, /lacks tcp/);
  assert.equal(judgeV122({ ...base, gdE: true, plansFiles: Object.keys(f.files), intake: lacking, tcpExpected: false }).pass, true);
  assert.match(judgeV122({ ...base, gdE: true, plansFiles: null, intake: null }).detail, /no Stamper plans folder; \(c\) no EO intake receipt/);
  // Not asked: (c) reported "not judged".
  assert.match(judgeV122(base).detail, /\(c\) GD-e not judged here/);
  fs.rmSync(f.root, { recursive: true, force: true });
});
