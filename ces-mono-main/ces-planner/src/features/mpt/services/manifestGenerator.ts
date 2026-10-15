// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, TenantManifest, CUIBoundaryOutput, BTCConfirmationOutput, TenantConfigProfileOutput } from '@/shared/types/artifacts';
import type { TaskCatalog, PlanMode, Task } from '../types';
import { generateId, generateSHA256 } from '@/shared/utils/idGenerator';

export const G5_RECOMMENDED_SENTINEL_CONNECTORS: readonly string[] = [
  'Azure Active Directory',
  'Microsoft 365',
  'Microsoft Defender for Endpoint',
  'Microsoft Defender for Office 365',
  'Microsoft Defender for Identity',
  'Azure Activity',
  'Windows Security Events',
] as const;

export function isSentinelConnectorGap(
  tc: TenantConfigProfileOutput['tenant_config'],
): boolean {
  const sku = (tc.licensing.primary_sku || '').toUpperCase();
  const hasG5E5 = sku.includes('G5') || sku.includes('E5');
  const sentinelActive = tc.licensing.service_activations.sentinel === true;
  return hasG5E5 && sentinelActive && tc.monitoring.data_connectors.length === 0;
}

/**
 * Emit standalone Tenant Manifest per pseudocode §4.7.
 * Schema (canonical): { ces, tenant_manifest }
 * The tenant manifest defines "RIGHT" — normative controls, config intents,
 * evidence monitors, and drift policies.
 */
export function generateTenantManifest(
  siBaseline: SIBaseline,
  planMode: PlanMode,
  taskCatalog: TaskCatalog,
  assessorKB: any,
  cuiBoundary?: CUIBoundaryOutput | null,
  btcConfirmation?: BTCConfirmationOutput | null,
  tenantConfig?: TenantConfigProfileOutput | null,
  cesId?: string,
): TenantManifest {
  const targetLevel = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';
  const siData = siBaseline.si_baseline as Record<string, any>;
  const techStackId: number = siData?.technology_stack?.tech_stack_id || 1;
  const today = new Date().toISOString(); // Canonical manifest uses date-time format
  const infrastructure_model = siBaseline.si_baseline?.dependencies?.infrastructure_model || 'm365_azure';

  const tc = tenantConfig?.tenant_config;

  return {
    ces: {
      artifact: 'tenant_manifest',
      version: '1.0.0',
      generated_on: today,
      intent: `Canonical tenant manifest defining RIGHT state for CMMC ${targetLevel} (${planMode}, ${infrastructure_model})`,
      ...(cesId ? { cesId } : {}),
      inputs: {
        si_baseline_hash: generateSHA256(JSON.stringify(siBaseline)),
      },
    },
    tenant_manifest: {
      manifest_id: generateId('manifest'),
      tech_stack_id: typeof techStackId === 'number' ? techStackId : 1,
      normative_controls: buildNormativeControls(taskCatalog, assessorKB, cuiBoundary, btcConfirmation),
      assets: buildAssets(siBaseline, cuiBoundary, tenantConfig),
      config_intents: buildConfigIntents(taskCatalog, cuiBoundary, tenantConfig),
      evidence_monitors: buildEvidenceMonitors(taskCatalog, cuiBoundary, btcConfirmation, tenantConfig),
      drift_policies: buildDriftPolicies(taskCatalog, btcConfirmation),
      ...(cuiBoundary ? { boundary_zones: buildBoundaryZones(cuiBoundary) } : {}),
      ...(tc ? {
        tenant_identity: {
          tenant_id: tc.identity.tenant_id,
          primary_domain: tc.identity.primary_domain,
          custom_domains: tc.identity.custom_domains,
          cloud_environment: tc.identity.cloud_environment,
          display_name: tc.identity.display_name,
          primary_sku: tc.licensing.primary_sku,
          license_count: tc.licensing.license_count,
          addon_skus: tc.licensing.addon_skus,
          service_activations: tc.licensing.service_activations,
        },
      } : {}),
    },
  };
}

function buildBoundaryZones(cuiBoundary: CUIBoundaryOutput): Record<string, unknown> {
  const b = cuiBoundary.cui_boundary;
  return {
    cui_boundary_version: cuiBoundary.ces.generated_on,
    definitions: Object.entries(b).map(([key, value]) => ({
      key,
      value,
      type: Array.isArray(value) ? 'list' : typeof value,
    })),
  };
}

