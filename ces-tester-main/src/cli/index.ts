// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * ces-tester CLI entry. `run` lands in M1; `run-m2` (M2, now scenario-file-
 * backed); `run-scenario` + `run-all` land in M3; dashboard is M4.
 * CC-1/CC-2: `catalog`, `catalog:check`, `runs:backfill`, `center`.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runCommand, printAssertionResult } from './run-command.js';
import { runM2Command } from './run-m2-command.js';
import { runScenarioCommand } from './run-scenario-command.js';
import { discoverScenarioFiles } from '../scenarios/scenarioFile.js';
import {
  buildRunSummary,
  summarizeScenarioResult,
  writeLiveSnapshot,
  writeRunSummary,
  type RunScenarioSummary,
} from '../results/run-summary.js';
import type { ScenarioResult } from '../results/result-shape.js';
import { writeDashboard } from '../results/dashboard-generator.js';
import {
  runDemoPreflightCommand,
  runDemoResetCommand,
  runDemoRunCommand,
  runDemoDashboardCommand,
  runDemoEvalCommand,
  runDemoE2eCommand,
} from './demo-command.js';
import { runDemoShowCommand } from './show-command.js';
import { runDemoActsTestCommand } from './acts-test-command.js';
import { recordCliRun, LAUNCHED_BY_ENV } from '../catalog/run-index.js';

export function usage(): string {
  return (
    'ces-tester — commands: run (M1); run-m2 (M2 scenario, scenario-file-backed); run-scenario <file> (M3); ' +
    'run-all [--scenarios-dir <dir>] [--keep-on-failure] (M3); dashboard [--out <file>] (M4); ' +
    'demo:preflight | demo:reset | demo:run [--plan] [--force] [--watch] [--scenario <needle|eval|e2e>] | ' +
    'demo:dashboard [--data <json-file>] [--out <file>] | demo:eval [--config <id>|--all] [--muster-root <dir>] | ' +
    'demo:e2e [--config <id>] [--watch] [--calibrate] [--skip-gates] [--plan] [--run-id <id>] ' +
    '(GP-DEMO-1 / GP-DEMO-2 / GP-DEMO-3); ' +
    'demo:show [deck.xlsx] [--check] [--slides-port <n>] [--default-dwell <sec>] [--manual] ' +
    '[--no-presenter] [--slides-window WxH+X+Y] [--app-window WxH+X+Y] ' +
    '[--stacksim-root <dir>] [--ao-root <dir>] [--eo-root <dir>] [--stamper-root <dir>] ' +
    '[--muster-root <dir>] [--no-report] [--watchouts] (GP-DEMO-4 presentation runner); ' +
    'demo:acts-test [--docs-only|--quick|--full] [--act <groupId>] [--run-id <id>] ' +
    '[--from-report <path>] [--stacksim-root <dir>] [--ao-root <dir>] [--eo-root <dir>] ' +
    '[--stamper-root <dir>] [--muster-root <dir>] (GP-DEMO-4 demo-act test harness); ' +
    'catalog [--json] [--kind <k>] [--include-retired]; catalog:check; ' +
    'runs:backfill; center [--port <n>]'
  );
}

/** PLAN.md M1 default: tenant-stacksim is ces-tester's sibling repo under DevProjects/ces. */
function defaultStacksimRoot(): string {
  return path.resolve(process.cwd(), '..', 'tenant-stacksim');
}

/** PLAN.md M2 default: ces-planner is ces-tester's sibling repo under DevProjects/ces. */
function defaultPlannerRoot(): string {
  return path.resolve(process.cwd(), '..', 'ces-planner');
}

/** PLAN.md M2 default: ces-stamper is ces-tester's sibling repo under DevProjects/ces. */
function defaultStamperRoot(): string {
  return path.resolve(process.cwd(), '..', 'ces-stamper');
}

