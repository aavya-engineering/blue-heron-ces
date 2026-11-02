// Gap closure NS-3 tests (GAP-CLOSURE-PLAN.md §4 G-NS; §5 V81): node --test scripts/gap-flow6-ns3.test.mjs
// The V81 judge over synthetic fixtures; the NS-3 mapping over the package's own customers/<slug> files (read only).
// Nothing in the workspace is written. ROLE-1 (founder ruling 2026-10-30): the FLOW-6 / V86 tests moved out; V86 is
// retired and V100 replaces it (scripts/gap-role1.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV81, V81_DEFERRED, V81_INTERVIEW_EXPECTED, v81OrgReadiness, V81_ORG_SOURCE, V81_AT_NOT_DECIDED } from './verify-gap.mjs';
import { eoRecordPosts, eoRecordExpectations, loadEoRecordPosts, EO_POSTS_SCHEMA, NS3_POLICY_NOTE } from './build-customer-records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');

// ---------- NS-3 mapping ----------
const customer = { slug: 'sx', accounts: [
  { person_id: 'p1', display_name: 'Ann One', upn: 'ann@sx.example', job_title: 'Engineer', object_id: 'oid-1' },
  { person_id: 'p2', display_name: 'Bob Two', upn: 'bob@sx.example', job_title: 'Machinist' },
  { person_id: 'p3', display_name: 'Cy Three', upn: 'cy@sx.example', job_title: 'Contractor' },
] };
const files = {
  'personnel-screening.json': { rows: [
    { date: '2025-01-02', person_id: 'p1', result: 'cleared' }, { date: '2025-01-03', person_id: 'p2', result: 'cleared' }, { date: '2025-01-04', person_id: 'p3', result: 'cleared' },
  ] },
  'personnel-lifecycle.json': { rows: [
    { date: '2026-08-01', person_id: 'p2', event: 'termination', step: 'exit interview', status: 'done', performed_by: 'HR Lead' },
    { date: '2026-08-01', person_id: 'p2', event: 'termination', step: 'account disabled', status: 'done', performed_by: 'Sys Admin' },
    { date: '2026-09-01', person_id: 'p3', event: 'termination', step: 'account disabled', status: 'open', performed_by: 'Sys Admin' },
    { date: '2026-09-02', person_id: 'p4', event: 'onboarding', step: 'badge', status: 'done', performed_by: 'HR Lead' },
  ] },
  'training-awareness.json': { rows: [
    { date: '2026-07-01', person_id: 'p1', course: 'SX Awareness', status: 'completed' }, { date: '2026-07-02', person_id: 'p9', course: 'SX Awareness', status: 'completed' },
    { date: '2026-07-03', person_id: 'p2', course: 'SX Awareness', status: 'assigned' },
  ] },
  'risk-assessment.json': { rows: [
    { date: '2026-08-15', risk_id: 'R-01', threat: 'credential phishing', likelihood: 'likely', impact: 'high', rating: 'high', treatment: 'MFA', owner: 'ISSO' },
    { date: '2026-08-15', risk_id: 'R-02', threat: 'delayed account disablement for leavers', likelihood: 'possible', impact: 'medium', rating: 'medium' },
  ] },
};

