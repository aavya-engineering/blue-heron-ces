// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// VENDORED from ces-planner (src/shared/types/artifacts.ts + features/sit/types.ts),
// pinned in vendor-manifest.json. Focused SI-Baseline type closure — only the
// types generateSIBaseline/baselineValidator reference, extracted verbatim so
// the vendored generator compiles without dragging the whole 563-line
// artifacts.ts. Drift-checked; do not hand-edit without re-pinning.
export type CMMCLevel = 'L1' | 'L2' | 'L3';
export type AssessmentRoute = 'self' | 'certification' | 'unknown_contract_dependent';
export type TenantModel =
  | 'commercial_only'
  | 'gcc'
  | 'gcc_high'
  | 'dod_il5'
  | 'dod_il6'
  | 'hybrid'
  | 'unknown';
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

export interface SITAnswer {
  question_id: string;
  answer_type: 'string' | 'number' | 'enum' | 'array' | 'multi_select' | 'structured_object' | 'boolean';
  raw_answer: string | number | string[] | Record<string, unknown> | boolean;
  captured_at: string;
  provenance_class:
    | 'client_assertion'
    | 'operator_observation'
    | 'operator_inference'
    | 'assumption'
    | 'system_observation'
    | 'system_recommendation'
    | 'previous_run';
  notes?: string;
}

export interface SIBaseline {
  ces: {
    artifact: 'si_baseline_output';
    version: string;
    generated_on: string; // ISO date YYYY-MM-DD
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
      byod_posture:
        | 'not_allowed'
        | 'allowed_vdi_only'
        | 'allowed_mdm'
        | 'session_controlled_byod'
        | 'unknown';
      mobile_device_presence?:
        | 'no_mobile_devices'
        | 'company_managed_only'
        | 'byod_and_company'
        | 'session_controlled_byod'
        | 'unknown';
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
