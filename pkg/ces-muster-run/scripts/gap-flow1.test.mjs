// Gap closure FLOW-1 tests (GAP-CLOSURE-PLAN.md §4 G-FLOW; §5 V82): node --test scripts/gap-flow1.test.mjs
// judgeV82 over synthetic fixtures; collectV82 against a temp ces.db written with ces-shared's built CesRepository
// (skipped when ces-shared dist is not built). Everything is written under the OS temp folder; the workspace is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { judgeV82, collectV82, V82_COLLECTIONS } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_JS = path.resolve(HERE, '..', '..', '..', 'ces', 'ces-shared', 'dist', 'persistence', 'CesRepository.js');

const START = Date.parse('2026-10-30T12:00:00.000Z');
const pushed = ['manual-mission-plan-s1-2026.json', 'tenant-manifest-s1-2026.json'];
const fileSha = { [pushed[0]]: 'a'.repeat(64), [pushed[1]]: 'b'.repeat(64) };
const pushRow = (over = {}) => ({ id: `s1:${pushed[0]}`, data: { event: 'plan_push', at: '2026-10-30T12:05:00.000Z', files: pushed.map((name) => ({ name, sha256: fileSha[name] })), ...over } });
const discRow = (over = {}) => ({ id: 's1:2026-10-30T12:01:00.000Z:cccccccccccc', data: { event: 'discovery', at: '2026-10-30T12:01:00.000Z', result_sha256: 'c'.repeat(64), ...over } });
const probe = (over = {}) => ({ collection: V82_COLLECTIONS.push, id: `s1:${pushed[0]}`, put: true, update: true, delete: true, intact: true, ...over });
const input = (over = {}) => ({
  slug: 's1', collected: { pushRows: [pushRow()], discoveryRows: [discRow()], probe: probe() },
  pushResponse: { pushed }, fileSha, discoverySha: 'c'.repeat(64), runStartMs: START, e4Mode: 'api', ...over,
});

test('V82 passes when both rows match this run and the probe was refused three ways', () => {
  const r = judgeV82(input());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /holds 2 file hash\(es\) equal to the pushed files/);
});

test('V82 fails when a pushed file changed after the push', () => {
  const r = judgeV82(input({ fileSha: { ...fileSha, [pushed[1]]: 'd'.repeat(64) } }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /1 pushed file hash\(es\) differ/);
});

test('V82 fails when no push row lists this run\'s files (fallback push)', () => {
  const r = judgeV82(input({ collected: { pushRows: [], discoveryRows: [discRow()], probe: probe() }, e4Mode: 'fallback' }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /no muster_plan_push row/);
  assert.match(judgeV82(input({ pushResponse: null, e4Mode: 'fallback' })).detail, /E4 mode fallback/);
});

test('V82 fails on rows from an earlier run (written before the run start)', () => {
  const old = '2026-10-29T09:00:00.000Z';
  const r = judgeV82(input({ collected: { pushRows: [pushRow({ at: old })], discoveryRows: [discRow({ at: old })], probe: probe() } }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /before this run's start/);
  assert.match(r.detail, /no muster_discovery row of this run/);
});

test('V82 fails when the discovery hash differs or the probe was not refused', () => {
  assert.match(judgeV82(input({ discoverySha: 'e'.repeat(64) })).detail, /no muster_discovery row of this run has/);
  const r = judgeV82(input({ collected: { pushRows: [pushRow()], discoveryRows: [discRow()], probe: probe({ put: false, intact: false }) } }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /NOT refused for put/);
  assert.match(r.detail, /changed on the copy/);
});

test('V82 reports a missing ces.db', async () => {
  const c = await collectV82({ dbFile: path.join(os.tmpdir(), 'no-such-dir-v82', 'ces.db'), slug: 's1', repoMod: null, tmpRoot: os.tmpdir() });
  assert.match(judgeV82(input({ collected: c })).detail, /muster-api never wrote a WORM record/);
});

test('collectV82 reads a ces.db copy, refuses the overwrite probe there and leaves the original untouched', { skip: !fs.existsSync(REPO_JS) && 'ces-shared dist not built' }, async () => {
  const repoMod = await import(pathToFileURL(REPO_JS).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-flow1-'));
  try {
    const dbFile = path.join(dir, 'ces.db');
    const repo = new repoMod.CesRepository(dbFile);
    repo.put(V82_COLLECTIONS.push, { id: `s1:${pushed[0]}`, ces: { tenantSlug: 's1' }, data: pushRow().data });
    repo.put(V82_COLLECTIONS.discovery, { id: discRow().id, ces: { tenantSlug: 's1' }, data: discRow().data });
    repo.put(V82_COLLECTIONS.push, { id: 'other:x', ces: { tenantSlug: 'other' }, data: { files: [] } });
    repo.close();
    const before = fs.readFileSync(dbFile);
    const c = await collectV82({ dbFile, slug: 's1', repoMod, tmpRoot: dir });
    assert.equal(c.pushRows.length, 1);
    assert.equal(c.discoveryRows.length, 1);
    assert.deepEqual(c.probe, { collection: V82_COLLECTIONS.push, id: `s1:${pushed[0]}`, put: true, update: true, delete: true, intact: true });
    assert.equal(judgeV82(input({ collected: c })).pass, true);
    assert.deepEqual(fs.readFileSync(dbFile), before);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('v82-')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify.mjs wires V82 through collectV82 and judgeV82', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.match(src, /gapmod\.collectV82\(\{ dbFile: path\.join\(root, 'pl', 'ces\.db'\)/);
  assert.match(src, /check\('V82', [^\n]*gapmod\.judgeV82\(v82\)\)/);
});