test('NS-3 eoRecordPosts: personnel from screening and lifecycle with UPN e-mail, completed training only, risks as EO entries, leavers', () => {
  const p = eoRecordPosts(customer, files);
  assert.equal(p.schema, EO_POSTS_SCHEMA);
  assert.deepEqual(p.personnel.map((x) => x.body.email), ['ann@sx.example', 'bob@sx.example', 'cy@sx.example']);
  assert.deepEqual(p.personnel[0].body, { displayName: 'Ann One', email: 'ann@sx.example', role: 'Engineer', entraObjectId: 'oid-1' });
  assert.deepEqual(p.personnel[0].screening, { screeningState: 'cleared', lastScreenedDate: '2025-01-02' });
  assert.deepEqual(p.unresolved.sort(), ['p4', 'training-awareness.json:p9']);
  assert.deepEqual(p.training.map((t) => [t.email, t.body.courseId, t.body.completedDate]), [['ann@sx.example', 'SX Awareness', '2026-07-01']]);
  const [r1, r2] = p.risks.map((r) => r.body);
  assert.equal(r1.threatSource, 'adversarial');
  assert.equal(r2.threatSource, 'non_adversarial');
  assert.deepEqual([r1.likelihood, r1.impact, r1.compositeRisk, r2.likelihood, r2.impact], ['high', 'high', 'high', 'moderate', 'moderate']);
  assert.equal(r1.nextReviewDue, '2027-08-15');
  assert.deepEqual(r1.source, { type: 'manual', description: 'customer risk register (risk-assessment.json) R-01' });
  assert.equal(r1.sourceReference, 'R-01');
  assert.deepEqual(p.offboarding.map((o) => [o.email, o.complete, o.attestor]), [['bob@sx.example', true, 'Sys Admin'], ['cy@sx.example', false, 'Sys Admin']]);
  assert.deepEqual(p.policies, []);
  assert.equal(p.policy_note, NS3_POLICY_NOTE);
  const e = eoRecordExpectations(p);
  assert.deepEqual(e.personnel.map((x) => [x.email, x.screeningState, x.overlay]), [['ann@sx.example', 'cleared', false], ['bob@sx.example', 'offboarded', true], ['cy@sx.example', 'offboarding-in-progress', false]]);
  assert.equal(eoRecordPosts(customer, {}), null);
  assert.equal(eoRecordExpectations(null), null);
});

test('NS-3 over the package customers: S1 and S2 map every screening person and completion; S3 and muster-partial have none', () => {
  const s1 = loadEoRecordPosts(PKG, 's1-mach');
  const s2 = loadEoRecordPosts(PKG, 's2-eng');
  for (const [slug, p] of [['s1-mach', s1], ['s2-eng', s2]]) {
    assert.ok(p, slug);
    assert.deepEqual(p.unresolved, [], slug);
    const screening = JSON.parse(fs.readFileSync(path.join(PKG, 'customers', slug, 'records', 'personnel-screening.json'), 'utf8')).rows;
    assert.equal(p.personnel.length, new Set(screening.map((r) => r.person_id)).size, slug);
    assert.ok(p.risks.length > 0 && p.training.length > 0 && p.offboarding.length > 0, slug);
    for (const r of p.risks) for (const k of ['likelihood', 'impact', 'compositeRisk']) assert.ok(r.body[k], `${slug} ${r.risk_id} ${k}`);
  }
  assert.deepEqual(s1.offboarding.map((o) => [o.person_id, o.complete]), [['s1p-040', true], ['s1p-007', false]]);
  assert.equal(loadEoRecordPosts(PKG, 's3-def'), null);
  assert.equal(loadEoRecordPosts(PKG, 'muster-partial'), null);
});

// ---------- V81 ----------
const expected = eoRecordExpectations(eoRecordPosts(customer, files));
const store = (over = {}) => ({
  schema: 'ces-tester/eo-records@1', taken: '2026-10-30T12:00:00.000Z', tenant_slug: 'sx', posted: {}, errors: [],
  policies: { posted: 0, note: NS3_POLICY_NOTE }, unresolved: [],
  stores: {
    personnel: [
      { id: 'a', email: 'ann@sx.example', screeningState: 'cleared', artifactTypes: [] },
      { id: 'b', email: 'bob@sx.example', screeningState: 'offboarded', artifactTypes: ['offboarding-procedural-overlay'] },
      { id: 'c', email: 'cy@sx.example', screeningState: 'offboarding-in-progress', artifactTypes: [] },
    ],
    training: { 'ann@sx.example': [{ courseId: 'SX Awareness', completedDate: '2026-07-01' }] },
    risks: [{ id: 'r1', sourceReference: 'R-01', threatEvent: 'credential phishing' }, { id: 'r2', sourceReference: 'R-02', threatEvent: 'delayed account disablement for leavers' }],
  },
  ...over,
});

