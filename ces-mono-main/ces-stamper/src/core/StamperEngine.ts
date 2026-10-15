// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import { ExecutablePlan, ExecutablePlanSchema, type Engine } from '../types/schema.types.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { BHD_BANNER_LINES } from '../config/provenance.js';
import { DependencyResolver } from './DependencyResolver.js';
import { TaskRunner } from './TaskRunner.js';
import { PrecheckRunner } from './PrecheckRunner.js';
import { PostcheckRunner } from './PostcheckRunner.js';
import { StateManager } from '../state/StateManager.js';
import { IdempotencyGuard } from '../state/IdempotencyGuard.js';
import { DriftExceptionRegistry } from '../state/DriftExceptionRegistry.js';
import { RollbackHandler, type RunRollbackReport } from '../rollback/RollbackHandler.js';
import type { PowerShellAdapter } from '../adapters/PowerShellAdapter.js';
import { EvidenceCollector } from '../evidence/EvidenceCollector.js';
import { EvidenceStore } from '../evidence/EvidenceStore.js';
import { SessionManager } from './SessionManager.js';
import { ExecutionContext } from './ExecutionContext.js';
import { EvidenceStorageConfig } from '../config/ClientConfig.js';
import { buildSecretOverlay } from './SecretResolver.js';
import { SecretStore } from './SecretStore.js';
import type { SecretReference } from 'ces-shared/types/mission-plan';

export interface ExecutionReport {
  plan_id: string;
  status: 'completed' | 'failed' | 'partial';
  started_at: string;
  completed_at: string;
  duration_ms: number;
  summary: {
    total_tasks: number;
    completed: number;
    failed: number;
    skipped: number;
    accomplished: number;
  };
  failed_tasks: {
    task_id: string;
    error: string;
    rollback_action: string;
  }[];
  evidence_collected: number;
  recommendations: string[];
  controlResults?: Array<{
    controlId: string;
    family: string;
    name: string;
    directive: string;
    verdict: string;
  }>;
}

/**
 * Layer 1: BHD Compliance Engine — top-level orchestration IP retained by Blue Heron Defense, LLC.
 * Executes from BHD infrastructure; no engine code is deployed to the target tenant.
 */
export class StamperEngine {
  private config: StamperConfig;
  private plan?: ExecutablePlan;
  private dependencyResolver?: DependencyResolver;
  private taskRunner?: TaskRunner;
  private stateManager?: StateManager;
  private idempotencyGuard?: IdempotencyGuard;
  private rollbackHandler?: RollbackHandler;
  private evidenceStore?: EvidenceStore;
  private evidenceCollector?: EvidenceCollector;
  private precheckRunner: PrecheckRunner;
  private postcheckRunner?: PostcheckRunner;

  constructor(config: StamperConfig) {
    this.config = config;
    this.precheckRunner = new PrecheckRunner();
  }

