// Gap closure FLOW-3 tests (GAP-CLOSURE-PLAN.md §4 G-FLOW; §5 V84): node --test scripts/gap-flow3.test.mjs
// judgeV84 over synthetic records; the V79 policies gate per harness; verify.mjs wiring. No workspace writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV84, judgeV79, V84_RECORD_SCHEMA } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H = (c) => c.repeat(64);
const pushed = ['manual-mission-plan-s1-2026.json', 'tenant-manifest-s1-2026.json', 'policy-set-manifest-s1-2026.json', 'cui-boundary-s1-2026.json'];
const planFiles = {
  [pushed[0]]: { sha256: H('a') },
  [pushed[1]]: { sha256: H('b') },
  [pushed[2]]: { sha256: H('c'), hash_sha256: H('d'), artifact_id: 'policy-set-manifest-x' },
  [pushed[3]]: { sha256: H('e'), hash_sha256: H('f'), artifact_id: 'cui-boundary-x' },
};
const policyDocs = [{ name: 'policies/access-control-policy.md', sha256: H('1') }, { name: 'policies/poam.md', sha256: H('2') }];
const record = (over = {}) => ({
  schema: V84_RECORD_SCHEMA, status: 'delivered', http: 201,
  receipt: {
    receipt_id: 'intake-2026-10-30T12-00-00-000Z',
    items: [
      { kind: 'mission_plan', file_name: pushed[0], sha256: H('a') },
      { kind: 'tenant_manifest', file_name: pushed[1], sha256: H('b') },
      { kind: 'policy_set_manifest', file_name: pushed[2], sha256: H('c'), hash_sha256: H('d'), artifact_id: 'policy-set-manifest-x' },
      { kind: 'cui_boundary', file_name: pushed[3], sha256: H('e'), hash_sha256: H('f'), artifact_id: 'cui-boundary-x' },
    ],
    policies: { documents: policyDocs.map((d) => ({ ...d, domain: 'AC' })), store_count: 2 },
  },
  ...over,
});
const ssp = (over = {}) => ({
  authorizationBoundary: {
    description: `Zones... CUI boundary facts: CUI Boundary cui-boundary-x (sha256 ${H('f')}), received from Muster through EO intake intake-2026-10-30T12-00-00-000Z.`,
    cuiBoundarySource: { source: 'cui_boundary_envelope', artifact_id: 'cui-boundary-x', hash_sha256: H('f'), intake_receipt_id: 'intake-2026-10-30T12-00-00-000Z', received_at: 'x' },
    ...over,
  },
});
const input = (over = {}) => ({ harness: 'tester', record: record(), pushResponse: { pushed }, planFiles, pushedPolicyDocs: policyDocs, ssp: ssp(), ...over });

test('V84 passes when the receipt equals the push, the store holds the pushed policies and the SSP cites the envelope', () => {
  const r = judgeV84(input());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /\(a\) receipt intake-2026-10-30T12-00-00-000Z: 4 pushed file\(s\), hashes equal/);
  assert.match(r.detail, /\(b\) policies 2 = pushed 2, store 2/);
  assert.match(r.detail, /\(c\) SSP boundary cites cui-boundary-x sha256 ffffffffffff/);
});

test('V84 (a) fails on a missing, changed or extra receipt part and on a refused intake', () => {
  const rec = record();
  rec.receipt.items = rec.receipt.items.filter((i) => i.kind !== 'tenant_manifest');
  assert.match(judgeV84(input({ record: rec })).detail, /\(a\) 1 pushed file\(s\) not in the intake receipt: tenant-manifest-s1-2026\.json/);
  assert.match(judgeV84(input({ planFiles: { ...planFiles, [pushed[0]]: { sha256: H('9') } } })).detail, /\(a\) 1 receipt hash\(es\) differ from the pushed file: manual-mission-plan/);
  assert.match(judgeV84(input({ planFiles: { ...planFiles, [pushed[3]]: { ...planFiles[pushed[3]], hash_sha256: H('8') } } })).detail, /\(a\) 1 envelope hash_sha256 \/ artifact_id differ/);
  const extra = record();
  extra.receipt.items.push({ kind: 'tcp', file_name: null, sha256: H('7') });
  // FIN-35 S-1 (GD-e): tcp is EO-only, so an unpushed tcp part is judged against the MP reference (none here).
  assert.match(judgeV84(input({ record: extra })).detail, /EO-only receipt part\(s\) whose hash or id differ from the MP reference: tcp/);
  const extra2 = record();
  extra2.receipt.items.push({ kind: 'infra_manifest', file_name: null, sha256: H('7') });
  assert.match(judgeV84(input({ record: extra2 })).detail, /receipt parts with no pushed file: infra_manifest/);
  const refused = judgeV84(input({ record: { schema: V84_RECORD_SCHEMA, status: 'failed', http: 400, error: '{"error":"Intake bundle violation"}' } }));
  assert.equal(refused.pass, false);
  assert.match(refused.detail, /intake failed \(HTTP 400\): \{"error":"Intake bundle violation"\}/);
});