// ---------------------------------------------------------------------------
// Normative controls — per-requirement "what RIGHT looks like"
// ---------------------------------------------------------------------------
function buildNormativeControls(
  taskCatalog: TaskCatalog,
  assessorKB: any,
  cuiBoundary?: CUIBoundaryOutput | null,
  btcConfirmation?: BTCConfirmationOutput | null,
): any[] {
  const tasks = taskCatalog.tasks;
  const controls: any[] = [];

  if (tasks.length === 0) {
    controls.push({
      control_id: 'general',
      required_state: 'All CMMC controls implemented and verified',
      verification: [
        {
          id: generateId('chk'),
          description: 'Verify overall compliance posture',
          method: 'manual',
          expected: 'All controls report compliant',
          on_fail: 'Initiate gap remediation',
        },
      ],
      evidence_artifacts: [],
    });
  } else {
    const kbApproaches: any[] = assessorKB?.ces?.approaches || assessorKB?.approaches || [];

    for (const t of tasks) {
      const kbMatch = kbApproaches.find((a: any) => a.requirement_id === t.requirement_id);

      controls.push({
        control_id: t.requirement_id,
        required_state: `${t.title} — implemented and continuously verified`,
        verification: t.how_to_verify.map((step, i) => ({
          id: generateId(`chk_${i}`),
          description: step,
          method: deriveCheckMethod(t, kbMatch),
          expected: `${t.requirement_id} verification passes`,
          on_fail: `Flag ${t.requirement_id} for remediation and re-assessment`,
        })),
        evidence_artifacts: t.expected_artifacts,
      });
    }
  }

  // CUI-specific normative controls
  if (cuiBoundary) {
    const b = cuiBoundary.cui_boundary;
    const keys = Object.keys(b);
    const hasEgress = keys.some((k) => k.startsWith('CUI.LC.EGR'));
    const hasRetention = keys.some((k) => k.startsWith('CUI.LC.RET'));
    const hasGeneral = keys.some((k) => k.startsWith('CUI.GEN'));
    const hasIdentity = keys.some((k) => k.startsWith('CUI.ID'));

    if (hasEgress) {
      controls.push({
        control_id: 'cui_dlp',
        required_state: 'Data Loss Prevention controls active for CUI egress boundary',
        verification: [{
          id: generateId('chk'),
          description: 'Verify DLP policies prevent unauthorized CUI egress',
          method: 'config_export',
          expected: 'DLP policies active and blocking unauthorized transfers',
          on_fail: 'Remediate DLP configuration immediately',
        }],
        evidence_artifacts: [],
      });
    }
    if (hasRetention) {
      controls.push({
        control_id: 'cui_retention',
        required_state: 'CUI retention policies enforced per boundary declaration',
        verification: [{
          id: generateId('chk'),
          description: 'Verify retention policies match CUI boundary retention requirements',
          method: 'config_export',
          expected: 'Retention policies active and compliant',
          on_fail: 'Update retention policies to match CUI boundary requirements',
        }],
        evidence_artifacts: [],
      });
    }
    if (hasGeneral) {
      controls.push({
        control_id: 'cui_marking',
        required_state: 'CUI marking and labeling controls enforced',
        verification: [{
          id: generateId('chk'),
          description: 'Verify CUI marking/labeling applied to all in-scope data',
          method: 'manual',
          expected: 'All CUI data properly marked and labeled',
          on_fail: 'Implement CUI marking controls across in-scope systems',
        }],
        evidence_artifacts: [],
      });
    }
    if (hasIdentity) {
      controls.push({
        control_id: 'cui_shared_identity',
        required_state: 'Shared identity controls enforced for CUI access boundary',
        verification: [{
          id: generateId('chk'),
          description: 'Verify shared identity federation enforces CUI access controls',
          method: 'config_export',
          expected: 'Identity provider correctly scopes CUI access',
          on_fail: 'Remediate identity federation for CUI boundary compliance',
        }],
        evidence_artifacts: [],
      });
    }
  }

  // BTC gate normative controls
  if (btcConfirmation?.btc_confirmation?.gate_status) {
    for (const [sectionId, gate] of Object.entries(btcConfirmation.btc_confirmation.gate_status)) {
      if (gate.pass) continue;
      controls.push({
        control_id: `btc_gate_${gate.domain.toLowerCase()}`,
        required_state: `Re-verify after remediation: ${gate.reason}`,
        verification: [{
          id: generateId('chk'),
          description: `Verify remediation of BTC gate failure: ${gate.reason}`,
          method: 'manual',
          expected: `BTC gate ${sectionId} (${gate.domain}) passes re-verification`,
          on_fail: `Escalate: BTC gate ${gate.domain} still failing — ${gate.reason}`,
        }],
        evidence_artifacts: [],
      });
    }
  }

  return controls;
}

