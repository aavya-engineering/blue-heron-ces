// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-1 — the `demo:*` CLI surface: the "one command to run, one to reset"
 * the goal's M1 requires, collapsing the four-server / five-idiom hand-stitch
 * (critique P0-1) into a single deterministic entrypoint.
 *
 *   demo:preflight   build-freshness + port-free check (P1-7, P1-8)
 *   demo:reset       unified reset to pristine (P1-8, M1)
 *   demo:run [--plan]  preflight-gated demo spine; --plan prints the plan only
 *
 * SCOPE (iteration 1): demo:run drives the proven seed -> Muster -> Stamper ->
 * verify -> dashboard spine (the existing run-all), gated by pre-flight and
 * annotated with the known-false-FAIL registry. The EO leg (Beat 3) and the
 * unified before->after SPRS dashboard are STAGED for iteration 2 (they need
 * live rehearsal — see DEMO-READINESS-MAP §Beat-3 and critique P1-4/P1-6);
 * demo:run prints their staged status rather than silently omitting them.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  runPreflight,
  probePort,
  type ModuleBuild,
  type PortSpec,
  type PreflightReport,
} from '../demo/preflight.js';
import { planReset, executeReset, type ResetPlanOptions } from '../demo/reset.js';
import { KNOWN_FALSE_FAILS, RESOLVED_FALSE_FAILS } from '../demo/known-false-fails.js';
import {
  writeUnifiedDashboard,
  SAMPLE_UNIFIED_RESULT,
  type UnifiedDemoResult,
} from '../results/unified-dashboard.js';
import { runEoLeg, type EoLegResult } from '../demo/eo-leg.js';
import { runNeedleRemediation, buildUnifiedFromNeedleRun, type NeedleRunResult } from '../demo/needle-run.js';
import { runEvalConfig, loadEvalConfigFile, type EvalConfigFile, type EvalConfigResult } from '../demo/eval-run.js';
import { resolveDemoScenario } from '../demo/scenario-registry.js';
import { discoverScenarioFiles } from '../scenarios/scenarioFile.js';
import { STAMPER_GUI_PORT, AO_GUI_PORT } from '../demo/gui-servers.js';
import { resolveWatchMode } from '../demo/watch-mode.js';
import { resolveE2eConfig, E2E_CONFIGS, E2E_DEFAULT_CONFIG_ID } from '../demo/e2e-configs.js';
import { runE2eDemo, renderBeatPlan } from '../demo/e2e-run.js';

/** Minimal sim tenant record so EO's resolveTenantJsonPath finds demo-dib-small
 * (fake GCC-High creds — sim only; contains no real identity). */
const DEMO_SIM_TENANT_JSON = {
  kind: 'sim',
  client: { slug: 'demo-dib-small', name: 'Ridgeline Fabrication (demo)' },
  tenant: { tenant_id: '00000000-0000-0000-0000-000000000000', domain: 'sim.onmicrosoft.us' },
  auth: { app_id: '00000000-0000-0000-0000-000000000000', cert_path: 'C:/dummy/sim.pfx', cert_thumbprint: '0'.repeat(40) },
  endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us', arm: 'https://management.usgovcloudapi.net' },
  infrastructure_model: 'm365_azure',
};

/** The canonical demo tenant (founder-approved "Ridgeline Fabrication", DEMO-READINESS-MAP). */
export const DEMO_SLUG = 'demo-dib-small';

/**
 * GP-DEMO-3 M5 — the five demo ports. Both GUIs default to 3000, so AO is moved
 * to 3001 (FD-2's port ruling; `gui-servers.ts` exports the constants).
 */
export const DEMO_PORTS: readonly PortSpec[] = [
  { name: 'stacksim', port: 4390 },
  { name: 'muster', port: 5173 },
  { name: 'stamper-gui', port: STAMPER_GUI_PORT },
  { name: 'ao-gui', port: AO_GUI_PORT },
  { name: 'eo', port: 4002 },
];

