// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, TenantConfigProfileOutput } from '../../shared/types/artifacts';
import type { InfrastructureManifest, InfraResourceSpec, InfraVariableMap, InfraProvenanceEntry, InfraRegistryCoverage } from '../../shared/types/artifacts';
import type { GapClassification } from '../types';
import { generateId } from '../../shared/utils/idGenerator';

// ─── Helpers ─────────────────────────────────────────────────────

function prov(
  field: string,
  value: unknown,
  source: InfraProvenanceEntry['source'],
  rule: string,
): InfraProvenanceEntry {
  return { field, value, source, rule };
}

function subnetCidr(vnetCidr: string, subnetIndex: number): string {
  const parts = vnetCidr.split('/');
  const octets = parts[0].split('.').map(Number);
  octets[2] = subnetIndex;
  octets[3] = 0;
  return `${octets.join('.')}/27`;
}

function stripHyphens(s: string): string {
  return s.replace(/-/g, '');
}

function isGovCloud(env: string): boolean {
  return env === 'gcc_high' || env === 'gcc';
}

function dnsZoneSuffix(env: string): string {
  return isGovCloud(env) ? 'usgovcloudapi.net' : 'azure.net';
}

// ─── Input derivation ────────────────────────────────────────────

interface DerivedInfraInputs {
  subscriptionId: string;
  location: string;
  resourceGroup: string;
  vnetCidr: string;
  namingPrefix: string;
  wormRetentionDays: number;
  cloudEnvironment: string;
  primaryDomain: string;
  breakGlassAccountName: string;
  eoServicePrincipalName: string;
  targetLevel: string;
}

/**
 * Derive infrastructure inputs from TCP + SI Baseline.
 * TCP's monitoring section provides the resource group and workspace.
 * SI Baseline provides target level and cloud environment preference.
 */
function deriveInputs(
  tenantConfig: TenantConfigProfileOutput,
  siBaseline: SIBaseline,
): DerivedInfraInputs {
  const tc = tenantConfig.tenant_config;
  const si = siBaseline.si_baseline;

  const primaryDomain = tc.identity.primary_domain;
  const domainSlug = primaryDomain.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const cloudEnv = tc.identity.cloud_environment || si?.dependencies?.tenant_model_preference || 'gcc_high';
  const location = cloudEnv === 'gcc_high' || cloudEnv === 'gcc' ? 'usgovvirginia' : 'eastus';

  const rg = tc.monitoring.sentinel_resource_group || `rg-cmmc-${domainSlug}`;
  const prefix = domainSlug || 'cmmc';

  const breakGlass = tc.identity_architecture.break_glass_accounts?.[0] || `BreakGlass-${domainSlug}`;

  return {
    subscriptionId: generateId('sub'), // placeholder — real sub ID comes from TCP or manual input
    location,
    resourceGroup: rg,
    vnetCidr: '10.0.0.0/16',
    namingPrefix: prefix,
    wormRetentionDays: si?.evidence?.retention_target_days || 2557,
    cloudEnvironment: cloudEnv,
    primaryDomain,
    breakGlassAccountName: breakGlass,
    eoServicePrincipalName: 'EvidenceOps-Automation',
    targetLevel: si?.target?.target_cmmc_level || 'L2',
  };
}

// ─── Generator ───────────────────────────────────────────────────

