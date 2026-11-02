// Synthetic-customer W4 tests: node --test scripts/w4-scorecard.test.mjs
// Self-contained: every fixture is written to a fresh temp folder (run layout + package layout); nothing under the
// workspace is read or written. One baseline fixture passes every S1 row; each test breaks one thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { loadInputs, computeScorecard, sspReviewPredicates, readZipEntry, policyCompleteness, controlOfQuestion, ODP_KEYS, NOT_SUPPLIED, creditedDocumentary, sprsAuthority } from './scorecard.mjs';
import { buildGaps, renderGapsMd, gapId, gateLabel } from './gaps.mjs';
import { registerW4Checks, delta } from './verify-w4.mjs';

const H = 'a'.repeat(64);
const LONG = 'The tenant enforces this requirement through Conditional Access and Intune compliance policies that the ISSO reviews monthly; the configuration is exported and hashed as Stamper evidence and read live by EvidenceOps at each assessment pass.';
const SLUG = 't1-test';

function zipStored(name, data) {
  const nameB = Buffer.from(name), crc = zlib.crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameB.length, 28);
  const body = Buffer.concat([local, nameB, data]);
  const cd = Buffer.concat([central, nameB]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, eocd]);
}
const docx = (lines) => zipStored('word/document.xml', Buffer.from(`<w:document><w:body>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`));

function baseline() {
  const ctl = (id, status, weight, extra = {}) => ({ control_id: id, family: id.slice(0, 2), status, weight, implementationNarrative: LONG, responsibleRole: 'ISSO', relatedPolicies: ['policy'], odpValues: [], evidenceDetails: status === 'not_assessed' ? [] : [{ sha256: H }], ...extra });
  const ssp = {
    sspId: 'ssp-1', generatedAt: '2026-10-28T00:00:00.000Z', tenantId: 'sim-tenant-t1',
    controlImplementations: [
      ctl('AC.L1-3.1.1', 'met', 5, { odpValues: [{ parameter: 'PI.ODP.001 account_lockout_threshold', value: '3', source: 'policy-inputs profile: supplied' }] }),
      ctl('AC.L1-3.1.2', 'met', 5),
      ctl('PE.L1-3.10.1', 'not_assessed', 5),
    ],
    authorizationBoundary: { zones: ['Microsoft 365 tenant'], zoneDetails: [{ name: 'Microsoft 365 tenant', description: 'tenant id sim-tenant-t1' }], boundaryFacts: [] },
    systemComponents: { sections: [{ name: 'compute', components: ['vm1 (vm)'] }] },
    poamSummary: { poamId: 'P1', items: [], blockers: [{ control_id: 'PE.L1-3.10.1' }], sprsScore: 105, projectedScoreAfterPoam: 105, ledgerReconciliation: { controls: [] } },
    inheritanceTable: { rows: [{ controlId: 'AC.L1-3.1.1', responsibility: 'Shared' }] },
    sharedResponsibilityMatrix: { controlDetails: [{ controlId: 'AC.L1-3.1.1', responsibility: 'Shared' }], shared: 1, inherited: 0 },
    cuiDataFlowRows: [{ direction: 'Ingress' }], interconnections: [{ name: 'pe' }],
    postureReconciliation: { rows: [{ id: 'eo-assessed', counts: { met: 2, partial: 0, notMet: 0, notAssessed: 1 } }, { id: 'ledger-rollup', counts: {} }] },
    revisionHistory: [{ version: 'Draft 1' }], countConflicts: [], systemDescription: 'A fictional test system.',
  };
  const policies = Object.fromEntries(Array.from({ length: 22 }, (_, i) => [`policy-${String(i).padStart(2, '0')}.md`, `# Policy ${i}\n\n| **Approved By** | Role Holder B |\n\nText.\n\n**Effective Date:** 2026-01-01\n**Policy Owner:** Role Holder A\n`]));
  const odps = Object.fromEntries(ODP_KEYS.map((k, i) => [k, String(i + 1)]));
  return {
    ssp, docxLines: ['AC.L1-3.1.1 — 3.1.1', '☒ Implemented', 'AC.L1-3.1.2 — 3.1.2', '☒ Implemented', 'PE.L1-3.10.1 — 3.10.1', '☒ Not Yet Assessed'],
    poam: { poamId: 'P1', items: [], eligibility: { blockers: [{ control_id: 'PE.L1-3.10.1' }] }, sprsScore: 105, summary: { projectedScoreAfterPoam: 105 } },
    ledger: { objectives: Array.from({ length: 10 }, (_, i) => ({ objectiveId: `AC.L1-3.1.1[${i}]`, controlId: 'AC.L1-3.1.1', statement: `objective ${i}`, rationale: 'read live: policy enforces MFA' })), deficiencies: [{ controlId: 'PE.L1-3.10.1' }] },
    assess: [{ type: 'assess_summary', sprs_score: 105 }],
    readiness: { facts: [
      { question_id: 'RR-ACT-AC_L1_3_1_1', question_text: 'Status of AC.L1-3.1.1?', answer: 'yes', provenance: 'auto_detected', confidence: 'high' },
      { question_id: 'RR-ACT-AC_L1_3_1_2', question_text: 'Status of AC.L1-3.1.2?', answer: 'no', provenance: 'auto_detected', confidence: 'high' },
      { question_id: 'S-28', question_text: 'Interview', answer: 'unsure', provenance: 'operator_interview', confidence: 'low' },
    ] },
    planTrace: { defaulted_inputs: ['TCP TCP.LIC.003: add-on SKUs (recommended)', 'CUI boundary CUI.CAT.001 (bank default)'] },
    policies, profile: { artifact: { odps } },
    answers: ODP_KEYS.map((k, i) => ({ question_id: `PI.ODP.${String(i + 1).padStart(3, '0')}`, question_text: k, answer: String(i + 1), provenance: 'operator_interview', source: `synthetic-interview:${SLUG}` })),
    im: { infrastructure: { compute: [{ name: 'vm1', resource_type: 'vm' }] } },
    index: { examineCoverage: [{ controlId: 'AC.L1-3.1.1', requirementId: '3.1.1', kindsPresent: ['ssp', 'configuration'], items: [
      { index: 1, text: 'Access control policy', category: 'documentary', kinds: [], status: 'not covered' },
      { index: 2, text: 'system security plan', category: 'ssp', kinds: ['ssp'], status: 'covered' },
      { index: 3, text: 'system configuration settings', category: 'configuration', kinds: ['configuration'], status: 'covered' },
    ] }], entries: [{ controlId: 'AC.L1-3.1.1', method: 'examine' }] },
    stamper: [{ file: 'ac/ac.l1-3.1.1.set.json', rec: { registryEntry: { entry_id: 'AC.L1-3.1.1.set' }, complianceVerdict: 'SAT', metadata: { controlIds: ['AC.L1-3.1.1'], postcheckMode: 'state' } } }],
    tasks: [],
    lexicon: ['not configured'],
    proofGaps: null,
  };
}

