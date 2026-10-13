// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Flow-through FX-TE3 — results loop proof (MS-R9): the Muster-sourced
 * scenario, extended past Stamper's execution back into Muster.
 *
 * Opt-in integration (Windows PowerShell + tenant-stacksim): CES_TESTER_FLOW_LIVE=1.
 *
 * Every hop is production code; nothing is hand-built:
 *   1. Muster's REAL generator (`buildPlanArtifacts`, same input as the X2
 *      scenario `clean-tenant-mfa-baseline`) produces the Mission Plan + Tenant
 *      Manifest.
 *   2. They are pushed through muster-api's real app (`createApp`, imported
 *      read-only from ces-muster/muster-api/src — its dist predates FX-MU2)
 *      with a JWT minted by muster-api's own `mintToken`, exactly as
 *      muster-api's tests do (the SPA stores no token).
 *   3. Stamper translates the pushed files (ces-stamper/dist CLI) and executes
 *      the Executable Plan LIVE against stacksim through its production
 *      `GET /api/execute` route (ces-stamper/dist GUI server) — the route that
 *      writes the execution-results manifest.
 *   4. That manifest file is posted to `POST /api/plan/results`; Muster's
 *      directive statuses (`GET /api/plan/status`) must update.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { findCesRoot } from '../../src/flow/ces-root.js';
import { generateMusterPlan, type MusterPlanOutput } from '../../src/flow/muster-plan-generator.js';
import { guardedSimChildEnv, startSimTenants, type SimTenants } from '../../src/flow/ao-eo-flow.js';
import { executeViaStamperServer, startStamperServer, translateWithStamperCli, type StamperServerHandle } from '../../src/flow/results-loop-flow.js';
import { loadScenarioFile, musterPlanCase } from '../../src/scenarios/scenarioFile.js';
import { queryLedger } from '../../src/stacksim-client/http.js';

const LIVE = process.env.CES_TESTER_FLOW_LIVE === '1' && process.platform === 'win32';
if (!LIVE) console.log('[FX-TE3] skipped: set CES_TESTER_FLOW_LIVE=1 on Windows (needs PowerShell + tenant-stacksim)');
const CES_ROOT = LIVE ? findCesRoot() : '';
const TESTER_ROOT = path.resolve(__dirname, '..', '..');
const SLUG = 'ft-te3-results';
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(CES_ROOT, rel)).href);

function head(repo: string): string {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '(unknown)';
  }
}

