// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// RRT-specific types
// VENDORED from ces-planner src/features/rrt/types.ts @ 4a00bee5d5e618cf55da2469ec12307ebc620418
// No import path adjustments required (self-contained module).

export interface RRTAnswer {
  question_id: string;
  source_activity_id?: string;
  answer: any;
  provenance_class: 'client_assertion' | 'operator_observation' | 'operator_inference' | 'assumption' | 'system_observation' | 'auto_collected';
  mapped_requirements: string[];
  assessor_methods_satisfied?: string[];
  expected_evidence_archetypes?: string[];
  evidence_ids?: string[];
  notes?: string;
}

export interface EvidenceItem {
  evidence_id: string;
  source_system: string;
  location: string;
  hash_sha256: string;
  captured_at: string;
  archetype_id: string;
  collector?: string;
  retention_days?: number;
  freshness_days?: number;
  assessor_methods_supported?: string[];
  mapped_requirements?: string[];
  supporting_question_ids?: string[];
  notes?: string;
}

export interface RRTState {
  currentStep: number;
  answers: Record<string, RRTAnswer>;
  evidenceItems: EvidenceItem[];
  questionSet: any | null;
  isComplete: boolean;
  wizardPhase: RRTWizardPhase;
  preambleAnswers: PreambleAnswers | null;
  actionStatuses: DerivedActionStatus[];
}

export interface RRActivity {
  activity_id: string;
  activity_name: string;
  description?: string;
  questions: RRQuestion[];
  mapped_requirements?: string[];
  expected_evidence?: string[];
}

/** Expected evidence guidance from the question bank */
export interface ExpectedEvidence {
  evidence_matrix_id: string;
  archetype_id: string;
  minimum_fields?: string[];
  description?: string;
}

export interface RRQuestion {
  question_id: string;
  question_text: string;
  prompt?: string;
  name?: string;
  description?: string;
  answer_type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'enum'
    | 'array'
    | 'yes_no'
    | 'multi_select'
    | 'free_text'
    | 'url'
    | 'structured_json'
    | 'evidence_upload';
  enum_values?: string[];
  mapped_requirements?: string[];
  expected_evidence?: ExpectedEvidence[];
  expected_evidence_archetypes?: string[];
  assessor_methods?: Array<'examine' | 'interview' | 'test' | string>;
  source_activity_id?: string;
  produces_rrt_fields?: string[];

  // Advisory guidance fields
  advisor_reason_rrt?: string;
  advisor_cmmc_impact?: string;
  advisor_description?: string;

  // Step-by-step guidance
  steps?: Array<{
    step_number: number;
    instruction: string;
    expected_output?: string;
  }>;
  outputs?: string[];

  // Detailed evidence requests from activity bank
  evidence_requests?: Array<{
    id?: string;
    evidence_type?: string;
    archetype_id?: string;
    description?: string;
    acceptable_forms?: string[];
    collection_method?: string;
    retention_notes?: string;
    cmmc_attainment_impact?: string;
    advisor_notes?: string;
    required_fields?: string[];
  }>;

  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
  };
}

export interface RequirementResult {
  requirement_id: string;
  status: 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNKNOWN';
  confidence: number;
  evidence_refs: string[];
  supporting_question_ids?: string[];
  assessor_methods_satisfied?: string[];
  evidence_archetypes_satisfied?: string[];
  notes?: string;
}

// --- Preamble ---
export type LicenseTier =
  | 'e3'
  | 'e5'
  | 'business_premium'
  | 'gcc_g3'
  | 'gcc_g5'
  | 'unknown';
export type SecurityArchetype =
  | 'greenfield'
  | 'security_defaults_only'
  | 'basic_ca_policies'
  | 'moderate_hardening'
  | 'managed_by_msp';
export type EndpointManagement =
  | 'intune_enrolled'
  | 'third_party_mdm'
  | 'unmanaged'
  | 'mixed';
export type MonitoringSIEM =
  | 'sentinel_deployed'
  | 'third_party_siem'
  | 'basic_m365_audit'
  | 'none';
export type PolicyDocState =
  | 'ssp_with_policies'
  | 'some_policies_drafted'
  | 'nothing_written';

export interface PreambleAnswers {
  license_tier: LicenseTier;
  security_archetype: SecurityArchetype;
  endpoint_management: EndpointManagement;
  monitoring_siem: MonitoringSIEM;
  policy_doc_state: PolicyDocState;
}

// --- Action Statuses ---
export type ActionStatus = 'implemented' | 'partial' | 'not_implemented' | 'not_applicable';
export type DerivationSource =
  | 'license_gate'
  | 'scope_gate'
  | 'inherent'
  | 'archetype_default'
  | 'preamble_override'
  | 'si_override'
  | 'btc_risk_flag'
  | 'advisor_override';

export interface DerivedActionStatus {
  action_id: string;
  practice_id: string;
  capability: string;
  action_text: string;
  action_type: string;
  signal: 'configure' | 'customize' | 'manual';
  m365_service: string;
  status: ActionStatus;
  derivation_source: DerivationSource;
  derivation_reason: string;
  overridden: boolean;
  original_status?: ActionStatus;
  mapped_requirements: string[];
}

// --- Wizard Phase ---
export type RRTWizardPhase = 'preamble' | 'review' | 'deep_dive' | 'posture_review';
