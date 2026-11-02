// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'node:child_process';
import * as os from 'node:os';

export interface ModuleInfo {
  Name: string;
  Version: string;
}

export interface ModuleCheckResult {
  installed: ModuleInfo[];
  missing: string[];
  warnings: string[];
}

const REQUIRED_MODULES = ['Microsoft.Graph', 'ExchangeOnlineManagement', 'Az.Accounts'];

/**
 * Pre-flight checker for required PowerShell modules.
 * Warns (does not error) if modules are missing.
 * Called once at EO server startup.
 */
export async function validatePowerShellModules(): Promise<ModuleCheckResult> {
  const result: ModuleCheckResult = {
    installed: [],
    missing: [],
    warnings: [],
  };

  try {
    const output = await runPwsh(
      "Get-Module -ListAvailable | Where-Object { $_.Name -in @('Microsoft.Graph', 'ExchangeOnlineManagement', 'Az.Accounts') } | Select-Object Name, Version | ConvertTo-Json"
    );

    const trimmed = output.trim();
    if (!trimmed || trimmed === '' || trimmed === 'null') {
      result.missing = [...REQUIRED_MODULES];
      result.warnings = REQUIRED_MODULES.map(m => `PowerShell module not found: ${m}`);
      return result;
    }

    const parsed = JSON.parse(trimmed);
    const modules: ModuleInfo[] = Array.isArray(parsed) ? parsed : [parsed];
    result.installed = modules;

    const installedNames = new Set(modules.map(m => m.Name));
    for (const required of REQUIRED_MODULES) {
      if (!installedNames.has(required)) {
        result.missing.push(required);
        result.warnings.push(`PowerShell module not found: ${required}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.warnings.push(`PowerShell module check failed: ${msg}`);
    result.missing = [...REQUIRED_MODULES];
  }

  return result;
}

function runPwsh(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const isWin = os.platform() === 'win32';
    const shell = isWin ? 'pwsh.exe' : 'pwsh';
    const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (child.killed) {
        return reject(new Error('PowerShell module check timed out after 30 seconds'));
      }
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`PowerShell exit ${code}: ${stderr.substring(0, 500)}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`PowerShell spawn error: ${err.message}`));
    });
  });
}
