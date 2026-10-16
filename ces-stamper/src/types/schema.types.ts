// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { z } from 'zod';
import type { AppliedOp } from '../rollback/InverseOps.js';

// Evidence Outcome Enum (11 values for CMMC assessment)
export const EvidenceOutcomeEnum = z.enum([
  'automated_success',
  'policy_compliance',
  'manual_action',
  'exception_granted',
  'outside_action',
  'partial_success',
  'failed_remediation_available',
  'failed_no_remediation',
  'not_applicable',
  'inherited',
  'verification_pending',
  'unknown_legacy'
]);

export type EvidenceOutcome = z.infer<typeof EvidenceOutcomeEnum>;

// Failure Category Enum (for M365 GCC High failure classification)
export const FailureCategoryEnum = z.enum(['RETRIABLE', 'CONFIGURATION', 'FATAL']);
export type FailureCategory = z.infer<typeof FailureCategoryEnum>;

// Failure Diagnostics Schema
export const FailureDiagnosticsSchema = z.object({
  rootCause: z.string(),
  failureCategory: FailureCategoryEnum,
  remediationSteps: z.array(z.string())
});

export type FailureDiagnostics = z.infer<typeof FailureDiagnosticsSchema>;

// Compliance Verdict Enum (SAT/NOT_SAT for CMMC compliance assessment)
export const ComplianceVerdictEnum = z.enum(['SAT', 'NOT_SAT', 'PROVISIONAL']);
export type ComplianceVerdict = z.infer<typeof ComplianceVerdictEnum>;

// Registry Entry Snapshot Schema (captures registry metadata at evidence generation time)
export const RegistryEntrySnapshotSchema = z.object({
  entry_id: z.string(),
  label: z.string(),
  engine: z.string(),
  layer_hint: z.number().optional(),
  sequence_hint: z.number().optional(),
  idempotency: z.string(),
  on_failure: z.string(),
  control_ids: z.array(z.string()),
  notes: z.string().optional(),
  manual_only: z.boolean().optional(),
  get_command: z.string().optional(),
  set_command: z.string().optional(),
  evidence_commands: z.array(z.string()).optional()
});

export type RegistryEntrySnapshot = z.infer<typeof RegistryEntrySnapshotSchema>;

// EvidenceOps render directive for document-renderable controls (W4-ST4).
export const EoRenderDirectiveSchema = z.object({
  directive_code: z.string(),
  artifact_type: z.string(),
  artifact_version: z.string(),
  input_sources: z.array(z.string()),
  output_target: z.string(),
  render_scope: z.string(),
  depends_on: z.array(z.string()).optional(),
});

export type EoRenderDirective = z.infer<typeof EoRenderDirectiveSchema>;

// Structured Evidence Schema (OSCAL-aligned metadata for CMMC audit readiness)
export const StructuredEvidenceSchema = z.object({
  rawResponse: z.string(),
  outcome: EvidenceOutcomeEnum,
  outcomeRationale: z.string(),
  failureDiagnostics: FailureDiagnosticsSchema.optional(),
  complianceVerdict: ComplianceVerdictEnum.optional(),
  verdictRationale: z.string().optional(),
  verificationResult: z.object({
    passed: z.boolean(),
    confidence: z.string(),
    score: z.number(),
    details: z.object({
      exit_code_check: z.boolean(),
      set_output_check: z.boolean().nullable(),
      evidence_check: z.boolean().nullable(),
    }),
    reason: z.string(),
    stateVerificationDetails: z.object({
      method: z.string(),
      matchedValue: z.string().optional(),
      expectedValue: z.string().optional(),
      confidence: z.string(),
      rawExtract: z.string().optional(),
      confidenceScore: z.number(),
    }).optional(),
  }).optional(),
  registryEntry: RegistryEntrySnapshotSchema.optional(),
  metadata: z.object({
    controlIds: z.array(z.string()),
    timestamp: z.string(),
    executorIdentity: z.string(),
    commandExecuted: z.string(),
    sha256Hash: z.string(),
    moduleVersions: z.record(z.string()).optional(),
    environment: z.string().optional(),
    preStateOutput: z.string().optional(),
    postStateOutput: z.string().optional(),
    stateChanged: z.boolean().optional(),
    architecture_declared: z.string().optional(),
    mechanism_status: z.object({
      ca_app_control: z.boolean(),
      non_browser_client_block: z.boolean(),
      dlp_coverage: z.boolean(),
      sensitivity_labels: z.boolean(),
    }).optional(),
  }),
  // W4-ST4: top level, `directive_code` — the shape EvidenceOps' StamperEvidenceLoader parses
  // (RenderDirectiveSchema in ces-eo/src/shared/types/render.types.ts).
  eo_render_directive: EoRenderDirectiveSchema.optional(),
});

