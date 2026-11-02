// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-35 (finishing plan PH-3 harness): the watched AO, EO and Muster console runs (steps EU-AO, EU-EO, EU-MU), each
 * compared with its headless twin. Same shape as the Stamper EU (ui-e2e-run.ts): it runs AFTER the twin (mx-e2e.ps1,
 * E1..E9M), with the twin's servers stopped, reads the twin's outputs from `<WS>/out`, and per variant:
 *
 *  1. resets the sim to the scenario and restores the twin's sim store at the right moment (AO: `sim-store-e7a-pre.json`,
 *     the state E7A started from; EO: `sim-store-e7b.json`, the state E7B assessed; Muster: the scenario's start, as E2);
 *  2. builds PRIVATE roots under `<WS>/out/ui/<surface>/<variant>/`: a pipeline root (an online backup of `pl/ces.db`
 *     for EO, a fresh one for AO and Muster), a tenant root (a copy of the twin's sim record), EO's storage (a copy of
 *     `out/eo`), EC's store and the tenant's Stamper folder (copies). Nothing a console run writes reaches the twin's
 *     `pl/`, `tenants/` or `out/eo` (so a UI run can move no score: AR5);
 *  3. starts the module's own servers on the twin's ports (free after the twin) with fresh run secrets (env only);
 *  4. opens ONE window for the console (console-window.ts): headed, paced and captioned by default, video and trace under
 *     `<variant>/playwright`; `--headless` for unattended rounds;
 *  5. drives it (ao-/eo-/muster-console-driver.ts), reads the judged facts from the module's API and the browser's
 *     traffic, compares them with the twin (ui-console-compare.ts) and writes `<WS>/out/ui-e2e-<surface>.json`.
 *
 * The twin's sim tenant folder is copied aside first and put back after the last variant (verify reads the twin's).
 * Process rule: refuse to start while a port is held; stop only own children.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { createTenantRegistry, getSimLaunchEnv } from '../tenant-registry/index.js';
import { mergeSimLaunchEnv } from '../stamper-launcher/env.js';
import { verifyExpectedState } from '../verifier/expectedState.js';
import { startAoGui, AO_GUI_PORT, waitForHttpOk, ANY_HTTP_ANSWER } from '../demo/gui-servers.js';
import { startMusterPreview, MUSTER_SPA_PORT } from '../demo/show/arm-muster.js';
import { openConsoleWindow, CONSOLE_PLACEMENT, type ConsolePage } from '../demo/console-window.js';
import { driveAoConsole, cliShapeOf, type AoConsoleOp } from '../demo/ao-console-driver.js';
import { HEADLESS_MODE, WATCHED_MODE, type WatchMode } from '../demo/watch-mode.js';
import { simOnlyEnvViolations } from './sim-only-guard.js';
import { heldPorts, musterE2ePaths } from './muster-e2e-run.js';
import { buildAoEnv, eoAdminOpsWindowEnv, makeSimPfx, mintPrincipalSecret, recordValue, resolveCheck, summarizeExec, writeRecordCertPath, type AdminOpsOpSpec, type AoOpRecord, type DriftInjection } from './ao-step.js';
import { loadPrincipalSigner, operatorClaims } from './eo-reviews.js';
import { backupDb, latestPackageSnapshot } from './fin29-eo-muster.js';
import { resolve as simResolve } from '../stacksim-client/http.js';
import type { ResolveRequestBody } from '../stacksim-client/types.js';
import {
  clausesPass,
  compareAoRun,
  compareEoRun,
  compareMusterRun,
  pushedList,
  consoleRecordPass,
  statusMap,
  uiConsoleFile,
  UI_CONSOLE_SCHEMA_ID,
  type Clauses,
  type ConsoleRecord,
  type ConsoleVariantRecord,
  type EoUiFacts,
  type Flow7RunLike,
} from './ui-console-compare.js';
import { UI_CONSOLE_STEP_ID, type UiConsoleScenario, type UiConsoleSurface, type UiConsoleVariant } from './ui-console-file.js';

const SIM_PORT = 4390;
const SIM_URL = `http://127.0.0.1:${SIM_PORT}`;
const EO_PORT = 4002;
const EC_PORT = 4001;
const MUSTER_API_PORT = 4011;

/** The ports each console run binds (the twin's, free once the twin's servers stopped). */
export const UI_CONSOLE_PORTS: Record<UiConsoleSurface, number[]> = {
  ao: [SIM_PORT, AO_GUI_PORT],
  eo: [SIM_PORT, EO_PORT, EC_PORT],
  muster: [SIM_PORT, MUSTER_API_PORT, MUSTER_SPA_PORT],
};

/** The twin's sim-store snapshots the console runs restore (written by muster-e2e-run.ts E7A / E7B). */
export const SIM_STORE_E7A_PRE = 'sim-store-e7a-pre.json';
export const SIM_STORE_E7B = 'sim-store-e7b.json';

const nowIso = (): string => new Date().toISOString();
const readJsonOrNull = <T = unknown>(p: string | null | undefined): T | null => {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) as T;
  } catch {
    return null;
  }
};
const latest = (dir: string, prefix: string): string | null => {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  return f ? path.join(dir, f) : null;
};

export function resolveConsoleWatch(argv: readonly string[]): WatchMode {
  return argv.includes('--headless') ? HEADLESS_MODE : WATCHED_MODE;
}

export function uiConsolePaths(wsRoot: string, packageRoot: string, slug: string, surface: UiConsoleSurface) {
  const P = musterE2ePaths(wsRoot, packageRoot, slug);
  const root = path.join(P.out, 'ui', surface);
  return {
    ...P,
    surfaceRoot: root,
    record: path.join(P.out, uiConsoleFile(surface)),
    simTenantDir: path.join(P.sim, '.stacksim', 'tenants', slug),
    simTenantBackup: path.join(root, '_twin-sim-tenant'),
    musterScenario: path.join(P.ces, 'ces-tester', 'scenarios', 'muster', `${slug}-e2e.json`),
    variant: (id: string) => {
      const dir = path.join(root, id);
      return {
        dir,
        logs: path.join(dir, 'logs'),
        tenants: path.join(dir, 'tenants'),
        pl: path.join(dir, 'pl'),
        eo: path.join(dir, 'eo'),
        playwright: path.join(dir, 'playwright'),
        downloads: path.join(dir, 'downloads'),
        plan: path.join(dir, 'plan'),
        calls: path.join(dir, 'calls'),
      };
    },
  };
}
export type UiConsolePaths = ReturnType<typeof uiConsolePaths>;

