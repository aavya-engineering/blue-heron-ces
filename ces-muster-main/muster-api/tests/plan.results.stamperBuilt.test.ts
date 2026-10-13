// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX-MU2 acceptance: the results loop with a manifest built by Stamper's
// PRODUCTION builder, for a Muster plan, all the way to the Plan tab's view.
//
// Every hop is production code:
//   1. the SPA push client (planPushService) sends the generated MP + TM
//      (checked-in fixture = real generator output, byte-equal by the
//      generateFixtures compare test) to the REAL muster-api app (createApp);
//   2. Stamper translates the pushed files exactly as its CLI does
//      (PlanTranslator + ManifestReader + its registry — imported read-only
//      from the sibling ces-stamper tree, as ces-stamper's own FX-ST3/FX-ST4
//      test does), records a verdict per control with its ResultVerdict words,
//      and builds the manifest with buildManifestForPlan (FX-ST4: planId = the
//      Mission Plan's bare plan_id);
//   3. POST /api/plan/results ingests it → directive statuses update;
//   4. the SPA progress client (fetchPlanProgress) reads GET /api/plan/status;
//   5. the Plan tab's PlanProgressView renders that progress.
//
// Gate: ces-stamper FX-ST3 + FX-ST4 (ces monorepo ab09507). The sibling import
// is deliberate and unguarded — a missing ces-stamper checkout fails loudly.
// Sim only: every write goes to a temp CES_PIPELINE_ROOT; nothing leaves 127.0.0.1.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../src/app.js';
import { mintToken } from '../src/lib/jwt.js';
import { pushPlanToStamper, fetchPlanProgress } from '@/features/plan/planPushService';
import type { PlanCompileResult } from '@/features/plan/planCompileService';
import PlanProgressView from '@/features/plan/PlanProgressView';
import {
  ExecutionResultsCollector,
  ResultVerdict,
} from '../../../ces-stamper/src/core/ExecutionResultsCollector';
import { PlanTranslator } from '../../../ces-stamper/src/translators/PlanTranslator';
import { ManifestReader } from '../../../ces-stamper/src/translators/ManifestReader';

const STAMPER_REGISTRY = path.resolve(
  __dirname, '../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json',
);
const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
const TENANT_SLUG = 'fxmu2-sim';

const RESULT = {
  artifacts: { missionPlan: mp, tenantManifest: tm },
  docs: [],
  tenantSlug: TENANT_SLUG,
  defaultedInputs: [],
} as unknown as PlanCompileResult;

const TOKEN = mintToken({
  sub: 'test-operator',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  party_id: null,
  role: 'bhd_operator',
});

// Stamper verdict word → shared vocabulary Muster stores (FX-ST3 mapping).
const SHARED: Record<string, string> = {
  SAT: 'sat', MET: 'sat', NOT_SAT: 'not_sat', 'NOT MET': 'not_sat',
  PROVISIONAL: 'provisional', 'N/A': 'not_applicable',
};

let server: http.Server;
let base: string;
let tmpRoot: string;
const store = new Map<string, string>();

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-fxmu2-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  store.set('muster-api-url', `${base}/api`);
  store.set('muster-jwt', TOKEN);
});

