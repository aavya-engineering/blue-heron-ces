// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Core artifact types derived from JSON schemas

// Re-export Customer for backward compatibility
export type { Customer } from './customer';

/** Shared metadata header for non-schema-validated artifacts (MPT outputs) */
export interface ArtifactMetadata {
  artifact: string;
  version: string;
  generated_on: string;
  intent?: string;
  artifact_id?: string;
  cesId?: string;
  [key: string]: unknown;
}

export interface ArtifactRef {
  schema_id: string;
  artifact_id: string;
  version: string;
  hash_sha256: string;
}

// ---------------------------------------------------------------------------
// SI Baseline — matches CES SIT Strategic Intent Baseline.schema.json
// ---------------------------------------------------------------------------
export type CMMCLevel = 'L1' | 'L2' | 'L3';
export type AssessmentRoute = 'self' | 'certification' | 'unknown_contract_dependent';
export type TenantModel = 'commercial_only' | 'gcc' | 'gcc_high' | 'dod_il5' | 'dod_il6' | 'hybrid' | 'unknown';
export type CUIPresence = 'no_cui' | 'fci_only' | 'cui_present' | 'cui_plus_other_sensitive' | 'unknown';
export type BoundaryStrategy = 'single_enclave' | 'multiple_enclaves' | 'hybrid_boundary' | 'unknown';
export type DeploymentPosture = 'cloud_only' | 'hybrid' | 'on_prem' | 'unknown';

export interface TimeGoal {
  goal_type: 'by_date' | 'within_days' | 'asap' | 'unknown';
  by_date?: string;
  within_days?: number;
  driver?: string;
}

export interface ExternalServiceProvider {
  name: string;
  service_type: string;
  fedramp_posture: string;
  in_scope_dependency: 'yes' | 'no' | 'unknown';
  notes?: string;
}

export interface SIBaseline {
  ces: {
    artifact: 'si_baseline_output';
    version: string;
    generated_on: string; // ISO date  YYYY-MM-DD
    intent: string;
    cesId?: string;
  };
  validation_warnings?: string[];
  si_baseline: {
    target: {
      target_cmmc_level: CMMCLevel;
      cui_presence: CUIPresence;
      cui_types: string[];
      regulated_data_notes: string;
    };
    assessment: {
      assessment_route: AssessmentRoute;
      assessment_body: string;
      certification_timing_goal: TimeGoal;
      affirmation_obligations: string[];
    };
    scope: {
      boundary_strategy: BoundaryStrategy;
      deployment_posture: DeploymentPosture;
      external_service_providers: ExternalServiceProvider[];
      specialized_assets_present: boolean;
      in_scope_users_estimate: number;
      in_scope_endpoints_estimate: number;
    };
    operations: {
      collaboration_mode: 'teams_first' | 'email_first' | 'mixed' | 'unknown';
      byod_posture: 'not_allowed' | 'allowed_vdi_only' | 'allowed_mdm' | 'session_controlled_byod' | 'unknown';
      mobile_device_presence?: 'no_mobile_devices' | 'company_managed_only' | 'byod_and_company' | 'session_controlled_byod' | 'unknown';
      wireless_posture?: 'no_wireless' | 'managed_wireless' | 'wireless_access_path_only' | 'unknown';
      removable_media_posture?: 'blocked' | 'allowed_encrypted' | 'allowed_uncontrolled' | 'unknown';
      remote_access_posture?: 'no_remote' | 'vpn_only' | 'cloud_native' | 'unknown';
      maintenance_posture?: 'no_nonlocal' | 'managed_nonlocal' | 'unknown';
      cui_endpoint_posture?: 'browser_only' | 'managed_endpoints' | 'unknown';
      devops_touches_cui: boolean;
    };
    evidence: {
      evidence_posture_target: 'l2_self_ready' | 'c3pao_ready' | 'continuous_compliance' | 'unknown';
      evidence_collection_mode: 'manual' | 'assisted' | 'automated' | 'unknown';
      retention_target_days: number;
    };
    dependencies: {
      tenant_model_preference: TenantModel;
      infrastructure_model?: 'm365_only' | 'm365_sentinel' | 'm365_azure';
      license_tier?: 'business_premium' | 'g3' | 'g5';
      user_count?: number;
      fedramp_package_ids?: string[];
      physical_facility_count?: number;
      customer_equipment_count?: number;
      budget_constraints: string;
      schedule_constraints: string;
    };
    risk_acceptance: {
      poam_policy_intent: 'no_poam' | 'poam_if_allowed' | 'unknown';
      risk_acceptance_authority: string;
      known_risk_tolerances: string[];
    };
    governance: {
      affirming_official: string;
      evidence_owner_roles: string[];
      change_control_owner: string;
      audit_interface_owner: string;
    };
  };
}

