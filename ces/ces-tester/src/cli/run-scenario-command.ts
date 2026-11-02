// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runScenario } from '../stacksim-client/cli.js';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { waitUntilReady } from '../stacksim-client/ready-check.js';
import { queryLedger, DEFAULT_STACKSIM_SERVER_URL } from '../stacksim-client/http.js';
import { launchStamperTranslateAndExecute } from '../stamper-launcher/launch.js';
import { mergeSimLaunchEnv } from '../stamper-launcher/env.js';
import { writeSyntheticStamperEnv } from '../stamper-launcher/synthetic-env.js';
import { startDevServer, waitForDevServerReady, devServerBaseUrl } from '../muster-driver/dev-server.js';
import { driveMuster } from '../muster-driver/drive-muster.js';
import { evaluateMidPipelineAssertion } from '../muster-driver/mid-pipeline-assertion.js';
import { buildScenarioResult, type ResultAssertion, type DivergedCommand } from '../results/result-shape.js';
import { writeScenarioResult } from '../results/write-result.js';
import {
  createTenantRegistry,
  createEphemeralSimTenant,
  teardownEphemeralSimTenant,
  getSimLaunchEnv,
} from '../tenant-registry/index.js';
import { verifyExpectedState } from '../verifier/expectedState.js';
import {
  loadScenarioFile,
  answerMapEntries,
  midPipelineSpecs,
  musterPlanCase,
  type ScenarioFile,
} from '../scenarios/scenarioFile.js';
import { generatePlanFromMuster } from '../flow/muster-plan-source.js';
import { simOnlyEnvViolations } from '../flow/sim-only-guard.js';

/**
 * G-TESTER-2 M3 tasks 2-4: the GENERALIZED scenario lifecycle — run-m2's
 * proven chain (scenario wipe+seed -> ces-tenant ephemeral registration ->
 * serve + ready-check -> planner dev server -> Playwright Muster drive ->
 * mid-pipeline assertions -> Stamper translate+execute -> structured
 * expected_state verification -> result.json -> teardown), parameterized by a
 * validated scenario FILE instead of hardcoded constants. run-m2 is now a
 * thin wrapper over this with scenarios/clean-tenant-mfa-baseline.json.
 *
 * M1's stacksim ready-check and M2's dev-server readiness gate are inherited
 * unchanged (PLAN.md M3 task 3: do not drop either) — that is what keeps
 * run-all non-flaky across scenarios.
 */
export interface RunScenarioOptions {
  scenarioPath: string;
  stacksimRoot: string;
  plannerRoot: string;
  stamperRoot: string;
  runsRoot: string;
  runId: string;
  runWorkspaceDir: string;
  headless?: boolean;
  plannerPort?: number;
  registryRoot?: string;
  /** PLAN.md M3 task 3: preserve stacksim tenant + serve + workspace state on
   * failure for manual triage (skips serve stop + tenant teardown). */
  keepOnFailure?: boolean;
  /** Flow-through MS-R10: ces-tester checkout root, for the Muster-generator
   * plan source (vite-node + vitest.config.ts live here). Defaults to cwd. */
  testerRoot?: string;
}

export interface RunScenarioResult {
  scenarioId: string;
  resultPath: string;
  status: 'pass' | 'fail';
  /** True when keepOnFailure held teardown open (serve still running). */
  statePreserved: boolean;
}

async function ensureDir(p: string): Promise<string> {
  await fs.mkdir(p, { recursive: true });
  return p;
}

/** Count the SET-bearing sub-commands in a translated executable plan — the
 * plan-composition guard (loop-board finding: a zero-SET plan makes a sweep
 * vacuously green; every verdict now records what it actually exercised). */
export function countSetSubs(plan: unknown): number {
  const graph = (plan as { execution_graph?: Array<{ action?: { args?: { _sub_commands?: Array<{ set_command?: string }> } } }> })
    ?.execution_graph ?? [];
  let n = 0;
  for (const t of graph) {
    for (const s of t.action?.args?._sub_commands ?? []) {
      if (s.set_command && s.set_command.trim() !== '') n++;
    }
  }
  return n;
}

