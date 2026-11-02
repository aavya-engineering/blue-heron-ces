// Gap closure KB-2 tests (GAP-CLOSURE-PLAN.md §4 G-KB; §5 V90): node --test scripts/gap-kb2.test.mjs
// The V90 judge over the built ces-shared KB data (read only, <WS>\ces\ces-shared\dist\data) and over synthetic
// fixtures; the verify.mjs wiring by text (LF kept). Nothing in the workspace is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV90, V90_DEFERRED } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', '..', '..', 'ces', 'ces-shared', 'dist', 'data');
const readData = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const haveData = fs.existsSync(path.join(DATA, 'assessor-approach.reference.json'));

// A synthetic SSP built from the reference: one control per practice, each with an approach for every objective.
const sspFrom = (ref) => {
  const by = new Map();
  for (const o of ref.objectives) by.set(o.controlId, [...(by.get(o.controlId) ?? []), o.objectiveId]);
  return { controlImplementations: [...by].map(([id, oids]) => ({
    control_id: id, status: 'met',
    assessmentApproach: { practiceId: id, summary: 's', objectives: oids.map((objectiveId) => ({ objectiveId, determination: 'd', methods: ['examine'], evidence: [{ artifactType: 'a', cesSource: 'interview', held: 'unknown' }], text: 't' })) },
  })) };
};

test('V90 on the built ces-shared KBs: 110 practices, 320 objectives, all resolve; index part deferred', { skip: !haveData && 'ces-shared dist/data not built' }, () => {
  const approach = readData('assessor-approach.reference.json');
  const matrix = readData('assessor-evidence-matrix.reference.json');
  const objectivesRef = readData('assessment-objectives.reference.json');
  const r = judgeV90({ approach, matrix, objectivesRef, ssp: sspFrom(objectivesRef) });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /110 practices, 320 objectives/);
  assert.match(r.detail, /110\/110 controls carry an approach/);
  assert.ok(r.detail.endsWith(V90_DEFERRED));
  assert.match(V90_DEFERRED, /not yet checked \(PKG-3\)/);
});

// Small synthetic reference for the failure cases.
const ref = { objectives: [
  { objectiveId: 'AC.L1-3.1.1[a]', controlId: 'AC.L1-3.1.1' },
  { objectiveId: 'AC.L1-3.1.1[b]', controlId: 'AC.L1-3.1.1' },
  { objectiveId: 'AT.L2-3.2.1[a]', controlId: 'AT.L2-3.2.1' },
] };
const approachOf = () => ({ practices: [
  { id: 'AC.L1-3.1.1', what_assessor_does: 'x', objectives: [{ id: 'AC.L1-3.1.1[a]' }, { id: 'AC.L1-3.1.1[b]' }] },
  { id: 'AT.L2-3.2.1', what_assessor_does: 'x', objectives: [{ id: 'AT.L2-3.2.1[a]' }] },
] });
const matrixOf = () => ({ objectives: ref.objectives.map((o) => ({ id: o.objectiveId, practice_id: o.controlId, evidence: [{ artifact_type: 'a', ces_source: 'interview', notes: 'n' }] })) });

test('V90 fails on a reference that is not 110 / 320 (the counts are fixed)', () => {
  const r = judgeV90({ approach: approachOf(), matrix: matrixOf(), objectivesRef: ref, ssp: sspFrom(ref) });
  assert.equal(r.pass, false);
  assert.match(r.detail, /reference has 2 practices \(want 110\)/);
  assert.match(r.detail, /reference has 3 objectives \(want 320\)/);
});

test('V90 names a missing practice, an unresolved objective, an empty evidence list and a missing SSP approach', () => {
  const approach = approachOf(); approach.practices.pop();
  const matrix = matrixOf(); matrix.objectives[0].id = 'AC.L1-3.1.1[z]'; matrix.objectives[1].evidence = [];
  const ssp = sspFrom(ref); delete ssp.controlImplementations[1].assessmentApproach;
  const r = judgeV90({ approach, matrix, objectivesRef: ref, ssp });
  assert.equal(r.pass, false);
  assert.match(r.detail, /assessor-approach lacks 1 practice\(s\): AT\.L2-3\.2\.1/);
  assert.match(r.detail, /1 matrix objective\(s\) do not resolve: AC\.L1-3\.1\.1\[z\]/);
  assert.match(r.detail, /assessor-evidence-matrix lacks 1 objective\(s\): AC\.L1-3\.1\.1\[a\]/);
  assert.match(r.detail, /1 matrix objective\(s\) have no evidence row: AC\.L1-3\.1\.1\[b\]/);
  assert.match(r.detail, /1 SSP control\(s\) have no assessment approach: AT\.L2-3\.2\.1/);
});

test('V90 fails without the SSP or the KB data, and says which', () => {
  assert.match(judgeV90({ approach: approachOf(), matrix: matrixOf(), objectivesRef: ref, ssp: null }).detail, /no SSP JSON/);
  const r = judgeV90({ approach: null, matrix: matrixOf(), objectivesRef: ref, ssp: sspFrom(ref) });
  assert.equal(r.pass, false);
  assert.match(r.detail, /missing ces-shared dist data: assessor-approach/);
});

test('verify.mjs wires V90 once to judgeV90 over the dist data and out/ssp.json, and stays LF', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.equal((src.match(/check\('V90'/g) ?? []).length, 1);
  assert.match(src, /gapmod\.judgeV90\(\{/);
  for (const f of ['assessor-approach.reference.json', 'assessor-evidence-matrix.reference.json', 'assessment-objectives.reference.json']) assert.ok(src.includes(`kbData('${f}')`), f);
  assert.equal(src.includes('\r'), false, 'verify.mjs stays LF');
});
