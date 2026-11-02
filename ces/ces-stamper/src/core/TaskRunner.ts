// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ExeTask, ExecutionResult, Engine, CaptureSpec } from '../types/schema.types.js';
import type { SubCommand } from '../types/schema.types.js';
import { IEngineAdapter } from '../adapters/IEngineAdapter.js';
import { PowerShellAdapter, SubCommandStreamCallback, type EntryStateRecord } from '../adapters/PowerShellAdapter.js';
import { CLIAdapter } from '../adapters/CLIAdapter.js';
import { APIAdapter } from '../adapters/APIAdapter.js';
import { ManualGateAdapter } from '../adapters/ManualGateAdapter.js';
// TerraformAdapter removed — Phase 4 stub not yet implemented
import { BicepAdapter } from '../adapters/BicepAdapter.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { EvidenceStorageConfig } from '../config/ClientConfig.js';
import { EvidenceCollector } from '../evidence/EvidenceCollector.js';
import type { EvidenceStore, EvidenceFileLedger } from '../evidence/EvidenceStore.js';
import { StateManager, ChangeLogEntry } from '../state/StateManager.js';
import { DriftExceptionRegistry } from '../state/DriftExceptionRegistry.js';
import { SessionManager } from './SessionManager.js';
import { ExecutionContext } from './ExecutionContext.js';
import { EVIDENCE_DIR, evidenceDirForTenant, tenantPlansDir } from './EvidenceReadinessAnalyzer.js';
import {
  MANUAL_GATE_FILE, POLICY_REFERENCE_FILE, buildManualGateEvidence, buildPolicyReferenceEvidence,
  ownerRoleOf, resolvePolicyRef, writeTaskRecord,
} from './GateEvidence.js';

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
  private psAdapter?: PowerShellAdapter;
  /** FLOW-2b: the run's store and plan; gate and renderable records get one WORM metadata row each. */
  private evidenceLedger?: { store: EvidenceStore; planId: string };

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
    this.psAdapter = psAdapter;
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
      if (!this.config.dryRun) this.recordManualGate(task, result);
      return { result, evidenceArtifacts: [] };
    }

    // synthetic-customer W3: a document renderable rests on its rendered policy document. A
    // manual_gate renderable has no read to run, so no gate is shown: the policy reference is it.
    const isRenderable = task.action.args?._directive === 'document-renderable';
    if (isRenderable && task.action.engine === 'manual_gate') {
      if (this.config.dryRun) {
        return { result: { success: true, output: 'DRY RUN: policy reference not recorded', stdout: '[dry-run] policy reference skipped', duration_ms: 0 }, evidenceArtifacts: [] };
      }
      return { result: this.recordPolicyReference(task, { success: true, duration_ms: 0 }), evidenceArtifacts: [] };
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

    // PH7-ST (DEPTH-4): a manual gate runs its own runnable registry entries, then records the gate as
    // today. Their records carry metadata.gateContext 'manual_gate' (display only; EO never credits them).
    if (task.action.engine === 'manual_gate') {
      const subs = (task.action.args._sub_commands as SubCommand[] | undefined) ?? [];
      const runnable = subs.filter(s => s.engine !== 'manual_gate' && ((s.get_command ?? '').trim() !== '' || (s.set_command ?? '').trim() !== ''));
      if (runnable.length > 0) {
        await this.adapters.get('powershell')!.execute(
          { ...task, action: { ...task.action, engine: 'mgraph', args: { ...task.action.args, _sub_commands: runnable, _gate_context: 'manual_gate' } } },
          variables, this.config.dryRun, onStream);
      }
    }

    // Execute the task
    let result = await adapter.execute(
      task,
      variables,
      this.config.dryRun,
      onStream
    );

    // synthetic-customer W3: manual gates record the owner role and the operator action;
    // renderables (after their reads) record the policy reference, and fail without one.
    if (!this.config.dryRun) {
      if (isRenderable) result = this.recordPolicyReference(task, result);
      else if (task.action.engine === 'manual_gate') this.recordManualGate(task, result);
    }

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

  /** synthetic-customer W3: the entry records the PowerShell adapter wrote in this run. */
  getEntryStateRecords(): EntryStateRecord[] {
    return this.psAdapter?.getEntryStateRecords() ?? [];
  }

  private recordEvidenceDir(): string {
    return this.tenantSlug ? evidenceDirForTenant(this.tenantSlug) : EVIDENCE_DIR;
  }

  /** synthetic-customer W3: the manual gate's record (SAT only when an operator approved it). */
  private recordManualGate(task: ExeTask, result: ExecutionResult): void {
    const out = (result.output && typeof result.output === 'object' ? result.output : {}) as Record<string, unknown>;
    const action = out.gateAction === 'approved' || out.gateAction === 'rejected' ? out.gateAction : 'none';
    try {
      writeTaskRecord(this.recordEvidenceDir(), task.id, MANUAL_GATE_FILE, buildManualGateEvidence(task, {
        ownerRole: typeof out.ownerRole === 'string' ? out.ownerRole : ownerRoleOf(task),
        gateAction: action,
        operator: typeof out.operator === 'string' ? out.operator : undefined,
        notes: typeof out.notes === 'string' ? out.notes : undefined,
      }), this.ledgerFor(task.id));
    } catch { /* evidence logging is best-effort */ }
  }

  /** synthetic-customer W3: the renderable's policy reference; no reference = the task fails. */
  private recordPolicyReference(task: ExeTask, result: ExecutionResult): ExecutionResult {
    const controlId = task.controls[0] ?? '';
    const resolved = this.tenantSlug
      ? resolvePolicyRef(controlId, tenantPlansDir(this.tenantSlug))
      : { reason: 'no tenant: the policy-set manifest cannot be located' };
    try {
      writeTaskRecord(this.recordEvidenceDir(), task.id, POLICY_REFERENCE_FILE, buildPolicyReferenceEvidence(task, resolved), this.ledgerFor(task.id));
    } catch { /* evidence logging is best-effort */ }
    if (!resolved.ref) {
      return { ...result, success: false, error: `document renderable ${controlId}: ${resolved.reason}` };
    }
    if (!result.success) return result;
    return { ...result, output: { policyRef: resolved.ref }, stdout: `policy reference ${resolved.ref.document} sha256 ${resolved.ref.sha256}` };
  }

  /** FX-05: evidence records the PowerShell adapter wrote in this run. */
  getAdapterEvidenceCount(): number {
    return this.psAdapter?.getWrittenEvidenceCount() ?? 0;
  }

  /** FIN-15: the recurring-cost items this run enabled (DP-1 + DP-2 accepted), from the PowerShell adapter. */
  getRecurringCostEnabled(): Array<{ entry_id: string; estimate_month_low: number; estimate_month_high: number }> {
    return this.psAdapter?.getRecurringCostEnabled() ?? [];
  }

  /** FIN-15: the run-report cost line (COST-GATE-SPEC §3.9); undefined when the adapter was never built. */
  getRecurringCostRunReportLine(): string | undefined {
    if (!this.psAdapter) return undefined;
    try {
      return this.psAdapter.getRecurringCostRunReportLine();
    } catch (err) {
      // The price file could not be read: say so rather than fail the report.
      const enabled = this.psAdapter.getRecurringCostEnabled().length;
      return `Recurring cost enabled by this run: ${enabled === 0 ? 'none' : `${enabled} item(s)`} (price file unreadable: ${err instanceof Error ? err.message : String(err)})`;
    }
  }

  /** FLOW-2b: every evidence file this run writes (adapter records, gate and renderable records) gets a WORM row. */
  setEvidenceLedger(store: EvidenceStore, planId: string): void {
    this.evidenceLedger = { store, planId };
    this.psAdapter?.setEvidenceLedger(store, planId);
  }

  private ledgerFor(taskId: string): EvidenceFileLedger | undefined {
    return this.evidenceLedger ? { ...this.evidenceLedger, taskId } : undefined;
  }

  /** FX-05: tell the adapter which plan entries capture each runtime variable. */
  setCaptureProducers(producers: Record<string, string[]>): void {
    this.psAdapter?.setCaptureProducers(producers);
  }

  /** W1: replace the secret overlay (and its evidence provenance) for this run. */
  setSecretOverlay(overlay: Record<string, string>, provenance: Record<string, string> = {}): void {
    this.secretOverlay = overlay;
    this.psAdapter?.setSecretOverlay(overlay);
    this.psAdapter?.setSecretProvenance(provenance);
  }

  /** P3 test flag `--force-fail`: entry ids that fail after their GET, without their SET. */
  setForcedFailures(entryIds: string[]): void {
    this.psAdapter?.setForcedFailures(entryIds);
  }

  /** P3: forced failures that fired in this run. */
  getFiredForcedFailures(): Array<{ entry_id: string; task_id: string }> {
    return this.psAdapter?.getFiredForcedFailures() ?? [];
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
