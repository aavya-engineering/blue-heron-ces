#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.


import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as os from 'os';
import inquirer from 'inquirer';
import { fileURLToPath } from 'node:url';
import { StamperConfig } from '../config/StamperConfig.js';
import { StamperEngine } from '../core/StamperEngine.js';
import { ExecutionReporter } from '../reporting/ExecutionReporter.js';
import { translateForTenant } from '../translators/translateForTenant.js';
import { StamperTUI } from '../tui/StamperTUI.js';
import { BHD_BANNER_LINES } from '../config/provenance.js';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../config/ClientConfig.js';
import { listTenantRecordsWithPaths } from '../tenant/stamperTenants.js';
import { assertDistFreshAtStartup } from '../utils/distFreshness.js';
import { ExecutionResultsCollector } from '../core/ExecutionResultsCollector.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { publishExecutionResults, recordTaskStatuses, resolveResultsTenantSlug } from '../core/ExecutionResultsPublisher.js';
import type { ExecutionReport } from '../core/StamperEngine.js';
import { buildCliExecutionInputs, cliResultsTasks, decideForceFail, lookupTenantKind, type CliExecutionInputs } from './cliExecutionContext.js';
import { executeForTenant, type ExecuteForTenantInput } from '../core/executeForTenant.js';
import { BOOTSTRAP_PWSH, describeBootstrapSpawnError, deriveTenantSlug, readBootstrapResult, writeBootstrapTenantRecord } from './bootstrapTenantRecord.js';
import { buildCostAckCommand } from './costAckCommand.js';
import { setProcessCostGateRuntime, terminalDp2Prompt } from '../adapters/CostGateDp2.js';
import { initModuleSecrets } from 'ces-shared/secrets';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FX-ST2 / MS-R12: refuse to run a built CLI older than its src (fails loudly).
assertDistFreshAtStartup(__dirname);

// FIN-42 (SP-4): load the DPAPI module-secret store once, before any command runs, so the secret view
// (secretEnv(): primeMusterSecrets, fetchMusterSecrets) sees it. No store: the environment, as before.
// A present but unreadable store fails closed here.
initModuleSecrets();

function printBanner(): void {
  console.log('='.repeat(70));
  for (const line of BHD_BANNER_LINES) {
    console.log(line);
  }
  console.log('='.repeat(70));
  console.log('');
}

/**
 * FX-ST6 / REQ-STAMPER-CLI-NO-RESULTS-MANIFEST: after a CLI run, build the
 * shared execution-results manifest from the run's task states (production
 * builder), write it to <CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/,
 * where EO reads it. Never fails the run: a manifest write error is printed and
 * recorded in the report.
 */
