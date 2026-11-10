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
  remediationSteps: z.array(z.string()),
  // synthetic-customer W5 cycle 3: what the failed command returned (tails bounded, already redacted).
  exitCode: z.number().optional(),
  stderrTail: z.string().optional(),
  stdoutTail: z.string().optional(),
  httpStatus: z.number().optional(),
  responseBody: z.string().optional(),
});

export type FailureDiagnostics = z.infer<typeof FailureDiagnosticsSchema>;

// Compliance Verdict Enum (SAT/NOT_SAT for CMMC compliance assessment)
export const ComplianceVerdictEnum = z.enum(['SAT', 'NOT_SAT', 'PROVISIONAL']);
export type ComplianceVerdict = z.infer<typeof ComplianceVerdictEnum>;

// synthetic-customer W5 cycle 2: what translate configured for one org-value binding of an entry.
// basis 'organisation' = the TM row's value; 'registry' = the registry default kept (note says why).
export const OrgValueDecisionSchema = z.object({
  path: z.string(),
  token: z.string(),
  op: z.enum(['lte', 'gte', 'equals']), // W5c7: 'equals' = a string value (the NTP server), no bound
  control_ids: z.array(z.string()),
  source: z.string().optional(),
  organisation_value: z.union([z.number(), z.string()]),
  registry_value: z.union([z.number(), z.string()]),
  configured_value: z.union([z.number(), z.string()]),
  basis: z.enum(['organisation', 'registry']),
  note: z.string().optional(),
  // Run 50 fixes: 'registry' = on the exists path this value is checked against the registry default,
  // not the organisation value (another entry owns the organisation's assertion for that control).
  exists_bound: z.literal('registry').optional(),
});

export type OrgValueDecision = z.infer<typeof OrgValueDecisionSchema>;

// synthetic-customer W5 cycle 3 (Stamper part 2): the equivalence lookup of a get-then-set entry. The GET
// finds CES's own object by name OR a tenant object with the same effect, so a customer's existing
// equivalent is verified instead of duplicated. Conditions are in the TM expected_value style
// ({ path, op, value }); `any_of` holds when one of its conditions holds. Muster discovery reads the
// same block (registry data), so it is documented in docs/context LOG-W5c3-stamper2.md.
export const LookupOpEnum = z.enum(['equals', 'not_equals', 'in', 'contains', 'all_in', 'lte', 'gte', 'not_empty', 'empty']);
const LookupValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]);
export const LookupConditionSchema = z.object({
  path: z.string().min(1),
  op: LookupOpEnum,
  value: LookupValueSchema.optional(),
});
export const LookupEffectSchema = z.union([
  LookupConditionSchema,
  z.object({ any_of: z.array(LookupConditionSchema).min(2) }),
]);
export const LookupBlockSchema = z.object({
  source: z.string().min(1),                                           // PowerShell that emits the candidate objects
  by_name: z.object({ path: z.string().min(1), equals: z.string().min(1) }), // CES's own object
  by_effect: z.array(LookupEffectSchema).min(1),                       // all must hold for an equivalent
  // Run 50 fixes: the object's '@odata.type' must be one of these (pins the Intune object type).
  odata_type: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
});

export type LookupCondition = z.infer<typeof LookupConditionSchema>;
export type LookupEffect = z.infer<typeof LookupEffectSchema>;
export type LookupBlock = z.infer<typeof LookupBlockSchema>;

// W5c3 part 2: how the exists path found the object, and (for an equivalent) each condition checked.
export const LookupMatchSchema = z.object({
  basis: z.enum(['name', 'effect']),
  object: z.string(),
  conditions: z.array(z.object({
    path: z.string(),
    op: z.string(),
    expected: z.unknown().optional(),
    observed: z.unknown().optional(),
    pass: z.boolean(),
  })).optional(),
});

export type LookupMatch = z.infer<typeof LookupMatchSchema>;

// synthetic-customer W5 cycle 3: an existing resource's value on a bound path, against the bound
// (lte: [1, configured]; gte: >= configured). Written when the GET found the resource and no SET ran.
export const OrgValueCheckSchema = z.object({
  path: z.string(),
  token: z.string(),
  op: z.enum(['lte', 'gte']),
  configured_value: z.number(),
  bound: z.object({ min: z.number(), max: z.number().optional() }),
  observed_value: z.number().nullable(),
  within_bound: z.boolean(),
  basis: z.literal('existing'),
});