describe.skipIf(!LIVE)('FX-TE3 MS-R9: Stamper results manifest -> muster-api -> directive status [opt-in CES_TESTER_FLOW_LIVE=1]', () => {
  let workDir: string;
  let sim: SimTenants;
  let stamper: StamperServerHandle | undefined;
  let muster: Server | undefined;
  let base: string;
  let token: string;
  let plan: MusterPlanOutput;
  let planId: string;
  let directives: Array<{ control_id: string; directive: string }>;
  let pendingBefore: any;
  let events: any[] = [];
  let manifestFile: string;
  let manifest: any;
  let ingest: { status: number; body: any };
  let after: any;
  let ledgerMutations = 0;
  let sharedResults: any;
  const prev = { pipeline: process.env.CES_PIPELINE_ROOT, tenantRoot: process.env.CES_TENANT_ROOT, jwt: process.env.JWT_SECRET };

  const api = (p: string, init: RequestInit = {}) =>
    fetch(`${base}/api${p}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-te3-'));
    console.log(
      `[FX-TE3] upstream: ces monorepo@${head(CES_ROOT)} (ces-stamper dist, ces-shared dist, tenant-stacksim) ` +
        `ces-muster@${head(path.join(CES_ROOT, 'ces-muster'))} (generator + muster-api src) work=${workDir}`,
    );
    const scenario = await loadScenarioFile(path.join(TESTER_ROOT, 'scenarios', 'clean-tenant-mfa-baseline.json'));
    const mc = musterPlanCase(scenario);
    if (!mc) throw new Error('clean-tenant-mfa-baseline has no muster.plan_source');

    sim = await startSimTenants({
      cesRoot: CES_ROOT,
      testerRoot: TESTER_ROOT,
      workDir,
      slugs: [SLUG],
      seed: scenario.stacksim_seed as any,
      log: (l) => console.log(`[FX-TE3] ${l}`),
    });

    // 1. Muster's real generator.
    plan = await generateMusterPlan({ ...mc.planCase, id: SLUG }, CES_ROOT);
    planId = plan.missionPlan.outputs.human_readable_mission_plan.plan_id;
    directives = plan.missionPlan.outputs.human_readable_mission_plan.control_directives;

    // 2. muster-api's real app, in-process, on a temp CES_PIPELINE_ROOT shared with Stamper.
    process.env.CES_PIPELINE_ROOT = sim.pipelineRoot;
    process.env.CES_TENANT_ROOT = sim.registryRoot;
    process.env.JWT_SECRET = 'ces-tester-fx-te3-local-only';
    const { createApp } = await imp('ces-muster/muster-api/src/app.ts');
    const { mintToken } = await imp('ces-muster/muster-api/src/lib/jwt.ts');
    token = mintToken({ sub: 'ces-tester-fx-te3', tenant_id: '00000000-0000-0000-0000-00000000fe03', party_id: null, role: 'bhd_operator' });
    muster = createApp().listen(0, '127.0.0.1') as Server;
    await new Promise<void>((r) => muster!.once('listening', () => r()));
    base = `http://127.0.0.1:${(muster!.address() as AddressInfo).port}`;

    const push = await api('/plan/push', {
      method: 'POST',
      body: JSON.stringify({ tenant_slug: SLUG, missionPlan: plan.missionPlan, tenantManifest: plan.tenantManifest }),
    });
    const pushed = (await push.json()) as any;
    if (push.status !== 201) throw new Error(`muster-api push -> ${push.status}: ${JSON.stringify(pushed)}`);
    pendingBefore = (await (await api(`/plan/status?tenant_slug=${SLUG}&plan_id=${encodeURIComponent(planId)}`)).json()) as any;

    // 3. Stamper: translate the PUSHED files, then execute live on stacksim via the server route.
    const env = guardedSimChildEnv(sim, { storageRoot: path.join(workDir, 'stamper-storage') });
    const stamperRoot = path.join(CES_ROOT, 'ces-stamper');
    const stamperCwd = path.join(workDir, 'stamper-cwd');
    fs.mkdirSync(stamperCwd, { recursive: true });
    const execPlan = path.join(workDir, 'executable-plan.json');
    const translate = await translateWithStamperCli({
      stamperRoot,
      missionPlanPath: path.join(pushed.plansDir, pushed.pushed[0]),
      manifestPath: path.join(pushed.plansDir, pushed.pushed[1]),
      tenantSlug: SLUG,
      outputPath: execPlan,
      cwd: stamperCwd,
      env,
    });
    fs.writeFileSync(path.join(workDir, 'stamper-translate.log'), translate.stdout + translate.stderr);

    stamper = await startStamperServer({ stamperRoot, cwd: stamperCwd, env, port: 3927, logPath: path.join(workDir, 'stamper-gui.log') });
    const ledgerBefore = await queryLedger(sim.simUrl, {});
    events = await executeViaStamperServer({ baseUrl: stamper.baseUrl, planPath: execPlan, tenantSlug: SLUG });
    const ledgerAfter = await queryLedger(sim.simUrl, {});
    ledgerMutations = ledgerAfter.slice(ledgerBefore.length).filter((e) => e.type === 'mutate' || e.type === 'create').length;
    fs.writeFileSync(path.join(workDir, 'stamper-execute.events.json'), JSON.stringify(events, null, 1));

    // Stamper's own manifest FILE (tenantStateDir/execution-results-<planId>.json).
    const stateDir = path.join(sim.pipelineRoot, 'Stamper', 'plan-data', SLUG, 'state');
    const files = fs.existsSync(stateDir) ? fs.readdirSync(stateDir).filter((f) => f.startsWith('execution-results-') && !f.endsWith('.delivery.json')) : [];
    // FX-ST6 writes a `<manifest>.delivery.json` sidecar beside the manifest; it is not a manifest.
    if (files.length !== 1) {
      const errs = events.filter((e) => e.type === 'error').map((e) => e.message);
      throw new Error(`expected one Stamper results manifest in ${stateDir}, found [${files.join(', ')}]; SSE errors: ${errs.join(' | ')}`);
    }
    manifestFile = path.join(stateDir, files[0]);
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    sharedResults = await import(
      pathToFileURL(path.join(CES_ROOT, 'ces-shared', 'dist', 'types', 'execution-results.contract.js')).href
    );

    // 4. post it to Muster, read the status back.
    const r = await api('/plan/results', { method: 'POST', body: JSON.stringify({ tenant_slug: SLUG, manifest }) });
    ingest = { status: r.status, body: await r.json() };
    after = (await (await api(`/plan/status?tenant_slug=${SLUG}&plan_id=${encodeURIComponent(planId)}`)).json()) as any;
  }, 1_500_000);

  afterAll(async () => {
    if (stamper) await stamper.stop();
    if (muster) {
      muster.closeAllConnections();
      await new Promise<void>((r) => muster!.close(() => r()));
    }
    if (sim) await sim.stop();
    for (const [k, v] of [['CES_PIPELINE_ROOT', prev.pipeline], ['CES_TENANT_ROOT', prev.tenantRoot], ['JWT_SECRET', prev.jwt]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (workDir && process.env.CES_TESTER_KEEP_FLOW !== '1') fs.rmSync(workDir, { recursive: true, force: true });
  }, 120_000);

  test('before Stamper runs, Muster shows every pushed directive pending', () => {
    expect(pendingBefore.total).toBe(directives.length);
    expect(pendingBefore.counts.pending).toBe(directives.length);
  });

  test('Stamper executed live on stacksim and wrote its results manifest (shared contract, Muster plan_id)', () => {
    expect(ledgerMutations).toBeGreaterThan(0);
    const summary = events.find((e) => e.type === 'summary');
    expect(summary, 'no summary event').toBeDefined();
    expect(summary.total).toBeGreaterThan(0);
    const sse = events.find((e) => e.type === 'execution_results_manifest');
    expect(sse, 'no execution_results_manifest event').toBeDefined();
    expect(sse.data.runId).toBe(manifest.runId);
    const parsed = sharedResults.ExecutionResultsManifestSchema.safeParse(manifest);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues).slice(0, 600)).toBe(true);
    expect(manifest.planId).toBe(planId); // FX-ST4: bare Muster plan_id
    expect(manifest.tenantSlug ?? SLUG).toBe(SLUG);
    expect(manifest.results.length).toBeGreaterThan(0);
  });

  test('POST /api/plan/results accepts the real manifest and updates the matching directives', () => {
    expect(ingest.status, JSON.stringify(ingest.body).slice(0, 600)).toBe(200);
    const byControl = new Map<string, any>(manifest.results.map((r: any) => [r.controlId, r]));
    expect(ingest.body.updated.length).toBeGreaterThan(0);
    for (const u of ingest.body.updated) expect(u.verdict).toBe(byControl.get(u.control_id)?.verdict);
    const planIds = new Set(directives.map((d) => d.control_id));
    for (const cid of ingest.body.unmatched) expect(planIds.has(cid)).toBe(false);
  });

  test("Muster's directive statuses update (GET /api/plan/status)", () => {
    expect(after.runId).toBe(manifest.runId);
    expect(after.total).toBe(directives.length);
    const reported = after.directives.filter((d: any) => d.verdict !== null);
    expect(reported.length).toBe(ingest.body.updated.length);
    expect(after.counts.pending).toBe(after.total - reported.length);
    expect(after.counts.pending).toBeLessThan(pendingBefore.counts.pending);
    const byControl = new Map<string, any>(manifest.results.map((r: any) => [r.controlId, r]));
    for (const d of reported) expect(d.verdict).toBe(byControl.get(d.control_id)?.verdict);
    // The scenario's gap control (IA.L2-3.5.3, not_met in Muster's input) got a verdict back.
    expect(after.directives.find((d: any) => d.control_id === 'IA.L2-3.5.3')?.verdict).not.toBeNull();
    console.log(
      `[FX-TE3] ${after.total} directives; ${reported.length} reported by Stamper run ${manifest.runId}; ` +
        `counts ${JSON.stringify(after.counts)}; ${ingest.body.unmatched.length} Stamper controls without a plan directive`,
    );
  });
});
