// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Aggregates all CES data sources into a single template context object
 * for Handlebars policy template interpolation.
 */

import type { PolicyInputsOutput } from '@/features/policy/types';

/** Flat helper to look up a personnel record by role_id */
function personnelByRole(
  personnel: PolicyInputsOutput['personnel'],
): Record<string, PolicyInputsOutput['personnel'][number]> {
  const map: Record<string, PolicyInputsOutput['personnel'][number]> = {};
  for (const p of personnel) {
    map[p.role_id] = p;
  }
  return map;
}

export interface PolicyTemplateContext {
  // Organization metadata from Policy Inputs
  org: {
    legal_name: string;
    address_full: string;
    address: { street: string; city: string; state: string; zip: string };
    cage_code: string;
    duns_number: string;
    org_type: string;
    industry: string;
    naics_code: string;
    parent_company: string;
  };

  // Key personnel by role
  personnel: Record<string, { name: string; title: string; email: string; role_title: string }>;

  // ODP values
  odp: Record<string, string | number>;

  // Governance
  governance: {
    policy_effective_date: string;
    review_cycle_months: number;
    fiscal_year_start_month: number;
    next_review_date: string;
  };

  // Physical security
  physical_security: {
    facility_addresses: string[];
    access_control_system: string;
    visitor_management: string;
    has_physical: boolean;
  };

  // SI Baseline
  si: {
    target_cmmc_level: string;
    cui_presence: string;
    cui_types: string[];
    boundary_strategy: string;
    deployment_posture: string;
    infrastructure_model: string;
    external_service_providers: Array<{
      name: string;
      service_type: string;
      fedramp_posture: string;
    }>;
    collaboration_mode: string;
    byod_posture: string;
    devops_touches_cui: boolean;
    tenant_model: string;
    assessment_route: string;
    poam_policy: string;
    evidence_posture: string;
    in_scope_users: number;
    in_scope_endpoints: number;
    affirming_official: string;
    evidence_owner_roles: string[];
    change_control_owner: string;
    regulated_data_notes: string | null;
  };

  // Tenant config
  tenant: {
    tenant_id: string;
    primary_domain: string;
    cloud_environment: string;
    primary_sku: string;
    pim_enabled: boolean;
    sentinel_workspace: string;
    data_connectors: string[];
    enrollment_type: string;
    sensitivity_labels: string;
    dlp_convention: string;
    identity_provider: string;
    ca_naming: string;
    has_tenant: boolean;
  };

  // CUI Boundary (dynamic keys)
  cui_boundary: Record<string, unknown>;
  has_cui_boundary: boolean;

  // BTC gate summary
  btc: {
    gate_status: Record<string, { pass: boolean; reason: string }>;
    has_btc: boolean;
  };

  // Readiness posture summary
  posture: {
    met: number;
    partial: number;
    not_met: number;
    unknown: number;
    total: number;
    compliance_pct: number;
    has_posture: boolean;
  };

  // Training course catalog
  training: {
    baseline_courses: Array<{
      title: string;
      provider: string;
      frequency: string;
      audience: string;
      url: string;
    }>;
    admin_courses: Array<{
      title: string;
      provider: string;
      frequency: string;
      audience: string;
      url: string;
    }>;
  };

  // Risk assessment methodology
  risk_assessment: {
    methodology: string;
    methodology_version: string;
    appendices_used: string[];
    trigger_events: string[];
    risk_register: Array<Record<string, unknown>>;
    threat_sources: string[];
    vulnerability_sources: string[];
  };

  // Personnel screening
  screening: {
    reassessment_years: number;
    evidence_retention_years: number;
    reassessment_triggers: string[];
  };

  // Regulatory citations
  citations: {
    cmmc_evidence_retention: string;
    nist_800_30: string;
    cfr_2002: string;
  };

  // Generation metadata
  generated_on: string;
  generated_year: string;
}