export function generateInfrastructureManifest(
  siBaseline: SIBaseline,
  tenantConfig: TenantConfigProfileOutput,
): InfrastructureManifest | null {
  const infraModel = siBaseline.si_baseline?.dependencies?.infrastructure_model || 'm365_sentinel';

  if (infraModel === 'm365_only') {
    return null; // Skip manifest generation entirely
  }

  const inputs = deriveInputs(tenantConfig, siBaseline);
  const {
    subscriptionId: subId,
    location: loc,
    resourceGroup: rg,
    vnetCidr,
    namingPrefix: prefix,
    wormRetentionDays: wormDays,
    cloudEnvironment,
    breakGlassAccountName: bgAccount,
    eoServicePrincipalName: eoDisplayName,
    targetLevel,
  } = inputs;

  // Derived resource names
  const lawName = tenantConfig.tenant_config.monitoring.sentinel_workspace_name || `${prefix}-law-prod`;

  // m365_sentinel: minimal manifest with only Resource Group + Log Analytics Workspace + Sentinel Workspace
  if (infraModel === 'm365_sentinel') {
    const sentinelLogging: InfraResourceSpec[] = [
      {
        resource_id: 'log-rg',
        resource_type: 'resource_group',
        name: rg,
        control_ids: ['AU.L2-3.3.1'],
        registry_entry_ids: ['AZ-FOUND-001'],
        properties: { location: loc },
        depends_on: [],
      },
      {
        resource_id: 'log-law',
        resource_type: 'log_analytics_workspace',
        name: lawName,
        control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2', 'SI.L2-3.14.6'],
        registry_entry_ids: ['AZ-LOG-001'],
        properties: { sku: 'PerGB2018', retention_days: wormDays, location: loc, resource_group: rg },
        depends_on: ['log-rg'],
      },
      {
        resource_id: 'log-sentinel',
        resource_type: 'sentinel_onboarding',
        name: 'sentinel',
        control_ids: ['AU.L2-3.3.1', 'SI.L2-3.14.1', 'SI.L2-3.14.6'],
        registry_entry_ids: ['AZ-SEN-001'],
        properties: { workspace: lawName, content_hub_solutions: ['CMMC 2.0'] },
        depends_on: ['log-law'],
      },
    ];

    const coveredIds = new Set<string>();
    for (const spec of sentinelLogging) {
      for (const id of spec.registry_entry_ids) coveredIds.add(id);
    }

    const sentinelProvenance: InfraProvenanceEntry[] = [
      prov('logging.law_name', lawName, 'tcp', `From TCP monitoring.sentinel_workspace_name or convention {prefix}-law-prod`),
      prov('logging.retention_days', wormDays, wormDays !== 2557 ? 'tcp' : 'default', `WORM retention from SI evidence retention or default 2557`),
      prov('infrastructure_model', 'm365_sentinel', 'si_baseline', 'Minimal Sentinel-only manifest per SI Baseline infrastructure_model'),
    ];

    return {
      ces: {
        artifact: 'infrastructure_manifest',
        version: '1.0.0',
        generated_on: new Date().toISOString(),
        intent: `CMMC ${targetLevel} Sentinel-only infrastructure specification for ${rg}`,
      },
      infrastructure_manifest: {
        identity: [],
        logging: sentinelLogging,
        security: [],
        storage: [],
        network: [],
        automation: [],
        diagnostics: [],
        stamper_variable_map: {
          subscriptionId: subId,
          resourceGroup: rg,
          location: loc,
          lawWorkspaceName: lawName,
          storageAccountName: '',
          keyVaultName: '',
          cmkKeyName: '',
          vnetName: '',
          vnetCidr: '',
          subnetPeName: '',
          subnetPeCidr: '',
          nsgPeName: '',
          automationAccountName: '',
          eoAppDisplayName: eoDisplayName,
          mgmtSubnetCidr: '',
          identitySubnetCidr: '',
          peSubnetCidr: '',
          fwSubnetCidr: '',
        },
        registry_coverage: {
          total_infra_entries: 53,
          covered_entry_ids: Array.from(coveredIds),
          uncovered_entry_ids: [],
          coverage_pct: Math.round((coveredIds.size / 53) * 100),
        },
        provenance: sentinelProvenance,
      },
    };
  }

  // m365_azure: full manifest with all resources (current behavior)
  const kvName = `${prefix}-kv-prod`;
  const cmkKeyName = `cmk-${prefix}`;
  const saName = `${stripHyphens(prefix)}evops01`;
  const vnetName = `${prefix}-vnet-eo`;
  const subnetPeName = 'snet-pe';
  const subnetPeCidr = subnetCidr(vnetCidr, 1);
  const mgmtSubnetCidr = subnetCidr(vnetCidr, 2);
  const identitySubnetCidr = subnetCidr(vnetCidr, 3);
  const peSubnetCidrVal = subnetCidr(vnetCidr, 4);
  const fwSubnetCidr = subnetCidr(vnetCidr, 5);
  const nsgPeName = `${prefix}-nsg-pe`;
  const autoName = `${prefix}-automation-eo`;

  const provenance: InfraProvenanceEntry[] = [];

  // ─── Section: Identity ─────────────────────────────────────────

  const identity: InfraResourceSpec[] = [
    {
      resource_id: 'id-break-glass',
      resource_type: 'entra_account',
      name: bgAccount,
      control_ids: ['AC.L2-3.1.1'],
      registry_entry_ids: [],
      properties: { purpose: 'Emergency access account for break-glass scenarios', mfa_required: true },
      depends_on: [],
    },
    {
      resource_id: 'id-ca-mfa-all',
      resource_type: 'conditional_access_policy',
      name: 'CA-MFA-All-Users',
      control_ids: ['AC.L2-3.1.1', 'AC.L2-3.1.2'],
      registry_entry_ids: [],
      properties: { grant_controls: ['mfa'], state: 'enabled', applies_to: 'All users', excludes: [bgAccount] },
      depends_on: ['id-break-glass'],
    },
    {
      resource_id: 'id-ca-block-legacy',
      resource_type: 'conditional_access_policy',
      name: 'CA-Block-Legacy-Auth',
      control_ids: ['AC.L2-3.1.1'],
      registry_entry_ids: [],
      properties: { grant_controls: ['block'], state: 'enabled', condition: 'Legacy authentication clients' },
      depends_on: [],
    },
    {
      resource_id: 'id-eo-sp',
      resource_type: 'service_principal',
      name: eoDisplayName,
      control_ids: ['AU.L2-3.3.1'],
      registry_entry_ids: [],
      properties: { purpose: 'Evidence collection automation service principal', credential_type: 'certificate' },
      depends_on: [],
    },
  ];

  provenance.push(
    prov('identity.break_glass', bgAccount, 'tcp', `Break glass account from TCP identity architecture`),
    prov('identity.ca_policies', ['MFA-All-Users', 'Block-Legacy-Auth'], 'convention', `Always required for CMMC ${targetLevel}`),
    prov('identity.eo_sp', eoDisplayName, 'convention', 'Convention: EvidenceOps-Automation'),
  );

  // ─── Section: Logging ──────────────────────────────────────────

  const logging: InfraResourceSpec[] = [
    {
      resource_id: 'log-rg',
      resource_type: 'resource_group',
      name: rg,
      control_ids: ['AU.L2-3.3.1'],
      registry_entry_ids: ['AZ-FOUND-001'],
      properties: { location: loc },
      depends_on: [],
    },
    {
      resource_id: 'log-law',
      resource_type: 'log_analytics_workspace',
      name: lawName,
      control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2', 'SI.L2-3.14.6'],
      registry_entry_ids: ['AZ-LOG-001'],
      properties: { sku: 'PerGB2018', retention_days: wormDays, location: loc, resource_group: rg },
      depends_on: ['log-rg'],
    },
    {
      resource_id: 'log-entra-diag',
      resource_type: 'diagnostic_setting',
      name: 'entra-to-law',
      control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
      registry_entry_ids: ['AZ-LOG-003'],
      properties: { log_categories: ['AuditLogs', 'SignInLogs', 'NonInteractiveUserSignInLogs', 'ServicePrincipalSignInLogs', 'RiskyUsers'], destination: lawName },
      depends_on: ['log-law'],
    },
    {
      resource_id: 'log-sentinel',
      resource_type: 'sentinel_onboarding',
      name: 'sentinel',
      control_ids: ['AU.L2-3.3.1', 'SI.L2-3.14.1', 'SI.L2-3.14.6'],
      registry_entry_ids: ['AZ-SEN-001'],
      properties: { workspace: lawName, content_hub_solutions: ['CMMC 2.0'] },
      depends_on: ['log-law'],
    },
  ];

  provenance.push(
    prov('logging.law_name', lawName, 'tcp', `From TCP monitoring.sentinel_workspace_name or convention {prefix}-law-prod`),
    prov('logging.retention_days', wormDays, wormDays !== 2557 ? 'tcp' : 'default', `WORM retention from SI evidence retention or default 2557`),
  );

  // ─── Section: Security ─────────────────────────────────────────

  const defenderPlans = ['VirtualMachines', 'StorageAccounts', 'CloudPosture', 'Arm'];
  const security: InfraResourceSpec[] = [
    {
      resource_id: 'sec-defender',
      resource_type: 'defender_for_cloud',
      name: 'defender-plans',
      control_ids: ['SI.L2-3.14.1', 'SI.L2-3.14.6', 'CM.L2-3.4.1'],
      registry_entry_ids: ['AZ-FOUND-003'],
      properties: {
        plans: defenderPlans.map(p => ({ name: p, tier: 'Standard', subPlan: p === 'VirtualMachines' ? 'P2' : undefined })),
        scope: 'subscription',
      },
      depends_on: [],
    },
    {
      resource_id: 'sec-cmmc-initiative',
      resource_type: 'policy_assignment',
      name: 'CMMC L2 Policy Initiative',
      control_ids: ['CM.L2-3.4.1', 'CM.L2-3.4.2'],
      registry_entry_ids: ['AZ-FOUND-002'],
      properties: { initiative: 'CMMC Level 2', scope: `/subscriptions/${subId}`, enforcement_mode: 'Default' },
      depends_on: [],
    },
  ];

  provenance.push(
    prov('security.defender_plans', defenderPlans, 'convention', `Standard tier for CMMC ${targetLevel}`),
    prov('security.cmmc_initiative', 'CMMC Level 2', 'convention', 'CMMC L2 policy initiative at subscription scope'),
  );

  // ─── Section: Storage ──────────────────────────────────────────

  const wormContainers = ['audit-logs', 'compliance-reports', 'incident-evidence'];
  const dnsSuffix = dnsZoneSuffix(cloudEnvironment);

  const storage: InfraResourceSpec[] = [
    {
      resource_id: 'sto-kv',
      resource_type: 'key_vault',
      name: kvName,
      control_ids: ['SC.L2-3.13.10', 'SC.L2-3.13.16'],
      registry_entry_ids: ['AZ-KV-001', 'AZ-KV-002'],
      properties: { sku: 'Premium', enable_rbac_authorization: true, enable_purge_protection: true, public_network_access: 'Disabled', soft_delete_retention_days: 90, location: loc, resource_group: rg },
      depends_on: ['log-rg'],
    },
    {
      resource_id: 'sto-cmk',
      resource_type: 'key_vault_key',
      name: cmkKeyName,
      control_ids: ['SC.L2-3.13.10', 'SC.L2-3.13.16'],
      registry_entry_ids: ['AZ-KV-003'],
      properties: { key_type: 'RSA-HSM', key_size: 4096, vault: kvName },
      depends_on: ['sto-kv'],
    },
    {
      resource_id: 'sto-sa',
      resource_type: 'storage_account',
      name: saName,
      control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2', 'SC.L2-3.13.10'],
      registry_entry_ids: ['AZ-LOG-002', 'AZ-LOG-002a'],
      properties: {
        sku: 'Standard_ZRS', kind: 'StorageV2',
        encryption: { source: 'Microsoft.Keyvault', key_vault_uri: `https://${kvName}.vault.${dnsSuffix}`, key_name: cmkKeyName },
        public_network_access: 'Disabled', minimum_tls_version: 'TLS1_2', allow_blob_public_access: false,
        identity_type: 'SystemAssigned', location: loc, resource_group: rg,
      },
      depends_on: ['sto-cmk'],
    },
    ...wormContainers.map((container, i) => ({
      resource_id: `sto-worm-${container}`,
      resource_type: 'storage_container',
      name: container,
      control_ids: ['AU.L2-3.3.2'] as string[],
      registry_entry_ids: i === 0 ? ['AZ-LOG-002b', 'AZ-LOG-002c'] : [] as string[],
      properties: { storage_account: saName, immutable_storage: { enabled: true, immutability_period_days: wormDays, locked: true } },
      depends_on: ['sto-sa'] as string[],
    })),
  ];

  provenance.push(
    prov('storage.kv_name', kvName, 'convention', `{prefix}-kv-prod where prefix=${prefix}`),
    prov('storage.cmk_key', cmkKeyName, 'convention', `cmk-{prefix} RSA-HSM 4096`),
    prov('storage.sa_name', saName, 'convention', `{prefix}evops01 (no hyphens)`),
    prov('storage.worm_containers', wormContainers, 'convention', 'audit-logs, compliance-reports, incident-evidence'),
    prov('storage.worm_retention', wormDays, wormDays !== 2557 ? 'policy_odp' : 'default', `Immutability period from SI evidence retention or default 2557`),
  );

  // ─── Section: Network ──────────────────────────────────────────

  const network: InfraResourceSpec[] = [
    {
      resource_id: 'net-vnet',
      resource_type: 'virtual_network',
      name: vnetName,
      control_ids: ['SC.L2-3.13.1', 'SC.L2-3.13.5', 'SC.L2-3.13.6'],
      registry_entry_ids: ['AZ-NET-001'],
      properties: { address_space: [vnetCidr], location: loc, resource_group: rg },
      depends_on: ['log-rg'],
    },
    {
      resource_id: 'net-snet-pe',
      resource_type: 'subnet',
      name: subnetPeName,
      control_ids: ['SC.L2-3.13.1', 'SC.L2-3.13.5'],
      registry_entry_ids: ['AZ-NET-002'],
      properties: { vnet: vnetName, address_prefix: subnetPeCidr, private_endpoint_network_policies: 'Disabled' },
      depends_on: ['net-vnet'],
    },
    {
      resource_id: 'net-snet-mgmt',
      resource_type: 'subnet',
      name: 'snet-mgmt',
      control_ids: ['SC.L2-3.13.1'],
      registry_entry_ids: [],
      properties: { vnet: vnetName, address_prefix: mgmtSubnetCidr },
      depends_on: ['net-vnet'],
    },
    {
      resource_id: 'net-snet-identity',
      resource_type: 'subnet',
      name: 'snet-identity',
      control_ids: ['SC.L2-3.13.1'],
      registry_entry_ids: [],
      properties: { vnet: vnetName, address_prefix: identitySubnetCidr },
      depends_on: ['net-vnet'],
    },
    {
      resource_id: 'net-snet-fw',
      resource_type: 'subnet',
      name: 'AzureFirewallSubnet',
      control_ids: ['SC.L2-3.13.1'],
      registry_entry_ids: [],
      properties: { vnet: vnetName, address_prefix: fwSubnetCidr },
      depends_on: ['net-vnet'],
    },
    {
      resource_id: 'net-dns-kv',
      resource_type: 'private_dns_zone',
      name: `privatelink.vaultcore.${dnsSuffix}`,
      control_ids: ['SC.L2-3.13.1'],
      registry_entry_ids: ['AZ-NET-003'],
      properties: { linked_vnet: vnetName, resource_group: rg },
      depends_on: ['net-vnet'],
    },
    {
      resource_id: 'net-dns-blob',
      resource_type: 'private_dns_zone',
      name: `privatelink.blob.core.${dnsSuffix}`,
      control_ids: ['SC.L2-3.13.1'],
      registry_entry_ids: ['AZ-NET-004'],
      properties: { linked_vnet: vnetName, resource_group: rg },
      depends_on: ['net-vnet'],
    },
    {
      resource_id: 'net-pe-kv',
      resource_type: 'private_endpoint',
      name: `${prefix}-pe-kv`,
      control_ids: ['SC.L2-3.13.1', 'SC.L2-3.13.6'],
      registry_entry_ids: ['AZ-PE-001'],
      properties: { target_resource: kvName, target_sub_resource: 'vault', subnet: subnetPeName, dns_zone: `privatelink.vaultcore.${dnsSuffix}` },
      depends_on: ['sto-kv', 'net-snet-pe', 'net-dns-kv'],
    },
    {
      resource_id: 'net-pe-blob',
      resource_type: 'private_endpoint',
      name: `${prefix}-pe-blob`,
      control_ids: ['SC.L2-3.13.1', 'SC.L2-3.13.6'],
      registry_entry_ids: ['AZ-PE-002'],
      properties: { target_resource: saName, target_sub_resource: 'blob', subnet: subnetPeName, dns_zone: `privatelink.blob.core.${dnsSuffix}` },
      depends_on: ['sto-sa', 'net-snet-pe', 'net-dns-blob'],
    },
    {
      resource_id: 'net-nsg-pe',
      resource_type: 'network_security_group',
      name: nsgPeName,
      control_ids: ['SC.L2-3.13.1', 'SC.L2-3.13.5', 'SC.L2-3.13.6'],
      registry_entry_ids: ['AZ-NSG-001'],
      properties: {
        rules: [{ name: 'DenyInternetInbound', priority: 100, direction: 'Inbound', access: 'Deny', source_address_prefix: 'Internet', destination_address_prefix: '*', destination_port_range: '*', protocol: '*' }],
        location: loc, resource_group: rg,
      },
      depends_on: ['log-rg'],
    },
  ];

  provenance.push(
    prov('network.vnet_name', vnetName, 'convention', `{prefix}-vnet-eo where prefix=${prefix}`),
    prov('network.vnet_cidr', vnetCidr, 'default', 'Default 10.0.0.0/16'),
    prov('network.pe_subnet', `${subnetPeName} ${subnetPeCidr}`, 'convention', 'snet-pe /27 from first available range'),
    prov('network.dns_zones', [`privatelink.vaultcore.${dnsSuffix}`, `privatelink.blob.core.${dnsSuffix}`], 'convention', `DNS zones with suffix ${dnsSuffix}`),
    prov('network.nsg', nsgPeName, 'convention', `{prefix}-nsg-pe with DenyInternetInbound`),
    prov('mgmtSubnetCidr', mgmtSubnetCidr, 'convention', '/27 from vnet octet[2]=2'),
    prov('identitySubnetCidr', identitySubnetCidr, 'convention', '/27 from vnet octet[2]=3'),
    prov('peSubnetCidr', peSubnetCidrVal, 'convention', '/27 from vnet octet[2]=4'),
    prov('fwSubnetCidr', fwSubnetCidr, 'convention', '/27 from vnet octet[2]=5'),
  );

  // ─── Section: Automation ───────────────────────────────────────

  const automation: InfraResourceSpec[] = [
    {
      resource_id: 'auto-account',
      resource_type: 'automation_account',
      name: autoName,
      control_ids: ['AU.L2-3.3.1'],
      registry_entry_ids: ['AZ-AUTO-001', 'AZ-AUTO-002'],
      properties: { sku: 'Basic', identity_type: 'SystemAssigned', location: loc, resource_group: rg },
      depends_on: ['log-rg'],
    },
    {
      resource_id: 'auto-rbac',
      resource_type: 'role_assignments',
      name: 'automation-rbac',
      control_ids: ['AC.L2-3.1.1', 'AC.L2-3.1.2', 'AU.L2-3.3.1'],
      registry_entry_ids: ['AZ-AUTO-003'],
      properties: {
        assignments: [
          { role: 'Security Reader', scope: 'subscription' },
          { role: 'Log Analytics Reader', scope: lawName },
          { role: 'Storage Blob Data Contributor', scope: saName },
          { role: 'Key Vault Crypto Service Encryption User', scope: kvName },
        ],
      },
      depends_on: ['auto-account', 'log-law', 'sto-sa', 'sto-kv'],
    },
  ];

  provenance.push(
    prov('automation.account_name', autoName, 'convention', `{prefix}-automation-eo where prefix=${prefix}`),
    prov('automation.rbac', ['Security Reader', 'Log Analytics Reader', 'Storage Blob Data Contributor', 'KV Crypto Service Encryption User'], 'convention', 'Least-privilege roles for evidence collection'),
  );

  // ─── Section: Diagnostics ──────────────────────────────────────

  const diagnostics: InfraResourceSpec[] = [
    {
      resource_id: 'diag-kv',
      resource_type: 'diagnostic_setting',
      name: 'kv-to-law',
      control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
      registry_entry_ids: ['AZ-DIAG-002'],
      properties: { target_resource: kvName, workspace: lawName, log_categories: ['AuditEvent', 'AzurePolicyEvaluationDetails'], metric_categories: ['AllMetrics'] },
      depends_on: ['sto-kv', 'log-law'],
    },
    {
      resource_id: 'diag-sa',
      resource_type: 'diagnostic_setting',
      name: 'sa-to-law',
      control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
      registry_entry_ids: ['AZ-DIAG-003'],
      properties: { target_resource: saName, workspace: lawName, log_categories: ['StorageRead', 'StorageWrite', 'StorageDelete'], metric_categories: ['AllMetrics'] },
      depends_on: ['sto-sa', 'log-law'],
    },
    {
      resource_id: 'diag-auto',
      resource_type: 'diagnostic_setting',
      name: 'auto-to-law',
      control_ids: ['AU.L2-3.3.1'],
      registry_entry_ids: ['AZ-DIAG-005'],
      properties: { target_resource: autoName, workspace: lawName, log_categories: ['JobLogs', 'JobStreams', 'DscNodeStatus'], metric_categories: ['AllMetrics'] },
      depends_on: ['auto-account', 'log-law'],
    },
    {
      resource_id: 'diag-sub',
      resource_type: 'diagnostic_setting',
      name: 'subscription-to-law',
      control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
      registry_entry_ids: ['AZ-DIAG-006'],
      properties: { scope: `/subscriptions/${subId}`, workspace: lawName, log_categories: ['Administrative', 'Security', 'ServiceHealth', 'Alert', 'Recommendation', 'Policy', 'Autoscale', 'ResourceHealth'] },
      depends_on: ['log-law'],
    },
  ];

  provenance.push(
    prov('diagnostics.targets', ['KeyVault', 'Storage', 'Automation', 'Subscription'], 'convention', 'All core resources route logs to LAW for CMMC AU.L2'),
  );

  // ─── Stamper Variable Map ──────────────────────────────────────

  const stamperVariableMap: InfraVariableMap = {
    subscriptionId: subId,
    resourceGroup: rg,
    location: loc,
    lawWorkspaceName: lawName,
    storageAccountName: saName,
    keyVaultName: kvName,
    cmkKeyName,
    vnetName,
    vnetCidr,
    mgmtSubnetCidr,
    identitySubnetCidr,
    peSubnetCidr: peSubnetCidrVal,
    fwSubnetCidr,
    subnetPeName,
    subnetPeCidr,
    nsgPeName,
    automationAccountName: autoName,
    eoAppDisplayName: eoDisplayName,
  };

  // ─── Registry Coverage ─────────────────────────────────────────

  const allSections = [identity, logging, security, storage, network, automation, diagnostics];
  const coveredIds = new Set<string>();
  for (const section of allSections) {
    for (const spec of section) {
      for (const id of spec.registry_entry_ids) {
        coveredIds.add(id);
      }
    }
  }

  const totalInfraEntries = 53;
  const registryCoverage: InfraRegistryCoverage = {
    total_infra_entries: totalInfraEntries,
    covered_entry_ids: Array.from(coveredIds),
    uncovered_entry_ids: [],
    coverage_pct: Math.round((coveredIds.size / totalInfraEntries) * 100),
  };

  // ─── Assemble ──────────────────────────────────────────────────

  return {
    ces: {
      artifact: 'infrastructure_manifest',
      version: '1.0.0',
      generated_on: new Date().toISOString(),
      intent: `CMMC ${targetLevel} Azure infrastructure specification for ${rg}`,
    },
    infrastructure_manifest: {
      identity,
      logging,
      security,
      storage,
      network,
      automation,
      diagnostics,
      stamper_variable_map: stamperVariableMap,
      registry_coverage: registryCoverage,
      provenance,
    },
  };
}

