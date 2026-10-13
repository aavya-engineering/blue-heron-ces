// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MS-R5: plan push route — writes MP+TM to Stamper's plans folder with
// hyphenated naming matching Stamper's browse regex.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';
import { createPlanRouter } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';

// Stamper's browse regex (ces-stamper/src/routes/utility.routes.ts:42).
const STAMPER_MP_RE = /^manual-mission-plan-.*\.json$/;
const STAMPER_TM_RE = /^tenant-manifest-.*\.json$/;

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
// W4-MU1: the committed Infra Manifest golden (m365_azure + TCP).
const im = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'infrastructure-manifest.json'), 'utf8'));

let server: http.Server;
let base: string;
let tmpRoot: string;

const TOKEN = mintToken({
  sub: 'test-operator',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  party_id: null,
  role: 'bhd_operator',
});

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-push-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/plan', createPlanRouter());

  server = app.listen(0);
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server?.close();
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  delete process.env.CES_PIPELINE_ROOT;
});

describe('MS-R5: POST /api/plan/push', () => {
  test('writes MP+TM with hyphenated names matching Stamper browse regex', async () => {
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ tenant_slug: 'vfs-gcc-high', missionPlan: mp, tenantManifest: tm }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pushed).toHaveLength(2);

    const [mpFile, tmFile] = body.pushed;
    expect(mpFile).toMatch(STAMPER_MP_RE);
    expect(tmFile).toMatch(STAMPER_TM_RE);

    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'vfs-gcc-high', 'plans');
    expect(fs.existsSync(path.join(plansDir, mpFile))).toBe(true);
    expect(fs.existsSync(path.join(plansDir, tmFile))).toBe(true);

    const written = JSON.parse(fs.readFileSync(path.join(plansDir, mpFile), 'utf8'));
    expect(written.ces.version).toBe('1.0.0');
  });

  test('rejects traversal slug', async () => {
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ tenant_slug: '../../etc', missionPlan: mp, tenantManifest: tm }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('tenant_slug');
  });

  test('rejects mission plan with unknown version', async () => {
    const bad = { ...mp, ces: { ...mp.ces, version: '99.0.0' } };
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ tenant_slug: 'vfs-gcc-high', missionPlan: bad, tenantManifest: tm }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('contract violation');
  });

  test('rejects request without auth', async () => {
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_slug: 'vfs-gcc-high', missionPlan: mp, tenantManifest: tm }),
    });

    expect(res.status).toBe(401);
  });

  test('rejects missing tenant_slug', async () => {
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ missionPlan: mp, tenantManifest: tm }),
    });

    expect(res.status).toBe(400);
  });

  // ── W4-MU1 (MS-R7): the Infrastructure Manifest rides the same push ──
  test('W4-MU1: with an Infra Manifest, writes a third file on the TM file’s <slug>-<ts> suffix', async () => {
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ tenant_slug: 'w4-mu1-infra', missionPlan: mp, tenantManifest: tm, infraManifest: im }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pushed).toHaveLength(3);
    const [, tmFile, imFile] = body.pushed as string[];
    expect(imFile).toMatch(/^infrastructure-manifest-w4-mu1-infra-.*\.json$/);
    // Stamper's CLI derives the infra path by replacing `tenant-manifest`.
    expect(tmFile.replace(/tenant-manifest/i, 'infrastructure-manifest')).toBe(imFile);
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'w4-mu1-infra', 'plans');
    const written = JSON.parse(fs.readFileSync(path.join(plansDir, imFile), 'utf8'));
    expect(written).toEqual(im);
    expect(written.infrastructure.infrastructure_model).toBe('m365_azure');
  });

  test('W4-MU1: an Infra Manifest that fails the shared contract is rejected (400, nothing written)', async () => {
    const broken = structuredClone(im);
    delete broken.infrastructure.stamper_variable_map;
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ tenant_slug: 'w4-mu1-bad-infra', missionPlan: mp, tenantManifest: tm, infraManifest: broken }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Infrastructure Manifest contract violation');
    expect(body.details.join(' ')).toContain('stamper_variable_map');
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'w4-mu1-bad-infra', 'plans');
    expect(fs.existsSync(plansDir)).toBe(false);
  });

  test('W4-MU1: a non-object infraManifest is rejected', async () => {
    const res = await fetch(`${base}/api/plan/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ tenant_slug: 'w4-mu1-str', missionPlan: mp, tenantManifest: tm, infraManifest: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});
