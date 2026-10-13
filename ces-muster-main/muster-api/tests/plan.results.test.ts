// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MS-R9: execution results ingest — validates the manifest against the shipped
// ces-shared ExecutionResultsManifestSchema, applies verdicts to directives.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';
import { createPlanRouter } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const RESULTS_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__fixtures__/execution-results-fixture.json'), 'utf8'),
);
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));

let server: http.Server;
let base: string;
let tmpRoot: string;

const TOKEN = mintToken({
  sub: 'test-operator',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  party_id: null,
  role: 'bhd_operator',
});

const TENANT_SLUG = 'vfs-gcc-high';

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-results-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/plan', createPlanRouter());

  server = app.listen(0);
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;

  // Push a plan first so the results route can find it.
  await fetch(`${base}/api/plan/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ tenant_slug: TENANT_SLUG, missionPlan: mp, tenantManifest: tm }),
  });
});

afterAll(() => {
  server?.close();
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  delete process.env.CES_PIPELINE_ROOT;
});

// The fixture plan has plan_id from the frozen generator. Read it.
function getPlanId(): string {
  const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', TENANT_SLUG, 'plans');
  const files = fs.readdirSync(plansDir).filter((f) => f.startsWith('manual-mission-plan-'));
  const content = JSON.parse(fs.readFileSync(path.join(plansDir, files[0]), 'utf8'));
  return content.outputs.human_readable_mission_plan.plan_id;
}

describe('MS-R9: POST /api/plan/results', () => {
  test('conforming results fixture updates directive statuses', async () => {
    const planId = getPlanId();
    const manifest = { ...RESULTS_FIXTURE, planId };

    const res = await fetch(`${base}/api/plan/results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ tenant_slug: TENANT_SLUG, manifest }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // AC.L2-3.1.3 → sat, IA.L2-3.5.3 → not_sat, AU.L2-3.3.1 → provisional
    expect(body.updated).toHaveLength(3);
    const ac = body.updated.find((d: { control_id: string }) => d.control_id === 'AC.L2-3.1.3');
    expect(ac.verdict).toBe('sat');
    const ia = body.updated.find((d: { control_id: string }) => d.control_id === 'IA.L2-3.5.3');
    expect(ia.verdict).toBe('not_sat');
    const au = body.updated.find((d: { control_id: string }) => d.control_id === 'AU.L2-3.3.1');
    expect(au.verdict).toBe('provisional');

    expect(body.summary.sat).toBe(1);
    expect(body.summary.notSat).toBe(1);
    expect(body.summary.provisional).toBe(1);

    // Sidecar file written.
    const stateDir = path.join(tmpRoot, 'Stamper', 'plan-data', TENANT_SLUG, 'state');
    const statusFile = `directive-status-${planId}.json`;
    expect(fs.existsSync(path.join(stateDir, statusFile))).toBe(true);
  });

  test('uppercase SAT is rejected with a path-bearing error', async () => {
    const planId = getPlanId();
    const manifest = {
      ...RESULTS_FIXTURE,
      planId,
      results: [
        {
          controlId: 'AC.L2-3.1.3',
          directive: 'automated',
          verdict: 'SAT',
          outcome: 'pass',
          timestampUtc: '2026-09-27T10:00:00.000Z',
        },
      ],
    };

    const res = await fetch(`${base}/api/plan/results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ tenant_slug: TENANT_SLUG, manifest }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('contract violation');
    expect(body.details.some((e: string) => e.includes('results.0.verdict'))).toBe(true);
  });

  test('unknown contractVersion is rejected', async () => {
    const planId = getPlanId();
    const manifest = { ...RESULTS_FIXTURE, planId, contractVersion: '99.0.0' };

    const res = await fetch(`${base}/api/plan/results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ tenant_slug: TENANT_SLUG, manifest }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('contract violation');
  });
});
