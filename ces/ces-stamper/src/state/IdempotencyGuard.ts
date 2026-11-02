// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ExeTask, Idempotency, TaskStatus, ExecutionResult } from '../types/schema.types.js';
import { StateManager } from './StateManager.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { IEngineAdapter } from '../adapters/IEngineAdapter.js';

export interface IdempotencyDecision {
  canRun: boolean;
  requiresApproval: boolean;
  reason: string;
}

export class IdempotencyGuard {
  private config: StamperConfig;
  private stateManager: StateManager;

  constructor(config: StamperConfig, stateManager: StateManager) {
    this.config = config;
    this.stateManager = stateManager;
  }

  evaluateTask(task: ExeTask, isResume: boolean): IdempotencyDecision {
    if (!this.config.idempotencyCheck) {
      return {
        canRun: true,
        requiresApproval: false,
        reason: 'Idempotency checking disabled'
      };
    }

    const taskState = this.stateManager.getTaskState(task.id);
    const status = taskState?.status || 'pending';

    // If task never ran, always allow
    if (!taskState || status === 'pending') {
      return {
        canRun: true,
        requiresApproval: false,
        reason: 'Task not yet executed'
      };
    }

    // If task failed, allow retry
    if (status === 'failed') {
      return this.evaluateFailedTask(task, isResume);
    }

    // If task completed, check idempotency level
    if (status === 'completed') {
      return this.evaluateCompletedTask(task, isResume);
    }

    // If task in progress or skipped, don't re-run
    if (status === 'in_progress') {
      return {
        canRun: false,
        requiresApproval: false,
        reason: 'Task currently in progress'
      };
    }

    if (status === 'skipped') {
      return {
        canRun: false,
        requiresApproval: false,
        reason: 'Task was previously skipped'
      };
    }

    return {
      canRun: true,
      requiresApproval: false,
      reason: 'Default allow'
    };
  }

  private evaluateFailedTask(task: ExeTask, isResume: boolean): IdempotencyDecision {
    if (!isResume) {
      return {
        canRun: true,
        requiresApproval: false,
        reason: 'Retrying failed task in fresh execution'
      };
    }

    switch (task.idempotency) {
      case 'safe':
        return {
          canRun: true,
          requiresApproval: false,
          reason: 'Task is safe to retry (idempotent)'
        };

      case 'best_effort':
        return {
          canRun: true,
          requiresApproval: false,
          reason: 'Task retry likely safe (best effort idempotency)'
        };

      case 'unsafe_requires_gate':
        return {
          canRun: false,
          requiresApproval: true,
          reason: 'Task failed previously and is marked unsafe - requires operator approval to retry'
        };

      default:
        return {
          canRun: false,
          requiresApproval: true,
          reason: 'Unknown idempotency level - requiring approval'
        };
    }
  }

  private evaluateCompletedTask(task: ExeTask, isResume: boolean): IdempotencyDecision {
    if (!isResume) {
      return {
        canRun: true,
        requiresApproval: false,
        reason: 'Fresh execution - ignoring previous completion'
      };
    }

    switch (task.idempotency) {
      case 'safe':
        return {
          canRun: true,
          requiresApproval: false,
          reason: 'Task is safe to re-run (idempotent)'
        };

      case 'best_effort':
        return {
          canRun: false,
          requiresApproval: false,
          reason: 'Task already completed - skipping (best effort idempotency)'
        };

      case 'unsafe_requires_gate':
        return {
          canRun: false,
          requiresApproval: true,
          reason: 'Task already completed and is unsafe to re-run - requires operator approval'
        };

      default:
        return {
          canRun: false,
          requiresApproval: true,
          reason: 'Unknown idempotency level - requiring approval'
        };
    }
  }

  // Phase 3.1: Desired-state check — runs the _get_command to determine if config
  // is already applied, avoiding redundant writes for idempotent tasks.
  async checkDesiredState(
    task: ExeTask,
    adapter: IEngineAdapter,
    dryRun: boolean
  ): Promise<'already_applied' | 'needs_apply' | 'unknown'> {
    // Only perform check when task is marked safe and a get command is present
    if (task.idempotency !== 'safe' || !task.action.args._get_command) {
      return 'unknown';
    }

    // In dry-run mode, skip the actual Get call to avoid false negatives
    if (dryRun) {
      return 'unknown';
    }

    try {
      const getTask: ExeTask = {
        ...task,
        action: {
          ...task.action,
          command: task.action.args._get_command as string
        }
      };

      const result: ExecutionResult = await adapter.execute(getTask, {}, false);

      if (!result.success) {
        return 'unknown';
      }

      // Compare Get result against desired state
      const desiredState = task.action.args._desired_state as Record<string, any> | undefined;
      if (!desiredState) {
        return 'unknown';
      }

      // Simple equality: serialize both and compare
      const actual = typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output);
      const desired = JSON.stringify(desiredState);

      return actual === desired ? 'already_applied' : 'needs_apply';
    } catch {
      return 'unknown';
    }
  }

  shouldSkipCompletedTask(task: ExeTask, isResume: boolean): boolean {
    if (!isResume) {
      return false;
    }

    const status = this.stateManager.getTaskStatus(task.id);
    if (status !== 'completed') {
      return false;
    }

    // Safe tasks can always be skipped if already completed
    if (task.idempotency === 'safe') {
      return true;
    }

    // Best effort tasks should be skipped if completed
    if (task.idempotency === 'best_effort') {
      return true;
    }

    // Unsafe tasks require operator decision
    return false;
  }

  getIdempotencyDescription(idempotency: Idempotency): string {
    switch (idempotency) {
      case 'safe':
        return 'Safe to re-run multiple times (fully idempotent)';
      case 'best_effort':
        return 'Probably safe to re-run, but may have side effects';
      case 'unsafe_requires_gate':
        return 'Unsafe to re-run without verification - requires manual approval';
      default:
        return 'Unknown idempotency level';
    }
  }

  formatApprovalPrompt(task: ExeTask, taskState: TaskStatus): string {
    const lines = [
      `Task: ${task.id}`,
      `Type: ${task.type}`,
      `Current Status: ${taskState}`,
      `Idempotency: ${task.idempotency}`,
      `Description: ${this.getIdempotencyDescription(task.idempotency)}`,
      '',
      `Command: ${task.action.command}`,
      `Engine: ${task.action.engine}`,
      ''
    ];

    if (taskState === 'completed') {
      const taskStateData = this.stateManager.getTaskState(task.id);
      lines.push('This task has already completed successfully.');
      if (taskStateData?.completed_at) {
        lines.push(`Completed at: ${taskStateData.completed_at}`);
      }
      lines.push('Re-running may cause unintended side effects.');
    } else if (taskState === 'failed') {
      const taskStateData = this.stateManager.getTaskState(task.id);
      lines.push('This task failed in a previous execution.');
      if (taskStateData?.error) {
        lines.push(`Error: ${taskStateData.error}`);
      }
      lines.push('Re-running may require manual cleanup first.');
    }

    lines.push('');
    lines.push('Do you want to proceed? (yes/no)');

    return lines.join('\n');
  }
}
