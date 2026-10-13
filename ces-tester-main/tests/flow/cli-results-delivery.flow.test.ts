// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Flow-through FX-TE4 — Stamper CLI results manifest + Stamper -> Muster delivery
 * (ces-stamper FX-ST6 `9a482aa`; closes REQ-STAMPER-CLI-NO-RESULTS-MANIFEST).
 *
 * Opt-in integration (Windows PowerShell + tenant-stacksim): CES_TESTER_FLOW_LIVE=1.
 *
 * Every hop is production code; nothing is hand-built:
 *   1. Muster's REAL generator (X2 scenario `clean-tenant-mfa-baseline` input)
 *      -> pushed through muster-api's real app (`createApp`, src), started
 *      locally on 127.0.0.1 with a JWT minted by muster-api's own `mintToken`
 *      (as muster-api's tests and FX-TE3 do).
 *   2. Stamper `translate` (dist CLI) on the pushed files.
 *   3. Stamper CLI `execute --mode auto --tenant <slug>` against stacksim with
 *      CES_MUSTER_API_URL=http://127.0.0.1:<port> + CES_MUSTER_API_TOKEN, three
 *      times, each with its own STORAGE_ROOT (Stamper state is keyed by plan):
 *        a. --dry-run      -> manifest written, delivery `skipped` (dry_run), Muster unchanged;
 *        b. live           -> manifest written, delivery `delivered`, Muster's directive
 *                             statuses update with NO tester POST to /plan/results;
 *        c. live, Muster stopped -> delivery `failed`, the run is not failed by it
 *                             (same exit code + report as b), manifest and
 *                             `.delivery.json` left for a retry.
 *
 * SIM-ONLY: stacksim + a temp CES_PIPELINE_ROOT; CES_AO_ALLOW_LIVE and
 * CES_MUSTER_ALLOW_REMOTE are never set (asserted on the child env).
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
import { executeWithStamperCli, parseCliReportPath, translateWithStamperCli } from '../../src/flow/results-loop-flow.js';
import { loadScenarioFile, musterPlanCase } from '../../src/scenarios/scenarioFile.js';
import { queryLedger } from '../../src/stacksim-client/http.js';
import { writeSyntheticStamperEnv } from '../../src/stamper-launcher/synthetic-env.js';

const LIVE = process.env.CES_TESTER_FLOW_LIVE === '1' && process.platform === 'win32';
if (!LIVE) console.log('[FX-TE4] skipped: set CES_TESTER_FLOW_LIVE=1 on Windows (needs PowerShell + tenant-stacksim)');
const CES_ROOT = LIVE ? findCesRoot() : '';
const TESTER_ROOT = path.resolve(__dirname, '..', '..');
const SLUG = 'ft-te4-cli';
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(CES_ROOT, rel)).href);

function head(repo: string): string {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '(unknown)';
  }
}

interface CliRun {
  label: string;
  exitCode: number;
  stdout: string;
  manifest: any;
  manifestPath: string;
  delivery: any;
  report: any;
  ledgerMutations: number;
  env: NodeJS.ProcessEnv;
}