// ─── Infra Steps for Manual Plan ─────────────────────────────────

export interface InfraStep {
  id: string;
  title: string;
  task_type: string;
  priority: string;
  section: string;
  resource_type: string;
  control_coverage: Array<{ control_id: string; support_type: string; gap_rationale: string }>;
  actions: Array<{ action_id: string; action: string; action_type: string; evidence_outputs: string[] }>;
  what_to_do: string[];
  how_to_verify: string[];
  vendor_help_refs: Array<{ vendor: string; product: string; title: string }>;
  manual_completion_criteria: string[];
  expected_artifacts: Array<{ artifact_id: string; artifact_type: string; description: string; collector: string; retention_days: number; storage_location_ref: string }>;
  owner_role: string;
  estimated_effort_hours: number;
  effort_estimate: { one_time_dev_loe: number; one_time_config_manual: number; one_time_config_automated: number; recurring_evidence_manual: number; recurring_evidence_automated: number };
  dependencies: string[];
  gap_classifications: GapClassification[];
  requirement_context: { title: string; requirement_text: string; domain: string; level: string; nist_reference: string };
  layer: number;
}

/**
 * Convert an InfrastructureManifest into ordered steps for the Manual Mission Plan.
 * Uses DAG-based layer assignment from depends_on.
 */
