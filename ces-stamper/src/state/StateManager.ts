// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { PlanExecutionState, TaskExecutionState, TaskStatus, CesIdentity } from '../types/schema.types.js';
import type { AppliedOp } from '../rollback/InverseOps.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { getCesRepository, type CesRepository, type CesScope } from 'ces-shared/persistence/node';
import type { CesIdentity as SharedCesIdentity } from 'ces-shared/config/ces';

// G2: collections in the unified CesRepository (replaces execution-state.json / change-log.jsonl).
const STATE_COLLECTION = 'stamper_execution_state';
const CHANGELOG_COLLECTION = 'stamper_change_log';

// Phase 2.2: Change log entry for auditable config change records.
// Persisted (G2) to the CHANGELOG_COLLECTION, tenant-scoped, one record per entry.
export interface ChangeLogEntry {
  control_id: string;
  task_id:    string;
  timestamp:  string;           // ISO 8601
  operator:   string;           // config.clientId or 'dry-run'
  before:     Record<string, any>;
  after:      Record<string, any>;
  dry_run:    boolean;
}

export class StateManager {
  private repo: CesRepository;
  private scope: CesScope;
  private identity: SharedCesIdentity;
  private planId: string;
  private state: PlanExecutionState;
  private operator: string;
  private ces?: CesIdentity;
  private changeSeq = 0;

  // G1/T2: optional `ces` identity threaded from the plan envelope onto fresh state.
  // G2: persisted via the unified SQLite repository ({storageRoot}/ces.db), tenant-isolated by tenantId.
  constructor(config: StamperConfig, planId: string, ces?: CesIdentity) {
    this.repo = getCesRepository(); // single unified DB at {CES_PIPELINE_ROOT}/ces.db
    this.planId = planId;
    this.operator = config.appId || 'dry-run';
    this.ces = ces;
    // Scope/columns: tenantId from config is the always-present isolation key; carry full lineage too.
    this.scope = { tenantId: config.tenantId };
    this.identity = { ...(ces ?? {}), tenantId: config.tenantId };
    this.state = this.loadOrInitializeState(planId);
    this.changeSeq = this.repo
      .list(CHANGELOG_COLLECTION, this.scope)
      .filter((r) => r.id.startsWith(`${planId}:`)).length;
  }

  private loadOrInitializeState(planId: string): PlanExecutionState {
    const rec = this.repo.get<PlanExecutionState>(STATE_COLLECTION, planId, this.scope);
    if (rec) {
      const loaded = rec.data;
      // Resume: preserve stored identity, but backfill `ces` if absent and one was provided.
      if (!loaded.ces && this.ces) {
        loaded.ces = this.ces;
      }
      return loaded;
    }

    return {
      plan_id: planId,
      status: 'pending',
      started_at: new Date().toISOString(),
      tasks: {},
      prechecks_passed: false,
      ...(this.ces ? { ces: this.ces } : {})
    };
  }

  getState(): PlanExecutionState {
    return { ...this.state };
  }

  updatePlanStatus(status: PlanExecutionState['status']): void {
    this.state.status = status;
    if (status === 'completed' || status === 'failed') {
      this.state.completed_at = new Date().toISOString();
    }
    this.persist();
  }

  setPrechecksPass(passed: boolean): void {
    this.state.prechecks_passed = passed;
    this.persist();
  }

  setPostchecksPass(passed: boolean): void {
    this.state.postchecks_passed = passed;
    this.persist();
  }

  getTaskState(taskId: string): TaskExecutionState | undefined {
    return this.state.tasks[taskId];
  }

  getTaskStatus(taskId: string): TaskStatus {
    return this.state.tasks[taskId]?.status || 'pending';
  }

  startTask(taskId: string): void {
    if (!this.state.tasks[taskId]) {
      this.state.tasks[taskId] = {
        task_id: taskId,
        status: 'in_progress',
        started_at: new Date().toISOString()
      };
    } else {
      this.state.tasks[taskId].status = 'in_progress';
      this.state.tasks[taskId].started_at = new Date().toISOString();
    }
    this.state.last_executed_task_id = taskId;
    this.persist();
  }

  // Phase 2.1: Accept optional pre_state and post_state snapshots.
  completeTask(
    taskId: string,
    outputs?: Record<string, any>,
    evidenceArtifacts?: string[],
    snapshots?: { pre_state?: Record<string, any>; post_state?: Record<string, any> }
  ): void {
    if (!this.state.tasks[taskId]) {
      throw new Error(`Cannot complete task ${taskId}: task not started`);
    }

    this.state.tasks[taskId].status = 'completed';
    this.state.tasks[taskId].completed_at = new Date().toISOString();

    if (outputs) {
      this.state.tasks[taskId].outputs = outputs;
    }

    if (evidenceArtifacts && evidenceArtifacts.length > 0) {
      this.state.tasks[taskId].evidence_artifacts = evidenceArtifacts;
    }

    if (snapshots?.pre_state) {
      this.state.tasks[taskId].pre_state = snapshots.pre_state;
    }
    if (snapshots?.post_state) {
      this.state.tasks[taskId].post_state = snapshots.post_state;
    }

    this.persist();
  }

  failTask(taskId: string, error: string): void {
    if (!this.state.tasks[taskId]) {
      this.state.tasks[taskId] = {
        task_id: taskId,
        status: 'failed'
      };
    } else {
      this.state.tasks[taskId].status = 'failed';
    }

    this.state.tasks[taskId].completed_at = new Date().toISOString();
    this.state.tasks[taskId].error = error;
    this.persist();
  }