describe.skipIf(!LIVE)('FX-TE4 FX-ST6: Stamper CLI results manifest + delivery to Muster [opt-in CES_TESTER_FLOW_LIVE=1]', () => {
  let workDir: string;
  let sim: SimTenants;
  let muster: Server | undefined;
  let base: string;
  let token: string;
  let plan: MusterPlanOutput;
  let planId: string;
  let directives: Array<{ control_id: string; directive: string }>;
  let execPlan: string;
  let stateDir: string;
  let sharedResults: any;
  let pendingBefore: any;
  let afterDry: any;
  let afterLive: any;
  let dry: CliRun;
  let live: CliRun;
  let down: CliRun;
  let resultsPostsSeen = 0;
  const prev = { pipeline: process.env.CES_PIPELINE_ROOT, tenantRoot: process.env.CES_TENANT_ROOT, jwt: process.env.JWT_SECRET };

  const api = (p: string, init: RequestInit = {}) =>
    fetch(`${base}/api${p}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  const status = async () =>
    (await (await api(`/plan/status?tenant_slug=${SLUG}&plan_id=${encodeURIComponent(planId)}`)).json()) as any;

  /** One CLI execute with its own storage root; snapshots the manifest + delivery record it left. */
  async function runCli(label: string, opts: { dryRun: boolean }): Promise<CliRun> {
    const runDir = path.join(workDir, `run-${label}`);
    const storageRoot = path.join(runDir, 'stamper-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const envFilePath = await writeSyntheticStamperEnv(runDir, { storageRoot });
    const env = guardedSimChildEnv(sim, { storageRoot });
    env.CES_MUSTER_API_URL = base;
    env.CES_MUSTER_API_TOKEN = token;
    for (const k of Object.keys(env)) {
      if (/^CES_MUSTER_ALLOW_REMOTE$/i.test(k) || /^CES_AO_ALLOW_LIVE$/i.test(k)) delete env[k];
    }
    for (const f of fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : []) {
      if (f.startsWith('execution-results-')) fs.rmSync(path.join(stateDir, f));
    }
    const ledgerBefore = await queryLedger(sim.simUrl, {});
    const r = await executeWithStamperCli({
      stamperRoot: path.join(CES_ROOT, 'ces-stamper'),
      planPath: execPlan,
      tenantSlug: SLUG,
      envFilePath,
      dryRun: opts.dryRun,
      cwd: path.join(runDir, 'stamper-cwd'),
      env,
    });
    const ledgerAfter = await queryLedger(sim.simUrl, {});
    fs.writeFileSync(path.join(runDir, 'stamper-execute.log'), `${r.stdout}\n--- stderr\n${r.stderr}`);
    const files = fs.existsSync(stateDir) ? fs.readdirSync(stateDir).filter((f) => f.startsWith('execution-results-')) : [];
    const manifestName = files.find((f) => !f.endsWith('.delivery.json'));
    const deliveryName = files.find((f) => f.endsWith('.delivery.json'));
    if (!manifestName || !deliveryName) {
      throw new Error(
        `[${label}] expected a manifest + .delivery.json in ${stateDir}, found [${files.join(', ')}] (exit ${r.exitCode}):\n` +
          `${r.stdout.slice(-2000)}\n${r.stderr.slice(-1000)}`,
      );
    }
    const reportPath = parseCliReportPath(r.stdout);
    const run: CliRun = {
      label,
      exitCode: r.exitCode,
      stdout: r.stdout,
      manifestPath: path.join(stateDir, manifestName),
      manifest: JSON.parse(fs.readFileSync(path.join(stateDir, manifestName), 'utf8')),
      delivery: JSON.parse(fs.readFileSync(path.join(stateDir, deliveryName), 'utf8')),
      report: reportPath && fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : undefined,
      ledgerMutations: ledgerAfter
        .slice(ledgerBefore.length)
        .filter((e) => e.type === 'mutate' || e.type === 'create').length,
      env,
    };
    fs.writeFileSync(path.join(runDir, 'snapshot.json'), JSON.stringify({ ...run, stdout: undefined, env: undefined }, null, 1));
    console.log(
      `[FX-TE4] ${label}: exit ${run.exitCode}; manifest ${manifestName} (${run.manifest.results?.length ?? 0} results); ` +
        `delivery ${run.delivery.status}${run.delivery.httpStatus ? ` HTTP ${run.delivery.httpStatus}` : ''}` +
        `${run.delivery.reason ? ` (${run.delivery.reason})` : ''}${run.delivery.error ? ` (${run.delivery.error})` : ''}; ` +
        `ledger mutations ${run.ledgerMutations}; report ${run.report?.status ?? '(none)'}`,
    );
    return run;
  }

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-te4-'));
    console.log(
      `[FX-TE4] upstream: ces monorepo@${head(CES_ROOT)} (ces-stamper dist, ces-shared dist, tenant-stacksim) ` +
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
      log: (l) => console.log(`[FX-TE4] ${l}`),
    });
    stateDir = path.join(sim.pipelineRoot, 'Stamper', 'plan-data', SLUG, 'state');

    plan = await generateMusterPlan({ ...mc.planCase, id: SLUG }, CES_ROOT);
    planId = plan.missionPlan.outputs.human_readable_mission_plan.plan_id;
    directives = plan.missionPlan.outputs.human_readable_mission_plan.control_directives;

    // muster-api's real app on 127.0.0.1, sharing the temp CES_PIPELINE_ROOT.
    process.env.CES_PIPELINE_ROOT = sim.pipelineRoot;
    process.env.CES_TENANT_ROOT = sim.registryRoot;
    process.env.JWT_SECRET = 'ces-tester-fx-te4-local-only';
    const { createApp } = await imp('ces-muster/muster-api/src/app.ts');
    const { mintToken } = await imp('ces-muster/muster-api/src/lib/jwt.ts');
    token = mintToken({ sub: 'ces-tester-fx-te4', tenant_id: '00000000-0000-0000-0000-00000000fe04', party_id: null, role: 'bhd_operator' });
    muster = createApp().listen(0, '127.0.0.1') as Server;
    await new Promise<void>((r) => muster!.once('listening', () => r()));
    // Count every POST /api/plan/results that reaches Muster: only Stamper sends one here.
    // Prepended: Express's own listener rewrites req.url under its `/api` mount.
    muster.prependListener('request', (req) => {
      if (req.method === 'POST' && (req.url ?? '').startsWith('/api/plan/results')) resultsPostsSeen++;
    });
    base = `http://127.0.0.1:${(muster!.address() as AddressInfo).port}`;

    const push = await api('/plan/push', {
      method: 'POST',
      body: JSON.stringify({ tenant_slug: SLUG, missionPlan: plan.missionPlan, tenantManifest: plan.tenantManifest }),
    });
    const pushed = (await push.json()) as any;
    if (push.status !== 201) throw new Error(`muster-api push -> ${push.status}: ${JSON.stringify(pushed)}`);
    pendingBefore = await status();

    const translateEnv = guardedSimChildEnv(sim, { storageRoot: path.join(workDir, 'translate-storage') });
    const translateCwd = path.join(workDir, 'translate-cwd');
    fs.mkdirSync(translateCwd, { recursive: true });
    execPlan = path.join(workDir, 'executable-plan.json');
    const translate = await translateWithStamperCli({
      stamperRoot: path.join(CES_ROOT, 'ces-stamper'),
      missionPlanPath: path.join(pushed.plansDir, pushed.pushed[0]),
      manifestPath: path.join(pushed.plansDir, pushed.pushed[1]),
      tenantSlug: SLUG,
      outputPath: execPlan,
      cwd: translateCwd,
      env: translateEnv,
    });
    fs.writeFileSync(path.join(workDir, 'stamper-translate.log'), translate.stdout + translate.stderr);

    sharedResults = await import(
      pathToFileURL(path.join(CES_ROOT, 'ces-shared', 'dist', 'types', 'execution-results.contract.js')).href
    );

    // a. dry run (Muster up): never delivered.
    dry = await runCli('dry', { dryRun: true });
    afterDry = await status();
    // b. live run (Muster up): delivered by Stamper itself.
    live = await runCli('live', { dryRun: false });
    afterLive = await status();
    // c. Muster stopped: delivery fails, the run does not.
    muster.closeAllConnections();
    await new Promise<void>((r) => muster!.close(() => r()));
    muster = undefined;
    down = await runCli('muster-down', { dryRun: false });
  }, 3_600_000);

  afterAll(async () => {
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

  test('sim-only: loopback Muster URL, no remote/live opt-ins in any Stamper child env', () => {
    for (const run of [dry, live, down]) {
      expect(new URL(run.env.CES_MUSTER_API_URL!).hostname).toBe('127.0.0.1');
      expect(Object.keys(run.env).some((k) => /^CES_MUSTER_ALLOW_REMOTE$/i.test(k))).toBe(false);
      expect(Object.keys(run.env).some((k) => /^CES_AO_ALLOW_LIVE$/i.test(k))).toBe(false);
      expect(run.env.STACKSIM_SERVER_URL).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/);
    }
  });

  test('REQ-STAMPER-CLI-NO-RESULTS-MANIFEST: the CLI path writes a results manifest that parses with the shared schema', () => {
    for (const run of [dry, live, down]) {
      const parsed = sharedResults.ExecutionResultsManifestSchema.safeParse(run.manifest);
      expect(parsed.success, `${run.label}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues).slice(0, 600)}`).toBe(true);
      expect(run.manifest.planId).toBe(planId);
      expect(run.manifest.tenantSlug ?? SLUG).toBe(SLUG);
      expect(run.manifestPath.startsWith(stateDir)).toBe(true);
      expect(run.stdout).toContain(`Execution results manifest (tenant ${SLUG})`);
    }
    expect(live.manifest.results.length).toBeGreaterThan(0);
    expect(live.ledgerMutations).toBeGreaterThan(0);
  });

  test('a dry run is NOT delivered: record says skipped/dry_run and Muster is unchanged', () => {
    expect(dry.delivery.status).toBe('skipped');
    expect(String(dry.delivery.reason)).toMatch(/dry_run/);
    expect(dry.delivery.httpStatus).toBeUndefined();
    expect(dry.ledgerMutations).toBe(0);
    expect(pendingBefore.counts.pending).toBe(directives.length);
    expect(afterDry.counts.pending).toBe(directives.length);
    expect(afterDry.runId ?? null).toBe(pendingBefore.runId ?? null);
  });

  test("a live run is delivered by Stamper and Muster's directive statuses update (no manual POST)", () => {
    expect(live.delivery.status, JSON.stringify(live.delivery).slice(0, 600)).toBe('delivered');
    expect(live.delivery.httpStatus).toBe(200);
    expect(new URL(live.delivery.endpoint).hostname).toBe('127.0.0.1');
    expect(live.delivery.runId).toBe(live.manifest.runId);
    // Exactly one results POST reached Muster before it was stopped: Stamper's (the dry run sent none,
    // and this test sends none).
    expect(resultsPostsSeen).toBe(1);

    expect(afterLive.runId).toBe(live.manifest.runId);
    expect(afterLive.total).toBe(directives.length);
    const byControl = new Map<string, any>(live.manifest.results.map((r: any) => [r.controlId, r]));
    const reported = afterLive.directives.filter((d: any) => d.verdict !== null);
    expect(reported.length).toBeGreaterThan(0);
    expect(afterLive.counts.pending).toBe(afterLive.total - reported.length);
    expect(afterLive.counts.pending).toBeLessThan(pendingBefore.counts.pending);
    for (const d of reported) expect(d.verdict).toBe(byControl.get(d.control_id)?.verdict);
    const updated = live.delivery.response?.updated ?? [];
    expect(updated.length).toBe(reported.length);
    expect(afterLive.directives.find((d: any) => d.control_id === 'IA.L2-3.5.3')?.verdict).not.toBeNull();
    console.log(
      `[FX-TE4] live: ${afterLive.total} directives; ${reported.length} reported by Stamper run ${live.manifest.runId}; ` +
        `counts ${JSON.stringify(afterLive.counts)}; ${live.delivery.response?.unmatched?.length ?? 0} unmatched`,
    );
  });

  test('Muster stopped: delivery fails, the run is not failed by it, the manifest and .delivery.json remain', () => {
    expect(down.delivery.status).toBe('failed');
    expect(String(down.delivery.error)).toMatch(/ECONNREFUSED|fetch failed|connect/i);
    expect(down.delivery.manifestPath).toBe(down.manifestPath);
    expect(fs.existsSync(down.manifestPath)).toBe(true);
    expect(fs.existsSync(down.manifestPath.replace(/\.json$/, '.delivery.json'))).toBe(true);
    // Same plan, same sim: the exit code and report status match the delivered run's.
    expect(down.exitCode).toBe(live.exitCode);
    expect(down.report, 'no saved execution report').toBeDefined();
    expect(down.report.status).toBe(live.report.status);
    expect(down.report.resultsManifest?.delivery?.status).toBe('failed');
  });
});
