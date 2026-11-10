// FIN-01 tests (FINISH-PLAN.md §3.1): V36 projection sentences, V65 honest drop, V104 / V107 on S3, V108 store moves, V109.
// node --test scripts/gap-fin01.test.mjs. Synthetic fixtures, plus the saved W9-R4a S3 Infrastructure Manifest and the
// W9-R4a S1 / S2 summaries when present (skipped with the path otherwise). Nothing in the workspace is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectionSentences, judgeV108, judgeV109, judgeV107, V108_ESCROW_FILE, V80_STORE_DECIDED } from './verify-gap.mjs';
import { judgeV65Drop } from './verify-w4.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, '..', '..', '..');
const readIf = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) : null);

// ---------- V36 (c) ----------
test('V36 projection sentences: the W9-R4a S2 false positives are not the projection; an unlabelled projection still is', () => {
  const text = [
    'The POA&M is generated through the Evidence Ops platform, which tracks control implementation status, assigns remediation timelines (90-day default), identifies residual risk and feeds the SPRS score.',
    "Presence only: this met status rests on a live read that confirms only that 'secureScores' was read (/security/secureScores) and returned 90 objects; 'collect.secureScoreControlProfiles' returned 8.",
    'Basis of determination: Secure Score of 2026-10-31 lists 8 recommendation(s); 90 dated score(s) collected; 8 profiles.',
    "Read: 'collect.secureScores' returned 90 records; 'collect.secureScoreControlProfiles' returned 8 records",
    'SPRS (assessed): 30 = 110 - 90 (12 not met) - 38 (19 not assessed)',
  ].join('\n');
  const r = projectionSentences(text, 90);
  assert.deepEqual(r.sentences, [], JSON.stringify(r.sentences));
  const planted = projectionSentences(`${text}\nThe SPRS score after remediation is 90 points\nProjected SPRS after the POA&M: 90 points`, 90);
  assert.equal(planted.unlabelled.length, 1);
  assert.match(planted.unlabelled[0], /^The SPRS score after remediation is 90 points$/);
  assert.equal(planted.labelled, 1);
});

