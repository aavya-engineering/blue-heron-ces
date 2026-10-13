// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { Gap, GapSet, TaskCatalog, Task, Priority, TaskType, ActionEngine, ArtifactType, EvidenceArtifact, VendorHelpRef, ControlCoverage, EffortEstimate, StepAction, ControlDisposition } from '../types';
import type { SIBaseline, BTCConfirmationOutput, TenantConfigProfileOutput } from '../../shared/types/artifacts';
import type { PatternEntry, PlaybookEntry } from '../../shared/types/domain';
import type { TechRefIndex } from '../../shared/services/techRefIndex';
import { generateId } from '../../shared/utils/idGenerator';
import { getLoeRates } from '../../shared/config/loeRatesProvider';
import { deriveDeliverableContentGuidance } from './deliverableGuide';
import { isSentinelConnectorGap, G5_RECOMMENDED_SENTINEL_CONNECTORS } from './manifestGenerator';
import { getApplicableM365Alternatives, type AlternativeImplementation } from './m365Alternatives';

export interface EnrichedVendorData {
  taxonomy?: any;
  patterns?: { patterns: PatternEntry[] } | null;
  playbook?: { playbook: PlaybookEntry[] } | null;
}

/**
 * Build task catalog from gap set (pseudocode §4.3).
 * Uses vendor capabilities and assessor knowledge to derive
 * what_to_do, how_to_verify, and expected_artifacts per task.
 */