afterAll(() => {
  server?.close();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

describe('FX-MU2: Stamper-built results manifest → directive progress on the Plan tab', () => {
  test('push → Stamper translate + buildManifestForPlan → ingest → status → rendered progress', async () => {
    // Before any push, progress is honestly unavailable.
    const before = await fetchPlanProgress(RESULT);
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.status).toBe(404);

    // 1. push through the product client
    const pushed = await pushPlanToStamper(RESULT);
    expect(pushed.ok).toBe(true);
    if (!pushed.ok) return;
    const mpFile = path.join(pushed.plansDir, pushed.pushed[0]);
    const tmFile = path.join(pushed.plansDir, pushed.pushed[1]);

    // Pushed but not yet executed: every directive pending.
    const pending = await fetchPlanProgress(RESULT);
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const planDirectives = mp.outputs.human_readable_mission_plan.control_directives as Array<{
      control_id: string; directive: string;
    }>;
    expect(pending.progress.total).toBe(planDirectives.length);
    expect(pending.progress.counts.pending).toBe(planDirectives.length);

    // 2. Stamper: translate the pushed files as its CLI does, record, build.
    const pushedMp = JSON.parse(fs.readFileSync(mpFile, 'utf8'));
    const controls = pushedMp?.outputs?.human_readable_mission_plan?.controls;
    const translator = new PlanTranslator(
      undefined, undefined, Array.isArray(controls) && controls.length > 0 ? controls : undefined, undefined,
    );
    translator.loadRegistry(STAMPER_REGISTRY);
    const { plan } = translator.translate(structuredClone(pushedMp), ManifestReader.fromFile(tmFile));
    const controlDirectives = plan.variables._control_directives as Record<string, string>;

    const verdicts = [ResultVerdict.SAT, ResultVerdict.NOT_MET, ResultVerdict.PROVISIONAL, ResultVerdict.NOT_APPLICABLE];
    const collector = new ExecutionResultsCollector();
    const expected = new Map<string, string>();
    Object.entries(controlDirectives).forEach(([cid, dir], i) => {
      const v = verdicts[i % verdicts.length];
      collector.recordControlResult(cid, dir, v, `sim ${v}`);
      expected.set(cid, SHARED[v]);
    });
    const manifest = collector.buildManifestForPlan('run-fxmu2-001', TENANT_SLUG, plan as never);
    // FX-ST4: Stamper keys the manifest on Muster's bare plan_id.
    expect(manifest.planId).toBe(mp.outputs.human_readable_mission_plan.plan_id);

    // 3. ingest
    const ingest = await fetch(`${base}/api/plan/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ tenant_slug: TENANT_SLUG, manifest }),
    });
    const ingested = (await ingest.json()) as {
      updated: Array<{ control_id: string; verdict: string }>;
      unmatched: string[];
      error?: string;
      details?: string[];
    };
    if (ingest.status !== 200) console.error('ingest rejected:', ingested.error, ingested.details);
    expect(ingest.status).toBe(200);
    expect(ingested.updated.length).toBeGreaterThan(0);
    for (const u of ingested.updated) expect(u.verdict).toBe(expected.get(u.control_id));
    // Every plan directive Stamper reported on is matched; unmatched are only
    // controls Stamper ran that the plan carries no directive for.
    const planIds = new Set(planDirectives.map((d) => d.control_id));
    for (const cid of ingested.unmatched) expect(planIds.has(cid)).toBe(false);

    // 4. progress read back through the SPA client
    const after = await fetchPlanProgress(RESULT);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const p = after.progress;
    expect(p.runId).toBe('run-fxmu2-001');
    expect(p.total).toBe(planDirectives.length);
    expect(p.directives.map((d) => d.control_id)).toEqual(planDirectives.map((d) => d.control_id));
    for (const row of p.directives) {
      expect(row.verdict).toBe(expected.get(row.control_id) ?? null);
    }
    const reported = p.directives.filter((d) => d.verdict !== null).length;
    expect(reported).toBe(ingested.updated.length);
    expect(p.counts.pending).toBe(p.total - reported);
    expect(p.counts.sat + p.counts.not_sat + p.counts.provisional + p.counts.not_applicable).toBe(reported);

    // 5. the Plan tab's progress view renders it
    const html = renderToStaticMarkup(createElement(PlanProgressView, { progress: p }));
    expect(html).toContain('data-testid="plan-progress"');
    expect(html).toContain(`${reported} of ${p.total} directives reported`);
    expect(html).toContain('run-fxmu2-001');
    const first = p.directives.find((d) => d.verdict === 'sat');
    expect(first).toBeDefined();
    expect(html).toContain(`data-testid="plan-progress-verdict-${first!.control_id}">Satisfied<`);
    console.info(
      `FX-MU2: ${p.total} plan directives, ${reported} reported by Stamper, ` +
        `${ingested.unmatched.length} Stamper controls without a plan directive`,
    );
    expect(html).not.toMatch(/SPRS/i);
  });

  test('status rejects an unsafe plan_id and an unknown plan', async () => {
    const bad = await fetch(`${base}/api/plan/status?tenant_slug=${TENANT_SLUG}&plan_id=..%2F..%2Fx`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(bad.status).toBe(400);
    const unknown = await fetch(`${base}/api/plan/status?tenant_slug=${TENANT_SLUG}&plan_id=no-such-plan`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(unknown.status).toBe(404);
  });
});
