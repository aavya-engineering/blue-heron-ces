// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// M3 acceptance: the index pass reads Stamper results + evidence READ-ONLY, ledgers
// SHA-256s, and flags HASH_DRIFT / STALE / UNPARSEABLE / EMPTY_READ. An empty pass is
// status 'empty' + a finding, never success.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EcFindingSchema, EcLedgerEntrySchema, EcRunSchema } from 'ces-shared/types/evidence-collector';

import { runIndexPass } from '../src/indexPass.js';
import { listFindings, listRuns, loadLedgerState } from '../src/store.js';
import {
  SECRET,
  auth,
  ecTenantDir,
  ingestBody,
  makeSandbox,
  registerTenant,
  seedStamper,
  startApp,
  type Sandbox,
} from './helpers.js';

const SLUG = 'ec-sim-a';
// Fixture "now": 2026-09-28. valid manifest completedAt 2026-09-20 (fresh);
// legacy manifest 2026-08-29 (fresh at 90d, stale at 20d).
const NOW = new Date('2026-09-28T12:00:00.000Z');
const clock = () => NOW;

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox();
  registerTenant(sb, SLUG, 'sim');
});
afterEach(() => sb.restore());

function sha(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs)] = `${sha(abs)}|${fs.statSync(abs).mtimeMs}|${fs.statSync(abs).size}`;
    }
  };
  walk(dir);
  return out;
}

function fresh(file: string): void {
  // pin mtime inside the freshness window relative to NOW
  const t = new Date(NOW.getTime() - 2 * 24 * 3600 * 1000);
  fs.utimesSync(file, t, t);
}

function seedGood(): string {
  const root = seedStamper(sb, SLUG, {
    'state/execution-results-translated-mplan_fixture.json': 'execution-results-valid.json',
    'state/execution-results-translated-mplan_fixture.delivery.json': 'raw:{"delivered":true}',
    'evidence/access_control/ac.l1-3.1.1.json': 'evidence-ac.json',
    'evidence/physical/badge-log.csv': 'raw:when,who\n2026-09-20,guard\n',
  });
  fresh(path.join(root, 'evidence/access_control/ac.l1-3.1.1.json'));
  fresh(path.join(root, 'evidence/physical/badge-log.csv'));
  return root;
}

describe('EMPTY_READ', () => {
  it('a tenant with nothing to read -> run status empty + EMPTY_READ finding, never success', () => {
    const r = runIndexPass(SLUG, { now: clock });
    expect(EcRunSchema.parse(r.run).status).toBe('empty');
    expect(r.run.status).not.toBe('success');
    expect(r.run.artifactsWritten).toBe(0);
    const findings = listFindings(SLUG);
    expect(findings).toHaveLength(1);
    expect(EcFindingSchema.parse(findings[0])).toMatchObject({ checkId: 'EMPTY_READ', status: 'open', tenantSlug: SLUG });
  });

  it('an existing-but-empty Stamper tree is still empty', () => {
    fs.mkdirSync(path.join(sb.pipelineRoot, 'Stamper', 'plan-data', SLUG, 'evidence', 'access_control'), { recursive: true });
    fs.mkdirSync(path.join(sb.pipelineRoot, 'Stamper', 'plan-data', SLUG, 'state'), { recursive: true });
    expect(runIndexPass(SLUG, { now: clock }).run.status).toBe('empty');
  });

  it('a repeat empty pass does not duplicate the open EMPTY_READ; it resolves once evidence appears', () => {
    runIndexPass(SLUG, { now: clock });
    runIndexPass(SLUG, { now: clock });
    expect(listFindings(SLUG).filter((f) => f.checkId === 'EMPTY_READ')).toHaveLength(1);
    seedGood();
    const r = runIndexPass(SLUG, { now: clock });
    expect(r.run.status).toBe('success');
    const er = listFindings(SLUG).filter((f) => f.checkId === 'EMPTY_READ');
    expect(er).toHaveLength(1);
    expect(er[0].status).toBe('resolved');
  });
});

