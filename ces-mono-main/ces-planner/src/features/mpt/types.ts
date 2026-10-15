// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// MPT-specific types — aligned with CES schemas and pseudocode

// ---------------------------------------------------------------------------
// Enums matching schemas
// ---------------------------------------------------------------------------
export type PlanMode = 'build_new' | 'harden_existing' | 'migrate' | 'hybrid';
export type TaskType = 'policy' | 'configuration' | 'process' | 'monitoring' | 'training' | 'assessment' | 'evidence_collection';
export type Priority = 'p0' | 'p1' | 'p2' | 'p3';
export type SupportType = 'Overt' | 'Configurable' | 'Inherited' | 'Partial' | 'None';
export type ArtifactType = 'policy' | 'procedure' | 'ssp' | 'diagram' | 'config_export' | 'log_export' | 'ticket_export' | 'training_record' | 'scan_report' | 'attestation' | 'other';
export type ActionEngine = 'terraform' | 'bicep' | 'cloudformation' | 'cli' | 'powershell' | 'api' | 'manual_gate';
export type IdempotencyLevel = 'safe' | 'best_effort' | 'unsafe_requires_gate';
export type RollbackStrategy = 'none' | 'reverse_task' | 'restore_snapshot' | 'manual';
export type CheckMethod = 'api_query' | 'config_export' | 'log_query' | 'event_stream' | 'manual';
export type SourceOfTruth = 'iac' | 'policy_doc' | 'platform_setting' | 'manual';
export type QueryMethod = 'api' | 'export' | 'log_query' | 'manual';
export type CollectionMethod = 'api_poll' | 'event_stream' | 'scheduled_export' | 'manual';
export type DriftSeverity = 'low' | 'medium' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// Scope Exclusion — controls excluded from gap analysis by SI decisions
// ---------------------------------------------------------------------------
export interface ScopeExclusion {
  requirement_id: string;
  justification: string;
  si_field: string;
  si_value: string;
  requires_rr_validation?: boolean;
  kind: 'capability-absent' | 'prohibition';
}

// ---------------------------------------------------------------------------
// Gap Set
// ---------------------------------------------------------------------------
export interface GapSet {
  gaps: Gap[];
  scopeExclusions?: ScopeExclusion[];
  controlDispositions?: ControlDisposition[];
  warnings?: string[];
}

export type GapClassification = 'configure' | 'customize' | 'manual' | 'auto_generate' | 'manual_alternative' | 'control_not_available' | 'scoped_out';
export type BoundaryRelevance = 'in_boundary' | 'out_of_boundary' | 'boundary_adjacent';
export type StamperAction = 'Automated' | 'Non-Stack' | 'N-A-Capability-Absent' | 'Met-By-Prohibition' | 'Inherited-FedRAMP';

export interface Gap {
  requirement_id: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  gap_reason: string;
  gap_classifications: GapClassification[];
  missing_evidence_archetypes: string[];
  methods_needed: string[];
  // CMMC requirement context
  requirement_title: string;
  requirement_text: string;
  domain: string;
  level: string;
  nist_reference: string;
  assessment_objectives: Array<{ id: string; text: string; methods: string[] }>;
  design_for_assessment: Array<{ title: string; constraint: string; verification: string }>;
  operationalization_notes?: string;
  common_pitfalls?: string[];
  boundary_relevance?: BoundaryRelevance;
}

/**
 * stamper_action: Disposition directive consumed by Stamper
 *   - Automated: Stamper can configure, validate, or test this control
 *   - N-A-Capability-Absent: Underlying capability does not exist in environment (SPRS: N/A)
 *   - Met-By-Prohibition: Requirement addressed via enforced prohibition (SPRS: MET)
 *   - Non-Stack: Outside information system boundary, requires out-of-band evidence
 */
export interface ControlDisposition {
  requirement_id: string;
  title: string;
  domain: string;
  level: string;
  scope_status: 'in_scope' | 'scoped_out';
  scope_justification?: string;
  si_decision?: { field: string; value: string };
  readiness_status?: 'met' | 'partial' | 'not_met' | 'unknown';
  stamper_action: StamperAction;
  task_ids: string[];
  estimated_effort_hours: number;
  gap_classifications: GapClassification[];
  inheritance_rationale?: string;
  fedramp_package_id?: string;
  requires_stamper_verification?: boolean;
}

export type StamperDirective = 'implement' | 'validate' | 'manual' | 'document-absence' | 'document-prohibition' | 'skip' | 'inherit-fedramp';

export interface ControlDirective {
  control_id: string;
  directive: StamperDirective;
  justification?: string;
  step_ids?: string[];
  inheritance_rationale?: string;
  fedramp_package_id?: string;
  tenant_variant?: string;
  requires_stamper_verification?: boolean;
}