// LOG-GC-PKG-C1: the interview record (ces-tester eo-interviews@1) and E8's SSP rows the V81 clauses read.
const interviews = (over = {}) => ({
  schema: 'ces-tester/eo-interviews@1', taken: '2026-10-31T12:00:00.000Z', tenant: 'sx', answers_file: 'customers/sx/interview-answers.json',
  built: 3, skipped_facts: 0, interviewer: { subjectId: 'mx-operator', role: 'bhd_operator' }, http_status: 201, stored: 3, skipped: 0, listed: 3, ...over,
});
// store(): 3 people, 1 offboarded -> 2 active (ann cleared, cy offboarding-in-progress) -> "1/2 cleared".
const sspRow = (id, extra) => ({ control_id: id, implementationNarrative: `Narrative for ${id}.\n\n${extra}` });
const ssp = (psLine = 'Personnel Screening Status: 1/2 cleared, 0 unscreened. Screening evidence artifacts: 1 files on record.', atLine = 'Training compliance tracked via Evidence Ops Personnel Card. Current status: 0/2 personnel compliant. See Appendix G for training matrix.') => ({
  controlImplementations: [
    sspRow('AT.L2-3.2.1', atLine), sspRow('AT.L2-3.2.2', atLine), sspRow('AT.L2-3.2.3', atLine),
    sspRow('PS.L2-3.9.1', psLine), sspRow('PS.L2-3.9.2', psLine), sspRow('AC.L1-3.1.1', ''),
  ],
});

test('V81 passes when EO stores hold every customer-file row, EO holds the interview records and the SSP PS / AT narratives cite the stores', () => {
  const r = judgeV81({ slug: 'sx', expected, record: store(), harness: 'tester', interviews: interviews(), ssp: ssp() });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /3 personnel .* 1 training completion\(s\), 2 risk entries/);
  assert.match(r.detail, /interviews: 3 built \(want not pinned\), EO stored 3, skipped 0 \(already held\), lists 3/);
  assert.match(r.detail, /SSP citations: 2 PS narrative\(s\) cite "Personnel Screening Status: 1\/2 cleared" \(the personnel store\); AT compliant counts AT.L2-3.2.1 0\/2, AT.L2-3.2.2 0\/2, AT.L2-3.2.3 0\/2/);
  assert.ok(r.detail.includes(V81_DEFERRED));
  assert.ok(r.detail.includes('policies 0 posted'));
});

