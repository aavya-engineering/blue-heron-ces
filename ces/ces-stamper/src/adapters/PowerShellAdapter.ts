// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'child_process';
import { ExeTask, ExecutionResult, SubCommand, CaptureSpec, StructuredEvidence, VerificationCriteria, OrgValueCheck, LookupMatch } from '../types/schema.types.js';
import { IEngineAdapter } from './IEngineAdapter.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { SessionManager } from '../core/SessionManager.js';
import { ENGINE_SESSION_MAP } from 'ces-shared/session';
import { scrubEnv } from 'ces-shared/secrets';
import { ExecutionContext } from '../core/ExecutionContext.js';
import { EVIDENCE_DIR, evidenceFileForEntry, evidenceDirForTenant, taskEvidencePath } from '../core/EvidenceReadinessAnalyzer.js';
import { recordWrittenEvidence, type EvidenceStore, type EvidenceFileLedger } from '../evidence/EvidenceStore.js';
import { assertNoUnresolvedTokens, findUnresolvedTokens, UnresolvedVariableError, evaluateDestructivePreview, type DestructivePreviewDecision } from '../core/CommandGuards.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { EvidenceStorageConfig } from '../config/ClientConfig.js';
import { resolveTemplate, PS_TOKEN_KINDS, maskSecretClassVariables, secretClassLiterals } from '../utils/templateResolver.js';
import { renderPs, psContext, psLiteral, psLiteralBody, psDoubleQuotedSafe } from 'ces-shared/security';
import { OutputVerificationEngine, VerificationResult } from '../core/OutputVerificationEngine.js';
import { EVIDENCE_NOT_SHOWN_OUTCOME } from '../core/ExecutionResultsCollector.js';
import { buildStructuredEvidence, writeAndUploadEvidence, deriveVerdict, buildFailureDiagnostics, failureCause, withCause, isEmptyReadResult, EMPTY_READ_REASON, stripExecutionMarker } from '../utils/structuredEvidence.js';
import { checkExistingOrgValues, describeOrgValueCheck, existingStateCriteria } from '../translators/orgValues.js';
import { verifyEquivalent } from '../registry/lookup.js';
import { RegistryEntrySnapshot } from '../types/schema.types.js';
import { deriveInverseOp, type AppliedOp } from '../rollback/InverseOps.js';
import { SECRET_SENTINEL_RE, containsSecretSentinel, secretSentinel } from '../core/secretSentinel.js';
import { SecretResolutionError } from '../core/SecretResolver.js';
import { tenantBaseDir } from '../core/EvidenceReadinessAnalyzer.js';
import { classifyEntry, loadCostGateReference, readCostAcks, recurringCostRunReportLine, formatEstimate, type CostGateReference } from '../core/CostGate.js';
import { runDp2, getProcessCostGateRuntime, type CostGateRuntime } from './CostGateDp2.js';

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

// synthetic-customer W3 (F-3): isEmptyReadResult (a read that found nothing). PH-13: it now lives in
// utils/structuredEvidence.ts, so assessOutcome can use it; re-exported here for existing importers.
export { isEmptyReadResult, EMPTY_READ_REASON };

/** PH-11 (founder Q3, 2026-11-01): the reason a read-only prohibition read that came back empty is NOT_SAT. */
export const PROHIBITION_EMPTY_READ_REASON = EMPTY_READ_REASON;

/**
 * PH-11 (founder Q3, 2026-11-01): one read of a read-only document-prohibition task. A successful
 * read with nothing in it (isEmptyReadResult, or ResourceNotFound) is not honest evidence that the
 * prohibited capability is absent: not shown. A read with content, including one that shows the
 * capability off (`false`, `{"state":"disabled"}`), is shown. The CLI evidence-only route and the
 * GUI read-only branch (execute.routes.ts) both judge with this, so CLI = GUI.
 */
export function judgeProhibitionRead(exitCode: number, rawOutput: string): { shown: boolean; reason: string } {
  if (exitCode !== 0) return { shown: false, reason: `read failed (exit code ${exitCode})` };
  const text = stripExecutionMarker(rawOutput);
  if (isEmptyReadResult(text) || text.includes('ResourceNotFound')) return { shown: false, reason: PROHIBITION_EMPTY_READ_REASON };
  return { shown: true, reason: '' };
}

/**
 * PH-13 (founder Q3, 2026-11-01): one evidence read of ANY task (a sub-command with no set_command),
 * judged by the PH-11 rule: a read that failed, or succeeded with nothing in it, is not shown.
 * The CLI and the GUI execute through this adapter, so both judge every evidence-only read alike.
 */
export function judgeEvidenceRead(exitCode: number, rawOutput: string): { shown: boolean; reason: string } {
  return judgeProhibitionRead(exitCode, rawOutput);
}

/** PH-13: the manifest outcome word of a control whose task completed but an evidence read showed nothing. */
export { EVIDENCE_NOT_SHOWN_OUTCOME };

/**
 * PH-13: directives whose tasks keep their own result rule. The GUI routes them to their own handlers
 * (execute.routes.ts: document-absence, inherit-fedramp, eo-tooled, document-renderable, nonstack), a manual
 * directive is a manual gate, and a read-only document-prohibition keeps PH-11's "any read shows" rule.
 */
const EVIDENCE_RULE_EXEMPT_DIRECTIVES = new Set(['document-absence', 'document-renderable', 'inherit-fedramp', 'eo-tooled', 'nonstack', 'manual', 'skip']);

/**
 * PH-13 (founder Q3): does this task's result follow the empty-read rule? Every registry task does (implement,
 * validate, automated, and a document-prohibition that takes the task path), except a manual gate and the
 * directives above. Such a task completes as before, but each control it names records NOT_SAT
 * ('evidence_not_shown') when any of its evidence reads showed nothing (output.evidenceShown === false).
 */
export function evidenceReadRuleApplies(task: Pick<ExeTask, 'action'>, subCommands: Array<{ set_command?: string }>): boolean {
  if (task.action?.engine === 'manual_gate') return false;
  const directive = String(task.action?.args?._directive ?? '');
  if (EVIDENCE_RULE_EXEMPT_DIRECTIVES.has(directive)) return false;
  if (directive === 'document-prohibition' && !prohibitionTakesTaskPath(subCommands)) return false;
  return true;
}

/** PH-13: the task output of a task whose evidence reads did not all show content. */
export interface EvidenceNotShownOutput { evidenceShown: false; evidenceReason: string; text: string }

/** PH-13: true when a task's stored output says an evidence read showed nothing (CLI predicate, GUI branch). */
export function isEvidenceNotShown(output: unknown): boolean {
  return !!output && typeof output === 'object' && (output as { evidenceShown?: unknown }).evidenceShown === false;
}

/** PH-13: mark one evidence record as an empty read (NOT_SAT, the plain reason), whatever its idempotency tag. */
export function markEmptyEvidenceRecord(evidence: StructuredEvidence): void {
  evidence.outcome = 'partial_success';
  evidence.outcomeRationale = 'Command completed but expected data output was empty';
  evidence.complianceVerdict = 'NOT_SAT';
  evidence.verdictRationale = EMPTY_READ_REASON;
}

/**
 * PH-8 (R-F5 Q1): a document-prohibition task holding any sub-command with a non-empty
 * set_command runs through the normal task path (TaskRunner / PowerShellAdapter get-then-set),
 * as the CLI does. Only all-read-only prohibition tasks take the GUI's read-only branch.
 * PH-11: moved here from execute.routes.ts (which re-exports it) so the CLI route uses it too.
 */
export function prohibitionTakesTaskPath(subCommands: Array<{ set_command?: string }>): boolean {
  return subCommands.some(s => typeof s.set_command === 'string' && s.set_command.trim() !== '');
}

/** synthetic-customer W3: what a written entry record tells the config_export postchecks. */
export interface EntryStateRecord {
  entryId: string;
  controlIds: string[];
  postcheckMode?: 'state' | 'presence';
  verdict?: string;
  statePassed: boolean;
  stateOutput?: string;
}


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

