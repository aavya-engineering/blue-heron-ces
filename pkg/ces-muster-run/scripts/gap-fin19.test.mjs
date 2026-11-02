// FIN-19 tests (finishing plan PH-1 harness; FINISH-PLAN.md §1.3 V110-V114, §3.2 FIN-19): node --test scripts/gap-fin19.test.mjs
// The new judges (V76, V78 clauses, V85 tenant-id clause, V87, V110-V114) and the FIN-12 supersede filter in V80, over
// synthetic records in the shapes ces-tester's fin19-steps.ts writes and EO / AO store. Two tests also read a saved
// R-F0 SSP (out/runs/run-20261031T194523Z, read only) and skip when it is absent. Nothing in the workspace is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIN19_NON_STACK, liveReviewRows, judgeV80, judgeV76, judgeV78Clauses, judgeV85Tenant, judgeV87, judgeV110, judgeV111,
  v111AffirmativeSentences, judgeV112, judgeV113, judgeV114, v88ComparePlans, judgeV88F, judgeV104Lines,
} from './verify-gap.mjs';
import { compileBody } from './plan-compile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RF0_SSP = 'C:/ces-nb/out/runs/run-20261031T194523Z/evidence/raw/02-ssp/ssp.json';

// ---------- the non-stack set ----------
test('FIN19_NON_STACK is the 28-control set of AUDIT-NONSTACK.md §1, no duplicates', () => {
  assert.equal(FIN19_NON_STACK.length, 28);
  assert.equal(new Set(FIN19_NON_STACK).size, 28);
  for (const c of ['PE.L2-3.10.2', 'PS.L2-3.9.2', 'AT.L2-3.2.1', 'CM.L2-3.4.4', 'CA.L2-3.12.4']) assert.ok(FIN19_NON_STACK.includes(c), c);
});

// ---------- FIN-12 supersede: liveReviewRows and V80 ----------
const H = 'c'.repeat(64);
const NS = 'AT.L2-3.2.3';
const REVIEWER = 'reviewer.two@t.example.test';
const UPLOADER = { subjectId: 'u1', upn: 'uploader.one@t.example.test' };
const objectivesRef = { objectives: [{ controlId: NS, objectiveId: `${NS}[a]` }, { controlId: NS, objectiveId: `${NS}[b]` }, { controlId: 'AC.L1-3.1.2', objectiveId: 'AC.L1-3.1.2[b]' }, { controlId: 'PE.L2-3.10.2', objectiveId: 'PE.L2-3.10.2[b]' }] };
const rv = (id, objectiveId, verdict, supersedes) => ({ reviewId: id, controlId: NS, objectiveId, artifactHash: H, verdict, reviewer: { upn: REVIEWER, tokenId: 'jti-1' }, ...(supersedes ? { supersedes } : {}) });

test('liveReviewRows drops superseded rows, keeps legacy rows without supersedes, ignores a row naming itself', () => {
  const rows = [rv('r1', `${NS}[a]`, 'not_met'), rv('r2', `${NS}[a]`, 'met', ['r1']), rv('r3', `${NS}[b]`, 'met', ['r3'])];
  assert.deepEqual(liveReviewRows(rows).map((r) => r.reviewId), ['r2', 'r3']);
  assert.deepEqual(liveReviewRows(null), []);
});

test('V80 counts only live reviews: an old not_met superseded by a met no longer fails the credited control', () => {
  const snapshot = { controls: [{ control_id: NS, status: 'met', statusRationale: 'GD-b (document review) decides' }] };
  const base = { snapshot, mints: [{ mintId: 'jti-1', approver: { upn: REVIEWER } }], ecItems: [{ itemId: 'i1', controlIds: [NS], sha256: H, uploadedBy: UPLOADER }], objectivesRef };
  const reviews = [rv('r1', `${NS}[a]`, 'not_met'), rv('r2', `${NS}[a]`, 'met', ['r1']), rv('r3', `${NS}[b]`, 'met')];
  const r = judgeV80({ ...base, reviews });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /2 review\(s\) live \(\+1 superseded, FD-8\)/);
  // Without the supersede record the old not_met still counts and the credit is wrong.
  const old = judgeV80({ ...base, reviews: [rv('r1', `${NS}[a]`, 'not_met'), rv('r2', `${NS}[a]`, 'met'), rv('r3', `${NS}[b]`, 'met')] });
  assert.equal(old.pass, false);
  assert.match(old.detail, /met despite countable not_met review/);
});

