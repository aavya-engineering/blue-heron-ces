// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'node:child_process';
import * as path from 'node:path';

/**
 * Shared PowerShell-spawn helpers for the coverage harness (CoverageRunner).
 * Deliberately a standalone copy of src/cli/commands/verify-doc.ts's proven
 * M2-M6 pattern (real powershell.exe, $env:PSModulePath fully replaced with
 * `<psmodulesDir>;$PSHOME\Modules`, GRAPH_MODULE_IMPORTS transcribed
 * verbatim from SessionManager.ts) - copied rather than imported so this new
 * G-STACKSIM-2 iteration never risks regressing the M6 DOC gate (which stays
 * untouched). Also carries the case-insensitive PSModulePath-key dedup fix
 * discovered during M6 (IMPLEMENTATION_LOG.md M6 Deviations item 1).
 */

export const GRAPH_MODULE_IMPORTS = [
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
  'Import-Module Az.Accounts -Force -ErrorAction SilentlyContinue',
  'Import-Module Az.Monitor -Force -ErrorAction SilentlyContinue',
  'Import-Module Az.Storage -Force -ErrorAction SilentlyContinue',
  'Import-Module ExchangeOnlineManagement -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Online.SharePoint.PowerShell -Force -ErrorAction SilentlyContinue',
].join('\n');

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
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

/** Same case-insensitive PSModulePath-key dedup fix as verify-doc.ts's
 *  runCheck2Eo (M6 Deviations item 1) - applied here proactively for every
 *  spawned powershell.exe process, not just after a repro.
 *
 *  G-STACKSIM-2 iteration 4: also PREPENDS `azShimDir` (when supplied) onto
 *  PATH, using the same case-insensitive-key-dedup discipline the
 *  PSModulePath fix already established (Windows exposes the live PATH
 *  variable under an inconsistently-cased key depending on the calling
 *  process - see that same M6 deviation). This is a PREPEND, not a
 *  replacement, mirroring PSModulePath's "shadow, don't remove" design: the
 *  real `az` CLI stays reachable later on PATH, it is simply never reached
 *  first in a shadowed session (azshim/az.cmd always wins the bare `az`
 *  lookup). */
export function buildShadowedEnv(
  base: NodeJS.ProcessEnv,
  psmodulesDir: string,
  psHomeModules: string,
  azShimDir?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'psmodulepath') {
      delete env[key];
    }
  }
  env.PSModulePath = `${psmodulesDir};${psHomeModules}`;

  if (azShimDir) {
    let existingPath: string | undefined;
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'path') {
        if (env[key] !== undefined) existingPath = env[key];
        delete env[key];
      }
    }
    env.Path = `${azShimDir};${existingPath ?? ''}`;
  }

  return env;
}

export function getPowerShellHostModulesPath(): Promise<string> {
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

export interface AzShimProbeResult {
  realAzPath: string;
  shimmedAzPath: string;
}

/**
 * Adversarial probe (mirrors M2's psmodule-shadow.spike.test.ts proof
 * style): before the coverage harness executes any az-CLI-shaped inventory
 * item, prove (1) the REAL Azure CLI is genuinely installed and reachable
 * on this box in an UNSHADOWED session, and (2) a session shadowed via
 * buildShadowedEnv's azShimDir prepend resolves the bare `az` command to
 * azshim/az.cmd, not the real install. This is the adversarial case the
 * task requires: if the shim were silently absent/broken, `az` would fall
 * through to the real CLI and attempt genuine network egress against a live
 * ARM endpoint. Throws a clear, labeled error if either assertion fails -
 * the coverage run must not proceed to execute az items on an unproven
 * shim.
 */
export async function assertAzShimResolves(
  baseEnv: NodeJS.ProcessEnv,
  shadowedEnv: NodeJS.ProcessEnv,
  azShimDir: string,
): Promise<AzShimProbeResult> {
  const resolveAzSource = async (env: NodeJS.ProcessEnv): Promise<string> => {
    const result = await runProcess(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Command az -All | Select-Object -First 1 -ExpandProperty Source)',
      ],
      env,
    );
    return result.stdout.trim();
  };

  const shimDirResolved = path.resolve(azShimDir).toLowerCase();

  const realAzPath = await resolveAzSource(baseEnv);
  if (!realAzPath || path.resolve(realAzPath).toLowerCase().startsWith(shimDirResolved)) {
    throw new Error(
      `az-shim probe: expected the REAL Azure CLI to be installed and reachable in an unshadowed session ` +
        `(adversarial precondition - see IMPLEMENTATION_LOG.md G-STACKSIM-2 iteration 4), but got ` +
        `"${realAzPath || '(nothing resolved)'}"`,
    );
  }

  const shimmedAzPath = await resolveAzSource(shadowedEnv);
  if (!shimmedAzPath || !path.resolve(shimmedAzPath).toLowerCase().startsWith(shimDirResolved)) {
    throw new Error(
      `az-shim probe: expected the shadowed session's "az" to resolve under azShimDir ("${azShimDir}"), but got ` +
        `"${shimmedAzPath || '(nothing resolved)'}" - the coverage harness will NOT execute az-CLI-shaped items on ` +
        `an unproven shim (never fall through to the real az CLI).`,
    );
  }

  return { realAzPath, shimmedAzPath };
}

export function psModulePathPrelude(psmodulesDir: string, psHomeModules: string): string {
  return (
    `$ErrorActionPreference = 'Stop'\n$env:PSModulePath = '${psmodulesDir}' + ';' + '${psHomeModules}'\n\n${GRAPH_MODULE_IMPORTS}\n` +
    // G-STACKSIM-2 iteration 3: AO's C-06 (service account password
    // rotation) calls the REAL .NET `[System.Web.Security.Membership]`
    // type directly (`::GeneratePassword(24, 6)`) - that assembly is not
    // loaded into a bare PowerShell session by default (throws "Unable to
    // find type"). A real ces-ao run against a real host would need the
    // same `Add-Type -AssemblyName System.Web` load; adding it to the
    // shared prelude (harmless no-op for every other script) reproduces
    // that real prerequisite rather than special-casing C-06 alone.
    `Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue\n`
  );
}