export function compileTaskCatalog(
  gapSet: GapSet,
  siBaseline: SIBaseline,
  vendorCapabilities: any,
  assessorKB: any,
  cmmcRequirements?: any,
  evidenceArchetypeCatalog?: any,
  techRefIndex?: TechRefIndex,
  btcConfirmation?: BTCConfirmationOutput | null,
  evidenceMatrix?: any,
  tenantConfig?: TenantConfigProfileOutput | null,
  controlDispositions?: ControlDisposition[],
): TaskCatalog & { controlDispositions?: ControlDisposition[] } {
  const tasks: Task[] = [];
  const reqStore: any[] = cmmcRequirements?.requirements
    || cmmcRequirements?.ces?.requirements
    || [];

  // Build archetype lookup for evidence enrichment
  const archetypeMap = buildArchetypeMap(evidenceArchetypeCatalog);

  // Build failed-gate domain index from BTC confirmation
  const failedGateDomains = new Map<string, { reason: string; sectionId: string }>();
  if (btcConfirmation?.btc_confirmation?.gate_status) {
    for (const [sectionId, gate] of Object.entries(btcConfirmation.btc_confirmation.gate_status)) {
      if (!gate.pass) {
        failedGateDomains.set(gate.domain.toUpperCase(), { reason: gate.reason, sectionId });
      }
    }
  }

  // Extract in-scope user count from SI Baseline for effort scaling
  const inScopeUsers = (siBaseline.si_baseline as Record<string, any>)?.target
    ?.in_scope_users_estimate as number | undefined;

  const infrastructureModel = siBaseline.si_baseline?.dependencies?.infrastructure_model || 'm365_azure';
  const m365Alternatives = getApplicableM365Alternatives(infrastructureModel);

  for (const gap of gapSet.gaps) {
    const impl = selectVendorImplementation(vendorCapabilities, gap.requirement_id, siBaseline, techRefIndex);
    const verification = deriveVerification(assessorKB, gap.requirement_id, impl);
    const evidence = deriveExpectedArtifacts(assessorKB, gap.requirement_id, impl, gap, archetypeMap);
    const requirement = reqStore.find((r: any) => r.requirement_id === gap.requirement_id);

    const taskId = generateId(`task_${gap.requirement_id}`);

    // Use CMMC data for richer fallback content
    const title = impl.title && impl.title !== `Implement ${gap.requirement_id}`
      ? impl.title
      : `${gap.requirement_title} (${gap.requirement_id})`;

    const description = impl.description && impl.description !== `Implement and configure controls for ${gap.requirement_id} at CMMC ${siBaseline.si_baseline?.target?.target_cmmc_level || 'L2'}`
      ? impl.description
      : gap.requirement_text || gap.gap_reason;

    const whatToDo = impl.steps.length > 0
      ? [...impl.steps, ...buildCMMCSupplementalGuidance(gap)]
      : [...buildFallbackWhatToDo(gap, requirement)];

    // Append deliverable content guidance for non-systems artifacts
    const deliverableGuidance = deriveDeliverableContentGuidance(
      vendorCapabilities, gap.requirement_id,
    );
    // Append evidence collection guidance from archetype catalog
    const evidenceGuidance = deriveEvidenceCollectionGuidance(gap, archetypeMap);
    // Append automated evidence collection steps from vendor playbook
    const automatedCollection = deriveAutomatedCollectionSteps(
      vendorCapabilities, gap.requirement_id, gap.missing_evidence_archetypes || [], archetypeMap,
    );
    const whatToDoWithEvidence = [
      ...whatToDo, ...deliverableGuidance, ...evidenceGuidance, ...automatedCollection,
    ];

    const howToVerify = verification.steps.length > 0
      ? verification.steps
      : buildFallbackHowToVerify(gap, requirement);

    // Derive canonical task type from matching patterns → drives LOE rate lookup
    const matchingPatterns: PatternEntry[] = (vendorCapabilities?.patterns?.patterns || []).filter(
      (p: any) => p.practice_id === gap.requirement_id,
    );
    const taskType = deriveDominantActionType(matchingPatterns, gap);
    const effortBreakdown = estimateEffortBreakdown(taskType, gap.severity, inScopeUsers);

    const task: Task = {
      task_id: taskId,
      requirement_id: gap.requirement_id,
      task_type: taskType,
      title,
      description,
      actions: impl.actions,
      what_to_do: whatToDoWithEvidence,
      how_to_verify: howToVerify,
      expected_artifacts: evidence.artifacts,
      vendor_help_refs: impl.vendor_refs,
      control_coverage: [{
        control_id: gap.requirement_id,
        support_type: impl.support_type || 'Configurable',
        gap_rationale: gap.gap_reason,
      }],
      dependencies: impl.dependencies || [],
      priority: severityToPriority(gap.severity),
      owner_role: impl.owner_role || 'compliance_engineer',
      estimated_effort_hours: effortBreakdown.one_time_config_manual,
      effort_estimate: effortBreakdown,
      gap_classifications: gap.gap_classifications,
      impl_engine: impl.engine,
      impl_command: impl.command,
      impl_args: impl.args,
      requirement_title: gap.requirement_title,
      requirement_text: gap.requirement_text,
      domain: gap.domain,
      level: gap.level,
      nist_reference: gap.nist_reference,
    };

    // Structured tech ref enrichment
    if (techRefIndex) {
      task.tech_ref = buildStructuredTechRef(
        gap.requirement_id, techRefIndex, evidenceMatrix, archetypeMap,
      );
    }

    // BTC gate failure enrichment — boost priority and add re-verification criteria
    const gateFailure = failedGateDomains.get(gap.domain.toUpperCase());
    if (gateFailure) {
      task.btc_gate_context = {
        gate_id: gateFailure.sectionId,
        failure_reason: gateFailure.reason,
      };
      task.priority = boostPriority(task.priority);
      task.what_to_do = [
        `[BTC Gate Failure] ${gateFailure.reason} — re-verification required`,
        ...task.what_to_do,
      ];
      task.how_to_verify = [
        ...task.how_to_verify,
        `[BTC Re-Verification] Confirm remediation addresses: ${gateFailure.reason}`,
      ];

      // Item 6: BTC Decision Log → Task Rationale
      if (btcConfirmation?.btc_confirmation?.decision_log) {
        const domainUpper = gap.domain.toUpperCase();
        const matchingDecisions = btcConfirmation.btc_confirmation.decision_log.filter(
          (entry) =>
            entry.rule_id.toUpperCase().includes(domainUpper) ||
            entry.description.toUpperCase().includes(domainUpper),
        );
        for (const decision of matchingDecisions) {
          task.what_to_do.push(
            `[BTC Decision] ${decision.rule_id}: ${decision.description} — result: ${decision.result}`,
          );
        }
      }
    }

    // TCP enrichment — inject tenant-specific context into steps
    if (tenantConfig?.tenant_config) {
      enrichTaskWithTCP(task, tenantConfig.tenant_config);
    }

    // M365 alternative enrichment — infrastructure-model-aware guidance
    const m365Alt = m365Alternatives.get(gap.requirement_id);
    if (m365Alt) {
      enrichWithM365Alternative(task, m365Alt);
    }

    tasks.push(task);
  }

  // Item 5: BTC Risk Flags → Remediation Tasks
  if (btcConfirmation?.btc_confirmation?.risk_flags) {
    for (const flag of btcConfirmation.btc_confirmation.risk_flags) {
      if (flag.severity !== 'critical' && flag.severity !== 'high') continue;

      const riskTaskId = generateId(`task_BTC_RISK_${flag.flag_id}`);
      const riskPriority: Priority = flag.severity === 'critical' ? 'p0' : 'p1';
      const riskEffort = estimateEffortBreakdown('assessment', riskPriority === 'p0' ? 'HIGH' : 'MEDIUM', inScopeUsers);

      tasks.push({
        task_id: riskTaskId,
        requirement_id: `BTC_RISK_${flag.flag_id}`,
        task_type: 'assessment',
        title: `Remediate BTC risk: ${flag.description}`,
        description: `BTC risk flag ${flag.flag_id} (${flag.severity}) in ${flag.domain} domain requires remediation. Source rule: ${flag.source_rule_id}.`,
        actions: [],
        what_to_do: [
          `[BTC Risk Remediation] ${flag.description}`,
          `Domain: ${flag.domain}`,
          `Source rule: ${flag.source_rule_id}`,
          'Address the identified risk and collect remediation evidence.',
        ],
        how_to_verify: [
          `Re-run BTC verification and confirm flag ${flag.flag_id} no longer triggers`,
          `Verify remediation addresses: ${flag.description}`,
        ],
        expected_artifacts: [
          {
            artifact_id: generateId('ev'),
            artifact_type: 'attestation',
            description: `Remediation attestation for BTC risk ${flag.flag_id}: ${flag.description}`,
            collector: 'evidence_ops',
            retention_days: 365,
            storage_location_ref: 'evidence_store',
          },
        ],
        vendor_help_refs: [],
        control_coverage: [],
        dependencies: [],
        priority: riskPriority,
        owner_role: 'compliance_engineer',
        estimated_effort_hours: riskEffort.one_time_config_manual,
        effort_estimate: riskEffort,
        gap_classifications: ['manual'],
        requirement_title: `BTC Risk: ${flag.description}`,
        requirement_text: flag.description,
        domain: flag.domain,
        level: '',
        nist_reference: '',
      });
    }
  }

  // Populate task_ids on control dispositions
  if (controlDispositions) {
    for (const task of tasks) {
      // Skip BTC synthetic tasks (task.requirement_id starts with 'BTC_')
      if (task.requirement_id.startsWith('BTC_')) continue;

      const disposition = controlDispositions.find(d => d.requirement_id === task.requirement_id);
      if (disposition) {
        disposition.task_ids.push(task.task_id);
        disposition.estimated_effort_hours += task.estimated_effort_hours;
      }
    }
  }

  resolveTaskDependencies(tasks);
  return { tasks, controlDispositions };
}