test('V84 (b) fails when policies are missing, differ, or the store count is not the pushed count', () => {
  const rec = record();
  rec.receipt.policies = { documents: [{ name: policyDocs[0].name, sha256: H('3') }], store_count: 3 };
  const r = judgeV84(input({ record: rec }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /\(b\) 1 pushed policy document\(s\) not delivered: policies\/poam\.md/);
  assert.match(r.detail, /\(b\) 1 delivered policy document\(s\) not in the manifest or with another sha256: policies\/access-control-policy\.md/);
  assert.match(r.detail, /\(b\) EO's policy store holds 3 polic\(ies\), the pushed policy-set manifest 2/);
  assert.match(judgeV84(input({ pushedPolicyDocs: null, record: record() })).detail, /\(b\) no pushed policy-set manifest/);
});

test('V84 (c) fails when the SSP falls back to the TM, cites another hash or another intake; n/a without a pushed boundary', () => {
  assert.match(judgeV84(input({ ssp: ssp({ cuiBoundarySource: undefined }) })).detail, /\(c\) the SSP boundary section cites no CUI Boundary envelope/);
  assert.match(judgeV84(input({ ssp: ssp({ cuiBoundarySource: { ...ssp().authorizationBoundary.cuiBoundarySource, hash_sha256: H('0') } }) })).detail, /\(c\) the SSP cites cui-boundary-x 000000000000, the pushed envelope is cui-boundary-x ffffffffffff/);
  assert.match(judgeV84(input({ ssp: ssp({ cuiBoundarySource: { ...ssp().authorizationBoundary.cuiBoundarySource, intake_receipt_id: 'intake-old' } }) })).detail, /\(c\) the SSP cites intake intake-old/);
  assert.match(judgeV84(input({ ssp: ssp({ description: 'no hash' }) })).detail, /\(c\) the boundary description does not name the envelope hash/);
  assert.match(judgeV84(input({ ssp: null })).detail, /\(c\) no SSP JSON/);
  const noCui = judgeV84(input({ pushResponse: { pushed: pushed.slice(0, 3) }, record: { ...record(), receipt: { ...record().receipt, items: record().receipt.items.slice(0, 3) } } }));
  assert.equal(noCui.pass, true, noCui.detail);
  assert.match(noCui.detail, /\(c\) no CUI Boundary pushed: not applicable/);
});

test('V84 without a record: fails under -Harness tester, "not run" under -Harness mx; a stale record fails', () => {
  assert.equal(judgeV84(input({ record: null })).pass, false);
  const mx = judgeV84(input({ record: null, harness: 'mx' }));
  assert.equal(mx.pass, true);
  assert.match(mx.detail, /not run \(-Harness mx: mx-e2e\.ps1 makes no EO intake call/);
  assert.deepEqual(judgeV84(input({ stale: 'stale artefact from an earlier run: eo-intake.json' })), { pass: false, detail: 'stale artefact from an earlier run: eo-intake.json' });
});

test('V79 (a) gates on the policy count under -Harness tester', () => {
  const files = { 'policies/README.md': H('r') };
  const r = judgeV79({ pkgName: 'p', files, integrity: { files: [] }, index: null, pushedPolicyCount: 22, chain: [] });
  assert.match(r.detail, /\(a\) EO's policy store is empty \(policies\/README\.md only\) but the pushed policy-set manifest lists 22/);
  assert.doesNotMatch(judgeV79({ pkgName: 'p', files, integrity: { files: [] }, index: null, pushedPolicyCount: 22, chain: [], harness: 'mx' }).detail, /did not deliver/);
});

test('verify.mjs wires V84 once (after V79, before the result) and passes the harness to V79; verify-gap keeps its CRLF block', () => {
  const v = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.equal((v.match(/check\('V84'/g) ?? []).length, 1);
  assert.ok(v.indexOf("check('V79'") < v.indexOf("check('V84'") && v.indexOf("check('V84'") < v.indexOf('const result = {'));
  assert.match(v, /pushedPolicyCount, chain, harness,/);
  assert.match(v, /gapmod\.judgeV84\(\{\s*harness, record: exists\(eoIntakeFile\)/);
  assert.equal((v.match(/\r\n/g) ?? []).length, 0);
  // The V75 / V86 / V81 block (lines 292-425) stays CRLF; other blocks may carry either ending.
  const g = fs.readFileSync(path.join(HERE, 'verify-gap.mjs'), 'utf8').split('\n');
  assert.ok(g.slice(291, 425).every((l) => l.endsWith('\r')));
});
