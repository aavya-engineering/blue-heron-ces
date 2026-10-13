// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { SITAnswer } from '../types/siBaseline';
import type { SIBaseline, TimeGoal } from '../types/siBaseline';
import { toISODate } from '../utils/dateFormatter';
import { validateSessionControlledByod, validateWirelessAccessPathOnly } from './baselineValidator';

/**
 * Generate SI Baseline artifact from SIT answers.
 * Output strictly matches CES SIT Strategic Intent Baseline.schema.json.
 */
export function generateSIBaseline(
  answers: Record<string, SITAnswer>,
  questionBank: any,
  _customerId: number,
  cesId?: string
): SIBaseline {
  const questions =
    questionBank?.ces?.question_bank?.questions || questionBank?.questions || [];

  // Collect all answered field values keyed by their si_baseline.* path
  const fieldMap = buildFieldMap(answers, questions);

  const baseline: SIBaseline = {
    ces: {
      artifact: 'si_baseline_output',
      version: '1.0.0',
      generated_on: toISODate(new Date()),
      intent: 'Strategic Intent Baseline for CMMC compliance assessment',
      ...(cesId ? { cesId } : {}),
    },
    si_baseline: {
      target: {
        target_cmmc_level: fieldMap['si_baseline.target.target_cmmc_level'] ?? 'L2',
        cui_presence: fieldMap['si_baseline.target.cui_presence'] ?? 'unknown',
        cui_types: toStringArray(fieldMap['si_baseline.target.cui_types']),
        regulated_data_notes:
          fieldMap['si_baseline.target.regulated_data_notes'] ?? '',
      },
      assessment: {
        assessment_route:
          fieldMap['si_baseline.assessment.assessment_route'] ?? 'unknown_contract_dependent',
        assessment_body:
          fieldMap['si_baseline.assessment.assessment_body'] ?? 'unknown',
        certification_timing_goal: toTimeGoal(
          fieldMap['si_baseline.assessment.certification_timing_goal']
        ),
        affirmation_obligations: toStringArray(
          fieldMap['si_baseline.assessment.affirmation_obligations'],
          ['Annual affirmation of continued compliance']
        ),
      },
      scope: {
        boundary_strategy:
          fieldMap['si_baseline.scope.boundary_strategy'] ?? 'unknown',
        deployment_posture:
          fieldMap['si_baseline.scope.deployment_posture'] ?? 'unknown',
        external_service_providers: toArray(
          fieldMap['si_baseline.scope.external_service_providers'],
          []
        ),
        specialized_assets_present:
          toBool(fieldMap['si_baseline.scope.specialized_assets_present']),
        in_scope_users_estimate:
          toInt(fieldMap['si_baseline.scope.in_scope_users_estimate']),
        in_scope_endpoints_estimate:
          toInt(fieldMap['si_baseline.scope.in_scope_endpoints_estimate']),
      },
      operations: {
        collaboration_mode:
          fieldMap['si_baseline.operations.collaboration_mode'] ?? 'unknown',
        byod_posture:
          fieldMap['si_baseline.operations.byod_posture'] ?? 'unknown',
        mobile_device_presence:
          fieldMap['si_baseline.operations.mobile_device_presence'] ?? undefined,
        wireless_posture:
          fieldMap['si_baseline.operations.wireless_posture'] ?? undefined,
        removable_media_posture:
          fieldMap['si_baseline.operations.removable_media_posture'] ?? undefined,
        remote_access_posture:
          fieldMap['si_baseline.operations.remote_access_posture'] ?? undefined,
        maintenance_posture:
          fieldMap['si_baseline.operations.maintenance_posture'] ?? undefined,
        cui_endpoint_posture:
          fieldMap['si_baseline.operations.cui_endpoint_posture'] ?? 'unknown',
        devops_touches_cui: toBool(
          fieldMap['si_baseline.operations.devops_touches_cui']
        ),
      },
      evidence: {
        evidence_posture_target:
          fieldMap['si_baseline.evidence.evidence_posture_target'] ?? 'unknown',
        evidence_collection_mode:
          fieldMap['si_baseline.evidence.evidence_collection_mode'] ?? 'manual',
        retention_target_days: toInt(
          fieldMap['si_baseline.evidence.retention_target_days'],
          365
        ),
      },
      dependencies: {
        tenant_model_preference:
          fieldMap['si_baseline.dependencies.tenant_model_preference'] ?? 'unknown',
        ...(fieldMap['si_baseline.dependencies.fedramp_package_ids']
          ? { fedramp_package_ids: toStringArray(fieldMap['si_baseline.dependencies.fedramp_package_ids']) }
          : {}),
        ...(fieldMap['si_baseline.dependencies.physical_facility_count'] != null
          ? { physical_facility_count: toInt(fieldMap['si_baseline.dependencies.physical_facility_count']) }
          : {}),
        ...(fieldMap['si_baseline.dependencies.customer_equipment_count'] != null
          ? { customer_equipment_count: toInt(fieldMap['si_baseline.dependencies.customer_equipment_count']) }
          : {}),
        budget_constraints:
          fieldMap['si_baseline.dependencies.budget_constraints'] ?? '',
        schedule_constraints:
          fieldMap['si_baseline.dependencies.schedule_constraints'] ?? '',
      },
      risk_acceptance: {
        poam_policy_intent:
          fieldMap['si_baseline.risk_acceptance.poam_policy_intent'] ?? 'unknown',
        risk_acceptance_authority:
          fieldMap['si_baseline.risk_acceptance.risk_acceptance_authority'] ??
          'Not specified',
        known_risk_tolerances: toStringArray(
          fieldMap['si_baseline.risk_acceptance.known_risk_tolerances']
        ),
      },
      governance: {
        affirming_official:
          fieldMap['si_baseline.governance.affirming_official'] ?? 'Not specified',
        evidence_owner_roles: toStringArray(
          fieldMap['si_baseline.governance.evidence_owner_roles'],
          ['Compliance Officer']
        ),
        change_control_owner:
          fieldMap['si_baseline.governance.change_control_owner'] ?? 'Not specified',
        audit_interface_owner:
          fieldMap['si_baseline.governance.audit_interface_owner'] ?? 'Not specified',
      },
    },
  };

  const validationWarnings = [
    ...validateSessionControlledByod(baseline),
    ...validateWirelessAccessPathOnly(baseline),
  ];
  if (validationWarnings.length > 0) {
    baseline.validation_warnings = validationWarnings;
  }

  return baseline;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Walk every answer and map it to the full si_baseline.xxx.yyy path. */
function buildFieldMap(
  answers: Record<string, SITAnswer>,
  questions: any[]
): Record<string, any> {
  const map: Record<string, any> = {};

  Object.entries(answers).forEach(([questionId, answer]) => {
    const question = questions.find(
      (q: any) => q.id === questionId || q.question_id === questionId
    );
    if (!question) return;

    const fieldPaths: string[] = question.sets_its_fields || [];
    fieldPaths.forEach((path: string) => {
      map[path] = answer.raw_answer;
    });
  });

  return map;
}

function toStringArray(val: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string' && val) return [val];
  return fallback;
}

function toArray(val: unknown, fallback: any[] = []): any[] {
  if (Array.isArray(val)) return val;
  return fallback;
}

function toInt(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function toBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true' || val === 'yes';
  return false;
}

function toTimeGoal(val: unknown): TimeGoal {
  if (val && typeof val === 'object') {
    const obj = val as Record<string, any>;
    const validGoalTypes = ['by_date', 'within_days', 'asap', 'unknown'] as const;
    const goalType = validGoalTypes.includes(obj.goal_type) ? obj.goal_type : 'unknown';
    return {
      goal_type: goalType as TimeGoal['goal_type'],
      ...(obj.by_date ? { by_date: obj.by_date } : {}),
      ...(obj.within_days != null ? { within_days: Number(obj.within_days) } : {}),
      ...(obj.driver ? { driver: obj.driver } : {}),
    };
  }
  return { goal_type: 'unknown' };
}
