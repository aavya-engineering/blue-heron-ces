// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { generateAllModules } from '../../src/codegen/generatePsModule.js';
import {
  CLEAN_G5_BREAK_GLASS_UPNS,
  CLEAN_G5_GRAPH_APP_ROLES,
  CLEAN_G5_OPERATOR_UPN,
  CLEAN_G5_SUBSCRIPTION_ID,
  CLEAN_G5_TENANT_ID,
  FIRST_PARTY_APP_IDS,
} from '../../src/profiles/clean-g5.js';

/**
 * FIN-21 (2026-10-31): Stamper's tenant initialization on the clean G5
 * tenant, call by call, in the order and with the arguments the real code
 * sends (scripts/New-TenantBootstrap.ps1, GET /api/preflight in
 * execute.routes.ts, BaselineProvisioner.ts). The psmodule wrappers forward
 * `$args` verbatim and PowerShell unrolls a one-item array, so `one()`
 * mirrors that; `-ErrorAction SilentlyContinue` turns a sim 404 into no
 * output (`quiet()`).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
type Row = Record<string, any>;

const one = (v: unknown): Row => (Array.isArray(v) && v.length === 1 ? v[0] : v) as Row;
const pick = (o: Row, k: string) => o[Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k];

describe('FIN-21: clean-g5 tenant - bootstrap, preflight, baseline', () => {
  let dir: string;
  let store: ObjectStore;
  let t: ResolverTable;
  const call = (cmdlet: string, args: unknown[] = []) => t.resolveCmdlet(cmdlet, args);
  const quiet = async (cmdlet: string, args: unknown[]) => {
    try {
      return await call(cmdlet, [...args, '-ErrorAction', 'SilentlyContinue']);
    } catch {
      return undefined;
    }
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-fin21-'));
    const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', 'clean-g5.json'));
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot: path.join(dir, 'tenant') });
    store = new ObjectStore(path.join(dir, 'tenant', 'store.json'));
    t = new ResolverTable(store, new StackShapeGate('m365_azure'));
  }, 60_000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('is clean: no CES app, no grants, Security Defaults on, no Azure resources, two break-glass accounts, G5 licences', async () => {
    expect(await store.list('applications')).toEqual([]);
    expect((await store.list('servicePrincipals')).map((s) => (s as Row).appId).sort()).toEqual(Object.values(FIRST_PARTY_APP_IDS).sort());
    expect(await store.list('servicePrincipalAppRoleAssignments')).toEqual([]);
    expect(await store.list('caPolicies')).toEqual([]);
    expect(one(await call('Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy')).isEnabled).toBe(true);
    for (const c of ['storageAccounts', 'keyVaults', 'logAnalyticsWorkspaces', 'automationAccounts', 'vnets', 'nsgs', 'keyVaultKeys', 'firewalls']) {
      expect(await store.list(c), c).toEqual([]);
    }
    expect((await store.list('armResources')).map((r) => (r as Row).type)).toEqual(['Microsoft.Resources/subscriptions']);
    for (const upn of CLEAN_G5_BREAK_GLASS_UPNS) {
      const u = one(await call('Get-MgUser', ['-Filter', `userPrincipalName eq '${upn}'`]));
      expect(u).toMatchObject({ userPrincipalName: upn, accountEnabled: true, onPremisesSyncEnabled: null });
    }
    const sku = one(await call('Get-MgSubscribedSku', ['-All']));
    expect(sku.prepaidUnits.enabled - sku.consumedUnits).toBeGreaterThan(0);
    expect(one(await call('Get-MgOrganization')).id).toBe(CLEAN_G5_TENANT_ID);
    expect(one(await call('Get-OrganizationConfig')).IsDehydrated).toBe(true);
  });

  let app: Row;
  let sp: Row;
  const graphSp = async () => one(await call('Get-MgServicePrincipal', ['-Filter', `appId eq '${FIRST_PARTY_APP_IDS.microsoftGraph}'`]));

  it('bootstrap: app registration, certificate appended (thumbprint, no key material), service principal', async () => {
    expect(await call('Get-MgApplication', ['-Filter', "displayName eq 'CES-Clean'", '-ErrorAction', 'Stop'])).toEqual([]);
    app = (await call('New-MgApplication', ['-DisplayName', 'CES-Clean', '-SignInAudience', 'AzureADMyOrg', '-ErrorAction', 'Stop'])) as Row;
    expect(app.appId).toMatch(/^[0-9a-f-]{36}$/);
    expect(one(await call('Get-MgApplication', ['-Filter', "displayName eq 'CES-Clean'"])).id).toBe(app.id);

    // The script sends Key = UTF8 bytes of the base64 .cer text.
    const der = Buffer.from('sim-certificate-der-bytes-for-fin21');
    const keyBytes = [...Buffer.from(der.toString('base64'), 'utf8')];
    const current = one(await call('Get-MgApplication', ['-ApplicationId', app.id, '-Property', 'id,keyCredentials', '-ErrorAction', 'Stop']));
    const merged = [...(current.keyCredentials ?? []), { Type: 'AsymmetricX509Cert', Usage: 'Verify', Key: keyBytes }];
    await call('Update-MgApplication', ['-ApplicationId', app.id, '-KeyCredentials', merged, '-ErrorAction', 'Stop']);
    let after = one(await call('Get-MgApplication', ['-ApplicationId', app.id]));
    expect(after.keyCredentials).toHaveLength(1);
    expect(after.keyCredentials[0].key).toBeNull();
    expect(after.keyCredentials[0].customKeyIdentifier).toMatch(/^[0-9A-F]{40}$/);

    // A rerun APPENDS: the existing credential (read back without key material) is kept by keyId.
    const second = [...after.keyCredentials, { Type: 'AsymmetricX509Cert', Usage: 'Verify', Key: [...Buffer.from(Buffer.from('second-cert').toString('base64'))] }];
    await call('Update-MgApplication', ['-ApplicationId', app.id, '-KeyCredentials', second]);
    after = one(await call('Get-MgApplication', ['-ApplicationId', app.id]));
    expect(after.keyCredentials).toHaveLength(2);
    await expect(call('Update-MgApplication', ['-ApplicationId', app.id, '-KeyCredentials', [{ keyId: 'not-a-credential' }]])).rejects.toThrow(/not one of the application's credentials/);

    expect(await call('Get-MgServicePrincipal', ['-Filter', `appId eq '${app.appId}'`, '-ErrorAction', 'Stop'])).toEqual([]);
    sp = (await call('New-MgServicePrincipal', ['-AppId', app.appId, '-ErrorAction', 'Stop'])) as Row;
    expect(one(await call('Get-MgServicePrincipal', ['-Filter', `appId eq '${app.appId}'`])).id).toBe(sp.id);
    await expect(call('New-MgServicePrincipal', ['-AppId', app.appId])).rejects.toThrow(/already exists/);
    await expect(call('New-MgServicePrincipal', ['-AppId', 'no-such-app'])).rejects.toThrow(/no application/);
  });

  it('bootstrap: app-role grants land once each and read back; a duplicate or unknown role is a 400', async () => {
    const graph = await graphSp();
    const exo = one(await call('Get-MgServicePrincipal', ['-Filter', `appId eq '${FIRST_PARTY_APP_IDS.exchangeOnline}'`]));
    const grant = (resource: Row, value: string) =>
      call('New-MgServicePrincipalAppRoleAssignment', [
        '-ServicePrincipalId', sp.id, '-PrincipalId', sp.id, '-ResourceId', resource.id,
        '-AppRoleId', resource.appRoles.find((r: Row) => r.value === value).id, '-ErrorAction', 'Stop',
      ]);
    const wanted = CLEAN_G5_GRAPH_APP_ROLES.filter((v) => v !== 'Mail.Read' && v !== 'Sites.Read.All');
    for (const v of wanted) await grant(graph, v);
    await grant(exo, 'Exchange.ManageAsApp');
    const assigned = (await call('Get-MgServicePrincipalAppRoleAssignment', ['-ServicePrincipalId', sp.id, '-All'])) as Row[];
    expect(assigned).toHaveLength(wanted.length + 1);
    expect(new Set(assigned.map((a) => a.appRoleId)).size).toBe(wanted.length + 1);
    expect(assigned.every((a) => a.principalId === sp.id)).toBe(true);
    await expect(grant(graph, 'Directory.ReadWrite.All')).rejects.toThrow(/already exists/);
    await expect(
      call('New-MgServicePrincipalAppRoleAssignment', ['-ServicePrincipalId', sp.id, '-PrincipalId', sp.id, '-ResourceId', graph.id, '-AppRoleId', '00000000-dead-4000-8000-000000000000']),
    ).rejects.toThrow(/not found on application/);
  });

  it('bootstrap: Azure subscription roles for the app (Contributor + User Access Administrator)', async () => {
    const scope = `/subscriptions/${CLEAN_G5_SUBSCRIPTION_ID}`;
    for (const role of ['Contributor', 'User Access Administrator']) {
      expect(await call('Get-AzRoleAssignment', ['-ObjectId', sp.id, '-RoleDefinitionName', role, '-Scope', scope, '-ErrorAction', 'Stop'])).toEqual([]);
      await call('New-AzRoleAssignment', ['-ObjectId', sp.id, '-RoleDefinitionName', role, '-Scope', scope, '-ErrorAction', 'Stop']);
      expect(one(await call('Get-AzRoleAssignment', ['-ObjectId', sp.id, '-RoleDefinitionName', role, '-Scope', scope]))).toMatchObject({ RoleDefinitionName: role, Scope: scope });
    }
  });

  it('bootstrap: Security Defaults turned off at the operator\'s confirmation, and the read sees it', async () => {
    await call('Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy', ['-BodyParameter', { isEnabled: false }, '-ErrorAction', 'Stop']);
    expect(one(await call('Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy')).isEnabled).toBe(false);
    await expect(call('Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy', ['-BodyParameter', {}])).rejects.toThrow(/isEnabled/);
  });

  it('bootstrap: licence check (steps 1) and licence assignment to the operator (step 18) move consumedUnits', async () => {
    const before = one(await call('Get-MgSubscribedSku', ['-All']));
    const op = one(await call('Get-MgUser', ['-Filter', `userPrincipalName eq '${CLEAN_G5_OPERATOR_UPN}'`, '-Property', 'id,userPrincipalName,assignedLicenses']));
    expect(op.assignedLicenses).toEqual([]);
    await call('Set-MgUserLicense', ['-UserId', op.id, '-AddLicenses', [{ SkuId: before.skuId }], '-RemoveLicenses', [], '-ErrorAction', 'Stop']);
    const opAfter = one(await call('Get-MgUser', ['-UserId', op.id]));
    expect(opAfter.assignedLicenses.map((l: Row) => l.skuId)).toEqual([before.skuId]);
    expect(one(await call('Get-MgSubscribedSku')).consumedUnits).toBe(before.consumedUnits + 1);
  });

  it('preflight: finds the SP and Graph app roles, sees the grants, assigns the three directory roles once', async () => {
    const graph = await graphSp();
    expect(pick(graph, 'appRoles').map((r: Row) => pick(r, 'value'))).toEqual(expect.arrayContaining(['AppRoleAssignment.ReadWrite.All', 'RoleManagement.ReadWrite.Directory']));
    for (const roleName of ['Exchange Administrator', 'SharePoint Administrator', 'Compliance Administrator']) {
      const def = one(await call('Get-MgRoleManagementDirectoryRoleDefinition', ['-Filter', `displayName eq '${roleName}'`]));
      expect(def.displayName).toBe(roleName);
      const filter = `principalId eq '${sp.id}' and roleDefinitionId eq '${def.id}'`;
      expect(await call('Get-MgRoleManagementDirectoryRoleAssignment', ['-Filter', filter])).toEqual([]);
      await call('New-MgRoleManagementDirectoryRoleAssignment', ['-PrincipalId', sp.id, '-RoleDefinitionId', def.id, '-DirectoryScopeId', '/']);
      expect(one(await call('Get-MgRoleManagementDirectoryRoleAssignment', ['-Filter', filter]))).toMatchObject({ principalId: sp.id, roleDefinitionId: def.id });
    }
    // Teams Administrator exists in the tenant but is HELD: preflight never assigns it.
    expect(one(await call('Get-MgRoleManagementDirectoryRoleDefinition', ['-Filter', "displayName eq 'Teams Administrator'"])).displayName).toBe('Teams Administrator');
  });

  it('preflight: Exchange hydration flips IsDehydrated', async () => {
    await call('Enable-OrganizationCustomization');
    expect(one(await call('Get-OrganizationConfig')).IsDehydrated).toBe(false);
  });

  it('baseline: every resource is missing before, built, then FOUND by the discovery read (ResourceId or Id)', async () => {
    const rg = 'rg-ces-clean';
    const loc = 'usgovvirginia';
    const steps: Array<{ type: string; discover: [string, unknown[]]; provision: [string, unknown[]] }> = [
      { type: 'ResourceGroup', discover: ['Get-AzResourceGroup', ['-Name', rg]], provision: ['New-AzResourceGroup', ['-Name', rg, '-Location', loc]] },
      {
        type: 'LogAnalyticsWorkspace',
        discover: ['Get-AzOperationalInsightsWorkspace', ['-ResourceGroupName', rg, '-Name', 'law-ces']],
        provision: ['New-AzOperationalInsightsWorkspace', ['-ResourceGroupName', rg, '-Name', 'law-ces', '-Location', loc, '-Sku', 'PerGB2018']],
      },
      {
        type: 'StorageAccount',
        discover: ['Get-AzStorageAccount', ['-ResourceGroupName', rg, '-Name', 'stcesclean01']],
        provision: ['New-AzStorageAccount', ['-ResourceGroupName', rg, '-Name', 'stcesclean01', '-Location', loc, '-SkuName', 'Standard_LRS', '-Kind', 'StorageV2', '-MinimumTlsVersion', 'TLS1_2', '-AllowBlobPublicAccess', false]],
      },
      {
        type: 'KeyVault',
        discover: ['Get-AzKeyVault', ['-ResourceGroupName', rg, '-VaultName', 'kv-ces-clean']],
        provision: ['New-AzKeyVault', ['-ResourceGroupName', rg, '-VaultName', 'kv-ces-clean', '-Location', loc, '-EnablePurgeProtection']],
      },
      {
        type: 'CMKKey',
        discover: ['Get-AzKeyVaultKey', ['-VaultName', 'kv-ces-clean', '-Name', 'cmk-ces']],
        provision: ['Add-AzKeyVaultKey', ['-VaultName', 'kv-ces-clean', '-Name', 'cmk-ces', '-Destination', 'Software']],
      },
      {
        type: 'AutomationAccount',
        discover: ['Get-AzAutomationAccount', ['-ResourceGroupName', rg, '-Name', 'aa-ces']],
        provision: ['New-AzAutomationAccount', ['-ResourceGroupName', rg, '-Name', 'aa-ces', '-Location', loc, '-AssignSystemIdentity']],
      },
      {
        type: 'VNet',
        discover: ['Get-AzVirtualNetwork', ['-ResourceGroupName', rg, '-Name', 'vnet-ces']],
        provision: ['New-AzVirtualNetwork', ['-ResourceGroupName', rg, '-Name', 'vnet-ces', '-Location', loc, '-AddressPrefix', '10.40.0.0/16']],
      },
      {
        type: 'NSG',
        discover: ['Get-AzNetworkSecurityGroup', ['-ResourceGroupName', rg, '-Name', 'nsg-pe']],
        provision: ['New-AzNetworkSecurityGroup', ['-ResourceGroupName', rg, '-Name', 'nsg-pe', '-Location', loc]],
      },
    ];
    const idOf = (v: unknown) => {
      const o = one(v);
      return o && !Array.isArray(o) ? (o.ResourceId ?? o.Id) : undefined;
    };
    for (const s of steps) {
      expect(idOf(await quiet(...s.discover)), `${s.type} before`).toBeUndefined();
      await call(s.provision[0], [...s.provision[1], '-ErrorAction', 'Stop']);
      const found = idOf(await quiet(...s.discover));
      expect(found, `${s.type} after`).toBeTruthy();
      if (s.type !== 'CMKKey') expect(String(found)).toContain(`/subscriptions/`);
    }
    // Baseline captures (BaselineProvisioner.extractAndMergeCaptures).
    const law = one(await call('Get-AzOperationalInsightsWorkspace', ['-ResourceGroupName', rg, '-Name', 'law-ces']));
    expect(law.ResourceId).toMatch(/workspaces\/law-ces$/);
    expect(law.CustomerId).toMatch(/^[0-9a-f-]{36}$/);
    const aa = one(await call('Get-AzAutomationAccount', ['-ResourceGroupName', rg, '-Name', 'aa-ces']));
    expect(aa.Identity.PrincipalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(one(await call('Get-AzResourceGroup', ['-Name', rg])).ResourceId).toBe(`/subscriptions/${CLEAN_G5_SUBSCRIPTION_ID}/resourceGroups/${rg}`);

    // Subnet: Get-AzVirtualNetwork, the client-side Add-AzVirtualNetworkSubnetConfig, then
    // `| Set-AzVirtualNetwork` (the wrapper forwards the piped object as -InputObject).
    const vnet = one(await call('Get-AzVirtualNetwork', ['-ResourceGroupName', rg, '-Name', 'vnet-ces']));
    const edited = { ...vnet, Subnets: [...(vnet.Subnets ?? []), { Name: 'snet-pe', AddressPrefix: '10.40.1.0/24', PrivateEndpointNetworkPolicies: 'Disabled', PrivateEndpoints: [] }] };
    await call('Set-AzVirtualNetwork', ['-ErrorAction', 'Stop', '-InputObject', edited]);
    const subnet = (one(await call('Get-AzVirtualNetwork', ['-ResourceGroupName', rg, '-Name', 'vnet-ces'])).Subnets as Row[]).find((x) => x.Name === 'snet-pe');
    expect(subnet?.Id).toBe(`${vnet.Id}/subnets/snet-pe`);
  });

  it('baseline: a dependent of a missing resource fails honestly (no vault, no key; no resource group, no automation account)', async () => {
    await expect(call('Add-AzKeyVaultKey', ['-VaultName', 'kv-missing', '-Name', 'k', '-Destination', 'Software', '-ErrorAction', 'Stop'])).rejects.toThrow(/Vault not found/);
    expect(await quiet('Get-AzKeyVaultKey', ['-VaultName', 'kv-missing', '-Name', 'k'])).toBeUndefined();
    await expect(call('New-AzAutomationAccount', ['-ResourceGroupName', 'rg-missing', '-Name', 'aa-x', '-Location', 'usgovvirginia'])).rejects.toThrow(/could not be found/);
    expect(await quiet('Get-AzResourceGroup', ['-Name', 'rg-missing'])).toBeUndefined();
  });

  it('every new tenant-init cmdlet gets a psmodule wrapper', async () => {
    const out = path.join(dir, 'psmodules');
    await generateAllModules(out);
    const graphPsm1 = await fs.readFile(path.join(out, 'Microsoft.Graph.Authentication', 'Microsoft.Graph.Authentication.psm1'), 'utf8');
    for (const c of [
      'Get-MgOrganization', 'Get-MgSubscribedSku', 'New-MgApplication', 'Update-MgApplication', 'New-MgServicePrincipal',
      'New-MgServicePrincipalAppRoleAssignment', 'Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy', 'Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy',
      'Disconnect-MgGraph',
    ]) {
      expect(graphPsm1, c).toContain(`function ${c} {`);
    }
    const azPsm1 = await fs.readFile(path.join(out, 'Az.Accounts', 'Az.Accounts.psm1'), 'utf8');
    for (const c of ['Get-AzResourceGroup', 'New-AzResourceGroup', 'Get-AzKeyVaultKey', 'Add-AzKeyVaultKey', 'Get-AzAutomationAccount', 'New-AzAutomationAccount', 'Disconnect-AzAccount']) {
      expect(azPsm1, c).toContain(`function ${c} {`);
    }
  });
});
