// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * P4.1: the `muster-e2e` scenario runner. Drives the sequence the run
 * package's `scripts/mx-e2e.ps1` runs (steps E1-E8F), adds the tester's own
 * comparison (EX) and stacksim coverage-ao (AO), and writes the package's
 * output layout under `<WS>/out` so the package's verify.mjs and bundle.mjs
 * read it unchanged: `steps.json` (same ids, rc, started, ended), `logs/`,
 * `discovery-result.json`, `plan/`, `executable-plan.json`,
 * `execution-report.json`, `eo-*.json`, `ssp.*`, `poam.json`, `ec-upload*.json`,
 * `ledger.json`, `runs/forced/`, plus `tester-run.json` and `coverage-ao.json`.
 *
 * Reuse: sim reseed and serve (stacksim-client serve-lifecycle), sim-tenant
 * registration and the Stamper launch env (tenant-registry, stamper-launcher:
 * the run-scenario-command.ts wiring), the SIM-ONLY guard, the synthetic
 * Stamper env file, the expected-state verifier. From the package:
 * `mx-helpers.mjs` sse + push are ported into ./mx-io.ts (that file exports
 * nothing); mint-token.mjs and bundle.mjs are spawned by path from the package root.
 * Synthetic-customer W1: the E6 overrides step is conditional (./overrides-gate.ts, which mirrors the package's
 * overrides-gate.mjs). Gap closure FLOW-5 (a): `initialPassword` is no longer minted here; muster-api issues it at E3 as a
 * secret reference and Stamper resolves it from muster-api at E6 and E8F (CES_MUSTER_SECRETS_URL / _TOKEN in its child env).
 * Gap closure API-3a: E3 compiles through muster-api's POST /api/plan/compile (the package's scripts/plan-compile.mjs, spawned
 * by path); muster-api starts at E3 and stays up through E8F. The retired runner (ces-muster scripts/mx/plan-from-discovery.ts)
 * runs once more on the same inputs into out/plan-script, only for V88's comparison.
 *
 * Process rule (as the package): refuse to start while a run port is held;
 * never kill a process this run did not start; stop own children by tree.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { queryLedger } from '../stacksim-client/http.js';
import { mergeSimLaunchEnv } from '../stamper-launcher/env.js';
import { writeSyntheticStamperEnv, SYNTHETIC_TENANT_ID } from '../stamper-launcher/synthetic-env.js';
import { launchStamperTranslate, launchStamperExecute } from '../stamper-launcher/launch.js';
import type { StamperSpawnResult } from '../stamper-launcher/spawn.js';
import {
  createTenantRegistry,
  createEphemeralSimTenant,
  teardownEphemeralSimTenant,
  getSimLaunchEnv,
} from '../tenant-registry/index.js';
import { simOnlyEnvViolations } from './sim-only-guard.js';
import { verifyExpectedState } from '../verifier/expectedState.js';
import { readSse, pushPlans, eoAuthHeaders, sseFailureDetail } from './mx-io.js';
import {
  compareFacts,
  compareLedger,
  scenarioWriteSteps,
  type FactsComparison,
  type LedgerComparison,
  type LedgerEntryLike,
  type StepWindow,
} from './muster-e2e-compare.js';
import { runAoCoverage, AO_COVERAGE_COMMAND, type AoCoverageRecord } from './ao-coverage.js';
import { loadRecordsCatalog, recordUploadRequests, recordUploadsOk, recordsDir, uploadRecords } from './ec-records.js';
import { runOverridesGate } from './overrides-gate.js';
import { clearEcRows } from './ec-reset.js';
import { eoCaller, postEoRecords, NS3_ENABLE_ENV, type EoRecordPosts } from './eo-records.js';
import { buildEoIntakeBody, postEoIntake, intakeRecordFromPush, manifestPolicyTexts } from './eo-intake.js';
import {
  COST_PROBES,
  runCliReviewPair,
  runCostTraversal,
  muCompileArgs,
  runMuCompile,
  runPushProbes,
  postEoRouteUpload,
  PROBE_OTHER_TENANT,
  type CliRunner,
  type EoRouteUploadRecord,
} from './fin19-steps.js';
import {
  HARNESS_INTERVIEWER,
  attemptStaleBuild,
  badReviewUploads,
  loadInterviewRecordModule,
  loadPrincipalSigner,
  operatorClaims,
  postInterviewRecords,
  reviewUploadRequests,
  reviewUploadRows,
  runReviewStep,
  splitReviewUploads,
  uploaderClaims,
  type LoadDocumentReviews,
  type PrincipalSigner,
  type ReviewPlan,
} from './eo-reviews.js';
import { pathToFileURL } from 'node:url';
import { resolve as simResolve } from '../stacksim-client/http.js';
import type { ExpectedStateCheck } from '../verifier/expectedState.js';
import {
  ADMINOPS_E7A_SCHEMA,
  AO_CLI_REL,
  AO_ENV_KEYS,
  DISCOVERERS,
  EO_ADMINOPS_SINCE_ENV,
  buildAoEnv,
  eoAdminOpsWindowEnv,
  makeSimPfx,
  simCertPath,
  writeRecordCertPath,
  mintPrincipalSecret,
  resolveCheck,
  resourceKeysNamed,
  resourcesFromTm,
  rowsOf,
  runAoOps,
  writeRecordResources,
  twoPersonApprovalOn,
  TWO_PERSON_APPROVAL_ENV,
  type AoCliResult,
  type RegistryResources,
} from './ao-step.js';
import type { MusterE2eScenario } from '../scenarios/musterE2eFile.js';
import { RunSecrets, liveFolderViolations, runScanRoots, scanForSecrets } from './fin29-hygiene.js';
import { eoCliEffectiveRc, expectedEcItems, seedCostProbeResources, waitEcItemsReady } from './fin29-rf1-fixes.js';
import { FIN29_DIRS, FIN29_FILES, type Fin29StepCtx, type Fin29StepDef } from './fin29-common.js';
import { e0Step, e8gStep, e8rStep, e8tStep } from './fin29-stamper.js';
import { e9aStep } from './fin29-ao.js';
import { e7sStep } from './ao-sweep-run.js';
import { EL_BHD_MAILBOX, EL_SCENARIOS, elAdminRecipients, redactTokens, runLeaverFlow } from './leaver-step.js';
import { backupDb, e9eStep, e9mStep, type Fin29EoMusterCtx } from './fin29-eo-muster.js';
import type { ResultAssertion, DivergedCommand } from '../results/result-shape.js';

/**
 * Step order (as mx-e2e.ps1: E8.5 runs before E7 because EO reads EC items during assess). Synthetic-customer W2
 * (PLAN §3): E6X (S3 re-injection) after E6; E7A (AdminOps) and E7B (one more EO assess) after E7.
 * FIN-19 (finishing plan PH-1): E8.5b (one upload through EO's own upload route) and E8.6b (a supersede pair through
 * the `eo review` CLI) run inside E7 right after E8.6; E7C (the AO cost-gate traversal, V113) runs after E8F, so no
 * assessment sees its write. None of the three is in REQUIRED_STEPS: V112 / V113 judge them.
 * FIN-29 (finishing plan PH-2): E0 (clean-tenant init on its own clean-g5 sim, V117) runs before E1; after E7C come E8R
 * (Stamper lifecycle commands, V126), E8T (the pseudo-terminal CLI leg, V116), E8G (Stamper GUI DP-1/DP-2, V115), E9A (AO
 * MCP / CLI / rails, V127), E9E (EO scheduler, EC integrity and extra routes on a second EO, V119 / V120 / V128), E9M
 * (Muster engagement layer and secondary surfaces, V121 / V130) and E7S (the AO sweep, S1, V77), the last sim writer. None
 * is fatal or REQUIRED; the forced ledger is taken before the first of them (afterForcedLedger).
 * PH-13 (P13-LV, P13-INT): EL (the AdminOps leaver flow for PS.L2-3.9.2[b], leaver-step.ts) runs after E5 and before E6
 * on S1, S2 and S3 (skipped on muster-partial). Not fatal and not REQUIRED: V131 judges it (out/leaver-flow.json).
 */
export const MUSTER_E2E_STEP_IDS = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'EL', 'E6', 'E6X', 'E8.5', 'E8.6', 'E8.5b', 'E8.6b', 'E7', 'E7A', 'E7B', 'E8', 'EX', 'E8B', 'E8F', 'E7C', 'E8R', 'E8T', 'E8G', 'E9A', 'E9E', 'E9M', 'E7S', 'AO'] as const;
/** The steps the package's verify V1 requires at rc 0; V23 requires them too. */
export const REQUIRED_STEPS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E6X', 'E8.5', 'E8.6', 'E7', 'E7A', 'E7B', 'E8', 'E8B'];
export const RUN_PORTS = [4390, 4011, 4002, 4001];
/** FIX-EL (R-F11): out/<this>, the sim store as step EL left it (the state E6 starts from); the Stamper UI run restores it. */
export const SIM_STORE_EL = 'sim-store-el.json';

const SIM_URL = 'http://127.0.0.1:4390';
const API_URL = 'http://127.0.0.1:4011';
const EC_URL = 'http://127.0.0.1:4001';
const EO_URL = 'http://127.0.0.1:4002';

/**
 * EO's /api/assess URL for a tenant. W0 drift baseline: the forced-failure assess (E8F) sends `forced=1`, so EO stores
 * the snapshot with metadata.forced and never uses it as the next drift baseline.
 */
export function eoAssessUrl(slug: string, opts?: { forced?: boolean }): string {
  return `${EO_URL}/api/assess?tenant=${slug}${opts?.forced ? '&forced=1' : ''}`;
}

export interface MusterE2eRunOptions {
  scenario: MusterE2eScenario;
  scenarioPath: string;
  /** The workspace root: <WS>/ces holds the nested repos, <WS>/out the outputs. */
  wsRoot: string;
  /** The run package root (scripts/, customers/, the deprecated sim-overrides.json). */
  packageRoot: string;
  skipForcedRun?: boolean;
  forceFailEntry?: string;
  skipAo?: boolean;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface StepRow {
  id: string;
  title: string;
  commands: string[];
  fatal: boolean;
  status: 'ok' | 'fail' | 'skipped' | 'not-run' | 'planned';
  rc: number | null;
  started?: string;
  ended?: string;
  duration_ms?: number;
  detail?: string;
  extra?: Record<string, unknown>;
}

export interface MusterE2eComparison {
  pass: boolean;
  facts: FactsComparison;
  state: { pass: boolean; assertions: ResultAssertion[]; diverged: DivergedCommand[] };
  ledger: LedgerComparison;
}

export interface MusterE2eRunRecord {
  schema: 'ces-tester/muster-e2e-run@1';
  harness: 'ces-tester';
  scenario_id: string;
  scenario_file: string;
  sim_scenario: string;
  dry_run: boolean;
  started: string;
  ended: string;
  duration_ms: number;
  /** Relative to the workspace root (no machine paths in the record). */
  roots: { ws: '.'; ces: string; package: string; out: string };
  options: { skip_forced_run: boolean; force_fail_entry: string; skip_ao: boolean };
  required_steps: string[];
  steps: StepRow[];
  comparison: MusterE2eComparison | null;
  ao_coverage: { ran: boolean; pass: boolean; record: string; totals: AoCoverageRecord['totals']; reasons: string[] } | null;
  status: 'PASS' | 'FAIL' | 'DRY-RUN';
  failures: string[];
}

interface StepOutcome {
  rc: number;
  detail?: string;
  extra?: Record<string, unknown>;
}

interface StepDef {
  id: string;
  title: string;
  commands: string[];
  fatal: boolean;
  /** When set, the step is recorded as skipped with this reason. */
  skip?: string;
  run: () => Promise<StepOutcome>;
}

const nowIso = (): string => new Date().toISOString();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const readJson = <T = unknown>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) as T;
const exists = (p: string | null | undefined): p is string => !!p && fs.existsSync(p);

function latest(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  return f ? path.join(dir, f) : null;
}

function latestRecursive(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const all = (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => path.basename(f).startsWith(prefix) && f.endsWith('.json'))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  const f = all.pop();
  return f ? path.join(dir, f) : null;
}

/**
 * EO-collection W1.6 (V14): EO's evidence store (`<EO storage root>/evidence-store/`, one folder per tenant id) is
 * wiped once per run at E6, before E7, so the run's records are exactly this run's (three E7 passes plus E8F). This is
 * the run's sim storage root only; it does not touch the six-year retention of a real deployment's store.
 */
export function wipeEoEvidenceStore(eoStorageRoot: string): void {
  fs.rmSync(path.join(eoStorageRoot, 'evidence-store'), { recursive: true, force: true });
}

/**
 * FIN-29 (LOG-FIN-19 open item 1): the files muster-api writes into `<pl>/Stamper/plan-data/<slug>/state/` before E6
 * (FIN-17: its append-only record of its own EO calls and secret reads; the slug-owner claim). E6 wipes the rest of the
 * folder (Stamper's state of an earlier execute) and keeps these, so V88 (f) and V114 can read the E3/E4 lines.
 */
export const MUSTER_STATE_KEEP = ['muster-eo-calls.jsonl', 'muster-owner.json'] as const;

/** Removes everything under `dir` except the top-level files named in `keep` (the folder itself stays when any is kept). */
export function wipeKeeping(dir: string, keep: readonly string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const removed: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isFile() && keep.includes(d.name)) continue;
    fs.rmSync(path.join(dir, d.name), { recursive: true, force: true });
    removed.push(d.name);
  }
  return removed;
}

/**
 * W5 cycle 6 (run 52): the built simulator's PowerShell module generator (generatePsModule.ts's own CLI entry,
 * `node <this> <psmodulesDir>`), relative to the tenant-stacksim root. E1 runs it so a cmdlet added to the simulator
 * is exported before E6; the AO coverage step regenerates only at the end of a run.
 */
export const SIM_PSMODULE_GENERATOR = path.join('dist', 'src', 'codegen', 'generatePsModule.js');

/** The modules the generator wrote: `<dir>/<Name>/<Name>.psd1` files modified at or after `sinceMs`. */
export function countModulesWrittenSince(psmodulesDir: string, sinceMs: number): number {
  if (!fs.existsSync(psmodulesDir)) return 0;
  return fs.readdirSync(psmodulesDir, { withFileTypes: true }).filter((d) => {
    if (!d.isDirectory()) return false;
    const psd1 = path.join(psmodulesDir, d.name, `${d.name}.psd1`);
    return fs.existsSync(psd1) && fs.statSync(psd1).mtimeMs >= sinceMs;
  }).length;
}

/**
 * Run 61 (per-run cleanup): the per-run artefacts an earlier run left, removed before E1 so no check reads another
 * run's file (run 61 aborted at E7 after pass 1; V14 read run 60's passes 2 and 3). Top-level `out/` files and folders
 * by pattern, `out/logs/*`, `out/runs/forced/`, `out/runs/latest.json` and the harness-owned Stamper tenant folders
 * `<pl>/Stamper/plan-data/<slug>/{plans,state,evidence,evidence-by-task}`. Never: `out/run*-console.log`,
 * `out/verify-*.log`, the baselines, captures, archived run bundles, the simulator's tenant folders.
 * Kept for the package wrapper (mx-e2e.ps1 -Harness tester), which owns them: `out/outside-*.json` (its V10 snapshot,
 * taken before the tester starts) and `out/logs/tester-run.*` (open while the tester runs).
 */
const PER_RUN_FILE = [
  /^eo-assess.*\.json$/, /^eo-ledger\.json$/, /^eo-connect\.json$/, /^ssp\./, /^poam\.json$/, /^scorecard-.*\.json$/, /^GAPS-/,
  /^steps\.json$/, /^tester-run\.json$/, /^coverage-ao\.json$/, /^summary\.json$/, /^verify\.json$/, /^push-response\.json$/,
  /^ec-upload.*\.json$/, /^adminops-e7a\.json$/, /^e6x\.json$/, /^eo-package/, /^sim-store-e6\.json$/, /^sim-store-el\.json$/, /^sim-store-e7a-pre\.json$/, /^sim-store-e7b\.json$/, /^ui-e2e-(ao|eo|muster)\.json$/,
  /^muster-results\.json$/, /^eo-records\.json$/, // retired FLOW-6 read-back (ROLE-1: removed so V100 never sees an old one), NS-3 (V81)
  /^plan-compile\.json$/, // API-3a (V88)
  /^eo-intake\.json$/, // FLOW-3 (V84)
  /^eo-reviews\.json$/, /^eo-interviews\.json$/, // NS-4t: E8.6 (V80), E7's interview records (V81)
  // FIN-19: E3's mu compile (V114), E4's probes (V114), E8.5b / E8.6b (V112), E7C (V113). eo-package-cli* matches /^eo-package/.
  /^plan-compile-mu\.json$/, /^muster-probes\.json$/, /^ec-upload-eo-route\.json$/, /^eo-review-cli\.json$/, /^adminops-cost\.json$/,
  // FIN-29: the PH-2 records (fin29-common.ts FIN29_FILES: E0, E7S, E8R, E8T, E8G, E9A, E9E, E9M and the V101 leak scan).
  ...Object.values(FIN29_FILES).map((n) => new RegExp(`^${n.replace(/\./g, '\\.')}$`)),
];
// API-3a: plan-script (V88); FIN-19: plan-mu (V114); FIN-29: the PH-2 steps' private roots and transcripts (FIN29_DIRS).
const PER_RUN_DIR = ['plan', 'eo', 'st', 'disc', 'coverage-ao', 'ao', 'plan-script', 'plan-mu', 'e7b', ...FIN29_DIRS]; // FIN-35: e7b (EU-EO state)
const KEEP_LOG = /^tester-run\./;
export function perRunArtefacts(out: string, pl: string, slug: string): string[] {
  const found: string[] = [];
  if (fs.existsSync(out)) {
    for (const d of fs.readdirSync(out, { withFileTypes: true })) {
      if (PER_RUN_FILE.some((re) => re.test(d.name)) || (d.isDirectory() && PER_RUN_DIR.includes(d.name))) found.push(path.join(out, d.name));
    }
    const logs = path.join(out, 'logs');
    if (fs.existsSync(logs)) for (const f of fs.readdirSync(logs)) if (!KEEP_LOG.test(f)) found.push(path.join(logs, f));
    for (const f of [path.join(out, 'runs', 'forced'), path.join(out, 'runs', 'latest.json')]) if (fs.existsSync(f)) found.push(f);
  }
  const tenantPl = path.join(pl, 'Stamper', 'plan-data', slug);
  for (const sub of ['plans', 'state', 'evidence', 'evidence-by-task']) if (fs.existsSync(path.join(tenantPl, sub))) found.push(path.join(tenantPl, sub));
  return found;
}
export function cleanPerRunArtefacts(out: string, pl: string, slug: string): string[] {
  const found = perRunArtefacts(out, pl, slug);
  for (const f of found) fs.rmSync(f, { recursive: true, force: true });
  return found;
}

