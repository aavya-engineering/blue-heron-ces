// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * W8-UIT1 (UI-TRACK.md §5, PLAN §8b): the `ui-e2e` scenario runner, Stamper surface.
 *
 *   run-scenario <ces-tester>/scenarios/ui/<slug>-stamper-ui-e2e.json --root <WS> --package-root <pkg>
 *       [--headless] [--variant legacy|spa]
 *
 * Runs AFTER the headless twin (the same sim scenario through mx-e2e.ps1, E1-E8F), whose outputs it reads from
 * `<WS>/out`: the pushed MP, TM and IM (`<WS>/pl/Stamper/plan-data/<slug>/plans`), `executable-plan.json`,
 * `execution-report.json`, `ledger.json` and the E6 window in `steps.json`. Per variant (legacy `/`, then SPA
 * `/app/` when the SPA is built), in order: reset the sim to the scenario (`stacksim scenario <slug>`) and serve
 * it on 4390; a fresh ephemeral sim tenant record with the sim cert, under a run-scoped registry; Stamper's GUI
 * server on 3000 with run-scoped CES_TENANT_ROOT, CES_PIPELINE_ROOT and STORAGE_ROOT under `<WS>/out/ui/<variant>`
 * and the run's minted initialPassword; then the Playwright drive (`stamper-ui-driver.ts`): tenant, translate,
 * approve (Incremental), execute, ledger, evidence; then the sim ledger snapshot. The twin's sim tenant folder is
 * copied aside first and put back after the last variant, so verify reads the twin's sim store, not the UI run's.
 *
 * Watchable (founder, 2026-10-29): headed, paced (watch-mode.ts WATCHED_MODE) and captioned by DEFAULT; every drive
 * records a video and a trace under `<WS>/out/ui/<variant>/playwright`. `--headless` is the explicit opt-out for
 * unattended reruns.
 *
 * Output: `<WS>/out/ui-e2e-stamper.json` (ui-e2e-compare.ts), read by the package's verify V73.
 * Process rule (as muster-e2e-run.ts): refuse to start while a run port is held; stop only own children.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { queryLedger } from '../stacksim-client/http.js';
import { createTenantRegistry, getSimLaunchEnv } from '../tenant-registry/index.js';
import { buildGuiChildEnv, startStamperGui, STAMPER_GUI_PORT, type GuiServerHandle } from '../demo/gui-servers.js';
import { authorSimTenantRecord } from '../demo/sim-tenant-record.js';
import { ensureSimCert } from '../demo/stamper-prereqs.js';
import { SIM_CERT_STATE_FILE } from '../demo/e2e-run.js';
import { driveStamperUi, type StamperUiDriveContext, type StamperUiDriveResult } from '../demo/stamper-ui-driver.js';
import { HEADLESS_MODE, WATCHED_MODE, type WatchMode } from '../demo/watch-mode.js';
import { simOnlyEnvViolations } from './sim-only-guard.js';
import { mintInitialPassword, withInitialPassword } from './overrides-gate.js';
import { heldPorts, musterE2ePaths } from './muster-e2e-run.js';
import { runEuEoProbe } from './fin19-steps.js';
import {
  compareVariant,
  recordPass,
  UI_E2E_STAMPER_FILE,
  UI_E2E_STAMPER_SCHEMA,
  type LedgerEntryLike,
  type PlanProjectionLike,
  type SimStoreLike,
  type TimeWindow,
  type UiE2eStamperRecord,
  type VariantRecord,
} from './ui-e2e-compare.js';
import { loadUiE2eFile, type UiE2eScenario, type UiE2eVariant, type UiE2eVariantId } from '../scenarios/uiE2eFile.js';
import { consoleSurfaceOf, loadUiConsoleFile } from './ui-console-file.js';
import { resolveConsoleWatch, runUiConsole } from './ui-console-run.js';

/** FIN-19 (V110): each variant's EO probe record, `<WS>/out/ui/<variant>/eo-eu-probe.json`. */
export const EU_EO_PROBE_FILE = 'eo-eu-probe.json';