// ---------------------------------------------------------------------------
// TCP (Tenant Configuration Profile) enrichment
// ---------------------------------------------------------------------------
function enrichTaskWithTCP(
  task: Task,
  tc: TenantConfigProfileOutput['tenant_config'],
): void {
  const reqId = task.requirement_id;
  const tcpContext: string[] = [];
  const tcpVerify: string[] = [];

  // AC.L2-3.1.1 — Conditional Access
  if (reqId === 'AC.L2-3.1.1') {
    tcpContext.push(`[TCP Context] CA naming convention: ${tc.conditional_access.ca_naming_convention}`);
    tcpContext.push(`[TCP Context] Named locations: ${tc.conditional_access.named_locations.map((l) => l.name).join(', ') || 'none defined'}`);
    tcpContext.push(`[TCP Context] Existing CA policies: ${tc.conditional_access.existing_policy_count} (drift baseline)`);
    tcpContext.push(`[TCP Context] Break-glass exclusion group: ${tc.privileged_access.break_glass_exclusion_group}`);
    tcpVerify.push(`[TCP Verification] Verify all CA policies follow naming convention: ${tc.conditional_access.ca_naming_convention}`);
    tcpVerify.push(`[TCP Verification] Confirm break-glass exclusion group "${tc.privileged_access.break_glass_exclusion_group}" is excluded from all blocking policies`);
  }

  // AC.L2-3.1.2 — Group Architecture
  if (reqId === 'AC.L2-3.1.2') {
    tcpContext.push(`[TCP Context] Security group naming: ${tc.group_architecture.security_group_convention}`);
    tcpContext.push(`[TCP Context] Distribution group naming: ${tc.group_architecture.distribution_group_convention}`);
    tcpContext.push(`[TCP Context] Group strategy: ${tc.group_architecture.group_strategy}`);
    const keyGroupList = Object.entries(tc.group_architecture.key_groups)
      .map(([name, role]) => `${name} (${role})`)
      .join(', ');
    if (keyGroupList) tcpContext.push(`[TCP Context] Key groups: ${keyGroupList}`);
    tcpVerify.push(`[TCP Verification] Verify security groups follow convention: ${tc.group_architecture.security_group_convention}`);
  }

  // AC.L2-3.1.5 — Privileged Access
  if (reqId === 'AC.L2-3.1.5') {
    tcpContext.push(`[TCP Context] PIM: ${tc.privileged_access.pim_enabled ? 'enabled' : 'not enabled'}`);
    tcpContext.push(`[TCP Context] Global admins: ${tc.privileged_access.global_admins.join(', ')}`);
    tcpContext.push(`[TCP Context] Security admins: ${tc.privileged_access.security_admins.join(', ') || 'none'}`);
    tcpContext.push(`[TCP Context] Compliance admins: ${tc.privileged_access.compliance_admins.join(', ') || 'none'}`);
    tcpContext.push(`[TCP Context] Service account naming: ${tc.identity_architecture.service_account_naming_convention}`);
    tcpVerify.push(`[TCP Verification] Confirm PIM is ${tc.privileged_access.pim_enabled ? 'enabled for all privileged roles' : 'evaluated for enablement'}`);
    tcpVerify.push(`[TCP Verification] Verify admin accounts match TCP roster (${tc.privileged_access.global_admins.length} global, ${tc.privileged_access.security_admins.length} security, ${tc.privileged_access.compliance_admins.length} compliance)`);
  }

  // AC.L2-3.1.18 / AC.L2-3.1.19 — Device Management
  if (reqId === 'AC.L2-3.1.18' || reqId === 'AC.L2-3.1.19') {
    tcpContext.push(`[TCP Context] Enrollment type: ${tc.device_management.enrollment_type}`);
    tcpContext.push(`[TCP Context] Device naming: ${tc.device_management.device_naming_convention}`);
    tcpContext.push(`[TCP Context] Compliance policy naming: ${tc.device_management.compliance_policy_convention}`);
    tcpContext.push(`[TCP Context] Platforms in scope: ${tc.device_management.platforms_in_scope.join(', ')}`);
    tcpVerify.push(`[TCP Verification] Verify device compliance policies follow naming: ${tc.device_management.compliance_policy_convention}`);
    tcpVerify.push(`[TCP Verification] Confirm enrollment covers all platforms: ${tc.device_management.platforms_in_scope.join(', ')}`);
  }

  // IA.L2-3.5.x — Identity Architecture
  if (reqId.startsWith('IA.L2-3.5')) {
    tcpContext.push(`[TCP Context] Identity provider: ${tc.identity_architecture.identity_provider}`);
    tcpContext.push(`[TCP Context] Directory sync: ${tc.identity_architecture.directory_sync_enabled ? 'enabled' : 'disabled'}`);
    tcpContext.push(`[TCP Context] Admin naming convention: ${tc.identity_architecture.admin_naming_convention}`);
    tcpVerify.push(`[TCP Verification] Verify identity provider configuration matches: ${tc.identity_architecture.identity_provider}`);
    tcpVerify.push(`[TCP Verification] Confirm admin accounts follow naming: ${tc.identity_architecture.admin_naming_convention}`);
  }

  // SC.L2-3.13.x — Data Protection
  if (reqId.startsWith('SC.L2-3.13')) {
    tcpContext.push(`[TCP Context] Sensitivity label convention: ${tc.data_protection.sensitivity_label_convention}`);
    tcpContext.push(`[TCP Context] DLP policy convention: ${tc.data_protection.dlp_policy_convention}`);
    if (tc.data_protection.cui_sharepoint_sites.length > 0) {
      tcpContext.push(`[TCP Context] CUI SharePoint sites: ${tc.data_protection.cui_sharepoint_sites.join(', ')}`);
    }
    if (tc.data_protection.cui_teams_channels.length > 0) {
      tcpContext.push(`[TCP Context] CUI Teams channels: ${tc.data_protection.cui_teams_channels.join(', ')}`);
    }
    tcpVerify.push(`[TCP Verification] Verify sensitivity labels follow convention: ${tc.data_protection.sensitivity_label_convention}`);
    tcpVerify.push(`[TCP Verification] Verify DLP policies follow convention: ${tc.data_protection.dlp_policy_convention}`);
  }

  // AU.L2-3.3.x — Audit / Monitoring
  if (reqId.startsWith('AU.L2-3.3')) {
    tcpContext.push(`[TCP Context] Sentinel workspace: ${tc.monitoring.sentinel_workspace_name}`);
    tcpContext.push(`[TCP Context] Log Analytics workspace: ${tc.monitoring.log_analytics_workspace_id}`);
    if (tc.monitoring.data_connectors.length > 0) {
      tcpContext.push(`[TCP Context] Required data connectors: ${tc.monitoring.data_connectors.join(', ')}`);
    } else if (isSentinelConnectorGap(tc)) {
      tcpContext.push(`[TCP Remediation] G5/E5 license with Sentinel activated but no data connectors reported`);
      tcpContext.push(`[TCP Remediation] Recommended connectors to enable: ${G5_RECOMMENDED_SENTINEL_CONNECTORS.join(', ')}`);
      tcpContext.push(`[TCP Remediation] Target workspace: ${tc.monitoring.sentinel_workspace_name} (RG: ${tc.monitoring.sentinel_resource_group})`);
    }
    tcpContext.push(`[TCP Context] Alert rule convention: ${tc.monitoring.alert_rule_convention}`);
    tcpVerify.push(`[TCP Verification] Verify Sentinel workspace "${tc.monitoring.sentinel_workspace_name}" is operational`);
    tcpVerify.push(
      tc.monitoring.data_connectors.length > 0
        ? `[TCP Verification] Confirm all data connectors active: ${tc.monitoring.data_connectors.join(', ')}`
        : `[TCP Verification] Confirm recommended data connectors active: ${G5_RECOMMENDED_SENTINEL_CONNECTORS.join(', ')}`,
    );
  }

  // Inject: prepend TCP context to what_to_do, append TCP verification to how_to_verify
  if (tcpContext.length > 0) {
    task.what_to_do = [...tcpContext, ...task.what_to_do];
  }
  if (tcpVerify.length > 0) {
    task.how_to_verify = [...task.how_to_verify, ...tcpVerify];
  }
}