  async loadPlan(
    planPath: string,
    tenantSlug?: string,
    sessionManager?: SessionManager,
    executionContext?: ExecutionContext,
    evidenceStorage?: EvidenceStorageConfig,
    log?: (msg: string) => void
  ): Promise<void> {
    if (!fs.existsSync(planPath)) {
      throw new Error(`Plan file not found: ${planPath}`);
    }

    const planData = fs.readFileSync(planPath, 'utf-8');
    const planJson = JSON.parse(planData);

    // Validate against schema
    const parseResult = ExecutablePlanSchema.safeParse(planJson);
    if (!parseResult.success) {
      throw new Error(
        `Plan validation failed: ${parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }

    this.plan = parseResult.data;

    // Initialize components
    this.dependencyResolver = new DependencyResolver(this.plan.execution_graph);
    this.stateManager = new StateManager(this.config, this.plan.plan_id, this.plan.ces);
    this.evidenceStore = new EvidenceStore(this.config, this.plan.ces);
    this.evidenceCollector = new EvidenceCollector(this.config, this.evidenceStore);

    // Phase 3.3: Construct DriftExceptionRegistry from plan variables if drift_policies exist.
    // The executable plan carries them in variables._drift_policies (injected by PlanTranslator).
    const driftPolicies = Array.isArray(this.plan.variables._drift_policies)
      ? (this.plan.variables._drift_policies as any[])
      : [];
    const driftRegistry = new DriftExceptionRegistry(driftPolicies);

    // FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution): resolve every
    // secret_references[] / provisioning_inputs entry PlanTranslator recorded (as safe metadata,
    // never a value) at plan.variables._secret_references. Only the resulting overlay — plain
    // values, held in this process's memory alone — reaches PowerShellAdapter; an unresolved
    // reference simply has no overlay entry, so its sentinel throws at execution time instead of
    // silently running with a blank value.
    const secretRefsMeta = Array.isArray(this.plan.variables._secret_references)
      ? (this.plan.variables._secret_references as unknown as SecretReference[])
      : [];
    const { overlay: secretOverlay } = buildSecretOverlay(secretRefsMeta, {
      operatorHeld: tenantSlug ? SecretStore.getAll(tenantSlug) : {},
    });

    this.taskRunner = new TaskRunner(
      this.config,
      this.evidenceCollector,
      this.stateManager,
      driftRegistry,
      sessionManager,
      executionContext,
      tenantSlug,
      evidenceStorage,
      secretOverlay
    );
    this.idempotencyGuard = new IdempotencyGuard(this.config, this.stateManager);
    this.rollbackHandler = new RollbackHandler(this.config, this.stateManager);
    this.postcheckRunner = new PostcheckRunner(
      this.stateManager,
      this.evidenceCollector,
      this.config
    );

    // Validate dependencies (cycle check)
    this.dependencyResolver.validateDependencies();

    // Phase 7.2: Validate semantic constraints and inject edges.
    const semanticResult = this.dependencyResolver.validateSemanticConstraints(
      this.plan.execution_graph
    );
    const emit = log || console.log;
    for (const warning of semanticResult.warnings) {
      emit(`[SemanticConstraint] ${warning}`);
    }
    if (semanticResult.injectedEdges.length > 0) {
      emit(`[SemanticConstraint] Injected ${semanticResult.injectedEdges.length} dependency edge(s)`);
    }

    // Ensure topological order (re-sort if needed after dep cleanup / semantic injection)
    if (!this.dependencyResolver.verifyTopologicalOrder(this.plan.execution_graph)) {
      this.plan.execution_graph = this.dependencyResolver.topoSort(this.plan.execution_graph);
    }

    emit(`Plan loaded: ${this.plan.plan_id}`);
    emit(`Target Level: ${this.plan.target_level}`);
    emit(`Total Tasks: ${this.plan.execution_graph.length}`);

    this.printExecutionModelBanner(emit);
  }

  private printExecutionModelBanner(emit: (msg: string) => void = console.log): void {
    emit(BHD_BANNER_LINES[2]);
    emit(BHD_BANNER_LINES[0]);
  }

  async execute(isResume: boolean = false): Promise<ExecutionReport> {
    if (!this.plan || !this.stateManager || !this.dependencyResolver || !this.taskRunner) {
      throw new Error('Plan not loaded. Call loadPlan() first.');
    }

    const startTime = Date.now();
    this.stateManager.updatePlanStatus('running');

    console.log(`\nStarting execution: ${this.plan.plan_id}`);
    console.log(`Mode: ${isResume ? 'RESUME' : 'FRESH'} ${this.config.dryRun ? '(DRY RUN)' : ''}`);
    console.log('');

    try {
      // Run prechecks (skip if resuming)
      if (!isResume) {
        await this.runPrechecks();
      }

      // Walk execution graph
      await this.walkExecutionGraph(isResume);

      // Run postchecks
      await this.runPostchecks();

      // Mark as completed
      this.stateManager.updatePlanStatus('completed');

      return this.generateReport(startTime);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`\nExecution failed: ${errorMsg}`);
      this.stateManager.updatePlanStatus('failed');
      throw error;
    }
  }

  async runPrechecks(): Promise<void> {
    if (!this.plan || !this.stateManager) {
      throw new Error('Plan not loaded');
    }

    console.log('Running prechecks...');

    const result = await this.precheckRunner.runPrechecks(
      this.plan.prechecks,
      this.config.dryRun
    );

    for (const checkResult of result.results) {
      console.log(`  [${checkResult.passed ? 'PASS' : 'FAIL'}] ${checkResult.check_id}`);
      if (checkResult.error) {
        console.log(`    Error: ${checkResult.error}`);
      }
    }

    if (!result.passed) {
      throw new Error('Prechecks failed - aborting execution');
    }

    this.stateManager.setPrechecksPass(true);
    console.log('All prechecks passed\n');
  }

  async walkExecutionGraph(isResume: boolean): Promise<void> {
    if (!this.plan || !this.stateManager || !this.taskRunner || !this.idempotencyGuard || !this.rollbackHandler) {
      throw new Error('Plan not loaded');
    }

    console.log('Walking execution graph...\n');

    let taskNumber = 0;

    for (const task of this.plan.execution_graph) {
      taskNumber++;
      console.log(`[${taskNumber}/${this.plan.execution_graph.length}] Task: ${task.id}`);

      // W4-ST3 resume: continue after the last completed work — tasks already
      // completed/accomplished in the persisted state are never re-run, whatever
      // their idempotency level, and their recorded state is left untouched.
      const priorStatus = this.stateManager.getTaskStatus(task.id);
      if (isResume && (priorStatus === 'completed' || priorStatus === 'accomplished')) {
        console.log(`  Resume: already ${priorStatus} - not re-run`);
        continue;
      }

      // Check if task can run based on idempotency
      const decision = this.idempotencyGuard.evaluateTask(task, isResume);

      if (!decision.canRun && !decision.requiresApproval) {
        console.log(`  Skipped: ${decision.reason}`);
        if (this.stateManager.getTaskStatus(task.id) !== 'completed') {
          this.stateManager.skipTask(task.id, decision.reason);
        }
        continue;
      }

      if (decision.requiresApproval) {
        console.log(`  Requires approval: ${decision.reason}`);
        // In a real implementation, prompt the operator
        // For MVP, we'll skip unsafe tasks on resume
        this.stateManager.skipTask(task.id, 'Unsafe task requires manual approval');
        continue;
      }

      // Execute task
      try {
        this.stateManager.startTask(task.id);

        const { result, evidenceArtifacts } = await this.taskRunner.executeTask(
          task,
          this.plan.plan_id,
          this.plan.variables
        );

        if (result.success) {
          console.log(`  Success: ${result.stdout?.substring(0, 100) || 'completed'}`);

          // Phase 2.1: Persist pre/post state snapshots alongside task state.
          this.stateManager.completeTask(
            task.id,
            result.output,
            evidenceArtifacts,
            {
              pre_state: result.pre_state,
              post_state: result.post_state
            }
          );

          if (evidenceArtifacts.length > 0) {
            console.log(`  Evidence: ${evidenceArtifacts.length} artifact(s) collected`);
          }
        } else {
          throw new Error(result.error || 'Task execution failed');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`  Failed: ${errorMsg}`);

        this.stateManager.failTask(task.id, errorMsg);

        // Handle rollback
        const rollbackResult = await this.rollbackHandler.handleTaskFailure(task, errorMsg);
        console.log(`  Rollback: ${rollbackResult.action_taken}`);

        // Abort on critical task failure
        if (this.rollbackHandler.shouldAbortOnFailure(task)) {
          throw new Error(`Critical task ${task.id} failed - aborting execution`);
        }
      }

      console.log('');
    }

    console.log('Execution graph complete\n');
  }

  async runPostchecks(): Promise<void> {
    if (!this.plan || !this.stateManager || !this.postcheckRunner) {
      throw new Error('Plan not loaded');
    }

    console.log('Running postchecks...');

    const result = await this.postcheckRunner.runPostchecks(
      this.plan.postchecks,
      this.plan.plan_id,
      this.config.dryRun
    );

    for (const checkResult of result.results) {
      console.log(`  [${checkResult.passed ? 'PASS' : 'FAIL'}] ${checkResult.check_id}`);
      if (checkResult.actual) {
        console.log(`    ${checkResult.actual}`);
      }
      if (checkResult.error) {
        console.log(`    Error: ${checkResult.error}`);
      }
    }

    this.stateManager.setPostchecksPass(result.passed);

    if (!result.passed) {
      console.warn('Warning: Some postchecks failed\n');
    } else {
      console.log('All postchecks passed\n');
    }
  }

  public generateReport(startTime: number): ExecutionReport {
    if (!this.plan || !this.stateManager || !this.evidenceCollector) {
      throw new Error('Plan not loaded');
    }

    const summary = this.stateManager.getSummary();
    const failedTasks = this.stateManager.getFailedTasks();
    const evidenceCount = this.evidenceCollector.getPlanEvidence(this.plan.plan_id).length;

    const failedTaskDetails = failedTasks.map(taskId => {
      const taskState = this.stateManager!.getTaskState(taskId);
      return {
        task_id: taskId,
        error: taskState ? (taskState.error || 'Unknown error') : 'Unknown error',
        rollback_action: 'See execution logs for rollback guidance'
      };
    });

    const recommendations: string[] = [];

    if (summary.failed > 0) {
      recommendations.push(`Review ${summary.failed} failed task(s) and execute rollback procedures`);
    }
    if (summary.skipped > 0) {
      recommendations.push(`Review ${summary.skipped} skipped task(s) - manual execution may be required`);
    }
    if (evidenceCount === 0) {
      recommendations.push('No evidence artifacts were collected - verify evidence collection configuration');
    }

    const status: 'completed' | 'failed' | 'partial' =
      summary.failed === 0 ? 'completed' :
      summary.completed === 0 ? 'failed' :
      'partial';

    return {
      plan_id: this.plan.plan_id,
      status,
      started_at: this.stateManager.getState().started_at,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      summary: {
        total_tasks: summary.total,
        completed: summary.completed,
        failed: summary.failed,
        skipped: summary.skipped,
        accomplished: summary.accomplished
      },
      failed_tasks: failedTaskDetails,
      evidence_collected: evidenceCount,
      recommendations
    };
  }

  /**
   * W4-ST3: reverse the SETs recorded in this plan's execution state (newest first)
   * on the engines' sessions. Sim-only — see RollbackHandler.rollbackAppliedOps.
   */
  async rollback(env: NodeJS.ProcessEnv = process.env): Promise<RunRollbackReport> {
    if (!this.plan || !this.taskRunner || !this.rollbackHandler) {
      throw new Error('Plan not loaded. Call loadPlan() first.');
    }
    const runner = this.taskRunner;
    return this.rollbackHandler.rollbackAppliedOps(async (engine, command) => {
      const adapter = runner.getAdapter(engine as Engine) as Partial<PowerShellAdapter> | undefined;
      if (!adapter || typeof adapter.runResolvedCommand !== 'function') {
        throw new Error(`No command-capable adapter for engine "${engine}"`);
      }
      return adapter.runResolvedCommand(engine, command);
    }, env);
  }

  getPlan(): ExecutablePlan | undefined {
    return this.plan;
  }

  getTuiDependencies(): {
    taskRunner: TaskRunner;
    idempotencyGuard: IdempotencyGuard;
    rollbackHandler: RollbackHandler;
    stateManager: StateManager;
    precheckRunner: PrecheckRunner;
    postcheckRunner: PostcheckRunner;
  } {
    if (!this.taskRunner || !this.idempotencyGuard || !this.rollbackHandler || !this.stateManager || !this.postcheckRunner) {
      throw new Error('Engine not initialized. Call loadPlan() first.');
    }
    return {
      taskRunner: this.taskRunner,
      idempotencyGuard: this.idempotencyGuard,
      rollbackHandler: this.rollbackHandler,
      stateManager: this.stateManager,
      precheckRunner: this.precheckRunner,
      postcheckRunner: this.postcheckRunner,
    };
  }

  getState(): any {
    return this.stateManager?.getState();
  }
}