export type OrgValueCheck = z.infer<typeof OrgValueCheckSchema>;

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
  evidence_commands: z.array(z.string()).optional(),
  destructive: z.boolean().optional()
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
    // synthetic-customer W3: DistributionStatus of the verified read (post-SET GET, else the
    // pre-SET GET), for entries whose evidence rule reads $.DistributionStatus.
    distributionStatus: z.string().optional(),
    // synthetic-customer W3: on a SET-path entry's record, 'state' when a registry state assertion
    // was evaluated on this record's read, else 'presence' (with the reason).
    postcheckMode: z.enum(['state', 'presence']).optional(),
    presenceReason: z.string().optional(),
    // synthetic-customer W3: a manual gate's record (owner role; 'approved' only after an operator acted).
    // FIN-15 (CG-4 remainder): 'cost' = a cost-gate DP-1/DP-2 record (CostGate.ts
    // CostGateEvidenceRecord; COST-GATE-SPEC §3.9). Those records live in <tenant>/cost-gate-evidence/
    // and never score: a 'cost' record carries no gateAction and credits no control (FD-2).
    gate: z.enum(['manual', 'cost']).optional(),
    // FIN-15: on a 'cost' record, which confirmation it is (1 = plan-time opt-in, 2 = typed at run time).
    dp: z.union([z.literal(1), z.literal(2)]).optional(),
    ownerRole: z.string().optional(),
    gateAction: z.enum(['approved', 'rejected', 'none']).optional(),
    // synthetic-customer W3: a document renderable's rendered policy document from the policy-set manifest.
    policyRef: z.object({
      document: z.string(),
      sha256: z.string(),
      manifestArtifactId: z.string().optional(),
      manifestSha256: z.string().optional(),
      manifestFile: z.string(),
    }).optional(),
    // W1: variable -> source of a secret input this entry used (e.g. 'environment'). Never a value.
    secretProvenance: z.record(z.string()).optional(),
    // W5c2: the organisation values translate configured on this entry (or kept, with the note).
    orgValues: z.array(OrgValueDecisionSchema).optional(),
    // W5c3: on the "already exists" path, the value read on each bound path and the bound it met (or not).
    orgValueChecks: z.array(OrgValueCheckSchema).optional(),
    // W5c3 part 2: on the "already exists" path of an entry with a lookup, how the object was found.
    lookupMatch: LookupMatchSchema.optional(),
    // PH7-ST: a record written by a registry entry a manual gate ran (display only; EO never credits it).
    gateContext: z.literal('manual_gate').optional(),
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
  // FX-01: the destructive-entry preview (accounts the SET would change) and its decision.
  destructivePreview: z.object({
    populationCount: z.number(),
    targets: z.array(z.unknown()),
    share: z.number(),
    maxShare: z.number(),
    refused: z.boolean(),
    reason: z.string(),
    rawPreview: z.string(),
  }).optional(),
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
  evidence_emit: z.array(EvidenceArtifactSchema).optional(),
  // DEPTH-3 (CONTRACT CHANGE): cross-credit by objective. controls[] = the step's own controls; an entry
  // this task runs that names objectives of other controls credits them here, never as extra controls.
  credits: z.array(z.object({
    objective_id: z.string().min(1),
    entry_id: z.string().min(1),
  })).optional()
});

// DEPTH-6 (CONTRACT CHANGE): one coverage record per in-scope assessment objective.
export const ObjectiveCoverageTypeEnum = z.enum(['configure', 'document', 'manual', 'inherited', 'not_applicable', 'uncovered']);
export const ObjectiveCoverageSchema = z.object({
  objective_id: z.string().min(1),
  type: ObjectiveCoverageTypeEnum,
  /** configure: the planned SET entries naming this objective; uncovered: the reads that only evidence it. */
  entry_ids: z.array(z.string()).optional(),
  /** document / manual / inherited / not_applicable: the task that carries it. */
  task_id: z.string().optional(),
  /** inherited / not_applicable: the basis (package, justification). */
  basis: z.string().optional(),
  reason: z.string().optional(),
});
export type ObjectiveCoverage = z.infer<typeof ObjectiveCoverageSchema>;