async function publishCliResults(engine: StamperEngine, report: ExecutionReport, tenant: string | undefined, dryRun: boolean): Promise<void> {
  const plan = engine.getPlan();
  if (!plan) return;
  try {
    const { stateManager, postcheckRunner } = engine.getTuiDependencies();
    const collector = new ExecutionResultsCollector();
    recordTaskStatuses(
      collector,
      // W9 FG-6: a manual gate credits only its own entries' controls (same rule as the server route).
      cliResultsTasks(plan.execution_graph),
      (id) => stateManager.getTaskState(id)?.status,
      (plan.variables?._control_directives as Record<string, string> | undefined) ?? {},
      // synthetic-customer W3: a manual gate with no operator action is PROVISIONAL, never SAT.
      (id) => (stateManager.getTaskState(id)?.outputs as Record<string, unknown> | undefined)?.gateAction === 'none',
      // PH-11 (founder Q3): a read-only prohibition whose reads showed nothing is NOT MET (GUI parity).
      (id) => (stateManager.getTaskState(id)?.outputs as Record<string, unknown> | undefined)?.prohibitionShown === false,
      // PH-13 (founder Q3): a registry task one of whose evidence reads showed nothing is NOT_SAT (GUI parity).
      (id) => (stateManager.getTaskState(id)?.outputs as Record<string, unknown> | undefined)?.evidenceShown === false,
    );
    const slug = resolveResultsTenantSlug(plan as any, tenant);
    const published = await publishExecutionResults(collector, plan as any, slug);
    console.log(`Execution results manifest (tenant ${slug}): ${published.manifestPath}`);
    // synthetic-customer W3: the postcheck results, each labelled state / presence / manual.
    if (!dryRun) {
      const pcResults = postcheckRunner.getResults();
      const pcPath = path.join(path.dirname(published.manifestPath), `postcheck-results-${plan.plan_id}.json`);
      writeJsonArtifact(pcPath, {
        planId: plan.plan_id,
        tenantSlug: slug,
        writtenAt: new Date().toISOString(),
        counts: {
          total: pcResults.length,
          byMode: pcResults.reduce((m, r) => ((m[r.mode ?? 'unlabelled'] = (m[r.mode ?? 'unlabelled'] ?? 0) + 1), m), {} as Record<string, number>),
          byOutcome: pcResults.reduce((m, r) => { const k = `${r.mode ?? 'unlabelled'}:${r.outcome ?? (r.passed ? 'pass' : 'fail')}`; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>),
        },
        results: pcResults,
      });
      console.log(`Postcheck results: ${pcPath}`);
    }
    (report as ExecutionReport & { resultsManifest?: unknown }).resultsManifest = {
      path: published.manifestPath,
      tenantSlug: slug,
      totalControls: published.manifest.totalControls,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Execution results manifest not written: ${msg}`);
    report.recommendations.push(`Execution results manifest not written: ${msg}`);
  }
}

/**
 * Gap closure API-6: the CLI's executeForTenant() input for `execute` and `resume`: one process
 * per command (no persistent session), muster-api secret references primed (FLOW-5), no tenant
 * variables.json restore, lines printed to the console.
 */
function cliExecuteForTenantInput(engine: StamperEngine, planPath: string, cliInputs: CliExecutionInputs, forceFail: string[]): ExecuteForTenantInput {
  return {
    mode: 'cli',
    engine,
    planPath,
    tenantSlug: cliInputs.tenantSlug,
    executionContext: cliInputs.executionContext,
    session: { kind: 'per-command' },
    primeMusterSecrets: true,
    restoreTenantVariables: false,
    forceFail,
    log: (line: string) => console.log(line),
  };
}

/** P3 test flag `--force-fail <entryId>` (repeatable). */
const collectForceFail = (value: string, previous: string[]): string[] => previous.concat([value]);
const FORCE_FAIL_HELP = 'Test flag (repeatable): every task that runs this registry entry fails after its GET, without its SET. Simulator tenants only, unless --i-know-this-is-a-test';
const FORCE_FAIL_ACK_HELP = 'Allow --force-fail on a tenant that is not a kind:sim registry record';

/** P3: refuse --force-fail unless the tenant is a simulator or the test flag is acknowledged. */
async function guardForceFail(entryIds: string[], acknowledged: boolean, tenantSlug: string | undefined): Promise<void> {
  if (entryIds.length === 0) return;
  const decision = decideForceFail({ entryIds, acknowledged, tenantSlug, tenantKind: await lookupTenantKind(tenantSlug) });
  if (!decision.allowed) {
    console.error(decision.message);
    process.exit(1);
  }
  console.warn(decision.message);
}

/** W4-ST3: counts for `stamper report` from a shared execution-results manifest. */
function summarizeResultsManifest(m: any) {
  const results: any[] = Array.isArray(m?.results) ? m.results : [];
  const count = (key: string) => results.reduce<Record<string, number>>((acc, r) => {
    const k = String(r?.[key] ?? 'unknown');
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  return {
    planId: m?.planId,
    executablePlanId: m?.executablePlanId,
    runId: m?.runId,
    tenantSlug: m?.tenantSlug,
    completedAt: m?.completedAt,
    contractVersion: m?.contractVersion,
    totalControls: m?.totalControls ?? results.length,
    byVerdict: count('verdict'),
    byDirective: count('directive'),
  };
}

const program = new Command();

program
  .name('stamper')
  .description('Blue Heron Defense Compliance Engine — CMMC Orchestration built for Example Defense Co')
  .version('0.1.0');

program
  .command('execute [plan]')
  .description('Execute an Executable Mission Plan')
  .option('-e, --env <path>', 'Path to .env file')
  .option('-d, --dry-run', 'Run in dry-run mode (validate only, do not execute)')
  .option('--mode <mode>', 'Execution mode: manual (default) or auto', 'manual')
  .option('--dev', 'Dev/test mode: auto-loads synthetic fixtures, forces dry-run, no .env required')
  .option('--full', 'Use full-registry fixtures (all 118 commands) instead of small synthetic set. Requires --dev')
  .option('--tenant <slug>', 'Tenant slug for variable resolution, evidence folder and the execution-results manifest (default: plan tenant, else "dev")')
  .option('--force-fail <entryId>', FORCE_FAIL_HELP, collectForceFail, [] as string[])
  .option('--i-know-this-is-a-test', FORCE_FAIL_ACK_HELP)
  .action(async (planArg: string | undefined, options: { env?: string; dryRun?: boolean; mode?: string; dev?: boolean; full?: boolean; tenant?: string; forceFail?: string[]; iKnowThisIsATest?: boolean }) => {
    try {
      let planPath = planArg || '';

      const modeValue = options.mode ?? 'manual';

      if (modeValue !== 'auto' && modeValue !== 'manual') {
        console.error(`Error: --mode must be "manual" or "auto", got "${modeValue}"`);
        process.exit(1);
      }

      const mode = modeValue as 'auto' | 'manual';

      if (options.full && !options.dev) {
        console.error('Error: --full requires --dev mode');
        process.exit(1);
      }

      if (options.dev) {
        process.env.DRY_RUN = 'true';
        if (options.full) {
          const { FULL_REGISTRY_OUTPUT_PATH } = await import('../server/devFixtures.js');
          planPath = FULL_REGISTRY_OUTPUT_PATH;
          console.log('[DEV MODE — FULL REGISTRY] All 118 registry commands loaded. No credentials required.');
        } else {
          const { DEV_OUTPUT_PATH } = await import('../server/devFixtures.js');
          planPath = DEV_OUTPUT_PATH;
          console.log('[DEV MODE] Synthetic fixtures loaded. No credentials required.');
        }
      } else if (!planPath) {
        console.error('Error: <plan> argument is required (or use --dev for test mode)');
        process.exit(1);
      }

      // Override dry-run from CLI
      if (options.dryRun) {
        process.env.DRY_RUN = 'true';
      }

      const config = new StamperConfig(options.env);
      const engine = new StamperEngine(config);
      const reporter = new ExecutionReporter(config);

      printBanner();

      // FX-02: execution context + tenant slug, as the server execute route builds them.
      const resolvedPlanPath = path.resolve(planPath);
      const cliInputs = await buildCliExecutionInputs(resolvedPlanPath, options.tenant, config.dryRun || process.env.DRY_RUN === 'true');
      for (const warning of cliInputs.warnings) console.warn(`Warning: ${warning}`);
      const forceFail = options.forceFail ?? [];
      await guardForceFail(forceFail, Boolean(options.iKnowThisIsATest), cliInputs.tenantSlug);
      // Gap closure API-6: the one execute preparation path (the GUI route calls it too, in mode 'gui').
      const { plan } = await executeForTenant(cliExecuteForTenantInput(engine, resolvedPlanPath, cliInputs, forceFail));

      if (!options.dev) {
        const dryRunLabel = options.dryRun ? ' [DRY RUN]' : '';
        const preflightMessage = `Execute plan ${plan.plan_id} in ${mode.toUpperCase()} mode${dryRunLabel}? (Y/n)`;

        const preflightAnswer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message: preflightMessage,
            default: true
          }
        ]);

        if (!preflightAnswer.proceed) {
          console.log('Execution cancelled by operator.');
          process.exit(0);
        }
      }

      // GATE-RUN: DP-2 for a recurring SET is typed at this terminal in --mode manual; auto or headless refuses.
      setProcessCostGateRuntime({ mode, interactive: Boolean(process.stdin.isTTY), promptDp2: terminalDp2Prompt });
      const tui = new StamperTUI(plan, engine, config, mode, options.dryRun ?? false);
      const report = await tui.run();

      await publishCliResults(engine, report, options.tenant, config.dryRun || process.env.DRY_RUN === 'true');

      reporter.printReport(report);

      const { jsonPath, markdownPath } = reporter.saveReport(report);
      console.log(`Report saved:`);
      console.log(`  JSON: ${jsonPath}`);
      console.log(`  Markdown: ${markdownPath}`);

      if (report.status === 'failed') {
        process.exit(1);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${errorMsg}`);
      process.exit(1);
    }
  });

