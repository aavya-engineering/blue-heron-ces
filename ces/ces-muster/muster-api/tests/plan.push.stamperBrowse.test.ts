// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU MS-3 (2026-09-27): push → Stamper browse, end to end, in ONE test.
//
// Until now the two halves were proven apart: muster-api's push test checked
// filenames against a hand-copied copy of Stamper's browse regex, and Stamper's
// PlanBrowseSeparator test wrote fixture files straight to disk. Here a plan is
// pushed through muster-api's REAL app (createApp → POST /api/plan/push, via the
// SPA's production push client), and Stamper's REAL createUtilityRouter() —
// imported read-only from the sibling ../ces-stamper working tree, never copied
// — lists the pushed files from GET /api/browse for that tenant.
//
// Both sides resolve the tenant plans folder from CES_PIPELINE_ROOT at call time
// (muster-api: vendored ces-shared getStamperTenantSubdir; Stamper:
// tenantPlansDir → ces-shared getStamperTenantSubdir), so one temp root is set
// before either side is loaded. The sibling import is deliberate and unguarded
// (same stance as plan.results.liveLoop.test.ts): a missing ces-stamper checkout
// must fail loudly, never skip.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-fcmu-ms3-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

const { createApp } = await import('../src/app.js');
const { mintToken } = await import('../src/lib/jwt.js');
const { pushPlanToStamper } = await import('@/features/plan/planPushService');
const { createUtilityRouter } = await import('../../../ces-stamper/src/server/routes/utility.routes');
type PlanCompileResult = import('@/features/plan/planCompileService').PlanCompileResult;

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
const im = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'infrastructure-manifest.json'), 'utf8'));

const SLUG = 'fcmu-ms3-tenant';
const TOKEN = mintToken({
  sub: 'fcmu-operator',
  tenant_id: '00000000-0000-0000-0000-00000000fc03',
  party_id: null,
  role: 'bhd_operator',
});

let muster: http.Server;
let stamper: http.Server;
let musterBase: string;
let stamperBase: string;
const store = new Map<string, string>();

beforeAll(() => {
  muster = createApp().listen(0);
  musterBase = `http://127.0.0.1:${(muster.address() as { port: number }).port}`;
  const s = express();
  s.use(createUtilityRouter());
  stamper = s.listen(0);
  stamperBase = `http://127.0.0.1:${(stamper.address() as { port: number }).port}`;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

afterAll(() => {
  muster?.close();
  stamper?.close();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

async function browse(pattern: string, tenant = SLUG): Promise<{ status: number; body: { ok: boolean; files?: Array<{ name: string; path: string }> } }> {
  const res = await fetch(`${stamperBase}/api/browse?tenant=${encodeURIComponent(tenant)}&pattern=${encodeURIComponent(pattern)}`);
  return { status: res.status, body: await res.json() };
}

describe('MS-3: a plan pushed by muster-api appears in Stamper GET /api/browse', () => {
  test('before the push Stamper has nothing for the tenant; after it, all three artifacts are listed', async () => {
    const before = await browse('manual-mission-plan');
    expect(before.status).toBe(404); // non-vacuous: nothing on disk yet

    store.set('muster-api-url', `${musterBase}/api`);
    store.set('muster-jwt', TOKEN);
    const outcome = await pushPlanToStamper({
      artifacts: { missionPlan: mp, tenantManifest: tm, infrastructureManifest: im },
      docs: [],
      tenantSlug: SLUG,
      defaultedInputs: [],
      siFieldSources: {},
    } as unknown as PlanCompileResult);
    if (!outcome.ok) console.error('push failed:', outcome);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const [mpFile, tmFile, imFile] = outcome.pushed;

    for (const [pattern, file] of [
      ['manual-mission-plan', mpFile],
      ['tenant-manifest', tmFile],
      ['infrastructure-manifest', imFile],
    ] as const) {
      const r = await browse(pattern);
      expect(r.status, pattern).toBe(200);
      const names = (r.body.files ?? []).map((f) => f.name);
      expect(names, pattern).toContain(file);
      // The listed path is the very file muster-api wrote, and it is the pushed artifact.
      const listed = r.body.files!.find((f) => f.name === file)!;
      expect(path.resolve(path.dirname(listed.path))).toBe(path.resolve(outcome.plansDir));
    }
    const listedMp = (await browse('manual-mission-plan')).body.files!.find((f) => f.name === mpFile)!;
    expect(JSON.parse(fs.readFileSync(listedMp.path, 'utf8')).outputs.human_readable_mission_plan.plan_id).toBe(
      mp.outputs.human_readable_mission_plan.plan_id
    );
  });

  test("another tenant's browse does not list this tenant's plan", async () => {
    const other = await browse('manual-mission-plan', 'fcmu-ms3-other');
    expect(other.status).toBe(404);
  });
});