// Check Schema — method includes 'manual' for Phase 6 PostcheckRunner dispatch
export const CheckSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  method: CheckMethodEnum,
  expected: z.string().min(1),
  on_fail: z.string().min(1),
  target: z.string().optional(),
  expected_field: z.string().optional(),
  // synthetic-customer W3: the Tenant Manifest control this check verifies, and the expected
  // value its config_export compares (the TM verification row's `expected_value`, ces-shared
  // 2.9.0, MG-27). Absent = presence-only (`presence_only` is carried for the record).
  control_id: z.string().optional(),
  expected_value: z.object({
    path: z.string().min(1),
    op: z.enum(['equals', 'contains', 'gte', 'lte', 'exists', 'count-gte']),
    value: z.any().optional(),
    source: z.string().optional(),
  }).optional(),
  presence_only: z.boolean().optional(),
  // DEPTH-7/8: the assessment objective this postcheck verifies, and the KB assessment methods.
  objective_id: z.string().optional(),
  assessment_methods: z.array(z.enum(['examine', 'interview', 'test'])).optional()
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
  ces: CesIdentitySchema.optional(),
  objective_coverage: z.array(ObjectiveCoverageSchema).optional()
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
    // FX-04: several jsonpath checks over the same JSON output; all must pass.
    checks: z.array(z.object({
      jsonpath: z.string(),
      equals: z.string().optional(),
      regex: z.string().optional(),
      // W5c3: numeric bounds (inclusive) on the value at jsonpath.
      min: z.number().optional(),
      max: z.number().optional(),
      // W5c3 part 2: the value at jsonpath is an array with at least this many items.
      min_items: z.number().int().min(1).optional(),
    })).optional(),
    // W5c3: numeric bounds (inclusive) on the value at jsonpath.
    min: z.number().optional(),
    max: z.number().optional(),
    // W5c3 part 2: the value at jsonpath is an array with at least this many items.
    min_items: z.number().int().min(1).optional(),
  }).optional(),
  consistency_hint: z.enum(['sync', 'eventual_fast', 'eventual_slow', 'eventual_hours']).optional(),
  // synthetic-customer W3 (2026-10-28): a get-then-set creation entry whose GET finds the
  // resource is SAT only when the evidence rule passes on that read (PowerShellAdapter's
  // "already exists" path); otherwise the entry fails. W3 (Stamper slice): this is the default for
  // every creation entry with an evidence rule; only `verify_on_exists: false` keeps the unverified skip.
  verify_on_exists: z.boolean().optional(),
  // synthetic-customer W3: 'state' = the evidence rule asserts a configured value; 'presence' =
  // it proves only that the object exists (presence_reason says why no state is asserted).
  postcheck_mode: z.enum(['state', 'presence']).optional(),
  presence_reason: z.string().optional(),
  confidence_weights: z.object({
    exit_code: z.number().min(0).max(1).default(0.2),
    set_output: z.number().min(0).max(1).default(0.2),
    evidence_match: z.number().min(0).max(1).default(0.6),
  }).optional(),
});

export type VerificationCriteria = z.infer<typeof VerificationCriteriaSchema>;

// FX-01: preconditions for registry entries that disable, delete or remove.
export const DestructiveGuardSchema = z.object({
  // Each command must exit 0 with non-empty output: proves an exclusion resolves to an existing account.
  exclusion_checks: z.array(z.string()),
  // Variables that hold exclusion values; each must be non-empty.
  exclusion_variables: z.array(z.string()),
  // Read-only command printing JSON {"populationCount": n, "targets": [...]} for what the SET would change.
  preview_command: z.string(),
  // Refuse when targets / populationCount exceeds this share (and always when it is all of them).
  max_share: z.number().min(0).max(1),
});

export type DestructiveGuard = z.infer<typeof DestructiveGuardSchema>;

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
  destructive: z.boolean().optional(),
  destructive_guard: DestructiveGuardSchema.optional(),
  org_values: z.array(OrgValueDecisionSchema).optional(),
  lookup: LookupBlockSchema.optional(),
  verify_only: z.boolean().optional(),
  // PH-13 (P13-ST, founder Q3): entry ids whose task must run before this read's task (the read reads what they create).
  read_after: z.array(z.string()).optional(),
  // W5c3 part 2 (ST-C3): the registry entry's own control_ids. A record is attributed to these, not to
  // every control of its task (the task's controls are the union over all its entries).
  control_ids: z.array(z.string()).optional(),
  // DEPTH-3/6: the registry entry's objective_ids; DEPTH-4: its manual_only flag.
  objective_ids: z.array(z.string()).optional(),
  manual_only: z.boolean().optional(),
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

