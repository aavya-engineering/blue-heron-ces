// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * CC-1 / CC-2 tests — catalog discovery, check, run index, backfill.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildCatalog, loadMetaOverlay, saveMetaOverlay, COMMAND_NAMES } from '../src/catalog/discover.js';
import { catalogCheck } from '../src/catalog/check.js';
import {
  readRunIndex,
  appendRunRecord,
  updateRunRecord,
  backfillRunIndex,
  statusFromExit,
} from '../src/catalog/run-index.js';
import type { RunRecord, MetaOverlay } from '../src/catalog/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CC-1: Catalog discovery
// ---------------------------------------------------------------------------

describe('buildCatalog (real project root)', () => {
  const projectRoot = path.resolve(import.meta.dirname, '..');

  it('discovers scenarios, decks, acts, and pipelines', async () => {
    const catalog = await buildCatalog({ projectRoot, includeRetired: true });
    expect(catalog.length).toBeGreaterThan(20);

    const kinds = new Set(catalog.map((r) => r.kind));
    expect(kinds).toContain('scenario');
    expect(kinds).toContain('deck');
    expect(kinds).toContain('act');
    expect(kinds).toContain('pipeline');
  });

  it('gives every runnable a non-empty summary and at least one mode', async () => {
    const catalog = await buildCatalog({ projectRoot, includeRetired: true });
    for (const r of catalog) {
      expect(r.summary, `${r.id} missing summary`).toBeTruthy();
      expect(r.modes.length, `${r.id} has no modes`).toBeGreaterThan(0);
    }
  });

  it('each mode argv starts with a known command', async () => {
    const catalog = await buildCatalog({ projectRoot, includeRetired: true });
    for (const r of catalog) {
      for (const m of r.modes) {
        expect(
          COMMAND_NAMES.includes(m.argv[0]),
          `${r.id} mode ${m.mode} argv[0]="${m.argv[0]}" is not a known command`,
        ).toBe(true);
      }
    }
  });

  it('filters by kind', async () => {
    const decks = await buildCatalog({ projectRoot, kind: 'deck' });
    expect(decks.every((r) => r.kind === 'deck')).toBe(true);
    expect(decks.length).toBeGreaterThan(0);
  });

  it('discovers eval configs as scenarios', async () => {
    const scenarios = await buildCatalog({ projectRoot, kind: 'scenario' });
    const evalOnes = scenarios.filter((r) => r.id.includes('eval/'));
    expect(evalOnes.length).toBeGreaterThan(0);
    // Eval scenarios run via demo:eval, not run-scenario
    for (const e of evalOnes) {
      expect(e.modes[0].argv[0]).toBe('demo:eval');
    }
  });

  it('deck->act cross-links work', async () => {
    const catalog = await buildCatalog({ projectRoot, includeRetired: true });
    const decksWithActs = catalog.filter((r) => r.kind === 'deck' && r.usesActs.length > 0);
    // At least one deck should use acts
    expect(decksWithActs.length).toBeGreaterThan(0);

    // Reverse: acts with presentedInDecks
    const actsInDecks = catalog.filter((r) => r.kind === 'act' && r.presentedInDecks.length > 0);
    expect(actsInDecks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CC-1: Meta overlay
// ---------------------------------------------------------------------------

describe('meta overlay', () => {
  it('loads and saves', async () => {
    await fs.mkdir(path.join(tmpDir, 'catalog'), { recursive: true });
    const meta: MetaOverlay = {
      'scenario:test': { title: 'My Test', summary: 'A test', tags: ['fast'] },
    };
    await saveMetaOverlay(tmpDir, meta);
    const loaded = await loadMetaOverlay(tmpDir);
    expect(loaded['scenario:test']?.title).toBe('My Test');
  });

  it('returns empty when file is missing', async () => {
    const loaded = await loadMetaOverlay(tmpDir);
    expect(Object.keys(loaded)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CC-1: catalog:check
// ---------------------------------------------------------------------------

describe('catalogCheck', () => {
  it('reports no errors on the real project', async () => {
    const projectRoot = path.resolve(import.meta.dirname, '..');
    const result = await catalogCheck(projectRoot);
    // We may have warnings (acts with no test) but no errors
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CC-2: Run index
// ---------------------------------------------------------------------------

describe('run index', () => {
  it('append and read', async () => {
    const record: RunRecord = {
      runId: 'test-1',
      runnableId: 'scenario:test',
      mode: 'test',
      argv: ['run-scenario', 'scenarios/test.json'],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      exitCode: 0,
      status: 'pass',
      launchedBy: 'cli',
    };
    await appendRunRecord(tmpDir, record);
    const records = await readRunIndex(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0].runId).toBe('test-1');
    expect(records[0].status).toBe('pass');
  });

  it('crash-safe: truncated last line is skipped', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const indexPath = path.join(tmpDir, 'index.jsonl');
    const valid = JSON.stringify({ runId: 'r1', runnableId: 'x', mode: 'test', argv: [], startedAt: '', status: 'pass', launchedBy: 'cli' });
    await fs.writeFile(indexPath, valid + '\n{"runId":"r2","trun', 'utf8');
    const records = await readRunIndex(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0].runId).toBe('r1');
  });

  it('update replaces a record', async () => {
    const record: RunRecord = {
      runId: 'u-1',
      runnableId: 'scenario:x',
      mode: 'test',
      argv: [],
      startedAt: new Date().toISOString(),
      status: 'running',
      launchedBy: 'center',
    };
    await appendRunRecord(tmpDir, record);
    await updateRunRecord(tmpDir, 'u-1', { status: 'pass', endedAt: new Date().toISOString() });
    const records = await readRunIndex(tmpDir);
    expect(records[0].status).toBe('pass');
    expect(records[0].endedAt).toBeTruthy();
  });

  it('statusFromExit maps correctly', () => {
    expect(statusFromExit(0)).toBe('pass');
    expect(statusFromExit(1)).toBe('fail');
    expect(statusFromExit(2)).toBe('unknown');
    expect(statusFromExit(null)).toBe('unknown');
    expect(statusFromExit(undefined)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// CC-2: Backfill
// ---------------------------------------------------------------------------

describe('backfill', () => {
  it('imports a run dir with summary.json', async () => {
    const runDir = path.join(tmpDir, 'my-run');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, 'summary.json'),
      JSON.stringify({
        run_id: 'my-run',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T00:01:00Z',
        scenarios: [],
        totals: { total: 1, pass: 1, fail: 0, crash: 0 },
      }),
    );

    const result = await backfillRunIndex(tmpDir);
    expect(result.imported).toBe(1);

    const records = await readRunIndex(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0].runId).toBe('my-run');
    expect(records[0].status).toBe('pass');
  });

  it('is idempotent', async () => {
    const runDir = path.join(tmpDir, 'idempotent-run');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, 'summary.json'),
      JSON.stringify({
        run_id: 'idempotent-run',
        started_at: '2026-01-01T00:00:00Z',
        totals: { total: 0, pass: 0, fail: 0, crash: 0 },
      }),
    );

    await backfillRunIndex(tmpDir);
    const result2 = await backfillRunIndex(tmpDir);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);

    const records = await readRunIndex(tmpDir);
    expect(records).toHaveLength(1);
  });

  it('status is never pass without a parsed passing result', async () => {
    // A run dir with no summary.json and no result.json
    const runDir = path.join(tmpDir, 'no-result');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'some-file.txt'), 'hello');

    await backfillRunIndex(tmpDir);
    const records = await readRunIndex(tmpDir);
    const rec = records.find((r) => r.runId === 'no-result');
    expect(rec).toBeTruthy();
    expect(rec!.status).toBe('unknown');
  });
});