// ---------------------------------------------------------------------------
// RR Question Set — matches CES SIT Scenario-Specific Question Set.schema.json
// ---------------------------------------------------------------------------
export interface RREvidenceRequest {
  id: string;
  evidence_type: string;
  description: string;
  acceptable_forms?: string[];
  collection_method?: string;
  retention_notes?: string;
  cmmc_attainment_impact?: string;
  advisor_notes?: string;
}

export interface RRSchemaQuestion {
  question_id: string;
  prompt: string;
  name: string;
  answer_type: 'yes_no' | 'enum' | 'multi_select' | 'free_text' | 'evidence_upload' | 'url' | 'structured_json';
  priority: number;
  source_activity_id: string;
  produces_rrt_fields: string[];
  mapped_requirements: string[];
  assessor_methods: Array<'examine' | 'interview' | 'test'>;
  expected_evidence: Array<{
    evidence_matrix_id: string;
    archetype_id: string;
    minimum_fields: string[];
    retention_days_min?: number;
  }>;
  enum_values?: string[];
  si_triggers?: Array<{ si_field_id: string; reason: string }>;
  advisor_reason_rrt?: string;
  advisor_cmmc_impact?: string;
  steps?: string[];
  outputs?: string[];
  evidence_requests?: RREvidenceRequest[];
}

export interface RRQuestionSet {
  ces: {
    artifact: 'CES_RR_QUESTION_SET';
    version: string;
    generated_on: string;
    intent: string;
    cesId?: string;
    inputs: {
      si_baseline_ref: ArtifactRef;
      rrt_bank_ref: ArtifactRef;
      cmmc_requirements_ref: ArtifactRef;
      assessor_evidence_matrix_ref: ArtifactRef;
      assessor_approach_ref: ArtifactRef;
      vendor_capabilities_ref: ArtifactRef;
    };
    scenario: {
      scenario_id: string;
      tags: string[];
      derivation_rules_version: string;
    };
    selection: {
      selected_activity_ids: string[];
      excluded_activity_ids: Array<{ activity_id: string; reason: string }>;
    };
    questions: RRSchemaQuestion[];
    coverage: {
      requirements_covered: string[];
      requirements_missing: Array<{ requirement_id: string; reason: string }>;
    };
  };
}

// ---------------------------------------------------------------------------
// Readiness Posture — matches CES RRT Readiness Posture.schema.json
// ---------------------------------------------------------------------------
export type RequirementStatus = 'met' | 'partial' | 'not_met' | 'unknown';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface EvidenceRef {
  evidence_id: string;
  why?: string;
}

export interface RequirementResult {
  requirement_id: string;
  status: RequirementStatus;
  notes?: string;
  evidence_refs: EvidenceRef[];
}

export interface EvidenceItem {
  evidence_id: string;
  source_system: string;
  location: string;
  hash_sha256: string;
  captured_at?: string;
}

export interface Finding {
  severity: FindingSeverity;
  statement: string;
  impacts_requirements?: string[];
  recommended_next_step_tags?: string[];
}

export interface ControlStatusSummary {
  level: string;
  met: number;
  partial: number;
  not_met: number;
  unknown: number;
}

export interface ReadinessPosture {
  ces: {
    artifact: 'CES_READINESS_POSTURE';
    version: string;
    generated_on: string;
    cesId?: string;
    snapshot_id: string;
    as_of_date: string;
    si_baseline_ref: ArtifactRef;
    rr_question_set_ref: ArtifactRef;
    control_status_summary: ControlStatusSummary;
    key_findings: Finding[];
    constraints: string[];
    requirement_results: RequirementResult[];
    evidence_index: EvidenceItem[];
  };
}

// Legacy activity-based types (used internally by RRT wizard UI)
export interface RRActivity {
  activity_id: string;
  activity_name: string;
  purpose?: string;
  questions: RRActivityQuestion[];
  mapped_requirements?: string[];
}

export interface RRActivityQuestion {
  question_id: string;
  question_text: string;
  description?: string;
  answer_type: string;
  enum_values?: string[];
  mapped_requirements?: string[];
  expected_evidence_archetypes?: string[];
  assessor_methods?: string[];
  source_activity_id?: string;
}