// ---------- V65 (a) ----------
const wf = (over = {}) => ({ id: 'wf-3', displayName: 'T1 Leaver', category: 'leaver', isEnabled: true, isSchedulingEnabled: true, tasks: [{ taskDefinitionId: '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950', displayName: 'Disable user account', isEnabled: true }], ...over });
const a21 = (over = {}) => ({ op: 'A-21', tier: 'T2', kind: 'write', ok: true, params: [{ name: 'leaverWorkflowId', from: 'resources.leaver_workflow_id', value: 'wf-3' }], calls: [{ call: 'dry_run', ok: true }, { call: 'apply', ok: true }], confirm: { pass: true, actual: 'true' }, ...over });
const v65 = () => ({
  slug: 's1-mach', driftCtl: null,
  sspCtl: { control_id: 'PS.L2-3.9.2', status: 'not_met', assessmentObjectives: [{ objectiveId: 'PS.L2-3.9.2[a]', source: 'personnel' }] },
  snapCtl: { control_id: 'PS.L2-3.9.2', status: 'not_met', statusRationale: 'Store precedence (personnel store, ledger precedence): termination from the organisation\'s records; was met (Tier 2)' },
  workflows: [wf()], e7a: { ops: [a21()] },
});
test('V65 honest drop: A-21 ran and confirmed, the bound leaver is scheduled at E7B, PS.L2-3.9.2 stays not_met by the personnel store', () => {
  const ok = judgeV65Drop(v65());
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /decided by the personnel records store \(snapshot rationale\).*wf-3 enabled, scheduled/);
  const noSnap = judgeV65Drop({ ...v65(), snapCtl: null });
  assert.equal(noSnap.pass, true, noSnap.detail);
  assert.match(noSnap.detail, /\(SSP objectives\)/);
  assert.equal(judgeV65Drop({ slug: 's3-def' }).pass, true);
  const brk = (fn) => { const i = v65(); fn(i); return judgeV65Drop(i); };
  for (const [fn, re] of [
    [(i) => { i.driftCtl = { previous: { status: 'not_met' }, current: { status: 'met' } }; }, /E7 pass 3 not_met -> E7B met \(want no status move/],
    [(i) => { i.sspCtl.status = 'met'; }, /SSP PS\.L2-3\.9\.2 met \(want not_met/],
    [(i) => { i.snapCtl = null; i.sspCtl.assessmentObjectives = [{ source: 'tenant' }]; }, /not decided by the personnel records store/],
    [(i) => { i.e7a = { ops: [] }; }, /no A-21 op in E7A/],
    [(i) => { i.e7a.ops[0].calls = [{ call: 'dry_run', ok: true }]; }, /A-21 calls not ok: apply/],
    [(i) => { i.e7a.ops[0].confirm = { pass: false, actual: 'false' }; }, /A-21 confirming read failed \(false\)/],
    [(i) => { i.e7a.ops[0].params = []; }, /A-21 bound 0 leaver workflow id\(s\)/],
    [(i) => { i.workflows = null; }, /no E7B lifecycleWorkflows read/],
    [(i) => { i.workflows = [wf({ id: 'other' })]; }, /leaver workflow wf-3 not in the E7B read/],
    [(i) => { i.workflows = [wf({ isSchedulingEnabled: false })]; }, /wf-3: category leaver, isEnabled true, isSchedulingEnabled false, disable task true/],
    [(i) => { i.workflows = [wf({ tasks: [{ taskDefinitionId: 'x', displayName: 'Send email' }] })]; }, /disable task false/],
  ]) {
    const r = brk(fn);
    assert.equal(r.pass, false, String(re));
    assert.match(r.detail, re);
  }
});

// ---------- V108 (b) ----------
const W = { 'SC.L2-3.13.10': 1, 'PS.L2-3.9.2': 5, 'PS.L2-3.9.1': 3, 'AC.L1-3.1.1': 5 };
const weightOf = (id) => W[id] ?? 0;
const baseBy = { 'SC.L2-3.13.10': 'met', 'PS.L2-3.9.2': 'met', 'PS.L2-3.9.1': 'not_assessed', 'AC.L1-3.1.1': 'not_met' };
test('V108 excludes moves the records stores decided (NS-3b) and reproduces the SPRS with them; other moves still fail', () => {
  const now = { ...baseBy, 'PS.L2-3.9.2': 'not_met', 'PS.L2-3.9.1': 'met' };
  const r = judgeV108({ statusBy: now, baselineBy: baseBy, baselineName: 'b', weightOf, evFiles: [V108_ESCROW_FILE], storeDecided: ['PS.L2-3.9.1', 'PS.L2-3.9.2'] });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /SPRS 100 \(b 102\); 2 store-decided move\(s\) excluded \(NS-3b\): PS\.L2-3\.9\.2 met -> not_met, PS\.L2-3\.9\.1 not_assessed -> met; SPRS the gate must reproduce 100/);
  const a = judgeV108({ statusBy: { ...now, 'SC.L2-3.13.10': 'not_met' }, baselineBy: baseBy, weightOf, evFiles: [V108_ESCROW_FILE], storeDecided: new Set(['PS.L2-3.9.1', 'PS.L2-3.9.2']) });
  assert.equal(a.pass, true, a.detail);
  const notStore = judgeV108({ statusBy: now, baselineBy: baseBy, weightOf, evFiles: [V108_ESCROW_FILE], storeDecided: ['PS.L2-3.9.1'] });
  assert.equal(notStore.pass, false);
  assert.match(notStore.detail, /1 control\(s\) moved .*PS\.L2-3\.9\.2 met -> not_met/);
  assert.equal(judgeV108({ statusBy: now, baselineBy: baseBy, weightOf, evFiles: [V108_ESCROW_FILE] }).pass, false);
  assert.ok(V80_STORE_DECIDED.test('Store precedence (personnel store, ledger precedence): x'));
  assert.ok(!V80_STORE_DECIDED.test('Tier 2; store precedence (personnel store) agrees: x'));
});

