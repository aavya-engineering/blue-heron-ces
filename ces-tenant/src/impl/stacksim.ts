// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * `StacksimModeController` + `TenantLaunchContextProvider` implementation --
 * behavior-preserving port of `enableStacksimMode()`
 * (`ces-stamper/src/core/StacksimMode.ts:103-131`), with the env bundle also
 * exposed as DATA (`getSimLaunchEnv()`) for external launchers (ces-tester's
 * `stamper-launcher`), per `launch-context.ts`'s contract.
 *
 * M1 mock-seam (acceptance gate 3): `queryPsHomeModules` -- the private
 * function that spawns a real `powershell.exe` to read `$PSHOME`
 * (`StacksimMode.ts:56-72`) -- is injected via the constructor, so the
 * env-mutation SUCCESS path is testable without a live PowerShell
 * round-trip. This is the exact seam the M0 record's
 * untestable-without-source-change note asked for.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConsumerIdentity } from '../consumer.js';
import type { SimLaunchEnv, TenantLaunchContextProvider } from '../launch-context.js';
import type { TenantKind, TenantRegistryLifecycle } from '../registry.js';
import type { StacksimModeController } from '../session-surface.js';
import type { TenantActivityRecorder } from '../status-surface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Sibling tenant-stacksim checkout, same relative convention as
 * `StacksimMode.ts:41` (package root is two levels up from src/impl or
 * dist/impl; tenant-stacksim is the package's sibling).
 */
const DEFAULT_STACKSIM_ROOT = path.resolve(__dirname, '..', '..', '..', 'tenant-stacksim');

/** Verbatim from `StacksimMode.ts:43`. */
export const DEFAULT_STACKSIM_SERVER_URL = 'http://127.0.0.1:4390';

/** Port of `StacksimMode.ts:45-54` -- Windows exposes PATH/PSModulePath under inconsistently-cased keys; dedup so the winner is never arbitrary. */
function deleteEnvKeyCaseInsensitive(env: NodeJS.ProcessEnv, name: string): string | undefined {
  let existing: string | undefined;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      if (env[key] !== undefined) existing = env[key];
      delete env[key];
    }
  }
  return existing;
}

/** Non-mutating case-insensitive lookup (for computing the bundle as data without touching the source env). */
function readEnvKeyCaseInsensitive(env: NodeJS.ProcessEnv, name: string): string | undefined {
  let found: string | undefined;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === name.toLowerCase() && env[key] !== undefined) {
      found = env[key];
    }
  }
  return found;
}

/** Port of `queryPsHomeModules()` (`StacksimMode.ts:56-72`) -- the default (real) implementation behind the injectable seam. */
function defaultQueryPsHomeModules(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output $PSHOME']);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to query $PSHOME (exit ${code}): ${stderr}`));
        return;
      }
      resolve(path.join(stdout.trim(), 'Modules'));
    });
  });
}

export interface StacksimEnvironmentOptions {
  /** tenant-stacksim checkout root. Default: `STACKSIM_ROOT` env, else the sibling-checkout convention (`StacksimMode.ts:41,104`). */
  stacksimRoot?: string;
  /** The environment to read from / mutate. Default: `process.env`. Injectable so tests never touch the real process environment. */
  env?: NodeJS.ProcessEnv;
  /** `$PSHOME\Modules` query seam (gate 3). Default spawns a real `powershell.exe` (`StacksimMode.ts:56-72`). */
  queryPsHomeModules?: () => Promise<string>;
  /** Fetch used by the best-effort sim-server health check (`warnIfSimUnreachable()`, `StacksimMode.ts:74-95`). Default: global fetch. */
  fetchFn?: typeof fetch;
  /** Optional registry: when provided, `getSimLaunchEnv()` verifies the slug resolves to a `kind: 'sim'` record before handing out the bundle. */
  registry?: TenantRegistryLifecycle;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;

  // ---- RATIFIED AMENDMENT (founder, 2026-07-10) — caller identity + status surface ----

  /**
   * Construction-time caller identity for `getSimLaunchEnv()` requests
   * without a per-request `consumer` override. INVARIANT (`consumer.ts`):
   * missing both is logged in library mode (warned through `logger`,
   * recorded as `consumer: null`); service mode rejects.
   */
  consumer?: ConsumerIdentity;

  /** Activity recorder (append-only ledger) — e.g. `InProcessTenantStatus`. When absent, no activity is recorded. */
  activity?: TenantActivityRecorder;
}

export class StacksimEnvironment implements StacksimModeController, TenantLaunchContextProvider {
  private readonly env: NodeJS.ProcessEnv;
  private readonly queryPsHomeModulesFn: () => Promise<string>;
  private readonly fetchFn: typeof fetch;
  private readonly registry?: TenantRegistryLifecycle;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly stacksimRootOverride?: string;
  private readonly defaultConsumer?: ConsumerIdentity;
  private readonly activity?: TenantActivityRecorder;

  constructor(options: StacksimEnvironmentOptions = {}) {
    this.env = options.env ?? process.env;
    this.stacksimRootOverride = options.stacksimRoot;
    this.queryPsHomeModulesFn = options.queryPsHomeModules ?? defaultQueryPsHomeModules;
    this.fetchFn = options.fetchFn ?? fetch;
    this.registry = options.registry;
    this.logger = options.logger ?? console;
    this.defaultConsumer = options.consumer;
    this.activity = options.activity;
  }