export async function runScenarioCommand(opts: RunScenarioOptions): Promise<RunScenarioResult> {
  const scenario: ScenarioFile = await loadScenarioFile(opts.scenarioPath);
  const scenarioId = scenario.scenario_id;
  const startedAt = new Date();
  const scenariosDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ces-tester-scn-'));
  const assertions: ResultAssertion[] = [];
  const diverged: DivergedCommand[] = [];
  const artifactsDir = await ensureDir(path.join(opts.runWorkspaceDir, 'artifacts'));

  // 1. stacksim: materialize + scenario (wipe + seed) — before serve (S1 lock).
  await runScenario(
    { stacksimRoot: opts.stacksimRoot },
    scenariosDir,
    scenarioId,
    scenario.stacksim_seed!,
    scenario.description ?? `ces-tester scenario ${scenarioId}`,
  );

  const registry = createTenantRegistry({
    registryRoot: opts.registryRoot,
    stacksimRoot: opts.stacksimRoot,
  });
  await createEphemeralSimTenant(registry, scenarioId, scenario.stacksim_seed!);

  let serveHandle: ServeHandle | undefined;
  let devServer: ReturnType<typeof startDevServer> | undefined;
  let statePreserved = false;
  let planSource: Record<string, unknown> | undefined;

  const finish = async (setSubCount?: number): Promise<RunScenarioResult> => {
    const ledgerRef = await snapshotLedger(opts, scenarioId, DEFAULT_STACKSIM_SERVER_URL);
    const result = buildScenarioResult({
      scenarioId,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      assertions,
      divergedCommands: diverged,
      stacksimLedgerRef: ledgerRef,
      setSubCount,
      planSource,
    });
    const resultPath = await writeScenarioResult(opts.runsRoot, opts.runId, result);
    statePreserved = result.status === 'fail' && !!opts.keepOnFailure;
    return { scenarioId, resultPath, status: result.status, statePreserved };
  };

  try {
    // 2. serve + ready-check (inherited, unchanged; serve output captured to
    // the workspace so a mid-run serve death is diagnosable — gp-m1 finding).
    serveHandle = await startServe({
      stacksimRoot: opts.stacksimRoot,
      stance: scenario.stacksim_seed!.stance,
      slug: scenarioId,
      logPath: path.join(await ensureDir(opts.runWorkspaceDir), 'stacksim-serve.log'),
    });
    const serverUrl = DEFAULT_STACKSIM_SERVER_URL;
    await waitUntilReady({
      serverUrl,
      method: 'GET',
      uri: '/v1.0/identity/conditionalAccess/policies',
    });

    // 3+4. Mission Plan source. Flow-through MS-R10: a scenario carrying
    // muster.plan_source takes its plan from ces-muster's REAL generator
    // (no planner dev server, no wizard); every other scenario keeps the
    // legacy ces-planner wizard path unchanged.
    let missionPlanPath: string;
    let manifestPath: string;
    const musterCase = musterPlanCase(scenario);
    if (musterCase) {
      const gen = await generatePlanFromMuster({
        testerRoot: opts.testerRoot ?? process.cwd(),
        planCase: musterCase.planCase,
        outDir: artifactsDir,
        slug: scenarioId,
        logPath: path.join(opts.runWorkspaceDir, 'muster-plan-gen.log'),
      });
      ({ missionPlanPath, manifestPath } = gen);
      planSource = {
        kind: 'muster-generator',
        ...gen.provenance,
        mission_plan: path.basename(missionPlanPath),
        tenant_manifest: path.basename(manifestPath),
        unmapped_answer_map_rows: musterCase.unmapped,
      };
      console.log(
        `PLAN SOURCE: ces-muster ${gen.provenance.generator}#${gen.provenance.generatorFn} @ ${gen.provenance.musterHead} ` +
          `(not ces-planner) -> ${path.basename(missionPlanPath)}` +
          (musterCase.unmapped.length ? ` [answer_map rows with no Muster-generator input: ${musterCase.unmapped.join(', ')}]` : ''),
      );
    } else {
      // 3. planner dev server + readiness poll (inherited, unchanged).
      const plannerPort = opts.plannerPort ?? 5173;
      devServer = startDevServer({
        plannerRoot: opts.plannerRoot,
        port: plannerPort,
        graphBaseUrl: `${serverUrl}/v1.0`,
      });
      const plannerBaseUrl = devServerBaseUrl(plannerPort);
      await waitForDevServerReady(plannerBaseUrl);

      // 4. Playwright: drive the wizard with the SCENARIO's answer map.
      ({ missionPlanPath, manifestPath } = await driveMuster({
        baseUrl: plannerBaseUrl,
        customerName: `ces-tester-${opts.runId}-${scenarioId}`,
        answerMap: answerMapEntries(scenario),
        stamperTargetDir: artifactsDir,
        headless: opts.headless ?? true,
      }));
      planSource = { kind: 'ces-planner-wizard' };
    }
    const missionPlan = JSON.parse(await fs.readFile(missionPlanPath, 'utf8'));

    // 5. mid-pipeline assertions from the scenario file — fail fast on miss.
    for (const spec of midPipelineSpecs(scenario)) {
      const r = evaluateMidPipelineAssertion(missionPlan, spec);
      assertions.push({ stage: 'mid_pipeline', check: r.name, result: r.pass ? 'pass' : 'fail', actual: r.detail });
    }
    if (assertions.some((a) => a.result === 'fail')) {
      return await finish();
    }

    // 6. Stamper translate + execute (env from ces-tenant, unchanged).
    const outputPath = path.join(artifactsDir, 'executable-plan.json');
    const stamperStorageRoot = await ensureDir(path.join(opts.runWorkspaceDir, 'stamper-storage'));
    const envFilePath = await writeSyntheticStamperEnv(opts.runWorkspaceDir, {
      storageRoot: stamperStorageRoot,
    });
    const simLaunchEnv = await getSimLaunchEnv(registry, scenarioId, {
      stacksimRoot: opts.stacksimRoot,
    });
    const stamperChildEnv = mergeSimLaunchEnv({ simLaunchEnv });
    // Flow-through ground rule 1: refuse to launch Stamper unless the child env
    // is sim-only by construction (loopback STACKSIM_SERVER_URL, stacksim-only
    // PSModulePath). A violation aborts before any command runs.
    const simViolations = simOnlyEnvViolations(stamperChildEnv, opts.stacksimRoot);
    if (simViolations.length > 0) {
      throw new Error(`SIM-ONLY guard: refusing to launch Stamper: ${simViolations.join('; ')}`);
    }
    console.log(`SIM-ONLY guard: Stamper env ok (STACKSIM_SERVER_URL=${stamperChildEnv.STACKSIM_SERVER_URL}; PSModulePath stacksim-only)`);

    const stamperRun = await launchStamperTranslateAndExecute({
      stamperRoot: opts.stamperRoot,
      // Flow-through: run Stamper inside this run's workspace so relative
      // evidence writes (Export-Csv ...) never land in the ces-stamper repo.
      workDir: await ensureDir(path.join(opts.runWorkspaceDir, 'stamper-cwd')),
      env: stamperChildEnv,
      missionPlanPath,
      manifestPath,
      tenantSlug: scenarioId,
      outputPath,
      envFilePath,
    });
    await fs.writeFile(
      path.join(opts.runWorkspaceDir, 'stamper-translate.log'),
      `${stamperRun.translate.stdout}
--- stderr
${stamperRun.translate.stderr}`,
      'utf8',
    );
    await fs.writeFile(
      path.join(opts.runWorkspaceDir, 'stamper-execute.log'),
      `${stamperRun.execute.stdout}
--- stderr
${stamperRun.execute.stderr}`,
      'utf8',
    );
    const setSubCount = countSetSubs(JSON.parse(await fs.readFile(outputPath, 'utf8')));

    // 7. structured expected_state verification (per-assertion; divergence
    // from a REAL /ledger query on mismatch).
    const verdict = await verifyExpectedState(serverUrl, scenario.expected_state?.checks ?? []);
    assertions.push(...verdict.assertions);
    diverged.push(...verdict.diverged);

    return await finish(setSubCount);
  } finally {
    const preserve = statePreserved;
    if (devServer && !preserve) await devServer.stop();
    if (serveHandle && !preserve) await serveHandle.stop();
    if (!preserve) await teardownEphemeralSimTenant(registry, scenarioId);
    if (preserve) {
      console.log(
        `--keep-on-failure: stacksim serve + ephemeral tenant "${scenarioId}" + workspace preserved for triage (${opts.runWorkspaceDir})`
      );
    }
  }
}

async function latestArtifact(artifactsDir: string, type: string): Promise<string> {
  const plansDir = path.join(artifactsDir, 'plans');
  const entries = await fs.readdir(plansDir);
  const matches = entries.filter((f) => f.startsWith(`${type}-`) && f.endsWith('.json')).sort();
  if (matches.length === 0) throw new Error(`no "${type}-*.json" artifact in ${plansDir}`);
  return path.join(plansDir, matches[matches.length - 1]);
}

async function snapshotLedger(opts: RunScenarioOptions, scenarioId: string, serverUrl: string): Promise<string> {
  try {
    const entries = await queryLedger(serverUrl, {});
    const relPath = path.join(opts.runId, scenarioId, 'ledger-snapshot.json');
    const absPath = path.join(opts.runsRoot, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, JSON.stringify(entries, null, 2), 'utf8');
    return relPath.split(path.sep).join('/');
  } catch {
    return '(ledger snapshot unavailable)';
  }
}