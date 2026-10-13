// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Flow-through FX-TE1 (X3 / AE-R6): AdminOps -> real ces.db -> EvidenceOps.
 *
 * This module is the AO half of the cross-module proof. It stands up a
 * sim-only environment and drives ces-ao's PRODUCTION HTTP surface
 * (`ao gui` from ces-ao/dist, `POST /api/execute/:commandId`) so AO's real
 * executor writes real rows into a temp `CES_PIPELINE_ROOT/ces.db`. The EO
 * half (tests/flow/ao-eo.flow.test.ts) then reads that same file back through
 * ces-eo's production reader and routes. No row is hand-built anywhere.
 *
 * Sim-only by construction:
 *  - tenant-stacksim is materialized and served on loopback (`stacksim serve`);
 *  - both tenant records are `kind:'sim'` records created through the
 *    ces-tenant registry in a TEMP registry root (never `~/.ces/tenants`);
 *  - the AO child env is ces-tenant's `getSimLaunchEnv` (stacksim psmodules
 *    first, loopback STACKSIM_SERVER_URL) and is checked by
 *    `simOnlyEnvViolations` before AO is spawned;
 *  - `CES_AO_SIM_ONLY=1` (AO's lockdown: every non-sim record refused) and
 *    `CES_AO_ALLOW_LIVE` is DELETED in every casing.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runScenario } from '../stacksim-client/cli.js';
import { startServe } from '../stacksim-client/serve-lifecycle.js';
import { waitUntilReady } from '../stacksim-client/ready-check.js';
import { DEFAULT_STACKSIM_SERVER_URL } from '../stacksim-client/http.js';
import { createTenantRegistry, createEphemeralSimTenant, getSimLaunchEnv } from '../tenant-registry/index.js';
import { buildGuiChildEnv, startAoGui, type GuiServerHandle } from '../demo/gui-servers.js';
import { patchSimTenantRecord, simRecordPath } from '../demo/sim-tenant-record.js';
import { simOnlyEnvViolations } from './sim-only-guard.js';
import { mergeSimLaunchEnv } from '../stamper-launcher/env.js';

/** ces-tenant's deterministic sim tenant id for a slug (`sim-tenant-<slug>`). */
export function simTenantIdFor(slug: string): string {
  return `sim-tenant-${slug}`;
}

function deleteKeyCaseInsensitive(env: NodeJS.ProcessEnv, name: string): void {
  for (const k of Object.keys(env)) if (k.toLowerCase() === name.toLowerCase()) delete env[k];
}

/**
 * Child env for the AO server: the GUI helper's env (sim launch env merged,
 * FD-5 shim appended, run-scoped roots, no CES_AO_AUTH_TOKEN) plus AO's own
 * sim-only lockdown. Pure.
 */
export function buildAoFlowChildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  deleteKeyCaseInsensitive(env, 'CES_AO_ALLOW_LIVE');
  env.CES_AO_SIM_ONLY = '1';
  return env;
}

export interface AoFlowEnvOptions {
  cesRoot: string;
  testerRoot: string;
  /** Run directory (temp): pipeline root, registry root, logs. */
  workDir: string;
  slugA: string;
  slugB: string;
  aoPort: number;
  log?: (line: string) => void;
}

export interface AoFlowEnv {
  workDir: string;
  pipelineRoot: string;
  registryRoot: string;
  dbPath: string;
  simUrl: string;
  aoBaseUrl: string;
  tenantIdA: string;
  tenantIdB: string;
  recordPathA: string;
  stop: () => Promise<void>;
}

export interface SimTenantsOptions {
  cesRoot: string;
  testerRoot: string;
  workDir: string;
  /** First slug is the one stacksim materializes and serves. */
  slugs: string[];
  seed?: { stance: 'm365_only' | 'm365_sentinel' | 'm365_azure'; countOverrides: Record<string, number>; steps: unknown[] };
  log?: (line: string) => void;
}

export interface SimTenants {
  stacksimRoot: string;
  shimRoot: string;
  pipelineRoot: string;
  registryRoot: string;
  simUrl: string;
  recordPaths: Record<string, string>;
  simLaunchEnv: Awaited<ReturnType<typeof getSimLaunchEnv>>;
  stop: () => Promise<void>;
}