test('V81 (D-7): "not applicable" stores with no records, FAILS under tester without the record (posts on by default), "not run" under mx, and fails on gaps', () => {
  const na = judgeV81({ slug: 's3-def', expected: null, record: null, harness: 'tester', interviews: interviews({ tenant: 's3-def', built: 105, stored: 0, skipped: 105, listed: 105 }) });
  assert.equal(na.pass, true, na.detail);
  assert.match(na.detail, /^stores: not applicable/);
  assert.match(na.detail, /SSP citations: not applicable/);
  const off = judgeV81({ slug: 'sx', expected, record: null, harness: 'tester', interviews: interviews(), ssp: ssp() });
  assert.equal(off.pass, false);
  assert.match(off.detail, /stores: no out\/eo-records\.json: the NS-3 posts did not run \(on by default since D-7; CES_NS3_EO_RECORDS=0 set/);
  const mx = judgeV81({ slug: 'sx', expected, record: null, harness: 'mx' });
  assert.equal(mx.pass, true, mx.detail);
  assert.match(mx.detail, /stores: not run \(-Harness mx/);
  assert.match(mx.detail, /interviews: not run \(-Harness mx/);
  assert.match(mx.detail, /SSP citations: not run \(-Harness mx\)/);
  const s = store();
  s.stores.personnel[1] = { id: 'b', email: 'bob@sx.example', screeningState: 'cleared', artifactTypes: [] };
  s.stores.personnel.push({ id: 'd', email: 'ANN@sx.example', screeningState: 'cleared', artifactTypes: [] });
  s.stores.training = {};
  s.stores.risks = s.stores.risks.slice(0, 1);
  s.errors = [{ what: 'POST risk R-02', status: 500 }];
  const bad = judgeV81({ slug: 'sx', expected, record: s, harness: 'tester', interviews: interviews(), ssp: ssp() });
  assert.equal(bad.pass, false);
  for (const re of [/1 post error/, /1 duplicated person/, /bob@sx.example cleared \(want offboarded\)/, /no offboarding overlay/, /1 training completion\(s\) missing/, /1 risk entries missing: R-02/]) assert.match(bad.detail, re);
  assert.match(judgeV81({ slug: 'sx', expected, record: store(), stale: 'stale artefact from an earlier run: eo-records.json', harness: 'tester' }).detail, /stale/);
});

test('V81 interview clause (NS-2 / NS-4t): pinned counts per scenario, 201, listed >= built; mp passes with none built; failures named', () => {
  assert.deepEqual(V81_INTERVIEW_EXPECTED, { 's1-mach': 143, 's2-eng': 144, 's3-def': 105, 'muster-partial': 0 });
  const iv = (slug, over) => judgeV81({ slug, expected: null, harness: 'tester', interviews: interviews({ tenant: slug, ...over }) });
  assert.equal(iv('s1-mach', { built: 143, stored: 0, skipped: 143, listed: 143 }).pass, true, 'a rerun (all skipped) passes');
  assert.equal(iv('s2-eng', { built: 144, stored: 144, skipped: 0, listed: 150 }).pass, true);
  const mp = iv('muster-partial', { answers_file: null, built: 0, http_status: null, stored: null, skipped: null, listed: null, note: 'no customers/<slug>/interview-answers.json' });
  assert.equal(mp.pass, true, mp.detail);
  assert.match(mp.detail, /interviews: none built \(want 0\): no customers/);
  for (const [over, re] of [
    [{ built: 104, listed: 104 }, /built 104 interview record\(s\), want 105/],
    [{ built: 105, http_status: 400, listed: 0 }, /POST \/api\/interviews HTTP 400/],
    [{ built: 105, listed: 100 }, /EO lists 100 < built 105/],
    [{ built: 105, listed: null }, /GET \/api\/interviews gave no list/],
    [{ built: 105, listed: 105, tenant: 's1-mach' }, /tenant s1-mach != s3-def/],
  ]) {
    const r = judgeV81({ slug: 's3-def', expected: null, harness: 'tester', interviews: interviews({ tenant: 's3-def', ...over }) });
    assert.equal(r.pass, false, JSON.stringify(over));
    assert.match(r.detail, re);
  }
  const none = judgeV81({ slug: 's3-def', expected: null, harness: 'tester', interviews: null });
  assert.equal(none.pass, false);
  assert.match(none.detail, /interviews: no out\/eo-interviews\.json/);
  const stale = judgeV81({ slug: 's3-def', expected: null, harness: 'tester', interviews: interviews({ tenant: 's3-def', built: 105, listed: 105 }), interviewsStale: 'stale artefact from an earlier run: eo-interviews.json' });
  assert.equal(stale.pass, false);
  assert.match(stale.detail, /interviews: stale artefact/);
});

test('V81 SSP citation clause: PS narratives must carry the store\'s cleared/active line, AT narratives the store\'s compliant line', () => {
  const base = { slug: 'sx', expected, record: store(), harness: 'tester', interviews: interviews() };
  const wrongPs = judgeV81({ ...base, ssp: ssp('Personnel Screening Status: 2/3 cleared, 0 unscreened.') });
  assert.equal(wrongPs.pass, false);
  assert.match(wrongPs.detail, /PS.L2-3.9.1, PS.L2-3.9.2 do\(es\) not cite the personnel store \("Personnel Screening Status: 1\/2 cleared"\)/);
  const noAt = judgeV81({ ...base, ssp: ssp(undefined, 'Training compliance tracked via Evidence Ops Personnel Card. See Appendix G (Training Matrix) for detailed completion records.') });
  assert.equal(noAt.pass, false, 'the catalog-only sentence (already in the W9-R3b baseline) is not a store citation');
  assert.match(noAt.detail, /AT.L2-3.2.1, AT.L2-3.2.2, AT.L2-3.2.3 do\(es\) not cite the training store/);
  const noSsp = judgeV81({ ...base, ssp: null });
  assert.equal(noSsp.pass, false);
  assert.match(noSsp.detail, /SSP citations: no out\/ssp\.json/);
  const noRows = judgeV81({ ...base, ssp: { controlImplementations: [] } });
  assert.equal(noRows.pass, false);
  assert.match(noRows.detail, /has 0 PS and 0 AT control/);
});

test('V81 SSP citation clause against the W9-R3b proof SSPs (posts were off): S1 / S2 would fail, S3 / mp are not applicable', () => {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(PKG, 'expected-outputs', p), 'utf8').replace(/^﻿/, ''));
  for (const [slug, dir] of [['s1-mach', 's1-mach/proof-runs/gc-w9r3b-s1'], ['s2-eng', 's2-eng/proof-runs/gc-w9r3b-s2']]) {
    const exp = eoRecordExpectations(loadEoRecordPosts(PKG, slug));
    const rec = { schema: 'ces-tester/eo-records@1', tenant_slug: slug, errors: [], policies: { posted: 0 }, stores: {
      personnel: exp.personnel.map((p) => ({ email: p.email, screeningState: p.screeningState, artifactTypes: p.overlay ? ['offboarding-procedural-overlay'] : [] })),
      training: Object.fromEntries(exp.personnel.map((p) => [p.email, exp.training.filter((t) => t.email === p.email).map((t) => ({ courseId: t.courseId, completedDate: t.completedDate }))])),
      risks: exp.risks,
    } };
    const r = judgeV81({ slug, expected: exp, record: rec, harness: 'tester', interviews: interviews({ tenant: slug, built: V81_INTERVIEW_EXPECTED[slug], listed: V81_INTERVIEW_EXPECTED[slug] }), ssp: read(`${dir}/ssp.json`) });
    assert.equal(r.pass, false, `${slug}: the baseline SSP must not already satisfy the citation clause`);
    assert.match(r.detail, /stores: EO stores match/);
    assert.match(r.detail, /do\(es\) not cite the personnel store/);
  }
  for (const [slug, dir] of [['s3-def', 's3-def/proof-runs/gc-w9r3b-s3'], ['muster-partial', 'proof-runs/gc-w9r3b-mp']]) {
    const r = judgeV81({ slug, expected: eoRecordExpectations(loadEoRecordPosts(PKG, slug)), record: null, harness: 'tester', interviews: interviews({ tenant: slug, built: V81_INTERVIEW_EXPECTED[slug], listed: V81_INTERVIEW_EXPECTED[slug] }), ssp: read(`${dir}/ssp.json`) });
    assert.equal(r.pass, true, r.detail);
  }
});

// PKG-2 (NS-3b, D-2): EO's readiness from the organisation's uploaded screening and lifecycle records decides PS.L2-3.9.1.
const orgRows = (slug) => {
  const dir = path.join(PKG, 'customers', slug, 'records');
  const rows = { screening: [], lifecycle: [] };
  for (const i of JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8')).items) {
    const key = i.record_kind === 'personnel_screening' ? 'screening' : i.record_kind === 'personnel_lifecycle' ? 'lifecycle' : null;
    if (key) rows[key].push(...JSON.parse(fs.readFileSync(path.join(dir, i.file), 'utf8')).rows);
  }
  return rows;
};

test('V81 (PKG-2) v81OrgReadiness: owner rows count once, latest screening row wins, a leaver with every account-disable step done is offboarded', () => {
  assert.equal(v81OrgReadiness({ screening: [], lifecycle: [] }), null);
  const r = v81OrgReadiness({
    screening: [
      { person_id: 'p1', date: '2025-01-01', result: 'cleared' },
      { person_id: 'p2', date: '2025-01-01', result: 'cleared' }, { person_id: 'p2', date: '2026-01-01', result: 'expired' },
      { person_id: 'adm-1', owner_person_id: 'p1', date: '2026-02-01', result: 'cleared' },
      { person_id: 'p3', date: '2025-01-01', result: 'cleared' }, { person_id: 'p4', date: '2025-01-01', result: 'cleared' },
    ],
    lifecycle: [
      { person_id: 'p3', event: 'termination', step: 'account disabled (leaver workflow run)', status: 'done' },
      { person_id: 'p4', event: 'termination', step: 'account disabled (leaver workflow run)', status: 'open' },
      { person_id: 'p1', event: 'onboarding', step: 'account disabled', status: 'done' },
    ],
  });
  assert.deepEqual(r, { cleared: 2, total: 3, unscreened: 1, offboarded: 1 });
});

test('V81 (PKG-2) over the package customers: S1 44/44 and S2 29/29 cleared from the organisation records (LOG-GC-NS-3b.md); S3 / mp have none', () => {
  assert.deepEqual(v81OrgReadiness(orgRows('s1-mach')), { cleared: 44, total: 44, unscreened: 0, offboarded: 1 });
  assert.deepEqual(v81OrgReadiness(orgRows('s2-eng')), { cleared: 29, total: 29, unscreened: 0, offboarded: 0 });
  for (const slug of ['s3-def', 'muster-partial']) assert.equal(fs.existsSync(path.join(PKG, 'customers', slug, 'records', 'catalog.json')), false, slug);
});

test('V81 (PKG-2) citations: PS lines cite the organisation-records readiness when given; AT.L2-3.2.2 may say the store does not decide it', () => {
  const org = { cleared: 2, total: 2, unscreened: 0, offboarded: 1 };
  const orgLine = `Personnel Screening Status: 2/2 cleared, 0 unscreened ${V81_ORG_SOURCE}. Screening evidence artifacts: 0 files on record.`;
  const atLine = 'Training compliance tracked via Evidence Ops Personnel Card. Current status: 2/2 personnel compliant. See Appendix G for training matrix.';
  const notDecided = `Training compliance tracked via Evidence Ops Personnel Card. No course in the training catalog that satisfies AT.L2-3.2.2 is required of every active person (a role-scoped course takes its population from the organisation's own record), ${V81_AT_NOT_DECIDED}. See Appendix G for training matrix.`;
  const sspOf = (ps, at22) => ({ controlImplementations: [
    sspRow('AT.L2-3.2.1', atLine), sspRow('AT.L2-3.2.2', at22), sspRow('AT.L2-3.2.3', atLine),
    sspRow('PS.L2-3.9.1', ps), sspRow('PS.L2-3.9.2', `${ps} Termination: termination from the organisation's records: ...`),
  ] });
  const base = { slug: 'sx', expected, record: store(), harness: 'tester', interviews: interviews(), orgReadiness: org };
  const ok = judgeV81({ ...base, ssp: sspOf(orgLine, notDecided) });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /2 PS narrative\(s\) cite "Personnel Screening Status: 2\/2 cleared, 0 unscreened \(from the organisation's screening records\)" \(the readiness from the uploaded organisation records\)/);
  assert.match(ok.detail, /AT compliant counts AT.L2-3.2.1 2\/2, AT.L2-3.2.3 2\/2; AT.L2-3.2.2 not decided by the training store \(role-scoped course only, NS-3b\)/);
  // The store's own counts (1/2) no longer satisfy the clause once the organisation records decide.
  const storeLine = judgeV81({ ...base, ssp: sspOf('Personnel Screening Status: 1/2 cleared, 1 unscreened.', atLine) });
  assert.equal(storeLine.pass, false);
  assert.match(storeLine.detail, /PS.L2-3.9.1, PS.L2-3.9.2 do\(es\) not cite the readiness from the uploaded organisation records/);
  // "Does not decide" is accepted for AT.L2-3.2.2 only; on AT.L2-3.2.1 it fails, and so does the higher-precedence line.
  const at21 = sspOf(orgLine, atLine);
  at21.controlImplementations[0] = sspRow('AT.L2-3.2.1', notDecided.replace('AT.L2-3.2.2', 'AT.L2-3.2.1'));
  assert.match(judgeV81({ ...base, ssp: at21 }).detail, /AT.L2-3.2.1 do\(es\) not cite the training store/);
  const higher = judgeV81({ ...base, ssp: sspOf(orgLine, 'The training store does not decide the status shown for AT.L2-3.2.2 (a higher-precedence source decides it).') });
  assert.equal(higher.pass, false);
  assert.match(higher.detail, /AT.L2-3.2.2 do\(es\) not cite the training store/);
});

test('verify.mjs passes the interview record and the SSP to V81 (LF only)', () => {
  const v = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.equal((v.match(/check\('V81'/g) ?? []).length, 1);
  assert.match(v, /const eoInterviewsFile = path\.join\(out, 'eo-interviews\.json'\);/);
  assert.match(v, /gapmod\.judgeV81\(\{ slug, expected: v81Expected, record: exists\(eoRecordsFile\) \? readJson\(eoRecordsFile\) : null, stale: staleOf\(eoRecordsFile\), harness, interviews: exists\(eoInterviewsFile\) \? readJson\(eoInterviewsFile\) : null, interviewsStale: staleOf\(eoInterviewsFile\), ssp, orgReadiness: v81OrgReadiness \}\)/);
  assert.match(v, /record_kind === 'personnel_screening' \? 'screening' : i\.record_kind === 'personnel_lifecycle' \? 'lifecycle'/);
  assert.ok(v.indexOf('const ssp = ') < v.indexOf("check('V81'"));
  assert.equal((v.match(/\r/g) ?? []).length, 0);
});