describe('ledger', () => {
  it('records the sha256 of each Stamper manifest and evidence file (sidecars skipped)', () => {
    const root = seedGood();
    const r = runIndexPass(SLUG, { now: clock });
    expect(r.run).toMatchObject({ runType: 'index', status: 'success', artifactsWritten: 3 });
    const state = loadLedgerState(SLUG);
    const entries = Object.values(state).map((e) => EcLedgerEntrySchema.parse(e));
    expect(entries.map((e) => e.path).sort()).toEqual([
      'evidence/access_control/ac.l1-3.1.1.json',
      'evidence/physical/badge-log.csv',
      'state/execution-results-translated-mplan_fixture.json',
    ]);
    for (const e of entries) {
      expect(e.origin).toBe('stamper');
      expect(e.sha256).toBe(sha(path.join(root, ...e.path.split('/'))));
    }
    expect(listFindings(SLUG)).toHaveLength(0);
  });

  it('only appends ledger history on first-seen or change (no growth on an unchanged re-index)', () => {
    seedGood();
    runIndexPass(SLUG, { now: clock });
    const hist = () => fs.readFileSync(path.join(ecTenantDir(sb, SLUG), 'ledger.jsonl'), 'utf-8').trim().split('\n');
    expect(hist()).toHaveLength(3);
    runIndexPass(SLUG, { now: () => new Date(NOW.getTime() + 60_000) });
    expect(hist()).toHaveLength(3);
    const e = loadLedgerState(SLUG)['stamper:evidence/physical/badge-log.csv'];
    expect(e.firstSeen).toBe(NOW.toISOString());
    expect(e.lastSeen).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });
});

describe('HASH_DRIFT', () => {
  it('changing a fixture file after an index raises HASH_DRIFT with old -> new sha', () => {
    const root = seedGood();
    runIndexPass(SLUG, { now: clock });
    const file = path.join(root, 'evidence/physical/badge-log.csv');
    const before = sha(file);
    fs.writeFileSync(file, 'when,who\n2026-09-20,someone-else\n');
    fresh(file);
    const r = runIndexPass(SLUG, { now: clock });
    expect(r.run.status).toBe('success');
    const drift = r.newFindings.filter((f) => f.checkId === 'HASH_DRIFT');
    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe('high');
    expect(drift[0].detail).toContain(before);
    expect(drift[0].detail).toContain(sha(file));
    expect(loadLedgerState(SLUG)['stamper:evidence/physical/badge-log.csv'].sha256).toBe(sha(file));
    // the drift is reported once, not on every later pass
    expect(runIndexPass(SLUG, { now: clock }).newFindings).toHaveLength(0);
    expect(listFindings(SLUG).filter((f) => f.checkId === 'HASH_DRIFT')).toHaveLength(1);
  });

  it('an unchanged file never drifts', () => {
    seedGood();
    runIndexPass(SLUG, { now: clock });
    expect(runIndexPass(SLUG, { now: clock }).newFindings).toHaveLength(0);
  });

  it('a tampered EC item (bytes no longer match the ingest sha) raises HASH_DRIFT', async () => {
    const ec = await startApp({ resolveTenant: sb.resolver, now: clock });
    try {
      const res = await fetch(`${ec.base}/api/ingest`, { method: 'POST', headers: auth(SECRET), body: ingestBody(SLUG, 'original bytes') });
      expect(res.status).toBe(201);
      const item = await res.json();
      fs.writeFileSync(path.join(ecTenantDir(sb, SLUG), 'items', `${item.itemId}.bin`), 'tampered bytes');
      const r = runIndexPass(SLUG, { now: clock });
      const drift = r.newFindings.filter((f) => f.checkId === 'HASH_DRIFT');
      expect(drift.length).toBeGreaterThanOrEqual(1);
      expect(drift.some((f) => f.detail.includes('recorded at ingest'))).toBe(true);
    } finally {
      await ec.close();
    }
  });
});