function materialise(f) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-'));
  const root = path.join(tmp, 'ws'), out = path.join(root, 'out'), pkg = path.join(tmp, 'pkg');
  const w = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
  w(path.join(out, 'ssp.json'), f.ssp);
  if (f.docxLines) w(path.join(out, 'ssp.docx'), docx(f.docxLines));
  w(path.join(out, 'poam.json'), f.poam);
  w(path.join(out, 'eo-ledger.json'), f.ledger);
  for (const n of ['eo-assess.json', 'eo-assess-2.json', 'eo-assess-3.json']) w(path.join(out, n), f.assess);
  w(path.join(out, 'plan', `readiness-result-${SLUG}.json`), f.readiness);
  if (f.planTrace) w(path.join(out, 'plan', 'plan-trace.json'), f.planTrace);
  for (const [n, t] of Object.entries(f.policies)) w(path.join(out, 'plan', 'policies', n), t);
  w(path.join(out, 'plan', 'policy-inputs-profile-x.json'), f.profile);
  w(path.join(out, 'runs', 'latest.json'), { runId: 'run-T1', evidence: 'run-T1/evidence' });
  const raw = path.join(out, 'runs', 'run-T1', 'evidence', 'raw');
  w(path.join(raw, 'manifest.json'), { runId: 'run-T1' });
  w(path.join(raw, '01-plans', 'pushed', 'infrastructure-manifest-x.json'), f.im);
  w(path.join(raw, '12-evidence-index', 'evidence-index.json'), f.index);
  for (const s of f.stamper) w(path.join(raw, '06-execution', 'evidence', s.file), s.rec);
  for (const t of f.tasks) w(path.join(raw, '06-execution', 'evidence-by-task', t.task, t.name), t.rec);
  w(path.join(pkg, 'scripts', 'negation-lexicon.json'), { phrases: f.lexicon });
  if (f.answers) w(path.join(pkg, 'customers', SLUG, 'interview-answers.json'), f.answers);
  if (f.registry) w(path.join(root, 'ces', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json'), { version: '1.0.0', entries: f.registry });
  if (f.thresholds) w(path.join(pkg, 'customers', f.thresholdsSlug ?? SLUG, 'thresholds.json'), f.thresholds);
  if (f.scorecardGate) w(path.join(root, 'ces', 'ces-tester', 'scenarios', 'muster', `${f.slug ?? SLUG}-e2e.json`), { scorecard_gate: true });
  if (f.deficiencies) w(path.join(pkg, 'customers', SLUG, 'deficiencies.json'), f.deficiencies);
  if (f.assess7b) w(path.join(out, 'eo-assess-7b.json'), f.assess7b);
  if (f.steps) w(path.join(out, 'steps.json'), f.steps);
  if (f.e7a) w(path.join(out, 'adminops-e7a.json'), f.e7a);
  if (f.proofGaps) w(path.join(pkg, 'expected-outputs', SLUG, 'proof-runs', 'nb-run1', `GAPS-${SLUG}.json`), f.proofGaps);
  return { root, out, pkg, slug: f.slug ?? SLUG };
}
const run = (f) => { const m = materialise(f); const inp = loadInputs({ root: m.root, slug: m.slug, runDir: m.out, pkgDir: m.pkg }); return { m, inp, sc: computeScorecard(inp, m.pkg) }; };
const rowOf = (sc, id) => sc.rows.find((r) => r.id === id);
const predicate = (sc, n) => [...rowOf(sc, 'SC-1').value.rows, ...rowOf(sc, 'SC-2').value.rows].find((p) => p.row === n);

test('baseline: every S1 row within threshold', () => {
  const { sc } = run(baseline());
  assert.deepEqual(sc.rows.filter((r) => r.status !== 'pass').map((r) => `${r.id} ${r.detail}`), []);
  assert.equal(sc.pass, true);
  assert.equal(rowOf(sc, 'SC-1').value.passed, 7);
  assert.equal(rowOf(sc, 'SC-2').value.of, 11);
  assert.equal(sc.generatedAt, '2026-10-28T00:00:00.000Z');
});

test('SC-1: a met narrative that hits the lexicon fails row 1; DOCX "Not Applicable" fails row 2; IM mismatch fails row 4; POA&M id mismatch fails row 5', () => {
  let f = baseline(); f.ssp.controlImplementations[0].implementationNarrative = `${LONG} MFA is not configured.`;
  let { sc } = run(f); assert.equal(predicate(sc, 1).pass, false); assert.equal(rowOf(sc, 'SC-1').status, 'fail');
  // The appended "Presence only:" disclosure is not the narrative (V30 rule).
  f = baseline(); f.ssp.controlImplementations[0].implementationNarrative = `${LONG}\n\nPresence only: the setting is not configured-tested.`;
  ({ sc } = run(f)); assert.equal(predicate(sc, 1).pass, true);
  f = baseline(); f.docxLines[5] = '☒ Not Applicable'; ({ sc } = run(f)); assert.equal(predicate(sc, 2).pass, false);
  f = baseline(); f.docxLines = null; ({ sc } = run(f)); assert.equal(predicate(sc, 2).pass, false); assert.match(predicate(sc, 2).detail, /DOCX/);
  f = baseline(); f.im.infrastructure.compute.push({ name: 'vm2', resource_type: 'vm' }); ({ sc } = run(f)); assert.equal(predicate(sc, 4).pass, false);
  f = baseline(); f.poam.poamId = 'P2'; ({ sc } = run(f)); assert.equal(predicate(sc, 5).pass, false);
  f = baseline(); f.ssp.authorizationBoundary.zones.push('cui_user_count'); ({ sc } = run(f)); assert.equal(predicate(sc, 3).pass, false);
  f = baseline(); f.ssp.sharedResponsibilityMatrix.shared = 0; ({ sc } = run(f)); assert.equal(predicate(sc, 6).pass, false);
  f = baseline(); f.ssp.controlImplementations[1].implementationNarrative = 'Audit Event Logging (AC.L1-3.1.2) — implemented and continuously verified'; ({ sc } = run(f)); assert.equal(predicate(sc, 7).pass, false);
});

test('SC-1 on S3 requires rows 1, 2 and 5 only', () => {
  const f = baseline(); f.slug = 's3-def'; f.ssp.controlImplementations[1].implementationNarrative = 'short';
  const m = materialise(f);
  const sc = computeScorecard(loadInputs({ root: m.root, slug: 's3-def', runDir: m.out, pkgDir: m.pkg }), m.pkg);
  assert.equal(predicate(sc, 7).pass, false);
  assert.equal(rowOf(sc, 'SC-1').status, 'pass');
  for (const id of ['SC-2', 'SC-3a', 'SC-5', 'SC-6', 'SC-8b']) assert.equal(rowOf(sc, id).status, 'exempt', id);
});

test('SC-2: rows 8-17 each fail on their own defect; row 18 fails when a row is not computed; 3 failures put SC-2 under 9/11', () => {
  const cases = [
    [8, (f) => { f.ledger.objectives.forEach((o) => { o.rationale = 'inherited from control assessment (met)'; }); }],
    [9, (f) => { f.ssp.controlImplementations[0].odpValues[0].source = 'policy-inputs profile: defaulted'; }],
    [10, (f) => { f.ssp.controlImplementations[0].responsibleRole = ''; }],
    [11, (f) => { f.ssp.controlImplementations.forEach((c) => { c.evidenceDetails = []; }); }],
    [12, (f) => { f.ssp.controlImplementations[2].relatedPolicies = []; }],
    [13, (f) => { f.ssp.interconnections = []; }],
    [14, (f) => { f.ssp.postureReconciliation.rows[0].counts.met = 1; }],
    [15, (f) => { f.poam.sprsScore = 100; f.ssp.poamSummary.sprsScore = 100; }],
    [16, (f) => { f.policies['policy-00.md'] = f.policies['policy-00.md'].replace('2026-01-01', '2027-04-18'); }],
    [17, (f) => { f.ssp.countConflicts = [{ quantity: 'users' }]; }],
    [18, (f) => { f.planTrace = null; }],
  ];
  for (const [n, mutate] of cases) {
    const f = baseline(); mutate(f);
    const { sc } = run(f);
    assert.equal(predicate(sc, n).pass, false, `row ${n}`);
    assert.equal(typeof predicate(sc, n).detail, 'string');
  }
  const f = baseline(); cases[0][1](f); cases[2][1](f); cases[5][1](f);
  const { sc } = run(f);
  assert.equal(rowOf(sc, 'SC-2').value.passed, 8); assert.equal(rowOf(sc, 'SC-2').status, 'fail');
});

test('SC-1/SC-2 with no SSP: every predicate fails with a reason (never "not computed")', () => {
  const preds = sspReviewPredicates({ ssp: null, policies: [], assess: [] });
  assert.equal(preds.length, 17);
  assert.ok(preds.every((p) => p.pass === false && p.detail === 'no SSP JSON'));
});

test('SC-3a: automatable items only (documentary and SSP/POA&M excluded); uncovered item fails 75 %', () => {
  let { sc } = run(baseline());
  assert.deepEqual(rowOf(sc, 'SC-3a').value, { covered: 1, of: 1, pct: 100 });
  const f = baseline(); f.index.examineCoverage[0].items[2].status = 'not covered';
  ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-3a').status, 'fail'); assert.equal(rowOf(sc, 'SC-3a').value.pct, 0);
});

test('SC-3b: every documentary item is a GAPS row (credited 0 until W5); an index with no coverage gives 0/0', () => {
  let { inp, sc } = run(baseline());
  assert.deepEqual(rowOf(sc, 'SC-3b').value, { listed: 1, credited: 0, of: 1 });
  assert.equal(buildGaps(inp, sc).rows.filter((r) => r.source === 'documentary').length, 1);
  const f = baseline(); f.index = {};
  ({ sc } = run(f)); assert.deepEqual(rowOf(sc, 'SC-3b').value, { listed: 0, credited: 0, of: 0 });
});

test('SC-3b / SC-3a (W5c1 b): documentary items the index credits to a hashed policy (creditedTo) are credited, not GAPS rows; SC-3a cannot move', () => {
  const f = baseline();
  const credit = { document: 'policies/access-control-policy.md', sha256: H };
  f.index.examineCoverage[0].items[0] = { ...f.index.examineCoverage[0].items[0], status: 'covered', creditedTo: credit };
  f.index.examineCoverage[0].items.push({ index: 4, text: 'procedures addressing account management', category: 'documentary', kinds: [], status: 'not covered' });
  f.index.examineCoverage[0].items.push({ index: 5, text: 'list of system accounts', category: 'documentary', kinds: [], status: 'not covered' });
  // A creditedTo without a hash is not a credit.
  f.index.examineCoverage[0].items.push({ index: 6, text: 'access control procedures', category: 'documentary', kinds: [], status: 'covered', creditedTo: { document: 'policies/access-control-policy.md' } });
  // A credit on a non-documentary item is not an SC-3b credit and does not change SC-3a (status decides SC-3a).
  f.index.examineCoverage[0].items[2] = { ...f.index.examineCoverage[0].items[2], status: 'not covered', creditedTo: credit };
  const { inp, sc } = run(f);
  assert.deepEqual(creditedDocumentary(inp).map((x) => x.index), [1]);
  assert.deepEqual(rowOf(sc, 'SC-3b').value, { listed: 3, credited: 1, of: 4 });
  assert.equal(rowOf(sc, 'SC-3b').status, 'pass');
  assert.match(rowOf(sc, 'SC-3b').detail, /credited to a hashed policy 1\)/);
  const docRows = buildGaps(inp, sc).rows.filter((r) => r.source === 'documentary');
  assert.deepEqual(docRows.map((r) => r.item.split(':')[0]).sort(), ['examine #4', 'examine #5', 'examine #6']);
  assert.match(docRows.find((r) => r.item.startsWith('examine #4')).have, /did not credit it/);
  assert.deepEqual(rowOf(sc, 'SC-3a').value, { covered: 0, of: 1, pct: 0 });
  // Without creditedTo the same items are all listed, and SC-3a is the same.
  const f0 = baseline();
  f0.index.examineCoverage[0].items.push({ index: 4, text: 'procedures addressing account management', category: 'documentary', kinds: [], status: 'not covered' });
  const r0 = run(f0);
  assert.deepEqual(rowOf(r0.sc, 'SC-3b').value, { listed: 2, credited: 0, of: 2 });
  assert.match(rowOf(r0.sc, 'SC-3b').detail, /the index carries no creditedTo/);
});

test('SC-4: presence-only met share; 1 of 2 = 50 % fails 25 %', () => {
  const f = baseline(); f.ssp.controlImplementations[1].presenceOnly = true;
  const { sc } = run(f);
  assert.deepEqual(rowOf(sc, 'SC-4').value, { presenceOnly: 1, met: 2, pct: 50 });
  assert.equal(rowOf(sc, 'SC-4').status, 'fail');
});

test('SC-5: placeholders counted in JSON and DOCX; 11 fail the threshold of 10', () => {
  const f = baseline(); f.ssp.systemDescription = Array(11).fill('[MANUAL INPUT REQUIRED]').join(' ');
  f.docxLines.push('REQUIRES MANUAL INPUT');
  const { sc } = run(f);
  assert.deepEqual(rowOf(sc, 'SC-5').value, { json: 11, docx: 1, markers: { json: 11, docx: 1 }, contentGap: { json: 0, docx: 0 } });
  assert.equal(rowOf(sc, 'SC-5').status, 'fail');
});

