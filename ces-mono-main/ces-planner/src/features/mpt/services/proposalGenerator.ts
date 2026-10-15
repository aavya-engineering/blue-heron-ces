// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type {
  SIBaseline,
  Proposal,
  CUIBoundaryOutput,
  BTCConfirmationOutput,
  TenantConfigProfileOutput,
} from '@/shared/types/artifacts';
import type { TaskCatalog, PlanMode } from '../types';
import { generateId } from '@/shared/utils/idGenerator';
import { useLoeRateStore } from '@/shared/stores/loeRateStore';
import { todayISO, addDays } from './planHelpers';
import { LICENSE_TIER_COSTS, INFRA_MODEL_COSTS, READINESS_MATRIX } from './costModel';

export function calculateMissionPlanCost(
  infrastructure_model: string,
  license_tier: string,
  userCount: number,
): { monthly: number; annual: number } {
  const licenseCost = LICENSE_TIER_COSTS[license_tier] || LICENSE_TIER_COSTS.g5;
  const infraCost = INFRA_MODEL_COSTS[infrastructure_model] || INFRA_MODEL_COSTS.m365_azure;

  const monthly = licenseCost.monthly_per_user * userCount + infraCost.monthly_fixed;
  const annual = monthly * 12;

  return { monthly, annual };
}

/**
 * Emit standalone Proposal Package per pseudocode §4.6.
 * Schema: { ces, inputs, proposal }
 *
 * Takes the already-generated manualPlan so line items can
 * reference milestones and steps that exist in the plan outputs.
 */
export function generateProposal(
  siBaseline: SIBaseline,
  planMode: PlanMode,
  manualPlan: any,
  taskCatalog: TaskCatalog,
  cuiBoundary?: CUIBoundaryOutput | null,
  btcConfirmation?: BTCConfirmationOutput | null,
  tenantConfig?: TenantConfigProfileOutput | null,
  cesId?: string,
): Proposal {
  const targetLevel = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';
  const today = todayISO();
  const orgName = (siBaseline.si_baseline?.target as Record<string, any>)?.organization_name || 'Customer';

  const infrastructure_model = siBaseline.si_baseline?.dependencies?.infrastructure_model || 'm365_azure';
  const license_tier = siBaseline.si_baseline?.dependencies?.license_tier || 'g5';
  const userCount = siBaseline.si_baseline?.dependencies?.user_count || 50;

  const milestones: any[] = manualPlan.outputs?.human_readable_mission_plan?.milestones || [];
  const steps: any[] = manualPlan.outputs?.human_readable_mission_plan?.steps || [];

  const lineItems = buildLineItems(milestones, steps, taskCatalog);
  const subtotal = lineItems.reduce((sum: number, li: any) => sum + li.extended_price, 0);
  const totalDays = computeTotalDays(taskCatalog);

  const costEstimate = calculateMissionPlanCost(infrastructure_model, license_tier, userCount);

  const baseAssumptions = buildAssumptions(siBaseline, targetLevel, taskCatalog, tenantConfig);

  // Insert cost comparison matrix after existing assumptions
  const costComparisonMatrix = {
    type: 'cost_comparison_matrix',
    title: 'Infrastructure and License Tier Cost Analysis',
    matrix: READINESS_MATRIX,
    calculated_costs: {
      selected_configuration: {
        infrastructure_model,
        license_tier,
        user_count: userCount,
        monthly_cost: costEstimate.monthly,
        annual_cost: costEstimate.annual,
      },
    },
  };

  return {
    ces: {
      artifact: 'proposal_package',
      version: '1.0.0',
      generated_on: today,
      intent: `CMMC ${targetLevel} compliance proposal for ${orgName} (${planMode})`,
      ...(cesId ? { cesId } : {}),
    },
    inputs: {
      si_baseline_ref: manualPlan.ces?.artifact_id || 'si_baseline_ref',
      readiness_posture_ref: 'readiness_posture_ref',
      mission_plan_ref: manualPlan.outputs?.human_readable_mission_plan?.plan_id || 'mission_plan_ref',
      authoritative_sources: {
        government: [
          { id: 'cmmc-r2', title: 'CMMC Model v2.0', type: 'government', version: '2.0' },
          { id: '32-cfr-170', title: '32 CFR Part 170 — CMMC Program', type: 'government' },
        ],
        nist: [
          { id: 'sp800-171r2', title: 'NIST SP 800-171 Rev 2', type: 'nist', version: 'Rev 2' },
        ],
      },
    },
    proposal: {
      proposal_id: generateId('proposal'),
      customer: { name: orgName },
      offeror: { name: 'CES Provider' },
      pricing_model: 'fixed_price',
      currency: 'USD',
      infrastructure_model,
      license_tier,
      user_count: userCount,
      period_of_performance: {
        start_date: today,
        end_date: addDays(today, totalDays),
        milestones: milestones.map((ms: any) => ({
          id: ms.id,
          name: ms.name,
          target_date: ms.target_date,
          acceptance_criteria: ms.exit_criteria || ['Milestone deliverables accepted'],
        })),
      },
      target_level: targetLevel,
      plan_mode: planMode,
      assumptions: [...baseAssumptions, costComparisonMatrix],
      exclusions: [
        'Hardware procurement and physical installation',
        'Third-party software licensing costs',
        'Ongoing managed security services post-assessment',
        'Legal or regulatory advisory services',
      ],
      line_items: lineItems,
      totals: {
        subtotal,
        tax: 0,
        other_fees: 0,
        total: subtotal,
      },
      sow: buildSOW(siBaseline, planMode, targetLevel, milestones),
      ...(cuiBoundary || btcConfirmation || tenantConfig
        ? { boundary_compliance: buildBoundaryCompliance(cuiBoundary, btcConfirmation, tenantConfig) }
        : {}),
    },
  };
}

