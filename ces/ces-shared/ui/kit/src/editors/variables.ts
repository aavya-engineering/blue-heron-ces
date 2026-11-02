// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Tenant config schema and variable rules, ported from ces-stamper/public/unified-variables.html
// (Config tab markup, serializeConfigForm, renderVariablesForm, serializeVariablesForm,
// classifyVariable, getVariableTooltip).

export type TenantConfig = Record<string, unknown>;
export type TenantVariables = Record<string, unknown>;

export interface ConfigField {
  /** Dotted path into the tenant config (legacy `data-path`). */
  path: string;
  /** Label = the last path segment, as in the legacy page. */
  label: string;
  tooltip: string;
  kind?: 'text' | 'password' | 'select';
  options?: readonly string[];
  placeholder?: string;
  /** Legacy `.resource-id` (full Azure resource id: wide field). */
  resourceId?: boolean;
}

export interface ConfigSection {
  /** Legacy id prefix: `<prefix>Body`, `<prefix>Count`. */
  prefix: string;
  title: string;
  collapsed?: boolean;
  fields: readonly ConfigField[];
  /** The Resources section carries the Terms of Use PDF row. */
  termsOfUse?: boolean;
}

const f = (path: string, tooltip: string, extra: Partial<ConfigField> = {}): ConfigField => ({
  path,
  label: path.split('.').pop() as string,
  tooltip,
  ...extra,
});

export const TOU_NAME_PATH = 'resources.tou_file_name';
export const TOU_BASE64_PATH = 'resources.tou_file_base64';
export const TOU_MAX_BYTES = 3 * 1024 * 1024;