function deriveCheckMethod(task: Task, kbMatch: any): string {
  if (kbMatch?.primary_method) return kbMatch.primary_method;
  if (task.impl_engine === 'api') return 'api_query';
  if (task.task_type === 'configuration') return 'config_export';
  if (task.task_type === 'policy' || task.task_type === 'training') return 'manual';
  return 'config_export';
}

// ---------------------------------------------------------------------------
// Assets — derive from SI baseline scope
// ---------------------------------------------------------------------------
function buildAssets(siBaseline: SIBaseline, cuiBoundary?: CUIBoundaryOutput | null, tenantConfig?: TenantConfigProfileOutput | null): any[] {
  const assets: any[] = [];
  const scope: any = siBaseline.si_baseline?.scope;
  if (!scope) return assets;

  const inScope: any[] = scope.in_scope_systems || scope.boundary_systems || [];
  for (const sys of inScope) {
    assets.push({
      asset_id: sys.id || sys.name || generateId('asset'),
      asset_type: sys.type || 'system',
      scope_category: sys.category || 'CUI',
      tags: sys.tags || [sys.type || 'in-scope'],
      owner: sys.owner,
    });
  }

  // CUI-derived assets from boundary answers
  if (cuiBoundary) {
    const keys = Object.keys(cuiBoundary.cui_boundary);
    if (keys.some((k) => k.startsWith('CUI.ID'))) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'identity_provider',
        scope_category: 'CUI',
        tags: ['cui-boundary', 'identity'],
        owner: 'identity_admin',
      });
    }
    if (keys.some((k) => k.startsWith('CUI.DEV'))) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'endpoint_fleet',
        scope_category: 'CUI',
        tags: ['cui-boundary', 'endpoint'],
        owner: 'endpoint_admin',
      });
    }
    if (keys.some((k) => k.startsWith('CUI.DEVOPS'))) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'devops_pipeline',
        scope_category: 'CUI',
        tags: ['cui-boundary', 'devops'],
        owner: 'devops_admin',
      });
    }
    if (keys.some((k) => k.startsWith('CUI.LC'))) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'data_boundary',
        scope_category: 'CUI',
        tags: ['cui-boundary', 'data-lifecycle'],
        owner: 'data_admin',
      });
    }
  }

  // TCP-derived assets: break-glass accounts, admin accounts, key groups
  if (tenantConfig?.tenant_config) {
    const tc = tenantConfig.tenant_config;
    for (const upn of tc.identity_architecture.break_glass_accounts) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'break_glass_account',
        scope_category: 'privileged_access',
        tags: ['tcp', 'break-glass', 'emergency-access'],
        owner: upn,
      });
    }
    for (const upn of tc.privileged_access.global_admins) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'admin_account',
        scope_category: 'privileged_access',
        tags: ['tcp', 'global-admin'],
        owner: upn,
      });
    }
    for (const [groupName, role] of Object.entries(tc.group_architecture.key_groups)) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'security_group',
        scope_category: 'identity',
        tags: ['tcp', 'key-group', role],
        owner: groupName,
      });
    }
    for (const upn of tc.privileged_access.security_admins) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'admin_account',
        scope_category: 'privileged_access',
        tags: ['tcp', 'security-admin'],
        owner: upn,
      });
    }
    for (const upn of tc.privileged_access.compliance_admins) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'admin_account',
        scope_category: 'privileged_access',
        tags: ['tcp', 'compliance-admin'],
        owner: upn,
      });
    }
    for (const loc of tc.conditional_access.named_locations) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'network_location',
        scope_category: 'conditional_access',
        tags: ['tcp', 'named-location', loc.type],
        owner: loc.name,
      });
    }
    for (const site of tc.data_protection.cui_sharepoint_sites) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'data_boundary',
        scope_category: 'CUI',
        tags: ['tcp', 'cui-sharepoint'],
        owner: site,
      });
    }
    for (const channel of tc.data_protection.cui_teams_channels) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'data_boundary',
        scope_category: 'CUI',
        tags: ['tcp', 'cui-teams'],
        owner: channel,
      });
    }
  }

  return assets;
}

