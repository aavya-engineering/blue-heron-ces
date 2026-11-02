// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ExeTask, TaskStatus } from '../types/schema.types.js';

export interface TaskNode {
  task: ExeTask;
  status: TaskStatus;
  dependencies: Set<string>;
  dependents: Set<string>;
}

export class DependencyResolver {
  private taskMap: Map<string, TaskNode>;

  constructor(tasks: ExeTask[]) {
    this.taskMap = new Map();
    this.buildGraph(tasks);
  }

  private buildGraph(tasks: ExeTask[]): void {
    // First pass: create nodes (filter self-references and dangling deps)
    const allIds = new Set(tasks.map(t => t.id));
    for (const task of tasks) {
      // Mutate the original task so all downstream consumers see clean deps
      task.depends_on = task.depends_on.filter(id => id !== task.id && allIds.has(id));
      this.taskMap.set(task.id, {
        task,
        status: 'pending',
        dependencies: new Set(task.depends_on),
        dependents: new Set()
      });
    }

    // Second pass: build reverse dependencies
    for (const [taskId, node] of this.taskMap.entries()) {
      for (const depId of node.dependencies) {
        const depNode = this.taskMap.get(depId);
        if (depNode) {
          depNode.dependents.add(taskId);
        }
      }
    }
  }

  validateDependencies(): void {
    // Check for cycles using DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const detectCycle = (taskId: string, path: string[]): void => {
      if (recStack.has(taskId)) {
        const cycleStart = path.indexOf(taskId);
        const cycle = [...path.slice(cycleStart), taskId].join(' -> ');
        throw new Error(`Circular dependency detected: ${cycle}`);
      }

      if (visited.has(taskId)) {
        return;
      }

      visited.add(taskId);
      recStack.add(taskId);

      const node = this.taskMap.get(taskId);
      if (node) {
        for (const depId of node.dependencies) {
          detectCycle(depId, [...path, taskId]);
        }
      }

      recStack.delete(taskId);
    };