/**
 * GP-DEMO-3 M5 — every module `demo:e2e` executes compiled code from. ces-ao and
 * ces-eo are spawned from their own `dist/`; ces-muster's DISCOVERY-1 executor
 * is `muster-api/dist/cli/bin.js`, so its build pair is the muster-api subtree.
 */
export function demoModules(testerRoot: string): ModuleBuild[] {
  const ces = path.resolve(testerRoot, '..');
  return [
    { name: 'tenant-stacksim', srcDir: path.join(ces, 'tenant-stacksim', 'src'), distDir: path.join(ces, 'tenant-stacksim', 'dist') },
    { name: 'ces-stamper', srcDir: path.join(ces, 'ces-stamper', 'src'), distDir: path.join(ces, 'ces-stamper', 'dist') },
    { name: 'ces-ao', srcDir: path.join(ces, 'ces-ao', 'src'), distDir: path.join(ces, 'ces-ao', 'dist') },
    { name: 'ces-eo', srcDir: path.join(ces, 'ces-eo', 'src'), distDir: path.join(ces, 'ces-eo', 'dist') },
    { name: 'ces-muster', srcDir: path.join(ces, 'ces-muster', 'muster-api', 'src'), distDir: path.join(ces, 'ces-muster', 'muster-api', 'dist') },
    { name: 'ces-tester', srcDir: path.join(testerRoot, 'src'), distDir: path.join(testerRoot, 'dist') },
  ];
}

function printPreflight(report: PreflightReport): void {
  console.log('demo pre-flight:');
  for (const b of report.builds) console.log(`  build ${b.status.padEnd(12)} ${b.name}`);
  for (const p of report.ports) console.log(`  port  ${p.status.padEnd(12)} ${p.port} (${p.name})`);
  if (report.ok) {
    console.log('  => OK — builds fresh, ports free.');
  } else {
    console.log('  => NOT READY:');
    for (const i of report.issues) console.log(`     - ${i}`);
  }
}

export async function runDemoPreflightCommand(testerRoot: string): Promise<number> {
  const report = await runPreflight({ modules: demoModules(testerRoot), ports: DEMO_PORTS });
  printPreflight(report);
  return report.ok ? 0 : 1;
}

/** Run a node subcommand in a module root; resolve on exit 0, reject otherwise. */
function spawnNode(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { cwd });
    let err = '';
    child.stderr?.on('data', (c: Buffer) => (err += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`node ${args.join(' ')} exited ${code}\n${err.trim()}`)),
    );
  });
}

/**
 * Re-materialize the demo tenant to pristine (stacksim's own `demo:reset`
 * contract: regenerate the scenario file, then `scenario <slug>`). No serve is
 * started — reset must leave nothing listening. Build-freshness is pre-flight's
 * job, so we skip the (heavy) rebuild step here.
 */
function resetDemoTenant(stacksimRoot: string): (slug: string) => Promise<void> {
  return async (slug: string) => {
    await spawnNode(stacksimRoot, [path.join('scripts', 'build-demo-scenario.mjs')]);
    await spawnNode(stacksimRoot, [path.join('bin', 'stacksim.mjs'), 'scenario', slug]);
  };
}

export async function runDemoResetCommand(testerRoot: string): Promise<number> {
  const stacksimRoot = path.resolve(testerRoot, '..', 'tenant-stacksim');
  const opts: ResetPlanOptions = {
    stacksimRoot,
    demoSlug: DEMO_SLUG,
    testerRoot,
    ports: DEMO_PORTS,
  };
  const plan = planReset(opts);
  console.log(`demo reset — ${plan.length} action(s):`);
  const outcomes = await executeReset(plan, opts, {
    probePort: (p) => probePort(p),
    resetTenant: resetDemoTenant(stacksimRoot),
  });
  for (const o of outcomes) console.log(`  [${o.status.toUpperCase()}] ${o.kind}: ${o.detail}`);
  const errored = outcomes.some((o) => o.status === 'error');
  return errored ? 1 : 0;
}

