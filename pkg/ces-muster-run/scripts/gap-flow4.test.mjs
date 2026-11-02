// Gap closure FLOW-4 tests (GAP-CLOSURE-PLAN.md §4 G-FLOW; §5 V85): node --test scripts/gap-flow4.test.mjs
// The V85 judge over synthetic store records (the shapes ces-eo's collector C11 writes), and the verify.mjs wiring by text.
// Nothing in the workspace is read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV85, V85_SOURCE, v85RowsOfRun, judgeV85Tenant } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H = (c) => c.repeat(64);

const files = [{ relPath: 'access_control/a.json', sha256: H('a') }, { relPath: 'audit_accountability/b.json', sha256: H('b') }];
const fileRec = (relPath, sha) => ({ endpoint: 'stamper_evidence/file', status: 'success', payload: { kind: 'file', id: `file:${relPath}@${sha}`, relPath, fileSha256: sha } });
const indexRec = (ids) => ({ endpoint: 'stamper_evidence/index', status: 'success', payload: { kind: 'index', id: 'index:t', fileIds: ids, rowIds: [] } });
const rowRec = (rowId, sha) => ({ endpoint: 'stamper_evidence/row', status: 'success', payload: { kind: 'row', id: `row:${rowId}`, rowId, metaSha256: sha } });
const good = () => [fileRec(files[0].relPath, H('a')), fileRec(files[1].relPath, H('b')), indexRec(files.map((f) => `file:${f.relPath}@${f.sha256}`))];
const statuses = { 'AC.L1-3.1.1': 'implemented', 'AU.L2-3.3.1': 'not_implemented' };
const base = (over = {}) => ({ storePresent: true, records: good(), files, rows: [], statusBy: statuses, baselineBy: { ...statuses }, ...over });

test('V85 passes when every file and row is chained with the same hash, the last index equals the disk and statuses equal the baseline', () => {
  const r = judgeV85(base({ records: [...good(), rowRec('p1:t1:a1#1', H('c'))], rows: [{ id: 'p1:t1:a1#1', sha256_hash: H('c') }], otherTenantRows: 2 }));
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /2 evidence file\(s\) on disk all in the chain/);
  assert.match(r.detail, /1 stamper_evidence_metadata row\(s\) in the chain with the same hash; 2 row\(s\) under other tenant ids/);
  assert.match(r.detail, /2 control statuses = baseline/);
  assert.equal(V85_SOURCE, 'collect.stamperEvidence');
});

test('V85 fails without a store or without C11 records (FLOW-4 not built)', () => {
  assert.match(judgeV85(base({ storePresent: false })).detail, /no EO evidence store/);
  const r = judgeV85(base({ records: [] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /collect\.stamperEvidence records/);
});

test('V85 fails when a file on disk was rewritten after it was chained, or the last index misses it', () => {
  const changed = judgeV85(base({ files: [files[0], { ...files[1], sha256: H('d') }] }));
  assert.equal(changed.pass, false);
  assert.match(changed.detail, /1 evidence file\(s\) not in the chain with the same sha256: audit_accountability\/b\.json/);
  assert.match(changed.detail, /last index differs from the files on disk: 1 absent, 1 extra/);
});

test('V85 fails on an index id with no file record, a row hash mismatch, and a status moved from the baseline', () => {
  const recs = [...good(), indexRec([...files.map((f) => `file:${f.relPath}@${f.sha256}`), `file:x.json@${H('e')}`])];
  const r = judgeV85(base({ records: recs, files: [...files, { relPath: 'x.json', sha256: H('e') }] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /indexed file id\(s\) without a file record/);
  const rows = judgeV85(base({ records: [...good(), rowRec('p1:t1:a1#1', H('c'))], rows: [{ id: 'p1:t1:a1#1', sha256_hash: H('f') }, { id: 'p1:t1:a1#2', sha256_hash: H('c') }] }));
  assert.match(rows.detail, /2 stamper_evidence_metadata row\(s\) not in the chain with the same hash/);
  const moved = judgeV85(base({ statusBy: { ...statuses, 'AU.L2-3.3.1': 'implemented' } }));
  assert.equal(moved.pass, false);
  assert.match(moved.detail, /AU\.L2-3\.3\.1 not_implemented->implemented/);
});

test('V85 reports, not fails, an unread ces.db and a baseline without per-control statuses', () => {
  const r = judgeV85(base({ rows: null, rowsError: 'no store tenant id', baselineBy: null }));
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /ces\.db rows not read \(no store tenant id\)/);
  assert.match(r.detail, /statuses not asserted/);
});

test('verify.mjs wires V85 to the judge over the store, the tenant evidence folder and ces.db', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  // FIN-19: V85 also runs the FLOW-4 tenant-id clause, so the judge call sits inside a multi-line check body.
  assert.match(src, /check\('V85', [^\n]*\n[^\n]*gapmod\.judgeV85\(v85\);\n[^\n]*gapmod\.judgeV85Tenant\(v85\)/);
  assert.match(src, /r\.sourceId === gapmod\.V85_SOURCE/);
  assert.match(src, /'pl', 'Stamper', 'plan-data', slug, 'evidence'/);
  assert.match(src, /collection = 'stamper_evidence_metadata'/);
  assert.ok(src.indexOf("check('V85'") < src.indexOf('const result = { pass'), 'V85 is registered before the result is written');
});

test('PH-11 (LOG-PH11-EO.md §6): V85 judges only this round\'s stamper_evidence_metadata rows under EO\'s tenant id', () => {
  const row = (id, tenant_id, created_at, h = 'a') => ({ id, tenant_id, created_at, data: JSON.stringify({ sha256_hash: h.repeat(64) }) });
  const E1 = Date.parse('2026-11-01T14:07:00.250Z');
  const all = [row('old-1', 'eo-tid', '2026-11-01T11:05:00.000Z'), row('new-1', 'eo-tid', '2026-11-01T14:09:12.000Z', 'b'), row('new-2', 'eo-tid', '2026-11-01T14:07:00.250Z', 'c'), row('other', 'zero-tid', '2026-11-01T14:09:00.000Z')];
  const r = v85RowsOfRun(all, 'eo-tid', E1);
  assert.deepEqual(r.rows.map((x) => x.id), ['new-1', 'new-2']);
  assert.equal(r.rows[0].sha256_hash, 'b'.repeat(64));
  assert.deepEqual([r.otherTenantRows, r.earlierRoundRows], [1, 1]);
  // No E1 start: every row under EO's id is judged (the old behaviour).
  const n = v85RowsOfRun(all, 'eo-tid', NaN);
  assert.deepEqual([n.rows.length, n.earlierRoundRows, n.otherTenantRows], [3, 0, 1]);
  // Only earlier-round rows under EO's id: the tenant-id clause still sees this round's (none) vs other ids.
  const h = v85RowsOfRun([row('old-1', 'eo-tid', '2026-11-01T11:05:00.000Z'), row('other', 'zero-tid', '2026-11-01T14:09:00.000Z')], 'eo-tid', E1);
  assert.equal(judgeV85Tenant(h).pass, false);
});