/** All the paths one run touches. */
export function musterE2ePaths(wsRoot: string, packageRoot: string, slug: string) {
  const ws = path.resolve(wsRoot);
  const pkg = path.resolve(packageRoot);
  const ces = path.join(ws, 'ces');
  const out = path.join(ws, 'out');
  const pl = path.join(ws, 'pl');
  return {
    ws,
    pkg,
    ces,
    out,
    logs: path.join(out, 'logs'),
    pl,
    tenants: path.join(ws, 'tenants'),
    sim: path.join(ces, 'tenant-stacksim'),
    musterApi: path.join(ces, 'ces-muster', 'muster-api'),
    muster: path.join(ces, 'ces-muster'),
    stamper: path.join(ces, 'ces-stamper'),
    stamperRegistry: path.join(ces, 'ces-stamper', 'src', 'registry'),
    tsx: path.join(ces, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    disc: path.join(out, 'discovery-result.json'),
    planDir: path.join(out, 'plan'),
    plansPushed: path.join(pl, 'Stamper', 'plan-data', slug, 'plans'),
    exe: path.join(out, 'executable-plan.json'),
    stCwd: path.join(out, 'stamper-cwd'),
    st: path.join(out, 'st'),
    forced: path.join(out, 'runs', 'forced'),
    stepsFile: path.join(out, 'steps.json'),
    recordFile: path.join(out, 'tester-run.json'),
    aoFile: path.join(out, 'coverage-ao.json'),
    mintToken: path.join(pkg, 'scripts', 'mint-token.mjs'),
    // Gap closure API-3a (V88): E3's muster-api compile client and its record; the retired runner's twin output.
    planCompile: path.join(pkg, 'scripts', 'plan-compile.mjs'),
    planCompileFile: path.join(out, 'plan-compile.json'),
    planScriptDir: path.join(out, 'plan-script'),
    // W2: the AO CLI, the sim registry record AO reads, and the E6X / E7A / E7B / E8F-overlap records.
    aoRoot: path.join(ces, 'ces-ao'),
    aoCli: path.join(ces, AO_CLI_REL),
    registryRecord: path.join(ws, 'tenants', 'sim', `${slug}.json`),
    // PH-6 R-UI (V123-V125, V72): the run's registry record as it stood before the ephemeral sim tenant's teardown; the
    // console runs (EU-AO / EU-EO / EU-MU) and verify read it after the live record is gone.
    registryRecordSnapshot: path.join(out, 'sim-registry-record.json'),
    e6xFile: path.join(out, 'e6x.json'),
    // W5 cycle 3 (P11): the E8.5 organisation-records uploads (only when customers/<slug>/records/ exists).
    ecRecordsFile: path.join(out, 'ec-upload-records.json'),
    // Gap closure NS-3 (V81): EO's stores after the record posts.
    eoRecordsFile: path.join(out, 'eo-records.json'),
    // Gap closure FLOW-3 (V84): E7's POST /api/intake/muster outcome (EO's receipt).
    eoIntakeFile: path.join(out, 'eo-intake.json'),
    customerRecordsModule: path.join(pkg, 'scripts', 'build-customer-records.mjs'),
    // Gap closure NS-4t (V80, V81): E8.5's review plan and review uploads, E8.6's reviews, E7's interview records.
    reviewPlanFile: path.join(out, 'logs', 'E8.5-review-plan.json'),
    ecReviewUploadsFile: path.join(out, 'ec-upload-reviews.json'),
    eoReviewsFile: path.join(out, 'eo-reviews.json'),
    eoInterviewsFile: path.join(out, 'eo-interviews.json'),
    objectivesRef: path.join(ces, 'ces-shared', 'dist', 'data', 'assessment-objectives.reference.json'),
    interviewAnswers: path.join(pkg, 'customers', slug, 'interview-answers.json'),
    e7aFile: path.join(out, 'adminops-e7a.json'),
    // FIN-19 (V112-V114, V87): the new records.
    muCompileFile: path.join(out, 'plan-compile-mu.json'),
    muPlanDir: path.join(out, 'plan-mu'),
    musterProbesFile: path.join(out, 'muster-probes.json'),
    eoRouteUploadFile: path.join(out, 'ec-upload-eo-route.json'),
    eoReviewCliFile: path.join(out, 'eo-review-cli.json'),
    costFile: path.join(out, 'adminops-cost.json'),
    eoPackageCliZip: path.join(out, 'eo-package-cli.zip'),
    eoPackageCliDir: path.join(out, 'eo-package-cli'),
    eoPackageCliFile: path.join(out, 'eo-package-cli.json'),
    eoRoot: path.join(ces, 'ces-eo'),
    assess7b: path.join(out, 'eo-assess-7b.json'),
    overlapFile: path.join(out, 'runs', 'forced', 'ao-overlap.json'),
    bundle: path.join(pkg, 'scripts', 'bundle.mjs'),
    // W1: read only when MX_ALLOW_OVERRIDES=1 and the TM lacks keys (transition aid); a per-customer file wins over the package default.
    simOverrides: fs.existsSync(path.join(pkg, 'customers', slug, 'sim-overrides.json')) ? path.join(pkg, 'customers', slug, 'sim-overrides.json') : path.join(pkg, 'sim-overrides.json'),
  };
}

async function portHeld(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port });
    const done = (held: boolean) => {
      s.destroy();
      resolve(held);
    };
    s.setTimeout(1000, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export async function heldPorts(ports: number[] = RUN_PORTS): Promise<number[]> {
  const held: number[] = [];
  for (const p of ports) if (await portHeld(p)) held.push(p);
  return held;
}

/**
 * PH9-TS (V85, FIN-14): the tenant id EO scopes by, the sim registry record's `tenant.tenant_id` (`sim-tenant-<slug>`),
 * for Stamper's TENANT_ID at E6, so its stamper_evidence_metadata rows sit under EO's tenant id. Undefined when the
 * record is absent or carries none (then the synthetic env keeps its all-zero placeholder).
 */
export function stamperTenantIdOf(recordPath: string): string | undefined {
  try {
    const id = (JSON.parse(fs.readFileSync(recordPath, 'utf8').replace(/^﻿/, '')) as { tenant?: { tenant_id?: unknown } }).tenant?.tenant_id;
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

async function waitHttp(url: string, method: 'GET' | 'POST', seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    try {
      await fetch(url, {
        method,
        ...(method === 'POST' ? { body: '{}', headers: { 'Content-Type': 'application/json' } } : {}),
        signal: AbortSignal.timeout(3000),
      });
      return true; // any HTTP answer means the server is up
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

/** PH-13 (EL): a free TCP port for the step's own AO server (never one of the run's fixed ports). */
async function freePort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const p = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, () => {
        const a = srv.address();
        const port = typeof a === 'object' && a ? a.port : 0;
        srv.close(() => resolve(port));
      });
    });
    if (p && !RUN_PORTS.includes(p) && ![3000, 3001, 4003, 4012, 4173].includes(p)) return p;
  }
  throw new Error('no free port for the EL AO server');
}

// ---------- P12-MU (V130): the import surfaces and the AI gate, added to E9M's out/muster-surfaces.json ----------
// "Results import" is the COLLECTOR-KIT results file (muster-results.json, { generated_by, results: DiscoveryResult[] };
// muster-api collectorKitService.ts:15-16, :104-107): read-only tenant observations a customer admin's script made,
// imported on the SPA Discovery tab (ces-muster src/features/discovery/importResultsFile.ts, DiscoveryOffer.tsx:84).
// It is planning INPUT, not Stamper execution results, so the founder's ruling (Muster takes no results back from
// Stamper; V100) does not touch it. The readiness-file import has an API seam: POST /api/plan/compile takes the
// readiness-result file as `discovery` and the compile runner imports it with the SAME parseReadinessResultFile the
// Discovery tab's import button calls (ces-muster scripts/mx/plan-from-discovery.ts:126, :143). E3 is therefore the
// positive proof; this probe adds two refusals through the same route (a kit results file, a schema-invalid readiness
// file: 422 "Import failed", nothing ingested) on a probe slug that owns nothing, and the AI gate (I3-I5: 503
// {degraded:true} while muster-api's aiGate refuses; muster-api src/lib/claude.ts).
export const V130_IMPORT_PROBE_SLUG = 'v130-import-probe';
export const V130_NOT_RUN_HERE_P12 = [
  { surface: 'collector-kit results import (muster-results.json)', why: 'the SPA Discovery tab is its only consumer (src/features/discovery/DiscoveryOffer.tsx:84) and no API route takes this file (the compile route refuses it, proven here); the click path is the watched Muster UI run (V125, FIN-32)' },
  { surface: 'readiness file import through the SPA import button', why: 'proven here through POST /api/plan/compile (E3, the same parser); the click path is the watched Muster UI run (V125, FIN-32)' },
];
/** A collector-kit results file (the kit's own output shape), fictional rows. */
export const V130_KIT_RESULTS_FILE = { generated_by: 'ces-muster-collector-kit (V130 probe, FICTIONAL)', results: [{ control_id: 'IA.L2-3.5.3', objective_ids: [], confidence: 'unknown' }] };
/** A readiness-result file whose schema_version is valid but whose body is not (ajv must refuse it). */
export const V130_INVALID_READINESS_FILE = { schema_version: 'readiness-result/1.1.0', manifest: { mode: 'independent' }, observations: 'not-an-array' };
export interface V130Http { status: number | null; json: unknown; text: string }
export interface V130ImportsRecord {
  readiness_import: { route: string; e3_http_status: number | null; e3_files: number; disc_file: string | null; disc_sha256: string | null; disc_schema_version: string | null; disc_observations: number | null; plan_readiness_file: string | null };
  refusals: Array<{ name: 'collector-kit results file' | 'schema-invalid readiness file'; probe_slug: string; status: number | null; error: string | null; import_failed: boolean; detail_head: string | null }>;
  ai: { gate: 'off' | 'on' | 'unclear'; adaptive_status: number | null; adaptive_degraded: boolean | null; coach_status: number | null; coach_degraded: boolean | null; retro_status: number | null; retro_all_low: boolean | null };
  error?: string;
}
const jget = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
/** The V130 import / AI-gate probe. `http` is injectable (tests); the default is fetch with a timeout. */
export async function runV130Imports(o: { api: string; token: string; slug: string; disc: string; compileRecord: string; planDir: string; http?: (method: string, url: string, body: unknown, timeoutMs: number) => Promise<V130Http> }): Promise<V130ImportsRecord> {
  const http = o.http ?? (async (method: string, url: string, body: unknown, timeoutMs: number): Promise<V130Http> => {
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text();
      let json: unknown = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, json, text };
    } catch (err) {
      return { status: null, json: null, text: err instanceof Error ? err.message : String(err) };
    }
  });
  const rec: V130ImportsRecord = {
    readiness_import: { route: 'POST /api/plan/compile (E3)', e3_http_status: null, e3_files: 0, disc_file: null, disc_sha256: null, disc_schema_version: null, disc_observations: null, plan_readiness_file: null },
    refusals: [],
    ai: { gate: 'unclear', adaptive_status: null, adaptive_degraded: null, coach_status: null, coach_degraded: null, retro_status: null, retro_all_low: null },
  };
  try {
    if (exists(o.disc)) {
      const buf = fs.readFileSync(o.disc);
      rec.readiness_import.disc_file = path.basename(o.disc);
      rec.readiness_import.disc_sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const d = JSON.parse(buf.toString('utf8').replace(/^﻿/, '')) as unknown;
      rec.readiness_import.disc_schema_version = typeof jget(d, 'schema_version') === 'string' ? (jget(d, 'schema_version') as string) : null;
      const obs = jget(d, 'observations');
      rec.readiness_import.disc_observations = Array.isArray(obs) ? obs.length : null;
    }
    if (exists(o.compileRecord)) {
      const c = readJson<{ http_status?: number | null; files?: unknown[] }>(o.compileRecord);
      rec.readiness_import.e3_http_status = typeof c.http_status === 'number' ? c.http_status : null;
      rec.readiness_import.e3_files = Array.isArray(c.files) ? c.files.length : 0;
    }
    const rr = path.join(o.planDir, `readiness-result-${o.slug}.json`);
    rec.readiness_import.plan_readiness_file = exists(rr) ? path.basename(rr) : null;
  } catch (err) {
    rec.error = `readiness evidence: ${err instanceof Error ? err.message : String(err)}`;
  }
  const probes: Array<[V130ImportsRecord['refusals'][number]['name'], unknown]> = [
    ['collector-kit results file', V130_KIT_RESULTS_FILE],
    ['schema-invalid readiness file', V130_INVALID_READINESS_FILE],
  ];
  for (const [name, file] of probes) {
    const r = await http('POST', `${o.api}/api/plan/compile`, { tenant_slug: V130_IMPORT_PROBE_SLUG, discovery: JSON.stringify(file), tenant_harvest: 'off' }, 180000);
    const detail = typeof jget(r.json, 'detail') === 'string' ? (jget(r.json, 'detail') as string) : r.text;
    const m = /Import failed:[^\n]*/.exec(detail ?? '');
    rec.refusals.push({ name, probe_slug: V130_IMPORT_PROBE_SLUG, status: r.status, error: typeof jget(r.json, 'error') === 'string' ? (jget(r.json, 'error') as string) : null, import_failed: !!m, detail_head: m ? m[0].slice(0, 240) : (detail ?? '').slice(0, 240) || null });
  }
  // AI gate: adaptive and coach answer 503 {degraded:true} BEFORE reading the body while the gate refuses (no model
  // call). retro-confidence is called only then: degraded, it returns every fact at confidence 'low' with no model call.
  const ad = await http('POST', `${o.api}/api/interview/adaptive/next`, {}, 15000);
  rec.ai.adaptive_status = ad.status;
  rec.ai.adaptive_degraded = jget(ad.json, 'degraded') === true;
  const co = await http('POST', `${o.api}/api/coach/chat`, {}, 15000);
  rec.ai.coach_status = co.status;
  rec.ai.coach_degraded = jget(co.json, 'degraded') === true;
  if (ad.status === 503 && rec.ai.adaptive_degraded) {
    const rt = await http('POST', `${o.api}/api/interview/retro-confidence`, { facts: [{ question_id: 'v130-probe-question', answer: 'yes' }] }, 15000);
    rec.ai.retro_status = rt.status;
    const rows = Array.isArray(rt.json) ? rt.json : Array.isArray(jget(rt.json, 'facts')) ? (jget(rt.json, 'facts') as unknown[]) : Array.isArray(jget(rt.json, 'results')) ? (jget(rt.json, 'results') as unknown[]) : null;
    rec.ai.retro_all_low = rows && rows.length ? rows.every((x) => jget(x, 'confidence') === 'low') : null;
  }
  const off = ad.status === 503 && rec.ai.adaptive_degraded && co.status === 503 && rec.ai.coach_degraded && rec.ai.retro_status === 200 && rec.ai.retro_all_low === true;
  // Gate open (a key and MUSTER_AI_SIM_ONLY=1 on a sim-only muster-api): the empty bodies get 400, never a model call.
  const on = ad.status === 400 && co.status === 400;
  rec.ai.gate = off ? 'off' : on ? 'on' : 'unclear';
  return rec;
}
/** The probe's own verdict (the E9M step rc); V130 judges the record the same way (verify-fin29-eo-muster.mjs). */
export function v130ImportsProblems(r: V130ImportsRecord | null | undefined): string[] {
  if (!r) return ['no imports block'];
  const p: string[] = [];
  const ri = r.readiness_import;
  if (ri.e3_http_status !== 200 || !(ri.e3_files > 0)) p.push(`readiness import: E3 compile HTTP ${ri.e3_http_status}, ${ri.e3_files} file(s)`);
  if (!ri.disc_sha256 || !/^readiness-result\/1\.[01]\.0$/.test(ri.disc_schema_version ?? '') || !(ri.disc_observations! > 0)) p.push(`readiness import: discovery file ${ri.disc_file ?? 'missing'} (${ri.disc_schema_version ?? 'no schema_version'}, ${ri.disc_observations ?? 'no'} observation(s))`);
  if (!ri.plan_readiness_file) p.push('readiness import: the compile wrote no readiness-result file');
  for (const name of ['collector-kit results file', 'schema-invalid readiness file']) {
    const x = r.refusals.find((y) => y.name === name);
    if (!x) p.push(`${name}: not probed`);
    else if (x.status !== 422 || !x.import_failed) p.push(`${name}: HTTP ${x.status} (want 422 "Import failed")${x.detail_head ? `: ${x.detail_head.slice(0, 120)}` : ''}`);
  }
  if (r.ai.gate === 'unclear') p.push(`AI gate unclear: adaptive ${r.ai.adaptive_status}, coach ${r.ai.coach_status}, retro ${r.ai.retro_status} (all low ${r.ai.retro_all_low})`);
  if (r.error) p.push(r.error);
  return p;
}