test('SC-5 (W5c1 a): the content-gap sentence is a placeholder of its own kind: tallied apart, in the totals, GAPS rows content / founder content', () => {
  // The constant must stay identical to ces-eo src\eo\ssp\ContentGap.ts NOT_SUPPLIED.
  assert.equal(NOT_SUPPLIED, 'Not supplied by the organisation (content gap)');
  const f = baseline();
  // Sentence form (": <what>.") x 9 in systemDescription, the bare appendix form once, and one in a control narrative.
  f.ssp.systemDescription = Array.from({ length: 9 }, (_, i) => `${NOT_SUPPLIED}: item ${i}.`).join(' ');
  f.ssp.appendices = [{ id: 'E', documentId: NOT_SUPPLIED }];
  f.ssp.controlImplementations[2].implementationNarrative = `${LONG} ${NOT_SUPPLIED}: the physical security records that evidence this control.`;
  f.docxLines.push(`${NOT_SUPPLIED}: the Authorizing Official.`, `Document id ${NOT_SUPPLIED}`);
  let { inp, sc } = run(f);
  assert.deepEqual(rowOf(sc, 'SC-5').value, { json: 11, docx: 2, markers: { json: 0, docx: 0 }, contentGap: { json: 11, docx: 2 } });
  assert.equal(rowOf(sc, 'SC-5').status, 'fail');
  assert.match(rowOf(sc, 'SC-5').detail, /content gaps "Not supplied by the organisation \(content gap\)" 11 \/ 2/);
  const g = buildGaps(inp, sc);
  const cg = g.rows.filter((r) => r.source === 'content-gap');
  assert.equal(cg.length, 11);
  assert.equal(g.rows.filter((r) => r.source === 'placeholder').length, 0);
  assert.ok(cg.every((r) => r.module === 'content' && r.owner === 'founder content'));
  const pe = cg.find((r) => r.control === 'PE.L1-3.10.1');
  assert.equal(pe.weight, 5);
  assert.match(pe.needs, /physical security records that evidence this control/);
  assert.equal(cg.find((r) => r.item === 'appendices[0].documentId').needs, 'the organisation content this field stands for');
  assert.equal(new Set(cg.map((r) => r.id)).size, 11);
  assert.match(renderGapsMd(g), /## Content-gap sentences in the SSP JSON .* \(11\)/);
  // Markers and content gaps add up; 10 in total stays within the threshold.
  const f2 = baseline(); f2.ssp.systemDescription = `[MANUAL INPUT REQUIRED] ${Array(9).fill(`${NOT_SUPPLIED}.`).join(' ')}`;
  ({ sc } = run(f2));
  assert.deepEqual(rowOf(sc, 'SC-5').value, { json: 10, docx: 0, markers: { json: 1, docx: 0 }, contentGap: { json: 9, docx: 0 } });
  assert.equal(rowOf(sc, 'SC-5').status, 'pass');
});

test('SC-6: a document without an approver, a [Name] token, and a missing answers file', () => {
  assert.deepEqual(policyCompleteness({ file: 'x.md', text: '**Policy Owner:** Not specified\n' }).problems, ['no named owner', 'no named approver', '1 × Not specified']);
  assert.equal(policyCompleteness({ file: 'x.md', text: '## Attestation\n**Name:** Role Holder\n**Policy Owner:** Role Holder\n' }).complete, true);
  assert.equal(policyCompleteness({ file: 'x.md', text: '## Attestation\n**Name:** Designated Official\n**Policy Owner:** Designated Official\n' }).complete, false);
  let f = baseline(); f.policies['policy-03.md'] = f.policies['policy-03.md'].replace('Role Holder B', '[Name]');
  let { sc } = run(f); assert.equal(rowOf(sc, 'SC-6').value.policies, 21); assert.equal(rowOf(sc, 'SC-6').status, 'fail');
  f = baseline(); f.answers = null; ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-6').value.odps, 0);
  f = baseline(); f.profile.artifact.odps.session_timeout_minutes = '99'; ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-6').value.odps, 14);
});

test('SC-7: SPRS = 110 - weights of the controls not met; any assessed value that differs fails', () => {
  let { sc } = run(baseline());
  assert.equal(rowOf(sc, 'SC-7').value.recomputed, 105);
  const f = baseline(); f.assess = [{ type: 'assess_summary', sprs_score: 110 }];
  ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-7').status, 'fail');
});

// Run 61 (per-run cleanup): an assessment file written before this run's E1 start is a stale artefact, never read.
test('loadInputs (run 61): assessment files older than the E1 start in steps.json are stale artefacts and not read', () => {
  const f = baseline(); f.assess7b = [{ type: 'assess_summary', sprs_score: 105 }];
  const m = materialise(f);
  const load = () => loadInputs({ root: m.root, slug: m.slug, runDir: m.out, pkgDir: m.pkg });
  assert.equal(load().assess.length, 3);
  // Run starts after the files were written: all four are stale.
  fs.writeFileSync(path.join(m.out, 'steps.json'), JSON.stringify({ E1: { started: new Date(Date.now() + 60000).toISOString() } }));
  let inp = load();
  assert.deepEqual([inp.assess.length, inp.assess7b], [0, null]);
  assert.ok(inp.notes.some((n) => /^eo-assess-2\.json: stale artefact from an earlier run/.test(n)));
  assert.equal(rowOf(computeScorecard(inp, m.pkg), 'SC-7').status, 'not computed');
  // Pass 1 rewritten by this run, passes 2 and 3 left by the previous one (run 61's shape): only pass 1 is read.
  const t = new Date(Date.now() - 60000);
  for (const n of ['eo-assess-2.json', 'eo-assess-3.json', 'eo-assess-7b.json']) fs.utimesSync(path.join(m.out, n), t, t);
  fs.writeFileSync(path.join(m.out, 'steps.json'), JSON.stringify({ E1: { started: new Date(Date.now() - 30000).toISOString() } }));
  inp = load();
  assert.deepEqual(inp.assess.map((a) => a.file), ['eo-assess.json']);
  assert.equal(inp.assess7b, null);
  // No E1 start: mtimes are not judged.
  fs.writeFileSync(path.join(m.out, 'steps.json'), '{}');
  assert.equal(load().assess.length, 3);
});

// Run 61c (SC-7 source): SC-7 reads the authoritative assessment's statuses (the EO package snapshot of that assessment,
// else the SSP), never the ledger's personnel readiness rows, which organisation records may decide.
test('SC-7 (run 61c): statuses from the authoritative assessment snapshot, never a ledger readiness row', () => {
  const sum = (sprs, sid) => [{ type: 'assess_summary', snapshotId: sid, sprs_score: sprs, controls_met: 2, controls_not_met: 0, controls_partial: 0, controls_not_assessed: 1 }];
  const s1like = () => {
    const f = baseline();
    f.assess = sum(105, 'snap-p3'); f.assess7b = sum(105, 'snap-7b'); f.e7a = { tenant_slug: SLUG, ops: [], expected_improvements: [] };
    // The ledger's readiness row says met (organisation records), the assessment says not assessed.
    f.ledger.controls = [{ controlId: 'AC.L1-3.1.1', status: 'met', weight: 5 }, { controlId: 'AC.L1-3.1.2', status: 'met', weight: 5 }, { controlId: 'PE.L1-3.10.1', status: 'met', weight: 5 }];
    return f;
  };
  const withSnapshot = (m, sid, statuses) => {
    const d = path.join(m.out, 'eo-package', 'evidence-package-1', 'assessments');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'latest-snapshot.json'), JSON.stringify({ snapshotId: sid, controls: Object.entries(statuses).map(([control_id, status]) => ({ control_id, status })) }));
  };
  const sc7 = (m) => rowOf(computeScorecard(loadInputs({ root: m.root, slug: m.slug, runDir: m.out, pkgDir: m.pkg }), m.pkg), 'SC-7');
  // No snapshot: the SSP's statuses (PE.L1-3.10.1 not_assessed) give 105; the ledger's 110 is never used.
  let m = materialise(s1like());
  let r = sc7(m);
  assert.equal(r.status, 'pass', r.detail);
  assert.equal(r.value.recomputed, 105);
  assert.match(r.detail, /^110 - 5 = 105 \(statuses from the SSP control statuses\); authoritative 105 \(E7B\)/);
  // The E7B snapshot (authoritative) is used, its weights from the SSP when the snapshot carries none.
  withSnapshot(m, 'snap-7b', { 'AC.L1-3.1.1': 'met', 'AC.L1-3.1.2': 'met', 'PE.L1-3.10.1': 'not_assessed' });
  r = sc7(m);
  assert.equal(r.status, 'pass', r.detail);
  assert.equal(r.value.statusSource, 'the E7B assessment snapshot snap-7b');
  // A snapshot of another assessment is not the authoritative one: the SSP is used.
  withSnapshot(m, 'snap-other', { 'AC.L1-3.1.1': 'met', 'AC.L1-3.1.2': 'met', 'PE.L1-3.10.1': 'met' });
  r = sc7(m);
  assert.deepEqual([r.status, r.value.recomputed, r.value.statusSource], ['pass', 105, 'the SSP control statuses']);
  // E7 passes authoritative (E7B absent): pass 3's snapshot is the source.
  const f = s1like(); delete f.assess7b; m = materialise(f);
  withSnapshot(m, 'snap-p3', { 'AC.L1-3.1.1': 'met', 'AC.L1-3.1.2': 'met', 'PE.L1-3.10.1': 'not_assessed' });
  r = sc7(m);
  assert.deepEqual([r.status, r.value.statusSource], ['pass', 'the E7 pass 3 assessment snapshot snap-p3']);
});