// ---------------------------------------------------------------------------
// Effort Estimation — 5-category breakdown for automation ROI
// ---------------------------------------------------------------------------
export interface EffortEstimate {
  one_time_dev_loe: number;
  one_time_config_manual: number;
  one_time_config_automated: number;
  recurring_evidence_manual: number; // annual hours
  recurring_evidence_automated: number; // annual hours
}

// ---------------------------------------------------------------------------
// Structured action — first-class leaf node from implementation patterns
// ---------------------------------------------------------------------------
export interface StepAction {
  action_id: string;
  action: string;
  action_type: string;
  evidence_outputs: string[];
  vendor?: {
    m365_service?: string;
    implementation?: string;
    portal_path?: string;
    powershell?: string[];
    evidence_commands?: string[];
    notes?: string;
    tech_ref_guidance?: string[];
  };
}

// ---------------------------------------------------------------------------
// Task Catalog — rich tasks per pseudocode §4.3
// ---------------------------------------------------------------------------
export interface TaskCatalog {
  tasks: Task[];
}

export interface Task {
  task_id: string;
  requirement_id: string;
  task_type: TaskType;
  title: string;
  description: string;
  actions: StepAction[];
  what_to_do: string[];
  how_to_verify: string[];
  expected_artifacts: EvidenceArtifact[];
  vendor_help_refs: VendorHelpRef[];
  control_coverage: ControlCoverage[];
  dependencies: string[];
  priority: Priority;
  owner_role: string;
  estimated_effort_hours: number;
  effort_estimate: EffortEstimate;
  gap_classifications: GapClassification[];
  impl_engine?: ActionEngine;
  impl_command?: string;
  impl_args?: Record<string, unknown>;
  // CMMC requirement context
  requirement_title: string;
  requirement_text: string;
  domain: string;
  level: string;
  nist_reference: string;
  btc_gate_context?: {
    gate_id: string;
    failure_reason: string;
  };
  tech_ref?: {
    assessment_objectives: Array<{ id: string; text: string }>;
    nist_mapping: string;
    implementation_by_service: Array<{
      service_name: string;
      paragraphs: Array<{
        text: string;
        text_with_links: string;
        links: Array<{ text: string; url: string }>;
      }>;
    }>;
    gcch_responsibilities: Array<{
      text: string;
      text_with_links: string;
    }>;
    evidence_guidance?: {
      assessor_methods: string[];
      archetypes: Array<{
        archetype_id: string;
        name: string;
        strength: string;
        strength_examples: Array<{ strength: string; description: string }>;
      }>;
      anti_patterns: string[];
    };
  };
}

// ---------------------------------------------------------------------------
// Shared sub-types used by multiple artifacts
// ---------------------------------------------------------------------------
export interface SourceRef {
  id: string;
  title: string;
  url?: string;
  type?: 'government' | 'nist' | 'vendor' | 'internal';
  version?: string;
  published_date?: string;
}

export interface EvidenceArtifact {
  artifact_id: string;
  artifact_type: ArtifactType;
  description: string;
  collector: string;
  retention_days: number;
  storage_location_ref: string;
}

export interface VendorHelpRef {
  vendor: string;
  product: string;
  title: string;
  url?: string;
  path_hint?: string;
}

export interface ControlCoverage {
  control_id: string;
  support_type: SupportType;
  gap_rationale: string;
}

export interface Check {
  id: string;
  description: string;
  method: CheckMethod;
  expected: string;
  on_fail: string;
}

export interface DFARule {
  id: string;
  title: string;
  rule: string;
  verification: string;
  assessor_method_alignment?: Array<'examine' | 'interview' | 'test'>;
  sources: string[];
}

// ---------------------------------------------------------------------------
// MPT Store state
// ---------------------------------------------------------------------------
export interface MPTState {
  planMode: PlanMode;
  generatedArtifacts: {
    manualPlan?: any;
    proposal?: any;
    manifest?: any;
  };
}

// ---------------------------------------------------------------------------
// Control Assessment Report
// ---------------------------------------------------------------------------
export interface ControlEntry {
  requirement_id: string;
  title: string;
  requirement_text: string;
  domain: string;
  level: string;
  nist_reference: string;
  scope_status: 'in_scope' | 'scoped_out';
  scope_justification?: string;
  si_decision?: { field: string; value: string };
  readiness_status?: 'met' | 'partial' | 'not_met' | 'unknown';
  readiness_notes?: string;
  implementation_summary: string;
  gap_classifications: GapClassification[];
  task_count: number;
  estimated_effort_hours: number;
  assessor_expectations: {
    assessor_intent?: string;
    assessor_methods?: string[];
    what_assessors_probe?: string[];
    common_failure_modes?: string[];
  };
}

export interface ControlAssessmentReport {
  ces: import('@/shared/types/artifacts').ArtifactMetadata;
  summary: {
    total_controls: number;
    in_scope: number;
    scoped_out: number;
    met: number;
    partial: number;
    not_met: number;
    unknown: number;
  };
  controls: ControlEntry[];
}
