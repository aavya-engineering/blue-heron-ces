// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ExeTask, ExecutionResult, Engine, CaptureSpec } from '../types/schema.types.js';
import { IEngineAdapter } from '../adapters/IEngineAdapter.js';
import { PowerShellAdapter, SubCommandStreamCallback } from '../adapters/PowerShellAdapter.js';
import { CLIAdapter } from '../adapters/CLIAdapter.js';
import { APIAdapter } from '../adapters/APIAdapter.js';
import { ManualGateAdapter } from '../adapters/ManualGateAdapter.js';
// TerraformAdapter removed — Phase 4 stub not yet implemented
import { BicepAdapter } from '../adapters/BicepAdapter.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { EvidenceStorageConfig } from '../config/ClientConfig.js';
import { EvidenceCollector } from '../evidence/EvidenceCollector.js';
import { StateManager, ChangeLogEntry } from '../state/StateManager.js';
import { DriftExceptionRegistry } from '../state/DriftExceptionRegistry.js';
import { SessionManager } from './SessionManager.js';
import { ExecutionContext } from './ExecutionContext.js';

export class TaskRunner {
  private config: StamperConfig;
  private adapters: Map<Engine, IEngineAdapter>;
  private evidenceCollector: EvidenceCollector;
  private stateManager?: StateManager;
  private driftRegistry?: DriftExceptionRegistry;
  private sessionManager?: SessionManager;
  private executionContext?: ExecutionContext;
  private tenantSlug?: string;
  private evidenceStorage?: EvidenceStorageConfig;
  /** FC-ST-3 step 2: resolved secret overlay (variable -> plain value), see PowerShellAdapter. */
  private secretOverlay?: Record<string, string>;

  constructor(
    config: StamperConfig,
    evidenceCollector: EvidenceCollector,
    stateManager?: StateManager,
    driftRegistry?: DriftExceptionRegistry,
    sessionManager?: SessionManager,
    executionContext?: ExecutionContext,
    tenantSlug?: string,
    evidenceStorage?: EvidenceStorageConfig,
    secretOverlay?: Record<string, string>
  ) {
    this.config = config;
    this.evidenceCollector = evidenceCollector;
    this.stateManager = stateManager;
    this.driftRegistry = driftRegistry;
    this.sessionManager = sessionManager;
    this.executionContext = executionContext;
    this.tenantSlug = tenantSlug;
    this.evidenceStorage = evidenceStorage;
    this.secretOverlay = secretOverlay;
    this.adapters = new Map();
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    const psAdapter = new PowerShellAdapter(this.config, this.sessionManager, this.executionContext, this.evidenceStorage, this.tenantSlug);
    if (this.secretOverlay) psAdapter.setSecretOverlay(this.secretOverlay);
    this.adapters.set('powershell', psAdapter);
    this.adapters.set('cli', new CLIAdapter());
    this.adapters.set('api', new APIAdapter());
    this.adapters.set('manual_gate', new ManualGateAdapter());
    // this.adapters.set('terraform', new TerraformAdapter()); // Phase 4 stub removed
    this.adapters.set('bicep', new BicepAdapter());

    // All PowerShell-based engines route through PowerShellAdapter with SessionManager.
    // SessionManager handles routing to the correct pre-authenticated session
    // (ipps → purview session via Connect-IPPSSession).
    this.adapters.set('mgraph', psAdapter);
    this.adapters.set('exchange', psAdapter);
    this.adapters.set('ipps', psAdapter);
    this.adapters.set('az', psAdapter);
    this.adapters.set('spo', psAdapter);
    this.adapters.set('teams', psAdapter);
  }

