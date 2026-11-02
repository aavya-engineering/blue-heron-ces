// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProfile, resolveProfilePath } from '../../profiles/ProfileLoader.js';
import { SeedEngine } from '../../seed/SeedEngine.js';
import { startServe, type ServeHandle } from './serve.js';
import { parseFlags } from '../index.js';

/**
 * M6 - End-to-end DOC verification (PLAN.md Milestone Ladder row M6; Goal
 * Document - G-STACKSIM-1). `stacksim verify-doc` seeds a fresh m365_azure
 * sim tenant, starts the server, then runs all 4 DOC checks in one process:
 *   1. Stamper's baseline-stamping path (IA.L2-3.5.3.fido2-enable - the real
 *      Stamper command identified at M4; see IMPLEMENTATION_LOG.md M4
 *      Deviations for why this, not a literal authorizationPolicy mutation
 *      from Stamper, satisfies DOC check 1).
 *   2. EO's real, unmodified ComplianceSignalFetcher.fetchAuthorizationPolicy()
 *      (ces-eo/src/eo/ingestion/ComplianceSignalFetcher.ts), invoked via a
 *      spawned tsx process that imports ces-eo's real SessionManager.ts and
 *      ComplianceSignalFetcher.ts by their real source paths - zero code
 *      edits to ces-eo, per the hard constraint (VAULT.md / PLAN.md
 *      Constraints).
 *   3. AO's A-18 command (TemplateRegistry.ts:59-62), verbatim.
 *   4. This CLI command itself IS check 4 ("reproducible via one CLI command
 *      that ... exits 0 only if all pass") - `verifyDoc()`'s overall
 *      `passed` flag and `runVerifyDoc()`'s process.exitCode wire that up.
 *
 * Checks 1 and 3 drive real powershell.exe with the same $env:PSModulePath
 * replacement M2-M4 established (command text transcribed verbatim from the
 * real registries, per M4's precedent). Check 2 drives real ces-eo
 * TypeScript code directly - PSModulePath is set on the spawned tsx
 * process's own env so that ces-eo's SessionManager.ts (which spawns
 * powershell.exe running the real, unmodified ces-shared/scripts/
 * session-host.ps1 with no explicit env override) inherits the shadowed
 * module path.
 */

const GRAPH_MODULE_IMPORTS = [
  'Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1 -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.Governance -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Users -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.DirectoryManagement -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Groups -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.ConditionalAccess -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.DeviceManagement -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.SignIns -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.Authentication -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Reports -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Domains -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Applications -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.DirectoryObjects -Force -ErrorAction SilentlyContinue',
].join('\n');

/** Runner script executed under tsx (DOC check 2) - imports ces-eo's real,
 *  unmodified source files by absolute path and calls the real
 *  fetchAuthorizationPolicy(). No relative import is used for the ces-eo
 *  files themselves (avoids tenant-stacksim's own tsc ever needing to
 *  resolve/typecheck across the package boundary); CES_EO_ROOT is passed
 *  via env from the spawning process. */
const EO_RUNNER_SCRIPT = `import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const cesEoRoot = process.env.CES_EO_ROOT;
if (!cesEoRoot) {
  throw new Error('CES_EO_ROOT env var is required');
}

const smUrl = pathToFileURL(path.join(cesEoRoot, 'src', 'eo', 'core', 'SessionManager.ts')).href;
const csfUrl = pathToFileURL(path.join(cesEoRoot, 'src', 'eo', 'ingestion', 'ComplianceSignalFetcher.ts')).href;
const psaUrl = pathToFileURL(path.join(cesEoRoot, 'src', 'eo', 'ingestion', 'PowerShellFallbackAdapter.ts')).href;

const { SessionManager } = await import(smUrl);
const { ComplianceSignalFetcher } = await import(csfUrl);
const { PowerShellFallbackAdapter } = await import(psaUrl);

const tenantConfig = {
  tenantSlug: 'stacksim-verify-doc',
  tenantId: 'sim-tenant-verify-doc',
  appId: 'sim-app-verify-doc',
  certPath: 'sim/verify-doc.pfx',
  certThumbprint: 'SIMTHUMBPRINT0000000000000000000000000',
  domain: 'verify-doc.simtenant.onmicrosoft.us',
  endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
};

const sessionManager = new SessionManager(tenantConfig);
const psAdapter = new PowerShellFallbackAdapter(tenantConfig);
const fetcher = new ComplianceSignalFetcher(sessionManager, psAdapter);

try {
  const result = await fetcher.fetchAuthorizationPolicy();
  console.log('EO_RESULT::' + JSON.stringify(result));
} finally {
  await sessionManager.disconnectAll();
}
process.exit(0);
`;

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function extractMarker(stdout: string, marker: string): string | undefined {
  const line = stdout.split('\n').find((l) => l.startsWith(marker));
  return line ? line.slice(marker.length).trim() : undefined;
}