// ---------------------------------------------------------------------------
// Config intents — what config should look like for each control
// ---------------------------------------------------------------------------
function buildConfigIntents(taskCatalog: TaskCatalog, cuiBoundary?: CUIBoundaryOutput | null, tenantConfig?: TenantConfigProfileOutput | null): any[] {
  const tasks = taskCatalog.tasks;
  const intents: any[] = [];

  if (tasks.length === 0) {
    intents.push({
      id: generateId('ci'),
      title: 'General compliance configuration',
      control_ids: ['general'],
      desired_config: { state: 'compliant' },
      source_of_truth: 'platform_setting',
      query_method: 'manual',
    });
  } else {
    for (const t of tasks) {
      intents.push({
        id: generateId('ci'),
        title: t.title,
        control_ids: [t.requirement_id],
        desired_config: {
          requirement: t.requirement_id,
          state: 'compliant',
          ...(t.impl_args || {}),
        },
        source_of_truth: deriveSourceOfTruth(t),
        query_method: deriveQueryMethod(t),
      });
    }
  }

  // CUI-scoped config intents
  if (cuiBoundary) {
    const keys = Object.keys(cuiBoundary.cui_boundary);
    if (keys.some((k) => k.startsWith('CUI.LC.EGR'))) {
      intents.push({
        id: generateId('ci'),
        title: 'CUI Data Loss Prevention policy',
        control_ids: ['cui_dlp'],
        desired_config: { state: 'active', scope: 'cui_egress_boundary' },
        source_of_truth: 'platform_setting',
        query_method: 'export',
      });
    }
    if (keys.some((k) => k.startsWith('CUI.LC.RET'))) {
      intents.push({
        id: generateId('ci'),
        title: 'CUI Retention policy',
        control_ids: ['cui_retention'],
        desired_config: { state: 'enforced', scope: 'cui_data_lifecycle' },
        source_of_truth: 'platform_setting',
        query_method: 'export',
      });
    }
    if (keys.some((k) => k.startsWith('CUI.ID'))) {
      intents.push({
        id: generateId('ci'),
        title: 'CUI Conditional Access / identity boundary',
        control_ids: ['cui_shared_identity'],
        desired_config: { state: 'enforced', scope: 'cui_identity_boundary' },
        source_of_truth: 'platform_setting',
        query_method: 'api',
      });
    }
  }

  // TCP-parameterized config intents
  if (tenantConfig?.tenant_config) {
    const tc = tenantConfig.tenant_config;
    intents.push({
      id: generateId('ci'),
      title: 'Conditional Access policies (TCP-parameterized)',
      control_ids: ['AC.L2-3.1.1'],
      desired_config: {
        naming_convention: tc.conditional_access.ca_naming_convention,
        named_locations: tc.conditional_access.named_locations,
        tenant_id: tc.identity.tenant_id,
        break_glass_exclusion_group: tc.privileged_access.break_glass_exclusion_group,
      },
      source_of_truth: 'platform_setting',
      query_method: 'api',
    });
    intents.push({
      id: generateId('ci'),
      title: 'Device compliance policies (TCP-parameterized)',
      control_ids: ['AC.L2-3.1.18'],
      desired_config: {
        enrollment_type: tc.device_management.enrollment_type,
        naming_convention: tc.device_management.compliance_policy_convention,
        device_naming: tc.device_management.device_naming_convention,
        platforms: tc.device_management.platforms_in_scope,
      },
      source_of_truth: 'platform_setting',
      query_method: 'export',
    });
    intents.push({
      id: generateId('ci'),
      title: 'Security group architecture (TCP-parameterized)',
      control_ids: ['AC.L2-3.1.2'],
      desired_config: {
        convention: tc.group_architecture.security_group_convention,
        key_groups: tc.group_architecture.key_groups,
        strategy: tc.group_architecture.group_strategy,
        distribution_group_convention: tc.group_architecture.distribution_group_convention,
      },
      source_of_truth: 'platform_setting',
      query_method: 'api',
    });
    intents.push({
      id: generateId('ci'),
      title: 'Data protection — sensitivity labels & DLP (TCP-parameterized)',
      control_ids: ['SC.L2-3.13.1'],
      desired_config: {
        sensitivity_label_convention: tc.data_protection.sensitivity_label_convention,
        dlp_policy_convention: tc.data_protection.dlp_policy_convention,
        cui_sharepoint_sites: tc.data_protection.cui_sharepoint_sites,
        cui_teams_channels: tc.data_protection.cui_teams_channels,
      },
      source_of_truth: 'platform_setting',
      query_method: 'export',
    });
    intents.push({
      id: generateId('ci'),
      title: 'Identity provider configuration (TCP-parameterized)',
      control_ids: ['IA.L2-3.5.1'],
      desired_config: {
        identity_provider: tc.identity_architecture.identity_provider,
        directory_sync_enabled: tc.identity_architecture.directory_sync_enabled,
        admin_naming_convention: tc.identity_architecture.admin_naming_convention,
      },
      source_of_truth: 'platform_setting',
      query_method: 'api',
    });
    intents.push({
      id: generateId('ci'),
      title: 'Privileged access management (TCP-parameterized)',
      control_ids: ['AC.L2-3.1.5'],
      desired_config: {
        pim_enabled: tc.privileged_access.pim_enabled,
        security_admins: tc.privileged_access.security_admins,
        compliance_admins: tc.privileged_access.compliance_admins,
        service_account_naming_convention: tc.identity_architecture.service_account_naming_convention,
      },
      source_of_truth: 'platform_setting',
      query_method: 'api',
    });
    intents.push({
      id: generateId('ci'),
      title: 'Conditional access policy baseline (TCP-parameterized)',
      control_ids: ['AC.L2-3.1.1'],
      desired_config: {
        existing_policy_count: tc.conditional_access.existing_policy_count,
        drift_baseline: true,
      },
      source_of_truth: 'platform_setting',
      query_method: 'api',
    });

    if (isSentinelConnectorGap(tc)) {
      intents.push({
        id: generateId('ci'),
        title: 'Sentinel data connector remediation (TCP-detected gap)',
        control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
        desired_config: {
          required_connectors: [...G5_RECOMMENDED_SENTINEL_CONNECTORS],
          sentinel_workspace: tc.monitoring.sentinel_workspace_name,
          resource_group: tc.monitoring.sentinel_resource_group,
        },
        source_of_truth: 'platform_setting',
        query_method: 'api',
      });
    }
  }

  return intents;
}