export type StructuredEvidence = z.infer<typeof StructuredEvidenceSchema>;

// Enums
export const LevelEnum = z.enum(['L1', 'L2', 'L3']);
export const PriorityEnum = z.enum(['p0', 'p1', 'p2', 'p3']);
export const TaskTypeEnum = z.enum([
  'policy',
  'configuration',
  'process',
  'monitoring',
  'training',
  'assessment',
  'evidence_collection',
  'validate'
]);
export const EngineEnum = z.enum([
  'terraform',
  'bicep',
  'cloudformation',
  'cli',
  'powershell',
  'api',
  'manual_gate',
  'ipps',
  'mgraph',
  'exchange',
  'az',
  'spo',
  'teams'
]);
export const IdempotencyEnum = z.enum(['safe', 'best_effort', 'unsafe_requires_gate']);
export const RollbackStrategyEnum = z.enum(['none', 'reverse_task', 'restore_snapshot', 'manual']);
export const CheckMethodEnum = z.enum(['api_query', 'config_export', 'log_query', 'manual', 'event_stream']);
export const ArtifactTypeEnum = z.enum([
  'policy',
  'procedure',
  'ssp',
  'diagram',
  'config_export',
  'log_export',
  'ticket_export',
  'training_record',
  'scan_report',
  'attestation',
  'other'
]);

// Evidence Artifact Schema
export const EvidenceArtifactSchema = z.object({
  artifact_id: z.string().min(1),
  artifact_type: ArtifactTypeEnum,
  description: z.string().min(1),
  collector: z.string().min(1),
  retention_days: z.number().int().min(0),
  storage_location_ref: z.string().min(1)
});

// Rollback Schema
export const RollbackSchema = z.object({
  strategy: RollbackStrategyEnum,
  notes: z.string().optional()
});

// Action Schema
export const ActionSchema = z.object({
  engine: EngineEnum,
  command: z.string().min(1),
  args: z.record(z.any())
});

// ExeTask Schema
export const ExeTaskSchema = z.object({
  id: z.string().min(1),
  type: TaskTypeEnum,
  priority: PriorityEnum,
  depends_on: z.array(z.string().min(1)),
  action: ActionSchema,
  inputs: z.array(z.string().min(1)),
  outputs: z.array(z.string().min(1)),
  controls: z.array(z.string().min(1)).min(1),
  idempotency: IdempotencyEnum,
  rollback: RollbackSchema,
  evidence_emit: z.array(EvidenceArtifactSchema).optional()
});

// Check Schema — method includes 'manual' for Phase 6 PostcheckRunner dispatch
export const CheckSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  method: CheckMethodEnum,
  expected: z.string().min(1),
  on_fail: z.string().min(1),
  target: z.string().optional(),
  expected_field: z.string().optional()
});

// G1/T2 identity propagation — the (customer, SI-baseline) tuple that survives
// from the Planner's mission plan envelope into Stamper. All fields optional so
// existing plans/fixtures still validate. See ADR-001-ces-identity-model.
export const CesIdentitySchema = z.object({
  cesId: z.string(),
  customerId: z.number().int(),
  siBaselineId: z.number().int(),
  customerName: z.string(),
  tenantSlug: z.string()
}).partial();

// Executable Plan Schema
export const ExecutablePlanSchema = z.object({
  plan_id: z.string().min(1),
  target_level: LevelEnum,
  tech_stack_id: z.number().int().min(1),
  execution_graph: z.array(ExeTaskSchema).min(1),
  variables: z.record(z.any()),
  prechecks: z.array(CheckSchema),
  postchecks: z.array(CheckSchema),
  ces: CesIdentitySchema.optional()
});

// Type exports
export type Level = z.infer<typeof LevelEnum>;
export type Priority = z.infer<typeof PriorityEnum>;
export type TaskType = z.infer<typeof TaskTypeEnum>;
export type Engine = z.infer<typeof EngineEnum>;
export type Idempotency = z.infer<typeof IdempotencyEnum>;
export type RollbackStrategy = z.infer<typeof RollbackStrategyEnum>;
export type CheckMethod = z.infer<typeof CheckMethodEnum>;
export type ArtifactType = z.infer<typeof ArtifactTypeEnum>;
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;
export type Rollback = z.infer<typeof RollbackSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type ExeTask = z.infer<typeof ExeTaskSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type ExecutablePlan = z.infer<typeof ExecutablePlanSchema>;
export type CesIdentity = z.infer<typeof CesIdentitySchema>;