program
  .command('resume <plan>')
  .description('Resume a paused or failed execution: tasks already completed in the persisted state are not re-run')
  .option('-e, --env <path>', 'Path to .env file')
  .option('-d, --dry-run', 'Resume in dry-run mode')
  .option('--tenant <slug>', 'Tenant slug for variable resolution, evidence folder and the execution-results manifest (default: plan tenant, else "dev")')
  .option('--mode <mode>', 'Cost gate mode: manual (default; a recurring SET asks for DP-2 at this terminal) or auto (every recurring SET is refused)', 'manual')
  .option('--force-fail <entryId>', FORCE_FAIL_HELP, collectForceFail, [] as string[])
  .option('--i-know-this-is-a-test', FORCE_FAIL_ACK_HELP)
  .action(async (planPath: string, options: { env?: string; dryRun?: boolean; tenant?: string; mode?: string; forceFail?: string[]; iKnowThisIsATest?: boolean }) => {
    try {
      const resumeMode = options.mode ?? 'manual';
      if (resumeMode !== 'auto' && resumeMode !== 'manual') {
        console.error(`Error: --mode must be "manual" or "auto", got "${resumeMode}"`);
        process.exit(1);
      }
      if (options.dryRun) process.env.DRY_RUN = 'true';
      const config = new StamperConfig(options.env);
      const engine = new StamperEngine(config);
      const reporter = new ExecutionReporter(config);

      printBanner();
      // FX-02: execution context + tenant slug, as the server execute route builds them.
      const resolvedPlanPath = path.resolve(planPath);
      const cliInputs = await buildCliExecutionInputs(resolvedPlanPath, options.tenant, config.dryRun || process.env.DRY_RUN === 'true');
      for (const warning of cliInputs.warnings) console.warn(`Warning: ${warning}`);
      const forceFail = options.forceFail ?? [];
      await guardForceFail(forceFail, Boolean(options.iKnowThisIsATest), cliInputs.tenantSlug);
      // Gap closure API-6: the one execute preparation path (as `execute` above).
      const { plan } = await executeForTenant(cliExecuteForTenantInput(engine, resolvedPlanPath, cliInputs, forceFail));

      const { stateManager } = engine.getTuiDependencies();
      const prior = stateManager.getState();
      if (Object.keys(prior.tasks).length === 0) {
        console.error(`Nothing to resume: no execution state recorded for plan ${plan.plan_id}. Run "stamper execute" first.`);
        process.exit(1);
      }
      if (prior.status === 'completed') {
        console.error(`Nothing to resume: plan ${plan.plan_id} already completed.`);
        process.exit(1);
      }
      const done = plan.execution_graph.filter(t => ['completed', 'accomplished'].includes(stateManager.getTaskStatus(t.id)));
      console.log(`Resuming ${plan.plan_id} (prior status: ${prior.status}) - ${done.length}/${plan.execution_graph.length} task(s) already done, last executed: ${prior.last_executed_task_id ?? '(none)'}`);

      // FIN-15 (CG-4 remainder): resume gets the same cost runtime as execute. A recurring SET asks for
      // DP-2 at this terminal in --mode manual; --mode auto or no terminal refuses it (fail-closed).
      setProcessCostGateRuntime({ mode: resumeMode as 'manual' | 'auto', interactive: Boolean(process.stdin.isTTY), promptDp2: terminalDp2Prompt });

      const startTime = Date.now();
      let report: ExecutionReport;
      try {
        report = await engine.execute(true);
      } catch (err) {
        console.error(`Resume stopped: ${err instanceof Error ? err.message : String(err)}`);
        report = engine.generateReport(startTime);
      }

      await publishCliResults(engine, report, options.tenant, config.dryRun || process.env.DRY_RUN === 'true');
      reporter.printReport(report);
      const { jsonPath, markdownPath } = reporter.saveReport(report);
      console.log(`Report saved:`);
      console.log(`  JSON: ${jsonPath}`);
      console.log(`  Markdown: ${markdownPath}`);
      if (report.status === 'failed') process.exit(1);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${errorMsg}`);
      process.exit(1);
    }
  });

program
  .command('rollback <plan>')
  .description('Reverse the changes a (failed) execution applied, newest first. Sim-only: requires STACKSIM_SERVER_URL on loopback')
  .option('-e, --env <path>', 'Path to .env file')
  .action(async (planPath: string, options: { env?: string }) => {
    try {
      const config = new StamperConfig(options.env);
      const engine = new StamperEngine(config);
      // FX-02: tenant slug from the plan; rollback runs recorded, already-resolved commands, so no context.
      const resolvedPlanPath = path.resolve(planPath);
      const { tenantSlug } = await buildCliExecutionInputs(resolvedPlanPath, undefined, true);
      await engine.loadPlan(resolvedPlanPath, tenantSlug);
      const result = await engine.rollback();
      console.log(`Rollback target: ${result.target}`);
      if (!result.executed) {
        console.error('Rollback refused - nothing executed.');
        process.exit(2);
      }
      console.log(`Reversed: ${result.reversed.length}, failed: ${result.failed.length}, manual: ${result.manual.length}, no-op: ${result.noop}`);
      for (const op of result.reversed) console.log(`  reversed: ${op.task_id}/${op.sub_command_id}`);
      for (const op of result.failed) console.log(`  FAILED:   ${op.task_id}/${op.sub_command_id} - ${op.reverse_error}`);
      for (const op of result.manual) console.log(`  manual:   ${op.task_id}/${op.sub_command_id} - ${op.reason}`);
      if (result.failed.length > 0) process.exit(1);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${errorMsg}`);
      process.exit(1);
    }
  });