const SIM_PORT = 4390;
const SIM_URL = `http://127.0.0.1:${SIM_PORT}`;
/** The ports a UI run binds: the sim and the Stamper GUI server. */
export const UI_RUN_PORTS = [SIM_PORT, STAMPER_GUI_PORT];

const nowIso = (): string => new Date().toISOString();
const readJson = <T = unknown>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) as T;
const readJsonOrNull = <T = unknown>(p: string | null | undefined): T | null => {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return readJson<T>(p);
  } catch {
    return null;
  }
};
function latest(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  return f ? path.join(dir, f) : null;
}

/** Watchable: headed and paced unless `--headless` is given explicitly. Pure. */
export function resolveUiE2eWatch(argv: readonly string[]): WatchMode {
  return argv.includes('--headless') ? HEADLESS_MODE : WATCHED_MODE;
}

/** `--variant <id>` (repeatable) narrows the scenario's variants; none = all. Pure. */
export function selectedVariants(argv: readonly string[]): UiE2eVariantId[] {
  const out: UiE2eVariantId[] = [];
  argv.forEach((a, i) => {
    if (a === '--variant' && (argv[i + 1] === 'legacy' || argv[i + 1] === 'spa')) out.push(argv[i + 1] as UiE2eVariantId);
  });
  return out;
}

/** All the paths a UI run reads and writes (the twin's via musterE2ePaths). */
export function uiE2ePaths(wsRoot: string, packageRoot: string, slug: string) {
  const P = musterE2ePaths(wsRoot, packageRoot, slug);
  const ui = path.join(P.out, 'ui');
  return {
    ...P,
    ui,
    record: path.join(P.out, UI_E2E_STAMPER_FILE),
    twinLedger: path.join(P.out, 'ledger.json'),
    twinReport: path.join(P.out, 'execution-report.json'),
    simTenantDir: path.join(P.sim, '.stacksim', 'tenants', slug),
    simTenantBackup: path.join(ui, '_twin-sim-tenant'),
    /** W8-UIT3: the twin's sim store, copied from the backup before the first UI reset. */
    twinSimStore: path.join(ui, 'twin-sim-store.json'),
    stamperProjection: path.join(P.stamper, 'dist', 'translators', 'translateForTenant.js'),
    variant: (id: string) => {
      const dir = path.join(ui, id);
      return {
        dir,
        logs: path.join(dir, 'logs'),
        tenants: path.join(dir, 'tenants'),
        pl: path.join(dir, 'pl'),
        st: path.join(dir, 'st'),
        playwright: path.join(dir, 'playwright'),
        screenshots: path.join(dir, 'screenshots'),
        exe: path.join(dir, 'executable-plan.json'),
        report: path.join(dir, 'execution-report.json'),
        ledger: path.join(dir, 'ledger.json'),
        simStore: path.join(dir, 'sim-store.json'),
      };
    },
  };
}
export type UiE2ePaths = ReturnType<typeof uiE2ePaths>;

export interface TwinInputs {
  readonly pMP: string | null;
  readonly pTM: string | null;
  /** The pushed IM, when the twin pushed one (its translate found it beside the TM). */
  readonly pIM: string | null;
  readonly exePlan: unknown;
  readonly report: unknown;
  readonly ledger: LedgerEntryLike[] | null;
  readonly e6Window: TimeWindow | null;
  /** What is missing, by name; empty = the twin can be compared against. */
  readonly missing: string[];
}

/** The headless twin's outputs, read from `<WS>`. */
export function readTwin(P: UiE2ePaths): TwinInputs {
  const pMP = latest(P.plansPushed, 'manual-mission-plan-');
  const pTM = latest(P.plansPushed, 'tenant-manifest-');
  const pIM = latest(P.plansPushed, 'infrastructure-manifest-');
  const exePlan = readJsonOrNull(P.exe);
  const report = readJsonOrNull(P.twinReport);
  const ledgerRaw = readJsonOrNull<{ data?: LedgerEntryLike[] }>(P.twinLedger);
  const steps = readJsonOrNull<Record<string, { started?: string; ended?: string }>>(P.stepsFile);
  const e6 = steps?.E6;
  const e6Window = e6?.started && e6?.ended ? { started: String(e6.started), ended: String(e6.ended) } : null;
  const missing = [
    ...(pMP ? [] : ['pushed mission plan']),
    ...(pTM ? [] : ['pushed tenant manifest']),
    ...(exePlan ? [] : ['out/executable-plan.json']),
    ...(report ? [] : ['out/execution-report.json']),
    ...(ledgerRaw?.data ? [] : ['out/ledger.json']),
    ...(e6Window ? [] : ['E6 window in out/steps.json']),
  ];
  return { pMP, pTM, pIM, exePlan, report, ledger: ledgerRaw?.data ?? null, e6Window, missing };
}