// ---------------------------------------------------------------------------
// CUI Boundary — CUI scope declaration output
// ---------------------------------------------------------------------------
export interface CUIBoundaryOutput {
  ces: {
    artifact: 'cui_boundary_output';
    version: string;
    generated_on: string;
    cui_bank_version: string;
    cesId?: string;
  };
  cui_boundary: Record<string, string | number | boolean | string[]>;
}

export interface CUIBoundaryRecord {
  id?: number;
  customerId: number;
  baselineId: number;
  artifactId: string;
  cesId?: string;
  data: CUIBoundaryOutput;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// BTC Confirmation — Boundary Topology Confirmation output
// ---------------------------------------------------------------------------
export interface BTCEvidenceRef {
  evidence_id: string;
  source_system: string;
  location: string;
  hash_sha256: string;
  captured_at: string;
  question_id: string;
  notes?: string;
}

export interface BTCRiskFlag {
  flag_id: string;
  domain: string;
  severity: string;
  description: string;
  source_rule_id: string;
}

export interface BTCDecisionLogEntry {
  rule_id: string;
  description: string;
  result: string;
  inputs_evaluated: Record<string, unknown>;
}

export interface BTCGateStatus {
  domain: string;
  pass: boolean;
  reason: string;
}

export interface BTCConfirmationOutput {
  ces: {
    artifact: 'btc_confirmation_output';
    version: string;
    generated_on: string;
    btc_bank_version: string;
    activation_package_version: string;
    cesId?: string;
  };
  btc_confirmation: {
    answers: Record<
      string,
      {
        question_id: string;
        answer: unknown;
        mode: string;
        evidence_ids: string[];
        captured_at: string;
      }
    >;
    evidence_refs: BTCEvidenceRef[];
    risk_flags: BTCRiskFlag[];
    gate_status: Record<string, BTCGateStatus>;
    decision_log: BTCDecisionLogEntry[];
  };
}

export interface BTCConfirmationRecord {
  id?: number;
  customerId: number;
  baselineId: number;
  cuiBoundaryId: number;
  artifactId: string;
  cesId?: string;
  data: BTCConfirmationOutput;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Tenant Config Profile — TCP tenant configuration output
// ---------------------------------------------------------------------------
export interface TenantConfigProfileOutput {
  ces: {
    artifact: 'tenant_config_profile';
    version: string;
    generated_on: string;
    tcp_bank_version: string;
    cesId?: string;
  };
  tenant_config: {
    identity: {
      tenant_id: string;
      primary_domain: string;
      custom_domains: string[];
      cloud_environment: 'commercial' | 'gcc' | 'gcc_high' | 'dod';
      display_name: string;
    };
    licensing: {
      primary_sku: string;
      license_count: number;
      addon_skus: string[];
      service_activations: Record<string, boolean>;
    };
    identity_architecture: {
      break_glass_accounts: string[];
      admin_naming_convention: string;
      service_account_naming_convention: string;
      identity_provider:
        | 'entra_native'
        | 'hybrid_ad_connect'
        | 'hybrid_cloud_sync'
        | 'external_idp';
      directory_sync_enabled: boolean;
    };
    privileged_access: {
      global_admins: string[];
      security_admins: string[];
      compliance_admins: string[];
      pim_enabled: boolean;
      break_glass_exclusion_group: string;
    };
    group_architecture: {
      security_group_convention: string;
      key_groups: Record<string, string>;
      distribution_group_convention: string;
      group_strategy: 'dynamic' | 'assigned' | 'mixed';
    };
    conditional_access: {
      ca_naming_convention: string;
      named_locations: Array<{ name: string; type: 'ip' | 'country'; value: string }>;
      existing_policy_count: number;
    };
    device_management: {
      enrollment_type: 'azure_ad_join' | 'hybrid_join' | 'enroll_only' | 'none';
      device_naming_convention: string;
      compliance_policy_convention: string;
      platforms_in_scope: string[];
    };
    data_protection: {
      sensitivity_label_convention: string;
      cui_sharepoint_sites: string[];
      cui_teams_channels: string[];
      dlp_policy_convention: string;
    };
    monitoring: {
      sentinel_workspace_name: string;
      sentinel_resource_group: string;
      log_analytics_workspace_id: string;
      data_connectors: string[];
      alert_rule_convention: string;
    };
  };
}

export interface TenantConfigProfileRecord {
  id?: number;
  customerId: number;
  baselineId: number;
  artifactId: string;
  cesId?: string;
  data: TenantConfigProfileOutput;
  createdAt: string;
}

// Mission Plan types
export interface PolicyDocument {
  template_id: string;
  title: string;
  markdown: string;
  completeness: number;
}

export interface MissionPlan {
  id?: number;
  customerId: number;
  baselineId: number;
  postureId: number;
  cesId?: string;
  data?: {
    manual_plan: ManualMissionPlan;
    proposal: Proposal;
    tenant_manifest: TenantManifest;
    infrastructure_manifest?: InfrastructureManifest;
    policy_documents?: PolicyDocument[];
  };
  manualPlan?: ManualMissionPlan;
  proposal?: Proposal;
  tenantManifest?: TenantManifest;
  createdAt: string;
  updatedAt?: string;
}

export interface ManualMissionPlan {
  ces: ArtifactMetadata;
  [key: string]: unknown;
}

export interface Proposal {
  ces: ArtifactMetadata;
  [key: string]: unknown;
}

export interface TenantManifest {
  ces: ArtifactMetadata;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Infrastructure Manifest — Azure resource deployment specification
// ---------------------------------------------------------------------------
export interface InfraResourceSpec {
  resource_id: string;
  resource_type: string;
  name: string;
  control_ids: string[];
  registry_entry_ids: string[];
  properties: Record<string, any>;
  depends_on: string[];
}

export interface InfraVariableMap {
  subscriptionId: string;
  resourceGroup: string;
  location: string;
  lawWorkspaceName: string;
  storageAccountName: string;
  keyVaultName: string;
  cmkKeyName: string;
  vnetName: string;
  vnetCidr: string;
  mgmtSubnetCidr?: string;
  identitySubnetCidr?: string;
  peSubnetCidr?: string;
  fwSubnetCidr?: string;
  subnetPeName: string;
  subnetPeCidr: string;
  nsgPeName: string;
  automationAccountName: string;
  eoAppDisplayName: string;
}

export interface InfraProvenanceEntry {
  field: string;
  value: unknown;
  source: 'si_baseline' | 'tcp' | 'convention' | 'default' | 'policy_odp';
  rule: string;
}

export interface InfraRegistryCoverage {
  total_infra_entries: number;
  covered_entry_ids: string[];
  uncovered_entry_ids: string[];
  coverage_pct: number;
}

export interface InfrastructureManifestBody {
  identity: InfraResourceSpec[];
  logging: InfraResourceSpec[];
  security: InfraResourceSpec[];
  storage: InfraResourceSpec[];
  network: InfraResourceSpec[];
  automation: InfraResourceSpec[];
  diagnostics: InfraResourceSpec[];
  stamper_variable_map: InfraVariableMap;
  registry_coverage: InfraRegistryCoverage;
  provenance: InfraProvenanceEntry[];
}

export interface InfrastructureManifest {
  ces: ArtifactMetadata;
  infrastructure_manifest: InfrastructureManifestBody;
}

// Database types
export interface SIBaselineRecord {
  id?: number;
  customerId: number;
  artifactId: string;
  cesId?: string;
  data: SIBaseline;
  createdAt: string;
  isImmutable: boolean;
}

export interface RRQuestionSetRecord {
  id?: number;
  customerId: number;
  baselineId: number;
  artifactId: string;
  cesId?: string;
  data: RRQuestionSet;
  createdAt: string;
}

export interface ReadinessPostureRecord {
  id?: number;
  customerId: number;
  questionSetId: number;
  baselineId: number;
  artifactId: string;
  cesId?: string;
  data: ReadinessPosture;
  createdAt: string;
}

export interface QuestionBankCache {
  name: string;
  version: string;
  data: unknown;
  loadedAt: string;
}

export interface DomainDataCache {
  name: string;
  version: string;
  data: unknown;
  loadedAt: string;
}

// ---------------------------------------------------------------------------
// Policy Inputs — collected org metadata, personnel, ODPs, governance
// ---------------------------------------------------------------------------
export interface PolicyInputsRecord {
  id?: number;
  customerId: number;
  artifactId: string;
  cesId?: string;
  // VENDOR NOTE (PLAN-2 M2 slice 3): the policy-types closure is slice 5, not
  // vendored here; PolicyInputsRecord is a persistence wrapper unused by the
  // compiler chain, so its payload is `unknown` in the port.
  data: unknown;
  createdAt: string;
}
