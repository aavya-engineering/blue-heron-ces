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

export class CLIAdapter implements IEngineAdapter {
  getName(): string {
    return 'cli';
  }

  async validate(task: ExeTask): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!task.action.command) {
      errors.push('CLI command is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async execute(
    task: ExeTask,
    variables: Record<string, any>,
    dryRun: boolean
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    if (dryRun) {
      return {
        success: true,
        output: 'DRY RUN: CLI execution skipped',
        stdout: `[dry-run] Would execute: ${task.action.command}`,
        duration_ms: Date.now() - startTime
      };
    }

    try {
      const command = this.interpolateVariables(task.action.command, variables);
      const args = this.parseCommandArgs(task.action.args);

      const result = await this.executeCommand(command, args);

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

  private parseCommandArgs(args: Record<string, any>): string[] {
    const commandArgs: string[] = [];

    for (const [key, value] of Object.entries(args)) {
      if (key === 'requirement_id') {
        continue;
      }

      if (typeof value === 'boolean') {
        if (value) {
          commandArgs.push(`--${key}`);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          commandArgs.push(`--${key}`, String(item));
        }
      } else {
        commandArgs.push(`--${key}`, String(value));
      }
    }

    return commandArgs;
  }

  private interpolateVariables(template: string, variables: Record<string, any>): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `\${${key}}`;
      result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), String(value));
    }

    return result;
  }

  private executeCommand(
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        shell: true,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0
        });
      });

      childProcess.on('error', (error) => {
        reject(new Error(`Failed to execute command: ${error.message}`));
      });
    });
  }
}
