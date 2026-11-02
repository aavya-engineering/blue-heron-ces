// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SP-4 (SECRETS-PLAN.md §3): the DPAPI protector. Node has no built-in DPAPI (Windows Data
// Protection API), so a fixed powershell.exe -EncodedCommand child calls
// System.Security.Cryptography.ProtectedData. The transport was proven in spike SP-0(b)
// (docs/context/secrets/SPIKE-SP-0b-DPAPI-VIRTUAL-ACCOUNT-2026-10-31.md §1):
//   - data goes on STDIN and comes back on STDOUT only, never argv;
//   - the script is a constant, so argv carries no data at all;
//   - the child gets a scrubbed environment (no CES module secrets);
//   - errors carry the .NET exception type name only, never data.
// No dependency is added.

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { scrubEnv } from './scrubEnv.js';

export type DpapiScope = 'CurrentUser' | 'LocalMachine';

/** Optional DPAPI entropy shared with New-CesModuleSecrets.ps1. Not a secret; it binds blobs to CES use. */
export const DPAPI_ENTROPY = 'CES-MODULE-SECRETS-v1';

export type DpapiErrorCode = 'DPAPI_UNAVAILABLE' | 'DPAPI_FAILED' | 'DPAPI_BAD_INPUT';

export class DpapiError extends Error {
  readonly code: DpapiErrorCode;
  constructor(code: DpapiErrorCode, message: string) {
    super(message);
    this.name = 'DpapiError';
    this.code = code;
  }
}

/** The protector seam. Tests inject a fake; production uses `windowsDpapiProtector`. */
export interface Protector {
  protect(plain: Buffer, scope: DpapiScope): Buffer;
  unprotect(blob: Buffer, scope: DpapiScope): Buffer;
}

/**
 * The fixed helper script. Input (stdin, one line): "<protect|unprotect> <CurrentUser|LocalMachine> <base64>".
 * Output (stdout): base64 only. Exit 0 ok, 2 DPAPI/.NET failure, 3 bad input.
 */
export const DPAPI_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'try {',
  // Module-qualified: a planted Add-Type function or module on PSModulePath cannot intercept it.
  '  Microsoft.PowerShell.Utility\\Add-Type -AssemblyName System.Security',
  '  $parts = [Console]::In.ReadToEnd().Trim().Split(" ")',
  '  if ($parts.Length -ne 3) { [Console]::Error.Write("bad input"); exit 3 }',
  '  $mode = $parts[0]; $scopeName = $parts[1]',
  '  if ($scopeName -ne "CurrentUser" -and $scopeName -ne "LocalMachine") { [Console]::Error.Write("bad scope"); exit 3 }',
  '  $scope = [System.Security.Cryptography.DataProtectionScope]::$scopeName',
  `  $ent = [System.Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')`,
  '  $in = [Convert]::FromBase64String($parts[2])',
  '  if ($mode -eq "protect") { $out = [System.Security.Cryptography.ProtectedData]::Protect($in, $ent, $scope) }',
  '  elseif ($mode -eq "unprotect") { $out = [System.Security.Cryptography.ProtectedData]::Unprotect($in, $ent, $scope) }',
  '  else { [Console]::Error.Write("bad mode"); exit 3 }',
  '  [Console]::Out.Write([Convert]::ToBase64String($out))',
  '  exit 0',
  '} catch {',
  '  [Console]::Error.Write($_.Exception.GetType().Name)',
  '  exit 2',
  '}',
].join('\n');

/** Absolute Windows PowerShell 5.1 path; a service account's PATH is not trusted. */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env['SystemRoot'] || env['SYSTEMROOT'] || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** The child's argv. Constant: it carries the encoded script and nothing else. */
export function dpapiArgv(): string[] {
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(DPAPI_SCRIPT, 'utf16le').toString('base64')];
}

function runHelper(mode: 'protect' | 'unprotect', data: Buffer, scope: DpapiScope): Buffer {
  if (process.platform !== 'win32') {
    throw new DpapiError('DPAPI_UNAVAILABLE', 'DPAPI is only available on Windows');
  }
  if (scope !== 'CurrentUser' && scope !== 'LocalMachine') {
    throw new DpapiError('DPAPI_BAD_INPUT', 'DPAPI scope must be CurrentUser or LocalMachine');
  }
  const r = spawnSync(powershellPath(), dpapiArgv(), {
    input: `${mode} ${scope} ${data.toString('base64')}`,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    // Only the system module folder: nothing on a user or simulator PSModulePath can load into the helper.
    env: { ...scrubEnv(process.env), PSModulePath: path.win32.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') },
  });
  if (r.error) {
    throw new DpapiError('DPAPI_UNAVAILABLE', `DPAPI helper could not start (${(r.error as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  if (r.status !== 0) {
    // stderr holds only an exception type name or a fixed word; never echo stdout.
    const why = String(r.stderr ?? '').trim().slice(0, 80) || `exit ${String(r.status)}`;
    throw new DpapiError(r.status === 3 ? 'DPAPI_BAD_INPUT' : 'DPAPI_FAILED', `DPAPI ${mode} failed (${why})`);
  }
  return Buffer.from(String(r.stdout ?? '').trim(), 'base64');
}

/** The real protector (Windows only). */
export const windowsDpapiProtector: Protector = Object.freeze({
  protect: (plain: Buffer, scope: DpapiScope) => runHelper('protect', plain, scope),
  unprotect: (blob: Buffer, scope: DpapiScope) => runHelper('unprotect', blob, scope),
});
