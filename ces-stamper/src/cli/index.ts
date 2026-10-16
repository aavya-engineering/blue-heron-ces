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
import inquirer from 'inquirer';
import { fileURLToPath } from 'node:url';
import { StamperConfig } from '../config/StamperConfig.js';
import { StamperEngine } from '../core/StamperEngine.js';
import { ExecutionReporter } from '../reporting/ExecutionReporter.js';
import { PlanTranslator } from '../translators/PlanTranslator.js';
import { CESInfrastructureManifestSchema } from '../types/ces-artifacts.types.js';
import type { MPControl } from '../types/ces-artifacts.types.js';
import { StamperTUI } from '../tui/StamperTUI.js';
import { BHD_BANNER_LINES } from '../config/provenance.js';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../config/ClientConfig.js';
import { listTenantRecordsWithPaths } from '../tenant/stamperTenants.js';
import { assertDistFreshAtStartup } from '../utils/distFreshness.js';
import { ExecutionResultsCollector } from '../core/ExecutionResultsCollector.js';
import { publishExecutionResults, recordTaskStatuses, resolveResultsTenantSlug } from '../core/ExecutionResultsPublisher.js';
import type { ExecutionReport } from '../core/StamperEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FX-ST2 / MS-R12: refuse to run a built CLI older than its src (fails loudly).
assertDistFreshAtStartup(__dirname);

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
 * and deliver it to Muster when configured. Never fails the run: a manifest
 * write error or a delivery failure is printed and recorded in the report.
 */
