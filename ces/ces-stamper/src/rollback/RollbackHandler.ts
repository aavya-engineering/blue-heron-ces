// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ExeTask, RollbackStrategy } from '../types/schema.types.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { StateManager } from '../state/StateManager.js';
import { simRollbackTarget, type AppliedOp } from './InverseOps.js';

/** Executes one resolved command on an engine session (PowerShellAdapter.runResolvedCommand). */
export type RollbackExecutor = (engine: string, command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface RunRollbackReport {
  /** False when the sim-only guard refused — nothing was executed. */
  executed: boolean;
  target: string;
  reversed: AppliedOp[];
  failed: AppliedOp[];
  /** Applied ops with no automatic inverse — operator guidance. */
  manual: AppliedOp[];
  /** Ops that changed nothing (no reversal needed). */
  noop: number;
}

export interface RollbackResult {
  success: boolean;
  strategy: RollbackStrategy;
  action_taken: string;
  error?: string;
}

export class RollbackHandler {
  private config: StamperConfig;
  private stateManager: StateManager;

  constructor(config: StamperConfig, stateManager: StateManager) {
    this.config = config;
    this.stateManager = stateManager;
  }

  /**
   * W4-ST3: run-level rollback. Reverses every applied, not-yet-reversed SET recorded
   * in the execution state, newest first (reverse apply order), by executing its
   * derived inverse. Sim-only: refuses (executes nothing) unless PowerShell is
   * shadowed onto a loopback stacksim server. Uncovered ops are reported as manual.
   */
  async rollbackAppliedOps(executor: RollbackExecutor, env: NodeJS.ProcessEnv = process.env): Promise<RunRollbackReport> {
    const guard = simRollbackTarget(env);
    const pending = this.stateManager.getAppliedOps()
      .filter((op) => !op.reversed_at)
      .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
    const report: RunRollbackReport = {
      executed: guard.allowed,
      target: guard.reason,
      reversed: [],
      failed: [],
      manual: pending.filter((op) => op.kind === 'uncovered'),
      noop: pending.filter((op) => op.kind === 'noop').length,
    };
    if (!guard.allowed) return report;

    for (const op of pending) {
      if (op.kind !== 'graph-patch' || !op.inverse_command) continue;
      let error: string | undefined;
      try {
        const res = await executor(op.engine, op.inverse_command);
        if (res.exitCode !== 0) error = (res.stderr || res.stdout || `exit ${res.exitCode}`).substring(0, 500);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      this.stateManager.markOpReversed(op.seq!, error);
      if (error) report.failed.push({ ...op, reverse_error: error });
      else report.reversed.push(op);
    }

    this.stateManager.setRollbackOutcome({
      rolled_back_at: new Date().toISOString(),
      reversed: report.reversed.length,
      failed: report.failed.length,
      manual: report.manual.length,
    });
    return report;
  }

  async handleTaskFailure(task: ExeTask, error: string): Promise<RollbackResult> {
    if (!this.config.enableRollback) {
      return {
        success: true,
        strategy: 'none',
        action_taken: 'Rollback disabled in configuration - no action taken'
      };
    }

    const strategy = task.rollback.strategy;

    switch (strategy) {
      case 'none':
        return this.handleNoRollback(task);

      case 'reverse_task':
        return await this.handleReverseTask(task, error);

      case 'restore_snapshot':
        return await this.handleRestoreSnapshot(task, error);

      case 'manual':
        return await this.handleManualRollback(task, error);

      default:
        return {
          success: false,
          strategy: strategy,
          action_taken: 'Unknown rollback strategy',
          error: `Unsupported rollback strategy: ${strategy}`
        };
    }
  }

  private handleNoRollback(_task: ExeTask): RollbackResult {
    return {
      success: true,
      strategy: 'none',
      action_taken: 'No rollback required - task failure logged'
    };
  }

  private async handleReverseTask(task: ExeTask, error: string): Promise<RollbackResult> {
    // In a full implementation, this would execute the reverse operation
    // For MVP, we log the need for reversal and provide guidance

    const guidance = task.rollback.notes || 'Execute the inverse of the failed operation';

    console.warn(`\nROLLBACK REQUIRED (reverse_task)`);
    console.warn(`Task: ${task.id}`);
    console.warn(`Error: ${error}`);
    console.warn(`Guidance: ${guidance}`);
    console.warn('');

    return {
      success: true,
      strategy: 'reverse_task',
      action_taken: `Rollback guidance provided: ${guidance}`,
      error: 'Automatic reverse execution not yet implemented - manual intervention required'
    };
  }

  private async handleRestoreSnapshot(task: ExeTask, error: string): Promise<RollbackResult> {
    // In a full implementation, this would restore from a snapshot
    // For MVP, we log the need for restoration

    const guidance = task.rollback.notes || 'Restore system to pre-task snapshot';

    console.warn(`\nROLLBACK REQUIRED (restore_snapshot)`);
    console.warn(`Task: ${task.id}`);
    console.warn(`Error: ${error}`);
    console.warn(`Guidance: ${guidance}`);
    console.warn('');

    return {
      success: true,
      strategy: 'restore_snapshot',
      action_taken: `Snapshot restoration guidance provided: ${guidance}`,
      error: 'Automatic snapshot restoration not yet implemented - manual intervention required'
    };
  }

  private async handleManualRollback(task: ExeTask, error: string): Promise<RollbackResult> {
    const guidance = task.rollback.notes || 'Manual rollback required';

    console.error(`\n${'='.repeat(80)}`);
    console.error('MANUAL ROLLBACK REQUIRED');
    console.error('='.repeat(80));
    console.error(`Task ID: ${task.id}`);
    console.error(`Task Type: ${task.type}`);
    console.error(`Engine: ${task.action.engine}`);
    console.error(`Command: ${task.action.command}`);
    console.error('');
    console.error(`Error: ${error}`);
    console.error('');
    console.error(`Rollback Guidance: ${guidance}`);
    console.error('');
    console.error('Action Required:');
    console.error('1. Review the error and determine the impact');
    console.error('2. Follow the rollback guidance to restore the system');
    console.error('3. Verify the rollback was successful');
    console.error('4. Update the execution state if needed');
    console.error('='.repeat(80));
    console.error('');

    return {
      success: true,
      strategy: 'manual',
      action_taken: `Manual rollback alert issued. Operator must follow guidance: ${guidance}`
    };
  }

  getRollbackGuidance(task: ExeTask): string {
    return task.rollback.notes || `Manual rollback required for ${task.rollback.strategy} strategy`;
  }

  shouldAbortOnFailure(task: ExeTask): boolean {
    // Critical tasks (p0, p1) should abort execution on failure
    return task.priority === 'p0' || task.priority === 'p1';
  }
}
