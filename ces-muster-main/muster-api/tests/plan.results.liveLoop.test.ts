// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MS-R9 (M4) live loop: Muster plan → Stamper's REAL results emitter → Muster ingest.
//
// Unlike plan.results.test.ts (a hand-written fixture manifest), the manifest
// here is built by ces-stamper's own ExecutionResultsCollector — imported from
// the sibling working tree, read-only (provenance: ces-stamper T3, ces monorepo
// commit b879720, "lowercase verdicts at manifest boundary"). Every hop is real:
//   1. push the checked-in MP/TM (byte-equal to the real generator's output —
//      enforced by src/features/plan/__tests__/generateFixtures.test.ts);
//   2. read plan_id + control_directives back from the pushed file;
//   3. record UPPERCASE verdicts (Stamper's internal words) on those controls;
//   4. buildManifest → POST /api/plan/results;
//   5. assert lowercase verdicts land on the directives, nothing unmatched.
// Step 3→5 is what closes T3 in the loop: before T3, Stamper emitted uppercase
// and Muster (correctly) rejected it.
//
// The sibling import is deliberate and unguarded: like the file:../../ces-shared
// dependency, a missing ces-stamper checkout must fail loudly, never skip.
// Sim only — every write goes to a temp CES_PIPELINE_ROOT.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';
import { createPlanRouter } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';
import { ExecutionResultsCollector } from '../../../ces-stamper/src/core/ExecutionResultsCollector';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));

const TOKEN = mintToken({
  sub: 'test-operator',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  party_id: null,
  role: 'bhd_operator',
});
const TENANT_SLUG = 'live-loop-sim';

// Plan directive (Muster/Stamper plan vocabulary) → execution directive
// (ces-shared ExecutionDirective, what Stamper records at run time).
const EXEC_DIRECTIVE: Record<string, string> = {
  implement: 'automated',
  validate: 'validation',
  manual: 'manual_gate',
};

let server: http.Server;
let base: string;
let tmpRoot: string;

async function post(route: string, body: unknown) {
  return fetch(`${base}/api/plan/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-liveloop-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/plan', createPlanRouter());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

describe('MS-R9 live loop: Stamper ExecutionResultsCollector → POST /api/plan/results', () => {
  test('uppercase Stamper verdicts arrive lowercase and update the pushed plan’s directives', async () => {
    // 1. push
    const pushRes = await post('push', { tenant_slug: TENANT_SLUG, missionPlan: mp, tenantManifest: tm });
    expect(pushRes.status).toBe(201);
    const { pushed, plansDir } = (await pushRes.json()) as { pushed: string[]; plansDir: string };

    // 2. read back what Stamper would pick up
    const stored = JSON.parse(fs.readFileSync(path.join(plansDir, pushed[0]), 'utf8'));
    const hrmp = stored.outputs.human_readable_mission_plan;
    const planId: string = hrmp.plan_id;
    const cesId: string | undefined = stored.ces?.cesId;
    const byDirective = new Map<string, string>();
    for (const d of hrmp.control_directives as Array<{ control_id: string; directive: string }>) {
      if (EXEC_DIRECTIVE[d.directive] && !byDirective.has(d.directive)) byDirective.set(d.directive, d.control_id);
    }
    const picks = [...byDirective.entries()]; // one real control per directive kind
    expect(picks.length).toBeGreaterThanOrEqual(2);

    // 3. Stamper records its internal (uppercase) verdict words
    const UPPER = ['SAT', 'NOT_SAT', 'PROVISIONAL', 'N/A'];
    const LOWER: Record<string, string> = {
      SAT: 'sat', NOT_SAT: 'not_sat', PROVISIONAL: 'provisional', 'N/A': 'not_applicable',
    };
    const collector = new ExecutionResultsCollector();
    const expected = new Map<string, string>();
    picks.forEach(([planDirective, controlId], i) => {
      const upper = UPPER[i % UPPER.length];
      collector.recordControlResult(controlId, EXEC_DIRECTIVE[planDirective], upper, `sim ${upper}`);
      expected.set(controlId, LOWER[upper]);
    });

    // 4. Stamper's real manifest builder → Muster ingest
    const manifest = collector.buildManifest('run-live-loop-001', TENANT_SLUG, planId, cesId);
    const res = await post('results', { tenant_slug: TENANT_SLUG, manifest });
    const body = (await res.json()) as {
      updated: Array<{ control_id: string; verdict: string }>;
      unmatched: string[];
      error?: string;
      details?: string[];
    };
    if (res.status !== 200) console.error('ingest rejected:', body.error, body.details);

    // 5. lowercase verdicts on the named directives; nothing unmatched; sidecar written
    expect(res.status).toBe(200);
    expect(body.unmatched).toEqual([]);
    expect(body.updated).toHaveLength(expected.size);
    for (const u of body.updated) {
      expect(u.verdict).toBe(expected.get(u.control_id));
    }
    const sidecar = path.join(tmpRoot, 'Stamper', 'plan-data', TENANT_SLUG, 'state', `directive-status-${planId}.json`);
    expect(fs.existsSync(sidecar)).toBe(true);
  });
});