export const TENANT_CONFIG_SECTIONS: readonly ConfigSection[] = [
  {
    prefix: 'cfgClient',
    title: 'Client',
    fields: [
      f('client.slug', 'Unique tenant identifier (alphanumeric + hyphens/underscores). Used in file paths and URLs.'),
      f('client.name', 'Human-readable organization name. Displayed in reports and UI headers.'),
      f('client.engagement_id', 'Unique engagement tracking number. Links this tenant to contract/project records.'),
    ],
  },
  {
    prefix: 'cfgTenant',
    title: 'Tenant',
    fields: [
      f('tenant.tenant_id', 'Azure AD/Entra tenant GUID. Identifies the M365 tenant for authentication.'),
      f('tenant.domain', 'Primary tenant domain (e.g., example.onmicrosoft.us). Used for M365 API connections.'),
      f('tenant.environment', 'Cloud environment type (gcchigh/gcc/commercial). Determines API endpoints and compliance requirements.', {
        kind: 'select',
        options: ['gcchigh', 'gcc', 'commercial'],
      }),
    ],
  },
  {
    prefix: 'cfgAuth',
    title: 'Auth',
    fields: [
      f('auth.app_id', 'Enterprise application client ID. Used for certificate-based authentication to M365/Azure.'),
      f('auth.cert_thumbprint', 'Certificate thumbprint (40-char hex). Identifies the authentication certificate in local store.', { kind: 'password' }),
      f('auth.cert_path', 'Filesystem path to PFX/CER certificate. Used for PowerShell session establishment.'),
    ],
  },
  {
    prefix: 'cfgEndpoints',
    title: 'Endpoints',
    collapsed: true,
    fields: [
      f('endpoints.graph', 'Microsoft Graph API endpoint URL. Environment-specific (commercial vs GCC High).'),
      f('endpoints.login', 'Azure AD login endpoint URL. Used for token acquisition.'),
      f('endpoints.compliance_uri', 'Security & Compliance Center endpoint. Used for DLP, retention, audit log access.'),
      f('endpoints.exchange_env', 'Exchange Online environment name (O365USGovGCCHigh/O365Default). Used by ExchangeOnlineManagement module.'),
      f('endpoints.azure_auth', 'Azure authentication endpoint URL. Used for Azure PowerShell and CLI connections.'),
      f('endpoints.arm', 'Azure Resource Manager endpoint URL. Used for Azure resource management.'),
    ],
  },
  {
    prefix: 'cfgSubscription',
    title: 'Subscription',
    fields: [
      f('subscription.subscription_id', 'Azure subscription GUID. Identifies the Azure subscription for infrastructure deployment.'),
      f('subscription.resource_group', 'Azure resource group name. Container for all CMMC-related Azure resources.'),
      f('subscription.location', 'Azure region code (usgovvirginia/usgovarizona). Physical location for resource deployment.'),
    ],
  },
  {
    prefix: 'cfgResources',
    title: 'Resources',
    collapsed: true,
    termsOfUse: true,
    fields: [
      f('resources.law_name', 'Log Analytics Workspace name. Central logging repository for security events and audit logs.'),
      f('resources.law_workspace_id', 'Log Analytics Workspace GUID. Unique identifier for KQL queries and agent configuration.'),
      f('resources.law_resource_id', 'Log Analytics full Azure resource ID. Used for diagnostic settings and RBAC assignments.', { resourceId: true }),
      f('resources.kv_name', 'Key Vault name. Stores secrets, keys, and certificates for encryption and authentication.'),
      f('resources.kv_uri', 'Key Vault URI (the vault DNS name, ending in vault.usgovcloudapi.net). Endpoint for secret retrieval and key operations.'),
      f('resources.kv_resource_id', 'Key Vault full Azure resource ID. Used for access policies and diagnostic settings.', { resourceId: true }),
      f('resources.storage_account_name', 'Storage Account name. Stores evidence artifacts, logs, and compliance documentation.'),
      f('resources.storage_resource_id', 'Storage Account full Azure resource ID. Used for RBAC and CMK encryption configuration.', { resourceId: true }),
      f('resources.storage_mi_principal_id', 'Storage Account Managed Identity principal ID. Used for Key Vault access without secrets.'),
      f('resources.automation_account_name', 'Automation Account name. Hosts runbooks for automated compliance checks and remediation.'),
      f('resources.automation_resource_id', 'Automation Account full Azure resource ID. Used for RBAC and diagnostic settings.', { resourceId: true }),
      f('resources.automation_mi_principal_id', 'Automation Account Managed Identity principal ID. Used for authenticated runbook execution.'),
      f('resources.vnet_name', 'Virtual Network name. Network isolation boundary for secure enclaves.'),
      f('resources.nsg_name', 'Network Security Group name. Firewall rules for inbound/outbound traffic control.'),
      f('resources.eo_sp_object_id', 'Exchange Online service principal object ID. Used for mailbox encryption with customer-managed keys.'),
      f('resources.cmk_key_name', 'Customer-Managed Key name in Key Vault. Used for encryption of M365 data at rest.'),
      f('resources.cmk_key_version', 'CMK version GUID. Specific key version for encryption operations (supports key rotation).'),
      f('resources.cui_group_name', 'Security group name for CUI access. Membership determines access to Controlled Unclassified Information.'),
      f('resources.breakglass_upn', 'Break-glass admin UPN (user@domain.us). Emergency access account excluded from MFA/Conditional Access.'),
      f('resources.operator_upn', 'Operator admin UPN. Primary administrative account for daily operations and compliance execution.'),
      f('resources.admin_username', 'Local admin username for Azure VMs. Used for initial VM provisioning and recovery.'),
      f('resources.primary_domain', 'Primary vanity domain (example.gov). Custom domain for user email addresses and SharePoint sites.', {
        placeholder: 'example.onmicrosoft.us',
      }),
      f('resources.vm_name', 'Virtual machine name. Jump box or secure enclave VM for administrative access.', { placeholder: 'az-vm-enclave-01' }),
      f('resources.ciso_email', 'CISO email address. Receives security alerts, audit reports, and compliance notifications.', {
        placeholder: 'ciso@example.gov',
      }),
      f('resources.security_email', 'Security team email. Distribution list for security incidents and vulnerability alerts.', {
        placeholder: 'security@example.gov',
      }),
      f('resources.compliance_role_id', 'Compliance Administrator role definition ID. Custom RBAC role for compliance operations.', {
        placeholder: '00000000-0000-0000-0000-000000000000',
      }),
      f('resources.role_def_id', 'Custom role definition GUID. Application-specific RBAC role for least-privilege access.', {
        placeholder: '00000000-0000-0000-0000-000000000000',
      }),
      f('resources.wifi_ssid', 'Secure WiFi network name. Enclave wireless network for CUI access.', { placeholder: 'EnclaveSecureWiFi' }),
      f('resources.approved_ip_range', 'Approved IP CIDR range (10.0.0.0/24). Whitelist for Conditional Access and firewall rules.', {
        placeholder: '10.0.0.0/24',
      }),
      f('resources.initial_password', 'Initial VM password. Temporary password for first-time VM login (must be changed).', {
        kind: 'password',
        placeholder: 'Initial VM password',
      }),
    ],
  },
  {
    prefix: 'cfgOnboarding',
    title: 'Onboarding',
    collapsed: true,
    fields: [
      f('onboarding.bootstrapped_at', 'Tenant bootstrap timestamp (ISO 8601). Records when tenant config was first created.'),
      f('onboarding.bootstrapped_by', 'Bootstrap operator name/email. Audit trail for tenant provisioning.'),
      f('onboarding.cert_expires', 'Certificate expiration date (ISO 8601). Tracks authentication certificate lifecycle for renewal planning.'),
    ],
  },
];

