// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Copied from Stamper to maintain type stability — DO NOT import from Stamper src/types/

/**
 * Evidence Outcome Enum (11 values for CMMC assessment)
 */
export type EvidenceOutcome =
  | 'automated_success'
  | 'policy_compliance'
  | 'manual_action'
  | 'exception_granted'
  | 'outside_action'
  | 'partial_success'
  | 'failed_remediation_available'
  | 'failed_no_remediation'
  | 'not_applicable'
  | 'inherited'
  | 'verification_pending'
  | 'unknown_legacy'
  | 'dry_run'
  | 'denied_cmmc'
  | 'denied_cui'
  | 'denied_sim_only'
  // W4-AO5: web live apply without confirmApply (contract outcome `failed` until ces-shared adds one).
  | 'denied_apply_guard'
  | 'blocked_pending_approval'
  | 'approval_rejected';

/**
 * Failure Category Enum (for M365 GCC High failure classification)
 */
export type FailureCategory = 'RETRIABLE' | 'CONFIGURATION' | 'FATAL';

/**
 * Failure Diagnostics Schema
 */
export interface FailureDiagnostics {
  rootCause: string;
  failureCategory: FailureCategory;
  remediationSteps: string[];
}

/**
 * Compliance Verdict Enum (SAT/NOT_SAT for CMMC compliance assessment)
 */
export type ComplianceVerdict = 'SAT' | 'NOT_SAT' | 'PROVISIONAL' | 'NOT_APPLICABLE';

/**
 * Registry Entry Snapshot Schema (captures registry metadata at evidence generation time)
 */
export interface RegistryEntrySnapshot {
  entry_id: string;
  label: string;
  engine: string;
  layer_hint?: number;
  sequence_hint?: number;
  idempotency: string;
  on_failure: string;
  control_ids: string[];
  notes?: string;
  manual_only?: boolean;
  get_command?: string;
  set_command?: string;
  evidence_commands?: string[];
}

/**
 * State Verification Details — DSC/InSpec-style content verification result
 */
export interface StateVerificationDetails {
  method: 'parameter_extraction' | 'boolean_search' | 'exit_code_only';
  matchedValue?: string;
  expectedValue?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rawExtract?: string;
  confidenceScore: number;
}

/**
 * Verification Result (from OutputVerificationEngine)
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'FAILED';

export interface VerificationResult {
  passed: boolean;
  confidence: ConfidenceLevel;
  score: number;
  details: {
    exit_code_check: boolean;
    set_output_check: boolean | null;
    evidence_check: boolean | null;
  };
  reason: string;
  stateVerificationDetails?: StateVerificationDetails;
}

/**
 * Structured Evidence Schema (OSCAL-aligned metadata for CMMC audit readiness)
 */
export interface StructuredEvidence {
  rawResponse: string;
  outcome: EvidenceOutcome;
  outcomeRationale: string;
  failureDiagnostics?: FailureDiagnostics;
  complianceVerdict?: ComplianceVerdict;
  verdictRationale?: string;
  verificationResult?: {
    passed: boolean;
    confidence: string;
    score: number;
    details: {
      exit_code_check: boolean;
      set_output_check: boolean | null;
      evidence_check: boolean | null;
    };
    reason: string;
    stateVerificationDetails?: StateVerificationDetails;
  };
  registryEntry?: RegistryEntrySnapshot;
  metadata: {
    controlIds: string[];
    timestamp: string;
    executorIdentity: string;
    commandExecuted: string;
    sha256Hash: string;
    /**
     * G-AO-CMMC-BOUND-1 M4 / GP-AO-BOUND-1 M3: the CMMC boundary decision that
     * governed this execution — a blocked or scoped command is itself evidence
     * of enforcement. Present whenever the gate denied, warned, or a
     * CUI-boundary denial fired; absent only on a clean pre-M4 artifact.
     */
    cmmcGate?: {
      allow: boolean;
      reason?: string;
      warning?: string;
      strict: boolean;
      tenantCmmcLevel?: 'L1' | 'L2';
      tenantKind?: string;
      sodFloorApplied?: boolean;
      cuiBoundaryCase?: 'out-of-boundary' | 'case-a-strict' | 'case-b-footgun';
    };
    dryRun?: boolean;
    mode?: 'dry_run' | 'live';
    moduleVersions?: Record<string, string>;
    environment?: string;
    preStateOutput?: string;
    postStateOutput?: string;
    stateChanged?: boolean;
    /** W4-AO1: whether the set_command ran successfully (independent of whether state changed). */
    setApplied?: boolean;
    /** W4-AO1: why a real state read produced no snapshot (refused, no reader, read failed). */
    stateReadError?: string;
    /**
     * FC-AO-3 step 3 (2026-09-28): the approver token's id (`jti`), when the approval decision
     * that produced this evidence had one — links the decision to EvidenceOps's mint record.
     * AO-private (not part of the shared AdminOpsEvidence contract, `ces-ao/docs/requirements/
     * REQ-ces-shared-principal-token-id.md`); `null` when the approver carried no token id.
     */
    approverTokenId?: string | null;
    architecture_declared?: string;
    mechanism_status?: {
      ca_app_control: boolean;
      non_browser_client_block: boolean;
      dlp_coverage: boolean;
      sensitivity_labels: boolean;
    };
    eo_render_directive?: {
      code: string;
      artifact_type: string;
      artifact_version: string;
      input_sources: string[];
      output_target: string;
      render_scope: string;
    };
  };
}

/**
 * Engine Enum
 */
export type EngineEnum =
  | 'terraform'
  | 'bicep'
  | 'cloudformation'
  | 'cli'
  | 'powershell'
  | 'api'
  | 'manual_gate'
  | 'ipps'
  | 'mgraph'
  | 'exchange'
  | 'az'
  | 'spo'
  | 'teams';

/**
 * Sub-Command Idempotency Enum
 */
export type SubCommandIdempotencyEnum = 'get-then-set' | 'safe' | 'unsafe' | 'evidence-only';

/**
 * Execution Result
 */
export interface ExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  duration_ms?: number;
  artifacts?: string[];
  pre_state?: Record<string, any>;
  post_state?: Record<string, any>;
  evidence_outputs?: string[];
  dry_run?: boolean;
}
