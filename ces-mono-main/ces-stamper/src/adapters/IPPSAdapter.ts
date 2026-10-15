// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'child_process';
import { ExeTask, ExecutionResult } from '../types/schema.types.js';
import { IEngineAdapter } from './IEngineAdapter.js';
import { StamperConfig } from '../config/StamperConfig.js';

/**
 * Phase 5 — IPPSAdapter
 *
 * Executes Purview Security & Compliance PowerShell commands via
 * Connect-IPPSSession to the GCC High S&C endpoint. Isolated from
 * PowerShellAdapter because Connect-IPPSSession uses a separate
 * connection lifecycle from Connect-MgGraph, and Graph API cannot
 * create sensitivity labels (RESEARCH_SUMMARY.md Topic 5 Caveats).
 *
 * GCC High endpoint: https://ps.compliance.protection.office365.us
 */
export class IPPSAdapter implements IEngineAdapter {
  private config: StamperConfig;

  // Supported IPPS commands for Purview labels and DLP
  private static readonly SUPPORTED_COMMANDS = [
    'New-Label',
    'Set-Label',
    'Get-Label',
    'New-LabelPolicy',
    'Set-LabelPolicy',
    'Get-LabelPolicy',
    'New-DlpCompliancePolicy',
    'Set-DlpCompliancePolicy',
    'Get-DlpCompliancePolicy',
    'New-DlpComplianceRule',
    'Set-DlpComplianceRule',
    'Get-DlpComplianceRule'
  ];

  constructor(config: StamperConfig) {
    this.config = config;
  }

  getName(): string {
    return 'ipps';
  }

  async validate(task: ExeTask): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!task.action.command) {
      errors.push('IPPS command is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async execute(
    task: ExeTask,
    _variables: Record<string, any>,
    dryRun: boolean
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Phase 5.1: In dry-run, log intent and return stub — no subprocess.
    if (dryRun) {
      const evidenceOutputs: string[] = [];
      if (task.action.args._evidence_commands && Array.isArray(task.action.args._evidence_commands)) {
        for (const cmd of task.action.args._evidence_commands as string[]) {
          evidenceOutputs.push(`[dry-run] IPPS evidence command skipped: ${cmd}`);
        }
      }

      return {
        success: true,
        output: `DRY RUN: IPPS command skipped: ${task.action.command}`,
        stdout: `[dry-run] Would execute via Connect-IPPSSession: ${task.action.command}`,
        duration_ms: Date.now() - startTime,
        dry_run: true,
        pre_state: { dry_run: true },
        post_state: { dry_run: true },
        evidence_outputs: evidenceOutputs
      };
    }

    try {
      const script = this.buildIPPSScript(task);
      const result = await this.executePowerShell(script);

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        duration_ms: Date.now() - startTime,
        error: result.exitCode !== 0 ? result.stderr : undefined
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
        duration_ms: Date.now() - startTime
      };
    }
  }

  private buildIPPSScript(task: ExeTask): string {
    const lines: string[] = [
      '$ErrorActionPreference = "Stop"',
      '',
      '# Connect to Purview Security & Compliance (GCC High)',
      'try {'
    ];

    if (this.config.gccHighEndpoints) {
      lines.push(`  $tenantId = "${this.config.tenantId}"`);
      lines.push(`  $appId = "${this.config.appId}"`);
      lines.push(`  $certThumbprint = "${this.config.certThumbprint}"`);
      lines.push('');
      lines.push('  Connect-IPPSSession \\');
      lines.push(`    -ConnectionUri "${this.config.complianceUri}" \\`);
      lines.push(`    -AzureADAuthorizationEndpointUri "${this.config.azureAuthEndpoint}" \\`);
      lines.push('    -AppId $appId \\');
      lines.push(`    -Organization "$tenantId.onmicrosoft.us" \\`);
      lines.push('    -CertificateThumbprint $certThumbprint');
    } else {
      lines.push('  Connect-IPPSSession -ConnectionUri https://ps.compliance.protection.office365.us');
    }

    lines.push('} catch {');
    lines.push('  Write-Error "Failed to connect to IPPS (GCC High): $_"');
    lines.push('  throw');
    lines.push('}');
    lines.push('');
    lines.push('# Execute Purview command');
    lines.push(task.action.command);
    lines.push('');
    lines.push('Write-Output "STAMPER_IPPS_SUCCESS"');

    return lines.join('\n');
  }

  private executePowerShell(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script
      ]);

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ps.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ps.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 });
      });

      ps.on('error', (error) => {
        reject(new Error(`Failed to spawn IPPS PowerShell process: ${error.message}`));
      });
    });
  }

  getSupportedCommands(): string[] {
    return [...IPPSAdapter.SUPPORTED_COMMANDS];
  }
}