    for (const taskId of this.taskMap.keys()) {
      detectCycle(taskId, []);
    }
  }

  verifyTopologicalOrder(tasks: ExeTask[]): boolean {
    const processedTasks = new Set<string>();

    for (const task of tasks) {
      // Use cleaned dependencies from the internal graph (self-refs/dangling stripped)
      const node = this.taskMap.get(task.id);
      const deps = node ? node.dependencies : new Set(task.depends_on);
      for (const depId of deps) {
        if (!processedTasks.has(depId)) {
          return false;
        }
      }
      processedTasks.add(task.id);
    }

    return true;
  }

  /**
   * Kahn's algorithm: sort tasks into a valid topological order using the
   * cleaned internal graph.  Returns the sorted array (stable — preserves
   * original order among tasks with equal dependency depth).
   */
  topoSort(tasks: ExeTask[]): ExeTask[] {
    const inDegree = new Map<string, number>();
    for (const [id, node] of this.taskMap) {
      inDegree.set(id, node.dependencies.size);
    }

    // Seed queue with zero-dependency tasks, preserving original order
    const taskIndex = new Map<string, number>();
    for (let i = 0; i < tasks.length; i++) taskIndex.set(tasks[i].id, i);

    const queue: string[] = [];
    for (const task of tasks) {
      if ((inDegree.get(task.id) ?? 0) === 0) queue.push(task.id);
    }

    const sorted: ExeTask[] = [];
    while (queue.length > 0) {
      // Among ready tasks pick the one that appeared earliest in the original array
      queue.sort((a, b) => (taskIndex.get(a) ?? 0) - (taskIndex.get(b) ?? 0));
      const id = queue.shift()!;
      const node = this.taskMap.get(id);
      if (node) sorted.push(node.task);

      // Decrement in-degree of dependents
      const dependents = node ? node.dependents : new Set<string>();
      for (const depId of dependents) {
        const deg = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, deg);
        if (deg === 0) queue.push(depId);
      }
    }

    return sorted;
  }

  getReadyTasks(taskStates: Map<string, TaskStatus>): ExeTask[] {
    const readyTasks: ExeTask[] = [];

    for (const [taskId, node] of this.taskMap.entries()) {
      const currentStatus = taskStates.get(taskId) || 'pending';

      // Skip if not pending
      if (currentStatus !== 'pending') {
        continue;
      }

      // Check if all dependencies are completed
      let allDepsComplete = true;
      for (const depId of node.dependencies) {
        const depStatus = taskStates.get(depId);
        if (depStatus !== 'completed') {
          allDepsComplete = false;
          break;
        }
      }

      if (allDepsComplete) {
        readyTasks.push(node.task);
      }
    }

    return readyTasks;
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const node = this.taskMap.get(taskId);
    if (node) {
      node.status = status;
    }
  }

  getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.taskMap.get(taskId)?.status;
  }

  getDependencies(taskId: string): string[] {
    const node = this.taskMap.get(taskId);
    return node ? Array.from(node.dependencies) : [];
  }

  getDependents(taskId: string): string[] {
    const node = this.taskMap.get(taskId);
    return node ? Array.from(node.dependents) : [];
  }

  getTask(taskId: string): ExeTask | undefined {
    return this.taskMap.get(taskId)?.task;
  }

  getAllTasks(): ExeTask[] {
    return Array.from(this.taskMap.values()).map(node => node.task);
  }

  getTaskCount(): number {
    return this.taskMap.size;
  }

  getTasksByStatus(status: TaskStatus): ExeTask[] {
    return Array.from(this.taskMap.values())
      .filter(node => node.status === status)
      .map(node => node.task);
  }

  canTaskRun(taskId: string, taskStates: Map<string, TaskStatus>): boolean {
    const node = this.taskMap.get(taskId);
    if (!node) {
      return false;
    }

    const currentStatus = taskStates.get(taskId);
    if (currentStatus !== 'pending') {
      return false;
    }

    // Check all dependencies
    for (const depId of node.dependencies) {
      const depStatus = taskStates.get(depId);
      if (depStatus !== 'completed') {
        return false;
      }
    }

    return true;
  }

  // Phase 7.1 — Semantic constraint validation.
  // Enforces CMMC-specific ordering rules at runtime (safety net).
  //   1. MFA-before-legacy-auth: any task disabling basic/legacy auth must have an
  //      MFA-enabling task in its dependency chain.
  // Note: Audit-log-before-retention rule moved to PlanTranslator (translate time).
  // Returns injected edges and warnings; caller applies edges to the live graph.
  validateSemanticConstraints(
    tasks: ExeTask[]
  ): { warnings: string[]; injectedEdges: Array<{ from: string; to: string }> } {
    const warnings: string[] = [];
    const injectedEdges: Array<{ from: string; to: string }> = [];

    const legacyAuthPattern = /DisableBasicAuth|BlockLegacyAuth/i;
    const mfaPattern = /MFA|AuthenticationMethod|RequireMFA/i;

    const legacyAuthTasks = tasks.filter(t => legacyAuthPattern.test(t.action.command));
    const mfaTasks = tasks.filter(t => mfaPattern.test(t.action.command));

    // Rule 1: MFA-before-legacy-auth
    for (const legacyTask of legacyAuthTasks) {
      const node = this.taskMap.get(legacyTask.id);
      if (!node) continue;

      const hasMfaDep = mfaTasks.some(
        mfaTask => node.dependencies.has(mfaTask.id)
      );

      if (!hasMfaDep && mfaTasks.length > 0) {
        const mfaTask = mfaTasks[0];
        warnings.push(
          `Semantic constraint: task ${legacyTask.id} disables legacy auth but has no MFA predecessor. ` +
          `Injecting dependency on ${mfaTask.id}.`
        );
        injectedEdges.push({ from: mfaTask.id, to: legacyTask.id });
        // Apply edge to in-memory graph so cycle detection sees it
        node.dependencies.add(mfaTask.id);
        const mfaNode = this.taskMap.get(mfaTask.id);
        if (mfaNode) {
          mfaNode.dependents.add(legacyTask.id);
        }
      }
    }

    return { warnings, injectedEdges };
  }
}