  async executeTask(
    task: ExeTask,
    planId: string,
    variables: Record<string, any>,
    onStream?: SubCommandStreamCallback
  ): Promise<{
    result: ExecutionResult;
    evidenceArtifacts: string[];
  }> {
    // Phase 3.2: Check drift exceptions — route to manual_gate if excepted.
    if (this.driftRegistry && this.isDriftExcepted(task)) {
      const manualAdapter = this.adapters.get('manual_gate')!;
      const manualTask: ExeTask = {
        ...task,
        action: { ...task.action, engine: 'manual_gate' }
      };
      const result = await manualAdapter.execute(manualTask, variables, this.config.dryRun);
      return { result, evidenceArtifacts: [] };
    }

    // Get the adapter for this engine
    const adapter = this.adapters.get(task.action.engine);
    if (!adapter) {
      throw new Error(`No adapter found for engine: ${task.action.engine}`);
    }

    // Validate task before execution
    const validation = await adapter.validate(task);
    if (!validation.valid) {
      throw new Error(
        `Task validation failed: ${validation.errors.join(', ')}`
      );
    }

    // Execute the task
    const result = await adapter.execute(
      task,
      variables,
      this.config.dryRun,
      onStream
    );

    // W4-ST3: record every SET this task applied (even on failure — a failed task may
    // have applied earlier sub-commands) so a run-level rollback can reverse it.
    if (this.stateManager && result.applied_ops && result.applied_ops.length > 0 && !this.config.dryRun) {
      this.stateManager.recordAppliedOps(task.id, result.applied_ops);
    }

    // Phase 2.2: Write change log entry when pre/post state snapshots are available.
    if (this.stateManager && (result.pre_state || result.post_state)) {
      const primaryControlId = task.controls[0] ?? 'unknown';
      const entry: ChangeLogEntry = {
        control_id: primaryControlId,
        task_id: task.id,
        timestamp: new Date().toISOString(),
        operator: this.config.appId || 'dry-run',
        before: result.pre_state ?? {},
        after: result.post_state ?? {},
        dry_run: this.config.dryRun
      };
      this.stateManager.writeChangeLog(entry);
    }

    // Collect evidence if execution succeeded
    let evidenceArtifacts: string[] = [];
    if (result.success && !this.config.dryRun) {
      try {
        evidenceArtifacts = await this.evidenceCollector.collectTaskEvidence(
          planId,
          task,
          result
        );
      } catch {
        // Non-fatal: evidence collection failure does not block task completion
      }
    }

    return {
      result,
      evidenceArtifacts
    };
  }

  // Phase 3.2: Check whether any of the task's controls have an approved drift exception.
  private isDriftExcepted(task: ExeTask): boolean {
    if (!this.driftRegistry) return false;

    for (const controlId of task.controls) {
      // Check with the config key if available, otherwise check control-level
      const configKey = (task.action.args._config_key as string) ?? '';
      if (this.driftRegistry.isExcepted(controlId, configKey)) {
        return true;
      }
    }
    return false;
  }

  async validateTask(task: ExeTask): Promise<{ valid: boolean; errors: string[] }> {
    const adapter = this.adapters.get(task.action.engine);
    if (!adapter) {
      return {
        valid: false,
        errors: [`No adapter found for engine: ${task.action.engine}`]
      };
    }

    return await adapter.validate(task);
  }

  getAdapter(engine: Engine): IEngineAdapter | undefined {
    return this.adapters.get(engine);
  }

  /**
   * Run a get_command to discover capture values for an accomplished sub-command.
   * Delegates to PowerShellAdapter since all registry-backed engines route through it.
   */
  async queryCaptureValues(
    engine: Engine,
    getCommand: string,
    captures: CaptureSpec[],
    variables: Record<string, any>
  ): Promise<Record<string, string>> {
    const adapter = this.adapters.get(engine);
    if (!adapter || !('queryCaptureValues' in adapter)) return {};
    return (adapter as any).queryCaptureValues(engine, getCommand, captures, variables, this.config.dryRun);
  }

  /**
   * Discover the current tenant state for a sub-command.
   * Returns whether the resource exists and any captured values.
   */
  async discoverSubCommandState(
    engine: Engine,
    getCommand: string,
    captures: CaptureSpec[],
    variables: Record<string, any>
  ): Promise<{ exists: boolean; captures: Record<string, string>; rawOutput: string; stderr: string; exitCode: number; resolvedCommand: string; durationMs: number; error?: string }> {
    const adapter = this.adapters.get(engine);
    if (!adapter || !('discoverSubCommand' in adapter)) {
      return { exists: false, captures: {}, rawOutput: '', stderr: '', exitCode: -1, resolvedCommand: '', durationMs: 0 };
    }
    return (adapter as any).discoverSubCommand(engine, getCommand, captures, variables, this.config.dryRun);
  }

  getSupportedEngines(): Engine[] {
    return Array.from(this.adapters.keys());
  }
}
