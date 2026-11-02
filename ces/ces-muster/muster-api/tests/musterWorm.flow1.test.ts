// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Gap closure FLOW-1: muster-api records plan pushes and discovery runs
// write-once in {CES_PIPELINE_ROOT}/ces.db (muster_plan_push, muster_discovery).
// The WORM refusals need ces-shared's dist built with the FLOW-1 collection list.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import express from 'express';
import { CesRepository, CesWormError } from 'ces-shared/persistence/node';
import { createPlanRouter } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';
import { recordDiscovery, MUSTER_DISCOVERY, MUSTER_PLAN_PUSH } from '../src/services/musterWorm.js';
import { runSimDiscovery } from '../src/services/simDiscoveryRun.js';
import type { DiscoverySession, RegistryGetEntry } from '../src/services/discoveryService.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));

const TOKEN = mintToken({ sub: 'flow1-operator', tenant_id: '00000000-0000-0000-0000-0000000000f1', party_id: null, role: 'bhd_operator' });
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

let server: http.Server;
let base: string;
let tmpRoot: string;
const dbPath = () => path.join(tmpRoot, 'ces.db');

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-flow1-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/plan', createPlanRouter());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

describe('FLOW-1: muster_plan_push', () => {
  test('an accepted push writes one WORM row whose hashes equal the pushed files; overwrite is refused', async () => {
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ tenant_slug: 'flow1-push', missionPlan: mp, tenantManifest: tm }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { pushed: string[] };
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'flow1-push', 'plans');

    const repo = new CesRepository(dbPath());
    try {
      const rows = repo.list<{ event: string; tenant_slug: string; files: { name: string; sha256: string }[]; override: unknown }>(
        MUSTER_PLAN_PUSH,
        { tenantSlug: 'flow1-push' },
      );
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.id).toBe(`flow1-push:${body.pushed[0]}`);
      expect(row.data.event).toBe('plan_push');
      expect(row.data.override).toBeNull();
      expect(row.data.files.map((f) => f.name)).toEqual(body.pushed);
      for (const f of row.data.files) expect(f.sha256).toBe(sha(fs.readFileSync(path.join(plansDir, f.name))));
      expect(() => repo.put(MUSTER_PLAN_PUSH, { id: row.id, ces: { tenantSlug: 'flow1-push' }, data: { tampered: true } })).toThrow(CesWormError);
      expect(() => repo.delete(MUSTER_PLAN_PUSH, row.id, { tenantSlug: 'flow1-push' })).toThrow(CesWormError);
    } finally {
      repo.close();
    }
    // The jsonl stays the override mirror: an aligned push writes none.
    expect(fs.existsSync(path.join(tmpRoot, 'Stamper', 'plan-data', 'flow1-push', 'state', 'plan-push-audit.jsonl'))).toBe(false);
  });
});

describe('FLOW-1: muster_discovery', () => {
  test('recordDiscovery hashes the envelope exactly as `mu discovery --out` writes it; overwrite is refused', () => {
    const envelope = { schema: 'readiness-result.v1', tenant: { slug: 'flow1-disc' }, observations: [{ id: 'o1' }] };
    const rec = recordDiscovery({ tenant_slug: 'flow1-disc', tenant_kind: 'sim', envelope, postures: { met: 1, unknown: 0, not_met: 0 }, at: '2026-10-30T00:00:00.000Z' });
    expect(rec.result_sha256).toBe(sha(Buffer.from(JSON.stringify(envelope, null, 2), 'utf-8')));
    const repo = new CesRepository(dbPath());
    try {
      const rows = repo.list<{ result_sha256: string; tenant_kind: string }>(MUSTER_DISCOVERY, { tenantSlug: 'flow1-disc' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data.result_sha256).toBe(rec.result_sha256);
      expect(rows[0]!.data.tenant_kind).toBe('sim');
      expect(() => repo.put(MUSTER_DISCOVERY, { id: rows[0]!.id, ces: { tenantSlug: 'flow1-disc' }, data: {} })).toThrow(CesWormError);
    } finally {
      repo.close();
    }
  });

  const ENTRIES: RegistryGetEntry[] = [{ entry_id: 'e1', control_ids: ['AC.L1-3.1.1'], engine: 'mgraph', get_command: 'Get-MgUser' }];
  const session: DiscoverySession = { async execute() { return { stdout: 'row', stderr: '', exitCode: 0, durationMs: 1 }; } };
  const hermetic = {
    probeLedger: async () => true,
    loadEntries: () => ENTRIES,
    session,
    makeCapture: () => ({ write: (id: string) => `captures/${id}.txt` }),
    mkdir: () => undefined,
    assertZeroWrites: async () => ({ ok: true }),
    registryRoot: '/no/registry/for/hermetic/test',
  };

  test('runSimDiscovery calls the recorder once with the envelope it returns', async () => {
    const calls: Parameters<typeof recordDiscovery>[0][] = [];
    const out = await runSimDiscovery(
      { slug: 'flow1-run', outDir: path.join(tmpRoot, 'disc') },
      { ...hermetic, recordDiscovery: (i) => (calls.push(i), recordDiscovery(i)) },
    );
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tenant_slug).toBe('flow1-run');
    expect(calls[0]!.envelope).toBe(out.ok ? out.envelope : null);
  });

  test('an injected session with no recorder writes nothing', async () => {
    const before = fs.existsSync(dbPath()) ? new CesRepository(dbPath()) : null;
    const n = before ? before.list(MUSTER_DISCOVERY, { tenantSlug: 'flow1-none' }).length : 0;
    before?.close();
    const out = await runSimDiscovery({ slug: 'flow1-none', outDir: path.join(tmpRoot, 'disc2') }, hermetic);
    expect(out.ok).toBe(true);
    const repo = new CesRepository(dbPath());
    try {
      expect(repo.list(MUSTER_DISCOVERY, { tenantSlug: 'flow1-none' })).toHaveLength(n);
    } finally {
      repo.close();
    }
  });
});