/**
 * Materialize + serve tenant-stacksim for `slugs[0]` and register every slug
 * as a `kind:'sim'` record in a temp ces-tenant registry under `workDir`.
 * Module servers' LIVE paths require `auth.cert_path` to exist and a
 * non-placeholder thumbprint; stacksim's Connect-* shims never consult the
 * cert store, so a run-scoped placeholder file is used (no cert-store write).
 */
export async function startSimTenants(opts: SimTenantsOptions): Promise<SimTenants> {
  const log = opts.log ?? (() => undefined);
  const stacksimRoot = path.join(opts.cesRoot, 'tenant-stacksim');
  const shimRoot = path.join(opts.testerRoot, 'assets', 'psmodules-shim');
  const pipelineRoot = path.join(opts.workDir, 'pipeline');
  const registryRoot = path.join(opts.workDir, 'tenant-root');
  fs.mkdirSync(pipelineRoot, { recursive: true });
  fs.mkdirSync(registryRoot, { recursive: true });
  const seed = opts.seed ?? { stance: 'm365_azure' as const, countOverrides: {}, steps: [] };
  const served = opts.slugs[0];
  await runScenario(
    { stacksimRoot },
    fs.mkdtempSync(path.join(os.tmpdir(), 'ft-flow-scn-')),
    served,
    seed as any,
    'ces-tester flow-through fix batch (sim only)',
  );

  const registry = createTenantRegistry({ registryRoot, stacksimRoot });
  const certPath = path.join(opts.workDir, 'ft-flow-sim.pfx');
  fs.writeFileSync(certPath, 'ces-tester flow-through sim placeholder (never a real key)');
  const certThumbprint = 'FE1FE1FE1FE1FE1FE1FE1FE1FE1FE1FE1FE1FE1F';
  const recordPaths: Record<string, string> = {};
  for (const slug of opts.slugs) {
    await createEphemeralSimTenant(registry, slug, seed);
    recordPaths[slug] = simRecordPath(registryRoot, slug);
    patchSimTenantRecord(recordPaths[slug], { certPath, certThumbprint });
  }

  const serve = await startServe({
    stacksimRoot,
    stance: seed.stance,
    slug: served,
    logPath: path.join(opts.workDir, 'stacksim-serve.log'),
  });
  try {
    await waitUntilReady({ serverUrl: DEFAULT_STACKSIM_SERVER_URL, method: 'GET', uri: '/v1.0/policies/authorizationPolicy' });
    log(`stacksim serve ready on ${DEFAULT_STACKSIM_SERVER_URL} (slug ${served})`);
    const simLaunchEnv = await getSimLaunchEnv(registry, served, { stacksimRoot });
    return {
      stacksimRoot,
      shimRoot,
      pipelineRoot,
      registryRoot,
      simUrl: DEFAULT_STACKSIM_SERVER_URL,
      recordPaths,
      simLaunchEnv,
      stop: () => serve.stop().catch(() => undefined),
    };
  } catch (err) {
    await serve.stop().catch(() => undefined);
    throw err;
  }
}

/**
 * Child env for a module server on the sim: the GUI helper's env (sim launch
 * env merged, FD-5 presence shim appended, run-scoped roots, no
 * CES_AO_AUTH_TOKEN) — refused unless the sim launch env passes
 * `simOnlyEnvViolations` (first PSModulePath entry is stacksim's, loopback
 * server, no real cloud module reachable) and the only entry added after it is
 * ces-tester's own presence-only Microsoft.Graph manifest (exports nothing).
 */
export function guardedSimChildEnv(sim: SimTenants, extra: { storageRoot?: string } = {}): NodeJS.ProcessEnv {
  const violations = simOnlyEnvViolations(mergeSimLaunchEnv({ simLaunchEnv: sim.simLaunchEnv }), sim.stacksimRoot);
  if (violations.length > 0) throw new Error(`SIM-ONLY guard: refusing to launch: ${violations.join('; ')}`);
  const env = buildGuiChildEnv({
    simLaunchEnv: sim.simLaunchEnv,
    shimRoot: sim.shimRoot,
    tenantRoot: sim.registryRoot,
    pipelineRoot: sim.pipelineRoot,
    storageRoot: extra.storageRoot,
  });
  const base = sim.simLaunchEnv.psModulePath.split(';');
  const added = (env.PSModulePath ?? '').split(';').filter((e) => e && !base.includes(e));
  if (added.some((e) => path.resolve(e) !== path.resolve(sim.shimRoot))) {
    throw new Error(`SIM-ONLY guard: unexpected PSModulePath entries: ${added.join('; ')}`);
  }
  deleteKeyCaseInsensitive(env, 'CES_AO_ALLOW_LIVE');
  return env;
}