/** Why a variant cannot run here (its `requires_built` file is absent), or null. Pure over `exists`. */
export function variantSkipReason(v: UiE2eVariant, stamperRoot: string, exists: (p: string) => boolean = fs.existsSync): string | null {
  if (!v.requires_built) return null;
  return exists(path.join(stamperRoot, v.requires_built))
    ? null
    : `not run: ${v.base_path} is not built (${v.requires_built} absent under ces-stamper)`;
}

/** Forward-slash path relative to `<WS>/out`. */
function outRel(P: UiE2ePaths, p: string | undefined): string | undefined {
  return p ? path.relative(P.out, p).split(path.sep).join('/') : undefined;
}

export interface VariantRunContext {
  readonly scenario: UiE2eScenario;
  readonly variant: UiE2eVariant;
  readonly P: UiE2ePaths;
  readonly twin: TwinInputs;
  readonly testerRoot: string;
  readonly watch: WatchMode;
  readonly initialPassword: string;
  readonly log: (line: string) => void;
}

export interface VariantRunOutput {
  readonly executablePlan: unknown;
  readonly report: unknown;
  readonly ledger: LedgerEntryLike[] | null;
  /** W8-UIT3: the variant's sim store snapshot (null when there was none to copy). */
  readonly store?: SimStoreLike | null;
  readonly executeWindow?: TimeWindow;
  readonly approvals?: number;
  readonly evidence?: unknown;
  readonly resourceLedger?: unknown;
  readonly files: VariantRecord['files'];
}

export interface UiE2eDeps {
  readonly runVariant: (ctx: VariantRunContext) => Promise<VariantRunOutput>;
  /** Stamper's built `projectExecutablePlan` (dist), as verify V72 imports it. */
  readonly loadProjector: (projectionModule: string) => Promise<(plan: unknown) => PlanProjectionLike>;
  readonly heldPorts: (ports: number[]) => Promise<number[]>;
}

export interface UiE2eRunOptions {
  readonly scenario: UiE2eScenario;
  readonly wsRoot: string;
  readonly packageRoot: string;
  readonly testerRoot: string;
  readonly watch: WatchMode;
  /** Narrow to these variants (CLI `--variant`); empty or absent = the scenario's variants. */
  readonly only?: readonly UiE2eVariantId[];
  readonly log?: (line: string) => void;
  readonly deps?: Partial<UiE2eDeps>;
}

async function defaultLoadProjector(projectionModule: string): Promise<(plan: unknown) => PlanProjectionLike> {
  const mod = (await import(pathToFileURL(projectionModule).href)) as { projectExecutablePlan?: (plan: unknown) => PlanProjectionLike };
  if (typeof mod.projectExecutablePlan !== 'function') throw new Error(`${projectionModule} exports no projectExecutablePlan (Stamper dist older than W8-STX?)`);
  return mod.projectExecutablePlan;
}

/** Run a native command to completion, stdout/stderr into `<logs>/<name>.{out,err}`. */
function runLogged(logs: string, name: string, exe: string, args: string[], cwd: string): Promise<number> {
  fs.mkdirSync(logs, { recursive: true });
  const o = fs.openSync(path.join(logs, `${name}.out`), 'w');
  const e = fs.openSync(path.join(logs, `${name}.err`), 'w');
  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      fs.closeSync(o);
      fs.closeSync(e);
      resolve(code);
    };
    const c = spawn(exe, args, { cwd, stdio: ['ignore', o, e], windowsHide: true });
    c.on('error', () => finish(1));
    c.on('close', (code) => finish(code ?? 1));
  });
}

