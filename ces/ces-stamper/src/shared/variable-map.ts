// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Engine } from '../types/schema.types.js';

/**
 * Bidirectional mapping between camelCase variable names (used in ExecutionContext,
 * PlanTranslator, PowerShellAdapter) and snake_case tenant JSON resource keys.
 *
 * Single source of truth -- replaces inline maps in PlanTranslator, assess.routes,
 * variables.routes, and ResourceFallbackResolver.
 */
export const VARIABLE_MAPPING: Record<string, string> = {
  lawWorkspaceName: 'law_name',
  workspaceName: 'law_name',           // alias for M365 registry entries
  lawWorkspaceId: 'law_workspace_id',
  lawResourceId: 'law_resource_id',
  keyVaultName: 'kv_name',
  kvUri: 'kv_uri',
  kvResourceId: 'kv_resource_id',
  storageAccountName: 'storage_account_name',
  storageResourceId: 'storage_resource_id',
  storageMiPrincipalId: 'storage_mi_principal_id',
  automationAccountName: 'automation_account_name',
  automationResourceId: 'automation_resource_id',
  automationMiPrincipalId: 'automation_mi_principal_id',
  vnetName: 'vnet_name',
  vnetCidr: 'vnet_cidr',
  mgmtSubnetCidr: 'mgmt_subnet_cidr',
  workloadSubnetCidr: 'workload_subnet_cidr',
  bastionSubnetCidr: 'bastion_subnet_cidr',
  firewallSubnetCidr: 'firewall_subnet_cidr',
  nsgName: 'nsg_name',
  eoSpObjectId: 'eo_sp_object_id',
  cmkKeyName: 'cmk_key_name',
  cmkKeyVersion: 'cmk_key_version',
  cuiGroupName: 'cui_group_name',
  cuiGroupId: 'cui_group_id',
  breakGlassUPN: 'breakglass_upn',
  breakGlassUserId: 'break_glass_user_id',
  operatorUPN: 'operator_upn',
  approverUPN: 'approver_upn',           // W4-ST2: PIM approver (AC.L2-3.1.4.pim-approval)
  adminUserName: 'admin_username',
  primaryDomain: 'primary_domain',
  complianceRoleId: 'compliance_role_id',
  vmName: 'vm_name',
  cisoEmail: 'ciso_email',
  securityEmail: 'security_email',
  approvedIpRange: 'approved_ip_range',
  // SP-1 (R1, SECRETS-PLAN.md): initialPassword is NOT in this map. Every loop over VARIABLE_MAPPING
  // copies record values into plan variables (or persists resolved values back into the record), and a
  // secret-class variable (ces-shared SECRET_VARIABLE_NAMES) must never travel that way. Its record
  // field is the reference-only SECRET_REFERENCE_FIELDS below.
  touFileName: 'tou_file_name',
  touFileBase64: 'tou_file_base64',
  wifiSsid: 'wifi_ssid',
  roleDefId: 'role_def_id',
  phishingResistantStrengthId: 'phishing_resistant_strength_id',
  globalAdminRoleDefId: 'global_admin_role_def_id',
  privilegedRoleAdminDefId: 'privileged_role_admin_def_id',
  securityAdminRoleDefId: 'security_admin_role_def_id',
};

/**
 * SP-1 (R1, SECRETS-PLAN.md): the tenant-record field that may name a secret-class variable, and only
 * as a reference (`env:NAME` or `${NAME}`; ces-shared TenantConfig refuses a literal there and a literal
 * `resources.initial_password` on a live record). No gap-fill loop iterates this map: the value reaches
 * a command only through the secret overlay, never as a plain plan variable.
 */
export const SECRET_REFERENCE_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  initialPassword: 'initial_password_ref',
});

/** Reverse mapping: snake_case tenant JSON key -> camelCase variable name */
export const REVERSE_MAPPING: Record<string, string> = {};
for (const [camelKey, snakeKey] of Object.entries(VARIABLE_MAPPING)) {
  // First camelCase key wins for a given snake_case key (preserves canonical name)
  if (!(snakeKey in REVERSE_MAPPING)) {
    REVERSE_MAPPING[snakeKey] = camelKey;
  }
}

/**
 * Fallback spec: when a variable is missing, run a type-based "list" command
 * scoped to the resource group. If exactly 1 result, auto-populate.
 */
export interface FallbackSpec {
  variable: string;
  listCommand: string;
  nameProperty: string;
  engine: Engine;
  /** Additional variables to extract from the same result object */
  additionalCaptures?: Array<{ variable: string; property: string }>;
  /** Human-readable resource type for log messages */
  resourceType: string;
}

