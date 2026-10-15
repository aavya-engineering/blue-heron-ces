// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { BTCConfirmationOutput, CUIBoundaryOutput, TenantConfigProfileOutput } from '@/shared/types/artifacts';
import { isSentinelConnectorGap } from './manifestGenerator';

/**
 * Cross-artifact validation per pseudocode §4.8.
 * Ensures consistency between Manual Plan, Proposal, and Tenant Manifest.
 *
 * Assertions:
 *  1. All proposal line_items.mapping.step_ids exist in manual_plan.steps
 *  2. All expected_artifacts in manual_plan appear in tenant_manifest.evidence_monitors
 *  3. All normative_controls reference controls present in plan control_coverage
 *  4. BTC failed gates produce warnings
 *  5. BTC critical risk flags produce warnings
 */
export function validateArtifactAlignment(
  manualPlan: any,
  proposal: any,
  tenantManifest: any,
  btcConfirmation?: BTCConfirmationOutput | null,
  cuiBoundary?: CUIBoundaryOutput | null,
  tenantConfig?: TenantConfigProfileOutput | null,
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract plan data (manual plan lives under outputs.human_readable_mission_plan)
  const humanPlan = manualPlan?.outputs?.human_readable_mission_plan;
  const proposalBlock = proposal?.proposal;
  const manifestBlock = tenantManifest?.tenant_manifest;

  // ---- Basic structure checks ----
  if (!humanPlan) {
    errors.push('Manual plan missing outputs.human_readable_mission_plan');
  }
  if (!proposalBlock) {
    errors.push('Proposal missing proposal block');
  }
  if (!manifestBlock) {
    errors.push('Tenant manifest missing tenant_manifest block');
  }

  // If top-level structures are missing, can't do deeper checks
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // ---- 1. Proposal line items map to manual plan steps ----
  const planStepIds = new Set<string>(
    (humanPlan.steps || []).map((s: any) => s.id),
  );

  const proposalLineItems: any[] = proposalBlock.line_items || [];
  for (const li of proposalLineItems) {
    const mappedSteps: string[] = li.mapping?.steps || [];
    for (const stepId of mappedSteps) {
      if (!planStepIds.has(stepId)) {
        warnings.push(
          `Proposal line item "${li.id}" references step "${stepId}" not found in manual plan`,
        );
      }
    }
  }

  // Check that all plan steps appear in at least one proposal line item
  const proposalMappedSteps = new Set<string>(
    proposalLineItems.flatMap((li: any) => li.mapping?.steps || []),
  );
  for (const stepId of planStepIds) {
    if (!proposalMappedSteps.has(stepId)) {
      warnings.push(`Manual plan step "${stepId}" not referenced by any proposal line item`);
    }
  }

  // ---- 2. (Removed — exec plan is now Markdown, no execution_graph to cross-check) ----

  const planControlIds = new Set<string>(
    (humanPlan.steps || []).flatMap(
      (s: any) => (s.control_coverage || []).map((c: any) => c.control_id),
    ),
  );

  // ---- 3. Expected artifacts appear in tenant manifest evidence monitors ----
  const monitorControlIds = new Set<string>(
    (manifestBlock.evidence_monitors || []).flatMap((m: any) => m.control_ids || []),
  );

  // Check at control level — each control with expected artifacts should have a monitor
  const controlsWithArtifacts = new Set<string>(
    (humanPlan.steps || [])
      .filter((s: any) => (s.expected_artifacts || []).length > 0)
      .flatMap((s: any) => (s.control_coverage || []).map((c: any) => c.control_id)),
  );

  for (const controlId of controlsWithArtifacts) {
    if (!monitorControlIds.has(controlId)) {
      warnings.push(
        `Control "${controlId}" has expected artifacts but no evidence monitor in tenant manifest`,
      );
    }
  }

  // ---- 4. Normative controls reference controls in plan ----
  const normativeControlIds = new Set<string>(
    (manifestBlock.normative_controls || []).map((nc: any) => nc.control_id),
  );

  for (const ncId of normativeControlIds) {
    if (ncId !== 'general' && !planControlIds.has(ncId)) {
      warnings.push(
        `Tenant manifest normative control "${ncId}" not present in manual plan control coverage`,
      );
    }
  }

  // ---- 5. Milestone consistency ----
  const planMilestoneIds = new Set<string>(
    (humanPlan.milestones || []).map((m: any) => m.id),
  );

  for (const li of proposalLineItems) {
    const mappedMilestones: string[] = li.mapping?.milestones || [];
    for (const msId of mappedMilestones) {
      if (!planMilestoneIds.has(msId)) {
        warnings.push(
          `Proposal line item "${li.id}" references milestone "${msId}" not in manual plan`,
        );
      }
    }
  }

  // ---- 6. BTC cross-artifact checks ----
  if (btcConfirmation) {
    const gates = btcConfirmation.btc_confirmation.gate_status;
    const failedGates = Object.entries(gates).filter(([, g]) => !g.pass);
    if (failedGates.length > 0) {
      for (const [sectionId, gate] of failedGates) {
        warnings.push(
          `BTC gate "${sectionId}" (${gate.domain}) failed: ${gate.reason}`,
        );
      }
    }

    const riskFlags = btcConfirmation.btc_confirmation.risk_flags;
    const criticalFlags = riskFlags.filter((rf) => rf.severity === 'critical' || rf.severity === 'high');
    for (const flag of criticalFlags) {
      warnings.push(
        `BTC risk flag [${flag.severity}] ${flag.flag_id}: ${flag.description}`,
      );
    }
  }

  // ---- 7. CUI boundary → manifest boundary_zones cross-check ----
  if (cuiBoundary && !manifestBlock.boundary_zones) {
    warnings.push(
      'CUI boundary exists but tenant manifest is missing boundary_zones',
    );
  }

  // ---- 8. BTC failed gates → manifest normative controls cross-check ----
  if (btcConfirmation?.btc_confirmation?.gate_status) {
    const failedGates = Object.entries(btcConfirmation.btc_confirmation.gate_status)
      .filter(([, g]) => !g.pass);

    for (const [, gate] of failedGates) {
      const expectedControlId = `btc_gate_${gate.domain.toLowerCase()}`;
      if (!normativeControlIds.has(expectedControlId)) {
        warnings.push(
          `BTC gate "${gate.domain}" failed but manifest is missing normative control "${expectedControlId}"`,
        );
      }
    }
  }

  // ---- 9. TCP cross-artifact checks ----
  if (tenantConfig) {
    const tc = tenantConfig.tenant_config;

    // 9a. TCP exists → manifest must have tenant_identity section
    if (!manifestBlock.tenant_identity) {
      warnings.push(
        'TCP exists but tenant manifest is missing tenant_identity section',
      );
    }

    // 9b. TCP data_protection fields → manifest must have SC.L2-3.13.1 config intent
    const hasDpFields =
      tc.data_protection.sensitivity_label_convention !== '' ||
      tc.data_protection.dlp_policy_convention !== '' ||
      tc.data_protection.cui_sharepoint_sites.length > 0 ||
      tc.data_protection.cui_teams_channels.length > 0;
    if (hasDpFields) {
      const configIntentControlIds = new Set<string>(
        (manifestBlock.config_intents || []).flatMap((ci: any) => ci.control_ids || []),
      );
      if (!configIntentControlIds.has('SC.L2-3.13.1')) {
        warnings.push(
          'TCP has data_protection fields but manifest is missing SC.L2-3.13.1 config intent',
        );
      }
    }

    // 9c. TCP data_connectors → manifest must have SIEM evidence monitor
    if (tc.monitoring.data_connectors.length > 0) {
      const hasAuditMonitor = (manifestBlock.evidence_monitors || []).some(
        (m: any) => (m.control_ids || []).some((id: string) => id.startsWith('AU.L2-3.3')),
      );
      if (!hasAuditMonitor) {
        warnings.push(
          'TCP has data_connectors but manifest is missing AU.L2-3.3.x evidence monitor',
        );
      }
    }

    // 9d. TCP privileged_access → manifest must have AC.L2-3.1.5 config intent
    const hasPrivAccess =
      tc.privileged_access.pim_enabled ||
      tc.privileged_access.security_admins.length > 0 ||
      tc.privileged_access.compliance_admins.length > 0;
    if (hasPrivAccess) {
      const configIntentControlIds = new Set<string>(
        (manifestBlock.config_intents || []).flatMap((ci: any) => ci.control_ids || []),
      );
      if (!configIntentControlIds.has('AC.L2-3.1.5')) {
        warnings.push(
          'TCP has privileged_access data but manifest is missing AC.L2-3.1.5 config intent',
        );
      }
    }

    // 9e. TCP non-native identity_provider → manifest must have IA.L2-3.5.1 config intent
    if (tc.identity_architecture.identity_provider !== 'entra_native') {
      const configIntentControlIds = new Set<string>(
        (manifestBlock.config_intents || []).flatMap((ci: any) => ci.control_ids || []),
      );
      if (!configIntentControlIds.has('IA.L2-3.5.1')) {
        warnings.push(
          `TCP identity_provider is "${tc.identity_architecture.identity_provider}" but manifest is missing IA.L2-3.5.1 config intent`,
        );
      }
    }

    // 9f. Sentinel connector gap → manifest must have remediation config_intent
    if (isSentinelConnectorGap(tc)) {
      const hasRemediationIntent = (manifestBlock.config_intents || []).some(
        (ci: any) =>
          (ci.control_ids || []).includes('AU.L2-3.3.1') &&
          ci.desired_config?.required_connectors,
      );
      if (!hasRemediationIntent) {
        warnings.push(
          'TCP indicates G5/E5 license with Sentinel activated but no data connectors — manifest is missing Sentinel connector remediation config_intent',
        );
      }
    }
  }

  // Promote critical warnings to errors
  // (For now, we treat all checks as warnings and only structural issues as errors)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
