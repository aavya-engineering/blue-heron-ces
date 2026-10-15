// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 7: Command Executor
// Orchestrates AO command execution pipeline

import type { AoCommand } from '../types/AoCommand.js';
import type { TenantConfig } from 'ces-shared/config';
import type { ExecutionResult, StructuredEvidence } from '../types/StamperTypes.js';
import type { CommandEntry } from 'ces-shared/types/registry';
import { createExecutionContext } from './AuthChain.js';
import { translateAoCommandToCommandEntry } from '../registry/RegistryBridge.js';
import { requiresManualGate } from './SodGate.js';
import { mapAoParametersToVariables, CuiBoundaryDenialError, UnboundSourceError } from './ParameterMapper.js';
import { evaluate as evaluateCmmcGate, CMMC_STRICT_DEFAULT, type CmmcAwareTenantConfig } from './CmmcScopeGate.js';
import { buildEvidenceArtifact, persistEvidenceArtifact, generateExecutionId } from './EvidenceEmitter.js';
import { handleExecutionError } from './ErrorHandler.js';
import { shouldRetry } from './RetryPolicy.js';
import { requestGateApproval, assertApprovalValidForExecution } from './ManualGateAdapter.js';
import { markApprovalExecuted, type ApprovalRequest } from './ApprovalStore.js';
import { executeGetThenSet, readOnlyViolation } from './GetThenSetExecutor.js';
import { checkSimOnlyRail, isStacksimModeActive } from './SimOnlyRail.js';
import { resolveTargetIdentity } from './TargetIdentity.js';

/** Optional execution controls for SOD-gated and write commands. */
export interface ExecuteOptions {
  /** UPN of the operator requesting the action (required to request a Tier 3 gate). */
  requestorUPN?: string;
  /** An approved approvalId authorising a Tier 3 command to actually run. */
  approvalId?: string;
  /** CLI --strict-cmmc thread (G-AO-CMMC-BOUND-1 M4). Overrides AO_CMMC_STRICT/default when set. */
  strictCmmc?: boolean;
  /** AE-R3: caller-supplied correlation id, echoed on the evidence row and response. */
  correlationId?: string;
  /** W4-AO3: true when requestorUPN is an authenticated principal (recorded on the approval request). */
  requestorAuthenticated?: boolean;
}

/** Returned (without executing) when a Tier 3 command needs second-person approval. */
export interface PendingApprovalResult {
  success: false;
  status: 'pending_approval';
  approvalId: string;
  requestorUPN: string;
  message: string;
  correlationId?: string;
  evidencePersisted?: boolean;
  evidenceError?: string;
  evidencePath?: string;
}

// G-TENANT-M5 logged deviation: `PowerShellAdapter` remains Stamper-owned
// (not extracted by ces-tenant's M1), so this ONE deep import stays per the
// goal's explicit carve-out. The config + session pair fed to it below are
// built from ces-tenant surfaces (AuthChain.createExecutionContext), NOT from
// `ces-stamper/config/stamper` / `ces-stamper/core/session`.
import { PowerShellAdapter } from 'ces-stamper/adapters/powershell';

/**
 * Execute an AO command with full pipeline orchestration.
 *
 * Steps:
 * 1. Create session context (StamperConfig + SessionManager)
 * 2. Translate AoCommand to CommandEntry
 * 3. Check SOD gate (throw if manual_gate)
 * 4. Build variables dictionary
 * 5. Instantiate PowerShellAdapter
 * 6. Build ExeTask shape
 * 7. Execute command with retry logic
 * 8. Build evidence artifact
 *
 * @param aoCommand - AO command to execute
 * @param tenantConfig - Tenant configuration
 * @param userInputs - User-provided form inputs
 * @param dryRun - Dry-run mode (default true)
 * @returns ExecutionResult with evidence artifact
 */
export async function executeAoCommand(
  aoCommand: AoCommand,
  tenantConfig: TenantConfig,
  userInputs: Record<string, any>,
  dryRun: boolean = true,
  opts: ExecuteOptions = {}
): Promise<
  | PendingApprovalResult
  | (ExecutionResult & {
      evidence?: StructuredEvidence;
      evidencePath?: string;
      metadataPath?: string;
      evidencePersisted?: boolean;
      evidenceError?: string;
      correlationId?: string;
    })
