// Gap closure PKG-3 tests (GAP-CLOSURE-PLAN.md §4 G-PKG; §5 V79, V90 index part): node --test scripts/gap-pkg3.test.mjs
// The V79 judge and V90's index part over synthetic extracted packages; the bundle.mjs and verify.mjs wiring by text
// (bundle.mjs stays CRLF, verify.mjs LF). Nothing in the workspace is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV79, judgeV90, V79_POLICIES_PENDING, V90_DEFERRED } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// A synthetic extracted package: { files: rel -> sha256, integrity, index, chain }.
function pkg({ policies = 0, stamper = ['AU/a.json', 'AC/b.json'], personnel = ['personnel/README.md'] } = {}) {
  const files = {};
  if (policies === 0) files['policies/README.md'] = sha('no policies');
  for (let i = 0; i < policies; i++) files[`policies/AC/p${i}.md`] = sha(`p${i}`);
  for (const p of personnel) files[p] = sha(p);
  for (const s of stamper) files[`stamper-evidence/${s}`] = sha(s);
  if (stamper.length) files['stamper-evidence/chain.json'] = sha('chain');
  else files['stamper-evidence/README.md'] = sha('none');
  const index = { schema: 'ces-eo/evidence-index@1', objectiveRows: [
    { objectiveId: 'AU.L2-3.3.1[c]', controlId: 'AU.L2-3.3.1', controlStatus: 'met', files: stamper.length ? [{ file: `stamper-evidence/${stamper[0]}`, sha256: sha(stamper[0]) }] : [] },
    { objectiveId: 'AC.L1-3.1.1[a]', controlId: 'AC.L1-3.1.1', controlStatus: 'met', files: [] },
  ] };
  files['evidence-index.json'] = sha('index');
  files['cover-sheet.json'] = sha('cover');
  const integrity = { files: Object.entries(files).map(([file, sha256]) => ({ file, sha256 })) };
  files['integrity-manifest.json'] = sha('manifest');
  const chain = stamper.map((s) => ({ relPath: s, fileSha256: sha(s) }));
  return { pkgName: 'evidence-package-2026-10-30T12-00-00', files, integrity, index, chain };
}