function buildBoundaryCompliance(
  cuiBoundary?: CUIBoundaryOutput | null,
  btcConfirmation?: BTCConfirmationOutput | null,
  tenantConfig?: TenantConfigProfileOutput | null,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (cuiBoundary) {
    result.cui_boundary_defined = true;
    result.cui_generated_on = cuiBoundary.ces.generated_on;
  }

  if (btcConfirmation) {
    const gates = btcConfirmation.btc_confirmation.gate_status;
    const entries = Object.entries(gates);
    const passCount = entries.filter(([, g]) => g.pass).length;
    const failCount = entries.filter(([, g]) => !g.pass).length;
    result.btc_verified = true;
    result.btc_generated_on = btcConfirmation.ces.generated_on;
    result.gate_summary = { total: entries.length, pass: passCount, fail: failCount };
    result.risk_flags = btcConfirmation.btc_confirmation.risk_flags.map((rf) => ({
      flag_id: rf.flag_id,
      domain: rf.domain,
      severity: rf.severity,
      description: rf.description,
    }));
    result.failed_gates = entries
      .filter(([, g]) => !g.pass)
      .map(([id, g]) => ({ section: id, domain: g.domain, reason: g.reason }));
  }

  if (tenantConfig) {
    const tc = tenantConfig.tenant_config;
    const dpReady =
      tc.data_protection.sensitivity_label_convention !== '' &&
      tc.data_protection.dlp_policy_convention !== '';
    result.tenant_config_compliance = {
      cloud_environment: tc.identity.cloud_environment,
      pim_status: tc.privileged_access.pim_enabled ? 'enabled' : 'disabled',
      data_protection_readiness: dpReady ? 'configured' : 'not_configured',
      identity_model: tc.identity_architecture.identity_provider,
      admin_account_count:
        tc.privileged_access.global_admins.length +
        tc.privileged_access.security_admins.length +
        tc.privileged_access.compliance_admins.length,
      sentinel_configured: tc.monitoring.sentinel_workspace_name !== '',
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Line items — one per task, with LOE breakdown, domain, and requirement
// ---------------------------------------------------------------------------
function buildLineItems(milestones: any[], _steps: any[], taskCatalog: TaskCatalog): any[] {
  const rate = useLoeRateStore.getState().rates.laborRatePerHour;
  const items: any[] = [];

  // Build task_id → milestone ID map from phased milestones when available
  const tasks = taskCatalog.tasks;
  const taskToMs = new Map<string, string>();
  const hasPhasing = milestones.some((ms: any) => ms.phase_tasks);

  if (hasPhasing) {
    for (const ms of milestones) {
      if (ms.phase_tasks && Array.isArray(ms.phase_tasks)) {
        for (const taskId of ms.phase_tasks) {
          taskToMs.set(taskId, ms.id);
        }
      }
    }
  }

  // Fallback: priority → milestone ID map (non-phased)
  const priorityToMs = new Map<string, string>();
  if (!hasPhasing) {
    let msIdx = 1;
    if (tasks.some((t) => t.priority === 'p0')) {
      priorityToMs.set('p0', `MS-${msIdx}`);
      msIdx++;
    }
    if (tasks.some((t) => t.priority === 'p1')) {
      priorityToMs.set('p1', `MS-${msIdx}`);
      msIdx++;
    }
    if (tasks.some((t) => t.priority === 'p2' || t.priority === 'p3')) {
      priorityToMs.set('p2', `MS-${msIdx}`);
      priorityToMs.set('p3', `MS-${msIdx}`);
    }
  }

  for (const task of tasks) {
    const ee = task.effort_estimate;
    const hours = task.estimated_effort_hours || 0;
    const controls = (task.control_coverage || []).map((c) => c.control_id);
    const msId = hasPhasing
      ? (taskToMs.get(task.task_id) || 'MS-1')
      : (priorityToMs.get(task.priority) || 'MS-1');

    items.push({
      id: `LI-${task.task_id}`,
      name: task.title,
      type: 'labor' as const,
      qty: hours,
      unit: 'hours',
      rate_type: 'hourly' as const,
      unit_price: rate,
      extended_price: hours * rate,
      mapping: {
        milestones: [msId],
        steps: [`step_${task.task_id}`],
        controls,
      },
      domain: task.domain || '',
      requirement_id: task.requirement_id || '',
      requirement_title: task.requirement_title || '',
      dev_loe_hours: ee?.one_time_dev_loe ?? 0,
      config_manual_hours: ee?.one_time_config_manual ?? 0,
      config_automated_hours: ee?.one_time_config_automated ?? 0,
      recurring_manual_hours_yr: ee?.recurring_evidence_manual ?? 0,
      recurring_automated_hours_yr: ee?.recurring_evidence_automated ?? 0,
    });
  }

  if (items.length === 0) {
    items.push({
      id: 'LI-default',
      name: 'Compliance Implementation',
      type: 'labor' as const,
      qty: 40,
      unit: 'hours',
      rate_type: 'hourly' as const,
      unit_price: rate,
      extended_price: 40 * rate,
      mapping: { milestones: [], steps: [], controls: [] },
      domain: '',
      requirement_id: '',
      requirement_title: '',
      dev_loe_hours: 0,
      config_manual_hours: 0,
      config_automated_hours: 0,
      recurring_manual_hours_yr: 0,
      recurring_automated_hours_yr: 0,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// SOW per Proposal schema
// ---------------------------------------------------------------------------
function buildSOW(
  siBaseline: SIBaseline,
  planMode: PlanMode,
  targetLevel: string,
  milestones: any[],
): Record<string, unknown> {
  const deliverables = [
    'Implemented and configured security controls',
    'Complete compliance documentation package (policies, procedures, SSP)',
    'Evidence artifacts organized by control requirement',
    'Tenant manifest defining expected configuration state',
    'Assessment readiness verification report',
  ];

  const assessmentBody = (siBaseline.si_baseline?.assessment as Record<string, any>)
    ?.assessment_body;
  if (assessmentBody && assessmentBody !== 'unknown') {
    deliverables.push(`Assessment coordination with ${assessmentBody}`);
  }

  return {
    overview: `This Statement of Work covers the implementation and validation of CMMC ${targetLevel} compliance controls using a ${planMode} approach. The engagement encompasses gap remediation, control implementation, evidence collection, and assessment preparation.`,
    scope: [
      `Implement controls required for CMMC ${targetLevel} certification`,
      'Remediate all identified compliance gaps from readiness assessment',
      'Configure vendor-provided solutions to satisfy control requirements',
      'Collect and organize evidence artifacts per assessor requirements',
      'Prepare organization for CMMC assessment',
    ],
    deliverables,
    acceptance_criteria: [
      'All identified control gaps have been remediated',
      'Evidence artifacts verified against assessor evidence matrix',
      'Cross-artifact validation checks pass',
      'Readiness gate criteria satisfied',
      'Customer sign-off on all milestone deliverables',
    ],
    roles_responsibilities: {
      customer: [
        'Provide administrative access to in-scope systems',
        'Designate project sponsor and compliance team lead',
        'Make subject matter experts available for interviews',
        'Review and approve deliverables within 5 business days',
        'Approve configuration changes per change management process',
      ],
      offeror: [
        'Provide qualified compliance engineers and assessor-trained staff',
        'Implement controls per approved mission plan',
        'Collect and validate evidence artifacts',
        'Provide weekly status reports and milestone reviews',
        'Ensure all deliverables meet schema and quality standards',
      ],
    },
    schedule: milestones.map(
      (ms: any) => `${ms.name}: Target completion by ${ms.target_date}`,
    ),
    security: [
      'All project personnel will hold appropriate clearances as required',
      'CUI handling procedures will be followed throughout the engagement',
      'All access credentials will be managed per NIST SP 800-171 requirements',
    ],
    out_of_scope: [
      'Hardware procurement and physical installation',
      'Third-party software licensing costs',
      'Ongoing managed security services post-assessment',
      'Legal or regulatory advisory services',
      'Penetration testing or vulnerability assessments',
    ],
    customer_dependencies: [
      'Provide administrative access to all in-scope systems within 5 business days of kickoff',
      'Designate compliance team points of contact',
      'Make subject matter experts available for scheduled interviews',
      'Approve configuration changes in a timely manner',
      'Provide current network diagrams and system documentation',
    ],
    change_control: [
      'All scope changes require written approval from both parties',
      'Cost impact of changes will be estimated before approval',
      'Timeline adjustments will be documented via amended milestone schedule',
    ],
    pricing_terms: [
      'Payment terms: Net 30 from invoice date',
      'Invoicing: Monthly based on milestone completion',
      'Travel and expenses billed at cost with prior approval',
    ],
  };
}

// ---------------------------------------------------------------------------
// Assumptions — include automation ROI comparison when effort data is available
// ---------------------------------------------------------------------------
function buildAssumptions(
  siBaseline: SIBaseline,
  targetLevel: string,
  taskCatalog: TaskCatalog,
  tenantConfig?: TenantConfigProfileOutput | null,
): string[] {
  const base = [
    'Client provides administrative access to all in-scope systems',
    'Existing infrastructure documentation is current and accurate',
    'Key personnel are available for interviews and working sessions',
    `Target compliance level is CMMC ${targetLevel}`,
    'No material changes to scope during the period of performance',
  ];

  // TCP-derived environment assumptions
  if (tenantConfig) {
    const tc = tenantConfig.tenant_config;
    const envLabels: Record<string, string> = {
      commercial: 'Microsoft 365 Commercial',
      gcc: 'Microsoft 365 GCC',
      gcc_high: 'Microsoft 365 GCC High',
      dod: 'Microsoft 365 DoD',
    };
    base.push(`Cloud environment: ${envLabels[tc.identity.cloud_environment] || tc.identity.cloud_environment}`);
    base.push(`Licensing: ${tc.licensing.primary_sku} (${tc.licensing.license_count} seats)`);
    const idpLabels: Record<string, string> = {
      entra_native: 'Entra ID (cloud-native)',
      hybrid_ad_connect: 'Hybrid (AD Connect)',
      hybrid_cloud_sync: 'Hybrid (Cloud Sync)',
      external_idp: 'External identity provider',
    };
    base.push(`Identity model: ${idpLabels[tc.identity_architecture.identity_provider] || tc.identity_architecture.identity_provider}`);
    base.push(`PIM: ${tc.privileged_access.pim_enabled ? 'Enabled' : 'Not enabled'}`);
    const cuiLocationCount = tc.data_protection.cui_sharepoint_sites.length + tc.data_protection.cui_teams_channels.length;
    if (cuiLocationCount > 0) {
      base.push(`CUI data locations: ${tc.data_protection.cui_sharepoint_sites.length} SharePoint site(s), ${tc.data_protection.cui_teams_channels.length} Teams channel(s)`);
    }
  }

  // Aggregate effort estimates for automation ROI comparison
  const totals = { configManual: 0, configAuto: 0, devLoe: 0, evidManual: 0, evidAuto: 0 };
  let hasEstimates = false;
  for (const task of taskCatalog.tasks) {
    const ee = task.effort_estimate;
    if (ee) {
      hasEstimates = true;
      totals.configManual += ee.one_time_config_manual;
      totals.configAuto += ee.one_time_config_automated;
      totals.devLoe += ee.one_time_dev_loe;
      totals.evidManual += ee.recurring_evidence_manual;
      totals.evidAuto += ee.recurring_evidence_automated;
    }
  }

  if (hasEstimates) {
    const rate = useLoeRateStore.getState().rates.laborRatePerHour;
    const manualY1 = totals.configManual + totals.evidManual;
    const autoY1 = totals.configAuto + totals.devLoe + totals.evidAuto;
    const savingsPct = manualY1 > 0 ? Math.round((1 - autoY1 / manualY1) * 100) : 0;

    // ROI year: when does cumulative auto savings exceed dev investment
    const annualSavings = (totals.evidManual - totals.evidAuto);
    const roiYear = annualSavings > 0 ? Math.ceil(totals.devLoe / annualSavings) + 1 : 0;

    base.push(
      `Effort based on manual implementation: ${manualY1}h ($${(manualY1 * rate).toLocaleString('en-US')})`,
      `With automation tooling: ${autoY1}h ($${(autoY1 * rate).toLocaleString('en-US')}) — saves ${savingsPct}%`,
    );
    if (totals.devLoe > 0 && roiYear > 0) {
      base.push(
        `Automation dev investment: ${totals.devLoe}h ($${(totals.devLoe * rate).toLocaleString('en-US')}) — ROI in Year ${roiYear}`,
      );
    }
  }

  // SI-derived assumptions
  const siAssessment = siBaseline.si_baseline?.assessment as Record<string, any> | undefined;
  const siTarget = siBaseline.si_baseline?.target as Record<string, any> | undefined;
  const siDeps = siBaseline.si_baseline?.dependencies as Record<string, any> | undefined;

  if (siAssessment?.certification_timing_goal) {
    const ctg = siAssessment.certification_timing_goal;
    if (ctg.goal_type === 'by_date' && ctg.by_date) {
      base.push(`Certification timeline: ${ctg.goal_type} (${ctg.by_date})`);
    } else if (ctg.goal_type === 'within_days' && typeof ctg.within_days === 'number') {
      base.push(`Certification timeline: ${ctg.goal_type} (${ctg.within_days} days)`);
    } else if (ctg.goal_type) {
      base.push(`Certification timeline: ${ctg.goal_type}`);
    }
  }

  if (siTarget?.regulated_data_notes && typeof siTarget.regulated_data_notes === 'string') {
    const keywords = ['itar', 'ear', 'cjis', 'pii', 'phi', 'privacy'];
    const hasKeyword = keywords.some((k) =>
      siTarget.regulated_data_notes.toLowerCase().includes(k),
    );
    if (hasKeyword) {
      base.push(`Special data handling requirements: ${siTarget.regulated_data_notes}`);
    }
  }

  if (siDeps?.budget_constraints) {
    base.push(`Budget constraints: ${siDeps.budget_constraints}`);
  }

  if (siDeps?.schedule_constraints) {
    base.push(`Schedule constraints: ${siDeps.schedule_constraints}`);
  }

  return base;
}

// ---------------------------------------------------------------------------
function computeTotalDays(taskCatalog: TaskCatalog): number {
  const hours = taskCatalog.tasks.reduce((sum, t) => sum + t.estimated_effort_hours, 0);
  return Math.max(Math.ceil(hours / 40) * 7, 90);
}
