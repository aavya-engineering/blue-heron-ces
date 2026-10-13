// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, ReadinessPosture, ManualMissionPlan, CUIBoundaryOutput, BTCConfirmationOutput, TenantConfigProfileOutput } from '../../shared/types/artifacts';
import type { TaskCatalog, PlanMode, ScopeExclusion, ControlDisposition, ControlDirective, StamperDirective } from '../types';
import { generateId } from '../../shared/utils/idGenerator';
import {
  todayISO,
  buildInputsBlock,
  deriveMilestones,
  deriveAssessorNotes,
  buildInlineCostProposal,
  deriveSharedSteps,
} from './planHelpers';
import { M365_ALTERNATIVES } from './m365Alternatives';

/**
 * Validate scope exclusions requiring RR evidence.
 * Returns { validatedExclusions, warnings }.
 */
function validateScopeExclusions(
  scopeExclusions: ScopeExclusion[] | undefined,
  readinessPosture: ReadinessPosture,
): { validatedExclusions: ScopeExclusion[]; warnings: string[] } {
  if (!scopeExclusions || scopeExclusions.length === 0) {
    return { validatedExclusions: [], warnings: [] };
  }

  const validatedExclusions: ScopeExclusion[] = [];
  const warnings: string[] = [];

  for (const exclusion of scopeExclusions) {
    if (!exclusion.requires_rr_validation) {
      // No validation required, include as-is
      validatedExclusions.push(exclusion);
      continue;
    }

    // Check if RR has evidence for this control
    const rrResults = readinessPosture.ces.requirement_results || [];
    const rrEntry = rrResults.find((r) => r.requirement_id === exclusion.requirement_id);

    // Valid evidence = entry exists AND status is 'met' AND has evidence_refs
    const hasValidEvidence =
      rrEntry &&
      rrEntry.status === 'met' &&
      rrEntry.evidence_refs &&
      rrEntry.evidence_refs.length > 0;

    if (hasValidEvidence) {
      // Validation passed, include exclusion
      validatedExclusions.push(exclusion);
    } else {
      // Validation failed, emit warning and DO NOT include exclusion
      const reason = !rrEntry
        ? 'no Readiness Posture evidence found'
        : rrEntry.status !== 'met'
          ? `Readiness Posture status is '${rrEntry.status}' (expected 'met')`
          : 'no evidence references attached';

      warnings.push(
        `SCOPE EXCLUSION NOT APPLIED: ${exclusion.requirement_id} requires Readiness Recon validation but ${reason}. ` +
          `Strategic Intent claims '${exclusion.si_value}' for ${exclusion.si_field}, but this must be confirmed with RR evidence ` +
          `(e.g., Conditional Access App Control session policies blocking downloads). Control remains in scope for this plan.`,
      );
    }
  }

  return { validatedExclusions, warnings };
}

function buildControlDirectives(dispositions: ControlDisposition[]): ControlDirective[] {
  return dispositions.map((cd) => {
    let directive: StamperDirective;
    if (cd.stamper_action === 'N-A-Capability-Absent') {
      directive = 'document-absence';
    } else if (cd.stamper_action === 'Met-By-Prohibition') {
      directive = cd.readiness_status === 'met' ? 'validate' : 'document-prohibition';
    } else if (cd.stamper_action === 'Inherited-FedRAMP') {
      directive = 'inherit-fedramp';
    } else if (cd.stamper_action === 'Non-Stack') {
      directive = 'manual';
    } else if (cd.readiness_status === 'met') {
      directive = 'validate';
    } else {
      directive = 'implement';
    }
    return {
      control_id: cd.requirement_id,
      directive,
      ...(cd.scope_justification ? { justification: cd.scope_justification } : {}),
      ...(cd.task_ids.length > 0 ? { step_ids: cd.task_ids } : {}),
      ...(cd.inheritance_rationale ? { inheritance_rationale: cd.inheritance_rationale } : {}),
      ...(cd.fedramp_package_id ? { fedramp_package_id: cd.fedramp_package_id } : {}),
      ...(cd.requires_stamper_verification != null ? { requires_stamper_verification: cd.requires_stamper_verification } : {}),
    };
  });
}