export interface ContextCompleteness {
  total_variables: number;
  resolved_variables: number;
  completeness_pct: number;
  unresolved: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function compilePolicyContext(sources: {
  policyInputs: PolicyInputsOutput;
  siBaseline?: any;
  tenantConfig?: any;
  cuiBoundary?: any;
  btcConfirmation?: any;
  readinessPosture?: any;
}): PolicyTemplateContext {
  const pi = sources.policyInputs;
  const si = sources.siBaseline?.si_baseline ?? sources.siBaseline?.data?.si_baseline ?? {};
  const tcp = sources.tenantConfig?.tenant_config ?? sources.tenantConfig?.data?.tenant_config ?? {};
  const cui = sources.cuiBoundary?.cui_boundary ?? sources.cuiBoundary?.data?.cui_boundary ?? {};
  const btc =
    sources.btcConfirmation?.btc_confirmation ??
    sources.btcConfirmation?.data?.btc_confirmation ??
    {};
  const rp = sources.readinessPosture?.ces ?? sources.readinessPosture?.data?.ces ?? {};

  const personnelMap = personnelByRole(pi.personnel);
  const personnelCtx: Record<string, { name: string; title: string; email: string; role_title: string }> = {};
  for (const [roleId, p] of Object.entries(personnelMap)) {
    personnelCtx[roleId] = {
      name: p.name,
      title: p.title ?? '',
      email: p.email ?? '',
      role_title: p.role_title,
    };
  }

  const effectiveDate = pi.governance.policy_effective_date || new Date().toISOString().slice(0, 10);
  const reviewMonths = pi.governance.review_cycle_months || 12;
  const nextReview = new Date(effectiveDate);
  nextReview.setMonth(nextReview.getMonth() + reviewMonths);

  const summary = rp.control_status_summary ?? {};
  const met = summary.met ?? 0;
  const partial = summary.partial ?? 0;
  const notMet = summary.not_met ?? 0;
  const unknown = summary.unknown ?? 0;
  const total = met + partial + notMet + unknown;

  return {
    org: {
      legal_name: pi.organization.legal_name,
      address_full: [
        pi.organization.address.street,
        pi.organization.address.city,
        pi.organization.address.state,
        pi.organization.address.zip,
      ]
        .filter(Boolean)
        .join(', '),
      address: pi.organization.address,
      cage_code: pi.organization.cage_code ?? '',
      duns_number: pi.organization.duns_number ?? '',
      org_type: pi.organization.org_type,
      industry: pi.organization.industry ?? '',
      naics_code: pi.organization.naics_code ?? '',
      parent_company: pi.organization.parent_company ?? '',
    },

    personnel: personnelCtx,

    odp: pi.odps,

    governance: {
      policy_effective_date: effectiveDate,
      review_cycle_months: reviewMonths,
      fiscal_year_start_month: pi.governance.fiscal_year_start_month,
      next_review_date: nextReview.toISOString().slice(0, 10),
    },

    physical_security: {
      facility_addresses: pi.physical_security?.facility_addresses ?? [],
      access_control_system: pi.physical_security?.access_control_system ?? '',
      visitor_management: pi.physical_security?.visitor_management ?? '',
      has_physical: !!pi.physical_security,
    },

    si: {
      target_cmmc_level: si.target?.target_cmmc_level ?? '',
      cui_presence: si.target?.cui_presence ?? '',
      cui_types: si.target?.cui_types ?? [],
      boundary_strategy: si.scope?.boundary_strategy ?? '',
      deployment_posture: si.scope?.deployment_posture ?? '',
      infrastructure_model: si.dependencies?.infrastructure_model ?? 'm365_azure',
      external_service_providers: (si.scope?.external_service_providers ?? []).map((e: any) => ({
        name: e.name,
        service_type: e.service_type,
        fedramp_posture: e.fedramp_posture,
      })),
      collaboration_mode: si.operations?.collaboration_mode ?? '',
      byod_posture: si.operations?.byod_posture ?? '',
      devops_touches_cui: si.operations?.devops_touches_cui ?? false,
      tenant_model: si.dependencies?.tenant_model_preference ?? '',
      assessment_route: si.assessment?.assessment_route ?? '',
      poam_policy: si.risk_acceptance?.poam_policy_intent ?? '',
      evidence_posture: si.evidence?.evidence_posture_target ?? '',
      in_scope_users: si.scope?.in_scope_users_estimate ?? 0,
      in_scope_endpoints: si.scope?.in_scope_endpoints_estimate ?? 0,
      affirming_official: si.governance?.affirming_official ?? '',
      evidence_owner_roles: si.governance?.evidence_owner_roles ?? [],
      change_control_owner: si.governance?.change_control_owner ?? '',
      regulated_data_notes: si.target?.regulated_data_notes || null,
    },

    tenant: {
      tenant_id: tcp.identity?.tenant_id ?? '',
      primary_domain: tcp.identity?.primary_domain ?? '',
      cloud_environment: tcp.identity?.cloud_environment ?? '',
      primary_sku: tcp.licensing?.primary_sku ?? '',
      pim_enabled: tcp.privileged_access?.pim_enabled ?? false,
      sentinel_workspace: tcp.monitoring?.sentinel_workspace_name ?? '',
      data_connectors: tcp.monitoring?.data_connectors ?? [],
      enrollment_type: tcp.device_management?.enrollment_type ?? '',
      sensitivity_labels: tcp.data_protection?.sensitivity_label_convention ?? '',
      dlp_convention: tcp.data_protection?.dlp_policy_convention ?? '',
      identity_provider: tcp.identity_architecture?.identity_provider ?? '',
      ca_naming: tcp.conditional_access?.ca_naming_convention ?? '',
      has_tenant: !!tcp.identity,
    },

    cui_boundary: cui,
    has_cui_boundary: Object.keys(cui).length > 0,

    btc: {
      gate_status: btc.gate_status ?? {},
      has_btc: Object.keys(btc.gate_status ?? {}).length > 0,
    },

    posture: {
      met,
      partial,
      not_met: notMet,
      unknown,
      total,
      compliance_pct: total > 0 ? Math.round((met / total) * 100) : 0,
      has_posture: total > 0,
    },

    training: {
      baseline_courses: [
        {
          title: 'DoD Cyber Awareness Challenge',
          provider: 'DoD',
          frequency: 'Annual',
          audience: 'All CUI-access personnel',
          url: 'https://cs.signal.army.mil',
        },
        {
          title: 'DoD Mandatory CUI Training',
          provider: 'CDSE',
          frequency: 'Initial + Biennial',
          audience: 'All CUI-access personnel',
          url: 'https://www.cdse.edu/Training/eLearning/',
        },
        {
          title: 'CDSE Insider Threat Awareness (INT101.16)',
          provider: 'CDSE',
          frequency: 'Annual',
          audience: 'All CUI-access personnel',
          url: 'https://www.cdse.edu/Training/eLearning/',
        },
      ],
      admin_courses: [
        {
          title: 'CDSE Cybersecurity Fundamentals',
          provider: 'CDSE',
          frequency: 'Annual',
          audience: 'System administrators',
          url: 'https://www.cdse.edu/Training/eLearning/',
        },
      ],
    },

    risk_assessment: {
      methodology: 'NIST SP 800-30 Revision 1',
      methodology_version: 'Rev 1 (September 2012)',
      appendices_used: [
        'D (Threat Sources)',
        'E (Threat Events)',
        'G (Likelihood Scale)',
        'H (Impact Scale)',
        'I (Composite Risk Matrix)',
      ],
      trigger_events: [
        'Architectural changes to the CUI boundary',
        'New contracts with different CUI categories',
        'Tenant variant changes (e.g., GCC High to IL5)',
        'Significant security incidents affecting CUI',
        'Material changes in threat landscape',
      ],
      risk_register: [],
      threat_sources: [],
      vulnerability_sources: [],
    },

    screening: {
      reassessment_years: 5,
      evidence_retention_years: 6,
      reassessment_triggers: [
        'Criminal arrest or conviction',
        'Role change with elevated CUI access',
        'Organizational ownership or control change',
      ],
    },

    citations: {
      cmmc_evidence_retention: '6 years per 32 CFR 170.16',
      nist_800_30: 'NIST SP 800-30 Rev 1 (Guide for Conducting Risk Assessments)',
      cfr_2002: '32 CFR Part 2002',
    },

    generated_on: new Date().toISOString().slice(0, 10),
    generated_year: new Date().getFullYear().toString(),
  };
}

/** Reports completeness % and lists unresolved variables */
export function assessContextCompleteness(ctx: PolicyTemplateContext): ContextCompleteness {
  const unresolved: string[] = [];
  let total = 0;
  let resolved = 0;

  const check = (path: string, value: unknown) => {
    total++;
    if (value === '' || value === undefined || value === null) {
      unresolved.push(path);
    } else {
      resolved++;
    }
  };

  // Org fields
  check('org.legal_name', ctx.org.legal_name);
  check('org.address_full', ctx.org.address_full);
  check('org.org_type', ctx.org.org_type);

  // Key personnel
  for (const roleId of ['isso', 'system_owner', 'compliance_officer', 'it_director', 'ir_lead']) {
    check(`personnel.${roleId}`, ctx.personnel[roleId]?.name);
  }

  // Critical ODPs
  for (const key of [
    'account_lockout_threshold',
    'session_timeout_minutes',
    'min_password_length',
    'audit_log_retention_days',
    'vuln_scan_frequency',
    'incident_reporting_hours',
  ]) {
    check(`odp.${key}`, ctx.odp[key]);
  }

  // SI fields
  check('si.target_cmmc_level', ctx.si.target_cmmc_level);
  check('si.boundary_strategy', ctx.si.boundary_strategy);
  check('si.deployment_posture', ctx.si.deployment_posture);

  // Governance
  check('governance.policy_effective_date', ctx.governance.policy_effective_date);

  // Screening
  check('screening.reassessment_years', ctx.screening.reassessment_years);

  // Risk assessment
  check('risk_assessment.methodology', ctx.risk_assessment.methodology);

  // Training
  check(
    'training.baseline_courses',
    ctx.training.baseline_courses.length > 0 ? ctx.training.baseline_courses : null,
  );

  return {
    total_variables: total,
    resolved_variables: resolved,
    completeness_pct: total > 0 ? Math.round((resolved / total) * 100) : 0,
    unresolved,
  };
}