describe('STALE', () => {
  it('evidence older than EC_STALE_DAYS raises a low-severity STALE finding', () => {
    const root = seedGood();
    const old = new Date(NOW.getTime() - 120 * 24 * 3600 * 1000);
    fs.utimesSync(path.join(root, 'evidence/physical/badge-log.csv'), old, old);
    const r = runIndexPass(SLUG, { now: clock, staleDays: 90 });
    const stale = r.newFindings.filter((f) => f.checkId === 'STALE');
    expect(stale).toHaveLength(1);
    expect(stale[0].severity).toBe('low');
    expect(stale[0].detail).toContain('badge-log.csv');
  });

  it('manifest age comes from completedAt; EC_STALE_DAYS env is honored', () => {
    seedGood(); // manifest completedAt 2026-09-20 = 8 days before NOW
    process.env.EC_STALE_DAYS = '5';
    const r = runIndexPass(SLUG, { now: clock });
    const stale = r.newFindings.filter((f) => f.checkId === 'STALE').map((f) => f.detail);
    expect(stale.some((d) => d.includes('execution-results-translated-mplan_fixture.json'))).toBe(true);
    expect(stale.every((d) => d.includes('EC_STALE_DAYS=5'))).toBe(true);
  });

  it('a stale file is flagged once (dedupe) and resolves when refreshed', () => {
    const root = seedGood();
    const file = path.join(root, 'evidence/physical/badge-log.csv');
    const old = new Date(NOW.getTime() - 120 * 24 * 3600 * 1000);
    fs.utimesSync(file, old, old);
    runIndexPass(SLUG, { now: clock });
    expect(runIndexPass(SLUG, { now: clock }).newFindings.filter((f) => f.checkId === 'STALE')).toHaveLength(0);
    fresh(file);
    runIndexPass(SLUG, { now: clock });
    const st = listFindings(SLUG).filter((f) => f.checkId === 'STALE');
    expect(st).toHaveLength(1);
    expect(st[0].status).toBe('resolved');
  });
});

describe('UNPARSEABLE', () => {
  it('a pre-contract execution-results manifest (no contractVersion, verdict "SAT") is flagged', () => {
    seedStamper(sb, SLUG, { 'state/execution-results-translated-mplan_legacy.json': 'execution-results-legacy.json' });
    const r = runIndexPass(SLUG, { now: clock });
    expect(r.run.status).toBe('success'); // it was read + hashed; the finding carries the problem
    const u = r.newFindings.filter((f) => f.checkId === 'UNPARSEABLE');
    expect(u).toHaveLength(1);
    expect(u[0].detail).toMatch(/not a valid execution-results manifest/);
  });

  it('a malformed JSON evidence file is flagged; non-JSON evidence is hashed, not parsed', () => {
    const root = seedGood();
    seedStamper(sb, SLUG, { 'evidence/access_control/broken.json': 'raw:{"outcome": ' });
    fresh(path.join(root, 'evidence/access_control/broken.json'));
    const r = runIndexPass(SLUG, { now: clock });
    const u = r.newFindings.filter((f) => f.checkId === 'UNPARSEABLE');
    expect(u).toHaveLength(1);
    expect(u[0].detail).toContain('broken.json');
    expect(loadLedgerState(SLUG)['stamper:evidence/access_control/broken.json']).toBeDefined();
  });
});

describe('UNPARSEABLE (unreadable)', () => {
  it('a manifest path that cannot be read (EISDIR) is flagged unreadable, and a pass with nothing readable is empty', () => {
    fs.mkdirSync(path.join(sb.pipelineRoot, 'Stamper', 'plan-data', SLUG, 'state', 'execution-results-weird.json'), { recursive: true });
    const r = runIndexPass(SLUG, { now: clock });
    const u = r.newFindings.filter((f) => f.checkId === 'UNPARSEABLE');
    expect(u).toHaveLength(1);
    expect(u[0].detail).toMatch(/unreadable/);
    expect(r.run.status).toBe('empty');
    expect(r.newFindings.find((f) => f.checkId === 'EMPTY_READ')?.detail).toMatch(/none were readable/);
  });
});

describe('read-only against Stamper', () => {
  it('an index pass leaves the Stamper tree byte-for-byte and mtime-identical, and writes only under EC root', () => {
    const root = seedGood();
    seedStamper(sb, SLUG, { 'evidence/access_control/broken.json': 'raw:{' });
    const before = snapshot(root);
    runIndexPass(SLUG, { now: clock });
    runIndexPass(SLUG, { now: clock });
    expect(snapshot(root)).toEqual(before);
    // everything EC wrote is under its own module root
    const top = fs.readdirSync(sb.pipelineRoot).sort();
    expect(top).toEqual(['EvidenceCollector', 'Stamper']);
  });
});

describe('runs', () => {
  it('each pass records an index run, newest first', () => {
    seedGood();
    runIndexPass(SLUG, { now: clock });
    runIndexPass(SLUG, { now: () => new Date(NOW.getTime() + 1000) });
    const runs = listRuns(SLUG);
    expect(runs).toHaveLength(2);
    expect(runs[0].startedAt > runs[1].startedAt).toBe(true);
    expect(runs.every((r) => r.runType === 'index' && r.status === 'success')).toBe(true);
  });
});
