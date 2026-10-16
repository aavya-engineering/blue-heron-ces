// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'child_process';
import { ExeTask, ExecutionResult, SubCommand, CaptureSpec } from '../types/schema.types.js';
import { IEngineAdapter } from './IEngineAdapter.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { SessionManager } from '../core/SessionManager.js';
import { ENGINE_SESSION_MAP } from 'ces-shared/session';
import { ExecutionContext } from '../core/ExecutionContext.js';
import { EVIDENCE_DIR, evidenceFileForEntry, evidenceDirForTenant } from '../core/EvidenceReadinessAnalyzer.js';
import { EvidenceStorageConfig } from '../config/ClientConfig.js';
import { resolveTemplate } from '../utils/templateResolver.js';
import { OutputVerificationEngine, VerificationResult } from '../core/OutputVerificationEngine.js';
import { buildStructuredEvidence, writeAndUploadEvidence, deriveVerdict } from '../utils/structuredEvidence.js';
import { RegistryEntrySnapshot } from '../types/schema.types.js';
import { deriveInverseOp, type AppliedOp } from '../rollback/InverseOps.js';
import { SECRET_SENTINEL_RE, containsSecretSentinel } from '../core/secretSentinel.js';
import { SecretResolutionError } from '../core/SecretResolver.js';

export type ExecutionPhase = 'get_command' | 'set_command' | 'verification' | 'evidence_command' | 'evidence_save' | 'stdout_chunk' | 'idempotent_skip' | 'pre_accomplished' | 'capture_resolved' | 'post_set_get';

export interface SubCommandStreamEvent {
  phase: ExecutionPhase;
  subId: string;
  label: string;
  engine: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  evidenceFile?: string;
  captures?: Record<string, string>;
  verification?: VerificationResult;
  outcome?: import('../types/schema.types.js').EvidenceOutcome;
  outcomeRationale?: string;
  failureDiagnostics?: import('../types/schema.types.js').FailureDiagnostics;
}

export type SubCommandStreamCallback = (event: SubCommandStreamEvent) => void;


interface SubCommandResult {
  sub_command_id: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  captures?: Record<string, string>;
  preState?: string;
  postState?: string;
  stateChanged?: boolean;
}

export class PowerShellAdapter implements IEngineAdapter {
  private config: StamperConfig;
  private sessionManager?: SessionManager;
  private executionContext?: ExecutionContext;
  private evidenceStorage?: EvidenceStorageConfig;
  private evidenceDir: string;
  private _moduleVersionCache: Map<string, Record<string, string>>;
  /**
   * FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution): resolved secret values
   * (variable -> plain value), set once per execution run via setSecretOverlay(). Held only in
   * this instance's memory — never logged, never merged into `plan.variables`, never returned
   * from any method. Consulted by executeViaSession() alone, immediately before a command
   * reaches the engine/spawn boundary, so a secret sentinel (`<<CES_SECRET:name>>`) in a
   * resolved command template swaps to the real value only at that last moment. Every other
   * copy of the resolved command (stream events, evidence, the plan file) keeps the sentinel.
   */
  private secretOverlay: Record<string, string> = {};

  /** Detect Graph API / Azure 403 permission errors in command output. */
  private isPermissionError(output: string): boolean {
    // Try JSON error parsing first (Graph API returns structured errors)
    try {
      const parsed = JSON.parse(output.trim());
      const code = parsed?.error?.code?.toLowerCase() || parsed?.code?.toLowerCase() || '';
      if (code === 'authorization_requestdenied' || code === 'forbidden' || code === 'accessdenied') {
        return true;
      }
      const status = parsed?.error?.innerError?.status || parsed?.statusCode || parsed?.status;
      if (status === 403) return true;
    } catch {
      // Not JSON — fall through to heuristic matching
    }
    // Heuristic fallback for non-JSON or mixed output
    const lower = output.toLowerCase();
    return lower.includes('authorization_requestdenied') ||
      lower.includes('insufficient privileges') ||
      lower.includes('insufficient permissions') ||
      lower.includes('access denied') ||
      lower.includes('403') ||
      lower.includes('forbidden');
  }