export const FALLBACK_SPECS: FallbackSpec[] = [
  {
    variable: 'lawWorkspaceName',
    listCommand: 'Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} | ConvertTo-Json',
    nameProperty: 'Name',
    engine: 'az',
    additionalCaptures: [
      { variable: 'lawWorkspaceId', property: 'CustomerId' },
      { variable: 'lawResourceId', property: 'ResourceId' },
    ],
    resourceType: 'Log Analytics Workspace',
  },
  {
    variable: 'workspaceName',
    listCommand: 'Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} | ConvertTo-Json',
    nameProperty: 'Name',
    engine: 'az',
    resourceType: 'Log Analytics Workspace (alias)',
  },
  {
    variable: 'keyVaultName',
    listCommand: 'Get-AzKeyVault -ResourceGroupName {resourceGroup} | ConvertTo-Json',
    nameProperty: 'VaultName',
    engine: 'az',
    additionalCaptures: [
      { variable: 'kvUri', property: 'VaultUri' },
      { variable: 'kvResourceId', property: 'ResourceId' },
    ],
    resourceType: 'Key Vault',
  },
  {
    variable: 'storageAccountName',
    listCommand: 'Get-AzStorageAccount -ResourceGroupName {resourceGroup} | ConvertTo-Json',
    nameProperty: 'StorageAccountName',
    engine: 'az',
    additionalCaptures: [{ variable: 'storageResourceId', property: 'Id' }],
    resourceType: 'Storage Account',
  },
  {
    variable: 'vnetName',
    listCommand: 'Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} | ConvertTo-Json',
    nameProperty: 'Name',
    engine: 'az',
    resourceType: 'Virtual Network',
  },
  {
    variable: 'automationAccountName',
    listCommand: 'Get-AzAutomationAccount -ResourceGroupName {resourceGroup} | ConvertTo-Json',
    nameProperty: 'AutomationAccountName',
    engine: 'az',
    resourceType: 'Automation Account',
  },
  {
    variable: 'vmName',
    listCommand: 'Get-AzVM -ResourceGroupName {resourceGroup} | ConvertTo-Json',
    nameProperty: 'Name',
    engine: 'az',
    resourceType: 'Virtual Machine',
  },
  // M365 resources (use Graph engine)
  {
    variable: 'cuiGroupName',
    listCommand: "Get-MgGroup -Filter \"startsWith(displayName,'CMMC')\" -Top 10 | ConvertTo-Json",
    nameProperty: 'DisplayName',
    engine: 'mgraph',
    resourceType: 'CUI Security Group',
  },
  // Azure resources requiring prior variable resolution
  {
    variable: 'nsgName',
    listCommand: 'Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} | ConvertTo-Json',
    nameProperty: 'Name',
    engine: 'az',
    resourceType: 'Network Security Group',
  },
  {
    variable: 'cmkKeyName',
    listCommand: 'Get-AzKeyVaultKey -VaultName {keyVaultName} | ConvertTo-Json',
    nameProperty: 'Name',
    engine: 'az',
    resourceType: 'Key Vault CMK Key',
  },
  // Entra role IDs (use Graph engine)
  {
    variable: 'complianceRoleId',
    listCommand: "Get-MgRoleManagementDirectoryRoleDefinition -Filter \"displayName eq 'Compliance Administrator'\" | ConvertTo-Json",
    nameProperty: 'Id',
    engine: 'mgraph',
    resourceType: 'Compliance Administrator Role',
  },
  {
    variable: 'phishingResistantStrengthId',
    listCommand: "Get-MgPolicyAuthenticationStrengthPolicy -All | Where-Object DisplayName -like 'CMMC-Phishing*' | ConvertTo-Json",
    nameProperty: 'Id',
    engine: 'mgraph',
    resourceType: 'Phishing-Resistant Auth Strength Policy',
  },
];

/** Set of variable names that can be resolved via tenant lookup */
export const RESOLVABLE_VARIABLES = new Set(FALLBACK_SPECS.map(s => s.variable));

/**
 * Default values for well-known constant variables.
 * These are Azure AD role definition IDs that are constant across all M365 tenants
 * and do not require per-tenant configuration.
 */
export const VARIABLE_DEFAULTS: Record<string, string> = {
  globalAdminRoleDefId: '62e90394-69f5-4237-9190-012177145e10',
  privilegedRoleAdminDefId: 'e8611ab8-c189-46e8-94e1-60213ab1f814',
  securityAdminRoleDefId: '194ae4cb-b126-40b2-bd5b-6091b380977d',
  // W5c7: no stated admin naming convention -> a pattern that matches no UPN (the licence test alone decides).
  adminNamingPattern: '(?!)',
};