// W6 follow-up (S3 run 60): the POA&M and SSP section 14 are written after E7B's re-assessment, so the authoritative
// assessed SPRS is E7B's when E7A's expected improvements explain the difference from the E7 passes.
test('SC-7 / SC-2 row 15 (W6 post-E7B SPRS): E7B is authoritative when its expected improvements explain the difference', () => {
  const sum = (sprs, met, notMet) => [{ type: 'assess_summary', sprs_score: sprs, controls_met: met, controls_not_met: notMet, controls_partial: 0, controls_not_assessed: 1 }];
  const imp = [{ controlId: 'AC.L1-3.1.2', op: 'A-02', from: 'not_met', to: 'met' }];
  const s3like = () => { const f = baseline(); f.assess = sum(100, 1, 1); f.assess7b = sum(105, 2, 0); f.e7a = { tenant_slug: SLUG, ops: [], expected_improvements: imp }; return f; };
  let { sc } = run(s3like());
  const r7 = rowOf(sc, 'SC-7');
  assert.equal(r7.status, 'pass', r7.detail);
  assert.deepEqual([r7.value.recomputed, r7.value.authoritative, r7.value.authoritySource], [105, 105, 'E7B']);
  assert.match(r7.detail, /authoritative 105 \(E7B\); E7 passes 100, E7B 105 \(E7B improvement: AC\.L1-3\.1\.2 not_met -> met \(A-02\), weight 5\); documents poam\.json 105, SSP §14 105/);
  assert.equal(predicate(sc, 15).pass, true, predicate(sc, 15).detail);
  // Without expected improvements the E7 passes stay authoritative: the documents (105) differ from 100 and fail.
  let f = s3like(); f.e7a.expected_improvements = [];
  ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-7').status, 'fail'); assert.match(rowOf(sc, 'SC-7').detail, /authoritative 100 \(E7 passes\)/);
  assert.equal(predicate(sc, 15).pass, false);
  // An E7A record of another scenario is not this run's.
  f = s3like(); f.e7a.tenant_slug = 'other';
  ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-7').status, 'fail');
  // E7B moved more than the expected improvements: flagged.
  f = s3like(); f.assess7b = sum(105, 3, 0);
  ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-7').status, 'fail'); assert.match(rowOf(sc, 'SC-7').detail, /differs from E7 pass 3 \(100\) by more than the expected improvements/);
  // S1 / S2 / muster-partial shape: E7B equal to the E7 passes, no improvements: unchanged behaviour.
  f = baseline(); f.assess = sum(105, 2, 0); f.assess7b = sum(105, 2, 0); f.e7a = { tenant_slug: SLUG, ops: [], expected_improvements: [] };
  ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-7').status, 'pass', rowOf(sc, 'SC-7').detail);
  // The three E7 passes must agree among themselves (V36 shares sprsAuthority).
  const A = sprsAuthority({ passes: [{ file: 'a', summary: { sprs_score: 46 } }, { file: 'b', summary: { sprs_score: 46 } }, { file: 'c', summary: { sprs_score: 45 } }], e7b: null });
  assert.equal(A.value, null); assert.match(A.problems[0], /^the E7 passes disagree: a=46, b=46, c=45$/);
});

test('SC-8a: unsure share among discovery RR-ACT answers; interview answers excluded', () => {
  let { sc } = run(baseline());
  assert.deepEqual(rowOf(sc, 'SC-8a').value, { unsure: 0, of: 2, pct: 0, excluded: { count: 0, ids: [] } });
  const f = baseline(); f.readiness.facts[0].answer = 'unsure';
  ({ sc } = run(f)); assert.deepEqual(rowOf(sc, 'SC-8a').value, { unsure: 1, of: 2, pct: 50, excluded: { count: 0, ids: [] } }); assert.equal(rowOf(sc, 'SC-8a').status, 'fail');
  assert.equal(controlOfQuestion('RR-ACT-AC_L1_3_1_1'), 'AC.L1-3.1.1');
});

// Ruling R-1 fixture: registry rows and discovery observations for a readable, a manual-only and the two platform-inherited controls.
const reg = (entry_id, control, extra = {}) => ({ entry_id, control_ids: [control], label: entry_id, engine: 'mgraph', set_command: '', get_command: 'Get-MgThing', manual_only: false, ...extra });
const fact = (cid, answer) => ({ question_id: `RR-ACT-${cid.replace(/[.-]/g, '_')}`, question_text: `Status of ${cid}?`, answer, provenance: 'auto_detected', confidence: answer === 'unsure' ? 'unknown' : 'high' });
function r1() {
  const f = baseline();
  f.registry = [
    reg('AC.L1-3.1.1.read', 'AC.L1-3.1.1'), reg('AC.L1-3.1.2.read', 'AC.L1-3.1.2'),
    reg('PE.L2-3.10.1.physical-access', 'PE.L1-3.10.1', { engine: 'manual_gate', get_command: '', manual_only: true }),
    reg('PE.L1-3.10.1.physical-access', 'PE.L1-3.10.1', { engine: 'manual_gate', get_command: '', manual_only: true }),
    reg('AU.L2-3.3.7.time-source', 'AU.L2-3.3.7', { label: 'Authoritative Time Source Verification (Platform Inherited)' }),
    reg('SC.L2-3.13.11.fips', 'SC.L2-3.13.11', { label: 'FIPS 140-2 Compliance Verification (Platform Inherited)' }),
    // manual_only with a get_command: discovery runs no read for it either.
    reg('AZ-DIAG-001', 'AU.L2-3.3.1', { engine: 'az', manual_only: true }),
  ];
  f.readiness.facts = [fact('AC.L1-3.1.1', 'unsure'), fact('AC.L1-3.1.2', 'no'), fact('PE.L1-3.10.1', 'unsure'), fact('AU.L2-3.3.7', 'unsure'), fact('SC.L2-3.13.11', 'unsure'), fact('AU.L2-3.3.1', 'unsure'), fact('SI.L2-3.14.2', 'unsure')];
  const obs = (cid, ids) => ({ control_id: cid, objective_ids: [], confidence: 'unknown', ran_entry_ids: ids, derived_posture: 'unknown' });
  // SI.L2-3.14.2 has no observation: never excluded.
  f.readiness.observations = [obs('AC.L1-3.1.1', ['AC.L1-3.1.1.read']), obs('AC.L1-3.1.2', ['AC.L1-3.1.2.read']), obs('PE.L1-3.10.1', ['PE.L2-3.10.1.physical-access']), obs('PE.L1-3.10.1', ['PE.L1-3.10.1.physical-access']), obs('AU.L2-3.3.7', ['AU.L2-3.3.7.time-source']), obs('SC.L2-3.13.11', ['SC.L2-3.13.11.fips']), obs('AU.L2-3.3.1', ['AZ-DIAG-001'])];
  return f;
}