/** Queries the real $PSHOME\Modules path (Core Design (d): retained in the
 *  PSModulePath replacement so PowerShell engine built-ins keep resolving)
 *  rather than hardcoding it, since this value is being computed from Node,
 *  not from inside an already-running PowerShell script as M2-M4 do. */
function getPowerShellHostModulesPath(): Promise<string> {
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

function psModulePathPrelude(psmodulesDir: string, psHomeModules: string): string {
  return `$ErrorActionPreference = 'Stop'\n$env:PSModulePath = '${psmodulesDir}' + ';' + '${psHomeModules}'\n\n${GRAPH_MODULE_IMPORTS}\n`;
}

interface CheckContext {
  tempDir: string;
  psmodulesDir: string;
  psHomeModules: string;
  serverUrl: string;
  store: ServeHandle['store'];
  ledger: ServeHandle['ledger'];
  cesEoRoot: string;
  tsxCliPath: string;
}

export interface DocCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

/** DOC check 1: Stamper's baseline-stamping path (IA.L2-3.5.3.fido2-enable,
 *  cmmc-l2-commands.registry.json:1704, transcribed verbatim - see M4
 *  Deviations for why this control, not a literal authorizationPolicy
 *  mutation, satisfies DOC check 1's "authorization-policy-class control"
 *  wording). */
async function runCheck1Stamper(ctx: CheckContext): Promise<DocCheckResult> {
  const name = "DOC check 1: Stamper's baseline-stamping path (IA.L2-3.5.3.fido2-enable)";
  try {
    const scriptPath = path.join(ctx.tempDir, 'stamper-fido2.ps1');
    const script = `${psModulePathPrelude(ctx.psmodulesDir, ctx.psHomeModules)}
Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2' -Body (@{state='enabled'} | ConvertTo-Json) -ContentType 'application/json' | Out-Null
Write-Output "STAMPER_FIDO2::ok"
`;
    await fs.writeFile(scriptPath, script, 'utf8');
    const env: NodeJS.ProcessEnv = { ...process.env, STACKSIM_SERVER_URL: ctx.serverUrl };
    const result = await runProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      env,
    );
    if (result.exitCode !== 0 || extractMarker(result.stdout, 'STAMPER_FIDO2::') !== 'ok') {
      return {
        name,
        passed: false,
        detail: `script failed (exit ${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      };
    }

    const stored = await ctx.store.read('authenticationMethodsPolicyConfigurations', 'Fido2');
    if (stored?.state !== 'enabled') {
      return { name, passed: false, detail: `store read-back mismatch: ${JSON.stringify(stored)}` };
    }

    return {
      name,
      passed: true,
      detail: 'authenticationMethodsPolicyConfigurations/Fido2.state === "enabled" (mutation visible on re-read)',
    };
  } catch (err) {
    return { name, passed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** DOC check 3: AO's A-18 (TemplateRegistry.ts:59-62, transcribed verbatim).
 *  Mutation must appear both via Get-MgAuditLogDirectoryAudit (same
 *  shadowed session) AND in ledger.jsonl. */
async function runCheck3Ao(ctx: CheckContext): Promise<DocCheckResult> {
  const name = "DOC check 3: AO's A-18 (defaultUserRolePermissions lockdown)";
  try {
    const scriptPath = path.join(ctx.tempDir, 'ao-a18.ps1');
    const script = `${psModulePathPrelude(ctx.psmodulesDir, ctx.psHomeModules)}
Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy' -Body @{ defaultUserRolePermissions=@{ allowedToCreateApps=$false; allowedToCreateSecurityGroups=$false; allowedToCreateTenants=$false } } | Out-Null

$audits = Get-MgAuditLogDirectoryAudit | ConvertTo-Json -Depth 5 -Compress
Write-Output ("AUDITS::" + $audits)
Write-Output "AO_A18::ok"
`;
    await fs.writeFile(scriptPath, script, 'utf8');
    const env: NodeJS.ProcessEnv = { ...process.env, STACKSIM_SERVER_URL: ctx.serverUrl };
    const result = await runProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      env,
    );
    if (result.exitCode !== 0 || extractMarker(result.stdout, 'AO_A18::') !== 'ok') {
      return {
        name,
        passed: false,
        detail: `script failed (exit ${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      };
    }

    const stored = await ctx.store.read('authorizationPolicy', 'authorizationPolicy');
    const storedPerms = (stored?.defaultUserRolePermissions ?? {}) as Record<string, unknown>;
    const expected: Record<string, boolean> = {
      allowedToCreateApps: false,
      allowedToCreateSecurityGroups: false,
      allowedToCreateTenants: false,
    };
    const permsMatch = Object.entries(expected).every(([key, value]) => storedPerms[key] === value);
    if (!permsMatch) {
      return { name, passed: false, detail: `store read-back mismatch: ${JSON.stringify(storedPerms)}` };
    }

    const auditsRaw = extractMarker(result.stdout, 'AUDITS::');
    if (!auditsRaw) {
      return { name, passed: false, detail: `no AUDITS:: marker in stdout: ${result.stdout}` };
    }
    const audits = JSON.parse(auditsRaw) as unknown;
    const auditList = Array.isArray(audits) ? audits : [audits];
    const auditOk = (auditList as Array<{ targetResources?: Array<{ id?: string }> }>).some(
      (a) => a.targetResources?.[0]?.id === 'authorizationPolicy',
    );
    if (!auditOk) {
      return { name, passed: false, detail: `Get-MgAuditLogDirectoryAudit did not show the mutation: ${auditsRaw}` };
    }

    const ledgerEntries = await ctx.ledger.query({ type: 'mutate', objectType: 'authorizationPolicy' });
    if (ledgerEntries.length === 0) {
      return { name, passed: false, detail: 'no ledger.jsonl "mutate" entry for authorizationPolicy' };
    }

    return {
      name,
      passed: true,
      detail: `store + Get-MgAuditLogDirectoryAudit (same session) + ledger.jsonl (${ledgerEntries.length} entr${
        ledgerEntries.length === 1 ? 'y' : 'ies'
      }) all confirm the mutation`,
    };
  } catch (err) {
    return { name, passed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** DOC check 2: EO's real, unmodified ComplianceSignalFetcher.fetchAuthorizationPolicy(). */
async function runCheck2Eo(ctx: CheckContext): Promise<DocCheckResult> {
  const name = "DOC check 2: EO's ComplianceSignalFetcher.fetchAuthorizationPolicy() (real, unmodified)";
  try {
    const runnerPath = path.join(ctx.tempDir, 'eo-check.mts');
    await fs.writeFile(runnerPath, EO_RUNNER_SCRIPT, 'utf8');

    // Node/Windows can hand back process.env with PSModulePath under a
    // different key casing (observed: "PSMODULEPATH" under vitest's worker
    // process vs. "PSModulePath" from a plain `node` invocation). Spreading
    // process.env and then setting "PSModulePath" leaves the stale
    // differently-cased key in place, and Windows' env block resolution can
    // silently prefer the real, un-shadowed value over ours - the one
    // failure mode this whole design must foreclose (Core Design (d)).
    // Strip every case-insensitive match before setting the canonical key.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'psmodulepath') {
        delete env[key];
      }
    }
    env.PSModulePath = `${ctx.psmodulesDir};${ctx.psHomeModules}`;
    env.STACKSIM_SERVER_URL = ctx.serverUrl;
    env.CES_EO_ROOT = ctx.cesEoRoot;

    const result = await runProcess(process.execPath, [ctx.tsxCliPath, runnerPath], env);

    const eoRaw = extractMarker(result.stdout, 'EO_RESULT::');
    if (result.exitCode !== 0 || !eoRaw) {
      return {
        name,
        passed: false,
        detail: `EO runner failed (exit ${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      };
    }

    const parsed = JSON.parse(eoRaw) as unknown;
    const signals = Array.isArray(parsed) ? parsed : [parsed];
    const signal = (signals as Array<{ signalId?: string; status?: string }>).find(
      (s) => s.signalId === 'authorizationPolicy',
    );
    if (!signal || signal.status !== 'success') {
      return {
        name,
        passed: false,
        detail: `unexpected SignalResult: ${eoRaw}\nrunner stderr: ${result.stderr}`,
      };
    }

    return {
      name,
      passed: true,
      detail: "SignalResult { signalId: 'authorizationPolicy', status: 'success' } returned by the real fetchAuthorizationPolicy()",
    };
  } catch (err) {
    return { name, passed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface VerifyDocArgs {
  slug?: string;
  tenantRoot?: string;
  profilesDir?: string;
  psmodulesDir?: string;
  cesEoRoot?: string;
  tsxCliPath?: string;
}

export interface VerifyDocResult {
  passed: boolean;
  checks: DocCheckResult[];
  slug: string;
}

/**
 * Seeds a fresh m365_azure sim tenant, starts `stacksim serve` in-process,
 * runs all 3 DOC checks against it, tears everything down, and returns the
 * per-check + overall result (DOC item 4: "reproducible via one CLI command
 * ... exits 0 only if all pass" - see runVerifyDoc()).
 */
export async function verifyDoc(args: VerifyDocArgs = {}): Promise<VerifyDocResult> {
  const slug = args.slug ?? `verify-doc-${Date.now()}`;
  const profilesDir = args.profilesDir ?? path.join(process.cwd(), 'profiles');
  const psmodulesDir = args.psmodulesDir ?? path.join(process.cwd(), 'psmodules');
  const monorepoRoot = path.resolve(process.cwd(), '..');
  const cesEoRoot = args.cesEoRoot ?? path.join(monorepoRoot, 'ces-eo');
  const tsxCliPath = args.tsxCliPath ?? path.join(monorepoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  const tenantRoot = args.tenantRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-verify-doc-tenant-')));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-verify-doc-scripts-'));

  let handle: ServeHandle | undefined;
  const checks: DocCheckResult[] = [];

  try {
    const psHomeModules = await getPowerShellHostModulesPath();

    const profile = await loadProfile(resolveProfilePath('m365_azure', profilesDir));
    handle = await startServe({ stance: 'm365_azure', slug, port: 0, profilesDir, tenantRoot });
    await new SeedEngine(handle.store, handle.ledger).seed(profile);

    const ctx: CheckContext = {
      tempDir,
      psmodulesDir,
      psHomeModules,
      serverUrl: `http://127.0.0.1:${handle.port}`,
      store: handle.store,
      ledger: handle.ledger,
      cesEoRoot,
      tsxCliPath,
    };

    checks.push(await runCheck1Stamper(ctx));
    checks.push(await runCheck2Eo(ctx));
    checks.push(await runCheck3Ao(ctx));
  } finally {
    if (handle) {
      await handle.stop();
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    if (!args.tenantRoot) {
      await fs.rm(tenantRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { passed: checks.every((c) => c.passed), checks, slug };
}

/** `stacksim verify-doc [--slug s]` — the DOC gate (PLAN.md M6). */
export async function runVerifyDoc(argv: string[]): Promise<VerifyDocResult> {
  const flags = parseFlags(argv);
  const result = await verifyDoc({
    slug: typeof flags.slug === 'string' ? flags.slug : undefined,
  });

  console.log('stacksim verify-doc - G-STACKSIM-1 DOC gate');
  console.log(`  tenant slug: ${result.slug}`);
  for (const check of result.checks) {
    console.log(`  [${check.passed ? 'PASS' : 'FAIL'}] ${check.name}`);
    console.log(`         ${check.detail.split('\n').join('\n         ')}`);
  }
  console.log(result.passed ? 'RESULT: PASS (all DOC checks green)' : 'RESULT: FAIL');

  process.exitCode = result.passed ? 0 : 1;
  return result;
}