> {
  // Step 1: Translate AoCommand to CommandEntry (no auth/context needed).
  const commandEntry = translateAoCommandToCommandEntry(aoCommand);
  const tenantId = tenantConfig.tenantId || 'unknown';
  const cmmcTenant = tenantConfig as CmmcAwareTenantConfig;
  const correlationId = opts.correlationId;
  // FX-AO6 (contract 1.3.0): target identity from the command's declared parameters,
  // resolved from the raw request once so every terminal row (denials included) carries it.
  const target = resolveTargetIdentity(userInputs, aoCommand);

  // AE-R3: persist evidence with full metadata threading. Every terminal state
  // (denial, pending, rejection, success, failure) persists through this closure.
  const persistEvidence = async (
    evidence: StructuredEvidence,
    extra: { approverUPN?: string; approvalId?: string } = {},
  ): Promise<{
    evidencePath?: string;
    metadataPath?: string;
    evidencePersisted: boolean;
    evidenceError?: string;
  }> => {
    const persisted = await persistEvidenceArtifact(evidence, {
      commandId: aoCommand.id,
      tenantId,
      executionId: generateExecutionId(),
      domain: aoCommand.domain,
      tenantSlug: tenantConfig.tenantSlug,
      tenantKind: cmmcTenant.kind,
      requestorUPN: opts.requestorUPN,
      approverUPN: extra.approverUPN,
      approvalId: extra.approvalId,
      correlationId,
      ...target,
    });
    return {
      evidencePath: persisted.evidencePath,
      metadataPath: persisted.metadataPath,
      evidencePersisted: persisted.evidencePersisted,
      evidenceError: persisted.evidenceError,
    };
  };

  // Terminal denial: build + persist an enforcement-evidence artifact and stop.
  const denyWithEvidence = async (
    reason: string,
    gateMeta: NonNullable<StructuredEvidence['metadata']['cmmcGate']>,
  ) => {
    const denialResult: ExecutionResult = {
      success: false,
      error: reason,
      stdout: '',
      stderr: '',
      exit_code: 1,
    };
    const evidence = buildEvidenceArtifact(aoCommand, denialResult, commandEntry, {}, {
      dryRun,
      overrideOutcome: gateMeta.cuiBoundaryCase ? 'denied_cui' : 'denied_cmmc',
    });
    evidence.metadata.cmmcGate = gateMeta;
    const paths = await persistEvidence(evidence);
    return { ...denialResult, evidence, ...paths, correlationId };
  };

  // Step 1.4 (A5, FX-AO2): Sim-only safety rail — evaluated BEFORE the CMMC gate.
  // Sim-only is ON by default: a non-sim tenant runs only with CES_AO_ALLOW_LIVE=1 AND
  // kind 'live'; CES_AO_SIM_ONLY=1 refuses every non-sim tenant; sim tenants with
  // non-loopback endpoints are always refused. See SimOnlyRail.checkSimOnlyRail.
  const simRail = checkSimOnlyRail(cmmcTenant.kind, tenantConfig.endpoints);
  if (!simRail.allowed) {
    const denialResult: ExecutionResult = {
      success: false,
      error: simRail.reason!,
      stdout: '',
      stderr: '',
      exit_code: 1,
    };
    // Contract 1.2.0 (ces-shared FX-SH1, 2e07bc2): dedicated outcome, closes
    // REQ-shared-adminops-evidence-sim-refusal-outcome.
    const evidence = buildEvidenceArtifact(aoCommand, denialResult, commandEntry, {}, {
      dryRun,
      overrideOutcome: 'denied_sim_only',
    });
    evidence.outcomeRationale = simRail.reason!;
    const paths = await persistEvidence(evidence);
    return { ...denialResult, evidence, ...paths, correlationId };
  }

  // Step 1.4b (AO-20, 2026-09-27 FC-AO): checkSimOnlyRail above answers "which records
  // may run" (tenant kind + loopback endpoints); it does NOT verify the PROCESS is
  // actually wired to the stacksim shims ("where will cmdlets go" — isStacksimModeActive,
  // checks STACKSIM_SERVER_URL loopback + a PSModulePath stacksim shim dir). Without this,
  // a kind:'sim' record with loopback endpoints on a process that is NOT actually routed
  // to stacksim would silently pass checkSimOnlyRail and either hang against a dead
  // loopback or, worse, resolve through whatever PowerShell modules the process actually
  // has loaded. Fail closed: refuse rather than guess.
  const stacksimModeActive = isStacksimModeActive();
  if (cmmcTenant.kind === 'sim' && !stacksimModeActive) {
    const reason =
      "Sim tenant (kind:'sim'), but this process is not routed to stacksim " +
      '(STACKSIM_SERVER_URL loopback + PSModulePath stacksim shim not detected) — ' +
      'refusing rather than risk running against a dead loopback or the real module path.';
    const denialResult: ExecutionResult = {
      success: false,
      error: reason,
      stdout: '',
      stderr: '',
      exit_code: 1,
    };
    const evidence = buildEvidenceArtifact(aoCommand, denialResult, commandEntry, {}, {
      dryRun,
      overrideOutcome: 'denied_sim_only',
    });
    evidence.outcomeRationale = reason;
    const paths = await persistEvidence(evidence);
    return { ...denialResult, evidence, ...paths, correlationId };
  }

  // Step 1.5 (G-AO-CMMC-BOUND-1 M4): CMMC scope gate — evaluated BEFORE any
  // approval opening, context creation, or session spawn (REVIEW.md insertion
  // point "before Step 3"). PRECEDENCE: this gate outranks the global apply
  // switches — CLI --apply / MCP AO_MCP_ALLOW_APPLY remain necessary for a live
  // write but are NOT sufficient; a denial here blocks even an approved,
  // apply-armed command for this tenant/command pair.
  const strictOpt = opts.strictCmmc !== undefined ? { strictCmmc: opts.strictCmmc } : undefined;
  const cmmcGate = evaluateCmmcGate(cmmcTenant, aoCommand, strictOpt);
  // Mirror CmmcScopeGate.isStrictMode so the evidence `strict` flag matches the
  // decision the gate actually made (opts override > env > CMMC_STRICT_DEFAULT).
  const strictActive =
    opts.strictCmmc !== undefined
      ? opts.strictCmmc
      : process.env.AO_CMMC_STRICT === '1' || CMMC_STRICT_DEFAULT;
  if (!cmmcGate.allow) {
    return denyWithEvidence(`CMMC scope gate denied command ${aoCommand.id}: ${cmmcGate.reason}`, {
      allow: false,
      reason: cmmcGate.reason,
      strict: strictActive,
      tenantCmmcLevel: cmmcTenant.cmmcLevel,
      tenantKind: cmmcTenant.kind,
    });
  }
  if (cmmcGate.warning) {
    console.warn(`[CmmcScopeGate] ${cmmcGate.warning}`);
  }

  // Write-shape of this command (shared by the SoD floor and Step 6 routing):
  // an idempotent get-then-set or a CONFIG trigger, with a real set_command.
  const writeShaped =
    (commandEntry.idempotency === 'get-then-set' || aoCommand.trigger === 'CONFIG') &&
    !!commandEntry.set_command;

  // Step 2: SOD gate — Tier 3 destructive commands require two-person approval.
  // Done BEFORE building the execution context so that merely OPENING an approval
  // request does not require valid tenant auth credentials.
  // M4 additive floor: against a live L2 tenant, write-shaped Tier 2 commands
  // are floored up to the gate (single floor — see SodGate.ts scope boundary).
  const sodGated = requiresManualGate(aoCommand, {
    cmmcLevel: cmmcTenant.cmmcLevel,
    kind: cmmcTenant.kind,
    writeShaped,
  });
  const sodFloorApplied = sodGated && aoCommand.sodTier !== 'Tier 3';
  let consumedApproval: ApprovalRequest | undefined;
  if (sodGated) {
    if (!opts.approvalId) {
      // No approval supplied → create a pending request and STOP (do not execute).
      const requestorUPN = opts.requestorUPN || (userInputs?.requestorUPN as string) || '';
      if (!requestorUPN) {
        throw new Error(
          `Tier 3 command ${aoCommand.id} requires a requestorUPN to open an approval request`
        );
      }
      const request = await requestGateApproval(aoCommand, tenantId, requestorUPN, userInputs, opts.requestorAuthenticated);
      // AE-R3: write evidence for the pending-approval stop.
      const pendingResult: ExecutionResult = {
        success: false,
        error: `Blocked — awaiting second-person approval (${request.approvalId})`,
        stdout: '',
        stderr: '',
        exit_code: 1,
      };
      const pendingEvidence = buildEvidenceArtifact(aoCommand, pendingResult, commandEntry, {}, {
        dryRun,
        overrideOutcome: 'blocked_pending_approval',
      });
      const pendingPaths = await persistEvidence(pendingEvidence);
      return {
        success: false,
        status: 'pending_approval',
        approvalId: request.approvalId,
        requestorUPN,
        message:
          `Tier 3 command "${aoCommand.title}" requires second-person approval. ` +
          `A different UPN must approve approval ${request.approvalId} before it can run.`,
        correlationId,
        evidencePersisted: pendingPaths.evidencePersisted,
        evidenceError: pendingPaths.evidenceError,
        evidencePath: pendingPaths.evidencePath,
      };
    }
    // An approvalId was supplied — validate it authorises this exact command + inputs.
    consumedApproval = await assertApprovalValidForExecution(opts.approvalId, aoCommand, userInputs);
  }

  // Step 3: Build variables dictionary. Runs BEFORE context creation so a
  // CUI-boundary denial (ParameterMapper, G-AO-CMMC-BOUND-1 M3) blocks the
  // command without any session/auth work — and is emitted as enforcement
  // evidence rather than escaping as a bare throw (GP-AO-BOUND-1 M3).
  let variables: Record<string, string>;
  try {
    variables = mapAoParametersToVariables(aoCommand, tenantConfig, userInputs);
  } catch (error) {
    if (error instanceof CuiBoundaryDenialError) {
      return denyWithEvidence(`CUI boundary denied command ${aoCommand.id}: ${error.message}`, {
        allow: false,
        reason: error.message,
        strict: strictActive,
        tenantCmmcLevel: cmmcTenant.cmmcLevel,
        tenantKind: cmmcTenant.kind,
        cuiBoundaryCase: error.boundaryCase,
      });
    }
    if (error instanceof UnboundSourceError) {
      // W4-AO2: a genuinely unknown tenant-sourced value — nothing is sent to the
      // tenant; the failure is evidenced with the named missing key(s).
      const unboundResult: ExecutionResult = {
        success: false,
        error: `Parameter binding failed (required tenant value missing): ${error.message}`,
        stdout: '',
        stderr: '',
        exit_code: 1,
      };
      const evidence = buildEvidenceArtifact(aoCommand, unboundResult, commandEntry, {}, { dryRun });
      const paths = await persistEvidence(evidence);
      return { ...unboundResult, evidence, ...paths, correlationId };
    }
    throw error;
  }

  // Step 4: Create execution context (singleton for this request) — ces-tenant
  // session factory + AO execution config (G-TENANT-M5 cutover).
  const { executionConfig, sessionFactory } = createExecutionContext(tenantConfig, dryRun);

  // Step 5: Adapter instantiation
  // All engines use PowerShellAdapter in this phase. The adapter's declared
  // parameter types are Stamper's nominal `StamperConfig`/`SessionManager`
  // classes; AO deliberately no longer imports either module, so the
  // ces-tenant-built context is bridged structurally: `executionConfig`
  // carries the exact getter surface the adapter reads (tenantId, appId,
  // certThumbprint, domain, subscriptionId, gccHighEndpoints, dryRun) and
  // `sessionFactory` is the same `TenantSessionFactory` implementation
  // Stamper's own SessionManager shim extends.
  const adapter = new PowerShellAdapter(
    executionConfig as unknown as ConstructorParameters<typeof PowerShellAdapter>[0],
    sessionFactory as unknown as ConstructorParameters<typeof PowerShellAdapter>[1]
  );

  // Step 6: Choose execution strategy.
  // Write commands use the get-then-set safety pattern: read state, preview on
  // dryRun, set+verify on live. Read/evidence commands use the single-command path.
  // A command takes the get-then-set write path when it is an idempotent write,
  // OR an approved Tier 3 command that carries a real mutation, OR a CONFIG-trigger
  // command (e.g. F-11/F-12 firewall Allocate/Deallocate). Either way it must have a
  // non-empty set_command (A-15 is gated but read-only → false). Routing CONFIG writes
  // through get-then-set gives the firewall ops the same preview/verify safety.
  const isWrite = writeShaped || (!!consumedApproval && !!commandEntry.set_command);
  let preStateOutput: string | undefined;
  let postStateOutput: string | undefined;
  let stateChanged: boolean | undefined;
  let stateReadError: string | undefined;
  let applied = false;

  let executionResult: ExecutionResult | null = null;
  let attemptCount = 0;

  if (isWrite) {
    try {
      // W4-AO1: state reads are REAL reads (dryRun=false on the reader). On a
      // live run the live adapter reads; on a dry run a separate reader is
      // built from a non-dry context so the session really connects — only
      // the read-only-guarded get_command runs, the set is never sent. If that
      // context cannot be built (e.g. no cert on disk), the pre-state is
      // recorded as unavailable with the reason — never as a placeholder.
      let reader: InstanceType<typeof PowerShellAdapter> | undefined = dryRun ? undefined : adapter;
      if (dryRun) {
        try {
          const readCtx = createExecutionContext(tenantConfig, false);
          reader = new PowerShellAdapter(
            readCtx.executionConfig as unknown as ConstructorParameters<typeof PowerShellAdapter>[0],
            readCtx.sessionFactory as unknown as ConstructorParameters<typeof PowerShellAdapter>[1]
          );
        } catch (ctxErr: any) {
          stateReadError = `dry-run state reader unavailable: ${ctxErr?.message ?? String(ctxErr)}`;
        }
      }
      const gts = await executeGetThenSet(adapter, commandEntry, variables, dryRun, reader);
      executionResult = gts.result;
      preStateOutput = gts.preStateOutput;
      postStateOutput = gts.postStateOutput;
      stateChanged = gts.stateChanged;
      stateReadError = stateReadError ?? gts.stateReadError;
      applied = gts.applied;
    } catch (error: any) {
      const errorResult = handleExecutionError(error, aoCommand);
      executionResult = {
        success: false,
        error: errorResult.message,
        stdout: error?.stdout || '',
        stderr: error?.stderr || '',
        exit_code: error?.exit_code || 1,
      };
    }
  } else {

  // Step 6 (read path): Build ExeTask shape for adapter.execute()
  // Read-only-first: prefer get_command so an audit never fires a write by accident.
  const selectedCommand = commandEntry.get_command || commandEntry.set_command || '';
  const task = {
    id: commandEntry.entry_id,
    action: {
      command: selectedCommand,
      engine: commandEntry.engine,
      args: {},
    },
    controls: commandEntry.control_ids,
    idempotency: commandEntry.idempotency,
  };

  // W4-AO1 (dry runs read real current state, never write): a dry run of a
  // read-only command performs the REAL read through a non-dry reader, after the
  // read-only guard. The adapter's dry-run branch is never used, so its
  // placeholder ("[dry-run] PowerShell commands validated") can no longer be
  // persisted as the row's raw response. If the command is not read-only, or no
  // reader can be built, nothing runs and the reason is recorded.
  let readAdapter: InstanceType<typeof PowerShellAdapter> = adapter;
  let readDryRun = dryRun;
  let skipRead = false;
  if (dryRun) {
    const violation = readOnlyViolation(selectedCommand);
    if (violation) {
      stateReadError = `dry run did not read: ${violation}`;
      skipRead = true;
    } else {
      try {
        const readCtx = createExecutionContext(tenantConfig, false);
        readAdapter = new PowerShellAdapter(
          readCtx.executionConfig as unknown as ConstructorParameters<typeof PowerShellAdapter>[0],
          readCtx.sessionFactory as unknown as ConstructorParameters<typeof PowerShellAdapter>[1]
        );
        readDryRun = false;
      } catch (ctxErr: any) {
        stateReadError = `dry-run reader unavailable: ${ctxErr?.message ?? String(ctxErr)}`;
        skipRead = true;
      }
    }
    if (skipRead) {
      executionResult = { success: true, stdout: '', stderr: '', exit_code: 0 };
    }
  }

  // Step 7: Execute command with retry logic
  while (!skipRead && attemptCount < 3) {
    try {
      // Execute command
      executionResult = await readAdapter.execute(task as any, variables, readDryRun);
      break; // Success — exit retry loop
    } catch (error: any) {
      // Step 8: Error handling
      const errorResult = handleExecutionError(error, aoCommand);

      // Step 9: Retry logic
      const retryDecision = shouldRetry(errorResult, attemptCount);

      if (!retryDecision.retry) {
        // No retry — return error result
        executionResult = {
          success: false,
          error: errorResult.message,
          stdout: error?.stdout || '',
          stderr: error?.stderr || '',
          exit_code: error?.exit_code || 1,
        };
        break;
      }

      // Retry after backoff delay
      attemptCount++;
      await new Promise(resolve => setTimeout(resolve, retryDecision.delayMs));
    }
  }

  } // end read/evidence path (else)

  // If all retries exhausted, ensure we have an executionResult
  if (!executionResult) {
    executionResult = {
      success: false,
      error: 'Execution failed after max retries',
      stdout: '',
      stderr: '',
      exit_code: 1,
    };
  }

  // Step 10: Build evidence artifact (in-memory)
  const evidence = buildEvidenceArtifact(aoCommand, executionResult, commandEntry, variables, {
    dryRun,
    // W4-AO5: a read = the single-command path, unless the command is set-only (then this
    // path ran a write, whose empty output is normal and must not demote the verdict).
    readOp: !isWrite && !(commandEntry.set_command && !commandEntry.get_command),
    // FC-AO-2 (X1): an always-mutate write with no observed change is demoted (see EvidenceEmitter).
    ...(isWrite ? { setApplied: applied, stateChanged } : {}),
  });

  // W4-AO1: why a dry run could not read (read path) is evidence too.
  if (!isWrite && stateReadError) evidence.metadata.stateReadError = stateReadError;

  // Record get-then-set pre/post state on the evidence for audit traceability.
  if (isWrite) {
    evidence.metadata.preStateOutput = preStateOutput;
    evidence.metadata.postStateOutput = postStateOutput;
    // W4-AO1: a real comparison of the two snapshots (undefined when either is missing).
    evidence.metadata.stateChanged = stateChanged;
    evidence.metadata.setApplied = applied;
    if (stateReadError) evidence.metadata.stateReadError = stateReadError;
  }

  // Record the CMMC boundary decision that governed this execution (M4/M3):
  // an allowed-with-warning (Phase 1 migration window) or SoD-floored run is
  // evidence of how enforcement behaved, same as a denial.
  if (cmmcGate.warning || sodFloorApplied) {
    evidence.metadata.cmmcGate = {
      allow: true,
      warning: cmmcGate.warning,
      strict: strictActive,
      tenantCmmcLevel: cmmcTenant.cmmcLevel,
      tenantKind: cmmcTenant.kind,
      ...(sodFloorApplied ? { sodFloorApplied: true } : {}),
    };
  }

  // A Tier 3 approval is single-use — consume it only on a real LIVE execution.
  // A dryRun preview must NOT burn the approval (you preview, then actually run).
  if (consumedApproval && executionResult.success && !dryRun) {
    try {
      await markApprovalExecuted(consumedApproval.approvalId);
    } catch {
      // Non-fatal: the command ran; failing to flip the approval flag must not lose the result.
    }
  }

  // FC-AO-3 step 3: the approving decision's token id, AO-private (StructuredEvidence, not the
  // shared AdminOpsEvidence contract row persistEvidence builds from `opts` below) — the same
  // place the rejection path (ApprovalStore.ts) records it, so an APPROVED decision's only
  // evidence (the executed row) links to EO's mint record the same way a rejection's does.
  if (consumedApproval) {
    evidence.metadata.approverTokenId = consumedApproval.approverTokenId ?? null;
  }

  // Step 11: Persist evidence artifact to durable evidence store
  const { evidencePath, metadataPath, evidencePersisted, evidenceError } = await persistEvidence(evidence, {
    approverUPN: consumedApproval?.approverUPN,
    approvalId: consumedApproval?.approvalId,
  });

  return {
    ...executionResult,
    evidence,
    evidencePath,
    metadataPath,
    evidencePersisted,
    evidenceError,
    correlationId,
  };
}