test('V79 passes on a complete package; since FLOW-3 an empty policy store fails under -Harness tester and is a note under -Harness mx', () => {
  const failed = judgeV79({ ...pkg(), pushedPolicyCount: 22 });
  assert.equal(failed.pass, false);
  assert.match(failed.detail, /\(a\) EO's policy store is empty \(policies\/README\.md only\) but the pushed policy-set manifest lists 22: the E7 intake \(FLOW-3\) did not deliver them/);
  const r = judgeV79({ ...pkg(), pushedPolicyCount: 22, harness: 'mx' });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, new RegExp(`\\(a\\) ${V79_POLICIES_PENDING.replace(/[()]/g, '\\$&')}: EO's policy store is empty .*pushed policy envelopes 22 \\(-Harness mx: no EO intake call\\)`));
  assert.match(r.detail, /\(c\) stamper-evidence\/ 2 = EO's Stamper chain 2, hashes equal/);
  assert.match(r.detail, /\(d\) evidence-index\.json: 2 objective rows, 1 citations of 1 files, all resolve/);
  assert.equal(V79_POLICIES_PENDING, 'policies not yet delivered (FLOW-3)');
});

test('V79 counts policies against the pushed policy-set manifest once they arrive', () => {
  assert.equal(judgeV79({ ...pkg({ policies: 22 }), pushedPolicyCount: 22 }).pass, true);
  const r = judgeV79({ ...pkg({ policies: 21 }), pushedPolicyCount: 22 });
  assert.equal(r.pass, false);
  assert.match(r.detail, /\(a\) policies\/ holds 21 policy file\(s\), the pushed policy-set manifest 22/);
  assert.match(judgeV79({ ...pkg({ policies: 3 }), pushedPolicyCount: null }).detail, /no pushed policy-set manifest/);
});

test('V79 fails when stamper-evidence/ is not exactly EO\'s Stamper chain', () => {
  const p = pkg();
  const extra = judgeV79({ ...p, chain: p.chain.slice(0, 1), pushedPolicyCount: 22 });
  assert.equal(extra.pass, false);
  assert.match(extra.detail, /holds 2 file\(s\), EO's Stamper chain 1/);
  assert.match(extra.detail, /1 stamper-evidence file\(s\) not in the chain: stamper-evidence\/AC\/b\.json/);
  const changed = judgeV79({ ...p, chain: [p.chain[0], { relPath: 'AC/b.json', fileSha256: 'f'.repeat(64) }], pushedPolicyCount: 22 });
  assert.match(changed.detail, /differ from the chained sha256: stamper-evidence\/AC\/b\.json/);
  assert.match(judgeV79({ ...p, chain: null, pushedPolicyCount: 22 }).detail, /Stamper chain unknown/);
  // An empty chain with the README passes (c). (FLOW-3: with the 22 policies delivered, so (a) passes too.)
  assert.equal(judgeV79({ ...pkg({ stamper: [], policies: 22 }), pushedPolicyCount: 22 }).pass, true);
});

test('V79 fails on an index row that cites a file not in the zip or with another hash, and on an index without rows', () => {
  const p = pkg();
  const bad = structuredClone(p.index);
  bad.objectiveRows[1].files = [{ file: 'evidence/ec/AC.L1-3.1.1/x.csv', sha256: sha('x') }, { file: 'stamper-evidence/AC/b.json', sha256: 'e'.repeat(64) }];
  const r = judgeV79({ ...p, index: bad, pushedPolicyCount: 22 });
  assert.equal(r.pass, false);
  assert.match(r.detail, /1 index citation\(s\) to files not in the zip: AC\.L1-3\.1\.1\[a\] -> evidence\/ec\/AC\.L1-3\.1\.1\/x\.csv/);
  assert.match(r.detail, /1 index citation\(s\) with a sha256 other than the file's: AC\.L1-3\.1\.1\[a\] -> stamper-evidence\/AC\/b\.json/);
  assert.match(judgeV79({ ...p, index: { schema: 'ces-eo/evidence-index@1' }, pushedPolicyCount: 22 }).detail, /no objectiveRows \(built before GC-PKG-3\)/);
  assert.match(judgeV79({ ...p, index: null, pushedPolicyCount: 22 }).detail, /no evidence-index\.json in the package/);
});

test('V79 fails on missing folders, an integrity gap, or no package', () => {
  const p = pkg();
  const noPersonnel = pkg({ personnel: [] });
  assert.match(judgeV79({ ...noPersonnel, pushedPolicyCount: 22 }).detail, /\(b\) no personnel\/ folder/);
  const gap = { files: p.integrity.files.filter((f) => f.file !== 'stamper-evidence/AU/a.json').map((f) => (f.file === 'evidence-index.json' ? { ...f, sha256: '0'.repeat(64) } : f)) };
  const r = judgeV79({ ...p, integrity: gap, pushedPolicyCount: 22 });
  assert.equal(r.pass, false);
  assert.match(r.detail, /\(e\) 1 new file\(s\) not in the integrity manifest: stamper-evidence\/AU\/a\.json/);
  assert.match(r.detail, /\(e\) 1 integrity entr\(ies\) with a sha256 other than the file's: evidence-index\.json/);
  assert.equal(judgeV79({ pkgName: null, files: null }).pass, false);
});

test('V90 index part: deferred without an index; every met control needs a row; a missing index fails', () => {
  // Only the index part is under test: the one-practice KB fails the 110/320 counts, so pass/fail is asserted on the index problems.
  const ref = { objectives: [{ controlId: 'AC.L1-3.1.1', objectiveId: 'AC.L1-3.1.1[a]' }] };
  const approach = { practices: [{ id: 'AC.L1-3.1.1', what_assessor_does: 'x', objectives: [{ id: 'AC.L1-3.1.1[a]' }] }] };
  const matrix = { objectives: [{ id: 'AC.L1-3.1.1[a]', practice_id: 'AC.L1-3.1.1', evidence: [{ ces_source: 'interview' }] }] };
  const ssp = { controlImplementations: [
    { control_id: 'AC.L1-3.1.1', status: 'met', assessmentApproach: { objectives: [{ objectiveId: 'AC.L1-3.1.1[a]', methods: ['examine'], evidence: [{ held: 'unknown' }] }] } },
  ] };
  const base = { approach, matrix, objectivesRef: ref, ssp };
  assert.ok(judgeV90(base).detail.endsWith(V90_DEFERRED));
  const withRow = judgeV90({ ...base, index: { objectiveRows: [{ controlId: 'AC.L1-3.1.1', objectiveId: 'AC.L1-3.1.1[a]', files: [] }] } });
  assert.match(withRow.detail, /index: 1\/1 met controls have a row \(1 objective rows\)$/);
  const noRow = judgeV90({ ...base, index: { objectiveRows: [] } });
  assert.match(noRow.detail, /1 met control\(s\) without an index row: AC\.L1-3\.1\.1/);
  assert.equal(noRow.pass, false);
  const none = judgeV90({ ...base, index: null });
  assert.equal(none.pass, false);
  assert.match(none.detail, /no evidence-index\.json in the EO package/);
});

test('bundle.mjs copies EO\'s evidence-index.json from the newest extracted package and builds none of its own; stays CRLF', () => {
  const src = fs.readFileSync(path.join(HERE, 'bundle.mjs'), 'utf8');
  assert.equal(src.includes('buildEvidenceIndex'), false, 'bundle.mjs no longer builds the index');
  assert.equal(src.includes('EvidenceIndex.js'), false, 'bundle.mjs no longer imports ces-eo dist EvidenceIndex');
  assert.match(src, /const pkgIndexDir = exists\(pkgDir\) \? fs\.readdirSync\(pkgDir\)\.filter\(\(d\) => exists\(path\.join\(pkgDir, d, 'evidence-index\.json'\)\)\)\.sort\(\)\.pop\(\) : null;/);
  assert.match(src, /\[indexSrc, 'evidence-index\.json'\]/);
  const lf = (src.match(/\n/g) ?? []).length;
  assert.equal((src.match(/\r\n/g) ?? []).length, lf, 'bundle.mjs stays CRLF');
});

test('verify.mjs wires V79 once to judgeV79 and passes the package index to V90; stays LF', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.equal((src.match(/check\('V79'/g) ?? []).length, 1);
  assert.match(src, /gapmod\.judgeV79\(\{/);
  assert.match(src, /index: v90Index,/);
  assert.match(src, /r\.endpoint === 'stamper_evidence\/index'/);
  // V79(c) anchors on the index the package names (a later E8F pass appends newer indexes), falling back to the last.
  assert.match(src, /const v79ChainDoc = v79Read\('stamper-evidence\/chain\.json'\);/);
  assert.match(src, /r\.recordId === v79ChainDoc\?\.indexRecordId\)\n\s+\?\? c11\.filter\(\(r\) => r\.endpoint === 'stamper_evidence\/index'\)\.pop\(\);/);
  assert.equal(src.includes('\r'), false, 'verify.mjs stays LF');
});
