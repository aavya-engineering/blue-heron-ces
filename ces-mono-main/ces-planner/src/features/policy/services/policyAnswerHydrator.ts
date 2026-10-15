// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { PolicyInputsOutput, PolicyAnswer, PolicySectionDef } from '../types';

/**
 * Reverse-map a saved PolicyInputsOutput back into raw PolicyAnswer objects.
 * Uses bindings.policy_inputs paths from question definitions to extract values.
 * Returns answers with provenance_class 'previous_run'.
 */

const REVERSE_ORG_TYPE: Record<string, string> = {
  prime: 'Prime Contractor',
  subcontractor: 'Subcontractor',
  vendor: 'Vendor / Supplier',
  other: 'Other',
};

const PERSONNEL_ROLE_MAP: Record<string, string> = {
  isso: 'PI.PER.001',
  system_owner: 'PI.PER.002',
  compliance_officer: 'PI.PER.003',
  it_director: 'PI.PER.004',
  hr_representative: 'PI.PER.005',
  ir_lead: 'PI.PER.006',
  facilities_manager: 'PI.PER.007',
  legal_representative: 'PI.PER.008',
};

const ODP_KEY_MAP: Record<string, string> = {
  account_lockout_threshold: 'PI.ODP.001',
  account_lockout_duration_minutes: 'PI.ODP.002',
  session_timeout_minutes: 'PI.ODP.003',
  min_password_length: 'PI.ODP.004',
  password_history_count: 'PI.ODP.005',
  max_password_age_days: 'PI.ODP.006',
  audit_log_retention_days: 'PI.ODP.007',
  vuln_scan_frequency: 'PI.ODP.008',
  critical_patch_timeline_days: 'PI.ODP.009',
  high_patch_timeline_days: 'PI.ODP.010',
  training_frequency: 'PI.ODP.011',
  incident_reporting_hours: 'PI.ODP.012',
  access_review_frequency: 'PI.ODP.013',
  backup_frequency: 'PI.ODP.014',
  media_sanitization_standard: 'PI.ODP.015',
};

function resolveBindingPath(output: PolicyInputsOutput, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = output;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function reverseMapPolicyProfile(
  output: PolicyInputsOutput,
  sections: PolicySectionDef[],
): Record<string, PolicyAnswer> {
  const answers: Record<string, PolicyAnswer> = {};
  const now = new Date().toISOString();

  for (const section of sections) {
    for (const question of section.questions) {
      const qid = question.id;

      // Personnel questions need special handling — stored as array of objects
      if (qid.startsWith('PI.PER.')) {
        const person = output.personnel.find(
          (p) => PERSONNEL_ROLE_MAP[p.role_id] === qid,
        );
        if (person) {
          const parts = [person.name, person.title, person.email].filter(Boolean);
          const value = parts.join(' | ');
          if (value) {
            answers[qid] = {
              question_id: qid,
              answer_type: question.answer_type,
              raw_answer: value,
              captured_at: now,
              provenance_class: 'previous_run',
            };
          }
        }
        continue;
      }

      // ODP questions — stored in odps Record with friendly keys
      if (qid.startsWith('PI.ODP.')) {
        const odpKey = Object.entries(ODP_KEY_MAP).find(([, id]) => id === qid)?.[0];
        if (odpKey && output.odps[odpKey] !== undefined) {
          const raw = output.odps[odpKey];
          answers[qid] = {
            question_id: qid,
            answer_type: question.answer_type,
            raw_answer: raw,
            captured_at: now,
            provenance_class: 'previous_run',
          };
        }
        continue;
      }

      // org_type needs reverse mapping
      if (qid === 'PI.ORG.008') {
        const orgType = output.organization.org_type;
        const label = REVERSE_ORG_TYPE[orgType];
        if (label) {
          answers[qid] = {
            question_id: qid,
            answer_type: question.answer_type,
            raw_answer: label,
            captured_at: now,
            provenance_class: 'previous_run',
          };
        }
        continue;
      }

      // All other questions — use bindings.policy_inputs path
      const bindingPath = question.bindings.policy_inputs;
      if (!bindingPath) continue;

      const value = resolveBindingPath(output, bindingPath);
      if (isEmpty(value)) continue;

      answers[qid] = {
        question_id: qid,
        answer_type: question.answer_type,
        raw_answer: value as string | number | boolean | string[],
        captured_at: now,
        provenance_class: 'previous_run',
      };
    }
  }

  return answers;
}