/**
 * One real variant: reset and serve the sim, register the tenant, start Stamper's GUI, drive it, snapshot the
 * ledger, copy the UI's plan and report beside it. Throws on any step that did not happen.
 */
export async function runStamperVariant(ctx: VariantRunContext): Promise<VariantRunOutput> {
  const { P, scenario, variant, twin, log } = ctx;
  const slug = scenario.sim_scenario;
  const V = P.variant(variant.id);
  for (const d of [V.logs, V.tenants, V.pl, V.st, V.playwright, V.screenshots]) fs.mkdirSync(d, { recursive: true });
  let serve: ServeHandle | undefined;
  let gui: GuiServerHandle | undefined;
  /** FIN-29 (SP-11 sim-PFX sweep): this variant's throwaway sim PFX, removed in the finally block below. */
  let simPfx: string | undefined;
  try {
    log(`  [${variant.id}] reset the sim: stacksim scenario ${slug}`);
    const rc = await runLogged(V.logs, 'sim-scenario', process.execPath, ['bin/stacksim.mjs', 'scenario', slug], P.sim);
    if (rc !== 0) throw new Error(`stacksim scenario ${slug} failed (rc ${rc}; logs/sim-scenario.err)`);
    serve = await startServe({ stacksimRoot: P.sim, stance: scenario.stance, slug, port: SIM_PORT, logPath: path.join(V.logs, 'sim-serve.out') });

    const registry = createTenantRegistry({ registryRoot: V.tenants, stacksimRoot: P.sim });
    const certState = path.join(ctx.testerRoot, 'runs', 'e2e', SIM_CERT_STATE_FILE);
    const known = readJsonOrNull<{ thumbprint?: string }>(certState)?.thumbprint;
    const cert = await ensureSimCert({ outDir: V.dir, knownThumbprint: known });
    simPfx = cert.pfxPath;
    fs.mkdirSync(path.dirname(certState), { recursive: true });
    fs.writeFileSync(certState, JSON.stringify({ thumbprint: cert.thumbprint }, null, 2), 'utf8');
    await authorSimTenantRecord({
      registry,
      registryRoot: V.tenants,
      slug,
      auth: { certThumbprint: cert.thumbprint, certPath: cert.pfxPath },
      seedRef: { scenario: slug, stance: scenario.stance },
    });
    const launch = await getSimLaunchEnv(registry, slug, { stacksimRoot: P.sim });
    const shimRoot = path.join(ctx.testerRoot, 'assets', 'psmodules-shim');
    const env = withInitialPassword(
      buildGuiChildEnv({
        simLaunchEnv: launch,
        shimRoot,
        tenantRoot: V.tenants,
        pipelineRoot: V.pl,
        storageRoot: V.st,
      }),
      ctx.initialPassword,
    );
    // The tester's own shim (presence-only Microsoft.Graph stub, exports nothing) is allowed; any real module still fails.
    const violations = simOnlyEnvViolations(env, P.sim, undefined, { stubRoots: [shimRoot] });
    if (violations.length) throw new Error(`SIM-ONLY guard: ${violations.join('; ')}`);

    gui = await startStamperGui({ stamperRoot: P.stamper, env, port: STAMPER_GUI_PORT, logPath: path.join(V.logs, 'stamper-gui.log') });
    log(`  [${variant.id}] Stamper GUI up on ${gui.baseUrl}; console ${variant.base_path} (${ctx.watch.headless ? 'headless, on request' : `headed, slowMo ${ctx.watch.slowMo} ms`})`);

    const driveCtx: StamperUiDriveContext = {
      baseUrl: gui.baseUrl,
      basePath: variant.base_path,
      consoleVariant: variant.id,
      slug,
      missionPlanPath: twin.pMP!,
      manifestPath: twin.pTM!,
      ...(twin.pIM ? { infraManifestPath: twin.pIM } : {}),
      pipelineRoot: V.pl,
      watch: ctx.watch,
      planVariables: false,
      execMode: scenario.execute_mode,
      readLedgerAndEvidence: true,
      recordDir: V.playwright,
      screenshotDir: V.screenshots,
    };
    const drive: StamperUiDriveResult = await driveStamperUi(driveCtx);
    log(`  [${variant.id}] execute badge "${drive.executeBadge ?? '?'}" (narrative); ${drive.approvals ?? 0} approval(s); report ${drive.report?.status ?? 'missing'}`);

    const data = await queryLedger(SIM_URL, {});
    fs.writeFileSync(V.ledger, JSON.stringify({ data }));
    // FIN-19 (V110, FIN-10 / FD-2): EO assesses this variant's own pipeline root (its gate records, no reviews, no
    // records stores), after the ledger snapshot so EO's reads never enter the UI run's ledger (V73). Sim still up.
    // CES_EU_EO_PROBE=0 turns it off; a held port 4002 skips it (recorded).
    if (process.env.CES_EU_EO_PROBE !== '0') {
      const probeFile = path.join(V.dir, EU_EO_PROBE_FILE);
      if ((await heldPorts([4002])).length) fs.writeFileSync(probeFile, JSON.stringify({ schema: 'ces-tester/eu-eo-probe@1', variant: variant.id, tenant: slug, note: 'not run: port 4002 is held' }, null, 2));
      else {
        const probe = await runEuEoProbe({ variant: variant.id, slug, cesRoot: P.ces, tsx: P.tsx, pipelineRoot: V.pl, twinPlansDir: P.plansPushed, workDir: path.join(V.dir, 'eu-eo'), baseEnv: env, approvedRows: drive.approvedRows ?? [], log });
        fs.writeFileSync(probeFile, JSON.stringify(probe, null, 2));
      }
    }
    // W8-UIT3: the end state of this run's objects, for (c). The sim writes store.json on every
    // mutation; stop it first so the copy is the settled file, before the next variant resets it.
    await serve.stop().catch(() => undefined);
    serve = undefined;
    const store = snapshotSimStore(P.simTenantDir, V.simStore);
    const tr =drive.translateResponse as { planDataPaths?: { output?: unknown } } | undefined;
    const epSource = typeof tr?.planDataPaths?.output === 'string' ? tr.planDataPaths.output : undefined;
    let executablePlan: unknown = null;
    if (epSource && fs.existsSync(epSource)) {
      fs.copyFileSync(epSource, V.exe);
      executablePlan = readJsonOrNull(V.exe);
    }
    let report: unknown = null;
    if (drive.reportPath && fs.existsSync(drive.reportPath)) {
      fs.copyFileSync(drive.reportPath, V.report);
      report = readJsonOrNull(V.report);
    }
    return {
      executablePlan,
      report,
      ledger: data as unknown as LedgerEntryLike[],
      store,
      executeWindow: drive.executeWindow,
      approvals: drive.approvals,
      evidence: drive.evidenceScan,
      resourceLedger: drive.resourceLedger,
      files: {
        executable_plan: executablePlan ? outRel(P, V.exe) : undefined,
        execution_report: report ? outRel(P, V.report) : undefined,
        ledger: outRel(P, V.ledger),
        sim_store: store ? outRel(P, V.simStore) : undefined,
        video: outRel(P, drive.recording?.videoPath),
        trace: outRel(P, drive.recording?.tracePath),
      },
    };
  } finally {
    if (gui) await gui.stop().catch(() => undefined);
    if (serve) await serve.stop().catch(() => undefined);
    // FIN-29 (SP-11): the variant's throwaway sim PFX never outlives the variant (the next variant re-exports it from
    // the certificate store; nothing after the drive reads it), so no evidence folder can pick it up.
    if (simPfx) fs.rmSync(simPfx, { force: true });
  }
}