// Execution state types
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'accomplished';

export interface TaskExecutionState {
  task_id: string;
  status: TaskStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
  outputs?: Record<string, any>;
  evidence_artifacts?: string[];
  pre_state?: Record<string, any>;
  post_state?: Record<string, any>;
}

export interface PlanExecutionState {
  plan_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  started_at: string;
  completed_at?: string;
  last_executed_task_id?: string;
  tasks: Record<string, TaskExecutionState>;
  prechecks_passed: boolean;
  postchecks_passed?: boolean;
  // G1/T2 identity propagation — the (customer, SI-baseline) tuple from the plan envelope.
  ces?: CesIdentity;
  // W4-ST3: every SET applied during execution, with its derived inverse, in apply order.
  applied_ops?: AppliedOp[];
  // W4-ST3: outcome of the last run-level rollback.
  rollback?: {
    rolled_back_at: string;
    reversed: number;
    failed: number;
    manual: number;
  };
}

// Execution result types — extended with pre/post state snapshots and evidence outputs
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
  // W4-ST3: SETs this execution applied (success or not), with derived inverses.
  applied_ops?: AppliedOp[];
}

// Sub-command types for multi-command task execution
export const CaptureSpecSchema = z.object({
  variable: z.string().min(1),
  from: z.enum(['stdout', 'json_field', 'regex']),
  json_path: z.string().optional(),
  regex_pattern: z.string().optional(),
});

export const SubCommandIdempotencyEnum = z.enum(['get-then-set', 'safe', 'unsafe', 'evidence-only']);

// Verification criteria schema (shared by CommandEntry and SubCommand)
export const VerificationCriteriaSchema = z.object({
  set_output: z.object({
    min_length: z.number().int().min(1).optional(),
    fields_present: z.array(z.string()).optional(),
    regex_pattern: z.string().optional(),
  }).optional(),
  evidence: z.object({
    jsonpath: z.string().optional(),
    equals: z.string().optional(),
    regex: z.string().optional(),
    not_empty: z.boolean().optional(),
  }).optional(),
  consistency_hint: z.enum(['sync', 'eventual_fast', 'eventual_slow', 'eventual_hours']).optional(),
  confidence_weights: z.object({
    exit_code: z.number().min(0).max(1).default(0.2),
    set_output: z.number().min(0).max(1).default(0.2),
    evidence_match: z.number().min(0).max(1).default(0.6),
  }).optional(),
});

export type VerificationCriteria = z.infer<typeof VerificationCriteriaSchema>;

export const SubCommandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  set_command: z.string(),
  get_command: z.string(),
  engine: EngineEnum,
  sequence_hint: z.number().int(),
  idempotency: SubCommandIdempotencyEnum,
  variables_required: z.array(z.string()),
  variables_runtime: z.array(z.string()),
  captures: z.array(CaptureSpecSchema).optional(),
  on_failure: z.enum(['abort_step', 'abort_plan', 'warn_continue']),
  evidence_commands: z.array(z.string()),
  verification: VerificationCriteriaSchema.optional(),
});

export type CaptureSpec = z.infer<typeof CaptureSpecSchema>;
export type SubCommandIdempotency = z.infer<typeof SubCommandIdempotencyEnum>;
export type SubCommand = z.infer<typeof SubCommandSchema>;

// State Verification Details — DSC/InSpec-style content verification result
export interface StateVerificationDetails {
  method: 'parameter_extraction' | 'boolean_search' | 'exit_code_only';
  matchedValue?: string;      // ALWAYS string (stringified for comparison)
  expectedValue?: string;     // ALWAYS string (stringified for comparison)
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rawExtract?: string;
  confidenceScore: number;    // 0-100 clamped range
}

// Discovery Result interface — used by assess.routes.ts for discoveryResults Map
export interface DiscoveryResult {
  status: 'exists' | 'missing' | 'error' | 'no_query' | 'permission_denied';
  verdict?: 'SAT' | 'NOT_SAT';
  verificationScore?: number;
}

// Evidence metadata types
export interface EvidenceMetadata {
  artifact_id: string;
  artifact_type: ArtifactType;
  task_id: string;
  control_ids: string[];
  collector: string;
  collected_at: string;
  retention_days: number;
  storage_location: string;
  sha256_hash: string;
  file_size_bytes?: number;
  mime_type?: string;
  // G1/T2 identity propagation — tags evidence with the (customer, SI-baseline) tuple.
  ces?: CesIdentity;
}