// ---------- V76 ----------
const aoRegistry = [{ id: 'A-02', cmmcPractices: ['AC.L1-3.1.2'], evidence_objectives: ['AC.L1-3.1.2[b]'] }];
test('V76: registry, E7A rows and package rows each name a valid objective of the command\'s controls', () => {
  const ok = judgeV76({ aoRegistry, objectivesRef, e7aRows: [{ op: 'A-02', rowId: 'A-02:x', row: { evidenceObjectives: ['AC.L1-3.1.2[b]'] } }], pkgRows: [{ file: 'adminops/A-02-x.json', evidenceObjectives: ['AC.L1-3.1.2[b]'], controlIds: ['AC.L1-3.1.2'] }] });
  assert.equal(ok.pass, true, ok.detail);
  const noObj = judgeV76({ aoRegistry, objectivesRef, e7aRows: [{ op: 'A-02', rowId: 'A-02:x', row: {} }], pkgRows: [{ file: 'adminops/A-02-x.json', controlIds: ['AC.L1-3.1.2'] }] });
  assert.equal(noObj.pass, false);
  assert.match(noObj.detail, /\(b\) 1 of 1 E7A row\(s\): A-02 A-02:x: no evidenceObjectives/);
  assert.match(noObj.detail, /no evidenceObjectives: FIN-14/);
  const wrongCtl = judgeV76({ aoRegistry: [{ id: 'A-02', cmmcPractices: ['AC.L1-3.1.2'], evidence_objectives: [`${NS}[a]`] }], objectivesRef, e7aRows: [], pkgRows: null });
  assert.equal(wrongCtl.pass, false);
  assert.match(wrongCtl.detail, /not of AC\.L1-3\.1\.2/);
  assert.equal(judgeV76({ aoRegistry, objectivesRef, e7aRows: [], pkgRows: null }).pass, true, 'mp: no ops, no package row needed');
});

// ---------- V78 clauses ----------
test('V78 clauses: one snapshotId across cover, SSP, POA&M and E7B; age limit; both DOCX; not partial', () => {
  const t = '2026-10-31T19:51:00.000Z';
  const cover = { snapshotId: 's', generatedAt: t, allowPartial: false, partialFailures: [] };
  const files = ['ssp/system-security-plan.docx', 'poam/plan-of-action.docx', 'cover-sheet.json'];
  const ok = judgeV78Clauses({ cover, ssp: { snapshotId: 's', generatedAt: t }, poam: { snapshotId: 's', generatedAt: t }, e7bId: 's', pkgFiles: files });
  assert.equal(ok.pass, true, ok.detail);
  const bad = judgeV78Clauses({ cover: { ...cover, allowPartial: true }, ssp: { snapshotId: 'x', generatedAt: '2026-10-29T00:00:00Z' }, poam: { snapshotId: 's', generatedAt: t }, e7bId: 's', pkgFiles: files.slice(1) });
  assert.equal(bad.pass, false);
  for (const re of [/snapshotId differs: cover s, ssp x/, /older than 24 h/, /DOCX missing from the package: ssp\/system-security-plan\.docx/, /partial/]) assert.match(bad.detail, re);
  assert.match(judgeV78Clauses({}).detail, /no out\/eo-package\/<latest>\/cover-sheet\.json/);
});

// ---------- V85 tenant-id clause ----------
test('V85 tenant-id clause: red only when no row is under EO\'s tenant id while rows exist under others (R-F0 shape)', () => {
  assert.equal(judgeV85Tenant({ rows: [], otherTenantRows: 21004 }).pass, false);
  assert.equal(judgeV85Tenant({ rows: [{ id: 'a' }], otherTenantRows: 5 }).pass, true);
  assert.equal(judgeV85Tenant({ rows: null }).pass, true);
});

