// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const fs = require('fs');

// Build the complete variable resolution map
// Sources: CONFIGURE card (ClientConfig) and PLAN VARIABLES card (PlanTranslator/assess route)

const CONFIGURE_CARD = {
  // Auth (top-level ClientConfig fields)
  tenantId: 'ClientConfig.tenantId',
  appId: 'ClientConfig.appId',
  certThumbprint: 'ClientConfig.certThumbprint',
  certPath: 'ClientConfig.certPath',
  tenantDomain: 'ClientConfig.targetTenantDomain',
  tenantName: 'derived: targetTenantDomain.split(".")[0]',

  // Subscription (ClientConfig.subscription)
  subscriptionId: 'ClientConfig.subscription.subscription_id',
  resourceGroup: 'ClientConfig.subscription.resource_group',
  location: 'ClientConfig.subscription.location',

  // Resources (ClientConfig.resources)
  lawWorkspaceName: 'resources.law_name',
  workspaceName: 'resources.law_name (alias)',
  lawWorkspaceId: 'resources.law_workspace_id',
  lawResourceId: 'resources.law_resource_id',
  keyVaultName: 'resources.kv_name',
  kvUri: 'resources.kv_uri',
  kvResourceId: 'resources.kv_resource_id',
  storageAccountName: 'resources.storage_account_name',
  storageResourceId: 'resources.storage_resource_id',
  storageMiPrincipalId: 'resources.storage_mi_principal_id',
  automationAccountName: 'resources.automation_account_name',
  automationResourceId: 'resources.automation_resource_id',
  automationMiPrincipalId: 'resources.automation_mi_principal_id',
  vnetName: 'resources.vnet_name',
  nsgName: 'resources.nsg_name',
  eoSpObjectId: 'resources.eo_sp_object_id',
  cmkKeyName: 'resources.cmk_key_name',
  cmkKeyVersion: 'resources.cmk_key_version',
  cuiGroupName: 'resources.cui_group_name',
  breakGlassUPN: 'resources.breakglass_upn',
  operatorUPN: 'resources.operator_upn',
  adminUserName: 'resources.admin_username',
  primaryDomain: 'resources.primary_domain',
  complianceRoleId: 'resources.compliance_role_id',
  vmName: 'resources.vm_name',
  cisoEmail: 'resources.ciso_email',
  securityEmail: 'resources.security_email',
  approvedIpRange: 'resources.approved_ip_range',
  initialPassword: 'resources.initial_password',
  touFileName: 'resources.tou_file_name',
  touFileBase64: 'resources.tou_file_base64',
  wifiSsid: 'resources.wifi_ssid',
  roleDefId: 'resources.role_def_id',
};

const INFRA_MANIFEST = {
  vnetCidr: 'infraManifest.network.vnet_cidr',
  mgmtSubnetCidr: 'infraManifest.network.mgmt_subnet_cidr',
  workloadSubnetCidr: 'infraManifest.network.workload_subnet_cidr',
  bastionSubnetCidr: 'infraManifest.network.bastion_subnet_cidr',
  firewallSubnetCidr: 'infraManifest.network.firewall_subnet_cidr',
  vmImage: 'infraManifest.diagnostics.vm_image',
  vmSize: 'infraManifest.diagnostics.vm_size',
};

function resolveSource(varName) {
  if (CONFIGURE_CARD[varName]) return { source: 'CONFIGURE', detail: CONFIGURE_CARD[varName] };
  if (INFRA_MANIFEST[varName]) return { source: 'INFRA MANIFEST', detail: INFRA_MANIFEST[varName] };
  return { source: 'UNRESOLVABLE', detail: 'No known source' };
}

const audit = JSON.parse(fs.readFileSync('variable-audit.json', 'utf-8'));
const all = [...audit.m365.map(e => ({ ...e, registry: 'M365' })), ...audit.infra.map(e => ({ ...e, registry: 'Infra' }))];

// Collect all unique variables across all entries
const allVars = new Set();
for (const e of all) {
  for (const v of e.cmdVars) allVars.add(v);
}

console.log('=== VARIABLE RESOLUTION MAP ===');
console.log('Total unique variables across both registries: ' + allVars.size);
console.log('');

const sorted = [...allVars].sort();
const unresolvable = [];
for (const v of sorted) {
  const r = resolveSource(v);
  if (r.source === 'UNRESOLVABLE') unresolvable.push(v);
}

if (unresolvable.length > 0) {
  console.log('!!! UNRESOLVABLE VARIABLES: ' + unresolvable.join(', '));
  console.log('');
}

// Full map
for (const v of sorted) {
  const r = resolveSource(v);
  const tag = r.source === 'UNRESOLVABLE' ? ' <<<' : '';
  console.log('  ' + v + ' -> ' + r.source + ' (' + r.detail + ')' + tag);
}

// Now generate per-entry walkthrough data
const walkthrough = all.map((e, idx) => {
  const varDetails = e.cmdVars.map(v => {
    const r = resolveSource(v);
    const isRuntime = e.variables_runtime.includes(v);
    return {
      name: v,
      source: isRuntime ? 'RUNTIME CAPTURE' : r.source,
      detail: isRuntime ? 'captured at execution time' : r.detail
    };
  });
  return {
    index: idx + 1,
    registry: e.registry,
    entry_id: e.entry_id,
    label: e.label,
    engine: e.engine,
    cmdVars: e.cmdVars,
    variables_required: e.variables_required,
    variables_runtime: e.variables_runtime,
    inCmdNotDeclared: e.inCmdNotDeclared,
    declaredNotInCmd: e.declaredNotInCmd,
    varDetails
  };
});

fs.writeFileSync('variable-walkthrough.json', JSON.stringify(walkthrough, null, 2));
console.log('');
console.log('Walkthrough data written to variable-walkthrough.json (' + walkthrough.length + ' entries)');