/** FIN-22: the sessions an AO task declares (task.action.args._sessions, read from its cmdlet families). */
function declaredSessions(task: ExeTask): string[] {
  const s = (task.action?.args as Record<string, unknown> | undefined)?._sessions;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : [];
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
  /** W1: variable -> where its overlay value came from (e.g. 'environment'); names only, never values. */
  private secretProvenance: Record<string, string> = {};
  /** FX-05: per-task evidence records written in this run (feeds the report's evidence_collected). */
  private writtenEvidence: Set<string> = new Set();
  /** FLOW-2b: the run's store and plan; every evidence file written gets one WORM metadata row. */
  private evidenceLedger?: { store: EvidenceStore; planId: string };
  /** synthetic-customer W3: per entry, the last record written in this run (read by config_export postchecks). */
  private entryStateRecords: Map<string, EntryStateRecord> = new Map();
  /** PH7-ST: tasks whose sub-commands a manual gate ran; their records carry metadata.gateContext 'manual_gate'. */
  private gateContextTasks: Set<string> = new Set();
  /** FX-05: runtime variable -> entries in the plan that capture it ("entryId (taskId)"). */
  private captureProducers: Record<string, string[]> = {};
  /** P3 test flag `--force-fail <entryId>`: entries whose SET is never sent; the task fails. */
  private forcedFailures: Set<string> = new Set();
  /** P3: forced failures that fired in this run, as { entry_id, task_id }. */
  private firedForcedFailures: Array<{ entry_id: string; task_id: string }> = [];
  /** SP-1 (R1): plain values found on secret-class variables (name -> value). Never rendered; redacted from output. */
  private secretLiterals: Record<string, string> = {};
  /** GATE-RUN: the tenant slug (cost-acks.json and cost-gate evidence live in its plan-data folder). */
  private tenantSlug?: string;
  /** GATE-RUN: how this run gives DP-2 (else the process runtime; neither = refused). */
  private costGateRuntime?: CostGateRuntime;
  private costGateRef?: CostGateReference;
  /** GATE-RUN: recurring entries whose SET this run sent after DP-1 and DP-2. */
  private recurringEnabled: Array<{ entry_id: string; estimate_month_low: number; estimate_month_high: number }> = [];

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
    this.tenantSlug = tenantSlug;
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
  /** FX-05: number of per-task evidence records this adapter wrote in this run. */
  getWrittenEvidenceCount(): number {
    return this.writtenEvidence.size;
  }

  /** synthetic-customer W3: the entry records written in this run (last one per entry). */
  getEntryStateRecords(): EntryStateRecord[] {
    return [...this.entryStateRecords.values()];
  }

  /** FX-05: which plan entries capture each runtime variable (named in "stopped" records). */
  setCaptureProducers(producers: Record<string, string[]>): void {
    this.captureProducers = { ...producers };
  }

  /** P3 test flag: entry ids that fail on purpose after their GET, without their SET. */
  setForcedFailures(entryIds: string[]): void {
    this.forcedFailures = new Set(entryIds);
  }

  /** P3: forced failures that fired in this run. */
  getFiredForcedFailures(): Array<{ entry_id: string; task_id: string }> {
    return [...this.firedForcedFailures];
  }

  setSecretOverlay(overlay: Record<string, string>): void {
    this.secretOverlay = { ...overlay };
  }

  /** GATE-RUN: how this run gives DP-2 (mode, terminal, prompt). Unset = the process runtime, else refused. */
  setCostGateRuntime(runtime: CostGateRuntime | undefined): void {
    this.costGateRuntime = runtime;
  }

  /** GATE-RUN: recurring entries this run enabled (DP-1 and DP-2 given, SET sent). */
  getRecurringCostEnabled(): Array<{ entry_id: string; estimate_month_low: number; estimate_month_high: number }> {
    return [...this.recurringEnabled];
  }

  /** GATE-RUN: the run-report line (COST-GATE-SPEC §3.9). */
  getRecurringCostRunReportLine(): string {
    return recurringCostRunReportLine(this.recurringEnabled, this.getCostGateRef().estimates.price_date);
  }

  private getCostGateRef(): CostGateReference {
    if (!this.costGateRef) this.costGateRef = loadCostGateReference();
    return this.costGateRef;
  }

  /** W1: provenance of overlay values, stamped on evidence of entries that use them. */
  setSecretProvenance(provenance: Record<string, string>): void {
    this.secretProvenance = { ...provenance };
  }

  /** FLOW-2b: record a WORM stamper_evidence_metadata row for each evidence file this adapter writes. */
  setEvidenceLedger(store: EvidenceStore, planId: string): void {
    this.evidenceLedger = { store, planId };
  }

  /** W1: replace every overlay value in `text` with its sentinel (output, stream chunks, errors). */
  private redactSecrets(text: string): string {
    let out = text;
    // SP-1 (R1): a secret-class variable is redacted whatever its source, not only overlay values.
    const values: Array<[string, string]> = [...Object.entries(this.secretOverlay), ...Object.entries(this.secretLiterals)];
    for (const [name, value] of values) {
      if (!value) continue;
      // SEC-3: a value substituted into a single-quoted literal travels with its quotes doubled.
      let escaped: string | undefined;
      try {
        escaped = psLiteralBody(value);
      } catch {
        escaped = undefined;
      }
      if (escaped && escaped !== value) out = out.split(escaped).join(secretSentinel(name));
      out = out.split(value).join(secretSentinel(name));
    }
    return out;
  }

  /**
   * FC-ST-3 step 2: swap every `<<CES_SECRET:name>>` sentinel in `command` for its resolved
   * value. Throws `SecretResolutionError` — blocking the task, never running with the sentinel
   * literal or a blank value — when a sentinel names a variable the overlay doesn't have.
   * A command with no sentinel is returned unchanged (the common case; cheap early-out).
   *
   * SEC-3: the substitution is context-aware. Each sentinel's PowerShell quoting context is read
   * with the SEC-1 lexer (psContext) on a shadow copy of the command: single-quoted -> psLiteralBody
   * (quotes doubled; inside a here-string only the line-break check), double-quoted ->
   * psDoubleQuotedSafe, unquoted -> rejected. A rejection is a SecretResolutionError that names the
   * variable and the rule, never the value or the offending character.
   */
  private applySecretOverlay(command: string): string {
    if (!containsSecretSentinel(command)) return command;
    let n = 0;
    const shadow = command.replace(SECRET_SENTINEL_RE, () => `{__ces_secret_${n++}__}`);
    const contexts = new Map<number, ReturnType<typeof psContext>[number]>();
    for (const ph of psContext(shadow)) {
      const m = /^__ces_secret_(\d+)__$/.exec(ph.name);
      if (m) contexts.set(Number(m[1]), ph);
    }
    let i = 0;
    return command.replace(SECRET_SENTINEL_RE, (_match, name: string) => {
      const ph = contexts.get(i++);
      const value = this.secretOverlay[name];
      if (!value && this.secretLiterals[name] !== undefined) {
        // SP-1 (R1): a plain value on a secret-class variable is refused, never sent.
        throw new SecretResolutionError(
          name,
          `SECRET_LITERAL_REFUSED: variable "${name}" holds a plain value; a secret-class variable is ` +
            'only taken by reference (secret_references), so the task was blocked.'
        );
      }
      if (!value) {
        throw new SecretResolutionError(
          name,
          `SECRET_UNRESOLVED: variable "${name}" is required by this command but no resolved value ` +
            'is available — supply it at Configure time before this task can run.'
        );
      }
      if (!ph || ph.context === 'bare') {
        throw new SecretResolutionError(
          name,
          `SECRET_CONTEXT_BARE: secret variable "${name}" sits in an unquoted position in this command; ` +
            'a secret is only substituted inside a quoted string, so the task was blocked.'
        );
      }
      try {
        if (ph.context === 'double') return psDoubleQuotedSafe(value);
        if (ph.quote === 'here-single') {
          psLiteralBody(value);
          return value;
        }
        return psLiteralBody(value);
      } catch (err) {
        const code = (err as { code?: string })?.code ?? 'PS_GUARD';
        throw new SecretResolutionError(
          name,
          `SECRET_CONTEXT_REJECTED: secret variable "${name}" cannot be placed in its ${ph.context}-quoted ` +
            `position in this command (PowerShell injection guard ${code}), so the task was blocked.`
        );
      }
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
    if (task.action.args._gate_context === 'manual_gate') this.gateContextTasks.add(task.id);
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
      ? this.resolveInContext(getCommand, variablesRequired, variablesRuntime)
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
      ? this.resolveInContext(getCommand, variablesRequired, variablesRuntime)
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

      // synthetic-customer W3 (F-3): an empty collection envelope is "absent", not "exists".
      if (result.exitCode === 0 && strippedStdout.trim() && !strippedStdout.includes('ResourceNotFound') && !isEmptyReadResult(strippedStdout)) {
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
      // W5c3 part 2 (ST-C3): a record names its own entry's controls, not the task's union.
      control_ids: sub.control_ids ?? _task.controls,
      get_command: sub.get_command, set_command: sub.set_command,
      evidence_commands: sub.evidence_commands,
    });

    // FX-05: failure record that keeps what verification saw — SET output, pre/post GET
    // output, verification details and the reason — instead of an empty output.
    const writeFailureEvidence = async (sub: SubCommand, f: {
      setStdout: string; setStderr: string; exitCode: number; reason: string;
      preState?: string; postState?: string; stateChanged?: boolean;
      verificationResult?: VerificationResult; preview?: DestructivePreviewDecision;
      commandExecuted?: string;
      // W5c3: the command whose output explains the failure (default: the SET's own exit/stdout/stderr).
      diagnosticSource?: { exitCode: number; stdout: string; stderr: string };
      orgValueChecks?: OrgValueCheck[];
      lookupMatch?: LookupMatch;
    }): Promise<void> => {
      const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
      try {
        const moduleVersions = await this.extractModuleVersions(sub.engine);
        const evidence = buildStructuredEvidence(
          f.setStdout, f.exitCode, f.setStderr, null,
          sub, _task, variables, moduleVersions, buildSnapshot(sub),
          { getCommandOutput: f.preState, postStateOutput: f.postState, stateChanged: f.stateChanged, verificationResult: f.verificationResult, consistency_hint: sub.verification?.consistency_hint, orgValueChecks: f.orgValueChecks, lookupMatch: f.lookupMatch }
        );
        evidence.outcome = 'failed_no_remediation';
        // W5c3: exit code, stdout / stderr tails and any HTTP status / body of the failing command;
        // the rationale names the cause (first stderr line or the HTTP error message).
        const src = f.diagnosticSource ?? { exitCode: f.exitCode, stdout: f.setStdout, stderr: f.setStderr };
        const diagnostics = buildFailureDiagnostics(src.exitCode, this.redactSecrets(src.stderr), this.redactSecrets(src.stdout));
        evidence.failureDiagnostics = diagnostics;
        // W5c3: an existing resource outside an org-value bound says what was read and the bound.
        const boundNote = (f.orgValueChecks ?? []).map(describeOrgValueCheck).join('; ');
        evidence.outcomeRationale = withCause(`SET/verification failed: ${f.reason.substring(0, 500)}`, failureCause(diagnostics))
          + (boundNote ? ` (${boundNote})` : '');
        const { verdict, rationale } = deriveVerdict('failed_no_remediation');
        evidence.complianceVerdict = verdict;
        evidence.verdictRationale = boundNote ? `${rationale} (${boundNote})` : rationale;
        if (f.preview) evidence.destructivePreview = f.preview;
        if (f.commandExecuted) evidence.metadata.commandExecuted = f.commandExecuted;
        await this.writeEvidence(_task.id, evidFile, evidence);
      } catch { /* best-effort */ }
    };

    // FX-01: a sub-command blocked before anything was sent (unfilled variable, refused
    // destructive preview). Recorded as a failure with its reason; never executed.
    const recordBlocked = async (sub: SubCommand, reason: string, command: string, extra?: { preState?: string; preview?: DestructivePreviewDecision }): Promise<void> => {
      console.log(`[PowerShellAdapter] ${sub.id} — ${reason}`);
      if (onStream) {
        onStream({
          phase: 'set_command', subId: sub.id, label: sub.label,
          engine: sub.engine, command,
          stdout: '', stderr: reason,
          exitCode: 1, durationMs: 0,
        });
      }
      results.push({
        sub_command_id: sub.id, success: false,
        stdout: '', stderr: reason,
        exitCode: 1, durationMs: 0,
      });
      overallSuccess = false;
      failureReasons.push(`${sub.id}: ${reason}`);
      await writeFailureEvidence(sub, { setStdout: '', setStderr: reason, exitCode: 1, reason, preState: extra?.preState, preview: extra?.preview });
    };

    // FX-05: a sub-command whose placeholders cannot be resolved stops the task before any
    // command is sent. Leave a record naming the reason, the unresolved names and the plan
    // entries expected to produce them, then rethrow so the task still stops as before.
    const resolveOrRecord = async (template: string, sub: SubCommand): Promise<string> => {
      try {
        return this.resolveCommand(template, sub, variables);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const m = message.match(/^Unresolved (?:manifest|runtime) variables: ([^.]+)\./);
        if (m) {
          const names = m[1].split(',').map(n => n.trim()).filter(Boolean);
          const producers = names
            .map(n => `${n} <- ${(this.captureProducers[n] ?? []).join(', ') || 'no producing entry in this plan'}`)
            .join('; ');
          await writeFailureEvidence(sub, {
            setStdout: '', setStderr: message, exitCode: 1,
            reason: `stopped before execution: ${message} Expected producers: ${producers}`,
          });
        }
        throw err;
      }
    };

    console.log(`[PowerShellAdapter] executeSubCommands — ${subCommands.length} total sub-commands for task ${_task.id}`);
    // PH-11 (founder Q3): a read-only document-prohibition task (the CLI twin of the GUI read-only branch)
    // is judged on its reads: shown when any read has content; an empty successful read is not shown.
    const prohibitionReadOnly = _task.action?.args?._directive === 'document-prohibition' && !prohibitionTakesTaskPath(subCommands);
    const prohibitionSubs: Array<{ subId: string; shown: boolean; reason: string }> = [];
    // PH-13 (founder Q3): every other registry task is judged on each evidence read too. A sub-command
    // with no set_command shows evidence when any of its evidence reads has content; when none does,
    // its controls record NOT_SAT (EVIDENCE_NOT_SHOWN_OUTCOME). The task still completes.
    const evidenceRule = !prohibitionReadOnly && !dryRun && evidenceReadRuleApplies(_task, subCommands);
    const evidenceNotShown: Array<{ sub: SubCommand; index: number; reason: string }> = [];
    let subIndex = 0;
    for (const sub of subCommands) {
      subIndex++;
      // W5c3 part 2 follow-up: a verify-only entry (lookup, no SET) verifies the object another entry
      // created (the merged update ring). Found: verified as on the exists path (CES's object by its rule,
      // an equivalent by effect). Absent or unreadable: a failed record naming the reason. Never a SET.
      if (sub.verify_only && sub.lookup && sub.get_command && !dryRun) {
        const resolvedGet = await resolveOrRecord(sub.get_command, sub);
        const getLeft = findUnresolvedTokens(resolvedGet);
        if (getLeft.length > 0) {
          await recordBlocked(sub, new UnresolvedVariableError(getLeft).message, resolvedGet);
          if (sub.on_failure === 'abort_step') break;
          continue;
        }
        let getRes: { stdout: string; stderr: string; exitCode: number };
        try {
          getRes = await this.executeViaSession(sub.engine, resolvedGet, false);
        } catch (err) {
          getRes = { stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: 1 };
        }
        const read = getRes.stdout.replace(/\r?\nSTAMPER_EXECUTION_SUCCESS\s*$/, '').replace(/^STAMPER_EXECUTION_SUCCESS\r?\n?$/, '');
        const present = getRes.exitCode === 0 && read.trim() !== '' && !(read + ' ' + getRes.stderr).includes('ResourceNotFound') && !isEmptyReadResult(read);
        let verification: VerificationResult | undefined;
        let match: LookupMatch | undefined;
        let orgChecks: OrgValueCheck[] | undefined;
        if (present && sub.verification?.evidence) {
          orgChecks = checkExistingOrgValues(read, sub.org_values);
          const equivalent = verifyEquivalent(read, sub.lookup, sub.org_values, (v: string) => this.resolveComparisonValue(v, sub, variables));
          match = equivalent ? equivalent.match : { basis: 'name', object: this.resolveComparisonValue(sub.lookup.by_name.equals, sub, variables) };
          verification = equivalent ? equivalent.verification : new OutputVerificationEngine().verify(
            { stdout: '', stderr: '', exitCode: 0 }, { stdout: read, exitCode: 0 },
            existingStateCriteria(this.resolveVerification(sub.verification, sub, variables), sub.org_values)!,
            { stateChanged: false },
          );
        }
        if (!present || !verification?.passed) {
          const reason = !present
            ? `${sub.id}: verify-only: no '${sub.lookup.by_name.equals}' or equivalent found (this entry never creates; another entry in the plan creates it)`
            : `${sub.id}: verification failed on existing resource — ${verification!.reason}`;
          results.push({ sub_command_id: sub.id, success: false, stdout: getRes.stdout, stderr: reason, exitCode: 1, durationMs: 0 });
          overallSuccess = false;
          failureReasons.push(reason);
          await writeFailureEvidence(sub, {
            setStdout: '', setStderr: reason, exitCode: 1, reason,
            preState: getRes.stdout, stateChanged: false, verificationResult: verification,
            commandExecuted: '[verify-only: SET not sent]',
            diagnosticSource: { exitCode: getRes.exitCode, stdout: getRes.stdout, stderr: getRes.stderr },
            orgValueChecks: orgChecks, lookupMatch: match,
          });
          if (sub.on_failure === 'abort_step') break;
          if (sub.on_failure === 'abort_plan') throw new Error(reason);
          continue;
        }
        results.push({ sub_command_id: sub.id, success: true, stdout: `[verify-only] ${sub.label} — verified`, stderr: '', exitCode: 0, durationMs: 0 });
        const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
        try {
          const moduleVersions = await this.extractModuleVersions(sub.engine);
          const evidence = buildStructuredEvidence(
            getRes.stdout, 0, '', null, sub, _task, variables, moduleVersions, buildSnapshot(sub),
            { idempotentSkip: true, getCommandOutput: getRes.stdout, verificationResult: verification, consistency_hint: sub.verification?.consistency_hint, orgValueChecks: orgChecks, lookupMatch: match },
          );
          evidence.metadata.commandExecuted = '[verify-only: SET not sent]';
          await this.writeEvidence(_task.id, evidFile, evidence);
        } catch { /* evidence logging is best-effort */ }
        allStdout.push(`[verify-only] ${sub.id}: verified`);
        continue;
      }

      // Skip entries with no set_command (manual_only / evidence-only)
      if (!sub.set_command || sub.set_command.trim() === '') {
        console.log(`[PowerShellAdapter] [${subIndex}/${subCommands.length}] ${sub.id} — evidence-only (no set_command)`);
        // PH-11: this sub-command's reads, judged when the task is a read-only prohibition.
        const subReads: Array<{ shown: boolean; reason: string }> = [];
        // PH-13: this sub-command's evidence reads (any task), judged for the record and the task.
        const evidReads: Array<{ shown: boolean; reason: string }> = [];
        // Evidence-only entries: run GET + extractCaptures for downstream chaining
        if (sub.get_command && sub.captures && sub.captures.length > 0 && !dryRun) {
          try {
            const resolvedGetCmd = this.resolveCommand(sub.get_command, sub, variables);
            const getStart = Date.now();
            const getResult = await this.executeViaSession(sub.engine, resolvedGetCmd, false);
            if (prohibitionReadOnly) subReads.push(judgeProhibitionRead(getResult.exitCode, getResult.stdout));
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
              // PH-11 / PH-13 (founder Q3): an empty successful evidence read is NOT_SAT, with the plain
              // reason, on every task (PH-11 covered read-only prohibitions only).
              const evidenceRead = judgeEvidenceRead(evidResult.exitCode, evidResult.stdout);
              if (prohibitionReadOnly) subReads.push(evidenceRead);
              // A sub-command whose earlier evidence read already showed content keeps that record.
              const keepEarlierRecord = !evidenceRead.shown && evidReads.some(r => r.shown);
              evidReads.push(evidenceRead);
              const markEmptyProhibitionRead = (evidence: StructuredEvidence): void => {
                if (!evidenceRead.shown && evidResult.exitCode === 0) markEmptyEvidenceRecord(evidence);
              };
              if (onStream) {
                onStream({
                  phase: 'evidence_command', subId: sub.id, label: sub.label,
                  engine: sub.engine, command: resolved,
                  stdout: evidResult.stdout, stderr: evidResult.stderr,
                  exitCode: evidResult.exitCode, durationMs: Date.now() - evidStart,
                });
              }
              // Write evidence file (best-effort)
              if (keepEarlierRecord) {
                // PH-13: one record per sub-command; an empty later read never overwrites a shown one.
              } else if (evidResult.stdout.trim()) {
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
                  markEmptyProhibitionRead(evidence);
                  const { blobUrl } = await this.writeEvidence(_task.id, evidFile, evidence);
                  if (onStream && blobUrl) {
                    onStream({ phase: 'evidence_save', subId: sub.id, label: sub.label,
                      engine: sub.engine, command: `PUT ${blobUrl}`, stdout: 'uploaded',
                      stderr: '', exitCode: 0, durationMs: 0, evidenceFile: blobUrl });
                  }
                } catch { /* evidence logging is best-effort */ }
              } else if (evidResult.exitCode === 0) {
                // Evidence-only with exitCode 0 and empty stdout. PH-13 (founder Q3): not a valid empty
                // result; the record is NOT_SAT with the plain reason (markEmptyProhibitionRead). A count
                // whose honest answer is zero is re-aimed in the registry to emit {"count":0}.
                const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                try {
                  const moduleVersions = await this.extractModuleVersions(sub.engine);
                  const evidence = buildStructuredEvidence(
                    '', evidResult.exitCode, evidResult.stderr, null,
                    sub, _task, variables, moduleVersions, buildSnapshot(sub)
                  );
                  markEmptyProhibitionRead(evidence);
                  await this.writeEvidence(_task.id, evidFile, evidence);
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
                  evidence.failureDiagnostics = buildFailureDiagnostics(evidResult.exitCode, evidResult.stderr, evidResult.stdout);
                  evidence.outcomeRationale = withCause(`Evidence command failed: ${evidResult.stderr.substring(0, 200)}`, failureCause(evidence.failureDiagnostics));
                  const { verdict, rationale } = deriveVerdict('failed_no_remediation');
                  evidence.complianceVerdict = verdict;
                  evidence.verdictRationale = rationale;
                  await this.writeEvidence(_task.id, evidFile, evidence);
                } catch { /* best-effort */ }
              }
            } catch (evidErr) {
              // PH-13: a read that threw showed nothing.
              evidReads.push({ shown: false, reason: `read failed (${(evidErr instanceof Error ? evidErr.message : String(evidErr)).substring(0, 120)})` });
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
        if (prohibitionReadOnly && subReads.length > 0) {
          const shownRead = subReads.find(r => r.shown);
          prohibitionSubs.push({ subId: sub.id, shown: !!shownRead, reason: shownRead ? '' : subReads[subReads.length - 1].reason });
        }
        if (evidenceRule && evidReads.length > 0 && !evidReads.some(r => r.shown)) {
          evidenceNotShown.push({ sub, index: subIndex - 1, reason: evidReads[evidReads.length - 1].reason });
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
          await this.writeEvidence(_task.id, evidFile, evidence);

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
      const resolvedGetCmd = sub.get_command ? await resolveOrRecord(sub.get_command, sub) : '';
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

      // FX-01: never send a GET that still carries an unfilled {name} token.
      const getLeftover = resolvedGetCmd ? findUnresolvedTokens(resolvedGetCmd) : [];
      if (getLeftover.length > 0) {
        const reason = new UnresolvedVariableError(getLeftover).message;
        await recordBlocked(sub, reason, resolvedGetCmd);
        if (sub.on_failure === 'abort_step') break;
        if (sub.on_failure === 'abort_plan') throw new Error(`Sub-command ${sub.id} ${reason}`);
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

          // Idempotent skip: only for get-then-set pattern (never for a forced failure, P3)
          if (sub.idempotency === 'get-then-set' && !this.forcedFailures.has(sub.id)) {
            // If GET succeeds (exit 0) and returns content, the resource may already exist.
            // Check both stdout AND stderr for ResourceNotFound — Azure cmdlets put 404 in stderr.
            const strippedGetOutput = getResult.stdout
              .replace(/\r?\nSTAMPER_EXECUTION_SUCCESS\s*$/, '')
              .replace(/^STAMPER_EXECUTION_SUCCESS\r?\n?$/, '');
            const _getCombined = strippedGetOutput + ' ' + getResult.stderr;
            // synthetic-customer W3 (F-3): an empty collection envelope ({"value": []}) is absent.
            if (getResult.exitCode === 0 && strippedGetOutput.trim() && !_getCombined.includes('ResourceNotFound') && !isEmptyReadResult(strippedGetOutput)) {
              // Resource exists — for New-* or POST creation commands this means skip creation
              const isCreationCommand = /^New-|^New[A-Z]|^try\s*\{\s*New-|^\$\w+\s*=.*New-/.test(sub.set_command.trim()) ||
                /Invoke-MgGraphRequest\s[^|]*-Method\s+POST/i.test(sub.set_command);
              // synthetic-customer W3: a creation entry is SAT on this path only when its evidence
              // rule passes on the GET that found the resource (the re-read of current state); a
              // failed check is a failed entry, never an unverified skip. W3 (Stamper slice): the
              // default for every creation entry with an evidence rule; `verify_on_exists: false`
              // opts out. The resource's captured ids are registered first, because the resource
              // exists even when its state is wrong.
              let existsVerification: VerificationResult | undefined;
              let existsOrgValueChecks: OrgValueCheck[] | undefined;
              let existsLookupMatch: LookupMatch | undefined;
              if (isCreationCommand && sub.verification?.verify_on_exists !== false && sub.verification?.evidence) {
                if (sub.captures && sub.captures.length > 0 && this.executionContext) {
                  this.executionContext.registerCaptures(this.extractCaptures(sub.captures, getResult.stdout));
                }
                // W5c3: an existing resource meets an org-value binding when its value is within the
                // bound (lte: [1, configured]; gte: >= configured); the record says what it read.
                existsOrgValueChecks = checkExistingOrgValues(strippedGetOutput, sub.org_values);
                // W5c3 part 2: an entry with a lookup block whose GET found a tenant equivalent (not
                // CES's object by name) is verified against the block's effect conditions (org-value
                // bounds applied) and its assignment requirement; CES's own object keeps the entry's rule.
                const equivalent = sub.lookup
                  ? verifyEquivalent(strippedGetOutput, sub.lookup, sub.org_values, (v: string) => this.resolveComparisonValue(v, sub, variables))
                  : undefined;
                if (sub.lookup) existsLookupMatch = equivalent ? equivalent.match : { basis: 'name', object: this.resolveComparisonValue(sub.lookup.by_name.equals, sub, variables) };
                existsVerification = equivalent ? equivalent.verification : new OutputVerificationEngine().verify(
                  { stdout: '', stderr: '', exitCode: 0 },
                  { stdout: strippedGetOutput, exitCode: getResult.exitCode },
                  existingStateCriteria(this.resolveVerification(sub.verification, sub, variables), sub.org_values)!,
                  { stateChanged: false }
                );
                if (onStream) {
                  onStream({
                    phase: 'verification', subId: sub.id, label: sub.label,
                    engine: sub.engine, command: '',
                    stdout: JSON.stringify(existsVerification, null, 2), stderr: '',
                    exitCode: existsVerification.passed ? 0 : 1, durationMs: 0,
                    verification: existsVerification,
                  });
                }
                if (!existsVerification.passed) {
                  const reason = `${sub.id}: verification failed on existing resource — ${existsVerification.reason}`;
                  results.push({ sub_command_id: sub.id, success: false, stdout: getResult.stdout, stderr: reason, exitCode: 1, durationMs: 0 });
                  overallSuccess = false;
                  failureReasons.push(reason);
                  await writeFailureEvidence(sub, {
                    setStdout: '', setStderr: reason, exitCode: 1, reason,
                    preState: getResult.stdout, stateChanged: false, verificationResult: existsVerification,
                    commandExecuted: '[already exists: SET not sent]',
                    diagnosticSource: { exitCode: getResult.exitCode, stdout: getResult.stdout, stderr: getResult.stderr },
                    orgValueChecks: existsOrgValueChecks,
                    lookupMatch: existsLookupMatch,
                  });
                  if (sub.on_failure === 'abort_step') break;
                  if (sub.on_failure === 'abort_plan') throw new Error(reason);
                  continue;
                }
              }
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
                      { idempotentSkip: true, getCommandOutput: getResult.stdout, verificationResult: existsVerification, consistency_hint: sub.verification?.consistency_hint, orgValueChecks: existsOrgValueChecks, lookupMatch: existsLookupMatch }
                    );
                    await this.writeEvidence(_task.id, evidFile, evidence);
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

      // P3 test flag `--force-fail <entryId>`: fail after the GET, never send the SET.
      if (this.forcedFailures.has(sub.id)) {
        const reason = `forced failure (test flag): ${sub.id}`;
        const flagNote = `--force-fail ${sub.id}: SET not sent`;
        console.log(`[PowerShellAdapter] ${sub.id} — ${reason} (${flagNote})`);
        this.firedForcedFailures.push({ entry_id: sub.id, task_id: _task.id });
        if (onStream) {
          onStream({
            phase: 'set_command', subId: sub.id, label: sub.label,
            engine: sub.engine, command: `[${flagNote}]`,
            stdout: '', stderr: reason, exitCode: 1, durationMs: 0,
          });
        }
        results.push({ sub_command_id: sub.id, success: false, stdout: '', stderr: reason, exitCode: 1, durationMs: 0 });
        overallSuccess = false;
        failureReasons.push(reason);
        await writeFailureEvidence(sub, { setStdout: flagNote, setStderr: reason, exitCode: 1, reason, preState: lastGetOutput, commandExecuted: `[${flagNote}]` });
        if (sub.on_failure === 'abort_step') break;
        continue;
      }

      // Only resolve set_command if we're actually going to execute it
      resolvedSetCmd = await resolveOrRecord(sub.set_command, sub);

      // FX-01 / FX-04: last-line check on the SET and on the resolved verification values.
      const resolvedVerification = sub.verification ? this.resolveVerification(sub.verification, sub, variables) : undefined;
      const setLeftover = [...new Set([
        ...findUnresolvedTokens(resolvedSetCmd),
        ...(resolvedVerification ? findUnresolvedTokens(this.verificationEqualsValues(resolvedVerification).join('\n')) : []),
      ])];
      if (setLeftover.length > 0) {
        const reason = new UnresolvedVariableError(setLeftover).message;
        await recordBlocked(sub, reason, resolvedSetCmd, { preState: lastGetOutput });
        if (sub.on_failure === 'abort_step') break;
        if (sub.on_failure === 'abort_plan') throw new Error(`Sub-command ${sub.id} ${reason}`);
        continue;
      }

      // FX-01: destructive entries must pass their preconditions before the SET is sent.
      let destructivePreview: DestructivePreviewDecision | undefined;
      if (sub.destructive) {
        const gate = await this.runDestructiveGate(sub, variables);
        destructivePreview = gate.preview;
        if (gate.preview) {
          console.log(`[PowerShellAdapter] ${sub.id} — ${gate.preview.reason}`);
        }
        if (gate.blockedReason) {
          await recordBlocked(sub, gate.blockedReason, resolvedSetCmd, { preState: lastGetOutput, preview: gate.preview });
          if (sub.on_failure === 'abort_step') break;
          if (sub.on_failure === 'abort_plan') throw new Error(`Sub-command ${sub.id} ${gate.blockedReason}`);
          continue;
        }
      }

      // GATE-RUN (COST-GATE-SPEC §3.5): a SET that starts a recurring cost needs a current DP-1
      // (cost-acks.json) and DP-2 typed now as `<entry id> <monthly cost>`; both are cost-gate
      // evidence. A refusal blocks the sub-command with reason cost_gated_off and the estimate.
      const costClass = classifyEntry({ entry_id: sub.id, set_command: sub.set_command }, this.getCostGateRef());
      if (costClass.recurring) {
        const tenantDir = tenantBaseDir(this.tenantSlug ?? 'dev');
        const dp2 = await runDp2({
          entryId: sub.id,
          ref: this.getCostGateRef(),
          acks: readCostAcks(tenantDir),
          runtime: this.costGateRuntime ?? getProcessCostGateRuntime(),
          tenantDir,
        });
        if (!dp2.allowed) {
          const est = dp2.estimate_month_low !== null && dp2.estimate_month_high !== null
            ? `about ${formatEstimate(dp2.estimate_month_low, dp2.estimate_month_high)} a month`
            : 'estimate unknown';
          const reason = `blocked: ${dp2.reason} (recurring cost ${est}; price date ${this.getCostGateRef().estimates.price_date})`;
          await recordBlocked(sub, reason, resolvedSetCmd, { preState: lastGetOutput });
          if (sub.on_failure === 'abort_step') break;
          if (sub.on_failure === 'abort_plan') throw new Error(`Sub-command ${sub.id} ${reason}`);
          continue;
        }
        this.recurringEnabled.push({ entry_id: sub.id, estimate_month_low: dp2.estimate_month_low ?? 0, estimate_month_high: dp2.estimate_month_high ?? 0 });
        console.log(`[PowerShellAdapter] ${sub.id} — DP-2 accepted: recurring cost about ${dp2.prompt?.estimate ?? '?'} a month`);
      }
      console.log(`[PowerShellAdapter] [${subIndex}/${subCommands.length}] ${sub.id} — phase=SET, cmd: ${resolvedSetCmd.substring(0, 100)}${resolvedSetCmd.length > 100 ? '...' : ''}`);

      // RAW state variables — populated by post-SET GET
      let postGetOutput: string | undefined;
      let postGetExitCode: number | undefined;
      let postGetStderr: string | undefined;
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
            postGetStderr = postGetResult.stderr;
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

        if (resolvedVerification) {
          // If post-GET failed or returned empty/non-zero (replication lag), retry once after 5s
          const postGetNeedsRetry = postGetOutput === undefined
            || (postGetExitCode !== undefined && postGetExitCode !== 0)
            || (postGetOutput !== undefined && postGetOutput.trim() === '');
          if (postGetNeedsRetry && resolvedVerification.evidence && resolvedGetCmd) {
            try {
              await new Promise(resolve => setTimeout(resolve, 5000));
              const retryResult = await this.executeViaSession(sub.engine, resolvedGetCmd, false);
              postGetOutput = retryResult.stdout;
              postGetExitCode = retryResult.exitCode;
              postGetStderr = retryResult.stderr;
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
            resolvedVerification,
            { stateChanged: stateChanged ?? undefined }
          );

          // Override success flag if verification fails (takes precedence over exit code).
          // Exceptions — don't override when:
          // 1. Clean exit (0 + no stderr) and evidence simply unavailable (null) — GET may
          //    have failed transiently but the SET succeeded.
          // 2. Clean exit and stateChanged is false, and the evidence check did not fail —
          //    the resource was already in the desired state before the SET ran. FX-03: an
          //    unchanged state only explains an idempotent result; it no longer hides a
          //    failed evidence check.
          if (!verificationResult.passed) {
            const cleanExit = result.exitCode === 0 && (!result.stderr || result.stderr.trim() === '');
            const evidenceUnavailable = verificationResult.details.evidence_check === null;
            const alreadyCompliant = cleanExit && stateChanged === false && verificationResult.details.evidence_check !== false;
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
          const failureReason =
            verificationResult && !verificationResult.passed
              ? `verification failed — ${verificationResult.reason ?? 'criteria not met'}`
              : (result.stderr || `exit code ${result.exitCode}`).trim().substring(0, 200);
          // W5c3: the SET's output when the SET failed; the post-SET GET's when the SET exited 0 and
          // the read failed; otherwise the SET's (the read's content is in postStateOutput).
          const diagnosticSource = result.exitCode === 0 && postGetExitCode !== undefined && postGetExitCode !== 0
            ? { exitCode: postGetExitCode, stdout: postGetOutput ?? '', stderr: postGetStderr ?? '' }
            : { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
          const cause = failureCause(buildFailureDiagnostics(diagnosticSource.exitCode, diagnosticSource.stderr, diagnosticSource.stdout));
          failureReasons.push(`${sub.id}: ${withCause(failureReason, cause)}`);

          // Write failure evidence so stale evidence from prior runs doesn't persist (FX-05:
          // for every entry, with the SET output, GET outputs, verification and reason).
          await writeFailureEvidence(sub, {
            setStdout: result.stdout, setStderr: result.stderr || 'Execution failed', exitCode: result.exitCode,
            reason: failureReason, preState: lastGetOutput, postState: postGetOutput, stateChanged,
            verificationResult, preview: destructivePreview, diagnosticSource,
          });

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
              if (destructivePreview) evidence.destructivePreview = destructivePreview;
              const { blobUrl } = await this.writeEvidence(_task.id, evidFile, evidence);
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
            if (destructivePreview) evidence.destructivePreview = destructivePreview;
            const { blobUrl } = await this.writeEvidence(_task.id, evidFile, evidence);
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
        // W5c3: a SET that threw leaves a failure record with the error text, like any failed SET.
        await writeFailureEvidence(sub, {
          setStdout: '', setStderr: errorMsg, exitCode: 1, reason: errorMsg,
          preState: lastGetOutput, postState: postGetOutput, stateChanged, preview: destructivePreview,
        });
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
          // PH-13 (founder Q3): an empty successful read is NOT_SAT here too (not a "valid empty result").
          const secondPassRead = judgeEvidenceRead(evidResult.exitCode, evidResult.stdout);
          if (evidenceRule && !secondPassRead.shown && !evidenceNotShown.some(e => e.sub.id === sub.id)) {
            evidenceNotShown.push({ sub, index: subCommands.indexOf(sub), reason: secondPassRead.reason });
          }
          if (evidResult.stdout.trim()) {
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            try {
              const moduleVersions = await this.extractModuleVersions(sub.engine);
              const evidence = buildStructuredEvidence(
                evidResult.stdout, evidResult.exitCode, evidResult.stderr, null,
                sub, _task, variables, moduleVersions, buildSnapshot(sub)
              );
              if (!secondPassRead.shown && evidResult.exitCode === 0) markEmptyEvidenceRecord(evidence);
              await this.writeEvidence(_task.id, evidFile, evidence);
            } catch { /* best-effort */ }
          } else if (evidResult.exitCode === 0) {
            // Evidence-only with exitCode 0 and empty stdout: PH-13, an empty read (NOT_SAT, the plain reason)
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            try {
              const moduleVersions = await this.extractModuleVersions(sub.engine);
              const evidence = buildStructuredEvidence(
                '', evidResult.exitCode, evidResult.stderr, null,
                sub, _task, variables, moduleVersions, buildSnapshot(sub)
              );
              markEmptyEvidenceRecord(evidence);
              await this.writeEvidence(_task.id, evidFile, evidence);
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
              evidence.failureDiagnostics = buildFailureDiagnostics(evidResult.exitCode, evidResult.stderr, evidResult.stdout);
              evidence.outcomeRationale = withCause(`Evidence command failed: ${evidResult.stderr.substring(0, 200)}`, failureCause(evidence.failureDiagnostics));
              const { verdict, rationale } = deriveVerdict('failed_no_remediation');
              evidence.complianceVerdict = verdict;
              evidence.verdictRationale = rationale;
              await this.writeEvidence(_task.id, evidFile, evidence);
            } catch { /* best-effort */ }
          }
        } catch { /* evidence second-pass is best-effort */ }
      }
    }

    // PH-13 (founder Q3): an evidence read placed before a SET of the same task read the state before that
    // SET. Each such empty read runs once more after the task's SETs, and the second read is the evidence.
    if (evidenceRule && evidenceNotShown.length > 0) {
      const setRanAfter = (index: number) => subCommands.some((s, i) => i > index && !!s.set_command && s.set_command.trim() !== ''
        && results.some(r => r.sub_command_id === s.id && r.success));
      for (const pending of [...evidenceNotShown]) {
        if (pending.index < 0 || !setRanAfter(pending.index)) continue;
        const sub = pending.sub;
        let shownAfter = false;
        for (const evidCmd of sub.evidence_commands) {
          try {
            const resolved = this.resolveCommand(evidCmd, sub, variables);
            const evidResult = await this.executeViaSession(sub.engine, resolved, false);
            const reread = judgeEvidenceRead(evidResult.exitCode, evidResult.stdout);
            if (!reread.shown) continue;
            shownAfter = true;
            evidenceOutputs.push(evidResult.stdout);
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            try {
              const moduleVersions = await this.extractModuleVersions(sub.engine);
              const evidence = buildStructuredEvidence(
                evidResult.stdout, evidResult.exitCode, evidResult.stderr, null,
                sub, _task, variables, moduleVersions, buildSnapshot(sub)
              );
              await this.writeEvidence(_task.id, evidFile, evidence);
            } catch { /* best-effort */ }
            break;
          } catch { /* the first read's record stands */ }
        }
        if (shownAfter) {
          evidenceNotShown.splice(evidenceNotShown.indexOf(pending), 1);
          console.log(`[PowerShellAdapter] ${sub.id} — evidence read again after this task's SETs: shown`);
        }
      }
    }
    let evidenceOutput: EvidenceNotShownOutput | undefined;
    if (evidenceRule && evidenceNotShown.length > 0) {
      const reason = evidenceNotShown.map(e => `${e.sub.id}: ${e.reason}`).join('; ');
      evidenceOutput = { evidenceShown: false, evidenceReason: reason, text: allStdout.join('\n') };
      console.log(`[PowerShellAdapter] ${_task.id} — evidence not shown: ${reason}`);
    }

    // PH-11 (founder Q3): the read-only prohibition verdict, as the GUI branch judges it: shown when any
    // read has content. The task still completes (as in the GUI); its controls record NOT MET from
    // output.prohibitionShown === false (cli/index.ts -> recordTaskStatuses).
    let prohibitionOutput: { prohibitionShown: boolean; prohibitionReason: string; text: string } | undefined;
    if (prohibitionReadOnly && !dryRun) {
      const shown = prohibitionSubs.some(s => s.shown);
      const reason = shown ? '' : (prohibitionSubs.map(s => `${s.subId}: ${s.reason}`).join('; ') || 'no read ran');
      prohibitionOutput = { prohibitionShown: shown, prohibitionReason: reason, text: allStdout.join('\n') };
      if (!shown) console.log(`[PowerShellAdapter] ${_task.id} — prohibition not shown: ${reason}`);
    }

    return {
      success: overallSuccess,
      output: prohibitionOutput ?? evidenceOutput ?? allStdout.join('\n'),
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
      return this.resolveInContext(template, sub.variables_required, sub.variables_runtime);
    }
    // Fallback: legacy variable interpolation
    return this.interpolateVariables(template, variables);
  }

  /**
   * SEC-2: ExecutionContext resolution through the PowerShell guard. `resolve()` still runs first
   * so its missing-variable errors are unchanged; the text comes from renderPs over the same
   * variables (runtime captures over manifest values, as in `resolve()`).
   */
  private resolveInContext(template: string, variablesRequired: string[], variablesRuntime: string[]): string {
    const ctx = this.executionContext!;
    ctx.resolve(template, variablesRequired, variablesRuntime);
    return this.renderMasked(template, ctx.getAllVariables());
  }

  /**
   * SEC-2: a comparison value (lookup `by_name.equals`, lookup values, verification `equals`) is
   * matched against command output, never executed, so it is resolved without the PowerShell guard.
   */
  private resolveComparisonValue(template: string, sub: SubCommand, variables: Record<string, any>): string {
    if (this.executionContext) {
      return this.executionContext.resolve(template, sub.variables_required, sub.variables_runtime);
    }
    return template.replace(/\$\{(\w+)\}|(?<![$\w])\{(\w+)\}/g, (match, dollarName, braceName) => {
      const name = dollarName ?? braceName;
      return Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match;
    });
  }

  /**
   * FX-04: resolve placeholders inside verification `equals` values with the same resolver
   * as the commands, so a rule like `equals: "{operatorUserId}"` compares to the real id.
   */
  private resolveVerification(criteria: VerificationCriteria, sub: SubCommand, variables: Record<string, any>): VerificationCriteria {
    const evidence = criteria.evidence;
    if (!evidence) return criteria;
    const resolveValue = (v: string): string => this.resolveComparisonValue(v, sub, variables);
    return {
      ...criteria,
      evidence: {
        ...evidence,
        ...(evidence.equals !== undefined ? { equals: resolveValue(evidence.equals) } : {}),
        ...(evidence.checks ? { checks: evidence.checks.map(c => (c.equals !== undefined ? { ...c, equals: resolveValue(c.equals) } : c)) } : {}),
      },
    };
  }

  private verificationEqualsValues(criteria: VerificationCriteria): string[] {
    const out: string[] = [];
    if (criteria.evidence?.equals !== undefined) out.push(criteria.evidence.equals);
    for (const c of criteria.evidence?.checks ?? []) if (c.equals !== undefined) out.push(c.equals);
    return out;
  }

  /**
   * FX-01: preconditions for a destructive entry, run before its SET is sent:
   * (a) every exclusion variable is filled and each exclusion check finds an existing account;
   * (b) the preview lists what the SET would change (the caller records it in evidence);
   * (c) refuse when the preview covers the whole population or more than `max_share` of it.
   * (d) skipping accounts with no sign-in data lives in the entry's preview and SET filters.
   */
  private async runDestructiveGate(
    sub: SubCommand,
    variables: Record<string, any>
  ): Promise<{ blockedReason?: string; preview?: DestructivePreviewDecision }> {
    const guard = sub.destructive_guard;
    if (!guard) {
      return { blockedReason: 'blocked: destructive entry has no destructive_guard preconditions' };
    }
    const known: Record<string, any> = this.executionContext ? this.executionContext.getAllVariables() : variables;
    for (const name of guard.exclusion_variables) {
      const value = known[name];
      if (value === undefined || value === null || String(value).trim() === '') {
        return { blockedReason: `blocked: destructive precondition — exclusion ${name} is not filled` };
      }
    }
    const runChecked = async (template: string): Promise<{ stdout: string; exitCode: number } | { blockedReason: string }> => {
      const command = this.resolveCommand(template, sub, variables);
      const leftover = findUnresolvedTokens(command);
      if (leftover.length > 0) return { blockedReason: new UnresolvedVariableError(leftover).message };
      try {
        const r = await this.executeViaSession(sub.engine, command, false);
        return { stdout: r.stdout, exitCode: r.exitCode };
      } catch (err) {
        return { blockedReason: `blocked: destructive precondition command failed — ${(err instanceof Error ? err.message : String(err)).substring(0, 200)}` };
      }
    };
    for (const check of guard.exclusion_checks) {
      const r = await runChecked(check);
      if ('blockedReason' in r) return { blockedReason: r.blockedReason };
      if (r.exitCode !== 0 || r.stdout.trim() === '') {
        return { blockedReason: 'blocked: destructive precondition — an exclusion does not resolve to an existing account' };
      }
    }
    const p = await runChecked(guard.preview_command);
    if ('blockedReason' in p) return { blockedReason: p.blockedReason };
    if (p.exitCode !== 0) {
      return { blockedReason: `blocked: destructive preview failed (exit code ${p.exitCode})` };
    }
    const preview = evaluateDestructivePreview(p.stdout.trim(), guard.max_share);
    return preview.refused ? { blockedReason: preview.reason, preview } : { preview };
  }

  /**
   * FX-05: write evidence to the stable latest-per-entry index (the file EO reads, plus the
   * optional blob upload) and to a per-task record named by task id plus entry id.
   */
  private async writeEvidence(taskId: string, evidFile: string, evidence: StructuredEvidence): Promise<{ localPath: string; blobUrl?: string }> {
    // W1: record where a secret input came from (never its value) on entries whose commands use it.
    const commandText = [evidence.metadata.commandExecuted, evidence.registryEntry?.set_command, evidence.registryEntry?.get_command].join('\n');
    const provenance: Record<string, string> = {};
    for (const [name, source] of Object.entries(this.secretProvenance)) {
      if (commandText.includes(`{${name}}`) || commandText.includes(secretSentinel(name))) provenance[name] = source;
    }
    if (Object.keys(provenance).length > 0) evidence.metadata.secretProvenance = provenance;
    const gateContext = this.gateContextTasks.has(taskId);
    if (gateContext) evidence.metadata.gateContext = 'manual_gate';
    const ledger: EvidenceFileLedger | undefined = this.evidenceLedger ? { ...this.evidenceLedger, taskId } : undefined;
    const written = await writeAndUploadEvidence(this.evidenceDir, evidFile, evidence, this.evidenceStorage, ledger);
    const perTaskPath = taskEvidencePath(this.evidenceDir, taskId, evidFile);
    writeJsonArtifact(perTaskPath, evidence);
    recordWrittenEvidence(ledger, this.evidenceDir, perTaskPath, evidence.metadata.controlIds, 'stamper:evidence-by-task');
    this.writtenEvidence.add(perTaskPath);
    const entryId = evidence.registryEntry?.entry_id;
    // PH7-ST: a manual gate's reads are display only, so they never feed a config_export postcheck.
    if (entryId && !gateContext) {
      this.entryStateRecords.set(entryId, {
        entryId,
        controlIds: evidence.metadata.controlIds,
        postcheckMode: evidence.metadata.postcheckMode,
        verdict: evidence.complianceVerdict,
        statePassed: evidence.metadata.postcheckMode === 'state' && evidence.verificationResult?.passed === true
          && evidence.verificationResult.details.evidence_check === true && evidence.complianceVerdict === 'SAT',
        // the post-SET read, else the GET; a read-only entry's (no SET) read is its rawResponse
        stateOutput: evidence.metadata.postStateOutput || evidence.metadata.preStateOutput
          || (!(evidence.registryEntry?.set_command ?? '').trim() ? evidence.rawResponse : undefined),
      });
    }
    return written;
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
    // FX-01: last line of defence — a command with an unfilled {name} token is never sent.
    // Checked before the secret overlay so a secret value is never inspected or echoed.
    assertNoUnresolvedTokens(command);
    // FC-ST-3 step 2: the only place a resolved secret value is substituted — every caller of
    // executeViaSession still holds (and streams/logs/persists) the sentinel-bearing `command`.
    const execCommand = this.applySecretOverlay(command);
    // W1: what comes back (stdout, stderr, stream chunks, errors) is redacted before any caller
    // streams, hashes, logs or persists it, so a command echoed in an error carries the sentinel.
    const redactedStdout = onStdout ? (chunk: string) => onStdout(this.redactSecrets(chunk)) : undefined;
    try {
      let result: { stdout: string; stderr: string; exitCode: number };
      if (this.sessionManager) {
        const sessionType = ENGINE_SESSION_MAP[engine] ?? 'graph';
        result = await this.sessionManager.execute(sessionType, execCommand, redactedStdout);
      } else {
        // Fallback: direct PowerShell spawn
        const script = `$ErrorActionPreference = "Stop"\n${execCommand}`;
        result = await this.executePowerShell(script, redactedStdout);
      }
      return { stdout: this.redactSecrets(result.stdout), stderr: this.redactSecrets(result.stderr), exitCode: result.exitCode };
    } catch (err) {
      if (err instanceof Error) err.message = this.redactSecrets(err.message);
      throw err;
    }
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
            // Simple json_path: "$.Field" → parsed.Field. Property names match case-insensitively,
            // as PowerShell property access does and as OutputVerificationEngine reads them:
            // Graph SDK cmdlets surface `Id`, raw Graph JSON (Invoke-MgGraphRequest) `id`.
            const fieldName = spec.json_path.replace(/^\$\./, '');
            const value = fieldName.split('.').reduce((obj: any, key: string) => {
              if (obj === null || typeof obj !== 'object') return undefined;
              if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
              const match = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
              return match === undefined ? undefined : obj[match];
            }, parsed);
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
          `$displayName = ${psLiteral(displayName, 'displayName')}`,
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
        scriptLines.push(this.buildGCCHighConnection(task.action.command, declaredSessions(task)));
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
    // FIN-22: an AO task that declares its sessions (args._sessions) always connects them.
    if (declaredSessions(task).length > 0) return true;
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

  private buildGCCHighConnection(command: string = '', declared: readonly string[] = []): string {
    const c = command.toLowerCase();
    // FIN-22: sessions the AO task declares from its cmdlet families (ces-ao AdapterRouter) are always connected.
    const want = new Set(declared);
    const needsIpps = want.has('purview') || /-label\b|-labelpolicy|-dlpcompliancepolicy|-dlpcompliancerule|connect-ippssession/.test(c);
    // ARM channel: verb-prefixed Az cmdlets (get-aznetwork..., new-azroute..., etc.). The verb
    // anchor avoids false hits on parameters like -AzureADAuthorizationEndpointUri in IPPS templates.
    const needsAz = want.has('azure') || /\b(get|set|new|remove|add|enable|disable)-az[a-z]|connect-azaccount/.test(c);
    // STAB-1 M2: Teams (Cs*) and SPO channels — TaskRunner routes both engines here and
    // ces-tenant supports both session types; without these branches a real-tenant
    // teams/spo task got NO Connect line. Verb anchor avoids Export-Csv/Import-Csv hits.
    const needsTeams = want.has('teams') || /\b(get|set|new|remove|grant)-cs[a-z]|connect-microsoftteams/.test(c);
    const needsSpo = want.has('sharepoint') || /\b(get|set|new|remove)-spo[a-z]|connect-sposervice/.test(c);
    // A Set-Label/DLP command uses the Security & Compliance session, NOT the regular EXO session.
    const needsGraph = want.has('graph') || ((/-mg[a-z]|connect-mggraph/.test(c) || (!c && !needsAz && !needsTeams && !needsSpo)) && !needsIpps);
    const needsExo = want.has('exchange') || /-transportrule|-dkimsigningconfig|-hostedcontentfilter|-omeconfiguration|connect-exchangeonline/.test(c);
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
   * Neutralize substituted VALUES against PowerShell command injection (G-ENG-1, SEC-2).
   *
   * Command templates interpolate values into a string that is then run via
   * `spawn('powershell.exe', ['-Command', script])`. This is a single chokepoint reached by BOTH
   * ces-stamper commands and ces-ao commands (AO imports this adapter), so one guard covers both.
   *
   * SEC-2: ces-shared's renderPs lexes the template once and guards each placeholder by its
   * context: single-quoted values are escaped ('' doubling) and can never close the literal;
   * double-quoted values may not contain ` ; | & < > $ ( ) " (spaces allowed); bare values must
   * be a typed token (generic, or upn / guid / integer per PS_TOKEN_KINDS). NUL and line breaks
   * are refused everywhere. Placeholder-driven: a variable the template never references is
   * never stringified or checked (plan-wide map entries such as _drift_policies).
   */
  private interpolateVariables(template: string, variables: Record<string, any>): string {
    return this.renderMasked(template, variables);
  }

  /** SP-1 (R1): render with secret-class plain values as their sentinel; remember them for redaction and refusal. */
  private renderMasked(template: string, variables: Record<string, any>): string {
    Object.assign(this.secretLiterals, secretClassLiterals(variables));
    return renderPs(template, maskSecretClassVariables(variables), { kinds: PS_TOKEN_KINDS });
  }

  private async runSingleCommand(
    command: string,
    variables: Record<string, any>
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const interpolated = this.applySecretOverlay(this.interpolateVariables(command, variables));
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
      // through to the real Microsoft modules. FIN-42 (SP-4): scrubbed, so the child never gets CES's own
      // tokens or signing secrets; everything else (PSModulePath, STACKSIM_*) still passes.
      ], { env: scrubEnv(process.env) });

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