  constructor(config: StamperConfig, sessionManager?: SessionManager, executionContext?: ExecutionContext, evidenceStorage?: EvidenceStorageConfig, tenantSlug?: string) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.executionContext = executionContext;
    this.evidenceStorage = evidenceStorage;
    this.evidenceDir = tenantSlug ? evidenceDirForTenant(tenantSlug) : EVIDENCE_DIR;
    this._moduleVersionCache = new Map<string, Record<string, string>>();
  }

  getName(): string {
    return 'powershell';
  }

  /**
   * FC-ST-3 step 2: install the resolved secret overlay for this execution run. Call once,
   * before executing any task that may need a secret-bearing variable (execute.routes.ts does
   * this right after constructing the adapter, from `plan.variables._secret_references` +
   * SecretStore.getAll(tenant) via SecretResolver.buildSecretOverlay()). Replaces any previous
   * overlay outright — never merges silently with a stale one.
   */
  setSecretOverlay(overlay: Record<string, string>): void {
    this.secretOverlay = { ...overlay };
  }

  /**
   * FC-ST-3 step 2: swap every `<<CES_SECRET:name>>` sentinel in `command` for its resolved
   * value. Throws `SecretResolutionError` — blocking the task, never running with the sentinel
   * literal or a blank value — when a sentinel names a variable the overlay doesn't have.
   * A command with no sentinel is returned unchanged (the common case; cheap early-out).
   */
  private applySecretOverlay(command: string): string {
    if (!containsSecretSentinel(command)) return command;
    return command.replace(SECRET_SENTINEL_RE, (_match, name: string) => {
      const value = this.secretOverlay[name];
      if (!value) {
        throw new SecretResolutionError(
          name,
          `SECRET_UNRESOLVED: variable "${name}" is required by this command but no resolved value ` +
            'is available — supply it at Configure time before this task can run.'
        );
      }
      return value;
    });
  }

  async validate(task: ExeTask): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!task.action.command) {
      errors.push('PowerShell command is required');
    }

    if (task.action.args.powershell_commands) {
      if (!Array.isArray(task.action.args.powershell_commands)) {
        errors.push('powershell_commands must be an array');
      } else if (task.action.args.powershell_commands.length === 0) {
        errors.push('powershell_commands array cannot be empty');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async execute(
    task: ExeTask,
    variables: Record<string, any>,
    dryRun: boolean,
    onStream?: SubCommandStreamCallback
  ): Promise<ExecutionResult> {
    // Sub-command path: when registry-backed commands are present
    const subCommands = task.action.args._sub_commands as SubCommand[] | undefined;
    if (subCommands && subCommands.length > 0) {
      console.log(`[PowerShellAdapter] execute(${task.id}) — sub-command path, ${subCommands.length} sub-commands, dryRun=${dryRun}`);
      return this.executeSubCommands(subCommands, task, variables, dryRun, onStream);
    }

    // Legacy single-command path (backward compat)
    console.log(`[PowerShellAdapter] execute(${task.id}) — legacy single-command path, dryRun=${dryRun}`);
    const startTime = Date.now();

    if (dryRun) {
      // Phase 4.1: In dry-run, capture a stub pre-state and skip execution.
      const preState: Record<string, any> = { dry_run: true };

      // Phase 4.2: In dry-run, log evidence commands but do not invoke them.
      const evidenceOutputs: string[] = [];
      if (task.action.args._evidence_commands && Array.isArray(task.action.args._evidence_commands)) {
        for (const cmd of task.action.args._evidence_commands as string[]) {
          evidenceOutputs.push(`[dry-run] Evidence command skipped: ${cmd}`);
        }
      }

      return {
        success: true,
        output: 'DRY RUN: PowerShell execution skipped',
        stdout: '[dry-run] PowerShell commands validated',
        duration_ms: Date.now() - startTime,
        pre_state: preState,
        post_state: preState,
        evidence_outputs: evidenceOutputs,
        dry_run: true
      };
    }

    try {
      // Phase 4.1: Capture pre-state snapshot via _get_command if present.
      let preState: Record<string, any> | undefined;
      if (task.action.args._get_command) {
        const getResult = await this.runSingleCommand(
          task.action.args._get_command as string,
          variables
        );
        preState = { raw: getResult.stdout, exit_code: getResult.exitCode };
      }

      // Phase 4.3: Build idempotent script if _idempotency_pattern is set.
      const script = task.action.args._idempotency_pattern
        ? this.buildIdempotentScript(
            task.action.command,
            task.action.args,
            task.action.args._idempotency_pattern as 'get-then-patch' | 'deterministic-guid-put' | 'safe-ps',
            variables
          )
        : this.buildScript(task, variables);

      // Execute main command.
      const result = await this.executePowerShell(script);

      // Phase 4.1: Capture post-state snapshot.
      let postState: Record<string, any> | undefined;
      if (task.action.args._get_command) {
        const getResult = await this.runSingleCommand(
          task.action.args._get_command as string,
          variables
        );
        postState = { raw: getResult.stdout, exit_code: getResult.exitCode };
      }

      // Phase 4.2: Execute _evidence_commands after main command.
      const evidenceOutputs: string[] = [];
      if (result.exitCode === 0 && task.action.args._evidence_commands && Array.isArray(task.action.args._evidence_commands)) {
        for (const cmd of task.action.args._evidence_commands as string[]) {
          const interpolated = this.interpolateVariables(cmd, variables);
          const evidResult = await this.runSingleCommand(interpolated, variables);
          evidenceOutputs.push(evidResult.stdout);
        }
      }

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        duration_ms: Date.now() - startTime,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        pre_state: preState,
        post_state: postState,
        evidence_outputs: evidenceOutputs.length > 0 ? evidenceOutputs : undefined
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

  /**
   * Core helper: resolve variables in a get_command, execute it, return raw result.
   * Shared by queryCaptureValues() and discoverSubCommand().
   * When variablesRequired/variablesRuntime are provided AND executionContext exists,
   * uses ExecutionContext.resolve() to pick up plan-loaded and runtime-captured variables.
   */
  private async queryResourceState(
    engine: string,
    getCommand: string,
    variables: Record<string, any>,
    variablesRequired: string[] = [],
    variablesRuntime: string[] = [],
  ): Promise<{ stdout: string; stderr: string; exitCode: number; resolvedCommand: string; durationMs: number }> {
    const resolved = this.executionContext
      ? this.executionContext.resolve(getCommand, variablesRequired, variablesRuntime)
      : resolveTemplate(getCommand, variables);
    const startMs = Date.now();
    const result = await this.executeViaSession(engine, resolved, false);
    return { ...result, resolvedCommand: resolved, durationMs: Date.now() - startMs };
  }

  /**
   * Run a get_command to discover capture values for an accomplished sub-command.
   * Used when operator marks a sub-command as "accomplished" — runs the query
   * to extract values that downstream commands depend on via capture chaining.
   */
  async queryCaptureValues(
    engine: string,
    getCommand: string,
    captures: CaptureSpec[],
    variables: Record<string, any>,
    dryRun: boolean
  ): Promise<Record<string, string>> {
    if (!getCommand || captures.length === 0) return {};
    if (dryRun) return {};

    try {
      const result = await this.queryResourceState(engine, getCommand, variables);
      if (result.exitCode === 0 && result.stdout.trim()) {
        return this.extractCaptures(captures, result.stdout);
      }
    } catch {
      // best-effort: if get_command fails, return empty captures
    }
    return {};
  }

  /**
   * Discover whether a sub-command's resource already exists on the tenant.
   * Runs the get_command and returns existence status plus any captured values.
   * Used by the pre-execution discovery scan to compare as-is vs as-desired state.
   */
  async discoverSubCommand(
    engine: string,
    getCommand: string,
    captures: CaptureSpec[],
    variables: Record<string, any>,
    dryRun: boolean,
    variablesRequired: string[] = [],
    variablesRuntime: string[] = []
  ): Promise<{
    exists: boolean;
    captures: Record<string, string>;
    rawOutput: string;
    stderr: string;
    exitCode: number;
    resolvedCommand: string;
    durationMs: number;
    error?: string;
  }> {
    if (!getCommand) {
      return { exists: false, captures: {}, rawOutput: '', stderr: '', exitCode: -1, resolvedCommand: '', durationMs: 0 };
    }

    const resolved = this.executionContext
      ? this.executionContext.resolve(getCommand, variablesRequired, variablesRuntime)
      : resolveTemplate(getCommand, variables);

    if (dryRun) {
      return { exists: false, captures: {}, rawOutput: '[dry-run] discovery skipped', stderr: '', exitCode: -1, resolvedCommand: resolved, durationMs: 0 };
    }

    try {
      const result = await this.queryResourceState(engine, getCommand, variables, variablesRequired, variablesRuntime);

      // Strip STAMPER_EXECUTION_SUCCESS sentinel that SessionManager appends,
      // so empty-output get_commands aren't falsely classified as existing
      let strippedStdout = result.stdout
        .replace(/\r?\nSTAMPER_EXECUTION_SUCCESS\s*$/, '')
        .replace(/^STAMPER_EXECUTION_SUCCESS\r?\n?$/, '');
      // Strip PowerShell WARNING/VERBOSE blocks that precede JSON output.
      // Azure cmdlets emit multi-line deprecation warnings before actual output.
      // Strategy: if output starts with WARNING:, find the first JSON delimiter.
      if (/^\s*WARNING\s*:/m.test(strippedStdout)) {
        const jsonStart = strippedStdout.search(/^\s*[\[{]/m);
        if (jsonStart > 0) {
          strippedStdout = strippedStdout.substring(jsonStart);
        } else if (jsonStart < 0) {
          // No JSON found — check if entire output is just warnings
          const nonWarning = strippedStdout.replace(/^(?:WARNING|VERBOSE|Note)\s*:.*$/gm, '').replace(/^[-\s]*(?:The |This |It ).*$/gm, '').trim();
          if (!nonWarning) strippedStdout = '';
        }
      }

      // Check for abbreviated PowerShell objects without JSON serialization
      // Case 1: STAMPER_EXECUTION_SUCCESS stripped to empty but raw stdout has PSObject output
      if (result.exitCode === 0 && strippedStdout.trim() === '' && result.stdout.trim()) {
        const rawOutput = result.stdout.trim();
        const isPSObject = /^@\{/.test(rawOutput) || /^\s*\w+\s*:/.test(rawOutput) || rawOutput.includes('PSObject') || /^Microsoft\.\w/.test(rawOutput);
        if (isPSObject) {
          return { exists: true, captures: {}, rawOutput: rawOutput.substring(0, 500), stderr: '[warning] get_command returned PowerShell object without JSON serialization', exitCode: 0, resolvedCommand: result.resolvedCommand, durationMs: result.durationMs, error: 'ps_object_detected' };
        }
      }
      // Case 2: Bare Azure SDK type name in stripped stdout (e.g. Microsoft.Azure.Commands.*.Models.*)
      if (result.exitCode === 0 && strippedStdout.trim() && /^Microsoft\.\w/.test(strippedStdout.trim())) {
        return { exists: true, captures: {}, rawOutput: strippedStdout.substring(0, 500), stderr: '[warning] get_command returned bare Azure SDK type name — add ConvertTo-Json to registry entry', exitCode: 0, resolvedCommand: result.resolvedCommand, durationMs: result.durationMs, error: 'ps_object_detected' };
      }

      // Check for permission errors on non-zero exit or in stderr
      const combinedOutput = result.stderr + ' ' + strippedStdout;
      if (result.exitCode !== 0 && this.isPermissionError(combinedOutput)) {
        return { exists: false, captures: {}, rawOutput: result.stderr.substring(0, 500), stderr: result.stderr, exitCode: result.exitCode, resolvedCommand: result.resolvedCommand, durationMs: result.durationMs, error: 'permission_denied' };
      }

      if (result.exitCode === 0 && strippedStdout.trim() && !strippedStdout.includes('ResourceNotFound')) {
        const capturedValues = captures.length > 0
          ? this.extractCaptures(captures, result.stdout)
          : {};
        return { exists: true, captures: capturedValues, rawOutput: strippedStdout.substring(0, 500), stderr: result.stderr, exitCode: result.exitCode, resolvedCommand: result.resolvedCommand, durationMs: result.durationMs };
      }
      return { exists: false, captures: {}, rawOutput: strippedStdout.substring(0, 500) || result.stderr.substring(0, 500), stderr: result.stderr, exitCode: result.exitCode, resolvedCommand: result.resolvedCommand, durationMs: result.durationMs };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errType = this.isPermissionError(errorMsg) ? 'permission_denied' : errorMsg;
      return { exists: false, captures: {}, rawOutput: '', stderr: errorMsg, exitCode: -1, resolvedCommand: resolved, durationMs: 0, error: errType };
    }
  }

  /**
   * Execute registry-backed sub-commands sequentially with capture chaining.
   */
  private async executeSubCommands(
    subCommands: SubCommand[],
    _task: ExeTask,
    variables: Record<string, any>,
    dryRun: boolean,
    onStream?: SubCommandStreamCallback
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const results: SubCommandResult[] = [];
    const allStdout: string[] = [];
    const allStderr: string[] = [];
    const evidenceOutputs: string[] = [];
    let overallSuccess = true;
    // STAB-1 M1b: per-sub failure reasons, surfaced as ExecutionResult.error so
    // reports carry the real cause instead of the generic "Task execution failed".
    const failureReasons: string[] = [];
    // W4-ST3: SETs applied by this task, for run-level rollback.
    const appliedOps: AppliedOp[] = [];

    // Helper to build registry entry snapshot for evidence enrichment
    const buildSnapshot = (sub: SubCommand): RegistryEntrySnapshot => ({
      entry_id: sub.id, label: sub.label, engine: sub.engine,
      layer_hint: (_task.action?.args?.['_layer'] as number | undefined) ?? undefined,
      sequence_hint: sub.sequence_hint,
      idempotency: sub.idempotency, on_failure: sub.on_failure,
      control_ids: _task.controls,
      get_command: sub.get_command, set_command: sub.set_command,
      evidence_commands: sub.evidence_commands,
    });

    console.log(`[PowerShellAdapter] executeSubCommands — ${subCommands.length} total sub-commands for task ${_task.id}`);
    let subIndex = 0;
    for (const sub of subCommands) {
      subIndex++;
      // Skip entries with no set_command (manual_only / evidence-only)
      if (!sub.set_command || sub.set_command.trim() === '') {
        console.log(`[PowerShellAdapter] [${subIndex}/${subCommands.length}] ${sub.id} — evidence-only (no set_command)`);
        // Evidence-only entries: run GET + extractCaptures for downstream chaining
        if (sub.get_command && sub.captures && sub.captures.length > 0 && !dryRun) {
          try {
            const resolvedGetCmd = this.resolveCommand(sub.get_command, sub, variables);
            const getStart = Date.now();
            const getResult = await this.executeViaSession(sub.engine, resolvedGetCmd, false);
            if (onStream) {
              onStream({
                phase: 'get_command', subId: sub.id, label: sub.label,
                engine: sub.engine, command: resolvedGetCmd,
                stdout: getResult.stdout, stderr: getResult.stderr,
                exitCode: getResult.exitCode, durationMs: Date.now() - getStart,
              });
            }
            if (getResult.exitCode === 0 && getResult.stdout.trim()) {
              const eoCaptures = this.extractCaptures(sub.captures, getResult.stdout);
              if (this.executionContext) {
                this.executionContext.registerCaptures(eoCaptures);
              }
              if (onStream && Object.keys(eoCaptures).length > 0) {
                onStream({
                  phase: 'capture_resolved', subId: sub.id, label: sub.label,
                  engine: sub.engine, command: '',
                  stdout: '', stderr: '', exitCode: 0, durationMs: 0,
                  captures: eoCaptures,
                });
              }
            }
          } catch { /* best-effort capture extraction for evidence-only */ }
        }

        // Collect evidence commands for manual_only / evidence-only entries
        if (sub.evidence_commands.length > 0 && !dryRun) {
          for (const evidCmd of sub.evidence_commands) {
            try {
              const resolved = this.resolveCommand(evidCmd, sub, variables);
              const evidStart = Date.now();
              const evidResult = await this.executeViaSession(sub.engine, resolved, dryRun);
              evidenceOutputs.push(evidResult.stdout);
              if (onStream) {
                onStream({
                  phase: 'evidence_command', subId: sub.id, label: sub.label,
                  engine: sub.engine, command: resolved,
                  stdout: evidResult.stdout, stderr: evidResult.stderr,
                  exitCode: evidResult.exitCode, durationMs: Date.now() - evidStart,
                });
              }
              // Write evidence file (best-effort)
              if (evidResult.stdout.trim()) {
                const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                try {
                  const moduleVersions = await this.extractModuleVersions(sub.engine);
                  const evidence = buildStructuredEvidence(
                    evidResult.stdout,
                    evidResult.exitCode,
                    evidResult.stderr,
                    null,
                    sub,
                    _task,
                    variables,
                    moduleVersions,
                    buildSnapshot(sub)
                  );
                  const { blobUrl } = await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
                  if (onStream && blobUrl) {
                    onStream({ phase: 'evidence_save', subId: sub.id, label: sub.label,
                      engine: sub.engine, command: `PUT ${blobUrl}`, stdout: 'uploaded',
                      stderr: '', exitCode: 0, durationMs: 0, evidenceFile: blobUrl });
                  }
                } catch { /* evidence logging is best-effort */ }
              } else if (evidResult.exitCode === 0) {
                // Evidence-only with exitCode 0 and empty stdout: valid empty result
                // (e.g., no Wi-Fi profiles, no sign-in failures, no DLP matches).
                const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                try {
                  const moduleVersions = await this.extractModuleVersions(sub.engine);
                  const evidence = buildStructuredEvidence(
                    '', evidResult.exitCode, evidResult.stderr, null,
                    sub, _task, variables, moduleVersions, buildSnapshot(sub)
                  );
                  await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
                } catch { /* best-effort */ }
              } else if (evidResult.stderr.trim()) {
                // Evidence command failed (e.g., stale SPO connection) — overwrite any
                // stale evidence so Execute doesn't display outdated outcomes.
                const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                try {
                  const moduleVersions = await this.extractModuleVersions(sub.engine);
                  const evidence = buildStructuredEvidence(
                    '', evidResult.exitCode, evidResult.stderr, null,
                    sub, _task, variables, moduleVersions, buildSnapshot(sub)
                  );
                  evidence.outcome = 'failed_no_remediation';
                  evidence.outcomeRationale = `Evidence command failed: ${evidResult.stderr.substring(0, 200)}`;
                  const { verdict, rationale } = deriveVerdict('failed_no_remediation');
                  evidence.complianceVerdict = verdict;
                  evidence.verdictRationale = rationale;
                  await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
                } catch { /* best-effort */ }
              }
            } catch (evidErr) {
              // Surface permission errors instead of silently swallowing
              if (onStream) {
                const evidErrMsg = evidErr instanceof Error ? evidErr.message : String(evidErr);
                if (this.isPermissionError(evidErrMsg)) {
                  onStream({
                    phase: 'evidence_command', subId: sub.id, label: sub.label,
                    engine: sub.engine, command: evidCmd,
                    stdout: '', stderr: `[permission denied] ${evidErrMsg.substring(0, 500)}`,
                    exitCode: 1, durationMs: 0,
                  });
                }
              }
            }
          }
        }
        results.push({
          sub_command_id: sub.id,
          success: true,
          stdout: dryRun ? `[dry-run] Manual gate: ${sub.label}` : `[manual] ${sub.label}`,
          stderr: '',
          exitCode: 0,
          durationMs: 0,
        });
        continue;
      }

      // Skip pre-accomplished sub-commands (verified by evidence assessment)
      if ((sub as any)._pre_accomplished === true) {
        console.log(`[PowerShellAdapter] [${subIndex}/${subCommands.length}] ${sub.id} — pre-accomplished, skipping SET`);
        // Still extract captures from existing resource via get_command
        let preAccCaptures: Record<string, string> | undefined;
        if (sub.get_command && sub.captures && sub.captures.length > 0 && !dryRun) {
          try {
            const resolvedGetCmd = this.resolveCommand(sub.get_command, sub, variables);
            const getResult = await this.executeViaSession(sub.engine, resolvedGetCmd, false);
            if (getResult.exitCode === 0 && getResult.stdout.trim()) {
              preAccCaptures = this.extractCaptures(sub.captures, getResult.stdout);
              if (this.executionContext) {
                this.executionContext.registerCaptures(preAccCaptures);
              }
            }
          } catch { /* best-effort capture extraction */ }
        }

        // Still collect evidence (best-effort) and emit evidence_logged
        if (sub.evidence_commands.length > 0 && !dryRun) {
          for (const evidCmd of sub.evidence_commands) {
            try {
              const resolved = this.resolveCommand(evidCmd, sub, variables);
              const evidStart = Date.now();
              const evidResult = await this.executeViaSession(sub.engine, resolved, false);
              evidenceOutputs.push(evidResult.stdout);
              if (onStream) {
                onStream({
                  phase: 'evidence_command', subId: sub.id, label: sub.label,
                  engine: sub.engine, command: resolved,
                  stdout: evidResult.stdout, stderr: evidResult.stderr,
                  exitCode: evidResult.exitCode, durationMs: Date.now() - evidStart,
                });
              }
            } catch (evidErr) {
              if (onStream) {
                const evidErrMsg = evidErr instanceof Error ? evidErr.message : String(evidErr);
                if (this.isPermissionError(evidErrMsg)) {
                  onStream({
                    phase: 'evidence_command', subId: sub.id, label: sub.label,
                    engine: sub.engine, command: evidCmd,
                    stdout: '', stderr: `[permission denied] ${evidErrMsg.substring(0, 500)}`,
                    exitCode: 1, durationMs: 0,
                  });
                }
              }
            }
          }
        }

        // Build and write evidence once per pre-accomplished sub-command
        const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
        const captureMessage = `[pre-accomplished] ${sub.label} — verified by evidence assessment`;
        try {
          const moduleVersions = await this.extractModuleVersions(sub.engine);
          const evidence = buildStructuredEvidence(
            captureMessage,
            0,
            '',
            null,
            sub,
            _task,
            variables,
            moduleVersions,
            buildSnapshot(sub)
          );
          await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);

          // Emit evidence_logged event for CMMC tracking
          if (onStream) {
            onStream({
              type: 'evidence_logged',
              taskId: _task.id,
              subId: sub.id,
              file: evidFile,
              evidenceDir: this.evidenceDir,
              evidenceContent: JSON.stringify(evidence, null, 2),
              cmmc_controls: _task.controls || [],
              reason: 'pre_accomplished'
            } as any);
          }
        } catch { /* evidence logging is best-effort */ }

        // Emit pre_accomplished phase event for GUI visibility
        if (onStream) {
          onStream({
            phase: 'pre_accomplished', subId: sub.id, label: sub.label,
            engine: sub.engine, command: '[pre-accomplished]',
            stdout: '', stderr: '', exitCode: 0, durationMs: 0,
            captures: preAccCaptures,
          });
        }

        results.push({
          sub_command_id: sub.id,
          success: true,
          stdout: `[pre-accomplished] ${sub.label} — verified by evidence assessment`,
          stderr: '',
          exitCode: 0,
          durationMs: 0,
          captures: preAccCaptures,
        });
        allStdout.push(`[pre-accomplished] ${sub.id}`);
        continue;
      }

      // Resolve get_command eagerly; defer set_command until after idempotency check
      console.log(`[PowerShellAdapter] [${subIndex}/${subCommands.length}] ${sub.id} — engine=${sub.engine}, phase=GET`);
      let resolvedSetCmd: string = '';
      const resolvedGetCmd = sub.get_command ? this.resolveCommand(sub.get_command, sub, variables) : '';
      let lastGetOutput: string | undefined;

      if (dryRun) {
        results.push({
          sub_command_id: sub.id,
          success: true,
          stdout: `[dry-run] ${sub.engine}: ${sub.set_command.substring(0, 200)}`,
          stderr: '',
          exitCode: 0,
          durationMs: 0,
        });
        allStdout.push(`[dry-run] ${sub.id}: ${sub.set_command.substring(0, 100)}`);
        continue;
      }

      // Pre-SET GET: capture baseline state for RAW (Read-After-Write) diff
      if (resolvedGetCmd) {
        try {
          const getStart = Date.now();
          const getResult = await this.executeViaSession(sub.engine, resolvedGetCmd, false);
          lastGetOutput = getResult.stdout;

          // Stream: emit get_command phase so run-log captures every GET result
          if (onStream) {
            onStream({
              phase: 'get_command', subId: sub.id, label: sub.label,
              engine: sub.engine, command: resolvedGetCmd,
              stdout: getResult.stdout, stderr: getResult.stderr,
              exitCode: getResult.exitCode, durationMs: Date.now() - getStart,
            });
          }

          // Check for cmdlet-not-found errors — indicates session not connected
          const getCombined = getResult.stderr + ' ' + getResult.stdout;
          if (getResult.stdout.trim() === '' && getResult.exitCode === 0 &&
              /is not recognized as the name of a cmdlet|The term '.*' is not recognized/i.test(getResult.stderr)) {
            const errMsg = `[session-not-connected] GET cmdlet not recognized — session "${sub.engine}" may not be connected: ${getResult.stderr.substring(0, 300)}`;
            if (onStream) {
              onStream({
                phase: 'set_command', subId: sub.id, label: sub.label,
                engine: sub.engine, command: resolvedGetCmd,
                stdout: '', stderr: errMsg,
                exitCode: 1, durationMs: 0,
              });
            }
            results.push({
              sub_command_id: sub.id, success: false,
              stdout: '', stderr: errMsg,
              exitCode: 1, durationMs: 0,
            });
            overallSuccess = false;
            failureReasons.push(`${sub.id}: ${errMsg.substring(0, 200)}`);
            if (sub.on_failure === 'abort_step') break;
            if (sub.on_failure === 'abort_plan') throw new Error(errMsg);
            continue;
          }

          // Check for permission errors — do NOT fall through to SET
          if (getResult.exitCode !== 0 && this.isPermissionError(getCombined)) {
            if (onStream) {
              onStream({
                phase: 'set_command', subId: sub.id, label: sub.label,
                engine: sub.engine, command: resolvedGetCmd,
                stdout: '', stderr: `[permission denied] ${getResult.stderr.substring(0, 500)}`,
                exitCode: 1, durationMs: 0,
              });
            }
            results.push({
              sub_command_id: sub.id, success: false,
              stdout: '', stderr: `[permission denied] ${getResult.stderr.substring(0, 500)}`,
              exitCode: 1, durationMs: 0,
            });
            overallSuccess = false;
            failureReasons.push(`${sub.id}: permission denied on GET — ${getResult.stderr.substring(0, 150)}`);
            if (sub.on_failure === 'abort_step') break;
            if (sub.on_failure === 'abort_plan') throw new Error(`Permission denied for ${sub.id}: ${getResult.stderr.substring(0, 200)}`);
            continue;
          }

          // Idempotent skip: only for get-then-set pattern
          if (sub.idempotency === 'get-then-set') {
            // If GET succeeds (exit 0) and returns content, the resource may already exist.
            // Check both stdout AND stderr for ResourceNotFound — Azure cmdlets put 404 in stderr.
            const strippedGetOutput = getResult.stdout
              .replace(/\r?\nSTAMPER_EXECUTION_SUCCESS\s*$/, '')
              .replace(/^STAMPER_EXECUTION_SUCCESS\r?\n?$/, '');
            const _getCombined = strippedGetOutput + ' ' + getResult.stderr;
            if (getResult.exitCode === 0 && strippedGetOutput.trim() && !_getCombined.includes('ResourceNotFound')) {
              // Resource exists — for New-* or POST creation commands this means skip creation
              const isCreationCommand = /^New-|^New[A-Z]|^try\s*\{\s*New-|^\$\w+\s*=.*New-/.test(sub.set_command.trim()) ||
                /Invoke-MgGraphRequest\s[^|]*-Method\s+POST/i.test(sub.set_command);
              if (isCreationCommand) {
                results.push({
                  sub_command_id: sub.id,
                  success: true,
                  stdout: `[idempotent-skip] ${sub.label} — resource already exists`,
                  stderr: '',
                  exitCode: 0,
                  durationMs: 0,
                });
                // Still extract captures from the existing resource
                let skipCaptures: Record<string, string> | undefined;
                if (sub.captures && sub.captures.length > 0) {
                  skipCaptures = this.extractCaptures(sub.captures, getResult.stdout);
                  if (this.executionContext) {
                    this.executionContext.registerCaptures(skipCaptures);
                  }
                  results[results.length - 1].captures = skipCaptures;
                }
                // Write evidence file for idempotent skip
                if (!dryRun) {
                  const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                  try {
                    const moduleVersions = await this.extractModuleVersions(sub.engine);
                    const evidence = buildStructuredEvidence(
                      getResult.stdout,
                      0,
                      '',
                      null,
                      sub,
                      _task,
                      variables,
                      moduleVersions,
                      buildSnapshot(sub),
                      { idempotentSkip: true, getCommandOutput: getResult.stdout }
                    );
                    await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
                  } catch { /* evidence logging is best-effort */ }
                }
                // Emit idempotent_skip event so the GUI shows it
                if (onStream) {
                  onStream({
                    phase: 'idempotent_skip', subId: sub.id, label: sub.label,
                    engine: sub.engine, command: resolvedGetCmd,
                    stdout: getResult.stdout, stderr: '', exitCode: 0,
                    durationMs: 0,
                    captures: skipCaptures,
                  });
                }
                allStdout.push(`[skip] ${sub.id}: already exists`);
                continue;
              }
            }
          }
        } catch (getErr) {
          // Check if the caught error is a permission error
          const getErrMsg = getErr instanceof Error ? getErr.message : String(getErr);
          if (this.isPermissionError(getErrMsg)) {
            if (onStream) {
              onStream({
                phase: 'set_command', subId: sub.id, label: sub.label,
                engine: sub.engine, command: resolvedGetCmd,
                stdout: '', stderr: `[permission denied] ${getErrMsg.substring(0, 500)}`,
                exitCode: 1, durationMs: 0,
              });
            }
            results.push({
              sub_command_id: sub.id, success: false,
              stdout: '', stderr: `[permission denied] ${getErrMsg.substring(0, 500)}`,
              exitCode: 1, durationMs: 0,
            });
            overallSuccess = false;
            failureReasons.push(`${sub.id}: permission denied on GET — ${getErrMsg.substring(0, 150)}`);
            if (sub.on_failure === 'abort_step') break;
            if (sub.on_failure === 'abort_plan') throw getErr;
            continue;
          }
          // Non-permission GET failure — resource doesn't exist, proceed with SET
        }
      }

      // Only resolve set_command if we're actually going to execute it
      resolvedSetCmd = this.resolveCommand(sub.set_command, sub, variables);
      console.log(`[PowerShellAdapter] [${subIndex}/${subCommands.length}] ${sub.id} — phase=SET, cmd: ${resolvedSetCmd.substring(0, 100)}${resolvedSetCmd.length > 100 ? '...' : ''}`);

      // RAW state variables — populated by post-SET GET
      let postGetOutput: string | undefined;
      let postGetExitCode: number | undefined;
      let stateChanged: boolean | undefined;

      // Execute the SET command
      const subStart = Date.now();
      try {
        // Build onStdout callback for real-time streaming
        const stdoutCb = onStream ? (chunk: string) => {
          onStream({
            phase: 'stdout_chunk', subId: sub.id, label: sub.label,
            engine: sub.engine, command: '', stdout: chunk, stderr: '',
            exitCode: -1, durationMs: Date.now() - subStart,
          });
        } : undefined;

        const result = await this.executeViaSession(sub.engine, resolvedSetCmd, false, stdoutCb);
        let success = result.exitCode === 0;

        // Stream: emit set_command phase
        if (onStream) {
          onStream({
            phase: 'set_command', subId: sub.id, label: sub.label,
            engine: sub.engine, command: resolvedSetCmd,
            stdout: result.stdout, stderr: result.stderr,
            exitCode: result.exitCode, durationMs: Date.now() - subStart,
          });
        }

        // ===== RAW POST-SET GET =====
        if (resolvedGetCmd) {
          // Propagation delay for GCC High backend (IPPS/Purview cmdlets, Sentinel alert rules)
          const DELAYED_CMDLETS = ['New-DlpCompliancePolicy', 'New-DlpComplianceRule', 'New-Label', 'New-LabelPolicy', 'Set-DlpCompliancePolicy', 'New-AzSentinelAlertRule'];
          if (DELAYED_CMDLETS.some(cmd => resolvedSetCmd.includes(cmd))) {
            if (onStream) {
              onStream({
                phase: 'post_set_get', subId: sub.id, label: sub.label,
                engine: sub.engine, command: '',
                stdout: '[propagation-delay] Waiting 30s for compliance backend propagation...',
                stderr: '', exitCode: 0, durationMs: 0,
              });
            }
            await new Promise(resolve => setTimeout(resolve, 30000));
          }

          try {
            const postGetResult = await this.executeViaSession(sub.engine, resolvedGetCmd, false);
            postGetOutput = postGetResult.stdout;
            postGetExitCode = postGetResult.exitCode;
            stateChanged = (lastGetOutput !== undefined && postGetOutput !== undefined)
              ? lastGetOutput.trim() !== postGetOutput.trim()
              : undefined;
          } catch (postGetErr) {
            // Log-and-continue: SET already succeeded, post-GET failure is non-fatal
            const postGetErrMsg = postGetErr instanceof Error ? postGetErr.message : String(postGetErr);
            postGetOutput = undefined;
            postGetExitCode = undefined;
            stateChanged = undefined;
            if (onStream) {
              onStream({
                phase: 'post_set_get', subId: sub.id, label: sub.label,
                engine: sub.engine, command: resolvedGetCmd,
                stdout: `[post-get-failed] ${postGetErrMsg.substring(0, 500)}`,
                stderr: postGetErrMsg.substring(0, 500),
                exitCode: 1, durationMs: 0,
              });
            }
          }
          // Emit post_set_get stream event with pre/post diff summary (on success)
          if (postGetOutput !== undefined && onStream) {
            onStream({
              phase: 'post_set_get', subId: sub.id, label: sub.label,
              engine: sub.engine, command: resolvedGetCmd,
              stdout: JSON.stringify({
                preState: (lastGetOutput || '').substring(0, 2000),
                postState: (postGetOutput || '').substring(0, 2000),
                stateChanged
              }),
              stderr: '', exitCode: 0, durationMs: 0,
            });
          }
        } else {
          // No get_command available — SET-only execution
          if (onStream) {
            onStream({
              phase: 'post_set_get', subId: sub.id, label: sub.label,
              engine: sub.engine, command: '',
              stdout: '[no-get-command] RAW verification unavailable',
              stderr: '', exitCode: 0, durationMs: 0,
            });
          }
        }
        // ===== END RAW POST-SET GET =====

        // W4-ST3: record the applied SET with its derived inverse (pre/post diff).
        appliedOps.push(deriveInverseOp({
          sub_command_id: sub.id,
          engine: sub.engine,
          applied_command: resolvedSetCmd,
          pre_state: lastGetOutput,
          post_state: postGetOutput,
        }));

        // Register captured variables from output
        if (success && sub.captures && sub.captures.length > 0) {
          const captures = this.extractCaptures(sub.captures, result.stdout);
          console.log(`[PowerShellAdapter] [${subIndex}/${subCommands.length}] ${sub.id} — captures: ${Object.keys(captures).join(', ') || '(none)'}`);
          if (this.executionContext) {
            this.executionContext.registerCaptures(captures);
          }
          // Emit capture_resolved event
          if (onStream && Object.keys(captures).length > 0) {
            onStream({
              phase: 'capture_resolved', subId: sub.id, label: sub.label,
              engine: sub.engine, command: '',
              stdout: '', stderr: '', exitCode: 0, durationMs: 0,
              captures,
            });
          }
          results.push({
            sub_command_id: sub.id,
            success,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - subStart,
            captures,
            preState: lastGetOutput,
            postState: postGetOutput,
            stateChanged,
          });
        } else {
          results.push({
            sub_command_id: sub.id,
            success,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - subStart,
            preState: lastGetOutput,
            postState: postGetOutput,
            stateChanged,
          });
        }

        // ===== VERIFICATION PHASE =====
        // Run verification AFTER captures extracted but BEFORE audit evidence collection
        const verificationEngine = new OutputVerificationEngine();
        let verificationResult: VerificationResult | undefined;

        if (sub.verification) {
          // If post-GET failed or returned empty/non-zero (replication lag), retry once after 5s
          const postGetNeedsRetry = postGetOutput === undefined
            || (postGetExitCode !== undefined && postGetExitCode !== 0)
            || (postGetOutput !== undefined && postGetOutput.trim() === '');
          if (postGetNeedsRetry && sub.verification.evidence && resolvedGetCmd) {
            try {
              await new Promise(resolve => setTimeout(resolve, 5000));
              const retryResult = await this.executeViaSession(sub.engine, resolvedGetCmd, false);
              postGetOutput = retryResult.stdout;
              postGetExitCode = retryResult.exitCode;
              if (onStream) {
                onStream({
                  phase: 'post_set_get', subId: sub.id, label: sub.label,
                  engine: sub.engine, command: resolvedGetCmd,
                  stdout: `[verification-retry] ${retryResult.stdout.substring(0, 500)}`,
                  stderr: retryResult.stderr, exitCode: retryResult.exitCode, durationMs: 0,
                });
              }
            } catch { /* retry is best-effort; verify() handles null evidence gracefully */ }
          }

          // Reuse RAW post-GET output instead of running a separate GET
          const evidenceForVerify: { stdout: string; exitCode: number } | null =
            postGetOutput !== undefined
              ? { stdout: postGetOutput, exitCode: postGetExitCode ?? -1 }
              : null;

          verificationResult = verificationEngine.verify(
            { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
            evidenceForVerify,
            sub.verification,
            { stateChanged: stateChanged ?? undefined }
          );

          // Override success flag if verification fails (takes precedence over exit code).
          // Exceptions — don't override when:
          // 1. Clean exit (0 + no stderr) and evidence simply unavailable (null) — GET may
          //    have failed transiently but the SET succeeded.
          // 2. Clean exit and stateChanged is false — the resource was already in the desired
          //    state before the SET ran. For get-then-set idempotency, no change needed means
          //    already compliant. Verification criteria may not match the "already exists"
          //    output format, but the pre-state proves compliance.
          if (!verificationResult.passed) {
            const cleanExit = result.exitCode === 0 && (!result.stderr || result.stderr.trim() === '');
            const evidenceUnavailable = verificationResult.details.evidence_check === null;
            const alreadyCompliant = cleanExit && stateChanged === false;
            if (!(cleanExit && evidenceUnavailable) && !alreadyCompliant) {
              success = false;
              overallSuccess = false;
            }
          } else if (!success && verificationResult.passed) {
            // Verification passed but SET failed (e.g., permissions error on an
            // already-compliant resource). Promote to success — the resource is
            // in the desired state regardless of the SET outcome.
            success = true;
          }

          // Emit verification SSE event
          if (onStream) {
            onStream({
              phase: 'verification',
              subId: sub.id,
              label: sub.label,
              engine: sub.engine,
              command: '',
              stdout: JSON.stringify(verificationResult, null, 2),
              stderr: '',
              exitCode: verificationResult.passed ? 0 : 1,
              durationMs: 0,
              verification: verificationResult,
            });
          }
        }

        // State verification via generic parameter extraction (complements registry-based verify)
        if (sub.set_command && sub.set_command.trim() !== '' && !verificationResult) {
          const registryEntry = _task.action.args as any;
          verificationResult = verificationEngine.verifySetState(
            sub.set_command,
            postGetOutput,
            stateChanged ?? false,
            result.exitCode,
            (registryEntry?.consistency_hint as 'eventual_hours' | 'eventual_slow' | 'eventual_fast' | undefined)
          );

          // Emit verification SSE event for state verification
          if (onStream) {
            onStream({
              phase: 'verification',
              subId: sub.id,
              label: sub.label,
              engine: sub.engine,
              command: '',
              stdout: JSON.stringify(verificationResult, null, 2),
              stderr: '',
              exitCode: verificationResult.passed ? 0 : 1,
              durationMs: 0,
              verification: verificationResult,
            });
          }
        }
        // ===== END VERIFICATION PHASE =====

        allStdout.push(result.stdout);
        if (result.stderr) allStderr.push(result.stderr);

        if (!success) {
          overallSuccess = false;
          failureReasons.push(
            `${sub.id}: ` +
              (verificationResult && !verificationResult.passed
                ? `verification failed — ${verificationResult.reason ?? 'criteria not met'}`
                : (result.stderr || `exit code ${result.exitCode}`).trim().substring(0, 200))
          );

          // Write failure evidence so stale evidence from prior runs doesn't persist
          if (sub.evidence_commands.length > 0) {
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            try {
              const moduleVersions = await this.extractModuleVersions(sub.engine);
              const evidence = buildStructuredEvidence(
                '', result.exitCode, result.stderr || 'Execution failed', null,
                sub, _task, variables, moduleVersions, buildSnapshot(sub)
              );
              evidence.outcome = 'failed_no_remediation';
              evidence.outcomeRationale = `SET/verification failed: ${(result.stderr || 'unknown error').substring(0, 200)}`;
              const { verdict, rationale } = deriveVerdict('failed_no_remediation');
              evidence.complianceVerdict = verdict;
              evidence.verdictRationale = rationale;
              await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
            } catch { /* best-effort */ }
          }

          if (sub.on_failure === 'abort_step') break;
          if (sub.on_failure === 'abort_plan') {
            throw new Error(`Sub-command ${sub.id} failed with abort_plan: ${result.stderr}`);
          }
          // warn_continue: mark failure but keep going
        }

        // Collect evidence after successful execution
        if (success && sub.evidence_commands.length > 0) {
          console.log(`[PowerShellAdapter] [${subIndex}/${subCommands.length}] ${sub.id} — phase=EVIDENCE, ${sub.evidence_commands.length} command(s)`);
          const concatenatedOutputs: string[] = [];
          for (const evidCmd of sub.evidence_commands) {
            try {
              const resolved = this.resolveCommand(evidCmd, sub, variables);
              const evidStart = Date.now();
              const evidResult = await this.executeViaSession(sub.engine, resolved, false);
              evidenceOutputs.push(evidResult.stdout);
              concatenatedOutputs.push(evidResult.stdout);
              if (onStream) {
                onStream({
                  phase: 'evidence_command', subId: sub.id, label: sub.label,
                  engine: sub.engine, command: resolved,
                  stdout: evidResult.stdout, stderr: evidResult.stderr,
                  exitCode: evidResult.exitCode, durationMs: Date.now() - evidStart,
                });
              }
            } catch (evidErr) {
              if (onStream) {
                const evidErrMsg = evidErr instanceof Error ? evidErr.message : String(evidErr);
                if (this.isPermissionError(evidErrMsg)) {
                  onStream({
                    phase: 'evidence_command', subId: sub.id, label: sub.label,
                    engine: sub.engine, command: evidCmd,
                    stdout: '', stderr: `[permission denied] ${evidErrMsg.substring(0, 500)}`,
                    exitCode: 1, durationMs: 0,
                  });
                }
              }
            }
          }
          // Write ONE .json file per sub-command with concatenated evidence_commands outputs
          if (concatenatedOutputs.length > 0) {
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            const concatenatedRawResponse = concatenatedOutputs.join('\n---\n');
            try {
              const moduleVersions = await this.extractModuleVersions(sub.engine);
              const evidence = buildStructuredEvidence(
                concatenatedRawResponse,
                0,
                '',
                null,
                sub,
                _task,
                variables,
                moduleVersions,
                buildSnapshot(sub),
                { setCommandExitCode: result.exitCode, setCommandStderr: result.stderr, getCommandOutput: lastGetOutput, postStateOutput: postGetOutput, stateChanged, verificationResult, consistency_hint: sub.verification?.consistency_hint }
              );
              const { blobUrl } = await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
              if (onStream && blobUrl) {
                onStream({ phase: 'evidence_save', subId: sub.id, label: sub.label,
                  engine: sub.engine, command: `PUT ${blobUrl}`, stdout: 'uploaded',
                  stderr: '', exitCode: 0, durationMs: 0, evidenceFile: blobUrl });
              }
            } catch { /* evidence logging is best-effort */ }
          }
        }

        // Log set_command output as evidence when no dedicated evidence_commands exist
        if (success && sub.evidence_commands.length === 0 && result.stdout.trim()) {
          const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
          try {
            const moduleVersions = await this.extractModuleVersions(sub.engine);
            const evidence = buildStructuredEvidence(
              result.stdout,
              result.exitCode,
              result.stderr,
              null,
              sub,
              _task,
              variables,
              moduleVersions,
              buildSnapshot(sub),
              { getCommandOutput: lastGetOutput, postStateOutput: postGetOutput, stateChanged, verificationResult, consistency_hint: sub.verification?.consistency_hint }
            );
            const { blobUrl } = await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
            if (onStream && blobUrl) {
              onStream({ phase: 'evidence_save', subId: sub.id, label: sub.label,
                engine: sub.engine, command: `PUT ${blobUrl}`, stdout: 'uploaded',
                stderr: '', exitCode: 0, durationMs: 0, evidenceFile: blobUrl });
            }
          } catch { /* best-effort */ }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          sub_command_id: sub.id,
          success: false,
          stdout: '',
          stderr: errorMsg,
          exitCode: 1,
          durationMs: Date.now() - subStart,
        });
        overallSuccess = false;
        failureReasons.push(`${sub.id}: ${errorMsg.substring(0, 200)}`);
        if (sub.on_failure === 'abort_step') break;
        if (sub.on_failure === 'abort_plan') throw error;
      }
    }

    // Second pass: run evidence-only sub-commands that were skipped by abort_step.
    // This ensures evidence collection always happens even when a prior get-then-set
    // sub-command failed and broke the main loop.
    const processedIds = new Set(results.map(r => r.sub_command_id));
    for (const sub of subCommands) {
      if (processedIds.has(sub.id)) continue;
      if (sub.set_command && sub.set_command.trim() !== '') continue; // skip get-then-set
      if (!sub.evidence_commands || sub.evidence_commands.length === 0) continue;
      if (dryRun) continue;

      console.log(`[PowerShellAdapter] [2nd-pass] ${sub.id} — evidence-only (skipped by abort_step)`);
      for (const evidCmd of sub.evidence_commands) {
        try {
          const resolved = this.resolveCommand(evidCmd, sub, variables);
          const evidStart = Date.now();
          const evidResult = await this.executeViaSession(sub.engine, resolved, dryRun);
          evidenceOutputs.push(evidResult.stdout);
          if (onStream) {
            onStream({
              phase: 'evidence_command', subId: sub.id, label: sub.label,
              engine: sub.engine, command: resolved,
              stdout: evidResult.stdout, stderr: evidResult.stderr,
              exitCode: evidResult.exitCode, durationMs: Date.now() - evidStart,
            });
          }
          if (evidResult.stdout.trim()) {
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            try {
              const moduleVersions = await this.extractModuleVersions(sub.engine);
              const evidence = buildStructuredEvidence(
                evidResult.stdout, evidResult.exitCode, evidResult.stderr, null,
                sub, _task, variables, moduleVersions, buildSnapshot(sub)
              );
              await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
            } catch { /* best-effort */ }
          } else if (evidResult.exitCode === 0) {
            // Evidence-only with exitCode 0 and empty stdout: valid empty result
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            try {
              const moduleVersions = await this.extractModuleVersions(sub.engine);
              const evidence = buildStructuredEvidence(
                '', evidResult.exitCode, evidResult.stderr, null,
                sub, _task, variables, moduleVersions, buildSnapshot(sub)
              );
              await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
            } catch { /* best-effort */ }
          } else if (evidResult.stderr.trim()) {
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            try {
              const moduleVersions = await this.extractModuleVersions(sub.engine);
              const evidence = buildStructuredEvidence(
                '', evidResult.exitCode, evidResult.stderr, null,
                sub, _task, variables, moduleVersions, buildSnapshot(sub)
              );
              evidence.outcome = 'failed_no_remediation';
              evidence.outcomeRationale = `Evidence command failed: ${evidResult.stderr.substring(0, 200)}`;
              const { verdict, rationale } = deriveVerdict('failed_no_remediation');
              evidence.complianceVerdict = verdict;
              evidence.verdictRationale = rationale;
              await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage);
            } catch { /* best-effort */ }
          }
        } catch { /* evidence second-pass is best-effort */ }
      }
    }

    return {
      success: overallSuccess,
      output: allStdout.join('\n'),
      stdout: allStdout.join('\n'),
      stderr: allStderr.join('\n'),
      duration_ms: Date.now() - startTime,
      evidence_outputs: evidenceOutputs.length > 0 ? evidenceOutputs : undefined,
      dry_run: dryRun,
      ...(appliedOps.length > 0 ? { applied_ops: appliedOps } : {}),
      ...(overallSuccess
        ? {}
        : { error: (failureReasons.join('; ') || 'sub-command execution failed').substring(0, 500) }),
    };
  }

  /**
   * Resolve {variable} placeholders using ExecutionContext or legacy variables map.
   */
  private resolveCommand(
    template: string,
    sub: SubCommand,
    variables: Record<string, any>
  ): string {
    if (this.executionContext) {
      return this.executionContext.resolve(
        template,
        sub.variables_required,
        sub.variables_runtime
      );
    }
    // Fallback: legacy variable interpolation
    return this.interpolateVariables(template, variables);
  }

  /**
   * W4-ST3: run one already-resolved command on the engine's session (or direct
   * spawn) — used by run-level rollback to execute recorded inverse operations.
   */
  async runResolvedCommand(engine: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.executeViaSession(engine, command, false);
  }

  /**
   * Execute a command via SessionManager (preferred) or direct spawn (fallback).
   */
  private async executeViaSession(
    engine: string,
    command: string,
    _dryRun: boolean,
    onStdout?: (chunk: string) => void
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // FC-ST-3 step 2: the only place a resolved secret value is substituted — every caller of
    // executeViaSession still holds (and streams/logs/persists) the sentinel-bearing `command`.
    const execCommand = this.applySecretOverlay(command);
    if (this.sessionManager) {
      const sessionType = ENGINE_SESSION_MAP[engine] ?? 'graph';
      const result = await this.sessionManager.execute(sessionType, execCommand, onStdout);
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    }
    // Fallback: direct PowerShell spawn
    const script = `$ErrorActionPreference = "Stop"\n${execCommand}`;
    return this.executePowerShell(script, onStdout);
  }

  /**
   * Extract captured variables from command stdout.
   */
  private extractCaptures(
    captureSpecs: CaptureSpec[],
    stdout: string
  ): Record<string, string> {
    const captures: Record<string, string> = {};

    // Strip STAMPER_EXECUTION_SUCCESS sentinel that SessionManager appends
    stdout = stdout.replace(/\r?\nSTAMPER_EXECUTION_SUCCESS\s*$/, '');

    // Strip PowerShell WARNING/VERBOSE blocks that precede JSON output.
    // Azure cmdlets emit multi-line deprecation warnings before actual output.
    if (/^\s*WARNING\s*:/m.test(stdout)) {
      const jsonStart = stdout.search(/^\s*[\[{]/m);
      if (jsonStart > 0) {
        stdout = stdout.substring(jsonStart);
      }
    }

    for (const spec of captureSpecs) {
      switch (spec.from) {
        case 'json_field': {
          if (!spec.json_path) break;
          try {
            // Parse stdout as JSON and extract field
            let parsed = JSON.parse(stdout.trim());
            // If GET command returned a collection, take the first element
            if (Array.isArray(parsed)) parsed = parsed[0];
            if (!parsed) break;
            // Simple json_path: "$.Field" → parsed.Field
            const fieldName = spec.json_path.replace(/^\$\./, '');
            const value = fieldName.split('.').reduce((obj: any, key: string) => obj?.[key], parsed);
            if (value !== undefined && value !== null) {
              captures[spec.variable] = String(value);
            }
          } catch {
            // JSON parse failed — try line-by-line for PowerShell formatted output
            const fieldMatch = spec.json_path.replace(/^\$\./, '');
            const lineMatch = stdout.match(new RegExp(`${fieldMatch}\\s*[:=]\\s*(.+)`, 'i'));
            if (lineMatch) {
              captures[spec.variable] = lineMatch[1].trim();
            }
          }
          break;
        }
        case 'regex': {
          if (!spec.regex_pattern) break;
          const match = stdout.match(new RegExp(spec.regex_pattern));
          if (match && match[1]) {
            captures[spec.variable] = match[1];
          }
          break;
        }
        case 'stdout': {
          // Capture entire stdout (trimmed)
          captures[spec.variable] = stdout.trim();
          break;
        }
      }
    }

    return captures;
  }

  /**
   * Extract PowerShell module versions for evidence metadata.
   * Cached per engine on PowerShellAdapter instance to avoid repeated queries.
   */
  private async extractModuleVersions(engine: string): Promise<Record<string, string>> {
    // Check cache first
    if (this._moduleVersionCache.has(engine)) {
      return this._moduleVersionCache.get(engine)!;
    }

    const versions: Record<string, string> = {};

    if (!this.sessionManager) {
      return versions; // No session manager → no module version extraction
    }

    // Extract module versions for relevant PowerShell modules
    const modules = ['Microsoft.Graph', 'ExchangeOnlineManagement', 'Az'];

    for (const moduleName of modules) {
      try {
        const result = await this.executeViaSession(
          engine,
          `Get-Module -Name ${moduleName} | Select-Object Version | ConvertTo-Json`,
          false
        );

        if (result.exitCode === 0 && result.stdout.trim()) {
          try {
            const parsed = JSON.parse(result.stdout.trim());
            const versionStr = parsed?.Version || parsed?.version;
            if (versionStr) {
              // Version may be object {Major, Minor, Build, Revision} or string
              versions[moduleName] = typeof versionStr === 'string'
                ? versionStr
                : `${versionStr.Major || 0}.${versionStr.Minor || 0}.${versionStr.Build || 0}`;
            }
          } catch {
            // JSON parse failed — skip this module
          }
        }
      } catch {
        // Module query failed — skip this module
      }
    }

    // Cache the result
    this._moduleVersionCache.set(engine, versions);
    return versions;
  }

  // Phase 4.3: Idempotent upsert script builder.
  // Wraps the command in the appropriate idempotency pattern per RESEARCH_SUMMARY.md.
  private buildIdempotentScript(
    command: string,
    args: Record<string, any>,
    pattern: 'get-then-patch' | 'deterministic-guid-put' | 'safe-ps',
    variables: Record<string, any>
  ): string {
    const interpolated = this.interpolateVariables(command, variables);

    switch (pattern) {
      case 'get-then-patch': {
        // GET-then-UPDATE-or-CREATE pattern for CA policies, Intune policies.
        // Uses graph.microsoft.us endpoint per RESEARCH_SUMMARY.md Topic 1.
        const getCmd = args._get_command
          ? this.interpolateVariables(args._get_command as string, variables)
          : '';
        const lines: string[] = [
          '$ErrorActionPreference = "Stop"',
          '# GET-then-PATCH idempotency pattern (graph.microsoft.us)',
          `$existingResource = ${getCmd || '$null'}`,
          'if ($existingResource) {',
          '  # Resource exists — PATCH',
          `  ${interpolated}`,
          '} else {',
          '  # Resource absent — POST/NEW',
          `  ${interpolated}`,
          '}'
        ];
        return lines.join('\n');
      }

      case 'deterministic-guid-put': {
        // Deterministic GUID PUT for Sentinel rules — natively idempotent.
        // Derives GUID from displayName hash per RESEARCH_SUMMARY.md Topic 4.
        const displayName = (args.displayName as string) || command;
        const lines: string[] = [
          '$ErrorActionPreference = "Stop"',
          '# Deterministic-GUID PUT pattern (management.usgovcloudapi.net)',
          `$displayName = "${displayName}"`,
          '$guidBytes = [System.Security.Cryptography.MD5]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($displayName))',
          '$ruleId = [System.Guid]::new($guidBytes).ToString()',
          `# PUT to ARM using deterministic ruleId: $ruleId`,
          interpolated
        ];
        return lines.join('\n');
      }

      case 'safe-ps':
      default: {
        // Plain execution — no additional wrapping.
        return [
          '$ErrorActionPreference = "Stop"',
          interpolated,
          'Write-Output "STAMPER_EXECUTION_SUCCESS"'
        ].join('\n');
      }
    }
  }

  private buildScript(task: ExeTask, variables: Record<string, any>): string {
    const scriptLines: string[] = [];

    // Error handling setup
    scriptLines.push('$ErrorActionPreference = "Stop"');
    scriptLines.push('');

    // Import required modules if connecting to M365
    if (this.requiresM365Connection(task)) {
      // The Graph SDK pin must NOT load for Az-only commands: Microsoft.Graph.Authentication brings
      // its own Microsoft.Identity.Client into the AppDomain, and Az.Accounts' MSAL then fails with
      // "Method not found: ...WithLogging(IIdentityLogger, Boolean)" on Connect-AzAccount.
      const cmdLower = (task.action.command || '').toLowerCase();
      const usesGraph = /-mg[a-z]|connect-mggraph/.test(cmdLower) || !cmdLower;
      const usesExoOrIpps = /-transportrule|-dkimsigningconfig|-hostedcontentfilter|-omeconfiguration|connect-exchangeonline|-label\b|-labelpolicy|-dlpcompliancepolicy|-dlpcompliancerule|connect-ippssession/.test(cmdLower);
      if (usesGraph) {
        scriptLines.push('# Pin Microsoft.Graph.Authentication to the installed SDK version FIRST so the');
        scriptLines.push('# typed command DLLs bind to their matching Authentication.Core assembly. Without');
        scriptLines.push('# this, PowerShell loads the highest Authentication (e.g. a stray Beta 2.36.x) and');
        scriptLines.push('# the v1 cmdlets fail with "Could not load ... Authentication.Core, Version=2.35.x".');
        scriptLines.push('$__sdkVer = (Get-Module -ListAvailable Microsoft.Graph | Sort-Object Version -Descending | Select-Object -First 1).Version');
        scriptLines.push('if ($__sdkVer) { Import-Module Microsoft.Graph.Authentication -RequiredVersion $__sdkVer -Force -ErrorAction SilentlyContinue }');
      }
      if (usesGraph || usesExoOrIpps) {
        scriptLines.push('Import-Module ExchangeOnlineManagement -ErrorAction SilentlyContinue');
      }
      scriptLines.push('');

      // GCC High authentication
      if (this.config.gccHighEndpoints && !this.config.dryRun) {
        scriptLines.push('# Connect to M365 GCC High');
        scriptLines.push(this.buildGCCHighConnection(task.action.command));
        scriptLines.push('');
      }
    }

    // Execute commands
    if (task.action.args.powershell_commands && Array.isArray(task.action.args.powershell_commands)) {
      scriptLines.push('# Execute task commands');
      for (const command of task.action.args.powershell_commands) {
        const interpolatedCommand = this.interpolateVariables(command as string, variables);
        scriptLines.push(interpolatedCommand);
      }
    } else {
      const interpolatedCommand = this.interpolateVariables(task.action.command, variables);
      scriptLines.push(interpolatedCommand);
    }

    scriptLines.push('');
    scriptLines.push('# Output success marker');
    scriptLines.push('Write-Output "STAMPER_EXECUTION_SUCCESS"');

    return scriptLines.join('\n');
  }

  private requiresM365Connection(task: ExeTask): boolean {
    // Inspect BOTH the command string and args. AO commands carry the real cmdlet in
    // task.action.command (args is empty), so checking args alone missed them and no
    // Connect-* was ever injected → "Authentication needed" at runtime.
    const hay = (task.action.command + ' ' + JSON.stringify(task.action.args)).toLowerCase();
    return (
      /connect-(mggraph|exchangeonline|ippssession|microsoftteams|sposervice)/.test(hay) ||
      /\b(get|set|new|remove|update|invoke)-mg[a-z]/.test(hay) ||
      /\b(get|set|new|remove)-(transportrule|dkimsigningconfig|hostedcontentfilter|omeconfiguration)/.test(hay) ||
      /\b(get|set|new|remove)-(label|labelpolicy|dlpcompliancepolicy|dlpcompliancerule)\b/.test(hay) ||
      /\b(get|set|new|remove)-az[a-z]/.test(hay) ||
      // STAB-1 M2: Teams (Cs*) and SharePoint Online (SPO*) cmdlets — TaskRunner routes
      // the 'teams' and 'spo' engines to this adapter; the verb anchor keeps Export-Csv/
      // Import-Csv (verbs outside the list) from false-matching '-cs'.
      /\b(get|set|new|remove|grant)-cs[a-z]/.test(hay) ||
      /\b(get|set|new|remove)-spo[a-z]/.test(hay)
    );
  }

  /**
   * Single ces-tenant-backed source for Connect-* command strings
   * (G-TENANT-M1 acceptance gate 4). When a SessionManager is wired, its
   * `buildConnectCommand()` (ces-tenant `PersistentSessionFactory`) is THE
   * implementation; the direct-spawn fallback constructs a dry-run
   * SessionManager from this adapter's StamperConfig credentials so both
   * call sites converge on the same `ConnectionProfile` consumer instead of
   * maintaining a second set of hardcoded GCC High/USGov literals here.
   */
  private _fallbackConnectSource?: SessionManager;
  private connectCommandSource(): Pick<SessionManager, 'buildConnectCommand'> {
    if (this.sessionManager) return this.sessionManager;
    if (!this._fallbackConnectSource) {
      this._fallbackConnectSource = new SessionManager(
        {
          tenantId: this.config.tenantId,
          appId: this.config.appId,
          certThumbprint: this.config.certThumbprint,
          targetTenantDomain: this.config.domain || `${this.config.tenantId}.onmicrosoft.us`,
          subscriptionId: this.config.subscriptionId || undefined,
        },
        true /* dryRun — command construction only, never spawns */,
      );
    }
    return this._fallbackConnectSource;
  }

  private buildGCCHighConnection(command: string = ''): string {
    const c = command.toLowerCase();
    const needsIpps = /-label\b|-labelpolicy|-dlpcompliancepolicy|-dlpcompliancerule|connect-ippssession/.test(c);
    // ARM channel: verb-prefixed Az cmdlets (get-aznetwork..., new-azroute..., etc.). The verb
    // anchor avoids false hits on parameters like -AzureADAuthorizationEndpointUri in IPPS templates.
    const needsAz = /\b(get|set|new|remove|add|enable|disable)-az[a-z]|connect-azaccount/.test(c);
    // STAB-1 M2: Teams (Cs*) and SPO channels — TaskRunner routes both engines here and
    // ces-tenant supports both session types; without these branches a real-tenant
    // teams/spo task got NO Connect line. Verb anchor avoids Export-Csv/Import-Csv hits.
    const needsTeams = /\b(get|set|new|remove|grant)-cs[a-z]|connect-microsoftteams/.test(c);
    const needsSpo = /\b(get|set|new|remove)-spo[a-z]|connect-sposervice/.test(c);
    // A Set-Label/DLP command uses the Security & Compliance session, NOT the regular EXO session.
    const needsGraph = (/-mg[a-z]|connect-mggraph/.test(c) || (!c && !needsAz && !needsTeams && !needsSpo)) && !needsIpps;
    const needsExo = /-transportrule|-dkimsigningconfig|-hostedcontentfilter|-omeconfiguration|connect-exchangeonline/.test(c);
    const connect = this.connectCommandSource();
    const lines: string[] = [];

    lines.push('try {');
    if (needsGraph) {
      lines.push('  # Connect to Microsoft Graph (GCC High)');
      lines.push(`  ${connect.buildConnectCommand('graph')}`);
      lines.push('');
    }
    if (needsExo) {
      lines.push('  # Connect to Exchange Online (GCC High)');
      lines.push('  Import-Module ExchangeOnlineManagement -ErrorAction SilentlyContinue');
      lines.push(`  ${connect.buildConnectCommand('exchange')}`);
      lines.push('');
    }
    if (needsIpps) {
      lines.push('  # Connect to Security & Compliance PowerShell (IPPS/Purview, GCC High)');
      lines.push('  Import-Module ExchangeOnlineManagement -ErrorAction SilentlyContinue');
      lines.push(`  ${connect.buildConnectCommand('purview')}`);
      lines.push('');
    }
    if (needsAz) {
      lines.push('  # Connect to Azure Resource Manager (Azure Government, cert service principal)');
      lines.push('  Import-Module Az.Accounts -ErrorAction SilentlyContinue');
      lines.push(`  ${connect.buildConnectCommand('azure')}`);
      lines.push('');
    }
    if (needsTeams) {
      lines.push('  # Connect to Microsoft Teams (GCC High)');
      lines.push('  Import-Module MicrosoftTeams -ErrorAction SilentlyContinue');
      lines.push(`  ${connect.buildConnectCommand('teams')}`);
      lines.push('');
    }
    if (needsSpo) {
      // The ces-tenant SPO connect string carries its own Import-Module prefix.
      lines.push('  # Connect to SharePoint Online admin (GCC High/ITAR)');
      lines.push(`  ${connect.buildConnectCommand('sharepoint')}`);
      lines.push('');
    }
    lines.push('} catch {');
    lines.push('  Write-Error "Failed to connect to M365 GCC High: $_"');
    lines.push('  throw');
    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Neutralize a substituted VALUE against PowerShell command injection (G-ENG-1).
   *
   * Command templates interpolate values into a string that is then run via
   * `spawn('powershell.exe', ['-Command', script])`. Without escaping, a value like
   * `x'; Remove-Item C:\ -Recurse; '` breaks out of its quoting and runs arbitrary PowerShell
   * against the live tenant. This is a single chokepoint reached by BOTH ces-stamper commands and
   * ces-ao commands (AO imports this adapter), so one guard covers both.
   *
   * Defense-in-depth, two layers:
   *  1. REJECT values carrying shell-breakout / command-chaining metacharacters that a legitimate
   *     CES parameter (UPN, GUID, email, display name, resource name, rights list) never needs:
   *     backtick, `$(`, `${`, `;`, `|`, `&`, `<`, `>`, NUL, CR, LF. These are the injection
   *     signature — throwing is correct, not over-strict.
   *  2. ESCAPE single quotes by doubling (`'` -> `''`) so a value placed inside a single-quoted
   *     PowerShell string (the common template shape, e.g. '{policyDisplayName}') stays literal.
   *
   * Config-derived values (endpoints, tenant/app ids, thumbprints) pass unchanged — they contain
   * none of the rejected characters — so sanitizing uniformly is safe.
   */
  private sanitizePowerShellValue(key: string, value: any): string {
    const s = String(value);
    // Spaces are ALLOWED (display names + rights lists are legitimate; a space cannot execute
    // code). Reject only true breakout/chaining metacharacters, NUL, and line terminators.
    // eslint-disable-next-line no-control-regex
    const breakout = new RegExp('[`;|&<>\\x00\\r\\n]|\\$\\(|\\$\\{');
    const m = breakout.exec(s);
    if (m) {
      throw new Error(
        `PowerShell injection guard: parameter "${key}" contains a disallowed metacharacter ` +
          `(${JSON.stringify(m[0])}) and was rejected before command execution. ` +
          `CES parameters may not contain: \` ; | & < > $( \${ or newlines.`
      );
    }
    return s.replace(/'/g, "''");
  }

  private interpolateVariables(template: string, variables: Record<string, any>): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      // Placeholder-driven, like resolveTemplate: only a variable the template actually
      // references is sanitized and substituted. The plan-wide variables map carries entries
      // that never reach the command text (manifest desired_config passthroughs,
      // _drift_policies, _control_directives); stringifying those through the injection
      // guard rejects the whole task even though nothing is substituted.
      const dollarPattern = '\\$\\{' + key + '\\}';
      const bracePattern = '(?<![$\\w])\\{' + key + '\\}';
      if (!new RegExp(dollarPattern + '|' + bracePattern).test(result)) {
        continue;
      }
      const safe = this.sanitizePowerShellValue(key, value);
      // Support both ${key} (legacy) and {key} (registry/TemplateRegistry convention, same as
      // resolveTemplate). Do ${key} first; the {key} pass uses a negative lookbehind so it does
      // not re-touch the brace inside an already-handled ${key}.
      result = result.replace(new RegExp(dollarPattern, 'g'), safe);
      result = result.replace(new RegExp(bracePattern, 'g'), safe);
    }

    return result;
  }

  private async runSingleCommand(
    command: string,
    variables: Record<string, any>
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const interpolated = this.interpolateVariables(command, variables);
    const script = `$ErrorActionPreference = "Stop"\n${interpolated}`;
    return this.executePowerShell(script);
  }

  private executePowerShell(script: string, onStdout?: (chunk: string) => void): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const powershellProcess = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script
      // W4-ST3: pass the env explicitly — identical to the default in production, and it
      // makes the stacksim shadow (PSModulePath / STACKSIM_SERVER_URL) reach the child
      // even where `process` is a sandboxed copy (jest), so tests can never fall
      // through to the real Microsoft modules.
      ], { env: process.env });

      let stdout = '';
      let stderr = '';

      powershellProcess.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        if (onStdout) onStdout(str);
      });

      powershellProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershellProcess.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0
        });
      });

      powershellProcess.on('error', (error) => {
        reject(new Error(`Failed to spawn PowerShell process: ${error.message}`));
      });
    });
  }
}