program
  .command('validate <plan>')
  .description('Validate an Executable Mission Plan without executing')
  .option('-e, --env <path>', 'Path to .env file')
  .action(async (planPath: string, options: { env?: string }) => {
    try {
      process.env.DRY_RUN = 'true';

      const config = new StamperConfig(options.env);
      const engine = new StamperEngine(config);

      printBanner();

      await engine.loadPlan(path.resolve(planPath));

      const plan = engine.getPlan();
      if (!plan) {
        throw new Error('Plan not loaded');
      }

      console.log('Plan validation successful!');
      console.log(`  Plan ID: ${plan.plan_id}`);
      console.log(`  Target Level: ${plan.target_level}`);
      console.log(`  Total Tasks: ${plan.execution_graph.length}`);
      console.log(`  Prechecks: ${plan.prechecks.length}`);
      console.log(`  Postchecks: ${plan.postchecks.length}`);
      console.log('');

      const tasksByEngine = plan.execution_graph.reduce((acc, task) => {
        acc[task.action.engine] = (acc[task.action.engine] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('Tasks by engine:');
      for (const [eng, count] of Object.entries(tasksByEngine)) {
        console.log(`  ${eng}: ${count}`);
      }
      console.log('');

      console.log('Plan is valid and ready for execution.');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Validation failed: ${errorMsg}`);
      process.exit(1);
    }
  });

program
  .command('report <plan-id>')
  .description('Print the execution-results manifest summary for an executed plan (executable plan id)')
  .option('--tenant <slug>', 'Tenant slug the manifest was written for', 'dev')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (planId: string, options: { tenant: string; format?: string }) => {
    try {
      const { executionResultsManifestPath } = await import('../core/ExecutionResultsPublisher.js');
      const manifestPath = executionResultsManifestPath(options.tenant, planId);
      if (!fs.existsSync(manifestPath)) {
        console.error(`No execution-results manifest for plan ${planId} (tenant ${options.tenant}) at ${manifestPath}`);
        process.exit(1);
      }
      const summary = summarizeResultsManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));
      if (options.format === 'json') {
        console.log(JSON.stringify({ manifestPath, ...summary }, null, 2));
        return;
      }
      console.log('Stamper - Execution Results Manifest');
      console.log(`  Manifest:        ${manifestPath}`);
      console.log(`  Plan:            ${summary.planId}${summary.executablePlanId ? ` (executable ${summary.executablePlanId})` : ''}`);
      console.log(`  Run:             ${summary.runId}`);
      console.log(`  Tenant:          ${summary.tenantSlug}`);
      console.log(`  Completed:       ${summary.completedAt}`);
      console.log(`  Contract:        ${summary.contractVersion}`);
      console.log(`  Total controls:  ${summary.totalControls}`);
      console.log('  By verdict:');
      for (const [k, v] of Object.entries(summary.byVerdict)) console.log(`    ${k.padEnd(16)} ${v}`);
      console.log('  By directive:');
      for (const [k, v] of Object.entries(summary.byDirective)) console.log(`    ${k.padEnd(16)} ${v}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${errorMsg}`);
      process.exit(1);
    }
  });

program
  .command('translate <mission-plan>')
  .description('Translate a CES Manual Mission Plan into an Executable Plan')
  // Phase 8.3: --manifest is required; the Tenant Manifest is a separate file from the MP.
  .requiredOption('-m, --manifest <path>', 'Path to the CES Tenant Manifest JSON')
  .option('-o, --output <path>', 'Output path for the translated Executable Plan JSON')
  .option('--execute', 'Immediately execute the translated plan (dry-run mode)')
  .option('-e, --env <path>', 'Path to .env file')
  .option('--registry <path>', 'Path to command registry JSON (default: bundled M365 registry)')
  .option('--tenant <slug>', 'Tenant slug to load from plan-data/<slug>/<slug>.json for variable resolution')
  .option('--strict-scope', 'Fail on any scope exclusion validation error or warning')
  .action(async (
    missionPlanPath: string,
    options: { manifest: string; output?: string; execute?: boolean; env?: string; registry?: string; tenant?: string; strictScope?: boolean }
  ) => {
    try {
      printBanner();

      const resolvedPlanPath = path.resolve(missionPlanPath);
      const resolvedManifestPath = path.resolve(options.manifest);

      // Determine output path
      const outputPath = options.output
        ? path.resolve(options.output)
        : resolvedPlanPath.replace(/\.json$/i, '.executable.json');

      // W8-STX: the one translate path (the GUI route calls it too, in mode 'gui').
      const translated = await translateForTenant({
        mode: 'cli',
        missionPlanPath,
        manifestPath: options.manifest,
        outputPath,
        tenant: options.tenant,
        registryPath: options.registry,
        strictScope: options.strictScope,
      });
      const result = translated.result;

      if (options.tenant && translated.clientConfig) {
        console.log(`Tenant: ${translated.clientConfig.clientName} (${options.tenant})`);
      }
      console.log(`Source:   ${resolvedPlanPath}`);
      console.log(`Manifest: ${resolvedManifestPath}`);
      console.log(`Output:   ${outputPath}`);
      console.log('');

      // W4-ST2: the Infra Manifest's stamper_variable_map is merged by the translator (converged with GUI).
      if (translated.infraManifestPath) console.log(`Infra:    ${translated.infraManifestPath}`);

      // Print layer summary
      console.log('Translation Summary');
      console.log('─'.repeat(50));
      console.log(`  Plan ID:      ${result.plan.plan_id}`);
      console.log(`  Target Level: ${result.plan.target_level}`);
      console.log(`  Total Tasks:  ${result.plan.execution_graph.length}`);
      console.log(`  Prechecks:    ${result.plan.prechecks.length}`);
      console.log(`  Postchecks:   ${result.plan.postchecks.length}`);
      console.log('');

      console.log('Execution Layers:');
      const sortedLayers = Object.entries(result.layerSummary)
        .sort(([a], [b]) => Number(a) - Number(b));
      for (const [layer, info] of sortedLayers) {
        console.log(`  L${layer} ${info.name}: ${info.taskCount} task(s)`);
      }
      console.log('');

      // Print engine breakdown
      const engineCounts = result.plan.execution_graph.reduce((acc, task) => {
        acc[task.action.engine] = (acc[task.action.engine] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log('Tasks by Engine:');
      for (const [eng, count] of Object.entries(engineCounts)) {
        console.log(`  ${eng}: ${count}`);
      }
      console.log('');

      // Print warnings
      if (result.warnings.length > 0) {
        console.log('Warnings:');
        for (const warning of result.warnings) {
          console.log(`  ! ${warning}`);
        }
        console.log('');
      }

      console.log('Translation complete.');

      // Optionally execute the translated plan
      if (options.execute) {
        console.log('');
        console.log('Executing translated plan in dry-run mode...');
        console.log('─'.repeat(50));
        process.env.DRY_RUN = 'true';

        const config = new StamperConfig(options.env);
        const engine = new StamperEngine(config);
        const reporter = new ExecutionReporter(config);

        // FX-02: tenant slug for the dry run (no context in dry-run, matching the server).
        const { tenantSlug } = await buildCliExecutionInputs(outputPath, options.tenant, true);
        await engine.loadPlan(outputPath, tenantSlug);
        const report = await engine.execute(false);

        await publishCliResults(engine, report, options.tenant, true);

        reporter.printReport(report);

        const { jsonPath, markdownPath } = reporter.saveReport(report);
        console.log(`Report saved:`);
        console.log(`  JSON: ${jsonPath}`);
        console.log(`  Markdown: ${markdownPath}`);

        if (report.status === 'failed') {
          process.exit(1);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Translation failed: ${errorMsg}`);
      process.exit(1);
    }
  });

program
  .command('bootstrap')
  .description('Bootstrap tenant connection (app registration + non-exportable certificate + ces-tenant registry record)')
  .requiredOption('--tenant-id <id>', 'Azure AD tenant ID (GUID)')
  .requiredOption('--display-name <name>', 'Display name for app registration')
  .requiredOption('--environment <env>', 'Target environment (commercial or gcchigh)')
  // NOTE: there is deliberately NO certificate password flag, and no PFX at all (SP-3): the
  // bootstrap key is created non-exportable in Cert:\CurrentUser\My and only the public .cer is
  // written. (G-ENG-2, SECRETS-PLAN SP-3)
  .option('--slug <slug>', 'Tenant registry slug (default: derived from --display-name)')
  .option('--subscription-id <id>', 'Azure subscription to assign the app Contributor + User Access Administrator on')
  .option('--break-glass-upn <upn...>', 'UPNs of the two customer-created break-glass accounts to verify')
  .option('--output <path>', 'Output path for .env file')
  .option('--cert-store-path <path>', 'Public certificate (.cer) directory (default: C:\\stamper-certs)')
  // FIN-21: licence check and assignment (audit steps 1 and 18) and the simulator path (clean-g5).
  .option('--license-upn <upn...>', 'UPNs that must hold the G5 licence (assigned from seats the tenant owns)')
  .option('--license-sku <partNumber>', 'Licence SKU part number (default: one containing "G5")')
  .option('--simulator', 'Bootstrap a simulated tenant (records kind sim; scripted answers allowed, FD-1)')
  .option('--security-defaults-answer <answer>', 'Scripted answer to the Security Defaults prompt (yes or no; simulator only)')
  .action(async (options: {
    tenantId: string;
    displayName: string;
    environment: string;
    slug?: string;
    subscriptionId?: string;
    breakGlassUpn?: string[];
    output?: string;
    certStorePath?: string;
    licenseUpn?: string[];
    licenseSku?: string;
    simulator?: boolean;
    securityDefaultsAnswer?: string;
  }) => {
    try {
      // Validate environment
      const env = options.environment.toLowerCase();
      if (env !== 'commercial' && env !== 'gcchigh') {
        console.error('Error: --environment must be "commercial" or "gcchigh"');
        process.exit(1);
      }

      // Normalize environment for PowerShell
      const psEnvironment = env === 'gcchigh' ? 'GCCHigh' : 'Commercial';

      const slug = options.slug ?? deriveTenantSlug(options.displayName);
      if (!/^[a-zA-Z0-9_-]+$/.test(slug) || slug === 'dev') {
        console.error(`Error: tenant slug '${slug}' is not usable (letters, numbers, hyphens, underscores; not 'dev'). Pass --slug.`);
        process.exit(1);
      }

      printBanner();
      console.log(`Tenant ID: ${options.tenantId}`);
      console.log(`Display Name: ${options.displayName}`);
      console.log(`Environment: ${psEnvironment}`);
      console.log(`Registry slug: ${slug}`);
      console.log('');

      // Build PowerShell script path
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'New-TenantBootstrap.ps1');
      const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-bootstrap-'));
      const resultPath = path.join(resultDir, 'bootstrap-result.json');

      // Build PowerShell arguments
      const psArgs = [
        '-NoProfile',
        '-File', scriptPath,
        '-TenantId', options.tenantId,
        '-DisplayName', options.displayName,
        '-Environment', psEnvironment,
        '-ResultPath', resultPath,
      ];

      if (options.output) {
        psArgs.push('-OutputPath', options.output);
      }

      if (options.certStorePath) {
        psArgs.push('-CertStorePath', options.certStorePath);
      }

      if (options.subscriptionId) {
        psArgs.push('-SubscriptionId', options.subscriptionId);
      }

      if (options.breakGlassUpn && options.breakGlassUpn.length > 0) {
        psArgs.push('-BreakGlassUpn', options.breakGlassUpn.join(','));
      }

      if (options.licenseUpn && options.licenseUpn.length > 0) {
        psArgs.push('-LicenseUpn', options.licenseUpn.join(','));
      }

      if (options.licenseSku) {
        psArgs.push('-LicenseSkuPartNumber', options.licenseSku);
      }

      if (options.simulator) {
        psArgs.push('-Simulator');
      }

      if (options.securityDefaultsAnswer) {
        psArgs.push('-SecurityDefaultsAnswer', options.securityDefaultsAnswer);
      }

      // Execute the script under PowerShell 7 (pwsh); it exits on anything below 7.
      // stdio is inherited so the sign-in and Security Defaults prompts reach the operator.
      const ps = spawn(BOOTSTRAP_PWSH, psArgs, {
        stdio: 'inherit',
        shell: false
      });

      ps.on('close', (code) => {
        if (code === 0) {
          try {
            const result = readBootstrapResult(resultPath);
            const written = writeBootstrapTenantRecord(result, slug);
            console.log('');
            console.log(`Tenant record ${written.updated ? 'updated' : 'written'}: ${written.path}`);
            if (result.break_glass?.verified !== true) {
              console.warn(`WARNING: break-glass VERIFY did not pass: ${result.break_glass?.detail ?? 'not run'}`);
            }
            if (result.validation_passed !== true) {
              console.warn('WARNING: certificate validation did not pass; rerun preflight once permissions propagate.');
            }
            fs.rmSync(resultDir, { recursive: true, force: true });
            console.log('Bootstrap completed successfully.');
          } catch (recordErr) {
            const msg = recordErr instanceof Error ? recordErr.message : String(recordErr);
            console.error('');
            console.error(`Bootstrap ran, but the tenant record was not written: ${msg}`);
            console.error(`Bootstrap result kept at: ${resultPath}`);
            process.exit(1);
          }
        } else {
          console.error('');
          console.error(`Bootstrap failed with exit code ${code}`);
          process.exit(code || 1);
        }
      });

      ps.on('error', (error: NodeJS.ErrnoException) => {
        console.error(describeBootstrapSpawnError(error));
        process.exit(1);
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${errorMsg}`);
      process.exit(1);
    }
  });

program
  .command('gui')
  .description('Start local web GUI on http://localhost:<port>')
  .option('--port <n>', 'Port number', '3000')
  .option(
    '--stacksim [url]',
    'Run against the tenant-stacksim simulator: every PowerShell session resolves Get-/Set- cmdlets (and az) against the sim server instead of real Microsoft endpoints (default http://127.0.0.1:4390)',
  )
  .option('--verbose', 'Log every request to the console (default: only failures are logged)')
  .action(async (options: { port: string; stacksim?: string | boolean; verbose?: boolean }) => {
    printBanner();
    if (options.stacksim) {
      // G-TENANT-M1: --stacksim is a request for a kind:'sim' tenant from the
      // ces-tenant registry (creating the default ephemeral sim record when
      // none exists), not a direct call into a Stamper-owned env mutation.
      const { requestStacksimMode } = await import('../tenant/stamperTenants.js');
      const simRecord = await requestStacksimMode(
        typeof options.stacksim === 'string' ? options.stacksim : undefined,
      );
      console.log(`[StacksimMode] sim tenant (registry-backed): ${simRecord.tenantSlug} (kind: ${simRecord.kind})`);
    }
    const { GuiServer } = await import('../server/GuiServer.js');
    GuiServer.start(parseInt(options.port, 10), { verbose: Boolean(options.verbose) });
  });

const tenantsCmd = program
  .command('tenants')
  .description('Manage onboarded tenant configurations');

tenantsCmd
  .command('list')
  .description('List all onboarded tenants from the ces-tenant registry')
  .action(async () => {
    const entries = await listTenantRecordsWithPaths();

    if (entries.length === 0) {
      console.log('No tenant records found in the ces-tenant registry.');
      console.log('Run the tenant onboarding tool to add tenants.');
      return;
    }

    console.log('Onboarded Tenants');
    console.log('─'.repeat(70));

    for (const { record, path: tenantPath } of entries) {
      const slug = record.tenantSlug;
      try {
        const raw = JSON.parse(fs.readFileSync(tenantPath, 'utf-8'));
        const clientName = raw.client?.name || '(unknown)';
        const certExpires = raw.onboarding?.cert_expires || '(unknown)';
        const validationPassed = raw.onboarding?.validation_passed;
        const status = validationPassed === true ? 'VALIDATED' : validationPassed === false ? 'FAILED' : 'UNKNOWN';
        const subscriptionId = raw.subscription?.subscription_id || '(none)';

        console.log(`  Slug:         ${slug}`);
        console.log(`  Client:       ${clientName}`);
        console.log(`  Kind:         ${record.kind}`);
        console.log(`  Cert Expires: ${certExpires}`);
        console.log(`  Status:       ${status}`);
        console.log(`  Subscription: ${subscriptionId}`);
        console.log('');
      } catch {
        console.log(`  ${slug}: (failed to parse)`);
        console.log('');
      }
    }
  });

tenantsCmd
  .command('validate <slug>')
  .description('Validate tenant connectivity for Graph API and Azure endpoints')
  .action(async (slug: string) => {
    const tenantJsonPath = await resolveTenantJsonPath(slug);
    let tenantConfig: ReturnType<typeof loadClientConfigFromTenantJson>;
    try {
      tenantConfig = loadClientConfigFromTenantJson(tenantJsonPath);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${errorMsg}`);
      process.exit(1);
    }

    console.log(`Validating tenant: ${slug} (${tenantConfig.clientName})`);
    console.log('─'.repeat(50));
    console.log('');
    console.log('[Graph] Commands to validate Graph connectivity:');
    console.log(`  Connect-MgGraph -ClientId ${tenantConfig.appId} -TenantId ${tenantConfig.tenantId} -CertificateThumbprint ${tenantConfig.certThumbprint} -Environment USGov`);
    console.log(`  Get-MgOrganization`);
    console.log('');
    console.log('[Azure] Commands to validate Azure connectivity:');
    console.log(`  Connect-AzAccount -Environment AzureUSGovernment -TenantId ${tenantConfig.tenantId} -ApplicationId ${tenantConfig.appId} -CertificateThumbprint ${tenantConfig.certThumbprint}`);
    console.log(`  Get-AzSubscription`);
    console.log('');
    console.log('Run the above commands in PowerShell 7+ to validate connectivity.');
    console.log('Both commands must succeed for the tenant to be fully validated.');
    console.log('');
    console.log(`Tenant JSON: ${tenantJsonPath}`);
  });

// GATE-RUN: DP-1, the plan-time cost opt-in.
program.addCommand(buildCostAckCommand());

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