// ---------- V87 ----------
test('V87: the CLI package equals the API package minus run-variant values', () => {
  const api = [{ name: 'cover-sheet.json', kind: 'json', text: JSON.stringify({ packageId: '11111111-1111-4111-8111-111111111111', generatedAt: '2026-10-31T19:51:00.000Z', snapshotId: 's' }) }];
  const cli = [{ name: 'cover-sheet.json', kind: 'json', text: JSON.stringify({ packageId: '22222222-2222-4222-8222-222222222222', generatedAt: '2026-10-31T19:52:00.000Z', snapshotId: 's' }) }];
  const rec = { rc: 0, expanded: true };
  assert.equal(judgeV87({ record: rec, compare: v88ComparePlans(api, cli), apiFiles: 1, cliFiles: 1 }).pass, true);
  const diff = judgeV87({ record: rec, compare: v88ComparePlans(api, [{ ...cli[0], text: JSON.stringify({ snapshotId: 'other', packageId: 'x', generatedAt: 'y' }) }]) });
  assert.equal(diff.pass, false);
  assert.match(judgeV87({ record: { rc: 1, error: 'HTTP 409' } }).detail, /exited 1: HTTP 409/);
  assert.match(judgeV87({}).detail, /no out\/eo-package-cli\.json/);
});

// ---------- V110 ----------
test('V110: a gate-approved non-stack control met in the EU probe fails; uncredited passes; no approval proves nothing', () => {
  const snapshot = { controls: [{ control_id: 'PE.L1-3.10.1', status: 'met', statusRationale: 'GD-b (document review) decides' }] };
  const probe = (status, rationale, approved = ['PE.L1-3.10.1']) => ({ variant: 'legacy', assess_rc: 0, approved_non_stack: approved, gates: [{}], controls: [{ control_id: 'PE.L1-3.10.1', status, statusRationale: rationale, sources: [{ type: 'evidence_import', result: 'pending_review' }] }] });
  const ok = judgeV110({ snapshot, euExpected: true, euProbes: [probe('not_assessed', 'No source has an opinion')] });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /1 gate-approved non-stack control\(s\), none credited \(1 carry a pending_review source\)/);
  const bypass = judgeV110({ snapshot, euExpected: true, euProbes: [probe('met', 'Tier 3 (evidence import) decides')] });
  assert.equal(bypass.pass, false);
  assert.match(bypass.detail, /credited by the gate: PE\.L1-3\.10\.1/);
  assert.match(judgeV110({ snapshot, euExpected: true, euProbes: [probe('not_assessed', '', [])] }).detail, /approved no gate on a non-stack control/);
  assert.match(judgeV110({ snapshot, euExpected: true, euProbes: [] }).detail, /no out\/ui\/<variant>\/eo-eu-probe\.json/);
  assert.equal(judgeV110({ snapshot, euExpected: false }).pass, true, 'S2/S3/mp have no watched Stamper run');
  const twin = judgeV110({ snapshot: { controls: [{ control_id: 'PS.L2-3.9.1', status: 'met', statusRationale: 'Tier 3 (state-verified execution verdict) decides: evidence_import/imported: [manual-gate] manual-PS.L2-3.9.1' }] } }); // FIN-29: only a manual-gate decider counts (a Tier 3/4 stack proxy does not)
  assert.equal(twin.pass, false);
  assert.match(twin.detail, /\(a\) 1 non-stack control\(s\) met by a gate record/);
});

