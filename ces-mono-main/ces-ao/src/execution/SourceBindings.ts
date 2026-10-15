// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO2 (2026-09-27): tenant-sourced parameter binding.
//
// The AO registry's `parameter.source` strings grew in three spellings:
// top-level camelCase (`m365LicenseSkuId`), camelCase under resources
// (`resources.firewallName`) and the Stamper tenant object's own snake_case
// (`resources.vnet_name`, `subscription.resource_group`). The tenant record is
// the Stamper tenant object (`plan-data/<slug>/<slug>.json`, parsed by
// ces-tenant), whose variable values live in `resources.<snake_case>` and
// `subscription.*` (founder decision 2026-09-26, INSTRUCTIONS-FROM-TESTER
// §2 update). This table is the ONE place that says where each registry
// source is read from.
//
// Resolution order for a source (first defined, non-empty value wins):
//   1. the registry source path itself, read literally (back-compat: records
//      that already carry the value at that path keep working);
//   2. the canonical tenant-object keys below, in order;
//   3. a PLATFORM constant, only where the value is identical in every Entra
//      tenant (built-in directory role template ids) — never tenant data.
// Nothing else: an unresolved source is reported by name with every key that
// was tried (`describeUnboundSource`), never guessed.
//
// Keys not yet emitted by tenant-stacksim are proposed in
// docs/requirements/REQ-tenant-stacksim-ao-source-keys.md.

export interface SourceBinding {
  /** Canonical tenant-object paths, tried in order after the literal source path. */
  keys: string[];
  /** A value identical in every Entra tenant (never tenant data), used only when no key resolves. */
  platformConstant?: { value: string; note: string };
  /**
   * The bound value names an Azure resource inside the enclave, so it is checked
   * against the tenant's cuiBoundary (G-AO-CMMC-BOUND-1 M3). Registry sources that
   * are literally `resources.*` are always checked (unchanged FX-AO1 behaviour);
   * directory identities (UPNs, group/policy ids) mapped from camelCase sources are
   * not resources in that sense and keep their previous, unchecked behaviour.
   */
  cuiChecked?: boolean;
}

/** Built-in Entra role template ids (= roleDefinitionId for built-in roles, the same in every tenant). */
export const BUILTIN_ROLE_TEMPLATE_IDS = {
  globalAdministrator: '62e90394-69f5-4237-9190-012177145e10',
  privilegedRoleAdministrator: 'e8611ab8-c189-46e8-94e1-60213ab1f814',
  securityAdministrator: '194ae4cb-b126-40b2-bd5b-6091b380977d',
} as const;

export const SOURCE_BINDINGS: Record<string, SourceBinding> = {
  // Identity of the tenant itself.
  tenantId: { keys: ['tenantId'] },

  // Operator / break-glass identities (already emitted by stacksim).
  operatorUPN: { keys: ['resources.operator_upn'] },
  breakGlassUPN: { keys: ['resources.breakglass_upn'] },
  'resources.breakglass_upn': { keys: ['resources.breakglass_upn'] },

  // Azure resources (already emitted by stacksim for m365_azure / m365_sentinel).
  keyVaultName: { cuiChecked: true, keys: ['resources.kv_name'] },
  sentinelWorkspaceName: { cuiChecked: true, keys: ['resources.law_name'] },
  'resources.law_name': { keys: ['resources.law_name'] },
  resourceGroupName: { keys: ['subscription.resource_group', 'resources.resource_group'] },
  'resources.resourceGroup': { keys: ['subscription.resource_group', 'resources.resource_group'] },
  'subscription.resource_group': { keys: ['subscription.resource_group'] },
  'resources.vnetName': { keys: ['resources.vnet_name'] },
  'resources.vnet_name': { keys: ['resources.vnet_name'] },
  'resources.storage_account_name': { keys: ['resources.storage_account_name'] },
  'resources.firewallName': { keys: ['resources.firewall_name'] },
  'resources.publicIpName': { keys: ['resources.public_ip_name'] },

  // Directory objects the tenant object must name (proposed keys).
  m365LicenseSkuId: { keys: ['resources.m365_license_sku_id'] },
  baseGroupId: { keys: ['resources.base_group_id'] },
  loaGroupId: { keys: ['resources.loa_group_id'] },
  adminGroupId: { keys: ['resources.admin_group_id'] },
  cuiGroupId: { keys: ['resources.cui_group_id'] },
  trainingEnforcementGroupId: { keys: ['resources.training_enforcement_group_id'] },
  namedLocationId: { keys: ['resources.named_location_id'] },
  deviceComplianceCaPolicyId: { keys: ['resources.device_compliance_ca_policy_id'] },
  adminPortalCaPolicyId: { keys: ['resources.admin_portal_ca_policy_id'] },
  androidAppProtectionPolicyId: { keys: ['resources.android_app_protection_policy_id'] },
  iosAppProtectionPolicyId: { keys: ['resources.ios_app_protection_policy_id'] },
  cuiSiteId: { keys: ['resources.cui_site_id'] },

  // Tenant policy values (proposed keys).
  auditLogRetentionDays: { keys: ['resources.audit_log_retention_days'] },
  itHelpDeskPhone: { keys: ['resources.it_helpdesk_phone'] },
  backupVaultName: { cuiChecked: true, keys: ['resources.backup_vault_name'] },
  trainingRosterPath: { keys: ['resources.training_roster_path'] },

  // Built-in role definitions: tenant key first, platform constant otherwise.
  globalAdminRoleDefId: {
    keys: ['resources.global_admin_role_def_id'],
    platformConstant: {
      value: BUILTIN_ROLE_TEMPLATE_IDS.globalAdministrator,
      note: 'built-in Global Administrator role template id (identical in every Entra tenant)',
    },
  },
  privilegedRoleAdminDefId: {
    keys: ['resources.privileged_role_admin_role_def_id'],
    platformConstant: {
      value: BUILTIN_ROLE_TEMPLATE_IDS.privilegedRoleAdministrator,
      note: 'built-in Privileged Role Administrator role template id (identical in every Entra tenant)',
    },
  },
  securityAdminRoleDefId: {
    keys: ['resources.security_admin_role_def_id'],
    platformConstant: {
      value: BUILTIN_ROLE_TEMPLATE_IDS.securityAdministrator,
      note: 'built-in Security Administrator role template id (identical in every Entra tenant)',
    },
  },
};