function deriveSourceOfTruth(task: Task): string {
  if (task.impl_engine === 'terraform' || task.impl_engine === 'bicep' || task.impl_engine === 'cloudformation')
    return 'iac';
  if (task.task_type === 'policy') return 'policy_doc';
  if (task.task_type === 'training') return 'manual';
  return 'platform_setting';
}

function deriveQueryMethod(task: Task): string {
  if (task.impl_engine === 'api') return 'api';
  if (task.task_type === 'policy' || task.task_type === 'training') return 'manual';
  return 'export';
}

// ---------------------------------------------------------------------------
// Evidence monitors — continuous evidence collection rules
// ---------------------------------------------------------------------------
function buildEvidenceMonitors(
  taskCatalog: TaskCatalog,
  cuiBoundary?: CUIBoundaryOutput | null,
  btcConfirmation?: BTCConfirmationOutput | null,
  tenantConfig?: TenantConfigProfileOutput | null,
): any[] {
  const tasks = taskCatalog.tasks;
  const monitors: any[] = [];

  if (tasks.length === 0) {
    monitors.push({
      id: generateId('em'),
      control_ids: ['general'],
      signal: 'General compliance monitoring',
      collection_method: 'manual',
      cadence: 'weekly',
      retention_days: 365,
      on_drift: 'Alert compliance team',
    });
  } else {
    for (const t of tasks) {
      monitors.push({
        id: generateId('em'),
        control_ids: [t.requirement_id],
        signal: deriveSignal(t),
        collection_method: deriveCollectionMethod(t),
        cadence: t.priority === 'p0' || t.priority === 'p1' ? 'daily' : 'weekly',
        retention_days: 365,
        on_drift: `Alert compliance team and initiate remediation for ${t.requirement_id}`,
      });
    }
  }

  // CUI evidence monitors
  if (cuiBoundary) {
    const keys = Object.keys(cuiBoundary.cui_boundary);
    if (keys.some((k) => k.startsWith('CUI.LC.EGR'))) {
      monitors.push({
        id: generateId('em'),
        control_ids: ['cui_dlp'],
        signal: 'DLP incident and policy violation events',
        collection_method: 'event_stream',
        cadence: 'daily',
        retention_days: 365,
        on_drift: 'Alert compliance team — CUI egress boundary violation detected',
      });
    }
    if (keys.some((k) => k.startsWith('CUI.LC.RET'))) {
      monitors.push({
        id: generateId('em'),
        control_ids: ['cui_retention'],
        signal: 'Retention policy compliance status',
        collection_method: 'scheduled_export',
        cadence: 'weekly',
        retention_days: 365,
        on_drift: 'Alert compliance team — CUI retention policy non-compliant',
      });
    }
    if (keys.some((k) => k.startsWith('CUI.ID'))) {
      monitors.push({
        id: generateId('em'),
        control_ids: ['cui_shared_identity'],
        signal: 'Shared identity access review',
        collection_method: 'api_poll',
        cadence: 'monthly',
        retention_days: 365,
        on_drift: 'Alert identity admin — CUI access review overdue or non-compliant',
      });
    }
  }

  // BTC gate monitors — daily cadence, critical severity
  if (btcConfirmation?.btc_confirmation?.gate_status) {
    for (const [sectionId, gate] of Object.entries(btcConfirmation.btc_confirmation.gate_status)) {
      if (gate.pass) continue;
      monitors.push({
        id: generateId('em'),
        control_ids: [`btc_gate_${gate.domain.toLowerCase()}`],
        signal: `BTC gate re-verification: ${gate.domain} — ${gate.reason}`,
        collection_method: 'manual',
        cadence: 'daily',
        retention_days: 365,
        on_drift: `Escalate: BTC gate ${sectionId} (${gate.domain}) remediation incomplete`,
      });
    }
  }

  // TCP-parameterized evidence monitors (Sentinel workspace + new monitors)
  if (tenantConfig?.tenant_config) {
    const tc = tenantConfig.tenant_config;
    monitors.push({
      id: generateId('em'),
      control_ids: ['AU.L2-3.3.1'],
      signal: `Sentinel workspace: ${tc.monitoring.sentinel_workspace_name}`,
      collection_method: 'api_poll',
      cadence: 'daily',
      retention_days: 365,
      on_drift: 'Alert compliance team — Sentinel workspace configuration drift detected',
      sentinel_workspace: tc.monitoring.sentinel_workspace_name,
      sentinel_resource_group: tc.monitoring.sentinel_resource_group,
      log_analytics_workspace_id: tc.monitoring.log_analytics_workspace_id,
    });
    monitors.push({
      id: generateId('em'),
      control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
      signal: isSentinelConnectorGap(tc)
        ? `Data connector remediation required: enable ${G5_RECOMMENDED_SENTINEL_CONNECTORS.join(', ')}`
        : `Data connector completeness: ${tc.monitoring.data_connectors.join(', ')}`,
      collection_method: 'api_poll',
      cadence: 'daily',
      retention_days: 365,
      on_drift: 'Alert compliance team — data connector(s) disconnected or misconfigured',
    });
    monitors.push({
      id: generateId('em'),
      control_ids: ['SC.L2-3.13.1'],
      signal: `DLP / data protection: sensitivity labels (${tc.data_protection.sensitivity_label_convention})`,
      collection_method: 'scheduled_export',
      cadence: 'daily',
      retention_days: 365,
      on_drift: 'Alert compliance team — sensitivity label or DLP policy drift detected',
    });
    monitors.push({
      id: generateId('em'),
      control_ids: ['AC.L2-3.1.5'],
      signal: `Privileged access: PIM ${tc.privileged_access.pim_enabled ? 'enabled' : 'disabled'}, ${tc.privileged_access.global_admins.length + tc.privileged_access.security_admins.length + tc.privileged_access.compliance_admins.length} admin accounts`,
      collection_method: 'api_poll',
      cadence: 'daily',
      retention_days: 365,
      on_drift: 'Alert compliance team — privileged access role assignment drift detected',
    });
    monitors.push({
      id: generateId('em'),
      control_ids: ['AU.L2-3.3.1'],
      signal: `Alert rule convention: ${tc.monitoring.alert_rule_convention}`,
      collection_method: 'api_poll',
      cadence: 'weekly',
      retention_days: 365,
      on_drift: 'Alert compliance team — Sentinel alert rule naming or configuration drift detected',
    });
  }

  return monitors;
}