  skipTask(taskId: string, reason: string): void {
    this.state.tasks[taskId] = {
      task_id: taskId,
      status: 'skipped',
      completed_at: new Date().toISOString(),
      error: reason
    };
    this.persist();
  }

  /**
   * Mark a task as "accomplished" — the operator confirmed the configuration item
   * was completed outside of Stamper. Evidence is collected separately to prove compliance.
   */
  accomplishTask(
    taskId: string,
    evidenceArtifacts?: string[],
    snapshots?: { pre_state?: Record<string, any>; post_state?: Record<string, any> }
  ): void {
    if (!this.state.tasks[taskId]) {
      this.state.tasks[taskId] = {
        task_id: taskId,
        status: 'accomplished',
        started_at: new Date().toISOString()
      };
    } else {
      this.state.tasks[taskId].status = 'accomplished';
    }

    this.state.tasks[taskId].completed_at = new Date().toISOString();

    if (evidenceArtifacts && evidenceArtifacts.length > 0) {
      this.state.tasks[taskId].evidence_artifacts = evidenceArtifacts;
    }

    if (snapshots?.pre_state) {
      this.state.tasks[taskId].pre_state = snapshots.pre_state;
    }
    if (snapshots?.post_state) {
      this.state.tasks[taskId].post_state = snapshots.post_state;
    }

    this.state.last_executed_task_id = taskId;
    this.persist();
  }

  // Phase 2.2 / G2: persist a change-log entry as a tenant-scoped record (append-style by sequence).
  writeChangeLog(entry: ChangeLogEntry): void {
    this.repo.put(CHANGELOG_COLLECTION, {
      id: `${this.planId}:${this.changeSeq++}`,
      ces: this.identity,
      data: { ...entry, operator: this.operator, plan_id: this.planId },
    });
  }

  getTaskStates(): Map<string, TaskStatus> {
    const states = new Map<string, TaskStatus>();
    for (const [taskId, taskState] of Object.entries(this.state.tasks)) {
      states.set(taskId, taskState.status);
    }
    return states;
  }

  getCompletedTasks(): string[] {
    return Object.entries(this.state.tasks)
      .filter(([_id, state]) => state.status === 'completed')
      .map(([taskId]) => taskId);
  }

  getFailedTasks(): string[] {
    return Object.entries(this.state.tasks)
      .filter(([_id, state]) => state.status === 'failed')
      .map(([taskId]) => taskId);
  }

  getSkippedTasks(): string[] {
    return Object.entries(this.state.tasks)
      .filter(([_id, state]) => state.status === 'skipped')
      .map(([taskId]) => taskId);
  }

  canResume(): boolean {
    return this.state.status === 'paused' || this.state.status === 'failed';
  }

  getRetryableTaskIds(): string[] {
    return Object.entries(this.state.tasks)
      .filter(([_id, state]) => state.status === 'skipped' || state.status === 'failed')
      .map(([taskId]) => taskId);
  }

  setTaskStatus(taskId: string, status: TaskStatus): void {
    if (!this.state.tasks[taskId]) {
      this.state.tasks[taskId] = {
        task_id: taskId,
        status
      };
    } else {
      this.state.tasks[taskId].status = status;
    }
    this.persist();
  }

  // W4-ST3: record the SETs a task applied (with derived inverses) in apply order.
  recordAppliedOps(taskId: string, ops: AppliedOp[]): void {
    if (ops.length === 0) return;
    const log = this.state.applied_ops ?? (this.state.applied_ops = []);
    let seq = log.reduce((m, o) => Math.max(m, o.seq ?? 0), 0);
    const now = new Date().toISOString();
    for (const op of ops) {
      log.push({ ...op, seq: ++seq, task_id: taskId, applied_at: op.applied_at ?? now });
    }
    this.persist();
  }

  getAppliedOps(): AppliedOp[] {
    return (this.state.applied_ops ?? []).map((o) => ({ ...o }));
  }

  markOpReversed(seq: number, error?: string): void {
    const op = (this.state.applied_ops ?? []).find((o) => o.seq === seq);
    if (!op) return;
    if (error) {
      op.reverse_error = error;
    } else {
      op.reversed_at = new Date().toISOString();
      delete op.reverse_error;
    }
    this.persist();
  }

  setRollbackOutcome(outcome: NonNullable<PlanExecutionState['rollback']>): void {
    this.state.rollback = outcome;
    this.persist();
  }

  getLastExecutedTaskId(): string | undefined {
    return this.state.last_executed_task_id;
  }

  private persist(): void {
    this.repo.put(STATE_COLLECTION, {
      id: this.planId,
      ces: this.identity,
      data: this.state,
    });
  }

  exportState(): PlanExecutionState {
    return { ...this.state };
  }

  getAccomplishedTasks(): string[] {
    return Object.entries(this.state.tasks)
      .filter(([_id, state]) => state.status === 'accomplished')
      .map(([taskId]) => taskId);
  }

  getSummary(): {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    pending: number;
    in_progress: number;
    accomplished: number;
  } {
    const summary = {
      total: Object.keys(this.state.tasks).length,
      completed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      in_progress: 0,
      accomplished: 0
    };

    for (const taskState of Object.values(this.state.tasks)) {
      switch (taskState.status) {
        case 'completed':
          summary.completed++;
          break;
        case 'failed':
          summary.failed++;
          break;
        case 'skipped':
          summary.skipped++;
          break;
        case 'pending':
          summary.pending++;
          break;
        case 'in_progress':
          summary.in_progress++;
          break;
        case 'accomplished':
          summary.accomplished++;
          break;
      }
    }

    return summary;
  }
}
