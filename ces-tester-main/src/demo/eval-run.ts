// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-2 M2/M3/M5 (founder-directed 2026-07-28) — the evaluation-mode demo
 * leg. Seeds a tenant configuration (docs/demo/EVAL-CONFIGS.md's 5 ground-
 * truth configs), drives Muster's DISCOVERY-1 executor (`mu discovery
 * --sim`) against the served sim, schema-validates the readiness-result,
 * proves the walk read-only via the sim ledger, and diffs the observed
 * `derived_posture` per control against ground truth.
 *
 * Self-gating + graceful, mirroring eo-leg.ts: an absent muster discovery
 * CLI or readiness-result schema degrades to an honest `available:false`
 * rather than a crash. Once engaged (both present), any live failure is
 * reported as `available:true, pass:false` with `error` set — never thrown.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import { runScenario, tenantRootFor } from '../stacksim-client/cli.js';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { waitUntilReady } from '../stacksim-client/ready-check.js';
import { queryLedger, DEFAULT_STACKSIM_SERVER_URL } from '../stacksim-client/http.js';
import type { StacksimSeedBlock } from '../stacksim-client/types.js';
import { WINDOWS_LIBUV_TEARDOWN_EXIT } from './e2e-run.js';

const _require = createRequire(import.meta.url);

/** The eval config file wrapper format (scenarios/eval/*.json) — deliberately
 * NOT the full ces-tester ScenarioFile shape (schemas/scenario.schema.json):
 * this is a small, purpose-built format for the 5 ground-truth tenant
 * configs (docs/demo/EVAL-CONFIGS.md), not a general scenario run. */
export interface EvalConfigFile {
  config_id: string;
  description: string;
  stacksim_seed: StacksimSeedBlock;
  expected_discovery: Record<string, 'met' | 'unknown'>;
}

export interface PostureMismatch {
  readonly control: string;
  readonly expected: string;
  readonly actual: string;
}

export interface DiffPosturesResult {
  readonly matches: readonly string[];
  readonly mismatches: readonly PostureMismatch[];
  readonly pass: boolean;
}

/**
 * Pure diff: every control in `expected` must have a matching observation
 * row whose `derived_posture` equals the expected value. A control with no
 * observation at all diffs as `actual: 'missing'`. `pass` iff there are zero
 * mismatches AND every expected control was found (matches.length ===
 * Object.keys(expected).length is implied by mismatches being empty).
 */
export function diffPostures(
  expected: Record<string, string>,
  observations: ReadonlyArray<{ control_id: string; derived_posture: string }>,
): DiffPosturesResult {
  const byControl = new Map(observations.map((o) => [o.control_id, o.derived_posture]));
  const matches: string[] = [];
  const mismatches: PostureMismatch[] = [];
  for (const [control, exp] of Object.entries(expected)) {
    const actual = byControl.get(control);
    if (actual === undefined) {
      mismatches.push({ control, expected: exp, actual: 'missing' });
    } else if (actual !== exp) {
      mismatches.push({ control, expected: exp, actual });
    } else {
      matches.push(control);
    }
  }
  return { matches, mismatches, pass: mismatches.length === 0 };
}

/** Loose runtime validity check for a parsed eval config file — enough to
 * fail loud on a malformed file, not a full schema (the wrapper is small and
 * purpose-built; see EvalConfigFile's header note). */
export function isValidEvalConfigFile(x: unknown): x is EvalConfigFile {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  if (typeof c.config_id !== 'string' || c.config_id.length === 0) return false;
  if (typeof c.description !== 'string') return false;
  if (!c.stacksim_seed || typeof c.stacksim_seed !== 'object') return false;
  if (!c.expected_discovery || typeof c.expected_discovery !== 'object') return false;
  for (const v of Object.values(c.expected_discovery as Record<string, unknown>)) {
    if (v !== 'met' && v !== 'unknown') return false;
  }
  return true;
}

/** Parse + validate one eval config file. Loud failure with the file path in
 * every message, matching scenarioFile.ts's `loadScenarioFile` convention. */
export async function loadEvalConfigFile(filePath: string): Promise<EvalConfigFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`${filePath}: not valid JSON (${e instanceof Error ? e.message : e})`);
  }
  if (!isValidEvalConfigFile(parsed)) {
    throw new Error(
      `${filePath}: not a valid eval config file (config_id/description/stacksim_seed/expected_discovery required; expected_discovery values must be 'met'|'unknown')`,
    );
  }
  return parsed;
}

function musterDiscoveryCliPath(musterRoot: string): string {
  return path.join(musterRoot, 'muster-api', 'dist', 'cli', 'bin.js');
}

function readinessResultSchemaPath(musterRoot: string): string {
  return path.join(musterRoot, 'public', 'schemas', 'readiness-result.schema.json');
}

let compiledReadinessValidator: ValidateFunction | undefined;
let compiledReadinessSchemaPath: string | undefined;

/** Compiles (and caches) the readiness-result.v1 Ajv validator, read as data
 * from the given schema file path — same ajv CJS-interop channel
 * scenarioFile.ts uses (ajv is CJS; NodeNext ESM default-import interop is
 * unreliable). */
function readinessValidator(schemaPath: string): ValidateFunction {
  if (!compiledReadinessValidator || compiledReadinessSchemaPath !== schemaPath) {
    const ajvModule = _require('ajv') as { default?: unknown } & Record<string, unknown>;
    const AjvCtor = (ajvModule.default ?? ajvModule) as new (opts: { strict: boolean }) => {
      compile: (schema: unknown) => ValidateFunction;
    };
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as unknown;
    compiledReadinessValidator = new AjvCtor({ strict: true }).compile(schema);
    compiledReadinessSchemaPath = schemaPath;
  }
  return compiledReadinessValidator;
}

interface SpawnCaptureResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function spawnCapture(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<SpawnCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

async function ledgerWriteCount(serverUrl: string): Promise<number> {
  const [creates, mutates] = await Promise.all([
    queryLedger(serverUrl, { type: 'create' }),
    queryLedger(serverUrl, { type: 'mutate' }),
  ]);
  return creates.length + mutates.length;
}

async function ensureDir(p: string): Promise<string> {
  await fsp.mkdir(p, { recursive: true });
  return p;
}

export interface EvalRunOptions {
  readonly testerRoot: string;
  readonly stacksimRoot: string;
  readonly musterRoot: string; // ces-muster
  readonly stamperRoot: string; // ces-stamper — sibling registry source for STAMPER_REGISTRY_ROOT
  readonly config: EvalConfigFile;
  readonly runId: string;
}

export interface EvalConfigResult {
  readonly configId: string;
  /** false ⇒ self-gated (muster discovery CLI or readiness schema absent);
   * caller shows "unavailable", never crashes. */
  readonly available: boolean;
  readonly pass: boolean;
  readonly schemaValid: boolean;
  readonly schemaErrors?: unknown;
  /** true ⇒ zero ledger create/mutate entries during the discovery walk
   * (the read-only proof). */
  readonly readOnly: boolean;
  readonly ledgerDelta?: number;
  readonly diff?: DiffPosturesResult;
  readonly outPath?: string;
  readonly evidencePath?: string;
  readonly error?: string;
}

interface DiscoveryEnvelope {
  observations?: Array<{ control_id: string; derived_posture: string }>;
}

async function writeEvidence(evidenceDir: string, configId: string, evidence: unknown): Promise<string> {
  await ensureDir(evidenceDir);
  const p = path.join(evidenceDir, `${configId}-evidence.json`);
  await fsp.writeFile(p, JSON.stringify(evidence, null, 2), 'utf8');
  return p;
}

/**
 * Run one eval config end-to-end: seed (stacksim `runScenario`) -> serve
 * slug -> ledger baseline count -> spawn `mu discovery --sim` -> Ajv-validate
 * the readiness-result -> ledger delta assert (read-only proof) ->
 * diffPostures vs the config's expected block -> stop serve -> write
 * per-config evidence to runs/eval/<runId>/.
 */
export async function runEvalConfig(opts: EvalRunOptions): Promise<EvalConfigResult> {
  const { config, testerRoot, stacksimRoot, musterRoot, stamperRoot, runId } = opts;
  const cliPath = musterDiscoveryCliPath(musterRoot);
  const schemaPath = readinessResultSchemaPath(musterRoot);

  if (!fs.existsSync(cliPath) || !fs.existsSync(schemaPath)) {
    return {
      configId: config.config_id,
      available: false,
      pass: false,
      schemaValid: false,
      readOnly: false,
      error: `muster discovery CLI or readiness-result schema not available (checked ${cliPath}, ${schemaPath})`,
    };
  }

  const slug = config.config_id;
  const evidenceDir = path.join(testerRoot, 'runs', 'eval', runId);
  const outPath = path.join(evidenceDir, `${config.config_id}.discovery-result.json`);
  const scenariosDir = path.join(evidenceDir, 'scenarios');

  let serveHandle: ServeHandle | undefined;
  try {
    // Best-effort: drop a stale lock from a prior crashed run of THIS slug
    // (reuses reset.ts's remove-lock convention) — `runScenario` itself
    // wipes+reseeds the tenant root fresh, so this is only a safety net.
    await fsp.rm(path.join(tenantRootFor(stacksimRoot, slug), '.stacksim.lock'), { force: true }).catch(() => undefined);

    await runScenario({ stacksimRoot }, scenariosDir, config.config_id, config.stacksim_seed, config.description);

    serveHandle = await startServe({
      stacksimRoot,
      stance: config.stacksim_seed.stance,
      slug,
      logPath: path.join(await ensureDir(evidenceDir), 'stacksim-serve.log'),
    });
    // authorizationPolicy is a fixed singleton (always seeded, never zeroed
    // by these configs' countOverrides) — a safe ready-check target that
    // stays non-empty even for T1's all-zero-count tenant.
    await waitUntilReady({
      serverUrl: DEFAULT_STACKSIM_SERVER_URL,
      method: 'GET',
      uri: '/v1.0/policies/authorizationPolicy',
    });

    const baselineWrites = await ledgerWriteCount(DEFAULT_STACKSIM_SERVER_URL);

    const registryRoot = path.resolve(stamperRoot, 'src', 'registry');
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env, STAMPER_REGISTRY_ROOT: registryRoot };
    const cliResult = await spawnCapture(
      'node',
      [cliPath, 'discovery', '--sim', '--slug', slug, '--out', outPath],
      musterRoot,
      spawnEnv,
    );

    // Artifact-first evaluation: judge the RESULT FILE (schema validation) +
    // the LEDGER (read-only proof), not the raw exit code. Rationale: the mu
    // CLI writes+validates its output, then Node's Windows teardown can abort
    // with the known libuv assertion (STATUS_STACK_BUFFER_OVERRUN 0xC0000409,
    // `!(handle->flags & UV_HANDLE_CLOSING)`) AFTER the artifact is complete —
    // an exit-code-gated judge discarded perfectly valid runs. A missing or
    // schema-invalid file still fails; a genuinely failed CLI (loud-fail JSON,
    // no artifact) still fails.
    let envelope: DiscoveryEnvelope = {};
    let schemaValid = false;
    let schemaErrors: unknown;
    try {
      const raw = JSON.parse(await fsp.readFile(outPath, 'utf8')) as unknown;
      const validate = readinessValidator(schemaPath);
      schemaValid = !!validate(raw);
      schemaErrors = validate.errors ?? undefined;
      envelope = raw as DiscoveryEnvelope;
    } catch (e) {
      schemaErrors = e instanceof Error ? e.message : String(e);
    }

    const afterWrites = await ledgerWriteCount(DEFAULT_STACKSIM_SERVER_URL);
    const ledgerDelta = afterWrites - baselineWrites;
    const readOnly = ledgerDelta === 0;

    const diff = diffPostures(config.expected_discovery, envelope.observations ?? []);
    const cleanOrKnownTeardownCrash =
      cliResult.exitCode === 0 || cliResult.exitCode === WINDOWS_LIBUV_TEARDOWN_EXIT;
    const pass = cleanOrKnownTeardownCrash && schemaValid && readOnly && diff.pass;

    const evidence = {
      configId: config.config_id,
      description: config.description,
      slug,
      cliExitCode: cliResult.exitCode,
      cliStdout: cliResult.stdout,
      cliStderr: cliResult.stderr,
      schemaValid,
      schemaErrors,
      readOnly,
      ledgerDelta,
      diff,
      pass,
      outPath,
    };
    const evidencePath = await writeEvidence(evidenceDir, config.config_id, evidence);

    return {
      configId: config.config_id,
      available: true,
      pass,
      schemaValid,
      schemaErrors,
      readOnly,
      ledgerDelta,
      diff,
      outPath,
      evidencePath,
      error:
        cliResult.exitCode !== 0
          ? `mu discovery exited ${cliResult.exitCode}: ${cliResult.stderr.trim() || cliResult.stdout.trim()}`
          : undefined,
    };
  } catch (err) {
    return {
      configId: config.config_id,
      available: true,
      pass: false,
      schemaValid: false,
      readOnly: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (serveHandle) await serveHandle.stop();
  }
}
