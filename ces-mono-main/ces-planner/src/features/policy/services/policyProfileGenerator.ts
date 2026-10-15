// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { PolicyAnswer, PolicySectionDef } from '../types';
import type { PolicyInputsOutput } from '../types';

const ORG_TYPE_MAP: Record<string, PolicyInputsOutput['organization']['org_type']> = {
  'Prime Contractor': 'prime',
  Subcontractor: 'subcontractor',
  'Vendor / Supplier': 'vendor',
  Other: 'other',
};

function parsePersonnel(
  raw: string,
): { name: string; title?: string; email?: string } {
  const parts = raw.split('|').map((s) => s.trim());
  return {
    name: parts[0] || '',
    title: parts[1] || undefined,
    email: parts[2] || undefined,
  };
}

export function generatePolicyInputsOutput(
  answers: Record<string, PolicyAnswer>,
  _sections: PolicySectionDef[],
  bankVersion: string,
): PolicyInputsOutput {
  const get = (id: string): string =>
    typeof answers[id]?.raw_answer === 'string' ? (answers[id].raw_answer as string) : '';
  const getNum = (id: string): number =>
    typeof answers[id]?.raw_answer === 'number' ? (answers[id].raw_answer as number) : 0;
  const getList = (id: string): string[] =>
    Array.isArray(answers[id]?.raw_answer) ? (answers[id].raw_answer as string[]) : [];

  const personnelRoles = [
    { id: 'PI.PER.001', role_id: 'isso', role_title: 'Information System Security Officer' },
    { id: 'PI.PER.002', role_id: 'system_owner', role_title: 'System Owner' },
    { id: 'PI.PER.003', role_id: 'compliance_officer', role_title: 'Compliance Officer' },
    { id: 'PI.PER.004', role_id: 'it_director', role_title: 'IT Director / CTO' },
    { id: 'PI.PER.005', role_id: 'hr_representative', role_title: 'HR Representative' },
    { id: 'PI.PER.006', role_id: 'ir_lead', role_title: 'Incident Response Lead' },
    { id: 'PI.PER.007', role_id: 'facilities_manager', role_title: 'Facilities / Physical Security Manager' },
    { id: 'PI.PER.008', role_id: 'legal_representative', role_title: 'Legal / Contracts Representative' },
  ];

  const personnel = personnelRoles
    .filter((r) => get(r.id))
    .map((r) => {
      const parsed = parsePersonnel(get(r.id));
      return {
        role_id: r.role_id,
        role_title: r.role_title,
        name: parsed.name,
        title: parsed.title,
        email: parsed.email,
      };
    });

  const odps: Record<string, string | number> = {};
  // Collect all ODP answers
  for (const [qid, answer] of Object.entries(answers)) {
    if (qid.startsWith('PI.ODP.')) {
      const raw = answer.raw_answer;
      if (typeof raw === 'number' || typeof raw === 'string') {
        // Derive key from bindings — use question ID suffix as fallback
        const key = qid.replace('PI.ODP.', 'odp_').toLowerCase();
        odps[key] = raw;
      }
    }
  }
  // Map friendly ODP keys
  const odpMap: Record<string, string> = {
    'PI.ODP.001': 'account_lockout_threshold',
    'PI.ODP.002': 'account_lockout_duration_minutes',
    'PI.ODP.003': 'session_timeout_minutes',
    'PI.ODP.004': 'min_password_length',
    'PI.ODP.005': 'password_history_count',
    'PI.ODP.006': 'max_password_age_days',
    'PI.ODP.007': 'audit_log_retention_days',
    'PI.ODP.008': 'vuln_scan_frequency',
    'PI.ODP.009': 'critical_patch_timeline_days',
    'PI.ODP.010': 'high_patch_timeline_days',
    'PI.ODP.011': 'training_frequency',
    'PI.ODP.012': 'incident_reporting_hours',
    'PI.ODP.013': 'access_review_frequency',
    'PI.ODP.014': 'backup_frequency',
    'PI.ODP.015': 'media_sanitization_standard',
  };
  const namedOdps: Record<string, string | number> = {};
  for (const [qid, key] of Object.entries(odpMap)) {
    const answer = answers[qid];
    if (answer) {
      const raw = answer.raw_answer;
      if (typeof raw === 'number' || typeof raw === 'string') {
        namedOdps[key] = raw;
      }
    }
  }

  const facilityAddresses = getList('PI.PHY.001');
  const hasPhysical = facilityAddresses.length > 0 || get('PI.PHY.002') || get('PI.PHY.003');

  return {
    ces: {
      artifact: 'policy_inputs_output',
      version: '1.0.0',
      generated_on: new Date().toISOString().slice(0, 10),
      tool: 'policy_inputs',
      policy_bank_version: bankVersion,
    },
    organization: {
      legal_name: get('PI.ORG.001'),
      address: {
        street: get('PI.ORG.002'),
        city: get('PI.ORG.003'),
        state: get('PI.ORG.004'),
        zip: get('PI.ORG.005'),
      },
      cage_code: get('PI.ORG.006') || undefined,
      duns_number: get('PI.ORG.007') || undefined,
      org_type: ORG_TYPE_MAP[get('PI.ORG.008')] || 'other',
      industry: get('PI.ORG.009') || undefined,
      naics_code: get('PI.ORG.010') || undefined,
      parent_company: get('PI.ORG.011') || undefined,
    },
    personnel,
    odps: namedOdps,
    governance: {
      policy_effective_date: get('PI.GOV.001'),
      review_cycle_months: getNum('PI.GOV.002') || 12,
      fiscal_year_start_month: getNum('PI.GOV.003') || 1,
    },
    physical_security: hasPhysical
      ? {
          facility_addresses: facilityAddresses,
          access_control_system: get('PI.PHY.002') || undefined,
          visitor_management: get('PI.PHY.003') || undefined,
        }
      : undefined,
  };
}