/**
 * Emit Manual Mission Plan per pseudocode §4.4.
 * Schema: { ces, inputs, outputs }
 * outputs = { human_readable_mission_plan, cost_proposal_sow }
 */
export function generateManualPlan(
  siBaseline: SIBaseline,
  readinessPosture: ReadinessPosture,
  taskCatalog: TaskCatalog,
  planMode: PlanMode,
  assessorKB: any,
  vendorCaps: any,
  cuiBoundary?: CUIBoundaryOutput | null,
  btcConfirmation?: BTCConfirmationOutput | null,
  tenantConfig?: TenantConfigProfileOutput | null,
  scopeExclusions?: ScopeExclusion[],
  controlDispositions?: ControlDisposition[],
  scopeWarnings?: string[],
  cesId?: string,
): ManualMissionPlan {
  const targetLevel = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';
  const today = todayISO();

  const infrastructure_model = siBaseline.si_baseline?.dependencies?.infrastructure_model || 'm365_azure';
  const license_tier = siBaseline.si_baseline?.dependencies?.license_tier || 'g5';
  const user_count = siBaseline.si_baseline?.dependencies?.user_count || 50;

  const milestones = deriveMilestones(taskCatalog, today, siBaseline);
  const sharedSteps = deriveSharedSteps(taskCatalog);

  // Manual plan steps: pick all shared fields plus manual_completion_criteria,
  // omit execution metadata
  let steps = sharedSteps.map(({ execution: _execution, ...rest }) => rest);

  // Filter out Azure infrastructure deployment steps when infrastructure_model === 'm365_only'
  if (infrastructure_model === 'm365_only') {
    steps = steps.filter((step: any) => {
      const actions = step.actions || [];
      const hasAzEngine = actions.some(
        (a: any) => a.action_type === 'infrastructure_deployment',
      );
      return !hasAzEngine;
    });
  }

  const assessorNotes = deriveAssessorNotes(assessorKB, taskCatalog);

  const inputs: Record<string, unknown> = buildInputsBlock(siBaseline, readinessPosture, assessorKB, vendorCaps, targetLevel, today);

  // Enrich inputs with CUI boundary and BTC confirmation references
  if (cuiBoundary) {
    inputs.cui_boundary_ref = {
      artifact: cuiBoundary.ces.artifact,
      version: cuiBoundary.ces.version,
      generated_on: cuiBoundary.ces.generated_on,
      cui_bank_version: cuiBoundary.ces.cui_bank_version,
    };
  }
  if (btcConfirmation) {
    const gates = btcConfirmation.btc_confirmation.gate_status;
    const gateEntries = Object.entries(gates);
    const passCount = gateEntries.filter(([, g]) => g.pass).length;
    const failCount = gateEntries.filter(([, g]) => !g.pass).length;
    inputs.btc_confirmation_ref = {
      artifact: btcConfirmation.ces.artifact,
      version: btcConfirmation.ces.version,
      generated_on: btcConfirmation.ces.generated_on,
      btc_bank_version: btcConfirmation.ces.btc_bank_version,
      activation_package_version: btcConfirmation.ces.activation_package_version,
      gate_summary: { total: gateEntries.length, pass: passCount, fail: failCount },
    };
  }
  if (tenantConfig) {
    inputs.tcp_ref = {
      artifact: tenantConfig.ces.artifact,
      version: tenantConfig.ces.version,
      generated_on: tenantConfig.ces.generated_on,
      tcp_bank_version: tenantConfig.ces.tcp_bank_version,
    };
  }

  // Infrastructure configuration summary
  const totalControls = controlDispositions?.length || 110;
  const scopedOutCount = controlDispositions?.filter(cd => cd.scope_status === 'scoped_out').length || 0;
  const inScopeControls = totalControls - scopedOutCount;
  const coveragePct = totalControls > 0 ? ((inScopeControls / totalControls) * 100).toFixed(1) : '100.0';
  let coverageSummary = `${inScopeControls} of ${totalControls} controls (${coveragePct}%)`;
  if (scopedOutCount > 0) {
    coverageSummary += `, ${scopedOutCount} scoped out`;
  }

  const infrastructure_configuration = {
    model: infrastructure_model,
    license_tier,
    user_count,
    coverage_summary: coverageSummary,
  };

  // M365-Only Enclave Gap Advisory section (only for m365_only)
  const m365GapAdvisory =
    infrastructure_model === 'm365_only'
      ? {
          title: 'M365-Only Enclave Gap Advisory',
          description:
            '9 NIST 800-171 controls cannot be fully satisfied with M365-only infrastructure. The following alternative implementations require assessor pre-approval.',
          alternatives: Object.entries(M365_ALTERNATIVES).map(([controlId, alt]) => ({
            control_id: controlId,
            azure_approach: alt.azure_approach,
            m365_alternative: alt.m365_alternative,
            gap_severity: alt.gap_severity,
          })),
        }
      : undefined;

  // Session-Controlled BYOD Advisory (only when session_controlled_byod is active)
  const sessionControlAdvisory =
    siBaseline.si_baseline?.operations?.byod_posture === 'session_controlled_byod'
      ? {
          title: 'Session-Controlled BYOD Advisory',
          description: 'BYOD devices access CUI via Entra ID Conditional Access App Control session policies. CUI never persists on endpoints. The following evidence is required to demonstrate session control enforcement to the assessor.',
          evidence_requirements: [
            { requirement_id: 'SCBA-EV-001', description: 'Conditional Access App Control policy export showing session control rules for M365 apps (block download, block copy/paste, block print, block upload to personal)' },
            { requirement_id: 'SCBA-EV-002', description: 'Entra ID sign-in logs demonstrating session control enforcement events for in-scope users over 30-day window' },
            { requirement_id: 'SCBA-EV-003', description: 'Microsoft Defender for Cloud Apps session activity dashboard export showing blocked actions' },
          ],
          affected_controls: ['CM.L2-3.4.6', 'MP.L2-3.8.7', 'AC.L2-3.1.19', 'SC.L2-3.13.16', 'AC.L2-3.1.18'],
        }
      : undefined;

  // Wireless Access Path Advisory (only when wireless_access_path_only is active)
  const wirelessAccessPathAdvisory =
    siBaseline.si_baseline?.operations?.wireless_posture === 'wireless_access_path_only'
      ? {
          title: 'Wireless Access Path Advisory',
          description: 'No organizational wireless infrastructure exists. Wireless is present only in the unmanaged user access path between personal endpoints and M365. AC.L2-3.1.16 and AC.L2-3.1.17 are addressed via Entra ID Conditional Access policies (wireless authorization equivalent) and M365 GCC High TLS enforcement (wireless encryption equivalent).',
          evidence_requirements: [
            { requirement_id: 'WAPO-EV-001', description: 'Entra ID Conditional Access policy export showing that CUI workload sign-ins require phishing-resistant MFA regardless of network origin (wireless authorization equivalent — controls who can access CUI over any wireless network)' },
            { requirement_id: 'WAPO-EV-002', description: 'M365 GCC High TLS enforcement: Microsoft Service Trust Portal FedRAMP authorization documentation confirming TLS 1.2+ is enforced for all GCC High connections, plus tenant TLS minimum version setting in Entra ID (wireless encryption equivalent — encrypts CUI in transit above the wireless medium)' },
          ],
          affected_controls: ['AC.L2-3.1.16', 'AC.L2-3.1.17'],
        }
      : undefined;

  // FedRAMP Inheritance Advisory (only when fedramp_package_ids present)
  const fedrampInheritanceAdvisory =
    siBaseline.si_baseline?.dependencies?.fedramp_package_ids &&
    siBaseline.si_baseline.dependencies.fedramp_package_ids.length > 0
      ? {
          title: 'FedRAMP Inheritance Advisory',
          description:
            'Controls classified as Inherited-FedRAMP are satisfied by the CSP under its FedRAMP authorization. The assessor will verify inheritance claims against the FedRAMP Marketplace and Shared Responsibility Matrix.',
          evidence_requirements: [
            { requirement_id: 'FRI-EV-001', description: 'FedRAMP authorization letter or Marketplace listing for each Package ID' },
            { requirement_id: 'FRI-EV-002', description: 'CSP Shared Responsibility Matrix mapping inherited controls to FedRAMP authorization' },
            { requirement_id: 'FRI-EV-003', description: 'Microsoft Service Trust Portal documentation confirming physical security, maintenance, and time sync controls' },
          ],
          affected_controls: controlDispositions
            ?.filter((cd) => cd.stamper_action === 'Inherited-FedRAMP')
            .map((cd) => cd.requirement_id) || [],
          fedramp_package_ids: siBaseline.si_baseline.dependencies.fedramp_package_ids,
        }
      : undefined;

  // License tier capability matrix
  const license_tier_matrix = {
    title: 'License Tier Capability Matrix',
    tiers: {
      business_premium: {
        cost_per_user_month: 60,
        purview_audit_premium: false,
        insider_risk_management: false,
        advanced_ediscovery: false,
        defender_suite: 'partial',
        notes: 'Gaps in AU/IR controls. Not recommended for L3.',
      },
      g3: {
        cost_per_user_month: 56,
        purview_audit_premium: true,
        insider_risk_management: true,
        advanced_ediscovery: true,
        defender_suite: 'requires add-ons',
        notes: 'Good AU/IR coverage. Requires Defender and Purview add-on purchases.',
      },
      g5: {
        cost_per_user_month: 52,
        purview_audit_premium: true,
        insider_risk_management: true,
        advanced_ediscovery: true,
        defender_suite: 'included',
        notes: 'All-inclusive. RECOMMENDED. Strongest coverage at lowest per-user cost.',
      },
    },
    selected_tier: license_tier,
  };

  // Build boundary context section for outputs
  const boundaryContext = buildBoundaryContext(cuiBoundary, btcConfirmation, tenantConfig);

  const { validatedExclusions, warnings } = validateScopeExclusions(
    scopeExclusions,
    readinessPosture,
  );
  if (scopeWarnings) {
    warnings.push(...scopeWarnings);
  }

  // Build disposition summary — top-of-plan control register with SI key facts
  const dispositionSummary = buildDispositionSummary(siBaseline, controlDispositions);

  return {
    ces: {
      artifact: 'manual_mission_plan',
      version: '1.0.0',
      generated_on: today,
      intent: `CMMC ${targetLevel} compliance mission plan (${planMode})`,
      ...(cesId ? { cesId } : {}),
    },
    inputs: {
      ...inputs,
      infrastructure_configuration,
    },
    outputs: {
      human_readable_mission_plan: {
        plan_id: generateId('mplan'),
        plan_mode: planMode,
        target_level: targetLevel,
        disposition_summary: dispositionSummary,
        milestones,
        steps,
        assessor_alignment_notes: assessorNotes,
        ...(boundaryContext ? { boundary_context: boundaryContext } : {}),
        ...(m365GapAdvisory ? { m365_gap_advisory: m365GapAdvisory } : {}),
        ...(sessionControlAdvisory ? { session_control_advisory: sessionControlAdvisory } : {}),
        ...(wirelessAccessPathAdvisory ? { wireless_access_path_advisory: wirelessAccessPathAdvisory } : {}),
        ...(fedrampInheritanceAdvisory ? { fedramp_inheritance_advisory: fedrampInheritanceAdvisory } : {}),
        ...(validatedExclusions.length > 0 ? { scope_exclusions: validatedExclusions } : {}),
        ...(warnings.length > 0 ? { scope_exclusion_warnings: warnings } : {}),
        ...(controlDispositions && controlDispositions.length > 0 ? { controls: controlDispositions } : {}),
        ...(controlDispositions && controlDispositions.length > 0 ? { control_directives: buildControlDirectives(controlDispositions) } : {}),
        license_tier_matrix,
      },
      cost_proposal_sow: buildInlineCostProposal(taskCatalog, milestones, steps, siBaseline, planMode),
    },
  };
}