/** Ordered demo beat plan (for `--plan` and operator orientation). */
export function demoBeatPlan(): string[] {
  return [
    'Beat 0  spine: run-all (5 baseline scenarios) → toolchain dashboard',
    'Beat 1  reset + seed demo-dib-small (pristine, report-only MFA gap) → serve :4390 → EO live assess (before)',
    'Beat 2  drive Muster wizard (Playwright) → Stamper apply+verify MFA remediation against :4390 (ledger-recorded)',
    'Beat 3  EO live re-assess against demo-dib-small (after) — real per-control determinations',
    'Beat 4  unified before→after SPRS needle dashboard (offline, real delta when both legs are live)',
  ];
}

/**
 * Map an EO leg result into the unified dashboard model — HONEST: this flow
 * assesses demo-dib-small at its seeded (pre-remediation) state, and the SPRS
 * HEADLINE belongs to Muster (one-SPRS rule), not EO. So we surface EO's REAL
 * per-control determinations as the current baseline and mark the
 * remediation-driven before→after (Muster headline + Stamper re-assess) as
 * STAGED for the next iteration rather than fabricate a needle move.
 */
export function buildUnifiedFromEo(eo: EoLegResult, generatedAt: string): UnifiedDemoResult {
  const s = eo.summary ?? {};
  const met = s.controlsMet ?? 0;
  const total = (s.controlsMet ?? 0) + (s.controlsNotMet ?? 0) + (s.controlsPartial ?? 0) + (s.controlsNotAssessed ?? 0) || 110;
  const eoLive = eo.available && eo.connected && (s.liveAssessmentCount ?? 0) > 0;
  return {
    tenant: DEMO_SLUG,
    generatedAt,
    // No fabricated movement: before == after (remediation pipeline is STAGED).
    sprs: { before: 0, after: 0, max: 110 },
    controls: { total, metBefore: met, metAfter: met },
    findings: [],
    evidence: s.snapshotId ? [{ name: `eo-snapshot-${s.snapshotId}.json`, kind: 'EO assessment snapshot' }] : [],
    beats: [
      { id: 0, label: 'seed demo-dib-small → serve :4390', status: 'pass' },
      { id: 1, label: 'Muster wizard → headline SPRS (before)', status: 'staged' },
      { id: 2, label: 'Stamper apply+verify remediation', status: 'staged' },
      {
        id: 3,
        label: eoLive
          ? `EO live assess: ${s.liveAssessmentCount} assessments, ${met}/${total} met (EO detail SPRS ${s.sprsScore})`
          : `EO detail pending (${eo.error ?? 'unavailable'})`,
        status: eoLive ? 'pass' : 'staged',
      },
      { id: 4, label: 'unified before→after SPRS needle — needs Muster+remediation (iter5)', status: 'staged' },
    ],
  };
}

export interface DemoRunDeps {
  /** The proven seed→Muster→Stamper→verify spine (index.runRunAllCommand). */
  readonly runAll: (argv: string[]) => Promise<number>;
  /** Dashboard regeneration (index.runDashboardCommand). */
  readonly dashboard: (argv: string[]) => Promise<number>;
}

