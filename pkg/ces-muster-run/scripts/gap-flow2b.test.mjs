// Gap closure FLOW-2b tests (GAP-CLOSURE-PLAN.md §4 G-FLOW; §5 V83): node --test scripts/gap-flow2b.test.mjs
// collectV83 + judgeV83 over a temp ces.db built with the workspace's ces-shared dist CesRepository and temp evidence files,
// and the verify.mjs wiring by text. Nothing in the workspace's pl/ or out/ is read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectV83, judgeV83, V83_COLLECTION } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_JS = path.resolve(HERE, '..', '..', '..', 'ces', 'ces-shared', 'dist', 'persistence', 'CesRepository.js');
const repoMod = await import(pathToFileURL(REPO_JS).href);
const WORM = [V83_COLLECTION, 'stamper_change_log'];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// A temp workspace: plan-data/<slug>/evidence/a.json, evidence-by-task/t1/a.json, and a ces.db with one row per file write.
function fixture({ rowsFor = ['evidence/a.json', 'evidence-by-task/t1/a.json'], retry = false, tamperHash = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-flow2b-'));
  const planData = path.join(dir, 'pl', 'Stamper', 'plan-data', 'sim-x');
  const dbFile = path.join(dir, 'pl', 'ces.db');
  const repo = new repoMod.CesRepository(dbFile, { wormCollections: WORM });
  const write = (rel, text, attempt) => {
    const f = path.join(planData, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    if (!rowsFor.includes(rel)) return;
    repo.put(V83_COLLECTION, {
      id: `plan-1:t1:${rel}#${attempt}`, ces: { tenantId: '00000000-0000-0000-0000-000000000000' },
      data: { relative_path: rel, storage_location: f, sha256_hash: rel === tamperHash ? 'f'.repeat(64) : sha(Buffer.from(text)), collected_at: new Date(Date.now() + attempt).toISOString(), attempt, task_id: 't1', control_ids: ['AC.L2-3.1.1'] },
    });
  };
  for (const rel of ['evidence/a.json', 'evidence-by-task/t1/a.json']) {
    write(rel, `{"v":1,"rel":"${rel}"}`, 1);
    if (retry) write(rel, `{"v":2,"rel":"${rel}"}`, 2);
  }
  repo.close();
  const files = ['evidence/a.json', 'evidence-by-task/t1/a.json'].map((rel) => {
    const f = path.join(planData, ...rel.split('/'));
    return { relPath: rel, sha256: sha(fs.readFileSync(f)), mtimeMs: fs.statSync(f).mtimeMs };
  });
  return { dir, planData, dbFile, files };
}

const run = async (fx, mod = repoMod) => {
  try {
    const collected = await collectV83({ dbFile: fx.dbFile, planDataDir: fx.planData, repoMod: mod, tmpRoot: os.tmpdir() });
    return judgeV83({ collected, files: fx.files, runStartMs: NaN });
  } finally { fs.rmSync(fx.dir, { recursive: true, force: true }); }
};

test('V83 passes when every file has a row with its hash, and a retry\'s #2 row (not #1) must match', async () => {
  const r = await run(fixture());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /2 evidence file\(s\) of this run each match their latest stamper_evidence_metadata row \(2 row\(s\)/);
  const retried = await run(fixture({ retry: true }));
  assert.equal(retried.pass, true, retried.detail);
  assert.match(retried.detail, /\(4 row\(s\) for the tenant/);
});

test('V83 fails when a file has no row, or the latest row\'s hash differs from the file', async () => {
  const noRow = await run(fixture({ rowsFor: ['evidence/a.json'] }));
  assert.equal(noRow.pass, false);
  assert.match(noRow.detail, /1 of 2 evidence file\(s\) have no stamper_evidence_metadata row: evidence-by-task\/t1\/a\.json/);
  const bad = await run(fixture({ tamperHash: 'evidence/a.json' }));
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /1 file\(s\) differ from their latest row's sha256: evidence\/a\.json/);
});

test('V83 fails when the overwrite probe is not refused (ces-shared dist without the FLOW-2 WORM list)', async () => {
  const staleMod = { CesRepository: class extends repoMod.CesRepository { constructor(p) { super(p, { wormCollections: [] }); } } };
  const r = await run(fixture(), staleMod);
  assert.equal(r.pass, false);
  assert.match(r.detail, /overwrite probe on the ces\.db copy NOT refused for put, update, delete/);
});

test('V83 probe runs on a copy: the live ces.db row is unchanged; no ces.db is an error', async () => {
  const fx = fixture();
  const before = fs.readFileSync(fx.dbFile);
  const collected = await collectV83({ dbFile: fx.dbFile, planDataDir: fx.planData, repoMod, tmpRoot: os.tmpdir() });
  assert.equal(collected.probe.put && collected.probe.update && collected.probe.delete && collected.probe.intact, true);
  assert.deepEqual(fs.readFileSync(fx.dbFile), before);
  fs.rmSync(fx.dir, { recursive: true, force: true });
  const none = await collectV83({ dbFile: path.join(os.tmpdir(), 'no-such-dir-v83', 'ces.db'), planDataDir: '.', repoMod, tmpRoot: os.tmpdir() });
  assert.match(judgeV83({ collected: none, files: [] }).detail, /Stamper never wrote a WORM record/);
});

test('verify.mjs wires V83 to collectV83 / judgeV83 over plan-data evidence and evidence-by-task', () => {
  const text = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.match(text, /gapmod\.collectV83\(\{ dbFile: path\.join\(root, 'pl', 'ces\.db'\)/);
  assert.match(text, /\['evidence', 'evidence-by-task'\]/);
  assert.match(text, /check\('V83', [^\n]*gapmod\.judgeV83\(v83\)\);/);
});