// ---------------------------------------------------------------------------
// M365 Alternative enrichment
// ---------------------------------------------------------------------------
function enrichWithM365Alternative(task: Task, alt: AlternativeImplementation): void {
  task.what_to_do = [
    `[Gap Severity: ${alt.gap_severity}] This control uses an M365-native alternative implementation`,
    `[Azure Approach Replaced] ${alt.azure_approach}`,
    `[M365 Alternative] ${alt.m365_alternative}`,
    ...task.what_to_do,
  ];
  task.description += ` [M365-native alternative; gap severity: ${alt.gap_severity}]`;
}

// ---------------------------------------------------------------------------
// Vendor implementation lookup
// ---------------------------------------------------------------------------
interface ImplPath {
  title: string;
  description: string;
  steps: string[];
  actions: StepAction[];
  vendor_refs: VendorHelpRef[];
  dependencies: string[];
  support_type: ControlCoverage['support_type'];
  owner_role: string;
  engine?: ActionEngine;
  command?: string;
  args?: Record<string, unknown>;
}

function selectVendorImplementation(vendorCaps: any, requirementId: string, siBaseline: SIBaseline, techRefIndex?: TechRefIndex): ImplPath {
  // --- Try enriched data (patterns + playbook) first ---
  const patterns: PatternEntry[] = vendorCaps?.patterns?.patterns || [];
  const playbook: PlaybookEntry[] = vendorCaps?.playbook?.playbook || [];

  const matchingPatterns = patterns.filter((p) => p.practice_id === requirementId);

  if (matchingPatterns.length > 0) {
    return buildEnrichedImplPath(matchingPatterns, playbook, requirementId, techRefIndex);
  }

  // --- Legacy capability-matching fallback ---
  const caps: any[] = vendorCaps?.capabilities || vendorCaps?.ces?.capabilities || [];
  const match = caps.find((c: any) =>
    c.requirement_id === requirementId || c.control_ids?.includes(requirementId)
  );

  if (match) {
    return {
      title: match.title || match.name || `Configure ${requirementId}`,
      description: match.description || '',
      steps: match.implementation_steps || match.steps || [],
      actions: [],
      vendor_refs: (match.references || []).map((r: any) => ({
        vendor: r.vendor || match.vendor || 'Unknown',
        product: r.product || match.product || 'Unknown',
        title: r.title || r.name || 'Vendor documentation',
        url: r.url,
        path_hint: r.path_hint,
      })),
      dependencies: match.dependencies || [],
      support_type: match.support_type || 'Configurable',
      owner_role: match.owner_role || 'compliance_engineer',
      engine: match.engine,
      command: match.command,
      args: match.args,
    };
  }

  // --- Generic fallback ---
  const level = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';
  return {
    title: `Implement ${requirementId}`,
    description: `Implement and configure controls for ${requirementId} at CMMC ${level}`,
    steps: [
      `Review requirement ${requirementId} against current environment`,
      `Configure or deploy controls to satisfy ${requirementId}`,
      `Document implementation details and rationale`,
    ],
    actions: [],
    vendor_refs: [],
    dependencies: [],
    support_type: 'Configurable',
    owner_role: 'compliance_engineer',
  };
}