export async function runMusterE2e(opts: MusterE2eRunOptions): Promise<MusterE2eRunRecord> {
  const sc = opts.scenario;
  const slug = sc.sim_scenario;
  const P = musterE2ePaths(opts.wsRoot, opts.packageRoot, slug);
  const log = opts.log ?? ((l: string) => console.log(l));
  const rel = (p: string): string => {
    const r = path.relative(P.ws, p).split(path.sep).join('/');
    return r === '' ? '.' : r;
  };
  const forceFailEntry = opts.forceFailEntry ?? sc.force_fail_entry ?? 'SC.L2-3.13.15.anti-spam';
  const assessRuns = sc.eo_assess_runs ?? 3;
  const aoEnabled = !!sc.ao_coverage?.enabled && !opts.skipAo;
  const started = nowIso();
  const t0 = Date.now();
  const ecSecret = crypto.randomUUID().replace(/-/g, '');
  // Gap closure FLOW-5 (a): no harness-generated initialPassword. The Stamper children get where muster-api (up from E3 to
  // E8F) resolves the reference it issued at E3; the value never passes through the harness.
  const stamperEnv = (): NodeJS.ProcessEnv => ({
    ...simEnv!,
    ...(apiProc && apiProc.exitCode === null && musterToken ? { CES_MUSTER_SECRETS_URL: API_URL, CES_MUSTER_SECRETS_TOKEN: musterToken } : {}),
  });
  // W2 (PLAN §3 E7A): the per-run principal secret AO verifies the approver token with. AO child env only; never a file.
  const aoSecret = mintPrincipalSecret();
  // NS-4t (as mx-e2e.ps1 NS-4): three more run-only secrets, child env only, all different. EC verifies the uploader's
  // principal with the first; EO signs and verifies approver tokens with the second (CES_AO_PRINCIPAL_SECRET, EO's env only)
  // and accepts this harness as its loopback dev operator with the third (CES_EO_OPERATOR_SECRET, CES_EO_OPERATOR_DEV_FALLBACK=1).
  const ecPrincipalSecret = mintPrincipalSecret();
  const eoApproverSecret = mintPrincipalSecret();
  const eoOperatorSecret = mintPrincipalSecret();
  // FIN-29 (SP-11, V101): every run secret this process holds, for the end-of-run leak scan (counts only are written).
  const runSecrets = new RunSecrets();
  runSecrets.register('ec_secret', ecSecret);
  runSecrets.register('ao_principal_secret', aoSecret);
  runSecrets.register('ec_principal_secret', ecPrincipalSecret);
  runSecrets.register('eo_approver_secret', eoApproverSecret);
  runSecrets.register('eo_operator_secret', eoOperatorSecret);
  // W5 cycle 3 (P11): a customer with customers/<slug>/records/catalog.json has its organisation records uploaded at E8.5.
  const recordsPresent = fs.existsSync(path.join(recordsDir(P.pkg, slug), 'catalog.json'));
  const aoOps = sc.adminops_ops ?? [];
  const injections = sc.drift_injection ?? [];

  // ---------- run state ----------
  const steps: Record<string, Record<string, unknown>> = {};
  const windows: Record<string, StepWindow | undefined> = {};
  const failures: string[] = [];
  let serve: ServeHandle | undefined;
  let apiProc: ChildProcess | undefined;
  /** FLOW-6 / API-3a: E3's minted muster-api token (E3 compile, E4 push, E6 results, E6/E8F secret resolution; up E3-E8F). */
  let musterToken: string | undefined;
  /** FIN-19: E3's JWT secret (E4's second-tenant probe token is minted with it). */
  let musterJwt: string | undefined;
  /** FIN-19 (V112): E8.5b's upload record (E8.6b reviews its sha256). */
  let eoRouteUpload: EoRouteUploadRecord | null = null;
  let ecProc: ChildProcess | undefined;
  let eoProc: ChildProcess | undefined;
  let simEnv: NodeJS.ProcessEnv | undefined;
  let registry: ReturnType<typeof createTenantRegistry> | undefined;
  /** FIN-29: the ephemeral sim tenant was registered at E3 (before EO starts), so E5 does not create it again. */
  let simTenantRegistered = false;
  let ledgerEntries: LedgerEntryLike[] | null = null;
  let ledgerTaken = false;
  let forcedRan = false;
  /** FIN-19: E7C takes the forced ledger before its own sim writes; the finally block then skips it. */
  let forcedLedgerTaken = false;
  let comparison: MusterE2eComparison | null = null;
  let aoRecord: AoCoverageRecord | null = null;
  let regResources: RegistryResources = { resources: {}, provenance: {} };
  /** The write ops' confirming reads, resolved against the registry record (EX state and the E8F overlap proof). */
  let aoWriteChecks: ExpectedStateCheck[] = [];
  /** NS-4t: E8.5's checked review plan and EC's sha256 per plan artifact (E8.6 cites them). */
  let reviewPlan: ReviewPlan | null = null;
  const reviewHashOf: Record<string, string | null> = {};
  let signer: PrincipalSigner | undefined;
  const sign = async (claims: Parameters<PrincipalSigner>[0], secret: string): Promise<string> => (signer ??= await loadPrincipalSigner(P.ces))(claims, secret);

  const saveSteps = (): void => fs.writeFileSync(P.stepsFile, JSON.stringify(steps, null, 2));

  const runLogged = (name: string, exe: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<number> => {
    const o = fs.openSync(path.join(P.logs, `${name}.out`), 'w');
    const e = fs.openSync(path.join(P.logs, `${name}.err`), 'w');
    return new Promise<number>((resolve) => {
      let settled = false;
      const finish = (code: number): void => {
        if (settled) return;
        settled = true;
        fs.closeSync(o);
        fs.closeSync(e);
        resolve(code);
      };
      const c = spawn(exe, args, { cwd, env: env ?? process.env, stdio: ['ignore', o, e], windowsHide: true });
      c.on('error', (err) => {
        try {
          fs.writeSync(e, `spawn error: ${String(err)}\n`);
        } catch {
          /* closed */
        }
        finish(1);
      });
      c.on('close', (code) => finish(code ?? 1));
    });
  };

  /** W2: one AO CLI call (stdout parsed by ao-step.ts); logs to logs/E7A-<label>.{out,err}; 10 min, then the tree is stopped. */
  const runAoCli = (args: string[], env: NodeJS.ProcessEnv, label: string): Promise<AoCliResult> =>
    new Promise<AoCliResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const c = spawn(node, [P.aoCli, ...args], { cwd: P.aoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const timer = setTimeout(() => {
        stderr += '\nE7A: AO call exceeded 600 s; stopped';
        stopTree(c);
      }, 600000);
      c.stdout?.on('data', (d) => (stdout += String(d)));
      c.stderr?.on('data', (d) => (stderr += String(d)));
      const finish = (rc: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fs.writeFileSync(path.join(P.logs, `E7A-${label}.out`), stdout);
        fs.writeFileSync(path.join(P.logs, `E7A-${label}.err`), stderr);
        resolve({ rc, stdout, stderr });
      };
      c.on('error', (err) => {
        stderr += `spawn error: ${String(err)}\n`;
        finish(1);
      });
      c.on('close', (code) => finish(code ?? 1));
    });

  const startBg = (name: string, exe: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess => {
    const o = fs.openSync(path.join(P.logs, `${name}.out`), 'w');
    const e = fs.openSync(path.join(P.logs, `${name}.err`), 'w');
    const c = spawn(exe, args, { cwd, env, stdio: ['ignore', o, e], windowsHide: true });
    fs.closeSync(o);
    fs.closeSync(e);
    if (c.pid) fs.writeFileSync(path.join(P.logs, `${name}.pid`), String(c.pid));
    return c;
  };

  /** FIN-35: copy the sim tenant's store.json to out/<name> (the watched console runs restore it). Never throws. */
  const snapshotStoreTo = (name: string): void => {
    try {
      const src = path.join(P.sim, '.stacksim', 'tenants', slug, 'store.json');
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(P.out, name));
    } catch {
      /* the console run reports a missing snapshot */
    }
  };

  /** FIN-35: out/e7b/{pl/ces.db, pl/EvidenceCollector, pl/Stamper/plan-data/<slug>, eo} as E7B left them. Never throws. */
  const captureE7bState = async (): Promise<void> => {
    const dir = path.join(P.out, 'e7b');
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(path.join(dir, 'pl'), { recursive: true });
      await backupDb(P.ces, path.join(P.pl, 'ces.db'), path.join(dir, 'pl', 'ces.db'));
      for (const rel of ['EvidenceCollector', path.join('Stamper', 'plan-data', slug)]) {
        const from = path.join(P.pl, rel);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, 'pl', rel), { recursive: true });
      }
      if (fs.existsSync(path.join(P.out, 'eo'))) fs.cpSync(path.join(P.out, 'eo'), path.join(dir, 'eo'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'taken.json'), JSON.stringify({ schema: 'ces-tester/e7b-state@1', taken: nowIso(), slug }, null, 2));
    } catch (err) {
      log(`  E7B: the EU-EO state capture failed (EU-EO falls back to the end of the twin): ${err instanceof Error ? err.message : String(err)}`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const stopTree = (c: ChildProcess | undefined): void => {
    if (c?.pid && c.exitCode === null && c.signalCode === null) {
      spawnSync('taskkill.exe', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
  };

  const writeStamperLogs = (name: string, r: StamperSpawnResult): void => {
    fs.writeFileSync(path.join(P.logs, `${name}.out`), r.stdout);
    fs.writeFileSync(path.join(P.logs, `${name}.err`), r.stderr);
  };

  const fetchToFile = async (url: string, outFile: string, init: RequestInit = {}): Promise<Buffer> => {
    // SEC-4: every fetchToFile call goes to EO; send its bearer token when the harness set one.
    const r = await fetch(url, { ...init, headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), ...eoAuthHeaders() }, signal: AbortSignal.timeout(600000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}: ${buf.toString('utf8').slice(0, 300)}`);
    fs.writeFileSync(outFile, buf);
    return buf;
  };
  const postJson = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const snapshotLedger = async (outFile: string): Promise<LedgerEntryLike[] | null> => {
    try {
      const data = await queryLedger(SIM_URL, {});
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify({ data }));
      log(`ledger: ${data.length} entries -> ${rel(outFile)}`);
      return data as unknown as LedgerEntryLike[];
    } catch (err) {
      log(`ledger snapshot failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  };

  /**
   * EO's child env (E3's early start and E7's restart: same storage, same secrets). E3 has no sim env yet (E5 makes
   * it), so EO runs from E3 to E7 on the base env, only for Muster's own calls (intake, interviews); E7 restarts it.
   */
  const eoChildEnv = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {
      ...base,
      ...eoAdminOpsWindowEnv(windows.E1?.started),
      REGISTRY_PATH: path.join(P.stamperRegistry, 'cmmc-l2-commands.registry.json'),
      STORAGE_ROOT: path.join(P.out, 'eo'),
      TENANT_SLUG: slug,
      EO_PORT: '4002',
      COMPLIANCE_REPO_PATH: path.join(P.out, 'eo-repo'),
      EC_URL,
      EVIDENCE_OPS_SECRET: ecSecret,
      // NS-4t (E8.6): EO mints the reviewer's approver token (and verifies it on POST /api/reviews) with
      // CES_AO_PRINCIPAL_SECRET; the harness is a loopback dev operator (simulator only).
      CES_AO_PRINCIPAL_SECRET: eoApproverSecret,
      CES_EO_OPERATOR_SECRET: eoOperatorSecret,
      CES_EO_OPERATOR_DEV_FALLBACK: '1',
    };
    delete env.TENANT_MANIFEST_PATH; // EO finds the pushed tenant-manifest-<slug>-*.json itself (EVC.4)
    return env;
  };

  /** FIN-19: one CLI call with captured output (logs/<label>.{out,err}); 10 min, then the tree is stopped. */
  const runCapture = (label: string, exe: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ rc: number; stdout: string; stderr: string }> =>
    new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const c = spawn(exe, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const timer = setTimeout(() => {
        stderr += `\n${label}: exceeded 600 s; stopped`;
        stopTree(c);
      }, 600000);
      c.stdout?.on('data', (d) => (stdout += String(d)));
      c.stderr?.on('data', (d) => (stderr += String(d)));
      const finish = (rc: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fs.writeFileSync(path.join(P.logs, `${label}.out`), stdout);
        fs.writeFileSync(path.join(P.logs, `${label}.err`), stderr);
        resolve({ rc, stdout, stderr });
      };
      c.on('error', (err) => {
        stderr += `spawn error: ${String(err)}\n`;
        finish(1);
      });
      c.on('close', (code) => finish(code ?? 1));
    });
  /** FIN-19: the `eo` CLI (ces-eo src/cli/index.ts under tsx, as EO itself runs). Tokens travel in the env. */
  let eoCliCalls = 0;
  const eoCli: CliRunner = (args, env) => runCapture(`eo-cli-${++eoCliCalls}`, node, [P.tsx, 'src/cli/index.ts', '--url', EO_URL, ...args], P.eoRoot, env);
  /** FIN-19: wait until a port is free again (E7's restart of E3's EO). */
  const waitPortFree = async (port: number, seconds: number): Promise<boolean> => {
    for (let i = 0; i < seconds; i++) {
      if (!(await portHeld(port))) return true;
      await sleep(1000);
    }
    return false;
  };

  const assessSnapshotId = (file: string): string | undefined =>
    readJson<Array<{ type?: string; snapshotId?: string }>>(file).find((e) => e.type === 'assess_summary')?.snapshotId;

  const node = process.execPath;
  const nodeCmd = 'node';

  // FIN-29: the run context the PH-2 steps (fin29-common.ts Fin29StepCtx) take; getters read the run state as it fills.
  const fin29Ctx: Fin29EoMusterCtx = {
    slug,
    scenario: sc as unknown as Record<string, unknown>,
    P,
    urls: { sim: SIM_URL, api: API_URL, ec: EC_URL, eo: EO_URL },
    node,
    log,
    rel,
    nowIso,
    runCapture,
    runAoCli,
    startBg,
    stopTree,
    waitHttp,
    portHeld,
    eoAuthHeaders: () => eoAuthHeaders(),
    simEnv: () => simEnv,
    stamperEnv: () => (simEnv ? stamperEnv() : undefined),
    aoEnv: () => (simEnv ? buildAoEnv(simEnv, { pipelineRoot: P.pl, tenantRoot: P.tenants, simUrl: SIM_URL, secret: aoSecret }) : undefined),
    simUp: () => !!serve,
    eoUp: () => !!eoProc && eoProc.exitCode === null,
    musterApiUp: () => !!apiProc && apiProc.exitCode === null,
    musterToken: () => musterToken,
    musterJwt: () => musterJwt,
    registerSecret: (name, value) => runSecrets.register(name, value),
    // FIN-29 E9E (V119, V120, V128): E7's EO env (for E9E's second EO) and the run's EC bearer.
    eoEnv: () => (simEnv ? eoChildEnv(simEnv) : undefined),
    ecSecret: () => ecSecret,
  };
  /**
   * FIN-29: the PH-2 steps after E8F write the sim (rollback, key vaults, the E9E drift seed, the E7S applies). The
   * forced ledger (V7 / V13 read it) is taken before the first of them runs, as E7C does for S1.
   */
  const afterForcedLedger = (d: Fin29StepDef): Fin29StepDef => ({
    ...d,
    run: async () => {
      if (serve && forcedRan && !forcedLedgerTaken) {
        await snapshotLedger(path.join(P.forced, 'ledger.json'));
        forcedLedgerTaken = true;
      }
      return d.run();
    },
  });
  /**
   * P12-MU (V130): after E9M's own probes, while muster-api is still up, the import surfaces and the AI gate are added to
   * out/muster-surfaces.json as `imports` (runV130Imports), and `not_run_here` names only what the watched UI run owns.
   */
  const withV130Imports = (d: Fin29StepDef): Fin29StepDef => ({
    ...d,
    commands: [...d.commands, `V130 (P12-MU): readiness import = E3 POST /api/plan/compile (${rel(P.disc)}, ${rel(P.planCompileFile)}); POST /api/plan/compile {tenant_slug: ${V130_IMPORT_PROBE_SLUG}} with a collector-kit results file and a schema-invalid readiness file (each must be 422 "Import failed"); POST /api/interview/adaptive/next, /api/coach/chat, /api/interview/retro-confidence (AI gate) -> ${rel(path.join(P.out, FIN29_FILES.musterSurfaces))} imports`],
    run: async () => {
      const outcome = await d.run();
      const surfFile = path.join(P.out, FIN29_FILES.musterSurfaces);
      if (!musterToken || !apiProc || apiProc.exitCode !== null || !exists(surfFile)) {
        return { ...outcome, rc: 1, detail: [outcome.detail, 'V130 imports: not probed (muster-api down, no token, or no surfaces record)'].filter(Boolean).join('; ') };
      }
      const imports = await runV130Imports({ api: API_URL, token: musterToken, slug, disc: P.disc, compileRecord: P.planCompileFile, planDir: P.planDir });
      const surf = readJson<Record<string, unknown>>(surfFile);
      fs.writeFileSync(surfFile, JSON.stringify({ ...surf, imports, not_run_here: V130_NOT_RUN_HERE_P12 }, null, 2));
      const problems = v130ImportsProblems(imports);
      log(`  E9M: V130 imports ${problems.length ? `FAIL: ${problems.join('; ')}` : `ok (readiness import via E3, 2 refusals 422, AI gate ${imports.ai.gate})`}`);
      return problems.length ? { ...outcome, rc: 1, detail: [outcome.detail, `V130 imports: ${problems.join('; ')}`].filter(Boolean).join('; ').slice(0, 900) } : outcome;
    },
  });

  // ---------- the steps ----------
  const defs: StepDef[] = [
    // FIN-29 (V117): clean-tenant init on its own clean-g5 sim and private roots, before E1 reseeds the run's sim.
    e0Step(fin29Ctx),
    {
      id: 'E1',
      title: 'Reseed and serve the sim',
      fatal: true,
      commands: [
        `(cwd ${rel(P.sim)}) ${nodeCmd} ${SIM_PSMODULE_GENERATOR.split(path.sep).join('/')} ${rel(path.join(P.sim, 'psmodules'))}`,
        `(cwd ${rel(P.sim)}) ${nodeCmd} bin/stacksim.mjs scenario ${slug}`,
        `(cwd ${rel(P.sim)}) ${nodeCmd} bin/stacksim.mjs serve ${sc.stance} --slug ${slug} --port 4390`,
      ],
      run: async () => {
        // W5 cycle 6: regenerate the simulator's PowerShell modules from the built simulator before E6 executes.
        const psmodulesDir = path.join(P.sim, 'psmodules');
        const genSince = Date.now();
        const genRc = await runLogged('E1-psmodules', node, [SIM_PSMODULE_GENERATOR, psmodulesDir], P.sim);
        const psmodulesWritten = countModulesWrittenSince(psmodulesDir, genSince);
        if (genRc !== 0 || psmodulesWritten === 0) return { rc: genRc || 1, detail: 'psmodules generation failed', extra: { psmodules_written: psmodulesWritten } };
        const rc = await runLogged('E1-scenario', node, ['bin/stacksim.mjs', 'scenario', slug], P.sim);
        if (rc !== 0) return { rc, detail: 'stacksim scenario failed' };
        serve = await startServe({ stacksimRoot: P.sim, stance: sc.stance, slug, port: 4390, logPath: path.join(P.logs, 'E1-serve.out') });
        const up = await waitHttp(`${SIM_URL}/ledger`, 'POST', 30);
        const tenantDir = fs.existsSync(path.join(P.sim, '.stacksim', 'tenants', slug));
        return { rc: up && tenantDir ? 0 : 1, extra: { psmodules_written: psmodulesWritten, ledger_up: up, tenant_dir: tenantDir } };
      },
    },
    {
      id: 'E2',
      title: 'Discovery (mu discovery --sim)',
      fatal: true,
      commands: [`(cwd ${rel(P.musterApi)}) ${nodeCmd} dist/cli/bin.js discovery --sim --slug ${slug} --out ${rel(P.disc)} [--answers ${rel(path.join(P.pkg, 'customers', slug, 'interview-answers.json'))} when present]`],
      run: async () => {
        // W7-TST (LOG-W7-MX1 item 4): discovery gets the organisation's answers file when the package has one (as E3).
        const answers = path.join(P.pkg, 'customers', slug, 'interview-answers.json');
        const raw = await runLogged('E2-discovery', node, ['dist/cli/bin.js', 'discovery', '--sim', '--slug', slug, '--out', P.disc, ...(fs.existsSync(answers) ? ['--answers', answers] : [])], P.musterApi);
        const okLine = fs.readFileSync(path.join(P.logs, 'E2-discovery.out'), 'utf8').includes('"ok":true');
        // Node 24 on Windows can abort on exit (libuv UV_HANDLE_CLOSING) after the file is written:
        // the step passes when mu printed ok:true and the file exists (as mx-e2e.ps1 E2).
        const rc = raw === 0 || (okLine && fs.existsSync(P.disc)) ? 0 : 1;
        return { rc, extra: { raw_rc: raw, ok_line: okLine, answers_file: fs.existsSync(answers) } };
      },
    },
    {
      id: 'E3',
      title: 'Compile through muster-api (POST /api/plan/compile; muster-api stays up through E8F)',
      fatal: true,
      commands: [
        `FIN-19: (cwd ${rel(P.eoRoot)}, base env) EO_PORT=4002 STORAGE_ROOT=${rel(path.join(P.out, 'eo'))} ${nodeCmd} ${rel(P.tsx)} src/eo/index.ts (EO up before E3/E4 so muster-api's own EO calls are real; E7 restarts it with the sim env)`,
        `(cwd ${rel(P.musterApi)}) JWT_SECRET=<random> PORT=4011 CES_EO_URL=${EO_URL} CES_EO_AUTH_TOKEN=<run-only> ${nodeCmd} dist/server.js`,
        `${nodeCmd} ${rel(P.mintToken)} ${rel(P.ces)}`,
        `(MUSTER_API_TOKEN=<E3 token> in the child env, SP-11 R6) ${nodeCmd} ${rel(P.planCompile)} --api ${API_URL} --slug ${slug} --disc ${rel(P.disc)} --out ${rel(P.planDir)} --record ${rel(P.planCompileFile)} [--org-content / --answers customers/<slug>/... when present]`,
        `V88 twin: (cwd ${rel(P.muster)}) MX_DISCOVERY=${rel(P.disc)} MX_OUT=${rel(P.planScriptDir)} MX_SLUG=${slug} [MX_ORG_CONTENT, MX_ANSWERS] ${nodeCmd} node_modules/vite-node/vite-node.mjs scripts/mx/plan-from-discovery.ts`,
        `FIN-19 (V114): (cwd ${rel(P.musterApi)}, MU_API_URL=${API_URL} MU_TOKEN=<E3 token>) ${nodeCmd} dist/cli/bin.js plan compile --slug ${slug} --discovery ${rel(P.disc)} [--org-content, --answers as E3] --max-reads 2 --out ${rel(P.muPlanDir)} -> ${rel(P.muCompileFile)}`,
      ],
      run: async () => {
        fs.rmSync(P.planDir, { recursive: true, force: true });
        fs.rmSync(P.planScriptDir, { recursive: true, force: true });
        // Synthetic customers (W0): the organisation content (identity, simulation block) and interview answers reach the
        // compile when the run package has customers/<slug>/org-content.json / interview-answers.json; absent for muster-partial.
        const orgContent = path.join(P.pkg, 'customers', slug, 'org-content.json');
        const answers = path.join(P.pkg, 'customers', slug, 'interview-answers.json');
        // FIN-19 (V114): EO starts before muster-api, so the push's EO intake call (E4) and the compile's interview
        // records are muster-api's own calls. Not fatal: an EO that does not come up shows as a failed call in V114.
        // FIN-29 (R-F1 S1 red, V114): EO resolves a tenant only through its registry record, so muster-api's own intake
        // call at E4 (and the compile's interview records) got 404 "Tenant config not found" while the record was made at
        // E5. The ephemeral sim tenant is registered here, before EO starts; E5 reuses it.
        if (!registry) {
          registry = createTenantRegistry({ registryRoot: P.tenants, stacksimRoot: P.sim });
          try {
            await createEphemeralSimTenant(registry, slug, { scenario: slug, stance: sc.stance });
            simTenantRegistered = true;
          } catch (err) {
            log(`  E3: early sim tenant registration failed (E5 retries): ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        eoProc = startBg('E3-eo', node, [P.tsx, 'src/eo/index.ts'], P.eoRoot, eoChildEnv(process.env));
        const eoEarlyUp = await waitHttp(`${EO_URL}/api/health`, 'GET', 120);
        // API-3a: muster-api starts here (no database) and stays up through E8F; the finally block stops it.
        const jwt = crypto.randomUUID().replace(/-/g, '');
        musterJwt = jwt;
        apiProc = startBg('E3-muster-api', node, ['dist/server.js'], P.musterApi, {
          ...process.env, JWT_SECRET: jwt, PORT: '4011',
          ...(process.env.CES_EO_AUTH_TOKEN ? { CES_EO_URL: EO_URL, CES_EO_AUTH_TOKEN: process.env.CES_EO_AUTH_TOKEN } : {}),
        });
        if (!(await waitHttp(`${API_URL}/`, 'GET', 30))) return { rc: 1, detail: 'muster-api did not answer', extra: { mode: 'api-unreachable' } };
        const mint = spawnSync(node, [P.mintToken, P.ces], { env: { ...process.env, JWT_SECRET: jwt }, encoding: 'utf8', windowsHide: true });
        if (mint.status !== 0 || !mint.stdout) return { rc: 1, detail: `mint-token failed: ${String(mint.stderr).slice(0, 300)}`, extra: { mode: 'api' } };
        musterToken = mint.stdout.trim();
        runSecrets.register('muster_jwt_secret', jwt);
        runSecrets.register('muster_token', musterToken);
        const cargs = [P.planCompile, '--api', API_URL, '--slug', slug, '--disc', P.disc, '--out', P.planDir, '--record', P.planCompileFile,
          ...(fs.existsSync(orgContent) ? ['--org-content', orgContent] : []), ...(fs.existsSync(answers) ? ['--answers', answers] : [])];
        // FIN-29 (SP-11 R6): the bearer goes in the child env (plan-compile.mjs MUSTER_API_TOKEN), never on argv.
        let rc = await runLogged('E3-plan', node, cargs, P.out, { ...process.env, MUSTER_API_TOKEN: musterToken });
        const mp = latest(P.planDir, 'manual-mission-plan-');
        const tm = latest(P.planDir, 'tenant-manifest-');
        if (rc === 0 && !(mp && tm)) rc = 1;
        const im = latest(P.planDir, 'infrastructure-manifest-');
        // V88: the retired runner, standalone on the same inputs (compared by V88, never pushed). Not fatal.
        let twinRc: number | null = null;
        if (rc === 0) {
          const env: NodeJS.ProcessEnv = { ...process.env, MX_DISCOVERY: P.disc, MX_OUT: P.planScriptDir, MX_SLUG: slug };
          delete env.MX_ORG_CONTENT;
          delete env.MX_ANSWERS;
          if (fs.existsSync(orgContent)) env.MX_ORG_CONTENT = orgContent;
          if (fs.existsSync(answers)) env.MX_ANSWERS = answers;
          twinRc = await runLogged('E3-plan-script', node, [path.join(P.muster, 'node_modules', 'vite-node', 'vite-node.mjs'), 'scripts/mx/plan-from-discovery.ts'], P.muster, env);
        }
        // FIN-19 (V114): the same compile through `mu plan compile` (FIN-17), into out/plan-mu. Not fatal.
        let muRc: number | null = null;
        if (rc === 0) {
          try {
            const mu = await runMuCompile({
              run: (args, env) => runCapture('E3-mu-compile', node, ['dist/cli/bin.js', ...args], P.musterApi, env),
              args: muCompileArgs({ slug, discovery: P.disc, orgContent: fs.existsSync(orgContent) ? orgContent : null, answers: fs.existsSync(answers) ? answers : null, maxReads: 2 }),
              outDir: P.muPlanDir,
              env: { ...process.env, MU_API_URL: API_URL, MU_TOKEN: musterToken },
            });
            fs.writeFileSync(P.muCompileFile, JSON.stringify(mu, null, 2));
            muRc = mu.rc;
          } catch (err) {
            fs.writeFileSync(P.muCompileFile, JSON.stringify({ schema: 'ces-tester/mu-plan-compile@1', rc: null, files: [], error: err instanceof Error ? err.message : String(err) }, null, 2));
          }
        }
        return { rc, extra: { mode: 'api', mp: mp && path.basename(mp), tm: tm && path.basename(tm), im: im && path.basename(im), record: path.basename(P.planCompileFile), script_twin_rc: twinRc, eo_early_up: eoEarlyUp, mu_compile_rc: muRc } };
      },
    },
    {
      id: 'E4',
      title: 'Push through muster-api (E3\'s server and token, MG-12 envelopes)',
      fatal: true,
      commands: [
        `POST ${API_URL}/api/plan/push (missionPlan, tenantManifest, infraManifest, si_baseline, tcp, readiness_posture, policies) -> ${rel(P.plansPushed)}; muster-api delivers it to EO's intake itself (FIN-19)`,
        `FIN-19 (V114) probes: the same push with one TM normative control the MP does not cover and no override (want 409); the valid push with a token for tenant ${PROBE_OTHER_TENANT} (want 404) -> ${rel(P.musterProbesFile)}`,
      ],
      run: async () => {
        fs.rmSync(P.plansPushed, { recursive: true, force: true });
        const pushResp = path.join(P.out, 'push-response.json');
        fs.rmSync(pushResp, { force: true });
        // API-3a: E3 started muster-api and minted the token. FLOW-6 (V86) / FLOW-5 (a): it stays up through E8F.
        if (!apiProc || apiProc.exitCode !== null || !musterToken || !(await waitHttp(`${API_URL}/`, 'GET', 30))) {
          return { rc: 1, detail: 'muster-api (started at E3) is not answering', extra: { mode: 'api-unreachable', plans_dir: P.plansPushed } };
        }
        // FIN-19 (V114): the policy texts the pushed policy-set manifest hashes travel with the push, so muster-api's own
        // EO intake call carries them (EO checks them against the manifest).
        const psm = latest(P.planDir, 'policy-set-manifest-');
        const pol = psm ? manifestPolicyTexts(readJson(psm), path.join(P.planDir, 'policies')) : null;
        const r = await pushPlans({ apiBase: API_URL, token: musterToken, plansDir: P.planDir, slug, outFile: pushResp, ...(pol ? { extraBody: { policies: pol.policies } } : {}) });
        fs.writeFileSync(path.join(P.logs, 'E4-push.out'), r.line + '\n');
        if (r.rc !== 0) {
          fs.writeFileSync(path.join(P.logs, 'E4-push.err'), `push failed: HTTP ${r.status}: ${r.text}\n`);
          return { rc: 1, detail: `muster-api refused the push (HTTP ${r.status})`, extra: { mode: 'api-refused', plans_dir: P.plansPushed } };
        }
        const ok = !!latest(P.plansPushed, 'manual-mission-plan-') && !!latest(P.plansPushed, 'tenant-manifest-');
        // FIN-19 (V114): the push-gate and slug probes, only after this push claimed the slug (no write, no claim).
        let probes: Record<string, unknown> = { ran: false };
        if (ok) {
          const other = spawnSync(node, [P.mintToken, P.ces, PROBE_OTHER_TENANT], { env: { ...process.env, JWT_SECRET: musterJwt }, encoding: 'utf8', windowsHide: true });
          const rec = await runPushProbes({ apiBase: API_URL, token: musterToken, otherTenantToken: other.status === 0 && other.stdout ? other.stdout.trim() : null, plansDir: P.planDir, slug });
          fs.writeFileSync(P.musterProbesFile, JSON.stringify(rec, null, 2));
          probes = { ran: true, cross_file_status: rec.cross_file.status, other_tenant_status: rec.other_tenant.status };
        }
        let eoIntakeStatus: unknown = null;
        try { eoIntakeStatus = (JSON.parse(r.text) as { eo_intake?: { status?: unknown } }).eo_intake?.status ?? null; } catch { /* not JSON */ }
        return { rc: ok ? 0 : 1, extra: { mode: 'api', plans_dir: P.plansPushed, eo_intake: eoIntakeStatus, policies_sent: pol?.policies.length ?? 0, probes } };
      },
    },
    {
      id: 'E5',
      title: 'Sim tenant registration + Stamper translate',
      fatal: true,
      commands: [
        `ces-tenant createEphemeralSimTenant(${slug}) + StacksimEnvironment.getSimLaunchEnv -> ${rel(path.join(P.out, 'sim-env.json'))}; SIM-ONLY guard`,
        `(powershell.exe, cwd ${rel(P.stCwd)}) ${nodeCmd} ${rel(path.join(P.stamper, 'dist', 'cli', 'index.js'))} translate <pushed MP> -m <pushed TM> --tenant ${slug} -o ${rel(P.exe)}`,
      ],
      run: async () => {
        registry ??= createTenantRegistry({ registryRoot: P.tenants, stacksimRoot: P.sim });
        if (!simTenantRegistered) await createEphemeralSimTenant(registry, slug, { scenario: slug, stance: sc.stance });
        simTenantRegistered = true;
        const launch = await getSimLaunchEnv(registry, slug, { stacksimRoot: P.sim });
        fs.writeFileSync(
          path.join(P.out, 'sim-env.json'),
          JSON.stringify({ PSModulePath: launch.psModulePath, Path: launch.path, STACKSIM_SERVER_URL: launch.stacksimServerUrl }, null, 2),
        );
        simEnv = mergeSimLaunchEnv({ simLaunchEnv: launch });
        const violations = simOnlyEnvViolations(simEnv, P.sim);
        if (violations.length) return { rc: 1, detail: `SIM-ONLY guard: ${violations.join('; ')}` };
        const pMP = latest(P.plansPushed, 'manual-mission-plan-');
        const pTM = latest(P.plansPushed, 'tenant-manifest-');
        if (!pMP || !pTM) return { rc: 1, detail: 'no pushed MP/TM' };
        // W2 (PLAN §3 E5, F-7): the registry record's resources.* carry the TM values AO reads, plus the keys the ops
        // name that the TM lacks, discovered from the sim (a read). Nothing is typed by the harness.
        const tmRaw = readJson<{ tenant_manifest?: { tenant_identity?: Record<string, unknown> }; tenant_identity?: Record<string, unknown> }>(pTM);
        regResources = resourcesFromTm(tmRaw.tenant_manifest?.tenant_identity ?? tmRaw.tenant_identity);
        const undiscovered: string[] = [];
        for (const key of resourceKeysNamed(aoOps).filter((k) => !(k in regResources.resources))) {
          const d = DISCOVERERS[key];
          const joined: Array<Array<Record<string, unknown>>> = [];
          for (const j of d?.joins ?? []) joined.push(rowsOf(await simResolve(SIM_URL, j)));
          const v = d ? d.pick(rowsOf(await simResolve(SIM_URL, d.request)), Date.now(), { resources: regResources.resources, joined }) : undefined;
          if (v === undefined) undiscovered.push(key);
          else {
            regResources.resources[key] = v;
            regResources.provenance[key] = `discovered (${d!.describe})`;
          }
        }
        fs.mkdirSync(P.stCwd, { recursive: true });
        const t = await launchStamperTranslate({
          stamperRoot: P.stamper,
          env: stamperEnv(),
          missionPlanPath: pMP,
          manifestPath: pTM,
          tenantSlug: slug,
          outputPath: P.exe,
          workDir: P.stCwd,
        });
        writeStamperLogs('E5-translate', t);
        // Written after translate: Stamper's translate gap-fills plan variables from the record's resources (PlanTranslator
        // VARIABLE_MAPPING), so the executable plan stays exactly what the TM gives; AO reads the record at E7A.
        writeRecordResources(P.registryRecord, regResources.resources);
        const resourcesExtra = { registry_resources: regResources.provenance, ...(undiscovered.length ? { undiscovered } : {}) };
        return { rc: t.exitCode !== 0 ? t.exitCode : fs.existsSync(P.exe) ? 0 : 1, extra: resourcesExtra };
      },
    },
    // PH-13 (P13-LV design LOG-PH13-LV.md §6.2; P13-INT wiring): the AdminOps leaver flow, after E5 (offboard_upn is
    // discovered with the leaver still enabled) and before E6 (Stamper's leaver read judges A-22's real result).
    {
      id: 'EL',
      title: `AdminOps leaver flow (PS.L2-3.9.2[b]: detect -> admin email -> ${EL_SCENARIOS[slug]?.mode === 'unconfirmed' ? 'no confirm -> reminder + escalation' : 'confirm via the token link -> A-22'}; own AO server, sim only)`,
      fatal: false,
      ...(EL_SCENARIOS[slug] ? {} : { skip: `${slug} runs no AdminOps op (V131 not judged here)` }),
      commands: [
        `throwaway self-signed PFX -> ${rel(simCertPath(P.out, slug))}; registry record auth.cert_path -> it (as E7A)`,
        `(cwd ${rel(P.aoRoot)}, AO env as E7A + CES_AO_AUTH_TOKEN=<run-only> CES_AO_PUBLIC_URL=http://127.0.0.1:<free port> CES_BHD_NOTICE_MAILBOX=${EL_BHD_MAILBOX} CES_NO_OPEN=1) ${nodeCmd} ${rel(P.aoCli)} gui --port <free port>`,
        `PUT /api/leaver/settings?tenant=${slug} {adminRecipients: resources.operator_upn + approver_upn, notifyBhdOnDone: ${EL_SCENARIOS[slug]?.bhd === true}, reminderAfterMinutes 0, confirmWindowMinutes ${EL_SCENARIOS[slug]?.mode === 'unconfirmed' ? 0 : 4320}}; POST /api/leaver/scan; GET /api/leaver/outbox`,
        EL_SCENARIOS[slug]?.mode === 'unconfirmed'
          ? `POST /api/leaver/tick?tenant=${slug} (nobody confirms: a reminder, then the escalation); GET /api/leaver/flows/<id>`
          : 'GET <confirm link> (200); POST /leaver/confirm/<flowId> {t, decision: confirm} without a bearer (200); the same POST again (409); GET /api/leaver/flows/<id>',
        `-> ${rel(path.join(P.out, 'leaver-flow.json'))} (links written ?t=<redacted>; V131)`,
      ],
      run: async () => {
        if (!fs.existsSync(P.registryRecord)) return { rc: 1, detail: `no registry record ${rel(P.registryRecord)}` };
        if (!simEnv) return { rc: 1, detail: 'no sim env (E5 did not run)' };
        // AO's live-config check needs the record's cert_path on disk (as E7A; E7A makes its own again).
        const simCert = makeSimPfx(simCertPath(P.out, slug));
        writeRecordCertPath(P.registryRecord, simCert.path);
        const port = await freePort();
        const aoUrl = `http://127.0.0.1:${port}`;
        const bearer = crypto.randomBytes(32).toString('hex');
        runSecrets.register('el_ao_auth_token', bearer);
        const env: NodeJS.ProcessEnv = {
          ...buildAoEnv(simEnv, { pipelineRoot: P.pl, tenantRoot: P.tenants, simUrl: SIM_URL, secret: aoSecret }),
          CES_AO_AUTH_TOKEN: bearer, CES_AO_PUBLIC_URL: aoUrl, CES_BHD_NOTICE_MAILBOX: EL_BHD_MAILBOX, CES_NO_OPEN: '1',
          // ces.db is shared across runs (as EO's CES_EO_ADMINOPS_SINCE): an earlier round's flow for the same seeded
          // leaver must not make this run's scan "already tracked" (R-F12 EL: flow_id null, LOG-RF12-DIAG).
          ...(windows.E1?.started ? { CES_AO_LEAVER_SINCE: windows.E1.started } : {}),
          // AO's DPAPI module-secret store wins over the env per name (ces-shared moduleSecrets.ts secretEnv); a store at the
          // machine default (%ProgramData%\CES\secrets) would replace this run's bearer. Point AO at an absent file instead.
          CES_MODULE_SECRETS_PATH: path.join(P.out, 'el', 'no-module-secrets.dpapi'),
        };
        delete env.CES_MODULE_SECRETS_REQUIRED;
        delete env.CES_AO_LEAVER_TICK_MIN;
        delete env.CES_AO_LEAVER_TENANTS;
        const proc = startBg('EL-ao', node, [P.aoCli, 'gui', '--port', String(port)], P.aoRoot, env);
        try {
          if (!(await waitHttp(`${aoUrl}/api/health`, 'GET', 90))) return { rc: 1, detail: `AO (EL) did not answer on ${aoUrl}` };
          const admins = elAdminRecipients(regResources.resources);
          const rec = await runLeaverFlow({ aoUrl, bearer, slug, admins, bhdMailbox: EL_BHD_MAILBOX, register: (n, v) => runSecrets.register(n, v) });
          fs.writeFileSync(path.join(P.out, 'leaver-flow.json'), JSON.stringify(rec, null, 2));
          // FIX-EL (R-F11): the sim store as EL left it, the state E6 starts from; the Stamper UI run (ui-e2e-run.ts) puts it
          // in place after its reset, so its execute is compared with the twin's from the same state (V73).
          snapshotStoreTo(SIM_STORE_EL);
          log(`  EL: ${rec.mode}; scan ${rec.scan.status} (past ${rec.scan.pastLeavers}, enabled ${rec.scan.enabledPastLeavers}); flow ${rec.flow_id ?? 'none'} -> ${String((rec.flow_after.flow as { status?: unknown } | null)?.status ?? 'n/a')}${rec.problems.length ? `; problems: ${rec.problems.join('; ')}` : ''}`);
          return {
            rc: rec.problems.length ? 1 : 0,
            ...(rec.problems.length ? { detail: rec.problems.join('; ').slice(0, 900) } : {}),
            extra: { mode: rec.mode, flow_id: rec.flow_id, enabled_past_leavers: rec.scan.enabledPastLeavers, ao_port: port },
          };
        } finally {
          stopTree(proc);
          // AO logs a slow request's path with its query; a confirm link's token must never stay in a run file (V101).
          for (const f of ['EL-ao.out', 'EL-ao.err']) {
            const lf = path.join(P.logs, f);
            try {
              if (fs.existsSync(lf)) fs.writeFileSync(lf, redactTokens(fs.readFileSync(lf, 'utf8')));
            } catch {
              /* best effort */
            }
          }
        }
      },
    },
    {
      id: 'E6',
      title: 'Stamper execute on the sim (overrides gate: not needed when the TM carries the twelve keys)',
      fatal: true,
      commands: [
        `overrides gate (pushed TM tenant_identity, twelve keys; ${rel(P.simOverrides)} only with MX_ALLOW_OVERRIDES=1) -> ${rel(path.join(P.logs, 'E6-overrides.json'))}`,
        `synthetic env ${rel(path.join(P.out, 'stamper.synthetic.env'))} (STORAGE_ROOT ${rel(P.st)}; TENANT_ID = the registry record's tenant.tenant_id, EO's tenant id: FIN-14)`,
        `(powershell.exe, stdin newline, no CES_MUSTER_API_URL / CES_MUSTER_API_TOKEN, CES_MUSTER_SECRETS_URL=${API_URL} CES_MUSTER_SECRETS_TOKEN=<E3 token>) ${nodeCmd} ${rel(path.join(P.stamper, 'dist', 'cli', 'index.js'))} execute ${rel(P.exe)} --mode auto -e ${rel(path.join(P.out, 'stamper.synthetic.env'))} --tenant ${slug} (muster-api stays up for E8F)`,
      ],
      run: async () => {
        const pTM = latest(P.plansPushed, 'tenant-manifest-');
        if (!pTM) return { rc: 1, detail: 'no pushed tenant manifest for the overrides gate' };
        const allow = process.env.MX_ALLOW_OVERRIDES === '1';
        const gate = runOverridesGate({ planPath: P.exe, tmPath: pTM, overridesPath: P.simOverrides, logsDir: P.logs, allowOverrides: allow });
        log(`  ${gate.line}`);
        if (gate.rc !== 0) return { rc: gate.rc, detail: gate.line, extra: { overrides: gate.log.mode } };
        // A run's Stamper outputs are exactly this run's: earlier runs' evidence files let EO assess controls from stale
        // entries in a long-lived workspace (Phase 5 fresh-root proof).
        // Both Stamper output roots: the synthetic STORAGE_ROOT (P.st) and the pipeline-root tenant folder EO reads
        // (<pl>/Stamper/plan-data/<slug>, written since FX-02). plans/ is rewritten by E4 and kept.
        const tenantPl = path.join(P.pl, 'Stamper', 'plan-data', slug);
        // FIN-29 (LOG-FIN-19 open item 1): muster-api's own E3/E4 call record and the slug-owner file live in the tenant's
        // state/ folder; they are this run's (written after E1's per-run cleanup) and are kept through E6's wipe.
        for (const base of [P.st, tenantPl]) for (const sub of ['state', 'evidence', 'evidence-by-task']) {
          if (base === tenantPl && sub === 'state') wipeKeeping(path.join(base, sub), MUSTER_STATE_KEEP);
          else fs.rmSync(path.join(base, sub), { recursive: true, force: true });
        }
        wipeEoEvidenceStore(path.join(P.out, 'eo')); // W1.6: EO's evidence store (STORAGE_ROOT of E7), once per run
        fs.mkdirSync(P.st, { recursive: true });
        // PH9-TS (V85, FIN-14): Stamper's TENANT_ID is EO's tenant id (the registry record's), not the all-zero placeholder.
        // E8F, E8R and E8T copy this file and rewrite only STORAGE_ROOT, so they inherit it.
        const stamperTenantId = stamperTenantIdOf(P.registryRecord);
        const envFile = await writeSyntheticStamperEnv(P.out, { storageRoot: P.st, tenantId: stamperTenantId });
        // ROLE-1 (founder ruling 2026-10-30): Muster receives no execution results. Stamper runs without CES_MUSTER_API_URL /
        // TOKEN (its ExecutionResultsPublisher has no Muster endpoint); extra.muster_api_url records it (verify V100).
        const execEnv: NodeJS.ProcessEnv = stamperEnv();
        delete execEnv.CES_MUSTER_API_URL;
        delete execEnv.CES_MUSTER_API_TOKEN;
        const musterApiUrl = 'CES_MUSTER_API_URL' in execEnv;
        const x = await launchStamperExecute({ stamperRoot: P.stamper, env: execEnv, planPath: P.exe, envFilePath: envFile, tenantSlug: slug, workDir: P.stCwd });
        writeStamperLogs('E6-execute', x);
        const rep = latestRecursive(path.join(P.st, 'state'), 'execution-report-');
        let rc = x.exitCode;
        if (rep) fs.copyFileSync(rep, path.join(P.out, 'execution-report.json'));
        else if (rc === 0) rc = 1;
        // FLOW-5 (a): muster-api stays up for E8F's Stamper (secret reference); the run's finally block stops it.
        // R-UIT3-1: the sim store as E6 left it (before E7A / E8F write), for V73 (c).
        const e6Store = path.join(P.sim, '.stacksim', 'tenants', slug, 'store.json');
        if (fs.existsSync(e6Store)) fs.copyFileSync(e6Store, path.join(P.out, 'sim-store-e6.json'));
        return { rc, ...(rep ? {} : { detail: 'no execution report' }), extra: { overrides: gate.log.mode, muster_api_url: musterApiUrl, stamper_tenant_id: stamperTenantId ?? SYNTHETIC_TENANT_ID } };
      },
    },
    {
      id: 'E6X',
      title: `Drift re-injection after Stamper (S3 only; ${injections.length} sim write(s))`,
      fatal: true,
      commands: [
        injections.length
          ? `POST ${SIM_URL}/resolve x${injections.length} (scenario drift_injection: ${injections.map((x) => `${x.request.method} ${x.request.uri}`).join('; ')}) -> ${rel(P.e6xFile)}`
          : `none (scenario drift_injection is empty) -> ${rel(P.e6xFile)}`,
      ],
      run: async () => {
        const rows: Array<{ description?: string; method: string; uri: string; ok: boolean; error?: string }> = [];
        for (const x of injections) {
          try {
            await simResolve(SIM_URL, x.request);
            rows.push({ description: x.description, method: x.request.method, uri: x.request.uri, ok: true });
          } catch (err) {
            rows.push({ description: x.description, method: x.request.method, uri: x.request.uri, ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        }
        fs.writeFileSync(P.e6xFile, JSON.stringify({ schema: 'ces-tester/e6x@1', injections: rows }, null, 2));
        const bad = rows.filter((r) => !r.ok);
        return { rc: bad.length ? 1 : 0, ...(bad.length ? { detail: bad.map((r) => `${r.method} ${r.uri}: ${r.error}`).join('; ') } : {}), extra: { injections: rows.length } };
      },
    },
    {
      id: 'E8.5',
      title: recordsPresent ? 'Start EC; one catalog-tagged upload + the customer\'s organisation records' : 'Start EC; one catalog-tagged upload',
      fatal: true,
      commands: [
        `(cwd ${rel(path.join(P.ces, 'ces-ec'))}, sim env) EC_PORT=4001 EVIDENCE_OPS_SECRET=<run-only> ${nodeCmd} ${rel(P.tsx)} src/index.ts`,
        `POST ${EC_URL}/api/ingest (form_id ${String(sc.ec_upload?.form_id ?? 'n/a')}, emx_ids ${JSON.stringify(sc.ec_upload?.emx_ids ?? [])}) -> ${rel(path.join(P.out, 'ec-upload.json'))}`,
        // W5 cycle 3 (P11): only when the customer has customers/<slug>/records/catalog.json (muster-partial has none).
        ...(recordsPresent ? [`POST ${EC_URL}/api/ingest x<catalog items> (${rel(path.join(recordsDir(P.pkg, slug), 'catalog.json'))}: control_ids, no form_id; x-ces-principal = the uploader of document-reviews.json when present) -> ${rel(P.ecRecordsFile)}`] : []),
        // NS-4t (as mx-e2e.ps1 NS-4): the review plan, then its artifacts the catalog upload did not send, with the uploader's principal.
        `${nodeCmd} -e loadDocumentReviews(${rel(P.customerRecordsModule)}, ${slug}, objectives ${rel(P.objectivesRef)}) -> ${rel(P.reviewPlanFile)} (customers/${slug}/document-reviews.json; none: skipped)`,
        `POST ${EC_URL}/api/ingest x<plan artifacts not in the catalog upload> (x-ces-principal = signed uploader token, CES_EC_PRINCIPAL_SECRET=<run-only>) -> ${rel(P.ecReviewUploadsFile)}`,
      ],
      run: async () => {
        // A run's EC items are exactly this run's (the store under the pipeline root otherwise accumulates one upload per run).
        fs.rmSync(path.join(P.pl, 'EvidenceCollector'), { recursive: true, force: true });
        clearEcRows(path.join(P.pl, 'ces.db')); // DB-1: EC's records are ces.db rows now; they go with the folder

        fs.rmSync(P.ecRecordsFile, { force: true }); // a previous customer's records record never outlives its run
        fs.rmSync(P.ecReviewUploadsFile, { force: true });
        reviewPlan = null;
        ecProc = startBg('E8.5-ec', node, [P.tsx, 'src/index.ts'], path.join(P.ces, 'ces-ec'), {
          ...simEnv,
          EC_PORT: '4001',
          EVIDENCE_OPS_SECRET: ecSecret,
          CES_EC_PRINCIPAL_SECRET: ecPrincipalSecret, // NS-0 / NS-4t: EC records the uploader of a signed x-ces-principal
          // FIN-28 B-1: ces-planner is retired; the byte-identical catalog copy is in ces-muster's plan engine.
          CES_EVIDENCE_CATALOG_PATH: path.join(P.ces, 'ces-muster', 'src', 'features', 'plan', 'engine', 'data', 'evidence-catalog', 'evidence-catalog-release-0.json'),
        });
        if (!(await waitHttp(`${EC_URL}/api/health`, 'GET', 60))) return { rc: 1, detail: 'EC did not answer /api/health', extra: { http_status: null, ec_url: EC_URL } };
        if (!sc.ec_upload) return { rc: 1, detail: 'scenario has no ec_upload block' };
        const req = { tenantSlug: slug, ...sc.ec_upload };
        const reqJson = JSON.stringify(req, null, 2);
        fs.writeFileSync(path.join(P.out, 'ec-upload-request.json'), reqJson);
        try {
          const r = await fetch(`${EC_URL}/api/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ecSecret}` },
            body: reqJson,
            signal: AbortSignal.timeout(60000),
          });
          const text = await r.text();
          if (r.ok) fs.writeFileSync(path.join(P.out, 'ec-upload.json'), text);
          else fs.writeFileSync(path.join(P.out, 'ec-upload.json'), JSON.stringify({ error_status: r.status, body: text }, null, 2));
          if (r.status !== 201) return { rc: 1, extra: { http_status: r.status, ec_url: EC_URL } };
          // NS-4t (V80): the review plan of customers/<slug>/document-reviews.json, checked by the package's loader against
          // the 800-171A reference; a defect fails E8.5 (no silent upload). The scenario's single upload above stays V27's
          // (no principal, ec-upload.json), as under mx.
          let planNote = 'none';
          try {
            const mod = (await import(pathToFileURL(P.customerRecordsModule).href)) as { loadDocumentReviews: LoadDocumentReviews };
            reviewPlan = mod.loadDocumentReviews(P.pkg, slug, { objectivesRef: readJson(P.objectivesRef) });
          } catch (err) {
            return { rc: 1, detail: `review plan refused: ${err instanceof Error ? err.message : String(err)}`, extra: { http_status: r.status, ec_url: EC_URL, review_uploads: 'refused' } };
          }
          if (reviewPlan) fs.writeFileSync(P.reviewPlanFile, JSON.stringify(reviewPlan, null, 2));
          // Every records upload carries the uploader's principal when there is a plan: EO refuses a review (409
          // uploader_unknown) when any EC item with the artifact's hash has no recorded uploader.
          const principal: Record<string, string> = reviewPlan ? { 'x-ces-principal': await sign(uploaderClaims(reviewPlan.uploader.upn), ecPrincipalSecret) } : {};
          const extra: Record<string, unknown> = { http_status: r.status, ec_url: EC_URL };
          let rows: Awaited<ReturnType<typeof uploadRecords>> = [];
          if (recordsPresent) {
            // W5 cycle 3 (P11): the customer's organisation records, one upload per catalog item (ec-upload.json stays
            // the scenario's single upload, which V27 reads).
            const dir = recordsDir(P.pkg, slug);
            let reqs;
            try {
              reqs = recordUploadRequests(loadRecordsCatalog(P.pkg, slug)!, slug, (f) => fs.readFileSync(path.join(dir, f)));
            } catch (err) {
              fs.writeFileSync(P.ecRecordsFile, JSON.stringify({ schema: 'ces-tester/ec-records-upload@1', catalog: rel(path.join(dir, 'catalog.json')), error: String(err), items: [] }, null, 2));
              return { rc: 1, detail: `organisation records catalog: ${String(err)}`, extra };
            }
            rows = await uploadRecords(EC_URL, ecSecret, reqs, fetch, principal);
            const ok = recordUploadsOk(rows);
            fs.writeFileSync(P.ecRecordsFile, JSON.stringify({ schema: 'ces-tester/ec-records-upload@1', catalog: rel(path.join(dir, 'catalog.json')), items: rows }, null, 2));
            const bad = rows.filter((x) => !(x.http_status === 201 && x.item_id && x.sha256_match));
            extra.records_uploaded = rows.length - bad.length;
            extra.records_total = rows.length;
            if (!ok) return { rc: 1, detail: `organisation records upload: ${bad.map((x) => `${x.file} ${x.http_status ?? 'no answer'}${x.sha256_match ? '' : ' (sha256 differs)'}`).join('; ')}`, extra };
          }
          if (reviewPlan) {
            // A records/ artifact the catalog upload already sent (same file, same sha256, same principal) is not sent
            // twice; the rest (review-artifacts/, the probe) are uploaded here. ec-upload-reviews.json: one row per artifact.
            const { reused, toUpload } = splitReviewUploads(reviewPlan, rows);
            const sent = reviewUploadRows(toUpload, await uploadRecords(EC_URL, ecSecret, reviewUploadRequests(toUpload), fetch, principal));
            const byId = new Map([...reused, ...sent].map((x) => [x.id, x]));
            const all = reviewPlan.uploads.map((u) => byId.get(u.id)!);
            fs.writeFileSync(P.ecReviewUploadsFile, JSON.stringify(all, null, 2));
            for (const x of all) reviewHashOf[x.id] = x.sha256;
            const bad = badReviewUploads(all);
            planNote = `${all.length} upload(s) (${reused.length} via the catalog upload), ${bad.length} failed`;
            extra.review_uploads = planNote;
            if (bad.length) return { rc: 1, detail: `review uploads failed: ${bad.map((x) => `${x.id} HTTP ${x.http_status ?? 'no answer'}${x.uploaded_by ? '' : ' (no uploader)'}`).join(', ')}`, extra };
          } else extra.review_uploads = planNote;
          return { rc: 0, extra };
        } catch (err) {
          fs.writeFileSync(path.join(P.out, 'ec-upload.json'), JSON.stringify({ error_status: null, error: String(err) }, null, 2));
          return { rc: 1, detail: `EC upload error: ${String(err)}`, extra: { http_status: null, ec_url: EC_URL } };
        }
      },
    },
    {
      // NS-4t (as mx-e2e.ps1 Invoke-ReviewStep): runs inside E7, after EO answers /api/health and before the first assess
      // (NS-4 decision 1: every assess pass reads the same reviews; V14 and the one-SPRS check hold). Not fatal; REQUIRED.
      id: 'E8.6',
      title: 'Document reviews (reviewer of document-reviews.json, approver token minted by EO), inside E7 before the first assess',
      fatal: false,
      commands: [
        `POST ${EO_URL}/api/approver-tokens?tenant=${slug} {approverUpn: <reviewer>} (x-ces-principal = dev operator token, role bhd-operator, CES_EO_OPERATOR_SECRET=<run-only>)`,
        `POST ${EO_URL}/api/reviews x<plan reviews> (x-ces-principal = the minted approver token; artifactHash = EC's sha256 from ${rel(P.ecReviewUploadsFile)})`,
        `self-review probe: a token minted for the uploader must get 403 reviewer_is_uploader -> ${rel(P.eoReviewsFile)}`,
      ],
      run: async () => {
        fs.rmSync(P.eoReviewsFile, { force: true });
        const opTok = reviewPlan ? await sign(operatorClaims(reviewPlan.operatorUpn), eoOperatorSecret) : '';
        const { rc, record } = await runReviewStep({ eoUrl: EO_URL, slug, plan: reviewPlan, hashOf: reviewHashOf, baseHeaders: eoAuthHeaders(), operatorToken: () => opTok });
        fs.writeFileSync(P.eoReviewsFile, JSON.stringify(record, null, 2));
        log(`  E8.6: ${record.reviews_planned} review(s) planned, ${record.posted_201} posted (201); self-review HTTP ${record.self_review_status ?? 'n/a'}`);
        return {
          rc,
          ...(rc !== 0 ? { detail: record.error ?? (record.mint_status !== 201 ? `approver-token mint HTTP ${record.mint_status}` : `${record.posted_201}/${record.reviews_planned} reviews 201; self-review HTTP ${record.self_review_status ?? 'none'}`) } : {}),
          extra: { reviews: record.reviews_planned, posted: record.posted_201, self_review_status: record.self_review_status ?? null, file: path.basename(P.eoReviewsFile) },
        };
      },
    },
    {
      // FIN-19 (V112, FIN-12): one upload through EO's own upload route, as EO's screen sends it. Runs inside E7 after
      // E8.6. Not fatal, not REQUIRED.
      id: 'E8.5b',
      title: `One upload through EO's upload route (POST /api/ec/ingest, uploader principal, catalog ids), inside E7 after E8.6`,
      fatal: false,
      commands: [
        `POST ${EO_URL}/api/ec/ingest multipart (file: fictional text, controlIds PE.L2-3.10.2, form_id/emx_ids of the scenario's ec_upload; x-ces-principal = signed uploader token) -> ${rel(P.eoRouteUploadFile)}`,
      ],
      run: async () => {
        fs.rmSync(P.eoRouteUploadFile, { force: true });
        eoRouteUpload = null;
        const principal = reviewPlan ? await sign(uploaderClaims(reviewPlan.uploader.upn), ecPrincipalSecret) : null;
        const up = sc.ec_upload as { form_id?: unknown; emx_ids?: unknown; submittedByRole?: unknown } | undefined;
        const rec = await postEoRouteUpload({
          eoUrl: EO_URL,
          slug,
          headers: eoAuthHeaders(),
          principalToken: principal,
          uploaderUpn: reviewPlan?.uploader.upn ?? null,
          submittedByRole: typeof up?.submittedByRole === 'string' ? up.submittedByRole : 'compliance_officer',
          ...(typeof up?.form_id === 'string' ? { formId: up.form_id } : {}),
          ...(Array.isArray(up?.emx_ids) ? { emxIds: up.emx_ids.map(String) } : {}),
        });
        fs.writeFileSync(P.eoRouteUploadFile, JSON.stringify(rec, null, 2));
        eoRouteUpload = rec;
        const ok = rec.http_status === 201 || (!principal && !!rec.note);
        return { rc: ok ? 0 : 1, ...(ok ? {} : { detail: `EO upload route HTTP ${rec.http_status ?? 'none'}${rec.note ? ` (${rec.note})` : ''}` }), extra: { http_status: rec.http_status, uploaded_by: rec.uploaded_by, file: path.basename(P.eoRouteUploadFile) } };
      },
    },
    {
      // FIN-19 (V112, FIN-12 / FD-8): two reviews of one objective of E8.5b's upload through the `eo review` CLI (the
      // second must supersede the first), then `eo review list --history`. Not fatal, not REQUIRED.
      id: 'E8.6b',
      title: 'Supersede pair through the eo review CLI on E8.5b\'s upload, inside E7 after E8.5b',
      fatal: false,
      commands: [
        `POST ${EO_URL}/api/approver-tokens?tenant=${slug} {approverUpn: <reviewer>} (x-ces-principal = dev operator token)`,
        `(cwd ${rel(P.eoRoot)}, CES_EO_APPROVER_TOKEN=<minted>) ${nodeCmd} ${rel(P.tsx)} src/cli/index.ts --url ${EO_URL} review --tenant ${slug} --control PE.L2-3.10.2 --objective PE.L2-3.10.2[b] --hash <E8.5b sha256> --verdict met --notes <first | superseding> (x2)`,
        `(same) review list --tenant ${slug} --control PE.L2-3.10.2 --history -> ${rel(P.eoReviewCliFile)}`,
      ],
      run: async () => {
        fs.rmSync(P.eoReviewCliFile, { force: true });
        const opTok = reviewPlan ? await sign(operatorClaims(reviewPlan.operatorUpn), eoOperatorSecret) : '';
        const { rc, record } = await runCliReviewPair({
          eoUrl: EO_URL,
          slug,
          reviewerUpn: reviewPlan?.reviewer?.upn ?? null,
          artifactSha256: eoRouteUpload?.http_status === 201 ? eoRouteUpload.sha256 : null,
          baseHeaders: eoAuthHeaders(),
          operatorToken: opTok,
          run: eoCli,
          env: { ...process.env },
        });
        fs.writeFileSync(P.eoReviewCliFile, JSON.stringify(record, null, 2));
        return { rc, ...(rc !== 0 ? { detail: record.note ?? record.calls.map((c) => `rc ${c.rc}${c.error ? `: ${c.error}` : ''}`).join('; ') } : {}), extra: { calls: record.calls.length, mint_status: record.mint_status, file: path.basename(P.eoReviewCliFile) } };
      },
    },
    {
      id: 'E7',
      title: `EO connect + assess x${assessRuns}`,
      fatal: true,
      commands: [
        `(cwd ${rel(path.join(P.ces, 'ces-eo'))}, sim env) EO_PORT=4002 TENANT_SLUG=${slug} STORAGE_ROOT=${rel(path.join(P.out, 'eo'))} COMPLIANCE_REPO_PATH=${rel(path.join(P.out, 'eo-repo'))} EC_URL=${EC_URL} ${EO_ADMINOPS_SINCE_ENV}=<E1 start> ${nodeCmd} ${rel(P.tsx)} src/eo/index.ts`,
        `FIN-19: E3's EO is stopped and EO restarts here with the sim env (same STORAGE_ROOT and ces.db)`,
        `FLOW-3: muster-api's own E4 intake receipt -> ${rel(P.eoIntakeFile)}; only when it did not deliver: POST ${EO_URL}/api/intake/muster (the E4-pushed files in ${rel(P.plansPushed)} + their names + ${rel(path.join(P.planDir, 'policies'))}/*.md the policy-set manifest hashes)`,
        ...(recordsPresent ? [`NS-3 (on by default, D-7; ${NS3_ENABLE_ENV}=0 turns it off): POST ${EO_URL}/api/personnel, PUT screening, POST training/complete, POST risk-assessment/register/entries, offboarding start/step/complete (customers/<slug>/records via build-customer-records.mjs eoRecordPosts) -> ${rel(P.eoRecordsFile)}`] : []),
        `NS-4t: CES_AO_PRINCIPAL_SECRET=<run-only> CES_EO_OPERATOR_SECRET=<run-only> CES_EO_OPERATOR_DEV_FALLBACK=1 on EO; step E8.6 (above) after /api/health`,
        `NS-4t (V81): POST ${EO_URL}/api/interviews {tenant, records} (muster-api dist buildInterviewRecords over ${rel(P.interviewAnswers)}, interviewer ${HARNESS_INTERVIEWER.subjectId}; none: skipped), then GET /api/interviews?tenant=${slug} -> ${rel(P.eoInterviewsFile)}`,
        `SSE ${EO_URL}/api/connect?tenant=${slug} (stop connection_log:done) -> out/eo-connect.json`,
        `SSE ${EO_URL}/api/assess?tenant=${slug} (stop assess_done) x${assessRuns} -> out/eo-assess.json, eo-assess-2.json, ...`,
      ],
      run: async () => {
        // W2 follow-up: EO reads only this run's AdminOps rows (ces.db is append-only and shared across runs; the window
        // is a simulator property, six-year retention a production one). The EO server started here serves E7B, E8, E8F.
        const adminOpsSince = windows.E1?.started;
        // FIN-19: E3's EO (base env, for Muster's own calls) gives way to EO with the sim env; storage is the same.
        if (eoProc) {
          stopTree(eoProc);
          eoProc = undefined;
          if (!(await waitPortFree(4002, 30))) return { rc: 1, detail: 'E3\'s EO still holds port 4002' };
        }
        eoProc = startBg('E7-eo', node, [P.tsx, 'src/eo/index.ts'], P.eoRoot, eoChildEnv(simEnv!));
        if (!(await waitHttp(`${EO_URL}/api/health`, 'GET', 120))) return { rc: 1, detail: 'EO did not answer /api/health' };
        // Gap closure FLOW-3 (V84): the push bundle in EO's intake before the first assess, so the policy store and the
        // SSP's CUI Boundary envelope are in place. FIN-19: muster-api delivered it at E4 (EO up since E3); its receipt
        // is the record. Only when it did not deliver does E7 post the bundle itself. Not fatal: V84 / V114 judge it.
        const built = buildEoIntakeBody(P.plansPushed, slug, path.join(P.planDir, 'policies'), P.planDir); // FIN-35 S-1: EO-only kinds from out/plan
        const pushRespFile = path.join(P.out, 'push-response.json');
        const fromMuster = fs.existsSync(pushRespFile) ? (() => { try { return intakeRecordFromPush(readJson(pushRespFile), EO_URL, built); } catch { return null; } })() : null;
        if (fromMuster) fs.writeFileSync(P.eoIntakeFile, JSON.stringify(fromMuster, null, 2));
        const intake = fromMuster ?? (await postEoIntake(EO_URL, eoAuthHeaders(), built, P.eoIntakeFile));
        const eoIntake = { status: intake.status, http: intake.http, policies: intake.sent.policies, by: fromMuster ? 'muster-api' : 'ces-tester' };
        // Gap closure NS-3 (V81): the customer's records into EO's personnel, training, risk and offboarding stores,
        // before the first assess so E8's SSP reads them. On by default (founder decision D-7, 2026-10-31; LOG-GC-PKG-C1.md);
        // CES_NS3_EO_RECORDS=0 turns them off. The posts feed EO's PS / AT ledger readiness, not the snapshot status or SPRS.
        let eoRecords: Record<string, unknown> = { enabled: false };
        if (recordsPresent && process.env[NS3_ENABLE_ENV] !== '0') {
          const mod = (await import(pathToFileURL(P.customerRecordsModule).href)) as { loadEoRecordPosts: (pkg: string, slug: string) => EoRecordPosts | null };
          const posts = mod.loadEoRecordPosts(P.pkg, slug);
          if (posts) {
            const res = await postEoRecords(eoCaller(EO_URL, eoAuthHeaders()), slug, posts);
            fs.writeFileSync(P.eoRecordsFile, JSON.stringify(res, null, 2));
            eoRecords = { enabled: true, ...res.posted, errors: res.errors.length };
            if (res.errors.length) return { rc: 1, detail: `NS-3 EO record posts: ${res.errors.slice(0, 3).map((e) => `${e.what} HTTP ${e.status}`).join('; ')}`, extra: { adminops_since: adminOpsSince, eo_intake: eoIntake, eo_records: eoRecords } };
          }
        }
        // NS-4t: step E8.6 (its own steps.json row) before the first assess. FIN-19: then E8.5b and E8.6b.
        await execStep(defs.find((d) => d.id === 'E8.6')!);
        await execStep(defs.find((d) => d.id === 'E8.5b')!);
        await execStep(defs.find((d) => d.id === 'E8.6b')!);
        // NS-4t (V81, NS-2 open item 2): the customer's answered interview questions as interview records. Not fatal: EO
        // never scores them; a refused batch is recorded (eo-interviews.json) and V81 judges it.
        let eoInterviews: Record<string, unknown>;
        try {
          const answersFile = fs.existsSync(P.interviewAnswers) ? P.interviewAnswers : null;
          let built = null;
          if (answersFile) {
            const im = await loadInterviewRecordModule(P.musterApi);
            built = im.buildInterviewRecords(fs.readFileSync(answersFile, 'utf8'), { tenantSlug: slug, interviewer: { ...HARNESS_INTERVIEWER }, questionControls: im.readQuestionControlMap(P.muster) });
          }
          const iv = await postInterviewRecords(EO_URL, slug, built, answersFile && rel(answersFile), eoAuthHeaders());
          fs.writeFileSync(P.eoInterviewsFile, JSON.stringify(iv.record, null, 2));
          eoInterviews = { ok: iv.ok, built: iv.record.built, http: iv.record.http_status, stored: iv.record.stored, skipped: iv.record.skipped, listed: iv.record.listed };
        } catch (err) {
          eoInterviews = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        // FIN-29 (R-F1 S1 red, V14/V27/V36/V43b): EO's EC reader returns [] silently when EC's GET /api/items takes more
        // than 3 s, which emptied E7 pass 1 (0 items; passes 2-3: 21). Wait until EC answers that read within EO's budget
        // with every item this run uploaded, so all three passes and E7B see the same EC items.
        let ecReady: Record<string, unknown> = {};
        try {
          const readJ = <T>(f: string): T | null => (fs.existsSync(f) ? readJson<T>(f) : null);
          const want = expectedEcItems({
            scenarioUpload: !!readJ<{ error_status?: unknown }>(path.join(P.out, 'ec-upload.json')) && readJ<{ error_status?: unknown }>(path.join(P.out, 'ec-upload.json'))?.error_status === undefined,
            records: readJ<{ items?: Array<{ http_status?: number | null }> }>(P.ecRecordsFile)?.items ?? null,
            reviewUploads: readJ<Array<{ http_status?: number | null; via_catalog_upload?: boolean }>>(P.ecReviewUploadsFile),
            eoRoute: eoRouteUpload,
          });
          const r = await waitEcItemsReady({ ecUrl: EC_URL, slug, secret: ecSecret, want: want > 0 ? want : null });
          ecReady = { ready: r.ready, want: r.want, probes: r.probes.length, last_ms: r.probes[r.probes.length - 1]?.ms ?? null, last_count: r.probes[r.probes.length - 1]?.count ?? null, note: r.note };
          log(`  E7: EC readiness before pass 1: ${r.note}`);
        } catch (err) {
          ecReady = { ready: false, note: `readiness probe error: ${err instanceof Error ? err.message : String(err)}` };
        }
        const c = await readSse({ url: `${EO_URL}/api/connect?tenant=${slug}`, stop: 'connection_log:done', outFile: path.join(P.out, 'eo-connect.json'), timeoutMs: 120000, headers: eoAuthHeaders() });
        fs.writeFileSync(path.join(P.logs, 'E7-connect.out'), c.line + '\n');
        if (c.rc !== 0) return { rc: c.rc, detail: sseFailureDetail('EO connect', c) };
        for (let i = 1; i <= assessRuns; i++) {
          const name = i === 1 ? 'eo-assess.json' : `eo-assess-${i}.json`;
          const a = await readSse({ url: `${EO_URL}/api/assess?tenant=${slug}`, stop: 'assess_done', outFile: path.join(P.out, name), timeoutMs: 900000, headers: eoAuthHeaders() });
          fs.writeFileSync(path.join(P.logs, i === 1 ? 'E7-assess.out' : `E7-assess-${i}.out`), a.line + '\n');
          if (a.rc !== 0) return { rc: a.rc, detail: sseFailureDetail(`EO assess ${i}`, a), extra: { adminops_since: adminOpsSince, eo_intake: eoIntake } };
        }
        return { rc: 0, extra: { adminops_since: adminOpsSince, eo_intake: eoIntake, eo_records: eoRecords, eo_interviews: eoInterviews, ec_ready: ecReady } };
      },
    },
    {
      id: 'E7A',
      title: `AdminOps (AO CLI, governed, sim only): ${aoOps.length ? aoOps.map((o) => `${o.op} ${o.tier} ${o.kind}`).join(', ') : 'no ops'}`,
      fatal: false,
      commands: [
        ...(aoOps.length ? [`throwaway self-signed PFX (in memory, random password in the child env only) -> ${rel(simCertPath(P.out, slug))}; registry record auth.cert_path -> it`] : []),
        `(cwd ${rel(P.aoRoot)}, sim env + CES_PIPELINE_ROOT=${rel(P.pl)} CES_TENANT_ROOT=${rel(P.tenants)} STACKSIM_SERVER_URL=${SIM_URL} CES_AO_SIM_ONLY=1 CES_AO_PRINCIPAL_SECRET=<run-only>)`,
        ...aoOps.map((o) => {
          const ps = Object.entries(o.params ?? {}).map(([k, v]) => ` --param ${k}=<${v}>`).join('');
          const ex = `${nodeCmd} ${rel(P.aoCli)} exec ${o.op} --tenant ${slug} --requestor <resources.operator_upn>${ps}`;
          const conf = o.confirm ? '; confirming sim read' : '';
          return o.tier === 'T2' || !twoPersonApprovalOn(process.env)
            ? `${ex} --json; then ${ex} --apply --json${conf}${o.tier === 'T3' ? ` (two-person approval OFF; ${TWO_PERSON_APPROVAL_ENV}=1 turns it on)` : ''}`
            : `${ex} --json (-> approval id); CES_AO_PRINCIPAL_TOKEN=<run-only, upn <resources.approver_upn>> ${nodeCmd} ${rel(P.aoCli)} approve <id>; ${ex} --approval <id> --apply --json${conf}`;
        }),
        `-> ${rel(P.e7aFile)}`,
      ],
      run: async () => {
        // FIN-35 (EU-AO): the sim store E7A starts from, for the watched AO run's twin state (a file copy, no sim call).
        snapshotStoreTo('sim-store-e7a-pre.json');
        if (!fs.existsSync(P.registryRecord)) return { rc: 1, detail: `no registry record ${rel(P.registryRecord)}` };
        // Run 36: AO's live-config check needs the record's cert_path on disk (ao-step.ts makeSimPfx); ops only.
        let simCert: { path: string; thumbprint: string } | null = null;
        if (aoOps.length) {
          simCert = makeSimPfx(simCertPath(P.out, slug));
          writeRecordCertPath(P.registryRecord, simCert.path);
        }
        const record = readJson<Record<string, unknown>>(P.registryRecord);
        const env = buildAoEnv(simEnv!, { pipelineRoot: P.pl, tenantRoot: P.tenants, simUrl: SIM_URL, secret: aoSecret });
        const started = nowIso();
        const result = await runAoOps({
          ops: aoOps,
          slug,
          record,
          provenance: regResources.provenance,
          env,
          runCli: (args, cenv, label) => runAoCli(args, cenv, label),
          confirm: async (check) => {
            const v = await verifyExpectedState(SIM_URL, [check]);
            const act = v.assertions[0]?.actual;
            return { pass: v.assertions[0]?.result === 'pass', ...(act === undefined ? {} : { actual: typeof act === 'string' ? act : JSON.stringify(act) }) };
          },
        });
        aoWriteChecks = aoOps.filter((o) => o.kind === 'write' && o.confirm).flatMap((o) => {
          try {
            return [resolveCheck(o.confirm!, record)];
          } catch {
            return [];
          }
        });
        const writeOps = aoOps.filter((o) => o.kind === 'write').length;
        const e7a = {
          schema: ADMINOPS_E7A_SCHEMA,
          tenant_slug: slug,
          tenant_id: result.tenant_id,
          requestor_upn: result.requestor_upn,
          approver_upn: aoOps.some((o) => o.tier === 'T3') ? result.approver_upn : null,
          two_person_approval: result.two_person_approval,
          env_keys: [...AO_ENV_KEYS],
          adminops_since: windows.E1?.started ?? null,
          sim_cert: simCert ? { path: rel(simCert.path), thumbprint: simCert.thumbprint } : null,
          started,
          ended: nowIso(),
          registry_resources: Object.fromEntries(Object.keys(regResources.resources).sort().map((k) => [k, regResources.provenance[k] ?? 'unknown'])),
          write_ops: writeOps,
          ops: result.ops,
          expected_improvements: sc.expected_improvements ?? [],
          allowed_reverts: sc.allowed_reverts ?? [],
          drift_injections: injections.length,
          ok: result.ok,
        };
        fs.writeFileSync(P.e7aFile, JSON.stringify(e7a, null, 2));
        const bad = result.ops.filter((o) => !o.ok);
        return {
          rc: bad.length ? 1 : 0,
          ...(bad.length ? { detail: bad.map((o) => `${o.op}: ${o.detail ?? 'failed'}`).join('; ') } : {}),
          extra: { ops: aoOps.length, write_ops: writeOps, ok: result.ops.filter((o) => o.ok).length },
        };
      },
    },
    {
      id: 'E7B',
      title: 'EO re-assess after AdminOps (not forced; drift against E7 pass 3)',
      fatal: true,
      commands: [`SSE ${eoAssessUrl(slug)} (stop assess_done) -> ${rel(P.assess7b)}`],
      run: async () => {
        if (!eoProc) return { rc: 1, detail: 'E7B needs EO from E7' };
        const a = await readSse({ url: eoAssessUrl(slug), stop: 'assess_done', outFile: P.assess7b, timeoutMs: 900000, headers: eoAuthHeaders() });
        fs.writeFileSync(path.join(P.logs, 'E7B-assess.out'), a.line + '\n');
        // FIN-35 (EU-EO): the sim store E7B assessed, for the watched EO run's twin state (a file copy, no sim call).
        snapshotStoreTo('sim-store-e7b.json');
        // FIN-35 (EU-EO, V124): the pipeline-root and EO state E7B assessed, so the watched EO run starts from it and not
        // from the end of the twin (E7C / E7S AO rows, E8F's forced evidence). An online backup of ces.db (EO and EC hold
        // it open) plus copies of EC's store, the tenant's Stamper folder and out/eo. CES_EU_EO_E7B_STATE=0 skips it.
        if (process.env.CES_EU_EO_E7B_STATE !== '0') await captureE7bState();
        return { rc: a.rc, ...(a.rc !== 0 ? { detail: 'EO assess (E7B) failed' } : {}), extra: { assessment_id: a.rc === 0 ? assessSnapshotId(P.assess7b) : undefined } };
      },
    },
    {
      id: 'E8',
      title: 'SSP (JSON + DOCX), POA&M, EO ledger and evidence package; sim ledger snapshot',
      fatal: true,
      commands: [
        `POST ${EO_URL}/api/poam/generate (E7B snapshot) -> out/poam.json; POST /api/ssp/generate -> out/ssp.json; GET /api/ssp/export/<sspId>?tenant=${slug} -> out/ssp.docx`,
        `GET ${EO_URL}/api/ledger?tenant=${slug} -> out/eo-ledger.json; POST /api/package/build -> out/eo-package.zip (expanded to out/eo-package)`,
        `FIN-19 (V87): (cwd ${rel(P.eoRoot)}) ${nodeCmd} ${rel(P.tsx)} src/cli/index.ts --url ${EO_URL} package build --tenant ${slug} --out ${rel(P.eoPackageCliZip)} (expanded to ${rel(P.eoPackageCliDir)}) -> ${rel(P.eoPackageCliFile)}`,
        `POST ${SIM_URL}/ledger {} -> out/ledger.json`,
      ],
      run: async () => {
        let rc = 0;
        const problems: string[] = [];
        // W2 (PLAN §3 E8): built from the E7B snapshot (after AdminOps).
        const aid = assessSnapshotId(P.assess7b);
        const body = { tenantSlug: slug, assessmentId: aid };
        try {
          // V35: generate the POA&M first so the SSP's section 14 cites the POA&M the bundle ships (one id, not two).
          await fetchToFile(`${EO_URL}/api/poam/generate`, path.join(P.out, 'poam.json'), postJson(body));
          await fetchToFile(`${EO_URL}/api/ssp/generate`, path.join(P.out, 'ssp.json'), postJson(body));
          const sspId = readJson<{ sspId?: string }>(path.join(P.out, 'ssp.json')).sspId;
          await fetchToFile(`${EO_URL}/api/ssp/export/${sspId}?tenant=${slug}`, path.join(P.out, 'ssp.docx'));
        } catch (err) {
          problems.push(String(err));
          rc = 1;
        }
        const pkgDir = path.join(P.out, 'eo-package');
        fs.rmSync(pkgDir, { recursive: true, force: true });
        try {
          await fetchToFile(`${EO_URL}/api/ledger?tenant=${slug}`, path.join(P.out, 'eo-ledger.json'));
          await fetchToFile(`${EO_URL}/api/package/build`, path.join(P.out, 'eo-package-build.json'), postJson({ tenant: slug }));
          const zip = readJson<{ filePath: string }>(path.join(P.out, 'eo-package-build.json')).filePath;
          const zipOut = path.join(P.out, 'eo-package.zip');
          fs.copyFileSync(zip, zipOut);
          const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
          const x = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Path ${q(zipOut)} -DestinationPath ${q(pkgDir)} -Force`], { stdio: 'ignore', windowsHide: true });
          if (x.status !== 0) throw new Error(`Expand-Archive exit ${x.status}`);
        } catch (err) {
          problems.push(`package: ${String(err)}`);
          rc = 1;
        }
        // FIN-19 (V87): the same snapshot's package through `eo package build`. Not fatal: V87 judges it.
        let cliPkg: Record<string, unknown> = { ran: false };
        if (fs.existsSync(path.join(P.out, 'eo-package.zip'))) {
          fs.rmSync(P.eoPackageCliDir, { recursive: true, force: true });
          fs.rmSync(P.eoPackageCliZip, { force: true });
          const c0 = await eoCli(['package', 'build', '--tenant', slug, '--out', P.eoPackageCliZip], { ...process.env });
          // FIN-29 (R-F1 S1 red, V87): Node 24 on Windows can abort on exit (libuv UV_HANDLE_CLOSING, exit 3221226505) after
          // the CLI finished: ces-eo src/cli/index.ts calls process.exit while fetch's sockets close. As E2 does for mu, the
          // call counts when it printed a result without an error and wrote the zip; the raw code is kept (LOG-FIN-29 §8).
          const c = { ...c0, rc: eoCliEffectiveRc(c0, fs.existsSync(P.eoPackageCliZip)) };
          let expanded = false;
          if (c.rc === 0 && fs.existsSync(P.eoPackageCliZip)) {
            const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
            const x = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Path ${q(P.eoPackageCliZip)} -DestinationPath ${q(P.eoPackageCliDir)} -Force`], { stdio: 'ignore', windowsHide: true });
            expanded = x.status === 0;
          }
          let printed: unknown = null;
          try { printed = JSON.parse(c.stdout.trim().split(/\r?\n/).pop() ?? 'null'); } catch { printed = null; }
          cliPkg = { ran: true, rc: c.rc, ...(c.rc !== c0.rc ? { raw_rc: c0.rc, abort_on_exit: true } : {}), expanded, printed, ...(c.rc !== 0 ? { error: (c.stderr || c.stdout).trim().slice(0, 500) } : {}) };
          fs.writeFileSync(P.eoPackageCliFile, JSON.stringify({ schema: 'ces-tester/eo-package-cli@1', taken: nowIso(), api_zip: 'eo-package.zip', cli_zip: path.basename(P.eoPackageCliZip), ...cliPkg }, null, 2));
        }
        // Sim ledger snapshot now, before E8F writes to the sim (verify V7 and step EX read this one).
        ledgerEntries = await snapshotLedger(path.join(P.out, 'ledger.json'));
        ledgerTaken = ledgerEntries !== null;
        return { rc, ...(problems.length ? { detail: problems.join('; ') } : {}), extra: { assessment_id: aid, package: fs.existsSync(path.join(P.out, 'eo-package.zip')), cli_package: { rc: cliPkg.rc ?? null, expanded: cliPkg.expanded ?? null } } };
      },
    },
    {
      id: 'EX',
      title: 'Tester comparison: readiness facts, post-Stamper state, sim ledger',
      fatal: false,
      commands: [
        `expected_facts (${Object.keys(sc.expected_facts).length} RR-ACT ids) vs ${rel(path.join(P.planDir, `readiness-result-${slug}.json`))} facts[]`,
        `expected_state: ${sc.expected_state.checks.length} /resolve checks on ${SIM_URL}, plus the E7A write ops' confirming reads (${aoOps.filter((o) => o.kind === 'write').length})`,
        `expected_ledger vs out/ledger.json and this run's step windows`,
      ],
      run: async () => {
        const rrPath = path.join(P.planDir, `readiness-result-${slug}.json`);
        const readiness = exists(rrPath) ? readJson<{ facts?: Array<{ question_id?: string; answer?: unknown }> }>(rrPath) : null;
        const facts = compareFacts(sc.expected_facts, readiness, rel(rrPath));
        // W2: the AO-touched objects still show AO's change after E8 (PLAN §3 EX).
        const verdict = await verifyExpectedState(SIM_URL, [...sc.expected_state.checks, ...aoWriteChecks]);
        const state = { pass: verdict.assertions.length > 0 && verdict.assertions.every((a) => a.result === 'pass'), assertions: verdict.assertions, diverged: verdict.diverged };
        // S1 fix: the scenario-build window's writes are counted against the sim scenario's own write steps.
        const simScenarioFile = path.join(P.sim, 'scenarios', `${slug}.json`);
        const buildSteps = scenarioWriteSteps(exists(simScenarioFile) ? readJson<{ steps?: Array<{ method?: string }> }>(simScenarioFile) : null);
        const ledger = ledgerEntries
          ? compareLedger(sc.expected_ledger, ledgerEntries, windows, buildSteps)
          : { pass: false, entries: 0, writes: 0, rows: [{ check: 'ledger snapshot', expected: 'present', actual: 'missing', pass: false }] };
        comparison = { pass: facts.pass && state.pass && ledger.pass, facts, state, ledger };
        const detail = `facts ${facts.matched}/${facts.total}; state ${verdict.assertions.filter((a) => a.result === 'pass').length}/${verdict.assertions.length}; ledger ${ledger.rows.filter((r) => r.pass).length}/${ledger.rows.length}`;
        return { rc: comparison.pass ? 0 : 1, detail };
      },
    },
    {
      id: 'E8B',
      title: 'Evidence bundle (raw + shared, manifest, identity scan)',
      fatal: false,
      commands: [`(cwd out) ${nodeCmd} ${rel(P.bundle)} --root <WS> --scenario ${slug}`],
      run: async () => {
        const rc = await runLogged('E8B-bundle', node, [P.bundle, '--root', P.ws, '--scenario', slug], P.out);
        const tail = fs.readFileSync(path.join(P.logs, 'E8B-bundle.out'), 'utf8').trim().split(/\r?\n/).slice(-6);
        for (const l of tail) log(`  ${l}`);
        return { rc };
      },
    },
    {
      id: 'E8F',
      title: 'Forced-failure run (Stamper --force-fail), one EO assess + SSP',
      fatal: false,
      skip: opts.skipForcedRun ? '--skip-forced-run' : undefined,
      commands: [
        `(powershell.exe, stdin newline, CES_MUSTER_SECRETS_URL=${API_URL} CES_MUSTER_SECRETS_TOKEN=<E3 token>) ${nodeCmd} ${rel(path.join(P.stamper, 'dist', 'cli', 'index.js'))} execute ${rel(P.exe)} --mode auto -e ${rel(path.join(P.forced, 'stamper.synthetic.env'))} --tenant ${slug} --force-fail ${forceFailEntry}`,
        `SSE ${eoAssessUrl(slug, { forced: true })} -> ${rel(path.join(P.forced, 'eo-assess.json'))}; V78 stale build POST ${EO_URL}/api/package/build {tenant} (expect 409; forced.json stale_build_status); POST /api/ssp/generate -> ${rel(path.join(P.forced, 'ssp.json'))}`,
        `W2 overlap proof: the E7A write ops' confirming reads before and after -> ${rel(P.overlapFile)}`,
      ],
      run: async () => {
        const extra: Record<string, unknown> = { entry: forceFailEntry };
        if (!(eoProc && serve)) return { rc: 1, detail: 'E8F needs the sim and EO from E7', extra };
        fs.rmSync(P.forced, { recursive: true, force: true });
        fs.mkdirSync(path.join(P.forced, 'st'), { recursive: true });
        const fenv = path.join(P.forced, 'stamper.synthetic.env');
        const lines = fs
          .readFileSync(path.join(P.out, 'stamper.synthetic.env'), 'utf8')
          .split(/\r?\n/)
          .filter((l) => l !== '')
          .map((l) => (l.startsWith('STORAGE_ROOT=') ? `STORAGE_ROOT=${path.join(P.forced, 'st').replace(/\\/g, '/')}` : l));
        fs.writeFileSync(fenv, lines.join('\n') + '\n');
        // W2 (PLAN §3 overlap rule): the AO-touched objects' state just before the forced execute.
        const before = aoWriteChecks.length ? (await verifyExpectedState(SIM_URL, aoWriteChecks)).assertions : [];
        const x = await launchStamperExecute({ stamperRoot: P.stamper, env: stamperEnv(), planPath: P.exe, envFilePath: fenv, tenantSlug: slug, forceFailEntry, workDir: P.stCwd });
        writeStamperLogs('E8F-execute', x);
        extra.execute_rc = x.exitCode; // non-zero is expected when a task fails; the report decides
        forcedRan = true;
        let rc = 1;
        const frep = latestRecursive(path.join(P.forced, 'st', 'state'), 'execution-report-');
        if (frep) {
          fs.copyFileSync(frep, path.join(P.forced, 'execution-report.json'));
          const a = await readSse({ url: eoAssessUrl(slug, { forced: true }), stop: 'assess_done', outFile: path.join(P.forced, 'eo-assess.json'), timeoutMs: 900000, headers: eoAuthHeaders() });
          fs.writeFileSync(path.join(P.logs, 'E8F-assess.out'), a.line + '\n');
          extra.assess_rc = a.rc;
          if (a.rc === 0) {
            try {
              const faid = assessSnapshotId(path.join(P.forced, 'eo-assess.json'));
              extra.assessment_id = faid;
              // NS-4t / V78 (PKG-1 gate, as mx-e2e.ps1 E8F): a build here is stale. The forced assess saved a newer snapshot
              // and POA&M while the SSP still records E7B's snapshotId, so EO must refuse it (409). Before the forced
              // ssp/generate, after which a build would match again. forced.json: stale_build_status / _reason (judgeV78Stale).
              Object.assign(extra, await attemptStaleBuild(EO_URL, slug, eoAuthHeaders()));
              await fetchToFile(`${EO_URL}/api/ssp/generate`, path.join(P.forced, 'ssp.json'), postJson({ tenantSlug: slug, assessmentId: faid }));
              rc = 0;
            } catch (err) {
              log(`  E8F SSP error: ${String(err)}`);
            }
          }
        } else log('  E8F: no forced execution report');
        const after = aoWriteChecks.length ? (await verifyExpectedState(SIM_URL, aoWriteChecks)).assertions : [];
        const reverted = before.filter((b, k) => b.result === 'pass' && after[k]?.result !== 'pass').map((b) => b.check);
        fs.writeFileSync(
          P.overlapFile,
          JSON.stringify({ schema: 'ces-tester/ao-overlap@1', checks: before.map((b, k) => ({ check: b.check, object_type: aoWriteChecks[k]?.ledger_object_type ?? null, before: b.result, after: after[k]?.result ?? 'missing', actual_after: after[k]?.actual })), reverted }, null, 2),
        );
        extra.ao_checks = before.length;
        extra.ao_reverted = reverted.length;
        // FIN-17 SP-7 (V88 f): E3 asked for 2 reads (E6, E8F); after E8F's execute the reference must be spent, so one
        // probe read gets 404. Only after both reads happened; the body is never read (a 200 would carry the value).
        try {
          const ref = fs.existsSync(P.planCompileFile) ? readJson<{ initial_password_ref?: string | null }>(P.planCompileFile).initial_password_ref : null;
          if (ref && musterToken && apiProc && apiProc.exitCode === null) {
            const pr = await fetch(`${API_URL}/api/plan/secrets/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${musterToken}` }, body: JSON.stringify({ tenant_slug: slug, ref }), signal: AbortSignal.timeout(30000) });
            extra.secret_probe_status = pr.status;
            await pr.body?.cancel().catch(() => undefined);
          } else extra.secret_probe_status = null;
        } catch {
          extra.secret_probe_status = null;
        }
        fs.writeFileSync(path.join(P.forced, 'forced.json'), JSON.stringify(extra, null, 2));
        return { rc, extra };
      },
    },
    {
      // FIN-19 (V113, FIN-13 + FD-1): the cost-gate traversal of one recurring-cost AO op on the simulated tenant, after
      // E8F so no assessment sees its write (the forced ledger is taken first). Scenario table COST_PROBES (S1 only).
      id: 'E7C',
      title: `AO cost gate on the sim: ${COST_PROBES[slug]?.op ?? 'none'} dry run, apply without DP-1, wrong DP-2, DP-1 + DP-2`,
      fatal: false,
      skip: COST_PROBES[slug] ? undefined : 'no cost probe for this scenario (fin19-steps.ts COST_PROBES: S1 only)',
      commands: [
        `(cwd ${rel(P.aoRoot)}, AO env as E7A) ${nodeCmd} ${rel(P.aoCli)} exec ${COST_PROBES[slug]?.op ?? '<op>'} --tenant ${slug} --requestor <resources.operator_upn> --json (dry run: price, ackHash)`,
        `... --apply --json (no DP-1: want dp1_missing); --apply --cost-ack <DP-1 from the dry run> --confirm-cost "<op> <wrong figure>" (want dp2_mismatch); --apply --cost-ack <DP-1> --confirm-cost "<op> <monthly>" (want enabled) -> ${rel(P.costFile)}`,
      ],
      run: async () => {
        fs.rmSync(P.costFile, { force: true });
        if (!serve || !simEnv || !fs.existsSync(P.registryRecord)) return { rc: 1, detail: 'E7C needs the sim and the registry record' };
        if (forcedRan && !forcedLedgerTaken) {
          await snapshotLedger(path.join(P.forced, 'ledger.json'));
          forcedLedgerTaken = true;
        }
        // FIN-29 (R-F1 S1 red, V113): the cost op's tenant-sourced parameters (E-01: retention days, workspace and resource
        // group names) are not in the E5 record; seed the missing ones (sim reads; retention 365 > the free 90).
        const testerRoot = path.join(P.ces, 'ces-tester');
        const seed = await seedCostProbeResources({ op: COST_PROBES[slug]!.op, recordFile: P.registryRecord, testerRoot, stacksimRoot: P.sim, read: (req) => simResolve(SIM_URL, req), im: (() => { const f = latest(P.plansPushed, 'infrastructure-manifest-'); return f ? readJson(f) : null; })() }).catch((err): { seeded: Record<string, string>; provenance: Record<string, string>; missing: Record<string, string> } => ({ seeded: {}, provenance: {}, missing: { _error: err instanceof Error ? err.message : String(err) } }));
        log(`  E7C: seeded ${Object.keys(seed.seeded).join(', ') || 'nothing'}${Object.keys(seed.missing).length ? `; missing ${JSON.stringify(seed.missing).slice(0, 300)}` : ''}`);
        const record = readJson<Record<string, unknown>>(P.registryRecord);
        const requestor = (record.resources as Record<string, unknown> | undefined)?.operator_upn;
        const env = buildAoEnv(simEnv, { pipelineRoot: P.pl, tenantRoot: P.tenants, simUrl: SIM_URL, secret: aoSecret });
        const rec = await runCostTraversal({ op: COST_PROBES[slug]!.op, slug, requestor: typeof requestor === 'string' && requestor ? requestor : null, env, runCli: (args, cenv, label) => runAoCli(args, cenv, label) });
        fs.writeFileSync(P.costFile, JSON.stringify({ ...rec, seeded_resources: Object.fromEntries(Object.keys(seed.seeded).map((k) => [k, seed.provenance[k] ?? 'seeded'])), seed_missing: seed.missing }, null, 2));
        return { rc: rec.ok ? 0 : 1, ...(rec.ok ? {} : { detail: rec.note ?? rec.calls.map((c) => `${c.call}: ${c.cost_outcome ?? '-'}${c.cost_reason ? ` (${c.cost_reason.slice(0, 120)})` : ''}`).join('; ') }), extra: { op: rec.op, calls: rec.calls.length, file: path.basename(P.costFile) } };
      },
    },
    // FIN-29 (PH-2 harness): after E8F / E7C, so no scored assessment reads their writes; each runs on private roots or a
    // probe tenant (fin29-*.ts). E7S is the last sim writer (its applies change the S1 sim broadly).
    afterForcedLedger(e8rStep(fin29Ctx, { forceFailEntry })),
    afterForcedLedger(e8tStep(fin29Ctx)),
    afterForcedLedger(e8gStep(fin29Ctx)),
    afterForcedLedger(e9aStep(fin29Ctx)),
    afterForcedLedger(e9eStep(fin29Ctx)),
    afterForcedLedger(withV130Imports(e9mStep(fin29Ctx))),
    afterForcedLedger(e7sStep(fin29Ctx)),
    {
      id: 'AO',
      title: 'stacksim coverage-ao (AO, 96 commands), after the run servers stop',
      fatal: false,
      skip: !sc.ao_coverage?.enabled ? 'scenario ao_coverage disabled' : opts.skipAo ? '--skip-ao' : undefined,
      commands: [`(cwd ${rel(P.sim)}) ${AO_COVERAGE_COMMAND} -> ${rel(P.aoFile)}`],
      run: async () => {
        aoRecord = await runAoCoverage({
          stacksimRoot: P.sim,
          outFile: P.aoFile,
          logBase: path.join(P.logs, 'AO-coverage-ao'),
          expectedTotal: sc.ao_coverage?.expected_total ?? 96,
        });
        return { rc: aoRecord.pass ? 0 : 1, detail: aoRecord.summary_line ?? aoRecord.reasons.join('; ') };
      },
    },
  ];

  const rows: StepRow[] = defs.map((d) => ({ id: d.id, title: d.title, commands: d.commands, fatal: d.fatal, status: 'not-run', rc: null }));
  const row = (id: string): StepRow => rows.find((r) => r.id === id)!;

  const buildRecord = (status: MusterE2eRunRecord['status']): MusterE2eRunRecord => {
    const ended = nowIso();
    return {
      schema: 'ces-tester/muster-e2e-run@1',
      harness: 'ces-tester',
      scenario_id: sc.scenario_id,
      scenario_file: rel(path.resolve(opts.scenarioPath)),
      sim_scenario: slug,
      dry_run: !!opts.dryRun,
      started,
      ended,
      duration_ms: Date.now() - t0,
      roots: { ws: '.', ces: rel(P.ces), package: rel(P.pkg), out: rel(P.out) },
      options: { skip_forced_run: !!opts.skipForcedRun, force_fail_entry: forceFailEntry, skip_ao: !!opts.skipAo },
      required_steps: REQUIRED_STEPS,
      steps: rows,
      comparison,
      ao_coverage: aoRecord
        ? { ran: true, pass: (aoRecord as AoCoverageRecord).pass, record: rel(P.aoFile), totals: (aoRecord as AoCoverageRecord).totals, reasons: (aoRecord as AoCoverageRecord).reasons }
        : aoEnabled
          ? { ran: false, pass: false, record: rel(P.aoFile), totals: null, reasons: ['not run'] }
          : null,
      status,
      failures,
    };
  };

  // ---------- dry run: print what would run, write nothing ----------
  if (opts.dryRun) {
    log(`muster-e2e DRY RUN: ${sc.scenario_id} (sim scenario ${slug}); <WS> = --root; outputs under <WS>/out`);
    for (const d of defs) {
      const r = row(d.id);
      r.status = d.skip ? 'skipped' : 'planned';
      if (d.skip) r.detail = d.skip;
      log(`[${d.id}] ${d.title}${d.fatal ? '' : ' (not fatal)'}${d.skip ? ` SKIPPED: ${d.skip}` : ''}`);
      for (const c of d.commands) log(`    ${c}`);
    }
    return buildRecord('DRY-RUN');
  }

  // ---------- real run ----------
  // Run 61: every per-run artefact of an earlier run goes before E1 (an aborted E7 left run 60's passes 2 and 3).
  const cleaned = cleanPerRunArtefacts(P.out, P.pl, slug);
  log(`per-run cleanup: ${cleaned.length} earlier artefacts removed`);
  fs.mkdirSync(P.logs, { recursive: true });
  fs.mkdirSync(P.pl, { recursive: true });
  fs.mkdirSync(P.tenants, { recursive: true });
  fs.rmSync(P.recordFile, { force: true });
  fs.rmSync(P.aoFile, { force: true });
  fs.rmSync(P.registryRecordSnapshot, { force: true }); // PH-6 R-UI: an earlier run's record never stands in for this run's
  // W2: this run's E6X / E7A / E7B records only (a stale one must never be judged as this run's).
  for (const f of [P.e6xFile, P.e7aFile, P.assess7b, path.join(P.out, 'leaver-flow.json')]) fs.rmSync(f, { force: true });
  fs.rmSync(path.dirname(simCertPath(P.out, slug)), { recursive: true, force: true }); // an earlier run's throwaway PFX
  // FIN-19: muster-api calls EO only with a bearer (CES_EO_URL + CES_EO_AUTH_TOKEN). mx-e2e.ps1 sets one per run; a
  // standalone tester run gets a run-only one here (process env only; never written to a file or log).
  if (!process.env.CES_EO_AUTH_TOKEN) process.env.CES_EO_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
  process.env.CES_PIPELINE_ROOT = P.pl;
  process.env.CES_TENANT_ROOT = P.tenants;
  process.env.STACKSIM_ROOT = P.sim;
  process.env.STAMPER_REGISTRY_ROOT = P.stamperRegistry;
  // FIN-29 (V101): the per-run bearer tokens the package wrapper (or the line above) put in this process's env.
  runSecrets.register('eo_auth_token', process.env.CES_EO_AUTH_TOKEN);
  runSecrets.register('ao_auth_token', process.env.CES_AO_AUTH_TOKEN);

  const execStep = async (d: StepDef): Promise<boolean> => {
    const r = row(d.id);
    if (d.skip) {
      r.status = 'skipped';
      r.detail = d.skip;
      log(`SKIP ${d.id} (${d.skip})`);
      return true;
    }
    r.started = nowIso();
    let out: StepOutcome;
    try {
      out = await d.run();
    } catch (err) {
      out = { rc: 1, detail: `crashed: ${err instanceof Error ? err.message : String(err)}` };
    }
    r.ended = nowIso();
    r.duration_ms = Date.parse(r.ended) - Date.parse(r.started);
    r.rc = out.rc;
    r.status = out.rc === 0 ? 'ok' : 'fail';
    if (out.detail) r.detail = out.detail;
    if (out.extra) r.extra = out.extra;
    windows[d.id] = { started: r.started, ended: r.ended };
    steps[d.id] = { rc: out.rc, started: r.started, ended: r.ended, ...(out.extra ?? {}) };
    saveSteps();
    log(`${out.rc === 0 ? 'OK  ' : 'FAIL'} ${d.id} (rc=${out.rc})${out.detail ? `: ${out.detail}` : ''}`);
    if (out.rc !== 0 && d.fatal) {
      failures.push(`${d.id}: ${out.detail ?? `rc ${out.rc}`}`);
      return false;
    }
    return true;
  };

  saveSteps();
  const held = await heldPorts();
  if (held.length) {
    failures.push(`ports in use: ${held.join(', ')} (this harness never kills processes)`);
    log(`REFUSE: ${failures[0]}`);
    const rec = buildRecord('FAIL');
    fs.writeFileSync(P.recordFile, JSON.stringify(rec, null, 2));
    return rec;
  }
  // FIN-29 (SP-11 live-folder guard): a simulator run never starts where its children could read a live tenant record.
  const liveViolations = liveFolderViolations({ tenantRoot: P.tenants, env: process.env });
  if (liveViolations.length) {
    failures.push(`live-folder guard: ${liveViolations.join('; ')}`);
    log(`REFUSE: ${failures[failures.length - 1]}`);
    const rec = buildRecord('FAIL');
    fs.writeFileSync(P.recordFile, JSON.stringify(rec, null, 2));
    return rec;
  }

  try {
    for (const d of defs) {
      if (d.id === 'AO') break;
      if (d.id === 'E8.6' || d.id === 'E8.5b' || d.id === 'E8.6b') continue; // NS-4t / FIN-19: E7 runs them after EO is up
      if (!(await execStep(d))) break;
    }
  } finally {
    if (serve) {
      if (forcedRan && !forcedLedgerTaken) await snapshotLedger(path.join(P.forced, 'ledger.json'));
      else if (!ledgerTaken) await snapshotLedger(path.join(P.out, 'ledger.json'));
    }
    stopTree(ecProc);
    stopTree(eoProc);
    stopTree(apiProc);
    if (serve) await serve.stop().catch(() => undefined);
    // PH-6 R-UI (V123-V125, V72): keep the record (resources, tenant ids) before the teardown removes it.
    if (fs.existsSync(P.registryRecord)) fs.copyFileSync(P.registryRecord, P.registryRecordSnapshot);
    if (registry) await teardownEphemeralSimTenant(registry, slug).catch(() => undefined);
    fs.rmSync(path.dirname(simCertPath(P.out, slug)), { recursive: true, force: true }); // this run's throwaway PFX
  }

  const ao = defs.find((d) => d.id === 'AO')!;
  await execStep(ao);

  // FIN-29 (SP-11, V101): the leak scan, after every server stopped (their files are flushed) and while the run's secrets
  // are still in memory. Counts only; never a value.
  try {
    const scan = scanForSecrets({ secrets: runSecrets.map, roots: runScanRoots({ out: P.out, pl: P.pl, slug }), relTo: P.ws, exclude: (f) => path.resolve(f) === path.join(P.out, FIN29_FILES.secretScan) });
    fs.writeFileSync(path.join(P.out, FIN29_FILES.secretScan), JSON.stringify(scan, null, 2));
    const hits = scan.secrets.filter((x) => x.hits > 0);
    log(`leak scan (V101): ${scan.secrets.length} secret(s) over ${scan.roots.reduce((n, r) => n + r.files, 0)} file(s): ${hits.length ? `LEAK ${hits.map((x) => `${x.name} x${x.hits}`).join(', ')}` : '0 hits'}`);
  } catch (err) {
    log(`leak scan (V101) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const id of REQUIRED_STEPS) {
    const r = row(id);
    if (r.rc !== 0 && !failures.some((f) => f.startsWith(`${id}:`))) failures.push(`${id}: ${r.status === 'not-run' ? 'not run' : r.detail ?? `rc ${r.rc}`}`);
  }
  const cmp = comparison as MusterE2eComparison | null;
  if (!cmp) failures.push('EX: comparison not run');
  else if (!cmp.pass) {
    if (!cmp.facts.pass) failures.push(`EX facts: ${cmp.facts.rows.filter((x) => !x.pass).map((x) => `${x.id} expected ${x.expected} got ${x.actual ?? 'none'}`).join(', ')}`);
    if (!cmp.state.pass) failures.push(`EX state: ${cmp.state.assertions.filter((a) => a.result !== 'pass').map((a) => a.check).join('; ')}`);
    if (!cmp.ledger.pass) failures.push(`EX ledger: ${cmp.ledger.rows.filter((x) => !x.pass).map((x) => `${x.check} (${x.actual})`).join('; ')}`);
  }
  const status = failures.length === 0 ? 'PASS' : 'FAIL';
  const rec = buildRecord(status);
  fs.writeFileSync(P.recordFile, JSON.stringify(rec, null, 2));
  log(`muster-e2e ${status}: ${sc.scenario_id}${failures.length ? ` (${failures.length} failure(s))` : ''}; record ${rel(P.recordFile)}`);
  for (const f of failures) log(`  - ${f}`);
  if (rec.ao_coverage) log(`AO coverage (V26): ${rec.ao_coverage.pass ? 'PASS' : 'FAIL'}${rec.ao_coverage.reasons.length ? ` (${rec.ao_coverage.reasons.join('; ')})` : ''}`);
  return rec;
}