/**
 * Materialize + serve stacksim, register two sim tenants in a temp registry,
 * and boot `ao gui` against them. The returned `stop()` tears everything down
 * (the caller owns deleting `workDir` after closing its own DB handles).
 */
export async function startAoFlowEnv(opts: AoFlowEnvOptions): Promise<AoFlowEnv> {
  const log = opts.log ?? (() => undefined);
  const aoRoot = path.join(opts.cesRoot, 'ces-ao');
  const sim = await startSimTenants({
    cesRoot: opts.cesRoot,
    testerRoot: opts.testerRoot,
    workDir: opts.workDir,
    slugs: [opts.slugA, opts.slugB],
    log,
  });
  let ao: GuiServerHandle;
  try {
    const env = buildAoFlowChildEnv(guardedSimChildEnv(sim));
    if (env.CES_AO_ALLOW_LIVE !== undefined) throw new Error('SIM-ONLY guard: CES_AO_ALLOW_LIVE must not be set');
    log(`SIM-ONLY guard: AO env ok (STACKSIM_SERVER_URL=${env.STACKSIM_SERVER_URL}; CES_AO_SIM_ONLY=1; no CES_AO_ALLOW_LIVE)`);
    ao = await startAoGui({
      aoRoot,
      env,
      port: opts.aoPort,
      logPath: path.join(opts.workDir, 'ao-gui.log'),
      readyTimeoutMs: 120_000,
    });
    log(`ao gui ready on ${ao.baseUrl}`);
  } catch (err) {
    await sim.stop();
    throw err;
  }
  const pipelineRoot = sim.pipelineRoot;
  const registryRoot = sim.registryRoot;
  const recordPathA = sim.recordPaths[opts.slugA];
  const serveHandle = { stop: sim.stop };
  const aoHandle = ao;
  return {
    workDir: opts.workDir,
    pipelineRoot,
    registryRoot,
    dbPath: path.join(pipelineRoot, 'ces.db'),
    simUrl: DEFAULT_STACKSIM_SERVER_URL,
    aoBaseUrl: aoHandle.baseUrl,
    tenantIdA: simTenantIdFor(opts.slugA),
    tenantIdB: simTenantIdFor(opts.slugB),
    recordPathA,
    stop: async () => {
      await aoHandle.stop().catch(() => undefined);
      await serveHandle.stop().catch(() => undefined);
    },
  };
}

export interface AoExecuteRequest {
  tenant: string;
  commandId: string;
  dryRun: boolean;
  correlationId: string;
  requestorUPN: string;
  inputs?: Record<string, unknown>;
}

export interface AoExecuteResponse {
  status: number;
  body: any;
}

/** One call to AO's production execute route. */
export async function aoExecute(baseUrl: string, req: AoExecuteRequest): Promise<AoExecuteResponse> {
  const res = await fetch(`${baseUrl}/api/execute/${encodeURIComponent(req.commandId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant: req.tenant,
      inputs: req.inputs ?? {},
      dryRun: req.dryRun,
      requestorUPN: req.requestorUPN,
      correlationId: req.correlationId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

/**
 * Tenant CMMC posture on the temp registry record (the deny case needs an L1
 * tenant). ces-tenant refuses `cmmc_level` without `cui_boundary` (Case B), so
 * both are written together; `undefined` restores the sim default (exempt,
 * no level). The record is this run's own temp file, never a shared one.
 */
export function setRecordCmmcPosture(recordPath: string, level: 'L1' | 'L2' | undefined): void {
  const raw = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
  if (level) {
    raw.cmmc_level = level;
    raw.cui_boundary = raw.cui_boundary ?? { tag_key: 'CUI', tag_value: 'true' };
    raw.cmmc_migration_exempt = false;
  } else {
    delete raw.cmmc_level;
    delete raw.cui_boundary;
    delete raw.cmmc_migration_exempt;
  }
  fs.writeFileSync(recordPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
}