/** Copy the twin's sim tenant folder aside (before the first reset). */
function backupSimTenant(P: UiE2ePaths): boolean {
  if (!fs.existsSync(P.simTenantDir)) return false;
  fs.rmSync(P.simTenantBackup, { recursive: true, force: true });
  fs.cpSync(P.simTenantDir, P.simTenantBackup, { recursive: true });
  return true;
}

/** W8-UIT3: copy `<tenantDir>/store.json` to `dest` and return it parsed; null when there is none. */
export function snapshotSimStore(tenantDir: string, dest: string): SimStoreLike | null {
  const src = path.join(tenantDir, 'store.json');
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return readJsonOrNull<SimStoreLike>(dest);
}

/** Put the twin's sim tenant folder back (after the last variant). */
function restoreSimTenant(P: UiE2ePaths): void {
  if (!fs.existsSync(P.simTenantBackup)) return;
  fs.rmSync(P.simTenantDir, { recursive: true, force: true });
  fs.cpSync(P.simTenantBackup, P.simTenantDir, { recursive: true });
  fs.rmSync(P.simTenantBackup, { recursive: true, force: true });
}

/** The whole UI run: every selected variant against the twin; writes and returns `out/ui-e2e-stamper.json`. */
export async function runUiE2e(opts: UiE2eRunOptions): Promise<UiE2eStamperRecord> {
  const sc = opts.scenario;
  const slug = sc.sim_scenario;
  const P = uiE2ePaths(opts.wsRoot, opts.packageRoot, slug);
  const log = opts.log ?? ((l: string) => console.log(l));
  const deps: UiE2eDeps = {
    runVariant: opts.deps?.runVariant ?? runStamperVariant,
    loadProjector: opts.deps?.loadProjector ?? defaultLoadProjector,
    heldPorts: opts.deps?.heldPorts ?? heldPorts,
  };
  const started = nowIso();
  fs.mkdirSync(P.ui, { recursive: true });
  const twin = readTwin(P);
  const variants = sc.variants.filter((v) => !opts.only?.length || opts.only.includes(v.id));
  const results: VariantRecord[] = [];
  const notRun = (v: UiE2eVariant, reason: string): VariantRecord => ({ variant: v.id, base_path: v.base_path, ran: false, reason, pass: false });

  log(`ui-e2e ${sc.scenario_id}: ${variants.map((v) => `${v.id} (${v.base_path})`).join(', ')}; ${opts.watch.headless ? 'HEADLESS (requested)' : 'headed, watchable (default)'}`);
  let fatal: string | null = null;
  if (twin.missing.length) fatal = `no headless twin to compare against: missing ${twin.missing.join(', ')}`;
  if (!fatal) {
    const held = await deps.heldPorts(UI_RUN_PORTS);
    if (held.length) fatal = `ports in use: ${held.join(', ')} (stop that process yourself; this run never kills one)`;
  }
  let project: ((plan: unknown) => PlanProjectionLike) | null = null;
  let twinStore: SimStoreLike | null = null;
  if (!fatal) {
    try {
      project = await deps.loadProjector(P.stamperProjection);
    } catch (err) {
      fatal = `Stamper projection unavailable: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (fatal) {
    log(`  ${fatal}`);
    for (const v of variants) results.push(notRun(v, fatal));
  } else {
    const twinProjection = project!(twin.exePlan);
    const initialPassword = mintInitialPassword();
    const backedUp = backupSimTenant(P);
    // R-UIT3-1: prefer the harness's E6-end snapshot (out/sim-store-e6.json) over the EU-start store.
    const e6Store = path.join(P.out, 'sim-store-e6.json');
    if (fs.existsSync(e6Store)) {
      fs.mkdirSync(path.dirname(P.twinSimStore), { recursive: true });
      fs.copyFileSync(e6Store, P.twinSimStore);
      twinStore = JSON.parse(fs.readFileSync(P.twinSimStore, 'utf8'));
    } else {
      twinStore = backedUp ? snapshotSimStore(P.simTenantBackup, P.twinSimStore) : null;
    }
    try {
      for (const v of variants) {
        fs.rmSync(P.variant(v.id).dir, { recursive: true, force: true });
        const skip = variantSkipReason(v, P.stamper);
        if (skip) {
          log(`  [${v.id}] ${skip}`);
          results.push(notRun(v, skip));
          continue;
        }
        try {
          const outp = await deps.runVariant({ scenario: sc, variant: v, P, twin, testerRoot: opts.testerRoot, watch: opts.watch, initialPassword, log });
          const comparison = compareVariant({
            variant: v.id,
            uiProjection: outp.executablePlan ? project!(outp.executablePlan) : null,
            twinProjection,
            uiReport: outp.report,
            twinReport: twin.report,
            uiLedger: outp.ledger,
            uiWindow: outp.executeWindow ?? null,
            twinLedger: twin.ledger,
            twinWindow: twin.e6Window,
            uiStore: outp.store ?? null,
            twinStore,
          });
          for (const c of [comparison.a_projection, comparison.b_failed_set, comparison.c_ledger_rows]) log(`  [${v.id}] ${c.pass ? 'EQUAL' : 'DIFF '} ${c.detail}`);
          results.push({
            variant: v.id,
            base_path: v.base_path,
            ran: true,
            pass: comparison.pass,
            comparison,
            files: outp.files,
            ...(outp.executeWindow ? { execute_window: outp.executeWindow } : {}),
            ...(outp.approvals !== undefined ? { approvals: outp.approvals } : {}),
            ...(outp.evidence !== undefined ? { evidence: outp.evidence } : {}),
            ...(outp.resourceLedger !== undefined ? { resource_ledger: outp.resourceLedger } : {}),
            headed: !opts.watch.headless,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log(`  [${v.id}] FAILED: ${error}`);
          results.push({ variant: v.id, base_path: v.base_path, ran: true, error, pass: false, headed: !opts.watch.headless });
        }
      }
    } finally {
      if (backedUp) restoreSimTenant(P);
    }
  }

  const record: UiE2eStamperRecord = {
    schema: UI_E2E_STAMPER_SCHEMA,
    scenario_id: sc.scenario_id,
    slug,
    surface: 'stamper',
    started,
    ended: nowIso(),
    twin: {
      executable_plan: 'executable-plan.json',
      execution_report: 'execution-report.json',
      ledger: 'ledger.json',
      ...(twinStore ? { sim_store: outRel(P, P.twinSimStore) } : {}),
      e6_window: twin.e6Window,
    },
    variants: results,
    pass: recordPass(results),
  };
  fs.writeFileSync(P.record, JSON.stringify(record, null, 2));
  log(`ui-e2e ${sc.scenario_id}: ${record.pass ? 'PASS' : 'FAIL'} -> ${outRel(P, P.record)}`);
  return record;
}

/** FIN-35: `--variant legacy|kit` (repeatable) for a console scenario; none = all. Pure. */
export function consoleVariants(argv: readonly string[]): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === '--variant' && (argv[i + 1] === 'legacy' || argv[i + 1] === 'kit')) out.push(argv[i + 1]);
  });
  return out;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

/** CLI glue: `run-scenario <ui-e2e file> --root <WS> --package-root <pkg> [--headless] [--variant <id>]`. */
export async function runUiE2eCli(scenarioPath: string, argv: string[], testerRoot: string = process.cwd()): Promise<number> {
  const root = flag(argv, '--root');
  const packageRoot = flag(argv, '--package-root');
  if (!root || !packageRoot) {
    console.error('run-scenario (ui-e2e): --root <WS> and --package-root <run package> are required');
    return 2;
  }
  try {
    // FIN-35: the AO, EO and Muster consoles (surface ao | eo | muster) have their own loader and runner.
    const raw = (() => { try { return JSON.parse(fs.readFileSync(scenarioPath, 'utf8')) as unknown; } catch { return null; } })();
    if (consoleSurfaceOf(raw)) {
      const sc = await loadUiConsoleFile(scenarioPath);
      const rec = await runUiConsole({ scenario: sc, wsRoot: path.resolve(root), packageRoot: path.resolve(packageRoot), watch: resolveConsoleWatch(argv), only: consoleVariants(argv) });
      console.log(`${rec.pass ? 'PASS' : 'FAIL'}: ${rec.scenario_id}`);
      return rec.pass ? 0 : 1;
    }
    const scenario = await loadUiE2eFile(scenarioPath);
    const rec = await runUiE2e({
      scenario,
      wsRoot: path.resolve(root),
      packageRoot: path.resolve(packageRoot),
      testerRoot: path.resolve(testerRoot),
      watch: resolveUiE2eWatch(argv),
      only: selectedVariants(argv),
    });
    console.log(`${rec.pass ? 'PASS' : 'FAIL'}: ${rec.scenario_id}`);
    return rec.pass ? 0 : 1;
  } catch (err) {
    console.error(`ces-tester run-scenario (ui-e2e): crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return 2;
  }
}