export async function runDemoRunCommand(
  argv: string[],
  testerRoot: string,
  deps: DemoRunDeps,
): Promise<number> {
  const planOnly = argv.includes('--plan');
  const force = argv.includes('--force');
  const scenario = resolveDemoScenario(argFlag(argv, '--scenario'));

  const report = await runPreflight({ modules: demoModules(testerRoot), ports: DEMO_PORTS });
  printPreflight(report);

  console.log(`\nscenario: ${scenario.id} — ${scenario.description}`);
  console.log('\ndemo beat plan:');
  for (const line of demoBeatPlan()) console.log(`  ${line}`);
  console.log(
    `\nknown-false-FAIL registry: ${KNOWN_FALSE_FAILS.length} active (${RESOLVED_FALSE_FAILS.length} resolved at source — any live red now surfaces as UNEXPECTED, not masked).`,
  );

  if (planOnly) {
    console.log('\n--plan: no execution.');
    return report.ok ? 0 : 1;
  }

  if (!report.ok && !force) {
    console.error('\ndemo:run aborted — pre-flight not ready (run `demo:reset`, rebuild, or pass --force).');
    return 1;
  }

  if (scenario.id === 'eval') {
    console.log('\n=== demo:run — scenario "eval": dispatching to demo:eval --all ===');
    const evalArgs = argv.includes('--config') || argv.includes('--all') ? argv : [...argv, '--all'];
    return runDemoEvalCommand(evalArgs, testerRoot);
  }

  // GP-DEMO-3 M5: `e2e` is a registered scenario, so it MUST dispatch. Without
  // this branch `--scenario e2e` would print "scenario: e2e" and then quietly
  // run the needle spine — exactly the substitution the honesty rules forbid.
  if (scenario.id === 'e2e') {
    console.log('\n=== demo:run — scenario "e2e": dispatching to demo:e2e ===');
    return runDemoE2eCommand(argv, testerRoot);
  }

  console.log('\n=== demo:run — driving the seed→Muster→Stamper→verify spine (run-all) ===');
  const spineArgs = argv.filter((a) => a !== '--plan' && a !== '--force' && a !== '--no-eo');
  // A customer demo never runs the harness self-test scenario (zz-deliberate-fail
  // is DESIGNED to red). Skip it unless the operator already set --exclude.
  if (!spineArgs.includes('--exclude')) spineArgs.push('--exclude', 'zz-');
  const spineCode = await deps.runAll(spineArgs);
  console.log('\n=== demo:run — regenerating toolchain dashboard ===');
  await deps.dashboard([]);

  // Beats 3+4 — GP-DEMO-1 iter5: the REAL before→after needle. Resets +
  // seeds demo-dib-small to pristine, EO-assesses it (before), drives Muster
  // + Stamper to remediate the MFA gap live against the SAME served tenant
  // (real, ledger-recorded), then EO-assesses again (after). Graceful:
  // self-gates + degrades to an honest real-before/staged-after rather than
  // failing the run or fabricating movement (HARD RULE).
  const generatedAt = new Date().toISOString();
  const runId = `demo-${Date.now()}`;
  let needle: NeedleRunResult = {
    tenant: DEMO_SLUG,
    before: { available: false, connected: false, error: 'skipped (--no-eo)' },
  };
  if (!argv.includes('--no-eo')) {
    console.log('\n=== demo:run — Beats 3+4: real before→after needle (demo-dib-small) ===');
    try {
      needle = await runNeedleRemediation({
        testerRoot,
        stacksimRoot: path.resolve(testerRoot, '..', 'tenant-stacksim'),
        plannerRoot: path.resolve(testerRoot, '..', 'ces-planner'),
        stamperRoot: path.resolve(testerRoot, '..', 'ces-stamper'),
        eoRoot: path.resolve(testerRoot, '..', 'ces-eo'),
        slug: DEMO_SLUG,
        simTenantJson: DEMO_SIM_TENANT_JSON,
        runId,
        // GP-DEMO-3 M5 (decided: YES): `demo:run` also honours `--watch`. It is
        // one call — `runNeedleRemediation` already threads a `WatchMode` into
        // driveMuster — and an operator who types `--watch` on the older
        // command would otherwise get a silently headless run.
        watch: resolveWatchMode(argv),
      });
      const bs = needle.before.summary ?? {};
      if (needle.before.available && needle.before.connected && (bs.liveAssessmentCount ?? 0) > 0) {
        console.log(`  EO before: ${bs.liveAssessmentCount} assessments — ${bs.controlsMet} met / ${bs.controlsNotMet} not_met (EO detail SPRS ${bs.sprsScore}).`);
      } else {
        console.log(`  EO before unavailable: ${needle.before.error ?? 'unavailable'} (demo degrades gracefully).`);
      }
      if (needle.after) {
        const as = needle.after.summary ?? {};
        console.log(`  Stamper remediation: ${needle.setSubCount ?? 0} set-command(s), ledger: ${needle.ledgerSnapshotPath ?? '(unavailable)'}.`);
        console.log(`  EO after: ${as.liveAssessmentCount} assessments — ${as.controlsMet} met / ${as.controlsNotMet} not_met (EO detail SPRS ${as.sprsScore}).`);
      } else if (needle.remediationError) {
        console.log(`  remediation STAGED: ${needle.remediationError} (real before kept, no fabricated after).`);
      }
      const demoRunsDir = path.resolve(testerRoot, 'runs', 'demo');
      await fs.mkdir(demoRunsDir, { recursive: true });
      await fs.writeFile(path.join(demoRunsDir, 'needle-result.json'), JSON.stringify(needle, null, 2));
    } catch (err) {
      needle = { tenant: DEMO_SLUG, before: { available: false, connected: false, error: err instanceof Error ? err.message : String(err) } };
      console.log(`  Beats 3+4 skipped: ${needle.before.error}`);
    }
  }

  console.log('\n=== demo:run — Beat 4: unified before→after SPRS dashboard ===');
  const unifiedOut = path.resolve(testerRoot, 'dashboard', 'unified-dashboard.html');
  await writeUnifiedDashboard(buildUnifiedFromNeedleRun(needle, generatedAt), unifiedOut);
  console.log(`  unified dashboard: ${unifiedOut}`);
  return spineCode;
}

function argFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

/**
 * GP-DEMO-1 P1-4 — `demo:dashboard`: renders the unified before->after SPRS
 * dashboard. Without --data, renders SAMPLE_UNIFIED_RESULT (fixed
 * generatedAt, deterministic output) so the command is runnable before the
 * live pipeline populates real UnifiedDemoResult data.
 */
export async function runDemoDashboardCommand(argv: string[], testerRoot: string): Promise<number> {
  const dataPath = argFlag(argv, '--data');
  const outPath = argFlag(argv, '--out')
    ? path.resolve(argFlag(argv, '--out')!)
    : path.resolve(testerRoot, 'dashboard', 'unified-dashboard.html');

  try {
    const result: UnifiedDemoResult = dataPath
      ? (JSON.parse(await fs.readFile(path.resolve(dataPath), 'utf8')) as UnifiedDemoResult)
      : SAMPLE_UNIFIED_RESULT;
    const written = await writeUnifiedDashboard(result, outPath);
    console.log(`unified dashboard written: ${written}`);
    return 0;
  } catch (err) {
    console.error(`ces-tester demo:dashboard: crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return 2;
  }
}

export interface DemoEvalArgs {
  readonly musterRoot: string;
  readonly stacksimRoot: string;
  readonly stamperRoot: string;
  readonly configId?: string;
  readonly all: boolean;
  readonly evalScenariosDir: string;
}

/** Pure argv parser for `demo:eval [--config <id>|--all] [--muster-root <dir>]`
 * — split out from runDemoEvalCommand so arg-parsing is unit-testable
 * without touching the filesystem or spawning anything. */
export function parseDemoEvalArgs(argv: string[], testerRoot: string): DemoEvalArgs {
  const ces = path.resolve(testerRoot, '..');
  return {
    musterRoot: argFlag(argv, '--muster-root') ? path.resolve(argFlag(argv, '--muster-root')!) : path.join(ces, 'ces-muster'),
    stacksimRoot: argFlag(argv, '--stacksim-root') ? path.resolve(argFlag(argv, '--stacksim-root')!) : path.join(ces, 'tenant-stacksim'),
    stamperRoot: argFlag(argv, '--stamper-root') ? path.resolve(argFlag(argv, '--stamper-root')!) : path.join(ces, 'ces-stamper'),
    configId: argFlag(argv, '--config'),
    all: argv.includes('--all'),
    evalScenariosDir: path.join(testerRoot, 'scenarios', 'eval'),
  };
}

/**
 * GP-DEMO-2 M5 — `demo:eval [--config <id>|--all] [--muster-root <dir>]`.
 * Discovers scenarios/eval/*.json (T1-T5), runs the selected config(s)
 * serially through `runEvalConfig` (each config seeds its OWN slug, so
 * `runScenario`'s wipe+reseed already isolates configs from one another —
 * no shared-tenant reset needed between them), prints per-config PASS/FAIL,
 * and writes the 5/5 gate verdict to runs/eval/<runId>/gate-summary.json.
 */
export async function runDemoEvalCommand(argv: string[], testerRoot: string): Promise<number> {
  const args = parseDemoEvalArgs(argv, testerRoot);

  let files: string[];
  try {
    files = await discoverScenarioFiles(args.evalScenariosDir);
  } catch (err) {
    console.error(`demo:eval: cannot read eval configs dir ${args.evalScenariosDir}: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  const configs: EvalConfigFile[] = [];
  for (const f of files) {
    try {
      configs.push(await loadEvalConfigFile(f));
    } catch (err) {
      console.error(`demo:eval: ${err instanceof Error ? err.message : err}`);
      return 2;
    }
  }

  const selected = args.configId ? configs.filter((c) => c.config_id === args.configId) : configs;
  if (!args.all && !args.configId) {
    console.error('demo:eval: pass --config <id> or --all');
    return 2;
  }
  if (selected.length === 0) {
    console.error(
      `demo:eval: no matching config${args.configId ? ` '${args.configId}'` : ''} (available: ${configs.map((c) => c.config_id).join(', ')})`,
    );
    return 2;
  }

  const runId = `eval-${Date.now()}`;
  console.log(`demo:eval: ${selected.length} config(s) — run ${runId}`);
  const results: EvalConfigResult[] = [];
  for (const config of selected) {
    console.log(`\n=== demo:eval: ${config.config_id} ===`);
    const result = await runEvalConfig({
      testerRoot,
      stacksimRoot: args.stacksimRoot,
      musterRoot: args.musterRoot,
      stamperRoot: args.stamperRoot,
      config,
      runId,
    });
    results.push(result);
    if (!result.available) {
      console.log(`  UNAVAILABLE: ${result.error}`);
    } else {
      console.log(
        `  ${result.pass ? 'PASS' : 'FAIL'} — schemaValid=${result.schemaValid} readOnly=${result.readOnly}${
          result.diff ? ` mismatches=${result.diff.mismatches.length}` : ''
        }`,
      );
      if (result.error) console.log(`  ${result.error}`);
      for (const m of result.diff?.mismatches ?? []) {
        console.log(`    MISMATCH ${m.control}: expected ${m.expected}, got ${m.actual}`);
      }
    }
  }

  const passCount = results.filter((r) => r.pass).length;
  const gatePass = results.length > 0 && passCount === results.length;
  console.log(`\n=== demo:eval gate: ${passCount}/${results.length} PASS ===`);

  try {
    const summaryPath = path.join(testerRoot, 'runs', 'eval', runId, 'gate-summary.json');
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, JSON.stringify({ runId, gatePass, results }, null, 2), 'utf8');
    console.log(`  gate summary: ${summaryPath}`);
  } catch (err) {
    console.error(`demo:eval: gate summary write failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  return gatePass ? 0 : 1;
}

export interface DemoE2eArgs {
  readonly configId: string | undefined;
  readonly runId: string;
  readonly plan: boolean;
  readonly watch: boolean;
  readonly calibrate: boolean;
  readonly skipGates: boolean;
  readonly stacksimRoot: string;
  readonly plannerRoot: string;
  readonly stamperRoot: string;
  readonly eoRoot: string;
  readonly aoRoot: string;
  readonly musterRoot: string;
}

/**
 * GP-DEMO-3 M5 — pure argv parser for
 * `demo:e2e [--config <id>] [--watch] [--calibrate] [--skip-gates] [--plan] [--run-id <id>] [--<module>-root <dir>]`.
 * Split out from `runDemoE2eCommand` (the `parseDemoEvalArgs` convention) so
 * flag handling is unit-testable without spawning anything.
 */
export function parseDemoE2eArgs(argv: string[], testerRoot: string, now = Date.now()): DemoE2eArgs {
  const ces = path.resolve(testerRoot, '..');
  const root = (flag: string, name: string): string =>
    argFlag(argv, flag) ? path.resolve(argFlag(argv, flag)!) : path.join(ces, name);
  return {
    configId: argFlag(argv, '--config'),
    runId: argFlag(argv, '--run-id') ?? `e2e-${now}`,
    plan: argv.includes('--plan'),
    watch: argv.includes('--watch'),
    calibrate: argv.includes('--calibrate'),
    skipGates: argv.includes('--skip-gates'),
    stacksimRoot: root('--stacksim-root', 'tenant-stacksim'),
    plannerRoot: root('--planner-root', 'ces-planner'),
    stamperRoot: root('--stamper-root', 'ces-stamper'),
    eoRoot: root('--eo-root', 'ces-eo'),
    aoRoot: root('--ao-root', 'ces-ao'),
    musterRoot: root('--muster-root', 'ces-muster'),
  };
}

/**
 * GP-DEMO-3 M5 — `demo:e2e`: Beats 0-5 in one command, all four legs
 * Playwright-driven, evidence under `runs/e2e/<runId>/`.
 *
 * Exit codes: 0 only when every clause of the amended success predicate passes
 * (or is `n/a`, or is an accepted `calibrating`); 1 for an honest partial;
 * 2 for a bad invocation.
 */
export async function runDemoE2eCommand(argv: string[], testerRoot: string): Promise<number> {
  const args = parseDemoE2eArgs(argv, testerRoot);

  let config;
  try {
    config = resolveE2eConfig(args.configId);
  } catch (err) {
    console.error(`demo:e2e: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  if (args.plan) {
    console.log(`demo:e2e --plan — config '${config.id}' (slug ${config.slug}, fullChain=${config.fullChain})`);
    console.log(`  ${config.description}`);
    console.log(`\nconfigs: ${E2E_CONFIGS.map((c) => (c.id === E2E_DEFAULT_CONFIG_ID ? `${c.id} (default)` : c.id)).join(', ')}`);
    console.log('\ndemo:e2e beat plan:');
    for (const line of renderBeatPlan()) console.log(line);
    console.log('\n--plan: no execution.');
    return 0;
  }

  try {
    const result = await runE2eDemo({
      testerRoot,
      stacksimRoot: args.stacksimRoot,
      plannerRoot: args.plannerRoot,
      stamperRoot: args.stamperRoot,
      eoRoot: args.eoRoot,
      aoRoot: args.aoRoot,
      musterRoot: args.musterRoot,
      config,
      runId: args.runId,
      watch: resolveWatchMode(argv),
      calibrate: args.calibrate,
      skipGates: args.skipGates,
      preflightModules: demoModules(testerRoot),
      preflightPorts: DEMO_PORTS,
    });
    console.log(`\nevidence: ${result.runDir}`);
    return result.exitCode;
  } catch (err) {
    console.error(`ces-tester demo:e2e: crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return 2;
  }
}