export async function runRunCommand(argv: string[]): Promise<number> {
  const useFailSeed = argv.includes('--fail-seed');
  const stacksimRootFlagIndex = argv.indexOf('--stacksim-root');
  const stacksimRoot =
    stacksimRootFlagIndex !== -1 && argv[stacksimRootFlagIndex + 1]
      ? path.resolve(argv[stacksimRootFlagIndex + 1])
      : defaultStacksimRoot();

  try {
    const result = await runCommand({ stacksimRoot, useFailSeed });
    if (result.stamperBlocked) {
      console.log(`NOTE: ${result.stamperBlocked}`);
    }
    printAssertionResult(result.assertion);
    return result.assertion.pass ? 0 : 1;
  } catch (err) {
    console.error(`ces-tester run: crashed: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

function argFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

export async function runRunM2Command(argv: string[]): Promise<number> {
  const stacksimRoot = argFlag(argv, '--stacksim-root')
    ? path.resolve(argFlag(argv, '--stacksim-root')!)
    : defaultStacksimRoot();
  const plannerRoot = argFlag(argv, '--planner-root')
    ? path.resolve(argFlag(argv, '--planner-root')!)
    : defaultPlannerRoot();
  const stamperRoot = argFlag(argv, '--stamper-root')
    ? path.resolve(argFlag(argv, '--stamper-root')!)
    : defaultStamperRoot();
  const runId = argFlag(argv, '--run-id') ?? `m2-${Date.now()}`;
  const runsRoot = path.resolve(process.cwd(), 'runs');
  const runWorkspaceDir = path.resolve(process.cwd(), 'runs', runId, 'artifacts-workspace');

  try {
    const result = await runM2Command({
      stacksimRoot,
      plannerRoot,
      stamperRoot,
      runsRoot,
      runId,
      runWorkspaceDir,
    });
    console.log(`result written: ${result.resultPath}`);
    console.log(result.status === 'pass' ? 'PASS: clean-tenant-mfa-baseline' : 'FAIL: clean-tenant-mfa-baseline');
    return result.status === 'pass' ? 0 : 1;
  } catch (err) {
    console.error(`ces-tester run-m2: crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return 2;
  }
}

function commonRoots(argv: string[]) {
  return {
    stacksimRoot: argFlag(argv, '--stacksim-root')
      ? path.resolve(argFlag(argv, '--stacksim-root')!)
      : defaultStacksimRoot(),
    plannerRoot: argFlag(argv, '--planner-root')
      ? path.resolve(argFlag(argv, '--planner-root')!)
      : defaultPlannerRoot(),
    stamperRoot: argFlag(argv, '--stamper-root')
      ? path.resolve(argFlag(argv, '--stamper-root')!)
      : defaultStamperRoot(),
  };
}

/** M3: run one scenario FILE through the generalized lifecycle. */
export async function runRunScenarioCommand(argv: string[]): Promise<number> {
  const fileArg = argv.find((a) => !a.startsWith('--') && a.endsWith('.json'));
  if (!fileArg) {
    console.error('run-scenario: a scenario .json file path is required');
    return 2;
  }
  const scenarioPath = path.resolve(fileArg);
  const runId = argFlag(argv, '--run-id') ?? `scn-${Date.now()}`;
  const runsRoot = path.resolve(process.cwd(), 'runs');
  try {
    const startedAt = new Date();
    const result = await runScenarioCommand({
      ...commonRoots(argv),
      scenarioPath,
      runsRoot,
      runId,
      runWorkspaceDir: path.resolve(runsRoot, runId, 'artifacts-workspace'),
      keepOnFailure: argv.includes('--keep-on-failure'),
    });
    console.log(`result written: ${result.resultPath}`);
    console.log(`${result.status === 'pass' ? 'PASS' : 'FAIL'}: ${result.scenarioId}`);
    // M4: single-scenario runs also get a summary.json so the dashboard's
    // history includes them (non-fatal on failure).
    try {
      const full = JSON.parse(await fs.readFile(result.resultPath, 'utf8')) as ScenarioResult;
      await writeRunSummary(
        runsRoot,
        buildRunSummary(
          runId,
          startedAt,
          [summarizeScenarioResult(full, path.relative(runsRoot, result.resultPath).split(path.sep).join('/'))],
          { completedAt: new Date() },
        ),
      );
    } catch (err) {
      console.error(`run-scenario: summary.json write failed (non-fatal): ${err instanceof Error ? err.message : err}`);
    }
    return result.status === 'pass' ? 0 : 1;
  } catch (err) {
    console.error(`ces-tester run-scenario: crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return 2;
  }
}

/**
 * M3: glob scenarios/*.json and run each through the M2 lifecycle SERIALLY
 * (PLAN.md M3 decision 2 — no parallelism). One result.json per scenario;
 * exit 0 only when every scenario passes. --keep-on-failure preserves state
 * at the first failing scenario and stops the run for manual triage.
 */
export async function runRunAllCommand(argv: string[]): Promise<number> {
  const scenariosDir = argFlag(argv, '--scenarios-dir')
    ? path.resolve(argFlag(argv, '--scenarios-dir')!)
    : path.resolve(process.cwd(), 'scenarios');
  const keepOnFailure = argv.includes('--keep-on-failure');
  const runId = argFlag(argv, '--run-id') ?? `all-${Date.now()}`;
  const runsRoot = path.resolve(process.cwd(), 'runs');

  let files: string[];
  try {
    files = await discoverScenarioFiles(scenariosDir);
  } catch (err) {
    console.error(`run-all: cannot read scenarios dir ${scenariosDir}: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
  // --exclude <substr>: drop scenarios whose filename contains <substr>. demo:run
  // uses this to skip harness self-test scenarios (e.g. zz-deliberate-fail) that
  // are designed to go red and have no place in a customer-facing demo run.
  const exclude = argFlag(argv, '--exclude');
  if (exclude) {
    const before = files.length;
    files = files.filter((f) => !path.basename(f).includes(exclude));
    console.log(`run-all: --exclude '${exclude}' dropped ${before - files.length} scenario file(s)`);
  }
  if (files.length === 0) {
    console.error(`run-all: no scenario .json files in ${scenariosDir}`);
    return 2;
  }

  console.log(`run-all: ${files.length} scenario file(s) discovered in ${scenariosDir}`);
  const startedAt = new Date();
  const rows: RunScenarioSummary[] = [];
  let anyFail = false;

  // PLAN.md M4 task 1: live.json rewritten after each scenario for in-flight
  // progress; summary.json written once at the end. Summary-write failures are
  // logged, never allowed to change the run's verdict.
  const snapshotLive = async (): Promise<void> => {
    try {
      await writeLiveSnapshot(runsRoot, buildRunSummary(runId, startedAt, rows, { inProgress: true }));
    } catch (err) {
      console.error(`run-all: live.json write failed (non-fatal): ${err instanceof Error ? err.message : err}`);
    }
  };

  for (const file of files) {
    const name = path.basename(file);
    console.log(`\n=== run-all: ${name} ===`);
    try {
      const result = await runScenarioCommand({
        ...commonRoots(argv),
        scenarioPath: file,
        runsRoot,
        runId,
        runWorkspaceDir: path.resolve(runsRoot, runId, `${path.basename(file, '.json')}-workspace`),
        keepOnFailure,
      });
      console.log(`${result.status === 'pass' ? 'PASS' : 'FAIL'}: ${result.scenarioId} (${result.resultPath})`);
      try {
        const full = JSON.parse(await fs.readFile(result.resultPath, 'utf8')) as ScenarioResult;
        rows.push(
          summarizeScenarioResult(full, path.relative(runsRoot, result.resultPath).split(path.sep).join('/')),
        );
      } catch {
        rows.push({ scenario_id: result.scenarioId, status: result.status });
      }
      if (result.status === 'fail') {
        anyFail = true;
        if (keepOnFailure) {
          await snapshotLive();
          console.log('run-all: --keep-on-failure — stopping here with state preserved for triage.');
          break;
        }
      }
    } catch (err) {
      anyFail = true;
      console.error(`CRASH: ${name}: ${err instanceof Error ? err.message : String(err)}`);
      rows.push({ scenario_id: path.basename(file, '.json'), status: 'crash' });
      if (keepOnFailure) {
        await snapshotLive();
        break;
      }
    }
    await snapshotLive();
  }

  try {
    await writeRunSummary(runsRoot, buildRunSummary(runId, startedAt, rows, { completedAt: new Date() }));
  } catch (err) {
    console.error(`run-all: summary.json write failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  console.log('\n=== run-all summary ===');
  for (const s of rows) console.log(`  ${s.status.toUpperCase().padEnd(5)} ${s.scenario_id}`);
  return anyFail ? 1 : 0;
}

/** M5 task 1: coverage report — inventory items exercised by retained runs'
 * ledger snapshots, with the T1/PROTECT cut (docs/M5-COVERAGE-PLAN.md). */
export async function runCoverageCommand(argv: string[]): Promise<number> {
  const runsRoot = argFlag(argv, '--runs-root')
    ? path.resolve(argFlag(argv, '--runs-root')!)
    : path.resolve(process.cwd(), 'runs');
  const inventoryPath = argFlag(argv, '--inventory')
    ? path.resolve(argFlag(argv, '--inventory')!)
    : path.resolve(process.cwd(), '..', 'tenant-stacksim', 'coverage', 'inventory.json');
  const outPath = argFlag(argv, '--out')
    ? path.resolve(argFlag(argv, '--out')!)
    : path.resolve(process.cwd(), 'coverage', 'coverage-report.json');
  try {
    const { writeCoverageReport } = await import('../results/coverage-report.js');
    const report = await writeCoverageReport(runsRoot, inventoryPath, outPath);
    console.log(`coverage report written: ${outPath}`);
    console.log(
      `items exercised: ${report.totals.exercised}/${report.totals.items} (runs scanned: ${report.runs_scanned}, ledger entries: ${report.ledger_entries_scanned})`,
    );
    console.log(
      `T1/PROTECT controls exercised: ${report.t1_protect.controls_exercised.length}/${report.t1_protect.controls_total} — ${report.t1_protect.controls_exercised.join(', ') || '(none)'}`,
    );
    if (report.manual_only_known_untested.length) {
      console.log(`manual_only known-untested: ${report.manual_only_known_untested.length}`);
    }
    return 0;
  } catch (err) {
    console.error(`ces-tester coverage: crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return 2;
  }
}

/** M4: regenerate the static dashboard from runs/*\/summary.json. */
export async function runDashboardCommand(argv: string[]): Promise<number> {
  const runsRoot = argFlag(argv, '--runs-root')
    ? path.resolve(argFlag(argv, '--runs-root')!)
    : path.resolve(process.cwd(), 'runs');
  const outPath = argFlag(argv, '--out')
    ? path.resolve(argFlag(argv, '--out')!)
    : path.resolve(process.cwd(), 'dashboard', 'dashboard.html');
  try {
    const written = await writeDashboard(runsRoot, outPath);
    console.log(`dashboard written: ${written}`);
    return 0;
  } catch (err) {
    console.error(`ces-tester dashboard: crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// CC-1: catalog and catalog:check commands
// ---------------------------------------------------------------------------

export async function runCatalogCommand(argv: string[]): Promise<number> {
  const { buildCatalog } = await import('../catalog/discover.js');
  const json = argv.includes('--json');
  const kind = argFlag(argv, '--kind') as import('../catalog/types.js').RunnableKind | undefined;
  const includeRetired = argv.includes('--include-retired');

  const catalog = await buildCatalog({
    projectRoot: process.cwd(),
    includeRetired,
    kind: kind || undefined,
  });

  if (json) {
    console.log(JSON.stringify(catalog, null, 2));
  } else {
    console.log(`${catalog.length} runnables:\n`);
    for (const r of catalog) {
      const modes = r.modes.map((m) => m.mode).join('/');
      const lastActs = r.usesActs.length ? ` → acts: ${r.usesActs.join(', ')}` : '';
      console.log(`  ${r.id.padEnd(40)} [${modes.padEnd(9)}] ${r.summary}${lastActs}`);
    }
  }
  return 0;
}

export async function runCatalogCheckCommand(): Promise<number> {
  const { catalogCheck } = await import('../catalog/check.js');
  const result = await catalogCheck(process.cwd());

  for (const e of result.errors) console.error(`ERROR: ${e}`);
  for (const w of result.warnings) console.warn(`WARN: ${w}`);

  if (result.errors.length > 0) {
    console.error(`\ncatalog:check: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    return 1;
  }
  console.log(`catalog:check: clean (${result.warnings.length} warning(s))`);
  return 0;
}

export async function runBackfillCommand(): Promise<number> {
  const { backfillRunIndex } = await import('../catalog/run-index.js');
  const runsRoot = path.resolve(process.cwd(), 'runs');
  const result = await backfillRunIndex(runsRoot);
  console.log(`runs:backfill: ${result.imported} imported, ${result.skipped} skipped`);
  return 0;
}

// ---------------------------------------------------------------------------
// Main dispatch — with CC-2 CLI recording wrapper
// ---------------------------------------------------------------------------

/** The commands that produce runs worth recording. */
const RECORDABLE_COMMANDS = new Set([
  'run', 'run-m2', 'run-scenario', 'run-all',
  'demo:run', 'demo:eval', 'demo:e2e', 'demo:show', 'demo:acts-test',
]);

async function dispatch(command: string, rest: string[]): Promise<number> {
  switch (command) {
    case 'run':
      return runRunCommand(rest);
    case 'run-m2':
      return runRunM2Command(rest);
    case 'run-scenario':
      return runRunScenarioCommand(rest);
    case 'run-all':
      return runRunAllCommand(rest);
    case 'dashboard':
      return runDashboardCommand(rest);
    case 'coverage':
      return runCoverageCommand(rest);
    case 'demo:preflight':
      return runDemoPreflightCommand(process.cwd());
    case 'demo:reset':
      return runDemoResetCommand(process.cwd());
    case 'demo:run':
      return runDemoRunCommand(rest, process.cwd(), {
        runAll: runRunAllCommand,
        dashboard: runDashboardCommand,
      });
    case 'demo:dashboard':
      return runDemoDashboardCommand(rest, process.cwd());
    case 'demo:eval':
      return runDemoEvalCommand(rest, process.cwd());
    case 'demo:e2e':
      return runDemoE2eCommand(rest, process.cwd());
    case 'demo:show':
      return runDemoShowCommand(rest, process.cwd());
    case 'demo:acts-test':
      return runDemoActsTestCommand(rest, process.cwd());
    case 'catalog':
      return runCatalogCommand(rest);
    case 'catalog:check':
      return runCatalogCheckCommand();
    case 'runs:backfill':
      return runBackfillCommand();
    case 'center': {
      const { runCenterCommand } = await import('./center-command.js');
      return runCenterCommand(rest);
    }
    default:
      console.log(usage());
      return 0;
  }
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command) {
    console.log(usage());
    return 0;
  }

  const startedAt = new Date();
  const exitCode = await dispatch(command, rest);

  // CC-2: record runs from the CLI (non-fatal)
  if (RECORDABLE_COMMANDS.has(command)) {
    try {
      await recordCliRun({
        command,
        argv: rest,
        runsRoot: path.resolve(process.cwd(), 'runs'),
        exitCode,
        startedAt,
        endedAt: new Date(),
      });
    } catch {
      // Recording failure must never change the run's exit code
    }
  }

  return exitCode;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