async function publishCliResults(engine: StamperEngine, report: ExecutionReport, tenant: string | undefined, dryRun: boolean): Promise<void> {
  const plan = engine.getPlan();
  if (!plan) return;
  try {
    const { stateManager } = engine.getTuiDependencies();
    const collector = new ExecutionResultsCollector();
    recordTaskStatuses(
      collector,
      plan.execution_graph,
      (id) => stateManager.getTaskState(id)?.status,
      (plan.variables?._control_directives as Record<string, string> | undefined) ?? {},
    );
    const slug = resolveResultsTenantSlug(plan as any, tenant);
    const published = await publishExecutionResults(collector, plan as any, slug, { dryRun });
    console.log(`Execution results manifest (tenant ${slug}): ${published.manifestPath}`);
    (report as ExecutionReport & { resultsManifest?: unknown }).resultsManifest = {
      path: published.manifestPath,
      tenantSlug: slug,
      totalControls: published.manifest.totalControls,
      delivery: published.delivery,
    };
    if (published.delivery.status === 'failed' || published.delivery.status === 'refused') {
      report.recommendations.push(
        `Muster delivery ${published.delivery.status}: ${published.delivery.error ?? published.delivery.reason ?? ''} — manifest kept at ${published.manifestPath} for retry`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Execution results manifest not written: ${msg}`);
    report.recommendations.push(`Execution results manifest not written: ${msg}`);
  }
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
  .description('Blue Heron Defense Compliance Engine — CMMC Orchestration built for ValorForge Solutions')
  .version('0.1.0');

program
  .command('execute [plan]')
  .description('Execute an Executable Mission Plan')
  .option('-e, --env <path>', 'Path to .env file')
  .option('-d, --dry-run', 'Run in dry-run mode (validate only, do not execute)')
  .option('--mode <mode>', 'Execution mode: manual (default) or auto', 'manual')
  .option('--dev', 'Dev/test mode: auto-loads synthetic fixtures, forces dry-run, no .env required')
  .option('--full', 'Use full-registry fixtures (all 118 commands) instead of small synthetic set. Requires --dev')
  .option('--tenant <slug>', 'Tenant slug for the execution-results manifest (default: plan tenant, else "dev")')
  .action(async (planArg: string | undefined, options: { env?: string; dryRun?: boolean; mode?: string; dev?: boolean; full?: boolean; tenant?: string }) => {
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

      await engine.loadPlan(path.resolve(planPath));

      const plan = engine.getPlan();
      if (!plan) {
        throw new Error('Plan not loaded');
      }

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
  .option('--tenant <slug>', 'Tenant slug for the execution-results manifest (default: plan tenant, else "dev")')
  .action(async (planPath: string, options: { env?: string; dryRun?: boolean; tenant?: string }) => {
    try {
      if (options.dryRun) process.env.DRY_RUN = 'true';
      const config = new StamperConfig(options.env);
      const engine = new StamperEngine(config);
      const reporter = new ExecutionReporter(config);

      printBanner();
      await engine.loadPlan(path.resolve(planPath));
      const plan = engine.getPlan();
      if (!plan) throw new Error('Plan not loaded');

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
      await engine.loadPlan(path.resolve(planPath));
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

      // Load tenant config if --tenant is provided
      let clientConfig: ReturnType<typeof loadClientConfigFromTenantJson> | undefined;
      if (options.tenant) {
        const tenantJsonPath = await resolveTenantJsonPath(options.tenant);
        clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);
        console.log(`Tenant: ${clientConfig.clientName} (${options.tenant})`);
      }

      const resolvedPlanPath = path.resolve(missionPlanPath);
      const resolvedManifestPath = path.resolve(options.manifest);

      // Load mpControls from MP for gap-fill directive precedence (converged with GUI)
      let mpControls: MPControl[] | undefined;
      try {
        const mpJson = JSON.parse(fs.readFileSync(resolvedPlanPath, 'utf-8'));
        const controls = mpJson?.outputs?.human_readable_mission_plan?.controls;
        if (Array.isArray(controls) && controls.length > 0) {
          mpControls = controls;
        }
      } catch { /* MP load failure handled downstream */ }

      // Extract infrastructure_model from Infrastructure Manifest if provided (converged with GUI)
      // Try both prefixes: legacy "infrastructure-manifest" and Muster "infra-manifest"
      let infraModelValue: 'm365_only' | 'm365_sentinel' | 'm365_azure' | undefined;
      let infraData: unknown;
      const infraCandidates = [
        options.manifest.replace(/tenant-manifest/i, 'infrastructure-manifest'),
        options.manifest.replace(/tenant-manifest/i, 'infra-manifest'),
      ].filter(p => p !== options.manifest);
      const infraManifestPath = infraCandidates.find(p => fs.existsSync(path.resolve(p)));
      if (infraManifestPath) {
        try {
          infraData = JSON.parse(fs.readFileSync(path.resolve(infraManifestPath), 'utf-8'));
          const infraParse = CESInfrastructureManifestSchema.safeParse(infraData);
          if (infraParse.success) {
            infraModelValue = infraParse.data.infrastructure.infrastructure_model;
          }
        } catch { /* Non-fatal */ }
      }

      const translator = new PlanTranslator(undefined, clientConfig, mpControls, infraModelValue);

      // Wire registry loading so sub-commands are assembled during translation
      if (options.registry) {
        translator.loadRegistry(path.resolve(options.registry));
      } else {
        const registryPath = path.resolve(__dirname, '..', '..', 'src', 'registry', 'cmmc-l2-commands.registry.json');
        const distRegistryPath = path.resolve(__dirname, '..', 'registry', 'cmmc-l2-commands.registry.json');
        if (fs.existsSync(registryPath)) {
          translator.loadRegistry(registryPath);
        } else if (fs.existsSync(distRegistryPath)) {
          translator.loadRegistry(distRegistryPath);
        }
      }

      // Determine output path
      const outputPath = options.output
        ? path.resolve(options.output)
        : resolvedPlanPath.replace(/\.json$/i, '.executable.json');

      console.log(`Source:   ${resolvedPlanPath}`);
      console.log(`Manifest: ${resolvedManifestPath}`);
      console.log(`Output:   ${outputPath}`);
      console.log('');

      // W4-ST2: the Infra Manifest's stamper_variable_map is merged by the translator (converged with GUI).
      if (infraManifestPath) console.log(`Infra:    ${path.resolve(infraManifestPath)}`);
      const result = translator.translateFile(resolvedPlanPath, resolvedManifestPath, outputPath, undefined, {
        strictScope: options.strictScope,
        ...(infraData !== undefined ? { infraManifest: infraData, infraManifestSource: path.resolve(infraManifestPath!) } : {}),
      });

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

        await engine.loadPlan(outputPath);
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
  .description('Bootstrap tenant connection (app registration + certificate + .env)')
  .requiredOption('--tenant-id <id>', 'Azure AD tenant ID (GUID)')
  .requiredOption('--display-name <name>', 'Display name for app registration')
  .requiredOption('--environment <env>', 'Target environment (commercial or gcchigh)')
  // NOTE: there is deliberately NO --cert-password flag. A plaintext password on the CLI leaks into
  // shell history + process listings and was interpolated into a PowerShell string (an injection
  // vector). New-TenantBootstrap.ps1 prompts interactively for a SecureString (Read-Host
  // -AsSecureString) when the password is absent, which is the only supported path. (G-ENG-2)
  .option('--output <path>', 'Output path for .env file')
  .option('--cert-store-path <path>', 'Certificate storage directory (default: C:\\stamper-certs)')
  .action(async (options: {
    tenantId: string;
    displayName: string;
    environment: string;
    output?: string;
    certStorePath?: string;
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

      printBanner();
      console.log(`Tenant ID: ${options.tenantId}`);
      console.log(`Display Name: ${options.displayName}`);
      console.log(`Environment: ${psEnvironment}`);
      console.log('');

      // Build PowerShell script path
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'New-TenantBootstrap.ps1');

      // Build PowerShell arguments
      const psArgs = [
        '-File', scriptPath,
        '-TenantId', options.tenantId,
        '-DisplayName', options.displayName,
        '-Environment', psEnvironment
      ];

      // Certificate password is NOT accepted on the CLI (see the command definition above).
      // New-TenantBootstrap.ps1 prompts for it as a SecureString when -CertPassword is omitted;
      // the script inherits this process's stdio, so the prompt reaches the operator directly.

      if (options.output) {
        psArgs.push('-OutputPath', options.output);
      }

      if (options.certStorePath) {
        psArgs.push('-CertStorePath', options.certStorePath);
      }

      // Execute PowerShell script
      const ps = spawn('powershell.exe', psArgs, {
        stdio: 'inherit',
        shell: false
      });

      ps.on('close', (code) => {
        if (code === 0) {
          console.log('');
          console.log('Bootstrap completed successfully.');
        } else {
          console.error('');
          console.error(`Bootstrap failed with exit code ${code}`);
          process.exit(code || 1);
        }
      });

      ps.on('error', (error) => {
        console.error(`Failed to execute PowerShell script: ${error.message}`);
        console.error('Ensure PowerShell 7+ is installed and in PATH.');
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

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
