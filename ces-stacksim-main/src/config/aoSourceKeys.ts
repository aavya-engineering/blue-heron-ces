// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

/**
 * SIMFIX FIX-S2 / GOAL M1: AO registry `parameter.source` -> sim tenant-object
 * path (the Stamper tenant object `plan-data/<slug>/<slug>.json`, emitted by
 * buildSimTenantConfig). Published as docs/coverage/AO-SOURCE-TO-TENANT-KEY.md
 * and filed to ces-ao as docs/requirements/REQ-ao-source-paths.md.
 *
 * The keys match what ces-ao's SourceBindings.ts already tries (its
 * REQ-tenant-stacksim-ao-source-keys proposal), so AO binds them with no change.
 * `tenantId` is read by ces-tenant from `tenant.tenant_id`.
 */
export const AO_SOURCE_TO_TENANT_KEY: Record<string, string> = {
  tenantId: 'tenant.tenant_id',
  m365LicenseSkuId: 'resources.m365_license_sku_id',
  baseGroupId: 'resources.base_group_id',
  loaGroupId: 'resources.loa_group_id',
  adminGroupId: 'resources.admin_group_id',
  cuiGroupId: 'resources.cui_group_id',
  trainingEnforcementGroupId: 'resources.training_enforcement_group_id',
  namedLocationId: 'resources.named_location_id',
  deviceComplianceCaPolicyId: 'resources.device_compliance_ca_policy_id',
  adminPortalCaPolicyId: 'resources.admin_portal_ca_policy_id',
  androidAppProtectionPolicyId: 'resources.android_app_protection_policy_id',
  iosAppProtectionPolicyId: 'resources.ios_app_protection_policy_id',
  cuiSiteId: 'resources.cui_site_id',
  globalAdminRoleDefId: 'resources.global_admin_role_def_id',
  privilegedRoleAdminDefId: 'resources.privileged_role_admin_role_def_id',
  securityAdminRoleDefId: 'resources.security_admin_role_def_id',
  operatorUPN: 'resources.operator_upn',
  breakGlassUPN: 'resources.breakglass_upn',
  'resources.breakglass_upn': 'resources.breakglass_upn',
  itHelpDeskPhone: 'resources.it_helpdesk_phone',
  keyVaultName: 'resources.kv_name',
  auditLogRetentionDays: 'resources.audit_log_retention_days',
  sentinelWorkspaceName: 'resources.law_name',
  resourceGroupName: 'subscription.resource_group',
  'resources.resourceGroup': 'subscription.resource_group',
  'resources.firewallName': 'resources.firewall_name',
  'resources.vnetName': 'resources.vnet_name',
  'resources.publicIpName': 'resources.public_ip_name',
  'subscription.resource_group': 'subscription.resource_group',
  'resources.vnet_name': 'resources.vnet_name',
  'resources.storage_account_name': 'resources.storage_account_name',
  'resources.law_name': 'resources.law_name',
  // A local CSV path, not a tenant object: the sim publishes the path of its
  // fictional repo fixture (fixtures/training-roster.csv) so G-01/G-05 can run.
  trainingRosterPath: 'resources.training_roster_path',
  backupVaultName: 'resources.backup_vault_name',
};

/** Sources with no sim home, each with its reason. Empty: every current source is served. */
export const AO_SOURCES_NOT_APPLICABLE: Record<string, string> = {};

export function readPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