export function deriveInfraSteps(manifest: InfrastructureManifest): InfraStep[] {
  const body = manifest.infrastructure_manifest;
  const sections: { name: string; specs: InfraResourceSpec[] }[] = [
    { name: 'identity', specs: body.identity },
    { name: 'logging', specs: body.logging },
    { name: 'security', specs: body.security },
    { name: 'storage', specs: body.storage },
    { name: 'network', specs: body.network },
    { name: 'automation', specs: body.automation },
    { name: 'diagnostics', specs: body.diagnostics },
  ];

  const allSpecs: Array<InfraResourceSpec & { section: string }> = [];
  for (const s of sections) {
    for (const spec of s.specs) {
      allSpecs.push({ ...spec, section: s.name });
    }
  }

  // Compute layers from dependency DAG
  const layerMap = infraLayerFromDAG(allSpecs);

  const steps: InfraStep[] = allSpecs.map(spec => {
    const layer = layerMap.get(spec.resource_id) ?? 0;
    const humanType = spec.resource_type.replace(/_/g, ' ');

    const effortHours = spec.registry_entry_ids.length > 0 ? 0.5 : 1;

    return {
      id: `infra_${spec.resource_id}`,
      title: `Provision ${humanType}: ${spec.name}`,
      task_type: 'configuration',
      priority: 'p1',
      section: spec.section,
      resource_type: spec.resource_type,
      control_coverage: spec.control_ids.map(cid => ({
        control_id: cid,
        support_type: 'Configurable',
        gap_rationale: `Azure infrastructure resource required for ${cid}`,
      })),
      actions: [{
        action_id: generateId('action'),
        action: `Deploy ${humanType} "${spec.name}"`,
        action_type: 'infrastructure_deployment',
        evidence_outputs: [`${spec.resource_type}_config_export`],
      }],
      what_to_do: [
        `Deploy Azure ${humanType} "${spec.name}" in resource group ${spec.properties.resource_group || spec.properties.location || '(from manifest)'}`,
        ...(spec.registry_entry_ids.length > 0
          ? [`Registry entries: ${spec.registry_entry_ids.join(', ')}`]
          : []),
        ...Object.entries(spec.properties)
          .filter(([k]) => !['location', 'resource_group'].includes(k))
          .slice(0, 3)
          .map(([k, v]) => `Set ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`),
      ],
      how_to_verify: [
        `Verify ${humanType} "${spec.name}" exists and is configured correctly`,
        `Confirm resource properties match infrastructure manifest spec`,
      ],
      vendor_help_refs: [{
        vendor: 'Microsoft',
        product: 'Azure',
        title: `${humanType} documentation`,
      }],
      manual_completion_criteria: [
        `${humanType} "${spec.name}" provisioned`,
        `Properties verified against manifest`,
        ...(spec.control_ids.length > 0 ? [`Controls satisfied: ${spec.control_ids.join(', ')}`] : []),
      ],
      expected_artifacts: [{
        artifact_id: generateId('evid'),
        artifact_type: 'config_export',
        description: `Configuration export for ${humanType} "${spec.name}"`,
        collector: 'az cli / portal export',
        retention_days: 2557,
        storage_location_ref: 'evidence_store',
      }],
      owner_role: 'azure_admin',
      estimated_effort_hours: effortHours,
      effort_estimate: {
        one_time_dev_loe: 0,
        one_time_config_manual: effortHours,
        one_time_config_automated: effortHours * 0.25,
        recurring_evidence_manual: 0.5,
        recurring_evidence_automated: 0.1,
      },
      dependencies: spec.depends_on.map(d => `infra_${d}`),
      gap_classifications: (spec.registry_entry_ids.length > 0 ? ['configure'] : ['manual']) as GapClassification[],
      requirement_context: {
        title: `${humanType}: ${spec.name}`,
        requirement_text: `Provision and configure ${humanType} for CMMC compliance`,
        domain: spec.control_ids[0]?.split('.')[0] || 'INFRA',
        level: 'L2',
        nist_reference: spec.control_ids[0] || '',
      },
      layer,
    };
  });

  // Sort by layer then original order
  steps.sort((a, b) => a.layer - b.layer);

  return steps;
}

function infraLayerFromDAG(specs: InfraResourceSpec[]): Map<string, number> {
  const layerMap = new Map<string, number>();
  const specById = new Map<string, InfraResourceSpec>();
  for (const s of specs) specById.set(s.resource_id, s);

  function computeLayer(id: string, visiting: Set<string>): number {
    if (layerMap.has(id)) return layerMap.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);

    const spec = specById.get(id);
    if (!spec || spec.depends_on.length === 0) {
      layerMap.set(id, 0);
      return 0;
    }

    let maxDep = 0;
    for (const depId of spec.depends_on) {
      const depLayer = computeLayer(depId, visiting);
      if (depLayer + 1 > maxDep) maxDep = depLayer + 1;
    }

    layerMap.set(id, maxDep);
    return maxDep;
  }

  const visiting = new Set<string>();
  for (const spec of specs) {
    computeLayer(spec.resource_id, visiting);
  }

  return layerMap;
}