/** Every config path in form order, including the two hidden Terms of Use paths (legacy DOM order). */
export function configPaths(): string[] {
  return TENANT_CONFIG_SECTIONS.flatMap((s) => [...s.fields.map((x) => x.path), ...(s.termsOfUse ? [TOU_NAME_PATH, TOU_BASE64_PATH] : [])]);
}

export function getPath(config: TenantConfig, path: string): unknown {
  let value: unknown = config;
  for (const part of path.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  return value;
}

/** Legacy populateConfigForm: `el.value = val || ''`. */
export function configToDraft(config: TenantConfig): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const path of configPaths()) {
    const value = getPath(config, path);
    draft[path] = value ? String(value) : '';
  }
  return draft;
}

/** Legacy serializeConfigForm: empty values dropped, `last_session` carried over from the original. */
export function serializeConfig(draft: Record<string, string>, original: TenantConfig): TenantConfig {
  const cfg: Record<string, unknown> = {};
  for (const path of configPaths()) {
    const value = draft[path] ?? '';
    if (!value && value !== '0') continue;
    const parts = path.split('.');
    let obj = cfg;
    for (const part of parts.slice(0, -1)) {
      if (!obj[part]) obj[part] = {};
      obj = obj[part] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
  }
  if (original.last_session) cfg.last_session = original.last_session;
  return cfg;
}

export const TENANT_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type VariableCategory = 'cui' | 'tcp' | 'si';
export const VARIABLE_CATEGORY_ORDER: readonly VariableCategory[] = ['cui', 'tcp', 'si'];
export const VARIABLE_CATEGORY_LABELS: Record<VariableCategory, string> = {
  cui: 'Controlled Unclassified Information',
  tcp: 'Tenant Configuration Parameters',
  si: 'Sensitive Information',
};

/** Legacy classifyVariable. */
export function classifyVariable(name: string): VariableCategory {
  if (/password|secret|key|token|thumbprint|cert_path/i.test(name)) return 'si';
  if (/email|upn|name|domain|tenant|app_id|subscription|resource|location|group|ip|ssid/i.test(name)) return 'cui';
  return 'tcp';
}

/** Legacy: keys starting `_` or `config_intent.` are not shown. */
export function isShownVariable(name: string): boolean {
  return !name.startsWith('_') && !name.startsWith('config_intent.');
}

const VARIABLE_TOOLTIPS: Record<string, string> = {
  tenantId: 'Azure AD tenant GUID',
  appId: 'Enterprise application client ID',
  domain: 'Tenant primary domain',
  subscriptionId: 'Azure subscription GUID',
  resourceGroup: 'Azure resource group name',
  location: 'Azure region',
  environment: 'Cloud environment type',
  lawName: 'Log Analytics Workspace name',
  lawWorkspaceName: 'Log Analytics Workspace name',
  lawWorkspaceId: 'Log Analytics Workspace GUID',
  lawResourceId: 'Log Analytics full Azure resource ID',
  kvName: 'Key Vault name',
  keyVaultName: 'Key Vault name',
  kvUri: 'Key Vault URI',
  kvResourceId: 'Key Vault full Azure resource ID',
  storageAccountName: 'Storage Account name',
  storageResourceId: 'Storage Account full Azure resource ID',
  storageMiPrincipalId: 'Storage Account Managed Identity principal ID',
  automationAccountName: 'Automation Account name',
  automationResourceId: 'Automation Account full Azure resource ID',
  automationMiPrincipalId: 'Automation Account Managed Identity principal ID',
  vnetName: 'Virtual Network name',
  nsgName: 'Network Security Group name',
  eoSpObjectId: 'Exchange Online service principal object ID',
  cmkKeyName: 'Customer-Managed Key name in Key Vault',
  cmkKeyVersion: 'CMK version GUID',
  cuiGroupName: 'Security group name for CUI access',
  breakglassUpn: 'Break-glass admin UPN',
  breakGlassUPN: 'Break-glass admin UPN',
  operatorUpn: 'Operator admin UPN',
  adminUsername: 'Local admin username for Azure VMs',
  primaryDomain: 'Primary vanity domain',
  vmName: 'Virtual machine name',
  cisoEmail: 'CISO email address',
  securityEmail: 'Security team email',
  complianceRoleId: 'Compliance Administrator role definition ID',
  roleDefId: 'Custom role definition GUID',
  wifiSsid: 'Secure WiFi network name',
  approvedIpRange: 'Approved IP CIDR range',
  initialPassword: 'Initial VM password',
  certThumbprint: 'Certificate thumbprint',
  certPath: 'Certificate file path',
  touFileBase64: 'Terms of Use PDF base64 encoded',
  clientName: 'Human-readable organization name',
  tenantName: 'SharePoint tenant name prefix',
};

/** Legacy getVariableTooltip, with the category fallback. */
export function variableTooltip(name: string, category: VariableCategory): string {
  if (Object.prototype.hasOwnProperty.call(VARIABLE_TOOLTIPS, name)) return VARIABLE_TOOLTIPS[name];
  if (category === 'si') return 'Secrets, credentials, and cryptographic material requiring encryption at rest.';
  if (category === 'cui') return 'Controlled Unclassified Information requiring access control and audit trails.';
  return 'Non-sensitive technical settings and configuration values.';
}

/** Legacy input value: null/undefined become ''. */
export function variablesToDraft(vars: TenantVariables): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) {
    if (!isShownVariable(name)) continue;
    draft[name] = value === null || value === undefined ? '' : String(value);
  }
  return draft;
}

/** Legacy serializeVariablesForm: 'true'/'false' to booleans, numeric strings without padding to numbers. */
export function serializeVariables(draft: Record<string, string>): TenantVariables {
  const vars: TenantVariables = {};
  for (const [name, raw] of Object.entries(draft)) {
    let value: unknown = raw;
    if (raw === 'true') value = true;
    else if (raw === 'false') value = false;
    else if (raw !== '' && !Number.isNaN(Number(raw)) && raw.trim() === raw) value = Number(raw);
    vars[name] = value;
  }
  return vars;
}