/** Forward-slash path relative to `<WS>/out`. */
function outRel(P: UiConsolePaths, p: string | undefined | null): string | undefined {
  return p ? path.relative(P.out, p).split(path.sep).join('/') : undefined;
}

/** Why a variant cannot run (its `requires_built` file is absent under the module root), or null. Pure over `exists`. */
export function consoleSkipReason(v: UiConsoleVariant, moduleRoot: string, exists: (p: string) => boolean = fs.existsSync): string | null {
  if (!v.requires_built) return null;
  return exists(path.join(moduleRoot, v.requires_built)) ? null : `not run: ${v.base_path} is not built (${v.requires_built} absent)`;
}

export function moduleRootOf(P: UiConsolePaths, surface: UiConsoleSurface): string {
  return surface === 'ao' ? P.aoRoot : surface === 'eo' ? P.eoRoot : P.muster;
}

/** What each surface needs from the twin; `missing` names what is absent. Pure over the file system. */
export function readConsoleTwin(P: UiConsolePaths, surface: UiConsoleSurface): { missing: string[]; files: Record<string, string | null> } {
  const f = (p: string): string | null => (fs.existsSync(p) ? p : null);
  // PH-6 R-UI (V123-V125): the twin tears its ephemeral sim record down before EU; its snapshot stands in.
  const record = f(P.registryRecord) ?? f(P.registryRecordSnapshot);
  const files: Record<string, string | null> =
    surface === 'ao'
      ? { e7a: f(P.e7aFile), sim_store: f(path.join(P.out, SIM_STORE_E7A_PRE)) ?? f(path.join(P.out, 'sim-store-e6.json')), record, scenario: f(P.musterScenario) }
      : surface === 'eo'
        ? { ssp: f(path.join(P.out, 'ssp.json')), snapshot: latestPackageSnapshot(P.out)?.file ?? null, sim_store: f(path.join(P.out, SIM_STORE_E7B)), db: f(path.join(P.pl, 'ces.db')), eo_storage: f(path.join(P.out, 'eo')), record, review_plan: f(P.reviewPlanFile), eo_route_upload: f(P.eoRouteUploadFile) }
        : { plan: f(P.planDir), push: f(path.join(P.out, 'push-response.json')), discovery: f(P.disc), answers: f(P.interviewAnswers), record };
  const optional = new Set(['eo_route_upload', 'answers']);
  return { missing: Object.entries(files).filter(([k, v]) => !v && !optional.has(k)).map(([k]) => k), files };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared machinery
// ---------------------------------------------------------------------------------------------------------------------

export interface ConsoleLegContext {
  readonly scenario: UiConsoleScenario;
  readonly variant: UiConsoleVariant;
  readonly P: UiConsolePaths;
  readonly twin: ReturnType<typeof readConsoleTwin>;
  readonly watch: WatchMode;
  readonly log: (line: string) => void;
}
export interface ConsoleLegOutput {
  readonly facts: Record<string, unknown>;
  readonly clauses: Clauses;
  readonly files: Record<string, string | undefined>;
  readonly window: { started: string; ended: string };
}
export type ConsoleLeg = (ctx: ConsoleLegContext) => Promise<ConsoleLegOutput>;

class Children {
  private readonly procs: ChildProcess[] = [];
  constructor(private readonly logs: string) {
    fs.mkdirSync(logs, { recursive: true });
  }
  start(name: string, exe: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
    const o = fs.openSync(path.join(this.logs, `${name}.out`), 'w');
    const e = fs.openSync(path.join(this.logs, `${name}.err`), 'w');
    const c = spawn(exe, args, { cwd, env, stdio: ['ignore', o, e], windowsHide: true });
    fs.closeSync(o);
    fs.closeSync(e);
    this.procs.push(c);
    return c;
  }
  stopAll(): void {
    for (const c of this.procs.reverse()) {
      if (c.pid && c.exitCode === null && c.signalCode === null) spawnSync('taskkill.exe', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
  }
}

async function runLogged(logs: string, name: string, exe: string, args: string[], cwd: string): Promise<number> {
  fs.mkdirSync(logs, { recursive: true });
  const o = fs.openSync(path.join(logs, `${name}.out`), 'w');
  const e = fs.openSync(path.join(logs, `${name}.err`), 'w');
  return new Promise<number>((resolve) => {
    let done = false;
    const fin = (c: number): void => { if (done) return; done = true; fs.closeSync(o); fs.closeSync(e); resolve(c); };
    const c = spawn(exe, args, { cwd, stdio: ['ignore', o, e], windowsHide: true });
    c.on('error', () => fin(1));
    c.on('close', (code) => fin(code ?? 1));
  });
}

/** Reset the sim to the scenario, put `storeSnapshot` in place (when given) and serve it. */
async function serveSim(P: UiConsolePaths, sc: UiConsoleScenario, logs: string, storeSnapshot: string | null): Promise<ServeHandle> {
  const rc = await runLogged(logs, 'sim-scenario', process.execPath, ['bin/stacksim.mjs', 'scenario', sc.sim_scenario], P.sim);
  if (rc !== 0) throw new Error(`stacksim scenario ${sc.sim_scenario} failed (rc ${rc})`);
  if (storeSnapshot) {
    fs.mkdirSync(P.simTenantDir, { recursive: true });
    fs.copyFileSync(storeSnapshot, path.join(P.simTenantDir, 'store.json'));
  }
  return startServe({ stacksimRoot: P.sim, stance: sc.stance, slug: sc.sim_scenario, port: SIM_PORT, logPath: path.join(logs, 'sim-serve.out') });
}

/** A private tenant root holding a copy of the twin's sim record, with a fresh throwaway sim PFX; the sim launch env. */
async function privateTenant(P: UiConsolePaths, V: ReturnType<UiConsolePaths['variant']>, slug: string, source: string | null): Promise<{ record: Record<string, unknown>; simEnv: NodeJS.ProcessEnv; recordFile: string; pfx: string }> {
  if (!source) throw new Error('no twin registry record (live or snapshot)');
  const dst = path.join(V.tenants, 'sim');
  fs.mkdirSync(dst, { recursive: true });
  const recordFile = path.join(dst, `${slug}.json`);
  fs.copyFileSync(source, recordFile);
  const pfx = makeSimPfx(path.join(V.dir, 'sim-cert.pfx'));
  writeRecordCertPath(recordFile, pfx.path);
  const registry = createTenantRegistry({ registryRoot: V.tenants, stacksimRoot: P.sim });
  const launch = await getSimLaunchEnv(registry, slug, { stacksimRoot: P.sim });
  const simEnv = mergeSimLaunchEnv({ simLaunchEnv: launch });
  const violations = simOnlyEnvViolations(simEnv, P.sim);
  if (violations.length) throw new Error(`SIM-ONLY guard: ${violations.join('; ')}`);
  return { record: JSON.parse(fs.readFileSync(recordFile, 'utf8')) as Record<string, unknown>, simEnv, recordFile, pfx: pfx.path };
}

const secret = (): string => crypto.randomBytes(32).toString('hex');

async function withWindow<T>(ctx: ConsoleLegContext, url: string, fn: (page: ConsolePage) => Promise<T>, localStorage?: Record<string, string>): Promise<{ out: T; video?: string; trace?: string }> {
  const V = ctx.P.variant(ctx.variant.id);
  const s = await openConsoleWindow({ url, watch: ctx.watch, recordDir: V.playwright, placement: ctx.scenario.window ?? CONSOLE_PLACEMENT[ctx.scenario.surface], ...(localStorage ? { localStorage } : {}) });
  let out: T;
  try {
    out = await fn(s.page);
  } catch (err) {
    await s.close();
    throw err;
  }
  const rec = await s.close();
  return { out, video: rec.videoPath, trace: rec.tracePath };
}

/** Rows of one collection from a private ces.db by id (read-only). Null when unreadable. */
function dbRow(cesRoot: string, dbFile: string, collection: string, id: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(dbFile)) return null;
    const Database = createRequire(path.join(cesRoot, 'package.json'))('better-sqlite3') as new (f: string, o: object) => { prepare(s: string): { get(...a: unknown[]): { data: string } | undefined }; close(): void };
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const r = db.prepare('SELECT data FROM ces_records WHERE collection = ? AND id = ?').get(collection, id);
      return r ? (JSON.parse(r.data) as Record<string, unknown>) : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// EU-AO
// ---------------------------------------------------------------------------------------------------------------------

/** The twin's ops with their parameters read from the record (as runAoOps), in the scenario's order. Pure. */
export function aoConsoleOps(specs: readonly AdminOpsOpSpec[], record: Record<string, unknown>): { ops: AoConsoleOp[]; missing: string[] } {
  const missing: string[] = [];
  const ops = specs.map((s) => ({
    op: s.op,
    tier: s.tier,
    params: Object.entries(s.params ?? {}).map(([name, from]) => {
      const value = recordValue(record, from);
      if (value === undefined) missing.push(`${s.op} ${name} <- ${from}`);
      return { name, value: value ?? '' };
    }),
  }));
  return { ops, missing };
}

export const runAoLeg: ConsoleLeg = async (ctx) => {
  const { P, scenario: sc, variant, twin, log } = ctx;
  const slug = sc.sim_scenario;
  const V = P.variant(variant.id);
  const kids = new Children(V.logs);
  let serve: ServeHandle | undefined;
  let pfx: string | undefined;
  const started = nowIso();
  try {
    const musterSc = readJsonOrNull<{ adminops_ops?: AdminOpsOpSpec[]; drift_injection?: DriftInjection[] }>(twin.files.scenario) ?? {};
    const specs = musterSc.adminops_ops ?? [];
    serve = await serveSim(P, sc, V.logs, twin.files.sim_store);
    // The fallback snapshot (E6's) predates E6X: replay the scenario's drift injections, as E6X did.
    if (twin.files.sim_store?.endsWith('sim-store-e6.json')) for (const inj of musterSc.drift_injection ?? []) await simResolve(SIM_URL, inj.request as unknown as ResolveRequestBody);
    const t = await privateTenant(P, V, slug, ctx.twin.files.record ?? null);
    pfx = t.pfx;
    // AO's GUI child env: the AO env (sim only, private roots, a run-only principal secret), the tester's Graph presence
    // shim appended (as buildGuiChildEnv does for the GUIs), no auth token on loopback, no browser pop-up.
    const env: NodeJS.ProcessEnv = { ...buildAoEnv(t.simEnv, { pipelineRoot: V.pl, tenantRoot: V.tenants, simUrl: SIM_URL, secret: mintPrincipalSecret() }), CES_NO_OPEN: '1', BROWSER: 'none' };
    env.PSModulePath = `${env.PSModulePath ?? ''};${path.join(P.ces, 'ces-tester', 'assets', 'psmodules-shim')}`;
    delete env.CES_TWO_PERSON_APPROVAL; // two-person approval off (founder ruling 2026-10-31), as the twin ran
    delete env.CES_AO_AUTH_TOKEN;
    const gui = await startAoGui({ aoRoot: P.aoRoot, env, port: AO_GUI_PORT, logPath: path.join(V.logs, 'ao-gui.log') });
    try {
      const { ops, missing } = aoConsoleOps(specs, t.record);
      if (missing.length) throw new Error(`the registry record lacks ${missing.join(', ')}`);
      log(`  [ao/${variant.id}] AO console ${gui.baseUrl}${variant.base_path}: ${ops.map((o) => o.op).join(', ') || 'no ops'}`);
      const w = await withWindow(ctx, `${gui.baseUrl}${variant.base_path}`, (page) => driveAoConsole(page, slug, ops));
      fs.mkdirSync(V.calls, { recursive: true });
      const uiOps: AoOpRecord[] = [];
      for (const [i, r] of w.out.entries()) {
        const spec = specs[i];
        fs.writeFileSync(path.join(V.calls, `${String(i + 1).padStart(2, '0')}-${r.op}.json`), JSON.stringify(r, null, 2));
        const calls = r.calls.map((c) => {
          const rec = summarizeExec(c.call, [], { rc: c.http < 400 ? 0 : 1, stdout: JSON.stringify(cliShapeOf(c.body)), stderr: '' } as never);
          const row = rec.evidence_row_id ? dbRow(P.ces, path.join(V.pl, 'ces.db'), 'adminops_evidence', rec.evidence_row_id) : null;
          return { ...rec, ...(row ? { evidence_objectives: (row.evidenceObjectives as string[] | undefined) ?? [] } : {}) };
        });
        const op: AoOpRecord & { evidence_objectives?: string[] } = { op: r.op, tier: spec.tier, kind: spec.kind, params: [], calls, ok: !r.error && calls.length === 2 && calls.every((c) => c.ok), ...(r.error ? { detail: r.error } : {}) };
        if (op.ok && spec.confirm) {
          const check = resolveCheck(spec.confirm, t.record);
          const v = await verifyExpectedState(SIM_URL, [check]);
          const act = v.assertions[0]?.actual;
          op.confirm = { check, pass: v.assertions[0]?.result === 'pass', ...(act === undefined ? {} : { actual: typeof act === 'string' ? act : JSON.stringify(act) }) };
          if (!op.confirm.pass) { op.ok = false; op.detail = `confirming read failed: ${op.confirm.actual ?? 'no value'}`; }
        }
        uiOps.push(op);
      }
      const e7a = readJsonOrNull<{ ops?: AoOpRecord[] }>(twin.files.e7a);
      const clauses = compareAoRun(e7a?.ops ?? null, uiOps);
      return { facts: { ops: uiOps }, clauses, files: { video: outRel(P, w.video), trace: outRel(P, w.trace), calls: outRel(P, V.calls), db: outRel(P, path.join(V.pl, 'ces.db')) }, window: { started, ended: nowIso() } };
    } finally {
      await gui.stop().catch(() => undefined);
    }
  } finally {
    kids.stopAll();
    if (serve) await serve.stop().catch(() => undefined);
    if (pfx) fs.rmSync(pfx, { force: true });
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// The module owners' watched specs (FIN-31's v124-watched-eo.spec.ts, FIN-32's flow7-muster-ui.spec.ts)
// ---------------------------------------------------------------------------------------------------------------------

/** Runs one Playwright spec of a module (its own config), headed unless headless; stdout/stderr into `<logs>/<name>`. */
/**
 * The Playwright CLI the module's own spec and config resolve (`@playwright/test/cli` from `cwd`, as Node resolves the
 * spec's import), else the mono root's. PH12-UI (V125): ces-muster has its own @playwright/test 1.61.1 while the root
 * has 1.64.1; the root CLI loading a spec that imports the other copy finds no tests ("two different versions of
 * @playwright/test") and exits 1 before any browser opens. ces-eo/ui has no copy of its own, so it gets the root's.
 */
export function playwrightCliFor(cwd: string, cesRoot: string): string {
  try {
    return createRequire(path.join(cwd, 'noop.js')).resolve('@playwright/test/cli');
  } catch {
    return path.join(cesRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  }
}

async function runSpec(o: { P: UiConsolePaths; logs: string; name: string; cwd: string; config: string; spec: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<number> {
  const cli = playwrightCliFor(o.cwd, o.P.ces);
  return new Promise<number>((resolve) => {
    fs.mkdirSync(o.logs, { recursive: true });
    const out = fs.openSync(path.join(o.logs, `${o.name}.out`), 'w');
    const err = fs.openSync(path.join(o.logs, `${o.name}.err`), 'w');
    let done = false;
    const fin = (c: number): void => { if (done) return; done = true; clearTimeout(timer); fs.closeSync(out); fs.closeSync(err); resolve(c); };
    const c = spawn(process.execPath, [cli, 'test', o.spec, '-c', o.config, '--reporter=list'], { cwd: o.cwd, env: o.env, stdio: ['ignore', out, err], windowsHide: false });
    const timer = setTimeout(() => { if (c.pid) spawnSync('taskkill.exe', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); fin(124); }, o.timeoutMs);
    c.on('error', () => fin(1));
    c.on('close', (code) => fin(code ?? 1));
  });
}

/** The newest file named `name` under `dir` (Playwright puts video.webm / trace.zip in a per-test folder). */
function newestNamed(dir: string, re: RegExp): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const all: Array<{ f: string; t: number }> = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (re.test(e.name)) all.push({ f: p, t: fs.statSync(p).mtimeMs });
    }
  };
  walk(dir);
  return all.sort((a, b) => b.t - a.t)[0]?.f;
}

async function httpJson(url: string, headers: Record<string, string>, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
  try {
    const r = await fetch(url, { method: init.method ?? 'GET', headers: { ...headers, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), signal: AbortSignal.timeout(900000) });
    const t = await r.text();
    let j: unknown = null;
    try { j = JSON.parse(t); } catch { /* not JSON */ }
    return { status: r.status, json: j };
  } catch {
    return { status: 0, json: null };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// EU-EO (V124): ces-eo/ui/e2e/v124-watched-eo.spec.ts (LOG-FIN-31 STOP item 6) on a private EO and EC
// ---------------------------------------------------------------------------------------------------------------------

/** The upload and review the console repeats: the twin's E8.5b / E8.6b control and objective, the plan's people. Pure. */
export function eoProbeTarget(reviewPlan: { uploader?: { upn?: string }; reviewer?: { upn?: string } | null; operatorUpn?: string } | null) {
  return {
    uploaderUpn: reviewPlan?.uploader?.upn ?? null,
    reviewerUpn: reviewPlan?.reviewer?.upn ?? null,
    operatorUpn: reviewPlan?.operatorUpn ?? null,
    controlId: 'PE.L2-3.10.2',
    objectiveId: 'PE.L2-3.10.2[b]',
  };
}

/** The spec's run record (`EO_UI_EVIDENCE_OUT`) and the API reads, as the V124 facts. Pure. */
export function eoFactsFromSpec(
  rec: { sprsAfterReview?: string | null; docx?: string | null; upload?: string | null; review?: string | null; assessorRow?: string | null } | null,
  api: { assessment: unknown; sprs: unknown; ssp: unknown },
  target: ReturnType<typeof eoProbeTarget>,
): EoUiFacts {
  const statuses = statusMap(api.assessment);
  const s = (api.sprs ?? {}) as { score?: unknown; sprs_score?: unknown };
  const sprsApi = typeof s.score === 'number' ? s.score : typeof s.sprs_score === 'number' ? s.sprs_score : null;
  const uploadedBy = rec?.upload ? /\bby\s+(\S+@\S+?)[\s.,;)]*$/i.exec(rec.upload.trim())?.[1] ?? (target.uploaderUpn && rec.upload.includes(target.uploaderUpn) ? target.uploaderUpn : null) : null;
  const reviewed = !!rec?.review && /review recorded/i.test(rec.review);
  return {
    assessStatuses: statuses,
    sprs: sprsApi,
    sspStatuses: statusMap(api.ssp),
    docxBytes: null,
    docxName: rec?.docx ?? null,
    upload: rec ? { status: uploadedBy ? 201 : null, uploader: uploadedBy, catalog_ids: [] } : null,
    review: rec ? { status: reviewed ? 201 : null, control_id: target.controlId, reviewer: reviewed ? target.reviewerUpn : null, uploader: target.uploaderUpn, counted: reviewed ? true : null, status_after: statuses?.[target.controlId] ?? null } : null,
    assessor: rec ? { rendered: !!(rec.assessorRow && rec.assessorRow.includes(target.controlId)) } : null,
  };
}

/**
 * The twin's SPRS for V124 (a_assess): the AUTHORITATIVE one, from the E7B assess stream (`eo-assess-7b.json`, an array
 * of SSE frames; its last `assess_summary`), which is also the state the leg copies. `summary.json` is the fallback
 * only: E9 writes it after EU-EO (R-F9 S1: EU-EO ended 15:58:04Z, summary.json 15:59:56Z), and on S3 its value is
 * the E7 passes' 18, not the authoritative 20 (V36: "authoritative 20 (E7B); E7 passes 18").
 */
export function twinEoSprs(summaryFile: string, assess7bFile: string): number | null {
  const frames = readJsonOrNull<unknown>(assess7bFile);
  if (Array.isArray(frames)) {
    const s = [...frames].reverse().find((f) => (f as { type?: unknown } | null)?.type === 'assess_summary') as { sprs_score?: unknown } | undefined;
    if (typeof s?.sprs_score === 'number') return s.sprs_score;
  }
  const fromSummary = readJsonOrNull<{ eo_assess?: { sprs_score?: unknown } }>(summaryFile)?.eo_assess?.sprs_score;
  return typeof fromSummary === 'number' ? fromSummary : null;
}

export const runEoLeg: ConsoleLeg = async (ctx) => {
  const { P, scenario: sc, variant, twin, log } = ctx;
  const slug = sc.sim_scenario;
  const V = P.variant(variant.id);
  const kids = new Children(V.logs);
  let serve: ServeHandle | undefined;
  let pfx: string | undefined;
  const started = nowIso();
  try {
    serve = await serveSim(P, sc, V.logs, twin.files.sim_store);
    const t = await privateTenant(P, V, slug, ctx.twin.files.record ?? null);
    pfx = t.pfx;
    // The private pipeline root: ces.db by online backup, EC's store and the tenant's Stamper folder by copy; EO storage.
    // The state E7B assessed (out/e7b, captured by muster-e2e-run.ts at E7B end) when present; else the end of the twin,
    // recorded as twin_state 'end-of-twin' (then E7C / E7S AO rows and E8F's forced evidence are in the copy too).
    fs.mkdirSync(V.pl, { recursive: true });
    const e7b = path.join(P.out, 'e7b');
    const fromE7b = fs.existsSync(path.join(e7b, 'pl', 'ces.db')) && fs.existsSync(path.join(e7b, 'eo'));
    const plSrc = fromE7b ? path.join(e7b, 'pl') : P.pl;
    await backupDb(P.ces, path.join(plSrc, 'ces.db'), path.join(V.pl, 'ces.db'));
    for (const rel of ['EvidenceCollector', path.join('Stamper', 'plan-data', slug)]) {
      const from = path.join(plSrc, rel);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(V.pl, rel), { recursive: true });
    }
    fs.cpSync(fromE7b ? path.join(e7b, 'eo') : path.join(P.out, 'eo'), V.eo, { recursive: true });
    const twinState = fromE7b ? 'e7b' : 'end-of-twin';
    // Fresh run secrets (env only). CES_EC_PRINCIPAL_SECRET is shared by EO (the uploader-token issuer) and EC.
    const sec = { service: secret(), ec: secret(), ecPrincipal: secret(), aoPrincipal: secret(), operator: secret() };
    const steps = readJsonOrNull<Record<string, { started?: string }>>(P.stepsFile) ?? {};
    kids.start('ec', process.execPath, [P.tsx, 'src/index.ts'], path.join(P.ces, 'ces-ec'), {
      ...t.simEnv, CES_PIPELINE_ROOT: V.pl, CES_TENANT_ROOT: V.tenants, EC_PORT: String(EC_PORT), EVIDENCE_OPS_SECRET: sec.ec, CES_EC_PRINCIPAL_SECRET: sec.ecPrincipal,
      CES_EVIDENCE_CATALOG_PATH: path.join(P.ces, 'ces-muster', 'src', 'features', 'plan', 'engine', 'data', 'evidence-catalog', 'evidence-catalog-release-0.json'),
    });
    await waitForHttpOk(`http://127.0.0.1:${EC_PORT}/api/health`, 60000);
    const eoEnv: NodeJS.ProcessEnv = {
      ...t.simEnv,
      ...eoAdminOpsWindowEnv(steps.E1?.started),
      CES_PIPELINE_ROOT: V.pl, CES_TENANT_ROOT: V.tenants,
      REGISTRY_PATH: path.join(P.stamperRegistry, 'cmmc-l2-commands.registry.json'),
      STORAGE_ROOT: V.eo, TENANT_SLUG: slug, EO_PORT: String(EO_PORT), COMPLIANCE_REPO_PATH: path.join(V.dir, 'eo-repo'),
      EC_URL: `http://127.0.0.1:${EC_PORT}`, EVIDENCE_OPS_SECRET: sec.ec, CES_EC_PRINCIPAL_SECRET: sec.ecPrincipal,
      CES_AO_PRINCIPAL_SECRET: sec.aoPrincipal, CES_EO_OPERATOR_SECRET: sec.operator, CES_EO_AUTH_TOKEN: sec.service,
      // PH12-UI (V124): the spec mints its uploader and approver tokens as the loopback dev operator, as the twin's E8.5/E8.6
      // do (muster-e2e-run.ts eoChildEnv). Without this flag operatorAuthFromEnv (ApproverTokenIssuer.ts) answers 503
      // operator_auth_not_configured and the spec stops at its first mint. Simulator and loopback only.
      CES_EO_OPERATOR_DEV_FALLBACK: '1',
    };
    delete eoEnv.TENANT_MANIFEST_PATH;
    delete eoEnv.CES_TWO_PERSON_APPROVAL;
    kids.start('eo', process.execPath, [P.tsx, 'src/eo/index.ts'], P.eoRoot, eoEnv);
    const eoUrl = `http://127.0.0.1:${EO_PORT}`;
    // PH9-TS (V124): EO gates /api/health behind CES_EO_AUTH_TOKEN (PH-7; V75 "EO tokenless /api/health 401"), so the
    // probe carries the run's service token; a 200 proves both that EO is up and that the token wiring is right.
    await waitForHttpOk(`${eoUrl}/api/health`, 120000, 1000, { headers: { Authorization: `Bearer ${sec.service}` } });
    const target = eoProbeTarget(readJsonOrNull(twin.files.review_plan));
    if (!target.uploaderUpn || !target.reviewerUpn || !target.operatorUpn) throw new Error('no review plan (out/logs/E8.5-review-plan.json) naming the uploader, reviewer and operator');
    const sign = await loadPrincipalSigner(P.ces);
    const operatorToken = sign(operatorClaims(target.operatorUpn), sec.operator);
    const probeFile = path.join(V.dir, 'eu-eo-upload.txt');
    fs.writeFileSync(probeFile, `FIN-35 EU-EO upload through the EO console (SIMULATED CUSTOMER (FICTIONAL)), ${slug}, ${target.controlId}\n`);
    const recordOut = path.join(V.dir, 'v124-run.json');
    log(`  [eo/${variant.id}] FIN-31 spec v124-watched-eo against ${eoUrl}${variant.base_path}; private root ${outRel(P, V.pl)}`);
    const rc = await runSpec({
      P, logs: V.logs, name: 'v124-spec', cwd: path.join(P.eoRoot, 'ui'), config: 'playwright.config.ts', spec: 'e2e/v124-watched-eo.spec.ts', timeoutMs: 45 * 60_000,
      env: {
        ...process.env,
        EO_URL: eoUrl, EO_UI_TENANT: slug, EO_UI_SERVICE_TOKEN: sec.service, EO_UI_OPERATOR_TOKEN: operatorToken,
        EO_UI_UPLOADER_UPN: target.uploaderUpn, EO_UI_REVIEWER_UPN: target.reviewerUpn, EO_UI_CONTROL: target.controlId, EO_UI_OBJECTIVE: target.objectiveId,
        EO_UI_FILE: probeFile, EO_UI_EVIDENCE_OUT: recordOut, CES_UI_OUTPUT_DIR: V.playwright,
        ...(ctx.watch.headless ? { CES_UI_HEADLESS: '1' } : {}),
      },
    });
    const H = { Authorization: `Bearer ${sec.service}` };
    const q = `?tenant=${encodeURIComponent(slug)}`;
    const api = {
      assessment: (await httpJson(`${eoUrl}/api/assessment${q}`, H)).json,
      sprs: (await httpJson(`${eoUrl}/api/sprs${q}`, H)).json,
      ssp: (await httpJson(`${eoUrl}/api/ssp/latest${q}`, H)).json,
    };
    const sspFile = path.join(V.dir, 'ssp.json');
    if (api.ssp) fs.writeFileSync(sspFile, JSON.stringify(api.ssp, null, 2));
    const rec = readJsonOrNull<Parameters<typeof eoFactsFromSpec>[0]>(recordOut);
    const facts = { ...eoFactsFromSpec(rec, api, target), spec_rc: rc, twin_state: twinState };
    const twinFacts = { snapStatuses: statusMap(readJsonOrNull(twin.files.snapshot)), sspStatuses: statusMap(readJsonOrNull(twin.files.ssp)), sprs: twinEoSprs(path.join(P.out, 'summary.json'), P.assess7b), docx: fs.existsSync(path.join(P.out, 'ssp.docx')) };
    const clauses = compareEoRun(twinFacts, facts);
    if (rc !== 0) Object.assign(clauses, { z_spec: { pass: false, detail: `the FIN-31 spec exited ${rc} (logs/v124-spec.out)` } });
    return { facts: facts as unknown as Record<string, unknown>, clauses, files: { video: outRel(P, newestNamed(V.playwright, /\.webm$/)), trace: outRel(P, newestNamed(V.playwright, /^trace\.zip$/)), ssp_json: api.ssp ? outRel(P, sspFile) : undefined, spec_record: rec ? outRel(P, recordOut) : undefined, db: outRel(P, path.join(V.pl, 'ces.db')) }, window: { started, ended: nowIso() } };
  } finally {
    kids.stopAll();
    if (serve) await serve.stop().catch(() => undefined);
    if (pfx) fs.rmSync(pfx, { force: true });
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// EU-MU (V125): ces-muster e2e/flow7-muster-ui.spec.ts (LOG-FIN-32 §4 S-C) on a private muster-api root
// ---------------------------------------------------------------------------------------------------------------------

/** The compile 200 body's files written under `dir` (plan-compile.mjs writeCompiledFiles); returns the names. */
export function writeCompileFiles(dir: string, files: ReadonlyArray<{ name: string; content?: string; encoding?: string }> | undefined): string[] {
  const root = path.resolve(dir);
  fs.rmSync(root, { recursive: true, force: true });
  const names: string[] = [];
  for (const f of files ?? []) {
    const dest = path.resolve(root, f.name);
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error(`refused file name outside the plan folder: ${f.name}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(f.content ?? '', f.encoding === 'base64' ? 'base64' : 'utf8'));
    names.push(f.name);
  }
  return names;
}

/** The FLOW-7 operator on the private ces.db: fictional, run-only (LOG-FIN-32 S-C "seed an operator"). */
export const FLOW7_OPERATOR_EMAIL = 'flow7.operator@ces.invalid';

export const runMusterLeg: ConsoleLeg = async (ctx) => {
  const { P, scenario: sc, variant, twin, log } = ctx;
  const slug = sc.sim_scenario;
  const V = P.variant(variant.id);
  const kids = new Children(V.logs);
  let serve: ServeHandle | undefined;
  let pfx: string | undefined;
  let preview: { stop: () => Promise<void> } | undefined;
  const started = nowIso();
  try {
    serve = await serveSim(P, sc, V.logs, null);
    const t = await privateTenant(P, V, slug, ctx.twin.files.record ?? null);
    pfx = t.pfx;
    // FLOW-7 gets its own CES_PIPELINE_ROOT (S-C): its discovery and push rows and its plans folder never reach the twin's.
    fs.mkdirSync(V.pl, { recursive: true });
    const apiEnv: NodeJS.ProcessEnv = { ...t.simEnv, JWT_SECRET: secret(), PORT: String(MUSTER_API_PORT), CES_PIPELINE_ROOT: V.pl, CES_TENANT_ROOT: V.tenants, STACKSIM_SERVER_URL: SIM_URL };
    delete apiEnv.CES_EO_URL; // no EO in this run: the push's intake call is off (it never fails a push)
    delete apiEnv.CES_EO_AUTH_TOKEN;
    const password = secret();
    const seedRc = await new Promise<number>((resolve) => {
      const c = spawn(process.execPath, [P.tsx, 'scripts/seed.ts', '--email', FLOW7_OPERATOR_EMAIL, '--password', password], { cwd: P.musterApi, env: apiEnv, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
      c.on('error', () => resolve(1));
      c.on('close', (code) => resolve(code ?? 1));
    });
    if (seedRc !== 0) throw new Error(`seeding the FLOW-7 operator failed (rc ${seedRc})`);
    const apiUrl = `http://127.0.0.1:${MUSTER_API_PORT}`;
    kids.start('muster-api', process.execPath, ['dist/server.js'], P.musterApi, apiEnv);
    // PH9-TS (V125): muster-api has no `/` route (its 404 handler answers), so any HTTP answer is up, as the twin's
    // waitHttp (muster-e2e-run.ts) judges it.
    await waitForHttpOk(`${apiUrl}/`, 60000, 1000, { ready: ANY_HTTP_ANSWER });
    preview = await startMusterPreview({ musterRoot: P.muster, logPath: path.join(V.logs, 'muster-preview.log') } as never);
    const outDir = path.join(V.dir, 'flow7');
    log(`  [muster/${variant.id}] FIN-32 spec flow7-muster-ui against http://127.0.0.1:${MUSTER_SPA_PORT}${variant.base_path}; muster-api ${MUSTER_API_PORT} on ${outRel(P, V.pl)}`);
    const rc = await runSpec({
      P, logs: V.logs, name: 'flow7-spec', cwd: P.muster, config: 'playwright.config.ts', spec: 'e2e/flow7-muster-ui.spec.ts', timeoutMs: 60 * 60_000,
      env: {
        ...process.env,
        MUSTER_FLOW7: '1', MUSTER_FLOW7_SLUG: slug, MUSTER_FLOW7_CUSTOMER_DIR: path.join(P.pkg, 'customers', slug), MUSTER_FLOW7_API: `${apiUrl}/api`,
        MUSTER_FLOW7_EMAIL: FLOW7_OPERATOR_EMAIL, MUSTER_FLOW7_PASSWORD: password, MUSTER_FLOW7_OUT: outDir,
        MUSTER_FLOW7_BASE_URL: `http://127.0.0.1:${MUSTER_SPA_PORT}${variant.base_path}`,
        ...(ctx.watch.headless ? { MUSTER_FLOW7_HEADLESS: '1' } : {}),
      },
    });
    const run = readJsonOrNull<Flow7RunLike & { downloads?: string[] }>(path.join(outDir, 'flow7-run.json'));
    const sentFile = (run?.downloads ?? []).map((d) => (path.isAbsolute(d) ? d : path.join(outDir, d))).find((d) => /interview-answers-.*\.json$/.test(path.basename(d))) ?? newestNamed(outDir, /^interview-answers-.*\.json$/) ?? null;
    // Proposal (a): the API twin, run now with the UI run's own inputs (the answers it sent, the same org content, the
    // default stacks), as the SPA's apiCompile.ts calls it: E2' discovery with the answers, then E3' compile. No push.
    const mint = spawnSync(process.execPath, [P.mintToken, P.ces], { env: { ...process.env, JWT_SECRET: apiEnv.JWT_SECRET }, encoding: 'utf8', windowsHide: true });
    const token = mint.status === 0 ? mint.stdout.trim() : '';
    const sent = readJsonOrNull<unknown>(sentFile);
    const sentRows = Array.isArray(sent) ? sent : (sent as { answers?: unknown[] } | null)?.answers ?? null;
    const orgFile = path.join(P.pkg, 'customers', slug, 'org-content.json');
    const apiPlan = path.join(V.dir, 'api-plan');
    let apiCompile: { discovery: number; compile: number; files: number } | null = null;
    if (token && sentRows) {
      const H = { Authorization: `Bearer ${token}` };
      const disc = await httpJson(`${apiUrl}/api/discovery/run`, H, { method: 'POST', body: { tenant_slug: slug, answers: sentRows } });
      const envelope = (disc.json as { envelope?: unknown; result?: unknown } | null)?.envelope ?? (disc.json as { result?: unknown } | null)?.result ?? disc.json;
      const comp = await httpJson(`${apiUrl}/api/plan/compile`, H, { method: 'POST', body: { tenant_slug: slug, discovery: envelope, interview_answers: sentRows, ...(fs.existsSync(orgFile) ? { org_content: fs.readFileSync(orgFile, 'utf8') } : {}) } });
      const names = comp.status === 200 ? writeCompileFiles(apiPlan, (comp.json as { files?: Array<{ name: string; content?: string; encoding?: string }> } | null)?.files) : [];
      apiCompile = { discovery: disc.status, compile: comp.status, files: names.length };
    }
    const plansDir = path.join(V.pl, 'Stamper', 'plan-data', slug, 'plans');
    const fileRows = readJsonOrNull<Array<{ question_id: string }>>(twin.files.answers) ?? [];
    const sentIds = new Set((sentRows ?? []).map((r) => (r as { question_id?: string }).question_id));
    const notSent = fileRows.map((r) => r.question_id).filter((id) => !sentIds.has(id));
    const mpHash = (dir: string): string | null => readJsonOrNull<{ inputs?: { cui_boundary_ref?: { hash_sha256?: string } } }>(latest(dir, 'manual-mission-plan-'))?.inputs?.cui_boundary_ref?.hash_sha256 ?? null;
    const twinPush = readJsonOrNull<{ pushed?: string[] }>(twin.files.push);
    const clauses = compareMusterRun({ planCompare: null, twinPushed: twinPush?.pushed ?? null, uiPushed: pushedList(run?.pushed), run, notSent: sentRows ? notSent : null, boundary: { ui_hash: mpHash(plansDir), api_hash: mpHash(apiPlan) } });
    // (a) is verify's (the V88 projection over the two folders); the tester records the folders and does not judge it.
    const tclauses: Clauses = { ...clauses, a_plan: apiCompile?.compile === 200 && fs.existsSync(plansDir) ? { pass: true, detail: `UI-pushed folder and the API compile (${apiCompile.files} files) written for verify's V88 comparison` } : { pass: false, detail: `no API compile with the UI's inputs (${apiCompile ? `discovery ${apiCompile.discovery}, compile ${apiCompile.compile}` : sentRows ? 'no token' : 'no answers file downloaded by the spec'})` } };
    if (rc !== 0) Object.assign(tclauses, { z_spec: { pass: false, detail: `the FIN-32 spec exited ${rc} (logs/flow7-spec.out)` } });
    const facts = { spec_rc: rc, pushed: pushedList(run?.pushed), not_sent: notSent, api_compile: apiCompile };
    return {
      facts, clauses: tclauses,
      files: { video: outRel(P, newestNamed(outDir, /\.webm$/) ?? newestNamed(path.join(P.muster, 'test-results'), /\.webm$/)), trace: outRel(P, newestNamed(outDir, /^trace\.zip$/)), flow7: run ? outRel(P, path.join(outDir, 'flow7-run.json')) : undefined, answers_sent: sentFile ? outRel(P, sentFile) : undefined, ui_plans: fs.existsSync(plansDir) ? outRel(P, plansDir) : undefined, api_plan: apiCompile?.files ? outRel(P, apiPlan) : undefined },
      window: { started, ended: nowIso() },
    };
  } finally {
    if (preview) await preview.stop().catch(() => undefined);
    kids.stopAll();
    if (serve) await serve.stop().catch(() => undefined);
    if (pfx) fs.rmSync(pfx, { force: true });
  }
};


// ---------------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------------

export const DEFAULT_LEGS: Record<UiConsoleSurface, ConsoleLeg> = { ao: runAoLeg, eo: runEoLeg, muster: runMusterLeg };

export interface UiConsoleRunOptions {
  readonly scenario: UiConsoleScenario;
  readonly wsRoot: string;
  readonly packageRoot: string;
  readonly watch: WatchMode;
  readonly only?: readonly string[];
  readonly log?: (line: string) => void;
  readonly deps?: { legs?: Partial<Record<UiConsoleSurface, ConsoleLeg>>; heldPorts?: (ports: number[]) => Promise<number[]>; exists?: (p: string) => boolean };
}

function backupSimTenant(P: UiConsolePaths): boolean {
  if (!fs.existsSync(P.simTenantDir)) return false;
  fs.rmSync(P.simTenantBackup, { recursive: true, force: true });
  fs.cpSync(P.simTenantDir, P.simTenantBackup, { recursive: true });
  return true;
}
function restoreSimTenant(P: UiConsolePaths): void {
  if (!fs.existsSync(P.simTenantBackup)) return;
  fs.rmSync(P.simTenantDir, { recursive: true, force: true });
  fs.cpSync(P.simTenantBackup, P.simTenantDir, { recursive: true });
  fs.rmSync(P.simTenantBackup, { recursive: true, force: true });
}

export async function runUiConsole(opts: UiConsoleRunOptions): Promise<ConsoleRecord> {
  const sc = opts.scenario;
  const slug = sc.sim_scenario;
  const surface = sc.surface;
  const P = uiConsolePaths(opts.wsRoot, opts.packageRoot, slug, surface);
  const log = opts.log ?? ((l: string) => console.log(l));
  const leg = opts.deps?.legs?.[surface] ?? DEFAULT_LEGS[surface];
  const held = opts.deps?.heldPorts ?? heldPorts;
  const started = nowIso();
  fs.mkdirSync(P.surfaceRoot, { recursive: true });
  const twin = readConsoleTwin(P, surface);
  const variants = sc.variants.filter((v) => !opts.only?.length || opts.only.includes(v.id));
  const results: ConsoleVariantRecord[] = [];
  const headed = !opts.watch.headless;
  log(`${UI_CONSOLE_STEP_ID[surface]} ${sc.scenario_id}: ${variants.map((v) => `${v.id} (${v.base_path})`).join(', ')}; ${headed ? 'headed, watchable (default)' : 'HEADLESS (requested)'}`);
  let fatal: string | null = twin.missing.length ? `no headless twin to compare against: missing ${twin.missing.join(', ')}` : null;
  if (!fatal) {
    const h = await held(UI_CONSOLE_PORTS[surface]);
    if (h.length) fatal = `ports in use: ${h.join(', ')} (stop that process yourself; this run never kills one)`;
  }
  if (fatal) {
    log(`  ${fatal}`);
    for (const v of variants) results.push({ variant: v.id, base_path: v.base_path, ran: false, reason: fatal, pass: false });
  } else {
    const backedUp = backupSimTenant(P);
    try {
      for (const v of variants) {
        const skip = consoleSkipReason(v, moduleRootOf(P, surface), opts.deps?.exists);
        if (skip) {
          log(`  [${surface}/${v.id}] ${skip}`);
          results.push({ variant: v.id, base_path: v.base_path, ran: false, reason: skip, pass: false });
          continue;
        }
        fs.rmSync(P.variant(v.id).dir, { recursive: true, force: true });
        fs.mkdirSync(P.variant(v.id).dir, { recursive: true });
        try {
          const o = await leg({ scenario: sc, variant: v, P, twin, watch: opts.watch, log });
          const pass = clausesPass(o.clauses);
          for (const [k, c] of Object.entries(o.clauses)) log(`  [${surface}/${v.id}] ${c.pass ? 'EQUAL' : 'DIFF '} (${k}) ${c.detail}`);
          results.push({ variant: v.id, base_path: v.base_path, ran: true, pass, headed, clauses: o.clauses, facts: o.facts, files: o.files, window: o.window });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log(`  [${surface}/${v.id}] FAILED: ${error}`);
          results.push({ variant: v.id, base_path: v.base_path, ran: true, error, pass: false, headed });
        }
      }
    } finally {
      if (backedUp) restoreSimTenant(P);
    }
  }
  const record: ConsoleRecord = {
    schema: UI_CONSOLE_SCHEMA_ID,
    scenario_id: sc.scenario_id,
    slug,
    surface,
    step_id: UI_CONSOLE_STEP_ID[surface],
    started,
    ended: nowIso(),
    headed,
    twin: Object.fromEntries(Object.entries(twin.files).map(([k, v]) => [k, v ? outRel(P, v) ?? v : null])),
    variants: results,
    pass: consoleRecordPass(results),
  };
  fs.writeFileSync(P.record, JSON.stringify(record, null, 2));
  log(`${UI_CONSOLE_STEP_ID[surface]} ${sc.scenario_id}: ${record.pass ? 'PASS' : 'FAIL'} -> ${outRel(P, P.record)}`);
  return record;
}