const R4A_SUMMARY = (slug) => path.join(WS, 'evidence', `gc-w9r4a-${slug}`, 'summary.json');
const SPRS_WEIGHTS = path.join(WS, 'ces', 'ces-shared', 'dist', 'data', 'sprs-weights.json');
const v108Skip = [SPRS_WEIGHTS, R4A_SUMMARY('s1-mach'), R4A_SUMMARY('s2-eng')].find((p) => !fs.existsSync(p));
test('V108 over the W9-R4a S1 / S2 summaries against expected-outputs (when present): the two PS store moves explain 82 -> 80 and 87 -> 85', { skip: v108Skip ? `absent: ${v108Skip}` : false }, () => {
  const w = new Map(readIf(path.join(WS, 'ces', 'ces-shared', 'dist', 'data', 'sprs-weights.json')).controls.map((c) => [c.control_id, Number(c.weight)]));
  for (const [slug, sprs] of [['s1-mach', 80], ['s2-eng', 85]]) {
    const s = readIf(R4A_SUMMARY(slug));
    const b = readIf(path.join(HERE, '..', 'expected-outputs', slug, 'summary.json'));
    assert.ok(b, `no expected-outputs/${slug}/summary.json`);
    const r = judgeV108({ statusBy: s.status_by_control, baselineBy: b.status_by_control, baselineName: 'baseline', weightOf: (id) => w.get(id) ?? 0, evFiles: [V108_ESCROW_FILE], storeDecided: ['PS.L2-3.9.1', 'PS.L2-3.9.2'] });
    assert.equal(r.pass, true, `${slug}: ${r.detail}`);
    assert.match(r.detail, new RegExp(`SPRS ${sprs} \\(baseline ${sprs + 2}\\)`), slug);
  }
});

// ---------- V104 / V107 (d) ----------
const S3_PUSHED = path.join(WS, 'out', 'runs', 'run-20261031T174451Z', 'evidence', 'raw', '01-plans', 'pushed');
const s3Im = fs.existsSync(S3_PUSHED) ? fs.readdirSync(S3_PUSHED).find((x) => x.startsWith('infrastructure-manifest-s3-def-')) ?? null : null;
test('V107 over the saved W9-R4a S3 Infrastructure Manifest (when present): S3 pushes a defaults-off m365_azure manifest', { skip: s3Im ? false : `absent: ${S3_PUSHED}\infrastructure-manifest-s3-def-*.json` }, () => {
  const f = s3Im;
  const r = judgeV107({ slug: 's3-def', im: readIf(path.join(S3_PUSHED, f)) });
  assert.equal(r.pass, true, r.detail);
});

// ---------- V109 (e) ----------
test('V109: the unit gate must be newer than every repo\'s newest commit; a stale, missing or unread gate fails', () => {
  const t = Date.parse('2026-10-31T18:00:00Z');
  const repos = [{ repo: 'ces', commitMs: t - 60000 }, { repo: 'pkg/ces-muster-run', commitMs: t - 1000 }];
  const ok = judgeV109({ gateMs: t, repos });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /newer than the newest commit in all 2 repos \(ces, pkg\/ces-muster-run\)/);
  const stale = judgeV109({ gateMs: t - 5000, repos });
  assert.equal(stale.pass, false);
  assert.match(stale.detail, /older than the newest commit in pkg\/ces-muster-run \(2026-10-31T17:59:59\.000Z\): re-run scripts\/run-tests\.ps1/);
  assert.match(judgeV109({ gateMs: null, repos }).detail, /no out\/unit-gate\.json/);
  assert.match(judgeV109({ gateMs: t, repos: [] }).detail, /no workspace repo found/);
  assert.match(judgeV109({ gateMs: t, repos: [{ repo: 'ces', commitMs: null }] }).detail, /newest commit not read in ces/);
});

test('verify.mjs wires V109 once, before V11; V11 / V21 / V22 read its result; V36 uses projectionSentences; V65 uses judgeV65Drop; V108 passes storeDecided (LF only)', () => {
  const v = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.equal((v.match(/check\('V109'/g) ?? []).length, 1);
  assert.ok(v.indexOf("check('V109'") < v.indexOf("check('V11'"));
  assert.equal((v.match(/unitGateFresh\.pass/g) ?? []).length, 4);
  assert.match(v, /projectionSentences\(docxText, projections\[0\]\)/);
  assert.match(v, /w4mod\.judgeV65Drop\(\{/);
  assert.match(v, /storeDecided: \(storedSnapshot\?\.controls \?\? \[\]\)\.filter\(\(c\) => gapmod\.V80_STORE_DECIDED\.test/);
  assert.equal((v.match(/\r/g) ?? []).length, 0);
});
