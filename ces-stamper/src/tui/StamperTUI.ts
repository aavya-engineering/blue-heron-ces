// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import inquirer from 'inquirer';
import { Listr, ListrTask } from 'listr2';
import { ExecutablePlan, ExeTask } from '../types/schema.types.js';
import { StamperEngine, ExecutionReport } from '../core/StamperEngine.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { TaskRunner } from '../core/TaskRunner.js';
import { PrecheckRunner } from '../core/PrecheckRunner.js';
import { PostcheckRunner } from '../core/PostcheckRunner.js';
import { IdempotencyGuard } from '../state/IdempotencyGuard.js';
import { RollbackHandler } from '../rollback/RollbackHandler.js';
import { StateManager } from '../state/StateManager.js';
import { buildTaskTitle, buildPromptMessage, printSummaryTable } from './formatters.js';

export class StamperTUI {
  private plan: ExecutablePlan;
  private engine: StamperEngine;
  private config: StamperConfig;
  private mode: 'auto' | 'manual';
  private dryRun: boolean;

  constructor(
    plan: ExecutablePlan,
    engine: StamperEngine,
    config: StamperConfig,
    mode: 'auto' | 'manual',
    dryRun: boolean
  ) {
    this.plan = plan;
    this.engine = engine;
    this.config = config;
    this.mode = mode;
    this.dryRun = dryRun;
  }

  async run(): Promise<ExecutionReport> {
    const startTime = Date.now();

    const {
      taskRunner,
      idempotencyGuard,
      rollbackHandler,
      stateManager,
      precheckRunner,
      postcheckRunner
    } = this.engine.getTuiDependencies();

    stateManager.updatePlanStatus('running');

    const plan = this.plan;
    const mode = this.mode;
    const dryRun = this.dryRun;

    const taskList: ListrTask[] = [
      this.buildPrecheckGroup(precheckRunner, plan, dryRun),
      ...this.buildExecutionTasks(
        plan.execution_graph,
        taskRunner,
        idempotencyGuard,
        rollbackHandler,
        stateManager,
        plan,
        mode,
        dryRun
      ),
      this.buildPostcheckGroup(postcheckRunner, plan, dryRun)
    ];

    const tasks = new Listr(taskList, {
      concurrent: false,
      fallbackRendererCondition: !process.stdout.isTTY
    });

    try {
      await tasks.run();
      stateManager.updatePlanStatus('completed');
    } catch (_error) {
      stateManager.updatePlanStatus('failed');
    }

    const report = this.engine.generateReport(startTime);
    printSummaryTable(report);
    return report;
  }

  private buildPrecheckGroup(
    precheckRunner: PrecheckRunner,
    plan: ExecutablePlan,
    dryRun: boolean
  ): ListrTask {
    return {
      title: 'Prechecks',
      task: (_ctx, task) =>
        task.newListr(
          plan.prechecks.map(check => ({
            title: check.id + ' ' + check.description,
            task: async () => {
              const r = await precheckRunner.runCheck(check, dryRun);
              if (!r.passed) {
                throw new Error(r.error ?? 'precheck failed');
              }
            }
          })),
          { concurrent: false }
        )
    };
  }

  private buildExecutionTasks(
    executionGraph: ExeTask[],
    taskRunner: TaskRunner,
    idempotencyGuard: IdempotencyGuard,
    rollbackHandler: RollbackHandler,
    stateManager: StateManager,
    plan: ExecutablePlan,
    mode: 'auto' | 'manual',
    _dryRun: boolean
  ): ListrTask[] {
    return executionGraph.map(exeTask => ({
      title: buildTaskTitle(exeTask),
      task: async (_ctx: unknown, task: { skip: (msg?: string) => void }) => {
        const decision = idempotencyGuard.evaluateTask(exeTask, false);

        if (!decision.canRun && !decision.requiresApproval) {
          task.skip(decision.reason);
          stateManager.skipTask(exeTask.id, decision.reason);
          return;
        }

        if (mode === 'manual') {
          const answers = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirmed',
              message: buildPromptMessage(exeTask),
              default: true
            }
          ]);
          if (!answers.confirmed) {
            task.skip('Skipped by operator');
            stateManager.skipTask(exeTask.id, 'Skipped by operator');
            return;
          }
        }

        stateManager.startTask(exeTask.id);

        try {
          const { result, evidenceArtifacts } = await taskRunner.executeTask(
            exeTask,
            plan.plan_id,
            plan.variables
          );

          if (result.success) {
            stateManager.completeTask(
              exeTask.id,
              result.output,
              evidenceArtifacts,
              {
                pre_state: result.pre_state,
                post_state: result.post_state
              }
            );
          } else {
            throw new Error(result.error || 'Task execution failed');
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          stateManager.failTask(exeTask.id, errorMsg);
          await rollbackHandler.handleTaskFailure(exeTask, errorMsg);
          if (rollbackHandler.shouldAbortOnFailure(exeTask)) {
            throw new Error(`Critical task ${exeTask.id} failed: ${errorMsg}`);
          }
        }
      }
    }));
  }

  private buildPostcheckGroup(
    postcheckRunner: PostcheckRunner,
    plan: ExecutablePlan,
    dryRun: boolean
  ): ListrTask {
    return {
      title: 'Postchecks',
      task: (_ctx, task) =>
        task.newListr(
          plan.postchecks.map(check => ({
            title: check.id + ' ' + check.description,
            task: async () => {
              const r = await postcheckRunner.runCheck(check, plan.plan_id, dryRun);
              if (!r.passed && check.on_fail === 'halt') {
                throw new Error(r.error ?? 'postcheck failed');
              }
            }
          })),
          { concurrent: false }
        )
    };
  }

  getConfig(): StamperConfig {
    return this.config;
  }
}