export type BindingOrigin = 'literal' | 'tenant-key' | 'platform-constant';

export interface ResolvedSource {
  value?: string;
  /** Path the value came from (the literal source, a tenant key, or 'platform:<note>'). */
  from?: string;
  origin?: BindingOrigin;
  /** Every path that was tried, in order (for the unbound error). */
  tried: string[];
  /** True when the bound value must pass the tenant's cuiBoundary check (see SourceBinding.cuiChecked). */
  resourceBound: boolean;
}

export function resolveDottedPath(obj: any, path: string): any {
  let current = obj;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && String(v) !== '';
}

/** True when a source is (or maps to) a `resources.*` tenant value — the CUI-boundary checked set. */
export function isResourceSource(source: string): boolean {
  return source.startsWith('resources.') || !!SOURCE_BINDINGS[source]?.cuiChecked;
}

/** Resolve a registry `source` against a tenant record. Never throws. */
export function resolveSource(tenantConfig: unknown, source: string): ResolvedSource {
  const tried: string[] = [source];
  const literal = resolveDottedPath(tenantConfig, source);
  if (present(literal)) {
    return { value: String(literal), from: source, origin: 'literal', tried, resourceBound: source.startsWith('resources.') };
  }
  const binding = SOURCE_BINDINGS[source];
  for (const key of binding?.keys ?? []) {
    if (key === source) continue;
    tried.push(key);
    const v = resolveDottedPath(tenantConfig, key);
    if (present(v)) {
      return { value: String(v), from: key, origin: 'tenant-key', tried, resourceBound: isResourceSource(source) };
    }
  }
  if (binding?.platformConstant) {
    return {
      value: binding.platformConstant.value,
      from: `platform:${binding.platformConstant.note}`,
      origin: 'platform-constant',
      tried,
      resourceBound: false,
    };
  }
  return { tried, resourceBound: isResourceSource(source) };
}

/** Human-readable reason a source did not bind. */
export function describeUnboundSource(paramName: string, source: string, tenantSlug: string | undefined, tried: string[]): string {
  return (
    `required tenant-sourced parameter "${paramName}" (source "${source}") is unknown for tenant ` +
    `"${tenantSlug ?? 'unknown'}": none of [${tried.join(', ')}] is set on the tenant record`
  );
}

/** Typed error for a required tenant-sourced parameter that is genuinely unknown. */
export class UnboundSourceError extends Error {
  constructor(
    message: string,
    public readonly unbound: Array<{ param: string; source: string; tried: string[] }>,
  ) {
    super(message);
    this.name = 'UnboundSourceError';
  }
}