test('SC-8a (R-1): an unsure on a manual-only control is excluded and reported (row detail and GAPS reason); on a readable control it counts', () => {
  const { inp, sc } = run(r1());
  const v = rowOf(sc, 'SC-8a').value;
  // Counted: AC.L1-3.1.1 unsure (readable), AC.L1-3.1.2 no, SI.L2-3.14.2 unsure (no observation).
  assert.deepEqual(v, { unsure: 2, of: 3, pct: 66.7, excluded: { count: 4, ids: ['PE.L1-3.10.1', 'AU.L2-3.3.7', 'SC.L2-3.13.11', 'AU.L2-3.3.1'] } });
  assert.match(rowOf(sc, 'SC-8a').detail, /^2\/3 = 66\.7 %; excluded 4 not discoverable \(4 unsure; manual-only 2, platform-inherited 2: PE\.L1-3\.10\.1/);
  const unsure = buildGaps(inp, sc).rows.filter((r) => r.source === 'unsure');
  assert.equal(unsure.length, 6);
  const pe = unsure.find((r) => r.control === 'PE.L1-3.10.1');
  assert.equal(pe.reason, 'not discoverable: manual-only control');
  assert.match(pe.have, /not discoverable: manual-only control \(excluded from SC-8a\)/);
  assert.equal(unsure.find((r) => r.control === 'AU.L2-3.3.1').reason, 'not discoverable: manual-only control');
  assert.equal(unsure.find((r) => r.control === 'AC.L1-3.1.1').reason, undefined);
  assert.equal(unsure.find((r) => r.control === 'SI.L2-3.14.2').reason, undefined);
});

test('SC-8a (R-1): the platform-inherited AU.L2-3.3.7 and SC.L2-3.13.11 are excluded from the registry label, though their reads are not manual', () => {
  const { inp, sc } = run(r1());
  const g = buildGaps(inp, sc).rows.filter((r) => r.source === 'unsure' && r.reason === 'not discoverable: platform-inherited control');
  assert.deepEqual(g.map((r) => r.control).sort(), ['AU.L2-3.3.7', 'SC.L2-3.13.11']);
  // The same reads without the label are readable and count.
  const f = r1(); f.registry.forEach((e) => { e.label = e.entry_id; });
  const r = rowOf(run(f).sc, 'SC-8a').value;
  assert.deepEqual([r.unsure, r.of, r.excluded.ids], [4, 5, ['PE.L1-3.10.1', 'AU.L2-3.3.1']]);
});

test('SC-8a (R-1): an interview answer replacing an unsure stays in the denominator; no registry or an unknown entry excludes nothing', () => {
  let f = r1(); f.answers.push({ ...fact('PE.L1-3.10.1', 'yes'), provenance: 'operator_interview' });
  let v = rowOf(run(f).sc, 'SC-8a').value;
  assert.deepEqual([v.unsure, v.of, v.excluded.ids], [2, 4, ['AU.L2-3.3.7', 'SC.L2-3.13.11', 'AU.L2-3.3.1']]);
  assert.match(rowOf(run(f).sc, 'SC-8a').detail, /interview-replaced 1/);
  const ri = run(f);
  const peRow = buildGaps(ri.inp, ri.sc).rows.find((r) => r.source === 'unsure' && r.control === 'PE.L1-3.10.1');
  assert.equal(peRow.reason, undefined); assert.match(peRow.have, /interview answer yes replaces it \(counted in SC-8a\)/);
  f = r1(); f.answers.push({ ...fact('PE.L1-3.10.1', 'unsure'), provenance: 'operator_interview' });
  v = rowOf(run(f).sc, 'SC-8a').value; assert.deepEqual([v.unsure, v.of], [3, 4]);
  f = r1(); f.registry = null;
  const r = run(f); v = rowOf(r.sc, 'SC-8a').value;
  assert.deepEqual([v.unsure, v.of, v.excluded.count], [6, 7, 0]);
  assert.match(rowOf(r.sc, 'SC-8a').detail, /Stamper registry not found, nothing excluded/);
  assert.ok(r.sc.notes.some((n) => /Stamper registry not found/.test(n)));
  f = r1(); f.readiness.observations.push({ control_id: 'SC.L2-3.13.11', ran_entry_ids: ['SC.L2-3.13.11.unknown'] });
  assert.deepEqual(rowOf(run(f).sc, 'SC-8a').value.excluded.ids, ['PE.L1-3.10.1', 'AU.L2-3.3.7', 'AU.L2-3.3.1']);
});

test('SC-8b: defaulted TCP fields over the bank (39 when the bank is unreachable); no plan-trace = not computed', () => {
  let f = baseline(); f.planTrace.defaulted_inputs.push(...Array.from({ length: 5 }, (_, i) => `TCP TCP.GA.00${i}: q (recommended)`));
  let { sc } = run(f); assert.deepEqual(rowOf(sc, 'SC-8b').value, { tcp: 6, of: 39, all: 7 }); assert.equal(rowOf(sc, 'SC-8b').status, 'fail');
  f = baseline(); f.planTrace = null; ({ sc } = run(f)); assert.equal(rowOf(sc, 'SC-8b').status, 'not computed');
});

test('thresholds.json in customers\\<slug>\\ overrides the plan table', () => {
  const f = baseline(); f.ssp.controlImplementations[1].presenceOnly = true; f.thresholds = { 'SC-4': { maxPct: 60 } };
  const { sc } = run(f);
  assert.equal(rowOf(sc, 'SC-4').status, 'pass'); assert.match(sc.thresholdSource, /thresholds\.json/);
});

test('zip reader inflates a deflated entry', () => {
  const data = Buffer.from('<w:p>hello</w:p>'.repeat(50));
  const def = zlib.deflateRawSync(data);
  const z = zipStored('word/document.xml', def);
  z.writeUInt16LE(8, 8); // local header method
  z.writeUInt16LE(8, 30 + 'word/document.xml'.length + def.length + 10); // central header method
  assert.equal(readZipEntry(z, 'word/document.xml').toString(), data.toString());
});

test('GAPS rows: control status, presence-only, documentary grouping, unsure, placeholder, gate, weight, stable ids', () => {
  const f = baseline();
  f.ssp.controlImplementations.push({ control_id: 'AC.L2-3.1.5', family: 'AC', status: 'not_met', weight: 3, implementationNarrative: LONG, responsibleRole: 'ISSO', relatedPolicies: [], evidenceDetails: [{ sha256: H }] });
  f.ssp.controlImplementations[1].presenceOnly = true;
  f.ssp.controlImplementations[1].implementationNarrative += '\n\nPresence only: users was read and returned 4 objects.';
  f.ssp.systemDescription = '[MANUAL INPUT REQUIRED]';
  f.stamper.push({ file: 'ac/ac.l2-3.1.5.pim.json', rec: { registryEntry: { entry_id: 'AC.L2-3.1.5.pim' }, complianceVerdict: 'NOT_SAT', metadata: { controlIds: ['AC.L2-3.1.5'], postcheckMode: 'presence', presenceReason: 'declares no state assertion' } } });
  f.tasks.push({ task: 'manual-PE.L1-3.10.1', name: 'manual-gate.json', rec: { complianceVerdict: 'PROVISIONAL', metadata: { controlIds: ['PE.L1-3.10.1'], gateAction: 'none' } } });
  f.readiness.facts[1].answer = 'unsure';
  f.index.examineCoverage[0].items.push({ index: 4, text: 'records of recently transferred employees', category: 'documentary', kinds: [], status: 'not covered' });
  const { inp, sc } = run(f);
  const g = buildGaps(inp, sc);
  const of = (src, cid) => g.rows.filter((r) => r.source === src && (!cid || r.control === cid));
  assert.equal(of('control-status', 'AC.L2-3.1.5')[0].module, 'Stamper');
  assert.equal(of('control-status', 'AC.L2-3.1.5')[0].weight, 3);
  assert.match(of('control-status', 'AC.L2-3.1.5')[0].have, /status not_met; tier n\/a.*postcheckMode state 0, presence 1/);
  assert.deepEqual([of('control-status', 'PE.L1-3.10.1')[0].module, of('control-status', 'PE.L1-3.10.1')[0].owner], ['content', 'founder content']);
  assert.match(of('presence-only', 'AC.L1-3.1.2')[0].have, /presence-only yes.*users was read/);
  const docs = of('documentary');
  assert.equal(docs.length, 2);
  assert.ok(docs.every((r) => r.group === 'access-control-policy.md'));
  assert.deepEqual(docs.map((r) => [r.module, r.owner]).sort(), [['Muster', 'BHD'], ['content', 'founder content']]);
  assert.equal(of('unsure', 'AC.L1-3.1.2')[0].module, 'Muster');
  assert.equal(of('placeholder')[0].item, 'systemDescription');
  assert.equal(of('postcheck-presence')[0].item, 'AC.L2-3.1.5.pim');
  assert.equal(of('manual-gate', 'PE.L1-3.10.1')[0].module, 'Stamper');
  assert.equal(of('orphan').length, 5);
  assert.equal(new Set(g.rows.map((r) => r.id)).size, g.rows.length);
  assert.equal(of('control-status', 'AC.L2-3.1.5')[0].id, gapId('control-status', 'AC.L2-3.1.5'));
  // Deterministic: the same input renders the same bytes, stamped with the SSP's time.
  assert.equal(renderGapsMd(buildGaps(inp, sc)), renderGapsMd(g));
  assert.equal(g.generatedAt, f.ssp.generatedAt);
  assert.match(renderGapsMd(g), /### access-control-policy\.md \(2\)/);
});

// W5 cycle 3 (LOG-W5c3-eo-rules2.md §2, H-C1): ssp.policyReconciliation[] rows as EO writes them (PolicyReconciliation.ts).
const READ_REF = 'directorySettings store record rec-0001 (GET /v1.0/groupSettings; collected 2026-10-28T19:23:36Z; payload sha256 aaaaaaaaaaaa)';
const recon = (controlId, odpId, odpKey, policyValue, tenantValue, sourceRows, readReference = READ_REF) => ({
  controlId, odpId, odpKey, policyValue, tenantValue, sourceRows, readReference,
  statement: `${controlId} ${odpId}: Policy states ${policyValue}; tenant configured ${tenantValue}; source rows: ${sourceRows.join('; ')} (${readReference}). A finding for the organisation to reconcile its policy and its tenant; no control status changes.`,
});
const RECON_LEAD = (n) => `Policy reconciliation (policy vs tenant): ${n} organisation-defined parameter value(s) differ between the policy and the tenant. Each is a finding for the organisation, not an objective failure; no control status, score or POA&M item changes.`;
// The records sentence (LOG-W5c3-records.md, golden AT.L2-3.2.2) that replaces a records content gap on a not-met control.
const RECORDS_SENTENCE = '**Organisation-supplied records (examine):** 4 role-based security training completion records dated 2026-07-08 to 2026-08-04 (training-role-based.json, EC item eci-fixture-training-role-based, sha256 b4adb605f302..., marked SIMULATED CUSTOMER (FICTIONAL)). The organisation supplied these records through the Evidence Collector; they are listed for an assessor to examine, they are not a tested condition, and they leave this control\'s assessed status unchanged.';
function withRecon(f, rows) {
  f.ssp.policyReconciliation = rows;
  f.ssp.postureReconciliation.policyReconciliation = rows;
  f.ssp.postureReconciliation.statements = [RECON_LEAD(rows.length), ...rows.map((r) => r.statement)];
  return f;
}
const s1Recon = () => [
  recon('AC.L1-3.1.1', 'PI.ODP.001', 'account_lockout_threshold', 'at most 3 failed attempts (account_lockout_threshold)', '5 failed attempts', ['Password Rule Settings: LockoutThreshold']),
  recon('AC.L1-3.1.1', 'PI.ODP.002', 'account_lockout_duration_minutes', 'at least 15 minutes (account_lockout_duration_minutes)', '5 minutes', ['Password Rule Settings: LockoutDurationInSeconds 300']),
  recon('AC.L2-3.1.10', 'PI.ODP.003', 'session_timeout_minutes', 'at most 10 minutes (session_timeout_minutes)', '15 minutes', ['S1 Windows compliance: passwordMinutesOfInactivityBeforeLock', 'S1 Windows compliance (CUI): passwordMinutesOfInactivityBeforeLock'], 'compliancePolicies store record rec-0002 (GET /v1.0/deviceManagement/deviceCompliancePolicies; collected 2026-10-28T19:23:36Z; payload sha256 bbbbbbbbbbbb)'),
  recon('IA.L2-3.5.7', 'PI.ODP.006', 'max_password_age_days', 'at most 60 days (max_password_age_days)', 'passwords never expire', ['s1-mach.example: passwordValidityPeriodInDays 2147483647', 's1-mach.onmicrosoft.example: passwordValidityPeriodInDays 2147483647'], 'domains store record rec-0003 (GET /v1.0/domains; collected 2026-10-28T19:23:36Z; payload sha256 cccccccccccc)'),
];

test('GAPS (H-C1): one policy-reconciliation row per ssp.policyReconciliation[] entry; organisation-owned, stable ids, weight, rendered section; no scorecard row moves', () => {
  const base = run(baseline());
  const f = withRecon(baseline(), s1Recon());
  const { inp, sc } = run(f);
  const g = buildGaps(inp, sc);
  const pr = g.rows.filter((r) => r.source === 'policy-reconciliation');
  assert.equal(pr.length, 4);
  assert.equal(g.bySource['policy-reconciliation'], 4);
  assert.equal(g.rowCount, buildGaps(base.inp, base.sc).rowCount + 4);
  assert.ok(pr.every((r) => r.module === 'content' && r.owner === 'founder content'));
  const lock = pr.find((r) => r.item === 'PI.ODP.001 account_lockout_threshold');
  assert.equal(lock.control, 'AC.L1-3.1.1');
  assert.equal(lock.have, `Policy states at most 3 failed attempts (account_lockout_threshold); tenant configured 5 failed attempts (${READ_REF})`);
  assert.match(lock.needs, /source rows: Password Rule Settings: LockoutThreshold/);
  // Weight: the control's SPRS points, as every control-bound row (AC.L1-3.1.1 weighs 5 in the fixture; a control not in the SSP weighs 0).
  assert.equal(lock.weight, 5);
  assert.equal(pr.find((r) => r.control === 'IA.L2-3.5.7').weight, 0);
  // Stable ids from content (not from the store record id or the collected time).
  assert.equal(lock.id, gapId('policy-reconciliation', 'AC.L1-3.1.1', 'PI.ODP.001', '5 failed attempts', 'Password Rule Settings: LockoutThreshold'));
  const f2 = withRecon(baseline(), s1Recon().map((r) => ({ ...r, readReference: r.readReference.replace(/rec-000\d/, 'rec-9999').replace('19:23:36Z', '20:00:00Z') })));
  const r2 = run(f2);
  assert.deepEqual(buildGaps(r2.inp, r2.sc).rows.filter((r) => r.source === 'policy-reconciliation').map((r) => r.id).sort(), pr.map((r) => r.id).sort());
  // Two rows for one control and ODP with different tenant values stay two rows.
  const f3 = withRecon(baseline(), [...s1Recon(), recon('AC.L2-3.1.10', 'PI.ODP.003', 'session_timeout_minutes', 'at most 10 minutes (session_timeout_minutes)', '30 minutes', ['CMMC-ScreenLock-Policy: passwordMinutesOfInactivityBeforeScreenTimeout'])]);
  const r3 = run(f3);
  const pr3 = buildGaps(r3.inp, r3.sc).rows.filter((r) => r.source === 'policy-reconciliation');
  assert.equal(pr3.length, 5); assert.equal(new Set(pr3.map((r) => r.id)).size, 5);
  assert.equal(new Set(g.rows.map((r) => r.id)).size, g.rows.length);
  // Rendered in its own section, after the ODPs and before the orphans.
  const md = renderGapsMd(g);
  assert.match(md, /## Policy vs tenant reconciliation findings \(SSP policyReconciliation\[\]; findings about the organisation, not loop gaps\) \(4\)/);
  assert.ok(md.indexOf('## Policy vs tenant reconciliation') < md.indexOf('## Orphans'));
  assert.ok(g.rows.findIndex((r) => r.source === 'policy-reconciliation') > g.rows.findLastIndex((r) => r.source === 'odp'));
  // No scorecard row moves (no status effect).
  assert.deepEqual(sc.rows.map((r) => [r.id, r.status, r.detail]), base.sc.rows.map((r) => [r.id, r.status, r.detail]));
  // No block: no rows.
  assert.equal(buildGaps(base.inp, base.sc).rows.filter((r) => r.source === 'policy-reconciliation').length, 0);
});

test('SC-1 (W5c3): the negation scan reads implementationNarrative only; a lexicon phrase in assessmentFinding, contentProvenance or the reconciliation statements does not fail row 1', () => {
  const f = withRecon(baseline(), s1Recon());
  f.ssp.controlImplementations[0].assessmentFinding = 'Policy CMMC-RemoteMaintenance-MFA is not configured for enforcement.';
  f.ssp.contentProvenance = [{ field: 'systemType', provenance: 'derived', source: 'SI Baseline scope; boundary not configured' }];
  f.ssp.postureReconciliation.statements.push('Tenant lockout not configured as the policy states.');
  let { sc } = run(f);
  assert.equal(predicate(sc, 1).pass, true, predicate(sc, 1).detail);
  assert.equal(rowOf(sc, 'SC-1').status, 'pass');
  // The same phrase in the narrative still fails row 1.
  f.ssp.controlImplementations[0].implementationNarrative = `${LONG} MFA is not configured.`;
  ({ sc } = run(f));
  assert.equal(predicate(sc, 1).pass, false);
});

test('SC-5 (W5c3): the records sentence, contentProvenance, assessmentFinding and the reconciliation rows / statements are not content gaps (JSON and DOCX)', () => {
  const f = withRecon(baseline(), s1Recon());
  f.ssp.controlImplementations[2].implementationNarrative = `${LONG} ${RECORDS_SENTENCE}`;
  f.ssp.controlImplementations[0].assessmentFinding = 'Conditional access policies enforce authorized access with MFA and compliant device requirement.';
  f.ssp.contentProvenance = [
    { field: 'controlImplementations[PE.L1-3.10.1].implementationNarrative', provenance: 'organisation records', sources: [{ ecItemId: 'eci-fixture-physical-access', file: 'physical-access.json', sha256: H, kind: 'physical access', rows: 4, method: 'examine' }] },
    { field: 'appendices[F].documentId', provenance: 'organisation records', sources: [{ file: 'personnel-screening.json', sha256: H, method: 'examine' }] },
  ];
  f.ssp.appendices = [{ id: 'F', documentId: 'ORGANISATION RECORDS: personnel-lifecycle.json (sha256 46321701746b...); personnel-screening.json (sha256 668c58923a33...)' }];
  f.docxLines.push(RECORDS_SENTENCE, RECON_LEAD(4), ...s1Recon().map((r) => r.statement));
  const { inp, sc } = run(f);
  assert.deepEqual(rowOf(sc, 'SC-5').value, { json: 0, docx: 0, markers: { json: 0, docx: 0 }, contentGap: { json: 0, docx: 0 } });
  assert.equal(rowOf(sc, 'SC-5').status, 'pass');
  const g = buildGaps(inp, sc);
  assert.equal(g.rows.filter((r) => r.source === 'content-gap' || r.source === 'placeholder').length, 0);
  assert.equal(g.rows.filter((r) => r.source === 'policy-reconciliation').length, 4);
});

test('GAPS (H-C2): the three new unrouted store sources become collector rows only when empty or errored (generic sourceId | status)', () => {
  const m = materialise(baseline());
  const store = path.join(m.out, 'eo', 'evidence-store', 'sim-tenant-t1');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'manifest.json'), JSON.stringify({ tenantSlug: SLUG }));
  const recs = [
    { sourceId: 'directorySettings', status: 'success', itemCount: 1, controlIds: [] },
    { sourceId: 'domains', status: 'empty', itemCount: 0, controlIds: [] },
    { sourceId: 'roleEligibilitySchedules', status: 'error', itemCount: 0, controlIds: [] },
  ];
  fs.writeFileSync(path.join(store, 'records.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n'));
  const inp = loadInputs({ root: m.root, slug: m.slug, runDir: m.out, pkgDir: m.pkg });
  const col = buildGaps(inp, computeScorecard(inp, m.pkg)).rows.filter((r) => r.source === 'collector');
  assert.deepEqual(col.map((r) => [r.item, r.module, r.control, r.weight]).sort(), [['domains empty', 'simulator', null, 1], ['roleEligibilitySchedules error', 'EvidenceOps', null, 1]]);
});

test('GAPS (W5c6): manual-gate ids are keyed by control + gate label, the same across runs; the task id is a field; counts unchanged', () => {
  const gate = (task, cid) => ({ task, name: 'manual-gate.json', rec: { complianceVerdict: 'PROVISIONAL', metadata: { controlIds: [cid], gateAction: 'none' } } });
  const gapsOf = (tasks) => { const f = baseline(); f.tasks.push(...tasks); const { inp, sc } = run(f); return buildGaps(inp, sc); };
  const runA = gapsOf([gate('manual-PE.L1-3.10.1', 'PE.L1-3.10.1'), gate('step_task_MP.L1-3.8.3_mvsrndod_3ldg2xa', 'MP.L1-3.8.3')]);
  const runB = gapsOf([gate('manual-PE.L1-3.10.1', 'PE.L1-3.10.1'), gate('step_task_MP.L1-3.8.3_mvsra0cz_67cnbk5', 'MP.L1-3.8.3')]);
  const mg = (g) => g.rows.filter((r) => r.source === 'manual-gate').sort((a, b) => a.control.localeCompare(b.control));
  assert.equal(gateLabel('step_task_MP.L1-3.8.3_mvsrndod_3ldg2xa'), 'step_task_MP.L1-3.8.3');
  assert.equal(gateLabel('manual-PE.L1-3.10.1'), 'manual-PE.L1-3.10.1');
  // Two runs, two Stamper suffixes: the same ids (V57's GAPS-monotonic count sees no churn either way: ids only).
  assert.deepEqual(mg(runA).map((r) => r.id), mg(runB).map((r) => r.id));
  assert.equal(mg(runA)[0].id, gapId('manual-gate', 'MP.L1-3.8.3', 'step_task_MP.L1-3.8.3'));
  assert.deepEqual(mg(runA).map((r) => [r.control, r.item, r.task]), [['MP.L1-3.8.3', 'step_task_MP.L1-3.8.3', 'step_task_MP.L1-3.8.3_mvsrndod_3ldg2xa'], ['PE.L1-3.10.1', 'manual-PE.L1-3.10.1', 'manual-PE.L1-3.10.1']]);
  assert.equal(mg(runB)[0].task, 'step_task_MP.L1-3.8.3_mvsra0cz_67cnbk5');
  assert.equal(runA.rowCount, runB.rowCount);
  assert.equal(runA.bySource['manual-gate'], 2);
  // A second gate with the same control + label stays its own row with its own id (no collision, no row lost).
  const dup = gapsOf([gate('step_task_MP.L1-3.8.3_aaaa_1111', 'MP.L1-3.8.3'), gate('step_task_MP.L1-3.8.3_bbbb_2222', 'MP.L1-3.8.3')]);
  assert.equal(mg(dup).length, 2);
  assert.equal(new Set(dup.rows.map((r) => r.id)).size, dup.rows.length);
});

// W6 (S3): a fixture deficiencies.json (customers\<slug>\) and an E7A record, cross-checked by gaps.mjs and V59.
const defn = (id, control, fixer, extra = {}) => ({ id, title: `${id} title`, controls: [control], what_is_wrong: `${id} is wrong on purpose`, fixer, e7a_op: 'none', gaps_row: { source: 'deficiency', module: 'content', control, item: `${id} expected item`, needs: `${id} needs`, have: `${id} have`, owner: 'organisation' }, gaps_also: [], ...extra });
const defFixture = () => {
  const f = baseline();
  f.deficiencies = { schema: 'test', slug: SLUG, deficiencies: [
    defn('X-D01', 'AC.L1-3.1.1', 'AdminOps', { e7a_op: 'A-11 read; A-02 disable (T2)' }),
    defn('X-D02', 'AC.L1-3.1.1', 'Stamper'),
    defn('X-D03', 'PE.L1-3.10.1', 'finding-only', { gaps_also: [{ source: 'control-status', module: 'EvidenceOps', control: 'PE.L1-3.10.1', item: 'not_assessed' }] }),
    defn('X-D04', 'AC.L1-3.1.2', 'organisation'),
    defn('X-D05', 'AC.L1-3.1.2', 'Stamper'),
  ] };
  f.e7a = { schema: 'ces-tester/adminops-e7a@1', tenant_slug: SLUG, ops: [
    { op: 'A-11', kind: 'read', calls: [{ call: 'apply', success: true }], ok: true },
    { op: 'A-02', kind: 'write', calls: [{ call: 'dry_run', success: true }, { call: 'apply', success: true }], ok: true, confirm: { pass: true } },
  ] };
  return f;
};

test('GAPS (W6): seeded deficiencies are cross-checked: surfaced by a matching row, resolved by their fixer, or carried by a deficiency row', () => {
  const { inp, sc } = run(defFixture());
  const g = buildGaps(inp, sc);
  const D = g.deficiencies;
  const by = Object.fromEntries(D.rows.map((x) => [x.id, x]));
  assert.deepEqual([D.count, D.surfaced, D.resolved, D.unsurfaced], [5, 1, 2, ['X-D04', 'X-D05']]);
  assert.deepEqual([by['X-D01'].resolved, by['X-D01'].fixerActed, by['X-D01'].ledgerStatus], [true, 'AdminOps A-02 in E7A (confirmed)', 'met']);
  assert.deepEqual([by['X-D02'].resolved, by['X-D02'].fixerActed], [true, 'Stamper record SAT (state) on the control']);
  assert.deepEqual([by['X-D03'].surfaced, by['X-D03'].surfacedBy.source, by['X-D03'].resolved, by['X-D03'].fallbackRow], [true, 'control-status', false, null]);
  assert.equal(by['X-D03'].surfacedBy.id, gapId('control-status', 'PE.L1-3.10.1'));
  assert.deepEqual([by['X-D04'].fixerActed, by['X-D05'].fixerActed], ['still open', 'still open']);
  const dr = g.rows.filter((r) => r.source === 'deficiency');
  assert.deepEqual(dr.map((r) => r.id).sort(), [gapId('deficiency', 'X-D04'), gapId('deficiency', 'X-D05')].sort());
  assert.equal(g.bySource.deficiency, 2);
  const d4 = dr.find((r) => r.deficiency === 'X-D04');
  assert.deepEqual([d4.module, d4.control, d4.item, d4.owner, d4.weight], ['content', 'AC.L1-3.1.2', 'X-D04 expected item', 'organisation', 5]);
  assert.match(d4.have, /^Seeded deficiency X-D04 not surfaced: X-D04 is wrong on purpose \(ledger met; fixer organisation: still open\)$/);
  const md = renderGapsMd(g);
  assert.match(md, /## Seeded deficiencies \(5: 1 surfaced, 2 resolved, 2 not surfaced\)/);
  assert.match(md, /## Seeded deficiencies not surfaced by any other row \(customers\/<slug>\/deficiencies\.json\) \(2\)/);
  assert.equal(new Set(g.rows.map((r) => r.id)).size, g.rows.length);
  // An E7A record of another scenario is never this run's: the AdminOps deficiency stays open and gets its row.
  const f = defFixture(); f.e7a.tenant_slug = 'other-slug';
  const g2 = (() => { const r2 = run(f); return buildGaps(r2.inp, r2.sc); })();
  assert.deepEqual(g2.deficiencies.unsurfaced, ['X-D01', 'X-D04', 'X-D05']);
  // A failed confirming read does not count as the fixer acting.
  const f3 = defFixture(); f3.e7a.ops[1].confirm.pass = false;
  const r3 = run(f3); assert.equal(buildGaps(r3.inp, r3.sc).deficiencies.rows[0].fixerActed, 'still open');
  // No deficiencies.json: no block, no rows, and a note says so.
  const b = run(baseline()); const gb = buildGaps(b.inp, b.sc);
  assert.equal(gb.deficiencies, undefined); assert.equal(gb.bySource.deficiency, undefined);
  assert.ok(gb.notes.some((n) => /no customers\/t1-test\/deficiencies\.json/.test(n)));
});

// W6 follow-up (S3 run 63): control-status rows carry EO's finding; `match` keywords surface a deficiency by it; a fixer
// that acted on a control another open deficiency keeps not met counts as fixed; one with no such other: review.
const findingFixture = (defsList) => {
  const f = baseline();
  f.ssp.controlImplementations.push({ control_id: 'AC.L2-3.1.5', family: 'AC', status: 'not_met', weight: 3, implementationNarrative: LONG, responsibleRole: 'ISSO', relatedPolicies: [], evidenceDetails: [{ sha256: H }],
    assessmentFinding: "Least privilege: 1 shared login holds a standing role: user-57 (shopfloor@t1.example, 'Shop Floor Terminal')" });
  f.stamper.push({ file: 'ac/ac.l2-3.1.5.pim.json', rec: { registryEntry: { entry_id: 'AC.L2-3.1.5.pim', control_ids: ['AC.L2-3.1.5'] }, complianceVerdict: 'SAT', metadata: { controlIds: ['AC.L2-3.1.5'], postcheckMode: 'state' } } });
  f.deficiencies = { schema: 'test', slug: SLUG, deficiencies: defsList };
  return f;
};
test('GAPS (W6 run 63): findings on control-status rows, match keywords, and "fixed while the control is still not met"', () => {
  const g = (() => { const { inp, sc } = run(findingFixture([
    defn('K-1', 'AC.L2-3.1.5', 'finding-only', { match: ['SHOPFLOOR@'] }),
    defn('K-2', 'AC.L2-3.1.5', 'finding-only', { match: ['nothing like this'] }),
    defn('F-1', 'AC.L2-3.1.5', 'Stamper', { stamper_entries: ['AC.L2-3.1.5.pim'] }),
    defn('F-2', 'AC.L2-3.1.5', 'Stamper', { stamper_entries: ['AC.L2-3.1.5.other'] }),
  ])); return buildGaps(inp, sc); })();
  const cs = g.rows.find((r) => r.source === 'control-status' && r.control === 'AC.L2-3.1.5');
  assert.match(cs.finding, /^Least privilege: 1 shared login/);
  assert.match(renderGapsMd(g), /; EO finding: Least privilege: 1 shared login holds a standing role/);
  const by = Object.fromEntries(g.deficiencies.rows.map((x) => [x.id, x]));
  assert.deepEqual([by['K-1'].surfaced, by['K-1'].surfacedBy.id, by['K-1'].surfacedBy.by], [true, cs.id, 'match']);
  assert.equal(by['K-2'].surfaced, false);
  assert.deepEqual([by['F-1'].resolved, by['F-1'].fixerActed, by['F-1'].note], [true, 'Stamper AC.L2-3.1.5.pim SAT (state)', 'fixed (control still not met: K-1, K-2, F-2)']);
  assert.deepEqual([by['F-2'].fixerActed, by['F-2'].resolved], ['still open', false]);
  assert.deepEqual(g.deficiencies.unsurfaced, ['K-2', 'F-2']);
  // A keyword on another control's row does not count.
  const g2 = (() => { const { inp, sc } = run(findingFixture([defn('K-3', 'PE.L1-3.10.1', 'finding-only', { match: ['shopfloor@'] })])); return buildGaps(inp, sc); })();
  assert.deepEqual(g2.deficiencies.unsurfaced, ['K-3']);
  // The fixer acted and nothing else explains the not-met: stays unsurfaced with the review note (row text and V59 detail).
  const g3 = (() => { const { inp, sc } = run(findingFixture([defn('F-3', 'AC.L2-3.1.5', 'Stamper', { stamper_entries: ['AC.L2-3.1.5.pim'] })])); return buildGaps(inp, sc); })();
  const f3 = g3.deficiencies.rows[0];
  assert.deepEqual([f3.resolved, f3.surfaced, f3.note], [false, false, 'fixer acted but the control is still not met: review']);
  assert.match(g3.rows.find((r) => r.source === 'deficiency').have, /Stamper AC\.L2-3\.1\.5\.pim SAT \(state\); fixer acted but the control is still not met: review\)$/);
});

test('verify-w4 (W6): V59 lists unsurfaced deficiencies, is report-only without the file; V57 leaves deficiency rows out', async () => {
  const collect = async (f) => {
    const m = materialise(f); const checks = [];
    const check = (id, title, fn) => { try { const r = fn(); checks.push({ id, pass: !!r.pass, detail: r.detail }); } catch (e) { checks.push({ id, pass: false, detail: e.message }); } };
    await registerW4Checks(check, { root: m.root, slug: m.slug, out: m.out, pkgDir: m.pkg });
    return Object.fromEntries(checks.map((c) => [c.id, c]));
  };
  let c = await collect(baseline());
  assert.equal(c.V59.pass, true); assert.match(c.V59.detail, /^report-only: no customers\/t1-test\/deficiencies\.json/);
  const b = run(baseline()); const n = buildGaps(b.inp, b.sc).rowCount;
  let f = defFixture(); f.proofGaps = { generatedAt: '2026-10-27T00:00:00.000Z', rowCount: n };
  c = await collect(f);
  assert.equal(c.V59.pass, false);
  assert.match(c.V59.detail, /^5 deficiencies: 1 surfaced by a GAPS row, 2 fixed by their fixer \[X-D01 .*; X-D02 .*\], 2 not surfaced: X-D04 \(AC\.L1-3\.1\.2 met; fixer organisation: still open\); X-D05 /);
  // V57: the two deficiency rows are not loop rows (n + 2 rows now, compared as n).
  assert.equal(c.V57.pass, true, c.V57.detail);
  assert.match(c.V57.detail, new RegExp(`^${n} rows now vs ${n} in nb-run1 \\(\\+0\\); 0 policy-reconciliation rows excluded \\(findings about the organisation, not loop gaps\\); 2 deficiency rows excluded \\(seeded deficiencies, not loop gaps\\)$`));
  // Every deficiency surfaced or fixed: V59 passes.
  f = defFixture(); f.deficiencies.deficiencies = f.deficiencies.deficiencies.slice(0, 3);
  c = await collect(f);
  assert.equal(c.V59.pass, true, c.V59.detail); assert.match(c.V59.detail, /^3 deficiencies: 1 surfaced by a GAPS row, 2 fixed by their fixer .*, 0 not surfaced$/);
});

test('verify-w4: V50-V53, V56, V57 on the baseline; V51 reports deltas; V57 compares with the newest proof run', async () => {
  const collect = async (f) => {
    const m = materialise(f); const checks = [];
    const check = (id, title, fn) => { try { const r = fn(); checks.push({ id, pass: !!r.pass, detail: r.detail }); } catch (e) { checks.push({ id, pass: false, detail: e.message }); } };
    await registerW4Checks(check, { root: m.root, slug: m.slug, out: m.out, pkgDir: m.pkg });
    return { m, checks: Object.fromEntries(checks.map((c) => [c.id, c])) };
  };
  let { m, checks } = await collect(baseline());
  assert.deepEqual(Object.keys(checks), ['V50', 'V51', 'V52', 'V53', 'V56', 'V57', 'V59']);
  for (const id of Object.keys(checks)) assert.equal(checks[id].pass, true, `${id}: ${checks[id].detail}`);
  assert.ok(fs.existsSync(path.join(m.out, `scorecard-${SLUG}.json`)) && fs.existsSync(path.join(m.out, `GAPS-${SLUG}.md`)));
  assert.match(checks.V57.detail, /first run/);
  let f = baseline(); f.ssp.controlImplementations[1].presenceOnly = true; f.proofGaps = { generatedAt: '2026-10-27T00:00:00.000Z', rowCount: 3 };
  ({ checks } = await collect(f));
  // V51 is report-only until the scenario's tester file sets scorecard_gate (verify-w4.mjs); with the gate on it fails with deltas.
  assert.equal(checks.V51.pass, true); assert.match(checks.V51.detail, /report-only .*SC-4 outside/);
  f.scorecardGate = true; ({ checks } = await collect(f));
  assert.equal(checks.V51.pass, false); assert.match(checks.V51.detail, /SC-4 50 % > 25 % \(\+25\.0; 1 controls\)/);
  assert.equal(checks.V56.pass, true);
  assert.equal(checks.V57.pass, false); assert.match(checks.V57.detail, /vs 3 in nb-run1/);
  f = baseline(); f.planTrace = null; ({ checks } = await collect(f));
  assert.equal(checks.V50.pass, false); assert.match(checks.V50.detail, /not computed: SC-8b/);
  assert.equal(delta({ id: 'SC-8a', value: { pct: 62.5 }, threshold: { maxPct: 15 } }), '62.5 % > 15 % (+47.5)');
  // W5c3: V57 leaves the policy-reconciliation rows out on both sides (findings about the organisation, not loop gaps).
  const b = run(baseline()); const n = buildGaps(b.inp, b.sc).rowCount;
  f = withRecon(baseline(), s1Recon()); f.proofGaps = { generatedAt: '2026-10-27T00:00:00.000Z', rowCount: n };
  ({ checks } = await collect(f));
  assert.equal(checks.V57.pass, true, checks.V57.detail);
  assert.match(checks.V57.detail, new RegExp(`^${n} rows now vs ${n} in nb-run1 \\(\\+0\\); 4 policy-reconciliation rows excluded \\(findings about the organisation, not loop gaps\\)$`));
  assert.equal(checks.V52.pass, true, checks.V52.detail);
  // An archive that itself carries reconciliation rows is compared on its loop rows too.
  f = withRecon(baseline(), s1Recon().slice(0, 1)); f.proofGaps = { generatedAt: '2026-10-27T00:00:00.000Z', rowCount: n + 3, bySource: { 'policy-reconciliation': 3 } };
  ({ checks } = await collect(f));
  assert.equal(checks.V57.pass, true); assert.match(checks.V57.detail, new RegExp(`^${n} rows now vs ${n} in nb-run1`));
  // One more loop row still fails V57, reconciliation rows or not.
  f = withRecon(baseline(), s1Recon()); f.ssp.controlImplementations[1].presenceOnly = true; f.proofGaps = { generatedAt: '2026-10-27T00:00:00.000Z', rowCount: n };
  ({ checks } = await collect(f));
  assert.equal(checks.V57.pass, false); assert.match(checks.V57.detail, /\(\+\d+\); 4 policy-reconciliation rows excluded/);
  // First run: passes and names the exclusion.
  ({ checks } = await collect(withRecon(baseline(), s1Recon())));
  assert.equal(checks.V57.pass, true); assert.match(checks.V57.detail, /first run .*; 4 policy-reconciliation rows excluded/);
});

// PH-11 Q2 (founder 2026-11-01): a manual-gate read that came back NOT_SAT is a GAPS row (control, gate id, the read's reason);
// a SAT gate read and a NOT_SAT read outside a gate are not; V57 gives the new rows a disclosed allowance only while the
// archived GAPS predates them (no manualGateReadRows field).
test('GAPS (PH-11 Q2): manual-gate NOT_SAT reads become manual-gate-read rows; V57 allowance while the archive predates them', async () => {
  const readRec = (eid, cid, verdict, gate = true) => ({ complianceVerdict: verdict, outcome: verdict === 'SAT' ? 'already_compliant' : 'failed_no_remediation',
    outcomeRationale: 'Evidence command failed: Invoke-StacksimResolve : The remote server returned an error: (404) Not Found.',
    failureDiagnostics: { rootCause: 'resource_missing', httpStatus: 404 }, registryEntry: { entry_id: eid, control_ids: [cid] },
    metadata: { controlIds: [cid], ...(gate ? { gateContext: 'manual_gate' } : {}) } });
  const withReads = (suffix) => {
    const f = baseline();
    f.tasks.push({ task: 'manual-IR.L2-3.6.3', name: 'manual-gate.json', rec: { complianceVerdict: 'PROVISIONAL', metadata: { controlIds: ['IR.L2-3.6.3'], gateAction: 'none' } } });
    f.tasks.push({ task: 'manual-IR.L2-3.6.3', name: path.join('incident_response', 'ir.l2-3.6.3.attack-sim.json'), rec: readRec('IR.L2-3.6.3.attack-sim', 'IR.L2-3.6.3', 'NOT_SAT') });
    f.tasks.push({ task: 'manual-RA.L2-3.11.1', name: path.join('risk_assessment', 'ra.l2-3.11.1.secure-score.json'), rec: readRec('RA.L2-3.11.1.secure-score', 'RA.L2-3.11.1', 'SAT') });
    f.tasks.push({ task: `step_task_MP.L2-3.8.8_${suffix}`, name: path.join('media_protection', 'mp.l2-3.8.8.x.json'), rec: readRec('MP.L2-3.8.8.x', 'MP.L2-3.8.8', 'NOT_SAT', false) });
    return f;
  };
  const gapsOf = (f) => { const { inp, sc } = run(f); return buildGaps(inp, sc); };
  const a = gapsOf(withReads('aaaa_1111')), b = gapsOf(withReads('bbbb_2222'));
  const gr = (g) => g.rows.filter((r) => r.source === 'manual-gate-read');
  assert.equal(gr(a).length, 1);
  const r = gr(a)[0];
  assert.deepEqual([r.control, r.item, r.task, r.module, r.owner], ['IR.L2-3.6.3', 'manual-IR.L2-3.6.3: IR.L2-3.6.3.attack-sim', 'manual-IR.L2-3.6.3', 'Stamper', 'BHD']);
  assert.match(r.have, /^NOT_SAT \(failed_no_remediation\); root cause resource_missing; HTTP 404; Evidence command failed: .*\(404\) Not Found\.$/);
  assert.equal(r.id, gapId('manual-gate-read', 'IR.L2-3.6.3', 'manual-IR.L2-3.6.3', 'IR.L2-3.6.3.attack-sim'));
  assert.deepEqual(gr(a).map((x) => x.id), gr(b).map((x) => x.id));
  assert.equal(a.manualGateReadRows, 1);
  assert.equal(a.rows.filter((x) => x.source === 'manual-gate').length, 1, 'the gate itself keeps its own manual-gate row');
  assert.match(renderGapsMd(a), /## Manual-gate reads that came back NOT_SAT .* \(1\)/);
  assert.equal(gapsOf(baseline()).manualGateReadRows, 0);
  // V57: archive without the field -> the new row is left out and named; archive with it -> counted.
  const collect = async (f) => {
    const m = materialise(f); const checks = [];
    const check = (id, title, fn) => { const x = fn(); checks.push({ id, pass: !!x.pass, detail: x.detail }); };
    await registerW4Checks(check, { root: m.root, slug: m.slug, out: m.out, pkgDir: m.pkg });
    return Object.fromEntries(checks.map((c) => [c.id, c]));
  };
  const n = a.rowCount - 1;
  let f = withReads('aaaa_1111'); f.proofGaps = { generatedAt: '2026-10-27T00:00:00.000Z', rowCount: n, bySource: {} };
  let c = await collect(f);
  assert.equal(c.V57.pass, true, c.V57.detail);
  assert.match(c.V57.detail, new RegExp(`^${n} rows now vs ${n} in nb-run1 \\(\\+0\\); .*; allowance: 1 manual-gate-read rows left out \\(new source, founder Q2 2026-11-01; nb-run1 predates it\\)$`));
  f = withReads('aaaa_1111'); f.proofGaps = { generatedAt: '2026-10-27T00:00:00.000Z', rowCount: n, bySource: {}, manualGateReadRows: 0 };
  c = await collect(f);
  assert.equal(c.V57.pass, false); assert.match(c.V57.detail, new RegExp(`^${n + 1} rows now vs ${n} in nb-run1 \\(\\+1\\)`)); assert.doesNotMatch(c.V57.detail, /allowance/);
});