// ---------- V111 ----------
test('V111: affirmative sentences are found in a not_met narrative but not in negated or quoted policy text', () => {
  assert.equal(v111AffirmativeSentences('The organization ensures that individuals meet criteria.').length, 1);
  assert.equal(v111AffirmativeSentences('Required state: required; not yet shown to be in place.').length, 0);
  assert.equal(v111AffirmativeSentences('Gap stated.\n\nPolicy-based implementation: The organization ensures X.').length, 0);
  const ssp = {
    controlImplementations: [
      { control_id: 'PS.L2-3.9.2', status: 'not_met', implementationNarrative: 'The organization ensures that individuals accessing systems meet personnel security criteria.' },
      { control_id: 'AC.L1-3.1.1', status: 'met', implementationNarrative: 'is implemented', assessmentApproach: { objectives: [{ objectiveId: 'AC.L1-3.1.1[a]', evidence: [{ cesSource: 'tenant_signal', held: 'unknown' }] }] } },
      { control_id: 'PE.L1-3.10.1', status: 'met', assessmentFinding: 'met (review r, sha256 f47f9dfb2cd9)', assessmentApproach: { objectives: [{ objectiveId: 'PE.L1-3.10.1[a]', evidence: [{ cesSource: 'ec_upload', held: 'not_held' }] }] } },
    ],
  };
  const r = judgeV111({ ssp, docxText: 'AC.L1-3.1.1 Classification: Non-Technology Stack' });
  assert.equal(r.pass, false);
  for (const re of [/\(a\) 1 affirmative/, /\(b\) PS\.L2-3\.9\.2's narrative is not about terminations/, /\(c\) 1 approach row/, /\(d\) 1 control/, /\(e\) "Non-Technology Stack" on 1 control\(s\) outside the non-stack set: AC\.L1-3\.1\.1/]) assert.match(r.detail, re);
  assert.match(judgeV111({}).detail, /no out\/ssp\.json/);
});

test('V111 on the saved R-F0 S1 SSP (pre-FIN-11): red on PS.L2-3.9.2 and on the EC-count contradiction', { skip: !fs.existsSync(RF0_SSP) && `no ${RF0_SSP}` }, () => {
  const ssp = JSON.parse(fs.readFileSync(RF0_SSP, 'utf8'));
  const r = judgeV111({ ssp, docxText: '', interviewsHeld: true, adminOpsRan: true });
  assert.equal(r.pass, false);
  assert.match(r.detail, /\(b\) PS\.L2-3\.9\.2/);
  assert.match(r.detail, /\(d\) \d+ control\(s\) whose approach contradicts the finding on EC uploads: .*PE\.L1-3\.10\.1/);
});

// ---------- V112 ----------
const UPN = 'uploader.one@t.example.test';
const upload = { http_status: 201, sha256: 'a'.repeat(64), control_ids: ['PE.L2-3.10.2'], form_id: 'access_control_policy' };
const ecItem = { itemId: 'eci-1', controlIds: ['PE.L2-3.10.2'], sha256: 'a'.repeat(64), uploadedBy: { upn: UPN }, form_id: 'access_control_policy' };
const cliOk = { objective_id: 'PE.L2-3.10.2[b]', calls: [{ rc: 0, review_id: 'r1', supersedes: [] }, { rc: 0, review_id: 'r2', supersedes: ['r1'] }], list: { rc: 0, live: [{ review_id: 'r2', objective_id: 'PE.L2-3.10.2[b]' }], history: [{ review_id: 'r1', objective_id: 'PE.L2-3.10.2[b]', superseded_by: 'r2' }, { review_id: 'r2', objective_id: 'PE.L2-3.10.2[b]', superseded_by: null }] } };
const dbRows = [{ reviewId: 'r1', objectiveId: 'PE.L2-3.10.2[b]', reviewer: { upn: REVIEWER } }, { reviewId: 'r2', objectiveId: 'PE.L2-3.10.2[b]', supersedes: ['r1'], reviewer: { upn: REVIEWER } }];
test('V112: EO route upload with uploader and catalog id; eo review x2, the second supersedes and is the only live row', () => {
  const ok = judgeV112({ upload, ecItems: [ecItem], cli: cliOk, reviewsAll: dbRows, uploaderUpn: UPN, hasReviewer: true, wantFormId: 'access_control_policy' });
  assert.equal(ok.pass, true, ok.detail);
  const noUploader = judgeV112({ upload, ecItems: [{ ...ecItem, uploadedBy: null }], uploaderUpn: UPN, hasReviewer: false });
  assert.equal(noUploader.pass, false);
  assert.match(noUploader.detail, /records no uploader/);
  const noSupersede = judgeV112({ upload, ecItems: [ecItem], cli: { ...cliOk, calls: [cliOk.calls[0], { ...cliOk.calls[1], supersedes: [] }] }, reviewsAll: dbRows.map((r) => ({ ...r, supersedes: undefined })), uploaderUpn: UPN, hasReviewer: true });
  assert.equal(noSupersede.pass, false);
  assert.match(noSupersede.detail, /does not supersede the first/);
  assert.match(noSupersede.detail, /\(d\) ces\.db live rows/);
  assert.equal(judgeV112({ upload, ecItems: [ecItem], uploaderUpn: UPN, hasReviewer: false }).pass, true, 'mp: no reviewer');
  assert.match(judgeV112({}).detail, /no out\/ec-upload-eo-route\.json/);
});

// ---------- V113 ----------
const cost = (over = {}) => ({
  tenant_slug: 's1-mach',
  calls: [
    { call: 'dry_run', success: true, cost_outcome: 'notice', monthly_usd: 12.5, price_date: '2026-10-31', ack_hash: 'h', evidence_row_id: 'r0' },
    { call: 'apply_no_dp1', success: false, cost_outcome: 'refused', cost_reason: 'dp1_missing: ...', evidence_row_id: 'r1' },
    { call: 'apply_wrong_dp2', success: false, cost_outcome: 'refused', cost_reason: 'dp2_mismatch: ...', evidence_row_id: 'r2' },
    { call: 'apply_dp1_dp2', success: true, cost_outcome: 'enabled', evidence_row_id: 'r3' },
  ],
  ...over,
});
const rowOf = (id) => ({ evidence: { metadata: { costGate: id === 'r3' ? { dp1: { ackHash: 'h' }, dp2: { typed: 'E-01 12.50' } } : {} } } });
test('V113: price shown, refused without DP-1 and on a wrong DP-2, runs with both; every call evidenced', () => {
  assert.equal(judgeV113({ probeOp: 'E-01', record: cost(), rowOf }).pass, true);
  const bad = cost();
  bad.calls[3] = { ...bad.calls[3], success: false, cost_outcome: 'refused', cost_reason: 'cost_estimate_unavailable' };
  const r = judgeV113({ probeOp: 'E-01', record: bad, rowOf });
  assert.equal(r.pass, false);
  assert.match(r.detail, /apply_dp1_dp2: want ran, cost gate enabled/);
  const noPrice = judgeV113({ probeOp: 'E-01', record: cost({ calls: [{ call: 'dry_run', monthly_usd: null, cost_outcome: 'notice', evidence_row_id: 'r0' }] }), rowOf });
  assert.match(noPrice.detail, /the dry run showed no price/);
  assert.match(judgeV113({ probeOp: 'E-01', record: cost(), rowOf: () => null }).detail, /no adminops_evidence row for: dry_run/);
  assert.equal(judgeV113({ probeOp: null }).pass, true);
});

// ---------- V114 ----------
test('V114: Muster\'s own EO intake 201 with the push hashes, interviews delivered, mu = API compile, 409 and 404 probes', () => {
  const pushResponse = { pushed: ['manual-mission-plan-s-1.json'], eo_intake: { status: 'delivered', http: 201, receipt: { receipt_id: 'rc', items: [{ kind: 'mission_plan', file_name: 'manual-mission-plan-s-1.json', sha256: 'm' }] } } };
  const files = [{ name: 'a.json', kind: 'json', text: '{"x":1}' }];
  const good = { pushResponse, planFiles: { 'manual-mission-plan-s-1.json': { sha256: 'm' } }, compileRecord: { eo_interviews: { status: 'delivered', records: 3 } }, answersPresent: true, mu: { rc: 0, source: 'stdout' }, compare: v88ComparePlans(files, files), probes: { cross_file: { status: 409, code: 'PLAN_VALIDATION_BLOCKED' }, other_tenant: { status: 404 } } };
  const ok = judgeV114(good);
  assert.equal(ok.pass, true, ok.detail);
  const today = judgeV114({ ...good, pushResponse: { ...pushResponse, eo_intake: { status: 'not_configured' } }, compileRecord: {}, mu: { rc: 2, error: 'unknown command plan' }, probes: { cross_file: { status: 201 }, other_tenant: { status: 404 } } });
  assert.equal(today.pass, false);
  for (const re of [/\(a\) muster-api's EO intake call: not_configured/, /\(b\) the compile's interview-record send: not reported/, /\(c\) `mu plan compile` exited 2/, /\(d\) the cross-file push without an override got HTTP 201, want 409/]) assert.match(today.detail, re);
  const badHash = judgeV114({ ...good, planFiles: { 'manual-mission-plan-s-1.json': { sha256: 'other' } } });
  assert.match(badHash.detail, /receipt hash for the Mission Plan/);
});

test('plan-compile.mjs compileBody still builds the body E3 hands to `mu plan compile --file`', () => {
  assert.deepEqual(compileBody({ slug: 's', discoveryText: '{}', answersText: '[]' }), { tenant_slug: 's', max_reads: 2, discovery: '{}', interview_answers: '[]' });
});

// ---------- verify.mjs wiring (by text) ----------
test('verify.mjs wires V76, V87, V110-V114, the V78 clauses and the V85 tenant-id clause', () => {
  const v = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  for (const id of ['V76', 'V87', 'V110', 'V111', 'V112', 'V113', 'V114']) assert.match(v, new RegExp(`check\\('${id}'`), id);
  assert.match(v, /gapmod\.judgeV78Clauses\(/);
  assert.match(v, /gapmod\.judgeV85Tenant\(v85\)/);
  const g = fs.readFileSync(path.join(HERE, 'verify-gap.mjs'), 'utf8');
  assert.match(g, /const reviews = liveReviewRows\(reviewsAll\);/);
});

test('V76: a command with no evidence_objectives yet (MM re-aim, FIN-14b) is reported, not judged, with its rows', () => {
  const reg = [...aoRegistry, { id: 'A-09', cmmcPractices: ['AC.L1-3.1.2'], evidence_objectives: [] }];
  const r = judgeV76({ aoRegistry: reg, objectivesRef, e7aRows: [{ op: 'A-09', rowId: 'A-09:x', row: {} }], pkgRows: [{ file: 'adminops/A-09-t.json', commandId: 'A-09' }] });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /not judged: 1 command\(s\) with no evidence_objectives yet \(MM re-aims, FIN-14b\): A-09 \(1 E7A row\(s\) of them\)/);
});

// ---------- FIN-17 hand-offs: V88 (f), V104 lines, V114 eo_intake_check ----------
test('V88 (f): one secret_read per Stamper execute (E6, E8F) with max_reads 2, no value, then the probe read 404', () => {
  const ref = 'secretref:one-time:11111111-1111-4111-8111-111111111111';
  const line = (read) => ({ event: 'secret_read', ref, read, max_reads: 2 });
  assert.equal(judgeV88F({ calls: [{ event: 'eo_intake' }, line(1), line(2)], ref, e8fRan: true, probeStatus: 404 }).pass, true);
  const budget1 = judgeV88F({ calls: [{ ...line(1), max_reads: 1 }], ref, e8fRan: true, probeStatus: 404 });
  assert.equal(budget1.pass, false);
  assert.match(budget1.detail, /1 secret_read line\(s\) .*want 2/);
  assert.match(budget1.detail, /max_reads 1, want 2/);
  assert.match(judgeV88F({ calls: [line(1), line(2)], ref, e8fRan: true, probeStatus: 200 }).detail, /probe read after E8F got HTTP 200, want 404/);
  assert.match(judgeV88F({ calls: [{ ...line(1), value: 'x' }], ref, e8fRan: false }).detail, /carries a value/);
  assert.equal(judgeV88F({ calls: [line(1)], ref, e8fRan: false }).pass, true, '-SkipForcedRun: one read, no probe');
  assert.match(judgeV88F({ calls: null, ref }).detail, /no muster-eo-calls\.jsonl/);
});

test('V104 lines: MX_SUMMARY recurring_items, cost_notice_lines and the push COST_RECURRING line agree with the notice', () => {
  const mp = { recurring_cost_notice: { items: [{}, {}] } };
  const ok = judgeV104Lines({ mp, record: { summary: 'controls=110 recurring_items=2 recurring_est_month=$1-$2', cost_notice_lines: ['a', 'b'] }, pushResponse: { warnings: ['x', 'COST_RECURRING: 2 items, ~$1-$2/month'] } });
  assert.equal(ok.pass, true, ok.detail);
  const bad = judgeV104Lines({ mp, record: { summary: 'recurring_items=3' }, pushResponse: { warnings: [] } });
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /recurring_items=3, the notice lists 2/);
  assert.match(bad.detail, /no COST_RECURRING line/);
});

test('V114 (a) fails on muster-api\'s own eo_intake_check mismatch', () => {
  const pushResponse = { pushed: ['manual-mission-plan-s-1.json'], eo_intake: { status: 'delivered', http: 201, receipt: { items: [{ kind: 'mission_plan', file_name: 'manual-mission-plan-s-1.json', sha256: 'm' }] } }, eo_intake_check: { matched: [], mismatched: ['tenant-manifest-s-1.json'], missing: [] } };
  const r = judgeV114({ pushResponse, planFiles: { 'manual-mission-plan-s-1.json': { sha256: 'm' } } });
  assert.match(r.detail, /eo_intake_check: 1 mismatched, 0 missing \(tenant-manifest-s-1\.json\)/);
});