function buildDispositionSummary(
  siBaseline: SIBaseline,
  controlDispositions?: ControlDisposition[],
): Record<string, unknown> {
  const ops = siBaseline.si_baseline?.operations;
  const scope = siBaseline.si_baseline?.scope;
  const deps = siBaseline.si_baseline?.dependencies;
  const target = siBaseline.si_baseline?.target;

  // SI key facts that drive scope exclusions and directive assignment
  const si_key_facts = {
    target_level: target?.target_cmmc_level || 'L2',
    infrastructure_model: deps?.infrastructure_model || 'm365_azure',
    license_tier: deps?.license_tier || 'g5',
    deployment_posture: scope?.deployment_posture || 'unknown',
    user_count: deps?.user_count || 50,
    mobile_device_presence: ops?.mobile_device_presence || 'unknown',
    wireless_posture: ops?.wireless_posture || 'unknown',
    removable_media_posture: ops?.removable_media_posture || 'unknown',
    remote_access_posture: ops?.remote_access_posture || 'unknown',
    maintenance_posture: ops?.maintenance_posture || 'unknown',
    cui_endpoint_posture: ops?.cui_endpoint_posture || 'unknown',
    fedramp_package_ids: deps?.fedramp_package_ids || [],
    physical_facility_count: deps?.physical_facility_count ?? null,
    customer_equipment_count: deps?.customer_equipment_count ?? null,
  };

  if (!controlDispositions || controlDispositions.length === 0) {
    return { si_key_facts, control_register: [], directive_counts: {} };
  }

  // Build directives and pair with disposition for sorting
  const directives = buildControlDirectives(controlDispositions);
  const directiveMap = new Map(directives.map((d) => [d.control_id, d.directive]));

  // Sort by domain (family) then requirement_id
  const sorted = [...controlDispositions].sort((a, b) => {
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.requirement_id.localeCompare(b.requirement_id);
  });

  const control_register = sorted.map((cd) => ({
    control_id: cd.requirement_id,
    title: cd.title,
    domain: cd.domain,
    directive: directiveMap.get(cd.requirement_id) || 'implement',
    scope_status: cd.scope_status,
  }));

  // Tally directives
  const directive_counts: Record<string, number> = {};
  for (const entry of control_register) {
    directive_counts[entry.directive] = (directive_counts[entry.directive] || 0) + 1;
  }

  return { si_key_facts, control_register, directive_counts };
}

function buildBoundaryContext(
  cuiBoundary?: CUIBoundaryOutput | null,
  btcConfirmation?: BTCConfirmationOutput | null,
  tenantConfig?: TenantConfigProfileOutput | null,
): Record<string, unknown> | null {
  if (!cuiBoundary && !btcConfirmation && !tenantConfig) return null;

  const ctx: Record<string, unknown> = {};

  if (cuiBoundary) {
    ctx.cui_boundary = cuiBoundary.cui_boundary;
  }

  if (btcConfirmation) {
    const btc = btcConfirmation.btc_confirmation;
    ctx.btc_verification = {
      gate_status: btc.gate_status,
      risk_flags: btc.risk_flags,
      evidence_count: btc.evidence_refs.length,
    };
  }

  return ctx;
}
