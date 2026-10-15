// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4 (2026-09-27): AO-local stacksim harness for the opt-in integration suites.
//
// Stands up tenant-stacksim IN-PROCESS from its compiled dist (read/run only —
// nothing is written inside ../tenant-stacksim): the seed store, ledger and
// evidence hold live in a temp tenantRoot; the HTTP server listens on an
// ephemeral loopback port. A `kind:'sim'` tenant record is written to a TEMP
// ces-tenant registry root from stacksim's own `buildSimTenantConfig` (so the
// record carries the stacksim-generated `resources` block), with a run-scoped
// placeholder cert file (stacksim's Connect-* shims never consult a cert store).
//
// Sim-only by construction:
//  - STACKSIM_SERVER_URL is loopback; PSModulePath/Path get the stacksim shims
//    FIRST via AO's production entry `requestAoStacksimMode` (ces-tenant's
//    StacksimEnvironment), so `isStacksimModeActive(process.env)` is true;
//  - CES_AO_SIM_ONLY=1 and CES_AO_ALLOW_LIVE is deleted (every casing);
//  - the harness refuses to start if the sim-mode predicate is false.
//
// Opt-in: suites gate on `AO_STACKSIM_IT=1` (Windows only — every AO execution
// path spawns powershell.exe). `npm test` without it skips them loudly.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AO_ROOT = path.resolve(__dirname, '..', '..');
export const STACKSIM_ROOT = path.resolve(AO_ROOT, '..', 'tenant-stacksim');

export const STACKSIM_IT_ENABLED =
  process.env.AO_STACKSIM_IT === '1' && process.platform === 'win32';

export function logSkipIfDisabled(suite: string): void {
  if (!STACKSIM_IT_ENABLED) {
    // eslint-disable-next-line no-console
    console.log(`[${suite}] SKIPPED: set AO_STACKSIM_IT=1 on Windows (needs PowerShell + ../tenant-stacksim/dist)`);
  }
}

type Stance = 'm365_only' | 'm365_sentinel' | 'm365_azure';

export interface AoStacksimEnv {
  slug: string;
  port: number;
  simUrl: string;
  workDir: string;
  registryRoot: string;
  pipelineRoot: string;
  recordPath: string;
  /** stacksim's ObjectStore (read-only use in tests: collection snapshots). */
  store: any;
  /** stacksim's ledger (read-only use in tests). */
  ledger: any;
  stop: () => Promise<void>;
}

const SAVED_KEYS = [
  'CES_TENANT_ROOT',
  'CES_PIPELINE_ROOT',
  'CES_AO_SIM_ONLY',
  'STACKSIM_SERVER_URL',
  'PSModulePath',
  'Path',
  'CES_CONFIG_PATH',
];

function deleteKeyCaseInsensitive(env: NodeJS.ProcessEnv, name: string): void {
  for (const k of Object.keys(env)) if (k.toLowerCase() === name.toLowerCase()) delete env[k];
}

function getCaseInsensitive(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const k = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
  return k ? env[k] : undefined;
}

async function importStacksim(rel: string): Promise<any> {
  const p = path.join(STACKSIM_ROOT, 'dist', 'src', rel);
  if (!fs.existsSync(p)) throw new Error(`[stacksimHarness] tenant-stacksim dist missing: ${p} (build tenant-stacksim first)`);
  return import(pathToFileURL(p).href);
}

/**
 * Seed + serve stacksim for `slug`, register the sim record, arm sim mode in
 * THIS process. Call `stop()` in afterAll (restores env, stops the server).
 */
export async function startAoStacksim(opts: {
  slug: string;
  stance?: Stance;
  /** Extra keys merged into the tenant record's `resources` block (never over existing keys). */
  extraResources?: Record<string, string>;
}): Promise<AoStacksimEnv> {
  const stance: Stance = opts.stance ?? 'm365_azure';
  const saved: Record<string, string | undefined> = {};
  for (const k of SAVED_KEYS) saved[k] = getCaseInsensitive(process.env, k);
  const savedAllowLive = getCaseInsensitive(process.env, 'CES_AO_ALLOW_LIVE');

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-w4-sim-'));
  const tenantRoot = path.join(workDir, 'stacksim-tenant');
  const registryRoot = path.join(workDir, 'tenant-registry');
  const pipelineRoot = path.join(workDir, 'pipeline');
  fs.mkdirSync(pipelineRoot, { recursive: true });
  const profilesDir = path.join(STACKSIM_ROOT, 'profiles');

  const { seedTenant } = await importStacksim('cli/commands/seed.js');
  const { startServe } = await importStacksim('cli/commands/serve.js');
  const { buildSimTenantConfig } = await importStacksim('config/SimTenantConfig.js');

  await seedTenant({ stance, slug: opts.slug, profilesDir, tenantRoot });
  const serve = await startServe({ stance, slug: opts.slug, port: 0, host: '127.0.0.1', profilesDir, tenantRoot });
  const simUrl = `http://127.0.0.1:${serve.port}`;

  // Tenant record: stacksim's own emitted tenant object (with resources), kind 'sim'.
  const cfg = buildSimTenantConfig({ slug: opts.slug, tenantStance: stance, port: serve.port });
  const certPath = path.join(workDir, 'ao-w4-sim.pfx');
  fs.writeFileSync(certPath, 'ces-ao W4 sim placeholder (never a real key)');
  cfg.auth = { ...cfg.auth, cert_path: certPath, cert_thumbprint: 'A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0' };
  cfg.resources = { ...(opts.extraResources ?? {}), ...(cfg.resources ?? {}) };
  const raw = { ...cfg, kind: 'sim' };
  const recordPath = path.join(registryRoot, 'sim', `${opts.slug}.json`);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');

  // Env: temp roots, sim-only lockdown, no live opt-in.
  process.env.CES_TENANT_ROOT = registryRoot;
  process.env.CES_PIPELINE_ROOT = pipelineRoot;
  delete process.env.CES_CONFIG_PATH;
  process.env.CES_AO_SIM_ONLY = '1';
  deleteKeyCaseInsensitive(process.env, 'CES_AO_ALLOW_LIVE');

  const { resetTenantRegistryForTests, requestAoStacksimMode } = await import('../../src/tenant/aoTenants.js');
  resetTenantRegistryForTests();
  await requestAoStacksimMode(simUrl, {
    preferredSlug: opts.slug,
    stacksimRoot: STACKSIM_ROOT,
    env: process.env,
  });
  const { isStacksimModeActive } = await import('../../src/execution/SimOnlyRail.js');
  if (!isStacksimModeActive(process.env)) {
    await serve.stop();
    throw new Error('[stacksimHarness] SIM-ONLY guard: stacksim mode predicate is false after arming; refusing to run');
  }

  const stop = async () => {
    await serve.stop().catch(() => undefined);
    for (const k of SAVED_KEYS) {
      deleteKeyCaseInsensitive(process.env, k);
      if (saved[k] !== undefined) process.env[k] = saved[k];
    }
    if (savedAllowLive !== undefined) process.env.CES_AO_ALLOW_LIVE = savedAllowLive;
    resetTenantRegistryForTests();
  };

  return {
    slug: opts.slug,
    port: serve.port,
    simUrl,
    workDir,
    registryRoot,
    pipelineRoot,
    recordPath,
    store: serve.store,
    ledger: serve.ledger,
    stop,
  };
}