  /**
   * Port of `enableStacksimMode()` (`StacksimMode.ts:103-131`): mutates the
   * (injected) env so every PowerShell process spawned afterwards resolves
   * cmdlets against tenant-stacksim. Must run before the first session
   * spawn.
   */
  async enableStacksimMode(serverUrl?: string): Promise<void> {
    const { psmodulesDir, azShimDir } = this.resolveStacksimDirs();
    const psHomeModules = await this.queryPsHomeModulesFn();

    deleteEnvKeyCaseInsensitive(this.env, 'PSModulePath');
    this.env.PSModulePath = `${psmodulesDir};${psHomeModules}`;

    const existingPath = deleteEnvKeyCaseInsensitive(this.env, 'Path');
    this.env.Path = `${azShimDir};${existingPath ?? ''}`;

    const url = serverUrl ?? this.env.STACKSIM_SERVER_URL ?? DEFAULT_STACKSIM_SERVER_URL;
    this.env.STACKSIM_SERVER_URL = url;

    this.logger.log('[StacksimMode] STACKSIM MODE ON -- all PowerShell sessions resolve against the tenant simulator');
    this.logger.log(`[StacksimMode]   PSModulePath = ${this.env.PSModulePath}`);
    this.logger.log(`[StacksimMode]   az shim      = ${azShimDir}`);
    this.logger.log(`[StacksimMode]   sim server   = ${url}`);
    await this.warnIfSimUnreachable(url);
  }

  /**
   * `TenantLaunchContextProvider.getSimLaunchEnv()`: the same three values
   * `enableStacksimMode()` computes (`StacksimMode.ts:118-125`), returned as
   * DATA without mutating anything. Refuses non-sim requests -- handing this
   * bundle to a live tenant's launcher would silently redirect real
   * Microsoft-endpoint traffic through the sim shim (the A9-class hazard the
   * `kind` discriminator exists to prevent).
   *
   * AMENDMENT 2026-07-10: carries the caller's `consumer` identity and
   * records an append-only activity entry per request.
   */
  async getSimLaunchEnv(tenantSlug: string, kind: TenantKind, consumer?: ConsumerIdentity): Promise<SimLaunchEnv> {
    const identity = consumer ?? this.defaultConsumer ?? null;
    if (identity === null) {
      this.logger.warn(
        '[StacksimEnvironment] getSimLaunchEnv request without consumer identity (module/purpose) -- logged in library mode; service mode rejects (ratified amendment 2026-07-10).',
      );
    }
    const record = (outcome: 'ok' | 'error', detail?: string): void => {
      this.activity?.recordActivity({
        consumer: identity,
        operation: 'getSimLaunchEnv',
        tenantSlug,
        outcome,
        ...(detail !== undefined ? { detail } : {}),
      });
    };
    try {
      const bundle = await this.getSimLaunchEnvCore(tenantSlug, kind);
      record('ok');
      return bundle;
    } catch (err) {
      record('error', (err instanceof Error ? err.message : String(err)).substring(0, 300));
      throw err;
    }
  }

  /** The unamended `getSimLaunchEnv` behavior (verbatim M1 port). */
  private async getSimLaunchEnvCore(tenantSlug: string, kind: TenantKind): Promise<SimLaunchEnv> {
    if (kind !== 'sim') {
      throw new Error(
        `[StacksimEnvironment] refusing sim launch env for "${tenantSlug}": kind is "${kind}", not "sim".`,
      );
    }
    if (this.registry) {
      const record = await this.registry.get(tenantSlug);
      if (!record) {
        throw new Error(`[StacksimEnvironment] tenant "${tenantSlug}" not found in registry.`);
      }
      if (record.kind !== 'sim') {
        throw new Error(
          `[StacksimEnvironment] refusing sim launch env for "${tenantSlug}": registry record is kind "${record.kind}".`,
        );
      }
    }

    const { psmodulesDir, azShimDir } = this.resolveStacksimDirs();
    const psHomeModules = await this.queryPsHomeModulesFn();
    const existingPath = readEnvKeyCaseInsensitive(this.env, 'Path');
    const serverUrl = this.env.STACKSIM_SERVER_URL ?? DEFAULT_STACKSIM_SERVER_URL;

    return {
      psModulePath: `${psmodulesDir};${psHomeModules}`,
      path: `${azShimDir};${existingPath ?? ''}`,
      stacksimServerUrl: serverUrl,
    };
  }

  /** Root/dir resolution + module-tree guard, port of `StacksimMode.ts:104-114` (same error message shape). */
  private resolveStacksimDirs(): { psmodulesDir: string; azShimDir: string } {
    const stacksimRoot = this.stacksimRootOverride ?? this.env.STACKSIM_ROOT ?? DEFAULT_STACKSIM_ROOT;
    const psmodulesDir = path.join(stacksimRoot, 'psmodules');
    const azShimDir = path.join(stacksimRoot, 'azshim');

    if (!fs.existsSync(path.join(psmodulesDir, 'Microsoft.Graph.Authentication'))) {
      throw new Error(
        `[StacksimMode] fake module tree not found at ${psmodulesDir}.\n` +
          `Set STACKSIM_ROOT to your tenant-stacksim checkout, or generate the modules there:\n` +
          `  cd tenant-stacksim && npm run build && node dist/src/codegen/generatePsModule.js psmodules`,
      );
    }
    return { psmodulesDir, azShimDir };
  }

  /** Port of `warnIfSimUnreachable()` (`StacksimMode.ts:74-95`) -- best-effort, warns but never fails. */
  private async warnIfSimUnreachable(serverUrl: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await this.fetchFn(`${serverUrl}/ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.logger.log(`[StacksimMode] sim server reachable at ${serverUrl}`);
    } catch {
      this.logger.warn(
        `[StacksimMode] WARNING: no sim server responding at ${serverUrl}.\n` +
          `[StacksimMode] Every Get-/Set- cmdlet will fail until it is up. Start it with:\n` +
          `[StacksimMode]   cd tenant-stacksim && node bin/stacksim.mjs serve m365_azure`,
      );
    }
  }
}
