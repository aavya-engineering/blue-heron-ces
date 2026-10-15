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
import type { SignalResult } from 'ces-shared/types/signal';
import type { TenantConfig } from 'ces-shared/config';

/**
 * Lightweight wrapper for Exchange/Purview cmdlets that have no Graph API equivalent.
 * Spawns pwsh processes with pre-authenticated sessions.
 * Uses fire-and-forget execution with error collection (does not block assessment).
 */
export class PowerShellFallbackAdapter {
  private readonly tenantConfig: TenantConfig;

  constructor(tenantConfig: TenantConfig) {
    this.tenantConfig = tenantConfig;
  }

  async runExchangeCommands(): Promise<SignalResult[]> {
    const signals: SignalResult[] = [];
    const now = new Date().toISOString();

    const commands = [
      {
        id: 'transportRules',
        cmd: `Connect-ExchangeOnline -CertificateThumbprint '${this.tenantConfig.certThumbprint}' -AppId '${this.tenantConfig.appId}' -Organization '${this.tenantConfig.domain}' -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false; Get-TransportRule | Select-Object Name, State, Priority, Mode | ConvertTo-Json -Depth 3`,
      },
      {
        id: 'mailboxAudit',
        cmd: `Connect-ExchangeOnline -CertificateThumbprint '${this.tenantConfig.certThumbprint}' -AppId '${this.tenantConfig.appId}' -Organization '${this.tenantConfig.domain}' -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false; Get-OrganizationConfig | Select-Object AuditDisabled, DefaultAuditSet | ConvertTo-Json`,
      },
    ];

    for (const cmd of commands) {
      try {
        const output = await this.runPwsh(cmd.cmd);
        signals.push({
          signalId: cmd.id,
          source: 'powershell',
          endpoint: cmd.id,
          timestamp: now,
          rawData: this.tryParseJson(output),
          status: 'success',
        });
      } catch (err) {
        signals.push({
          signalId: cmd.id,
          source: 'powershell',
          endpoint: cmd.id,
          timestamp: now,
          rawData: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return signals;
  }

  async runPurviewCommands(): Promise<SignalResult[]> {
    const signals: SignalResult[] = [];
    const now = new Date().toISOString();

    const commands = [
      {
        id: 'retentionPolicies',
        cmd: `Connect-ExchangeOnline -CertificateThumbprint '${this.tenantConfig.certThumbprint}' -AppId '${this.tenantConfig.appId}' -Organization '${this.tenantConfig.domain}' -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false; Get-RetentionCompliancePolicy | Select-Object Name, Enabled, Mode | ConvertTo-Json -Depth 3`,
      },
      {
        id: 'ediscoveryCases',
        cmd: `Connect-ExchangeOnline -CertificateThumbprint '${this.tenantConfig.certThumbprint}' -AppId '${this.tenantConfig.appId}' -Organization '${this.tenantConfig.domain}' -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false; Get-ComplianceCase | Select-Object Name, Status, CaseType | ConvertTo-Json -Depth 3`,
      },
    ];

    for (const cmd of commands) {
      try {
        const output = await this.runPwsh(cmd.cmd);
        signals.push({
          signalId: cmd.id,
          source: 'powershell',
          endpoint: cmd.id,
          timestamp: now,
          rawData: this.tryParseJson(output),
          status: 'success',
        });
      } catch (err) {
        signals.push({
          signalId: cmd.id,
          source: 'powershell',
          endpoint: cmd.id,
          timestamp: now,
          rawData: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return signals;
  }

  private tryParseJson(output: string): unknown {
    const trimmed = output.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  private runPwsh(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const isWin = os.platform() === 'win32';
      const shell = isWin ? 'powershell.exe' : 'pwsh';
      const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('close', (code) => {
        if (child.killed) {
          return reject(new Error('PowerShell command timed out after 120 seconds'));
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
}