function buildEnrichedImplPath(
  matchingPatterns: PatternEntry[],
  playbook: PlaybookEntry[],
  requirementId: string,
  techRefIndex?: TechRefIndex,
): ImplPath {
  const steps: string[] = [];
  const actions: StepAction[] = [];
  const vendorRefs: VendorHelpRef[] = [];
  const psCommands: string[] = [];
  let firstPsCommand: string | undefined;
  const seenRefs = new Set<string>();

  for (const pattern of matchingPatterns) {
    for (const action of pattern.actions) {
      // Build structured StepAction (first-class leaf node)
      const stepAction: StepAction = {
        action_id: action.id,
        action: action.action,
        action_type: action.action_type,
        evidence_outputs: [...action.evidence_outputs],
      };

      // Look up playbook entry for this action
      const pbEntry = playbook.find((p) => p.action_id === action.id);
      if (pbEntry) {
        // Enrich with vendor-specific data
        stepAction.vendor = {
          m365_service: pbEntry.m365_service,
          implementation: pbEntry.implementation,
          portal_path: pbEntry.portal_path,
          powershell: pbEntry.powershell ? [...pbEntry.powershell] : undefined,
          evidence_commands: pbEntry.evidence_commands?.length ? [...pbEntry.evidence_commands] : undefined,
          notes: pbEntry.notes,
        };

        // Enrich action with tech ref guidance for this service
        if (techRefIndex) {
          const guidance = techRefIndex.getGuidance(requirementId, pbEntry.m365_service);
          if (guidance) {
            stepAction.vendor.tech_ref_guidance = guidance.paragraphs
              .map((p) => p.text_with_links)
              .filter((t) => t.length > 0);
          }
        }

        // Legacy flat steps for what_to_do supplemental guidance
        steps.push(`  → M365: ${pbEntry.implementation}`);
        if (pbEntry.portal_path) {
          steps.push(`  → Portal: ${pbEntry.portal_path}`);
        }

        // Collect PowerShell commands
        if (pbEntry.powershell) {
          for (const cmd of pbEntry.powershell) {
            psCommands.push(cmd);
            if (!firstPsCommand && !cmd.startsWith('Connect-') && !cmd.startsWith('#')) {
              firstPsCommand = cmd;
            }
          }
        }

        // Build vendor_help_refs (deduplicate by service+portal)
        const refKey = `${pbEntry.m365_service}|${pbEntry.portal_path || ''}`;
        if (!seenRefs.has(refKey)) {
          seenRefs.add(refKey);
          vendorRefs.push({
            vendor: 'Microsoft',
            product: pbEntry.m365_service,
            title: pattern.pattern_name,
            path_hint: pbEntry.portal_path,
          });
        }
      }

      actions.push(stepAction);
    }
  }

  // Enrich vendor_help_refs with doc URLs from tech ref
  if (techRefIndex) {
    const control = techRefIndex.getControl(requirementId);
    if (control) {
      for (const section of control.implementation_by_service) {
        for (const para of section.paragraphs) {
          for (const link of para.links) {
            const refKey = `techref|${link.url}`;
            if (!seenRefs.has(refKey)) {
              seenRefs.add(refKey);
              vendorRefs.push({
                vendor: 'Microsoft',
                product: section.service_name,
                title: link.text,
                url: link.url,
              });
            }
          }
        }
      }
    }
  }

  const patternName = matchingPatterns[0].pattern_name;
  const hasPs = psCommands.length > 0;

  return {
    title: `${patternName} (${requirementId})`,
    description: `Implement ${patternName} for ${requirementId} using M365 stack`,
    steps,
    actions,
    vendor_refs: vendorRefs,
    dependencies: [],
    support_type: 'Configurable',
    owner_role: 'compliance_engineer',
    engine: hasPs ? 'powershell' : undefined,
    command: firstPsCommand,
    args: hasPs ? { requirement_id: requirementId, powershell_commands: psCommands } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Assessor verification + evidence derivation
// ---------------------------------------------------------------------------
function deriveVerification(assessorKB: any, requirementId: string, _impl: ImplPath): { steps: string[] } {
  const entries: any[] = assessorKB?.ces?.approaches || assessorKB?.approaches || [];
  const match = entries.find((e: any) => e.requirement_id === requirementId);

  if (match?.verification_steps) {
    return { steps: match.verification_steps };
  }

  return {
    steps: [
      `Examine documentation and configuration exports for ${requirementId}`,
      `Interview responsible personnel to confirm implementation`,
      `Test control effectiveness against expected behavior`,
    ],
  };
}

function deriveExpectedArtifacts(
  assessorKB: any,
  requirementId: string,
  _impl: ImplPath,
  gap?: Gap,
  archetypeMap?: Map<string, any>,
): { artifacts: EvidenceArtifact[] } {
  const entries: any[] = assessorKB?.ces?.evidence_requirements || assessorKB?.evidence_requirements || [];
  const match = entries.find((e: any) => e.requirement_id === requirementId);

  if (match?.artifacts && Array.isArray(match.artifacts)) {
    return {
      artifacts: match.artifacts.map((a: any) => ({
        artifact_id: a.artifact_id || generateId('ev'),
        artifact_type: a.artifact_type || 'config_export',
        description: a.description || `Evidence for ${requirementId}`,
        collector: a.collector || 'evidence_ops',
        retention_days: a.retention_days ?? 365,
        storage_location_ref: a.storage_location_ref || 'evidence_store',
      })),
    };
  }

  // Use gap's missing_evidence_archetypes enriched by archetype catalog
  const archetypeIds = gap?.missing_evidence_archetypes || [];
  if (archetypeIds.length > 0 && archetypeMap && archetypeMap.size > 0) {
    const artifacts: EvidenceArtifact[] = archetypeIds.map((archId) => {
      const archetype = archetypeMap.get(archId.toLowerCase());
      const name = archetype?.name || archId;
      const desc = archetype?.description || '';
      const domain = archetype?.domain || '';
      return {
        artifact_id: generateId('ev'),
        artifact_type: domainToArtifactType(domain),
        description: desc
          ? `${name}: ${desc} (${requirementId})`
          : `${name} — evidence for ${requirementId}`,
        collector: 'evidence_ops',
        retention_days: 365,
        storage_location_ref: 'evidence_store',
      };
    });
    return { artifacts };
  }

  // Fallback: generate default evidence artifact
  return {
    artifacts: [{
      artifact_id: generateId('ev'),
      artifact_type: 'config_export',
      description: `Configuration export demonstrating ${requirementId} compliance`,
      collector: 'evidence_ops',
      retention_days: 365,
      storage_location_ref: 'evidence_store',
    }],
  };
}

function deriveEvidenceCollectionGuidance(gap: Gap, archetypeMap: Map<string, any>): string[] {
  const archetypeIds = gap.missing_evidence_archetypes || [];
  if (archetypeIds.length === 0 || archetypeMap.size === 0) return [];

  const steps: string[] = [];
  for (const archId of archetypeIds) {
    const arch = archetypeMap.get(archId.toLowerCase());
    if (!arch) continue;

    const name = arch.name || archId;
    const forms: string[] = arch.acceptable_forms_examples || [];
    const methods: string[] = arch.assessor_methods_expected || [];
    const collectionNotes: string = arch.collection_notes || '';
    const retentionNotes: string = arch.retention_notes_template || '';

    let step = `[Evidence] Collect "${name}"`;
    if (forms.length > 0) {
      step += ` — acceptable forms: ${forms.join(', ')}`;
    }
    if (methods.length > 0) {
      step += ` [assessor methods: ${methods.join(', ')}]`;
    }
    steps.push(step);

    if (collectionNotes) {
      steps.push(`  → Collection guidance: ${collectionNotes}`);
    }
    if (retentionNotes) {
      steps.push(`  → Retention: ${retentionNotes}`);
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Automated evidence collection — vendor-specific commands + cadence
// ---------------------------------------------------------------------------
function deriveAutomatedCollectionSteps(
  vendorCaps: any,
  requirementId: string,
  missingArchetypeIds: string[],
  archetypeMap: Map<string, any>,
): string[] {
  const patterns: PatternEntry[] = vendorCaps?.patterns?.patterns || [];
  const playbook: PlaybookEntry[] = vendorCaps?.playbook?.playbook || [];

  const matchingPatterns = patterns.filter((p) => p.practice_id === requirementId);
  if (matchingPatterns.length === 0 && missingArchetypeIds.length === 0) return [];

  const steps: string[] = [];
  const coveredOutputs = new Set<string>();

  // Walk matched patterns → actions → playbook entries with evidence_commands
  for (const pattern of matchingPatterns) {
    for (const action of pattern.actions) {
      const pbEntry = playbook.find((p) => p.action_id === action.id);
      if (!pbEntry?.evidence_commands || pbEntry.evidence_commands.length === 0) continue;

      const cadence = inferCollectionCadence(action.action_type, pbEntry.m365_service);
      const outputs = action.evidence_outputs || [];

      steps.push(`[Automated Evidence Collection] Service: ${pbEntry.m365_service}`);
      steps.push(`  Cadence: ${cadence}`);

      for (const cmd of pbEntry.evidence_commands) {
        if (cmd.startsWith('#')) continue; // skip comments
        steps.push(`  Command: ${cmd}`);
      }

      if (outputs.length > 0) {
        steps.push(`  Produces: ${outputs.join(', ')}`);
        for (const out of outputs) coveredOutputs.add(out.toLowerCase());
      }

      if (pbEntry.portal_path) {
        steps.push(`  Manual verification: ${pbEntry.portal_path}`);
      }

      if (pbEntry.notes) {
        steps.push(`  Note: ${pbEntry.notes}`);
      }
    }
  }

  // For archetypes not covered by vendor commands, suggest an approach
  for (const archId of missingArchetypeIds) {
    const arch = archetypeMap.get(archId.toLowerCase());
    if (!arch) continue;

    // Check if already covered by a vendor evidence_output
    const archName = (arch.name || archId).toLowerCase();
    if (coveredOutputs.has(archName)) continue;

    const name = arch.name || archId;
    const domain = (arch.domain || '').toUpperCase();
    const suggestion = suggestCollectionApproach(domain, name, arch);
    steps.push(`[Evidence Collection — No Vendor Automation] "${name}"`);
    steps.push(`  Suggested approach: ${suggestion.method}`);
    steps.push(`  Cadence: ${suggestion.cadence}`);
    if (suggestion.tooling) {
      steps.push(`  Tooling: ${suggestion.tooling}`);
    }
  }

  return steps;
}

function inferCollectionCadence(actionType: string, service: string): string {
  const svc = service.toLowerCase();
  // Log and audit data needs frequent collection
  if (svc.includes('sentinel') || svc.includes('audit') || svc.includes('log')) {
    return 'Weekly export (daily for high-security environments)';
  }
  // Vulnerability data
  if (svc.includes('defender') && svc.includes('vulnerability')) {
    return 'Weekly scan + on-demand after changes';
  }
  // Configuration evidence — monthly + on change
  switch (actionType) {
    case 'policy':
      return 'On policy change + quarterly review';
    case 'configuration':
      return 'Monthly export + on configuration change';
    case 'monitoring':
      return 'Weekly export of monitoring status and alerts';
    case 'process':
      return 'Per occurrence + quarterly summary';
    case 'training':
      return 'Per training event + annual compliance report';
    case 'assessment':
      return 'Per assessment cycle (annual minimum)';
    default:
      return 'Monthly export + on change';
  }
}

interface CollectionSuggestion {
  method: string;
  cadence: string;
  tooling?: string;
}

function suggestCollectionApproach(domain: string, _name: string, archetype: any): CollectionSuggestion {
  const forms: string[] = archetype?.acceptable_forms_examples || [];
  const formsHint = forms.length > 0 ? ` Acceptable forms: ${forms.slice(0, 3).join(', ')}.` : '';

  switch (domain) {
    case 'BOUNDARY':
    case 'DATAFLOW':
      return {
        method: `Export network topology/flow diagrams from firewall or cloud console.${formsHint}`,
        cadence: 'Quarterly + after network changes',
        tooling: 'Azure Network Watcher, firewall management console, or Visio/draw.io for diagrams',
      };
    case 'IAM':
      return {
        method: `Export identity and access reports from directory service.${formsHint}`,
        cadence: 'Monthly + on access change',
        tooling: 'Microsoft Graph API: Get-MgUser, Get-MgGroup, Get-MgRoleManagementDirectoryRoleAssignment',
      };
    case 'ENDPOINT':
      return {
        method: `Export endpoint compliance and health reports.${formsHint}`,
        cadence: 'Weekly health check + monthly compliance report',
        tooling: 'Intune compliance reports, Defender for Endpoint device inventory API',
      };
    case 'CONFIG':
      return {
        method: `Export configuration baselines and compliance status.${formsHint}`,
        cadence: 'Monthly + on configuration change',
        tooling: 'Intune configuration profiles export, Azure Policy compliance API',
      };
    case 'LOG':
      return {
        method: `Export audit and security logs covering the review period.${formsHint}`,
        cadence: 'Weekly export (minimum); daily for security-critical logs',
        tooling: 'Microsoft Sentinel workspace queries, Unified Audit Log search, or SIEM export',
      };
    case 'VULN':
      return {
        method: `Run vulnerability scans and export findings report.${formsHint}`,
        cadence: 'Weekly scan + on-demand after deployments',
        tooling: 'Defender Vulnerability Management API, or third-party scanner (Tenable, Qualys)',
      };
    case 'RISK':
      return {
        method: `Document risk assessment and acceptance decisions.${formsHint}`,
        cadence: 'Per risk decision + annual reassessment',
        tooling: 'GRC platform or structured risk register (spreadsheet minimum)',
      };
    case 'IR':
      return {
        method: `Maintain incident response plan and exercise records.${formsHint}`,
        cadence: 'Plan review: annual. Exercise records: per exercise. IR logs: per incident',
        tooling: 'Ticketing system (ServiceNow, Jira), IR playbook repository',
      };
    case 'MEDIA':
      return {
        method: `Document media protection policies and sanitization records.${formsHint}`,
        cadence: 'Policy review: annual. Sanitization records: per event',
        tooling: 'Asset management system, media tracking log',
      };
    case 'SUPPLIER':
      return {
        method: `Maintain supplier risk assessments and contract security requirements.${formsHint}`,
        cadence: 'Per supplier onboarding + annual review',
        tooling: 'Vendor management platform or structured assessment templates',
      };
    case 'TRAINING':
      return {
        method: `Export training completion records for in-scope personnel.${formsHint}`,
        cadence: 'Per training event + annual compliance summary',
        tooling: 'LMS export (Viva Learning, KnowBe4, or equivalent)',
      };
    case 'DEVOPS':
      return {
        method: `Export CI/CD pipeline configurations and change records.${formsHint}`,
        cadence: 'Monthly + on pipeline change',
        tooling: 'Azure DevOps API, GitHub Actions workflow exports',
      };
    default:
      return {
        method: `Collect and export evidence artifacts per assessor requirements.${formsHint}`,
        cadence: 'Monthly + on change',
      };
  }
}

function buildArchetypeMap(catalog: any): Map<string, any> {
  const map = new Map<string, any>();
  const entries: any[] = catalog?.evidence_archetypes || catalog?.archetypes || [];
  for (const entry of entries) {
    if (entry.archetype_id) {
      map.set(entry.archetype_id.toLowerCase(), entry);
    }
  }
  return map;
}

function domainToArtifactType(domain: string): ArtifactType {
  const upper = (domain || '').toUpperCase();
  switch (upper) {
    case 'BOUNDARY': return 'diagram';
    case 'DATAFLOW': return 'diagram';
    case 'IAM': return 'config_export';
    case 'ENDPOINT': return 'config_export';
    case 'CONFIG': return 'config_export';
    case 'LOG': return 'log_export';
    case 'VULN': return 'scan_report';
    case 'RISK': return 'attestation';
    case 'IR': return 'procedure';
    case 'MEDIA': return 'policy';
    case 'SUPPLIER': return 'policy';
    case 'TRAINING': return 'training_record';
    case 'DEVOPS': return 'config_export';
    default: return 'config_export';
  }
}

// ---------------------------------------------------------------------------
// CMMC-enriched fallback content builders
// ---------------------------------------------------------------------------
function buildFallbackWhatToDo(gap: Gap, _requirement: any): string[] {
  const steps: string[] = [];
  if (gap.operationalization_notes) {
    steps.push(gap.operationalization_notes);
  }
  for (const dfa of gap.design_for_assessment) {
    steps.push(`${dfa.title}: ${dfa.constraint}`);
  }
  if (steps.length === 0) {
    steps.push(`Implement controls for ${gap.requirement_title} (${gap.requirement_id})`);
  }
  return steps;
}

function buildFallbackHowToVerify(gap: Gap, _requirement: any): string[] {
  const steps: string[] = [];
  for (const ao of gap.assessment_objectives) {
    const methods = ao.methods.length > 0 ? ` [${ao.methods.join(', ')}]` : '';
    steps.push(`${ao.text}${methods}`);
  }
  for (const dfa of gap.design_for_assessment) {
    if (dfa.verification) {
      steps.push(`Verify: ${dfa.verification}`);
    }
  }
  if (steps.length === 0) {
    steps.push(`Verify implementation of ${gap.requirement_title} (${gap.requirement_id})`);
  }
  return steps;
}

// ---------------------------------------------------------------------------
// CMMC supplemental guidance — always appended to vendor steps so
// non-technical domains (PE, PS, MA, etc.) get assessor-ready detail
// ---------------------------------------------------------------------------
function buildCMMCSupplementalGuidance(gap: Gap): string[] {
  const steps: string[] = [];
  if (gap.operationalization_notes) {
    steps.push(`[CMMC Guidance] ${gap.operationalization_notes}`);
  }
  for (const dfa of gap.design_for_assessment) {
    steps.push(`[Assessment Design] ${dfa.title}: ${dfa.constraint}`);
  }
  if (gap.common_pitfalls) {
    for (const pitfall of gap.common_pitfalls) {
      steps.push(`[Common Pitfall] ${pitfall}`);
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Structured tech ref — replaces flat strings with typed data per task
// ---------------------------------------------------------------------------
function buildStructuredTechRef(
  requirementId: string,
  techRefIndex: TechRefIndex,
  evidenceMatrix: any,
  archetypeMap: Map<string, any>,
): Task['tech_ref'] {
  const control = techRefIndex.getControl(requirementId);
  if (!control) return undefined;

  // NIST mapping
  const nistParts: string[] = [];
  if ((control as any).nist_sp_800_171_ref) {
    nistParts.push(`800-171: ${(control as any).nist_sp_800_171_ref}`);
  }
  if ((control as any).nist_sp_800_53_mapping) {
    nistParts.push(`800-53: ${(control as any).nist_sp_800_53_mapping}`);
  }
  const nist_mapping = nistParts.join(' | ') || requirementId;

  // Assessment objectives
  const assessment_objectives: Array<{ id: string; text: string }> = (
    (control as any).assessment_objectives || []
  ).map((ao: any) => ({ id: ao.id || '', text: ao.text || '' }));

  // Implementation by service (all services, not capped)
  const implementation_by_service = (control.implementation_by_service || []).map(
    (section: any) => ({
      service_name: section.service_name,
      paragraphs: (section.paragraphs || []).map((p: any) => ({
        text: p.text || '',
        text_with_links: p.text_with_links || p.text || '',
        links: (p.links || []).map((l: any) => ({ text: l.text || '', url: l.url || '' })),
      })),
    }),
  );

  // GCC High customer responsibilities
  const gcchRaw = techRefIndex.getGcchResponsibilities(requirementId);
  const gcch_responsibilities: Array<{ text: string; text_with_links: string }> = (
    gcchRaw || []
  ).map((p: any) => ({
    text: p.text || '',
    text_with_links: p.text_with_links || p.text || '',
  }));

  // Evidence guidance from evidence matrix
  let evidence_guidance: NonNullable<Task['tech_ref']>['evidence_guidance'] = undefined;
  const emxMappings: any[] = evidenceMatrix?.ces?.mappings || [];
  const emxEntry = emxMappings.find((m: any) => m.practice_id === requirementId);
  if (emxEntry) {
    const assessor_methods: string[] = emxEntry.assessor_methods || [];
    const anti_patterns: string[] = emxEntry.anti_patterns || [];

    const archetypes: Array<{
      archetype_id: string;
      name: string;
      strength: string;
      strength_examples: Array<{ strength: string; description: string }>;
    }> = [];

    if (emxEntry.evidence) {
      const byArchetype = new Map<string, any[]>();
      for (const ev of emxEntry.evidence) {
        const emxId = ev.emx_id;
        if (!emxId) continue;
        if (!byArchetype.has(emxId)) byArchetype.set(emxId, []);
        byArchetype.get(emxId)!.push(ev);
      }

      const strengthOrder: Record<string, number> = { strong: 0, adequate: 1, weak: 2 };

      for (const [emxId, entries] of byArchetype) {
        const archetype = archetypeMap.get(emxId.toLowerCase());
        const strength_examples = entries
          .map((ev: any) => ({
            strength: ev.strength || 'adequate',
            description: ev.description || '',
          }))
          .sort(
            (a: any, b: any) =>
              (strengthOrder[a.strength] ?? 9) - (strengthOrder[b.strength] ?? 9),
          );

        archetypes.push({
          archetype_id: emxId,
          name: archetype?.name || emxId,
          strength: entries[0]?.strength || 'adequate',
          strength_examples,
        });
      }
    }

    evidence_guidance = { assessor_methods, archetypes, anti_patterns };
  }

  return {
    assessment_objectives,
    nist_mapping,
    implementation_by_service,
    gcch_responsibilities,
    evidence_guidance,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function severityToPriority(severity: 'HIGH' | 'MEDIUM' | 'LOW'): Priority {
  switch (severity) {
    case 'HIGH': return 'p0';
    case 'MEDIUM': return 'p1';
    case 'LOW': return 'p2';
  }
}

function boostPriority(priority: Priority): Priority {
  switch (priority) {
    case 'p1': return 'p0';
    case 'p2': return 'p1';
    default: return priority; // p0 stays p0, p3 stays p3
  }
}

// ---------------------------------------------------------------------------
// 5-category effort estimation — table lookup from persisted LOE rate card
// ---------------------------------------------------------------------------

/**
 * Classify gap as a fallback when no implementation patterns match.
 * Uses gap assessment methods to infer the canonical task type.
 */
function classifyGapFallback(gap: any): TaskType {
  if (gap.methods_needed?.includes('examine')) return 'policy';
  if (gap.methods_needed?.includes('test')) return 'configuration';
  return 'configuration';
}

/**
 * Determine the dominant canonical task type from matching pattern actions.
 * Picks the most frequent action_type; falls back to gap-based classification.
 */
function deriveDominantActionType(matchingPatterns: PatternEntry[], gap: any): TaskType {
  const counts = new Map<string, number>();
  for (const pattern of matchingPatterns) {
    for (const action of pattern.actions) {
      counts.set(action.action_type, (counts.get(action.action_type) || 0) + 1);
    }
  }
  if (counts.size === 0) return classifyGapFallback(gap);
  let best = '';
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) { best = type; bestCount = count; }
  }
  return (best as TaskType) || classifyGapFallback(gap);
}

/**
 * Compute org-size multiplier from user count.
 * Scales effort for config/evidence tasks proportionally to organization size.
 */
function computeOrgSizeMultiplier(userCount: number): number {
  if (userCount < 50) return 0.6;
  if (userCount < 200) return 0.8;
  if (userCount < 1000) return 1.0;
  if (userCount < 5000) return 1.3;
  return 1.6;
}

/**
 * Look up the LOE rate row for the given task type and apply severity
 * scaling to one-time config hours.  Dev LOE and recurring evidence hours
 * are taken as-is (severity doesn't change tooling or evidence cadence).
 *
 * When userCount is provided, applies org-size scaling to config and evidence
 * hours (but NOT dev LOE, since tooling effort doesn't scale with org size).
 * An explicit orgSizeMultiplier in the rate config takes precedence.
 */
function estimateEffortBreakdown(
  taskType: TaskType,
  severity: 'HIGH' | 'MEDIUM' | 'LOW',
  userCount?: number,
): EffortEstimate {
  const rates = getLoeRates();
  const { taskRates, severityMultipliers } = rates;
  const row = taskRates[taskType];
  const mult = severityMultipliers[severity] ?? 1.0;

  // Org-size multiplier: explicit override > auto-computed > 1.0
  const orgMult = rates.orgSizeMultiplier
    ?? (typeof userCount === 'number' && userCount > 0 ? computeOrgSizeMultiplier(userCount) : 1.0);

  return {
    one_time_dev_loe: row.one_time_dev_loe, // NOT scaled by org size
    one_time_config_manual: Math.round(row.one_time_config_manual * mult * orgMult),
    one_time_config_automated: Math.round(row.one_time_config_automated * mult * orgMult),
    recurring_evidence_manual: Math.round(row.recurring_evidence_manual * orgMult),
    recurring_evidence_automated: Math.round(row.recurring_evidence_automated * orgMult),
  };
}

function resolveTaskDependencies(tasks: Task[]): void {
  // Group by requirement — evidence tasks depend on configure/deploy tasks
  const byReq = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!byReq.has(t.requirement_id)) byReq.set(t.requirement_id, []);
    byReq.get(t.requirement_id)!.push(t);
  }
  // Cross-requirement: no automatic dependencies for now; vendor caps would drive this
}