function deriveSignal(task: Task): string {
  if (task.expected_artifacts.length > 0) {
    return `${task.expected_artifacts[0].artifact_type} for ${task.requirement_id}`;
  }
  return `Compliance state for ${task.requirement_id}`;
}

function deriveCollectionMethod(task: Task): string {
  if (task.impl_engine === 'api') return 'api_poll';
  if (task.task_type === 'policy' || task.task_type === 'training') return 'manual';
  if (task.impl_engine === 'terraform' || task.impl_engine === 'bicep') return 'event_stream';
  return 'scheduled_export';
}

// ---------------------------------------------------------------------------
// Drift policies — grouped by severity
// ---------------------------------------------------------------------------
function buildDriftPolicies(
  taskCatalog: TaskCatalog,
  btcConfirmation?: BTCConfirmationOutput | null,
): any[] {
  const tasks = taskCatalog.tasks;
  const policies: any[] = [];

  const critical = tasks.filter((t) => t.priority === 'p0');
  const high = tasks.filter((t) => t.priority === 'p1');
  const standard = tasks.filter((t) => t.priority === 'p2' || t.priority === 'p3');

  if (critical.length > 0) {
    policies.push({
      id: generateId('dp'),
      scope: `Critical controls: ${critical.map((t) => t.requirement_id).join(', ')}`,
      severity: 'critical',
      detection: [
        'Continuous monitoring via evidence monitors',
        'Real-time configuration drift alerts',
      ],
      response_playbook: [
        'Immediately notify compliance lead and ISSO',
        'Initiate emergency remediation within 4 hours',
        'Document incident, root cause, and resolution',
      ],
    });
  }

  if (high.length > 0) {
    policies.push({
      id: generateId('dp'),
      scope: `High priority controls: ${high.map((t) => t.requirement_id).join(', ')}`,
      severity: 'high',
      detection: [
        'Daily configuration compliance checks',
        'Evidence freshness monitoring',
      ],
      response_playbook: [
        'Notify compliance team within 24 hours',
        'Schedule remediation within current sprint',
        'Update evidence artifacts post-remediation',
      ],
    });
  }

  if (standard.length > 0) {
    policies.push({
      id: generateId('dp'),
      scope: `Standard controls: ${standard.map((t) => t.requirement_id).join(', ')}`,
      severity: 'medium',
      detection: [
        'Weekly compliance scans',
        'Monthly evidence reviews',
      ],
      response_playbook: [
        'Evaluate drift impact on compliance posture',
        'Schedule remediation in next planning cycle',
        'Update compliance documentation',
      ],
    });
  }

  // BTC Gate Re-Verification drift policy
  if (btcConfirmation?.btc_confirmation?.gate_status) {
    const failedGates = Object.entries(btcConfirmation.btc_confirmation.gate_status)
      .filter(([, g]) => !g.pass);

    if (failedGates.length > 0) {
      const gateScopes = failedGates.map(([id, g]) => `${g.domain} (${id}): ${g.reason}`);
      policies.push({
        id: generateId('dp'),
        scope: `BTC Gate Re-Verification: ${gateScopes.join('; ')}`,
        severity: 'critical',
        detection: [
          'Continuous monitoring of gate-relevant controls',
          'Daily re-verification status checks',
        ],
        response_playbook: [
          'Immediate escalation to compliance lead',
          'Re-run BTC verification post-remediation',
          'Document gate remediation evidence and timeline',
        ],
      });
    }
  }

  if (policies.length === 0) {
    policies.push({
      id: generateId('dp'),
      scope: 'All CMMC controls',
      severity: 'medium',
      detection: ['Weekly compliance scans', 'Monthly evidence reviews'],
      response_playbook: [
        'Evaluate drift impact',
        'Schedule remediation',
        'Update documentation',
      ],
    });
  }

  return policies;
}
