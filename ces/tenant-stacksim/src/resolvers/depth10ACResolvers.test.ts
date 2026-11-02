// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.3 / 10.7 (PH-12, P12-R2) simulator golden: for each new or changed AC / MP registry entry,
// the calls its SET sends, then the calls its GET sends, through the real ResolverTable (DEFAULT_ENTRIES).
// The GET must read back what the SET wrote. The PowerShell projection each GET applies (Where-Object,
// [pscustomobject]) is reproduced in TS where it matters; the Stamper-side golden
// (ces-stamper tests/registry/Depth10R2Golden.test.ts) checks the registry verification on those reads.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../store/ObjectStore.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';
import { ResolverTable } from './ResolverTable.js';
import { DEPTH10_AC_ENTRIES } from './depth10ACResolvers.js';
import { graphResolvers } from './graphResolvers.js';

type Row = Record<string, any>;
const TEMPLATE = '5cf42378-d67d-4f36-ba46-e8b86229381d';
const G = 'https://graph.microsoft.us';

describe('DEPTH-10.3 / 10.7 simulator golden (depth10ACResolvers.ts + existing resolvers)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth10ac-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const passwordRule = async (): Promise<Row | undefined> =>
    ((await table.resolveUri('GET', `${G}/v1.0/groupSettings`)) as { value: Row[] }).value.find((s) => s.templateId === TEMPLATE);
  const valueOf = (s: Row | undefined, name: string) => (s?.values as Row[] | undefined)?.find((v) => v.name === name)?.value;

  it('the groupSettings entry is listed once, before the GET-only graphResolvers twin', () => {
    expect(DEPTH10_AC_ENTRIES).toHaveLength(1);
    expect(graphResolvers.some((e) => e.kind === 'uri' && e.pattern === '/v1.0/groupSettings')).toBe(true);
  });

  it('AC.L2-3.1.8.password-rule-settings: POST creates the Password Rule Settings the GET then finds', async () => {
    expect(await passwordRule()).toBeUndefined();
    await table.resolveUri('POST', `${G}/v1.0/groupSettings`, {
      templateId: TEMPLATE,
      values: [{ name: 'LockoutThreshold', value: '3' }, { name: 'LockoutDurationInSeconds', value: '900' }],
    });
    const s = await passwordRule();
    expect(s?.templateId).toBe(TEMPLATE);
    expect(valueOf(s, 'LockoutThreshold')).toBe('3');
    // Get-MgDirectorySetting reads the same collection.
    const viaCmdlet = (await table.resolveCmdlet('Get-MgDirectorySetting', [])) as Row[];
    expect(viaCmdlet.some((x) => x.templateId === TEMPLATE)).toBe(true);
  });

  it('AC.L2-3.1.8.smart-lockout: Update-MgDirectorySetting -Values on the seeded setting; the GET reads 3 / 900 back, other values kept', async () => {
    await store.create('directorySettings', {
      id: 'ds-1',
      displayName: 'Password Rule Settings',
      templateId: TEMPLATE,
      values: [
        { name: 'EnableBannedPasswordCheck', value: 'True' },
        { name: 'LockoutDurationInSeconds', value: '300' },
        { name: 'LockoutThreshold', value: '5' },
      ],
    } as never);
    const before = await passwordRule();
    // The SET's $vals: every value except the two lockout ones, then the two lockout ones.
    const vals = [
      ...(before!.values as Row[]).filter((v) => !['LockoutThreshold', 'LockoutDurationInSeconds'].includes(v.name)).map((v) => ({ name: v.name, value: String(v.value) })),
      { name: 'LockoutThreshold', value: '3' },
      { name: 'LockoutDurationInSeconds', value: '900' },
    ];
    await table.resolveCmdlet('Update-MgDirectorySetting', ['-DirectorySettingId', before!.id, '-Values', vals]);
    const after = await passwordRule();
    expect(valueOf(after, 'LockoutThreshold')).toBe('3');
    expect(valueOf(after, 'LockoutDurationInSeconds')).toBe('900');
    expect(valueOf(after, 'EnableBannedPasswordCheck')).toBe('True');
  });

  // PH-13 FX: the Graph v1.0 shape. User consent is defaultUserRolePermissions.permissionGrantPoliciesAssigned
  // (https://learn.microsoft.com/graph/api/resources/defaultuserrolepermissions?view=graph-rest-1.0); the
  // top-level permissionGrantPolicyIdsAssignedToDefaultUserRole this test used is not a v1.0 property.
  it('AC.L1-3.1.2.default-user-permissions: the PATCH turns off app/group/tenant creation and user consent; the GET reads it back', async () => {
    await store.create('authorizationPolicy', {
      id: 'authorizationPolicy',
      allowInvitesFrom: 'adminsAndGuestInviters',
      defaultUserRolePermissions: { allowedToCreateApps: true, allowedToCreateSecurityGroups: true, allowedToCreateTenants: false, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy'] },
    } as never);
    await table.resolveCmdlet('Update-MgPolicyAuthorizationPolicy', ['-BodyParameter', {
      defaultUserRolePermissions: { allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowedToCreateTenants: false, permissionGrantPoliciesAssigned: [] },
    }]);
    const got = (await table.resolveCmdlet('Get-MgPolicyAuthorizationPolicy', [])) as Row[];
    const p = got[0];
    expect(p.defaultUserRolePermissions.allowedToCreateApps).toBe(false);
    expect(p.defaultUserRolePermissions.allowedToCreateSecurityGroups).toBe(false);
    expect(p.defaultUserRolePermissions.allowedToCreateTenants).toBe(false);
    const consent = ((p.defaultUserRolePermissions.permissionGrantPoliciesAssigned ?? ['missing']) as string[]).filter((x) => x.startsWith('ManagePermissionGrantsForSelf.') || x === 'missing');
    expect(consent).toEqual([]);
    expect(p.defaultUserRolePermissions.allowedToReadOtherUsers).toBe(true);
    expect(p.allowInvitesFrom).toBe('adminsAndGuestInviters');
  });

  it('AC.L2-3.1.12.session-monitor: the CA policy with a monitor-only session control reads back by -Filter', async () => {
    await store.create('users', { id: 'user-50', userPrincipalName: 'bg.access01@sim.onmicrosoft.us' } as never);
    await store.create('groups', { id: 'group-1', displayName: 'CUI-Authorized-Users' } as never);
    await table.resolveCmdlet('New-MgIdentityConditionalAccessPolicy', ['-BodyParameter', {
      displayName: 'CMMC-RemoteSession-Monitor',
      state: 'enabled',
      conditions: { users: { includeGroups: ['group-1'], excludeUsers: ['user-50'] }, applications: { includeApplications: ['Office365'] }, clientAppTypes: ['browser'] },
      sessionControls: { cloudAppSecurity: { isEnabled: true, cloudAppSecurityType: 'monitorOnly' } },
    }]);
    const got = (await table.resolveCmdlet('Get-MgIdentityConditionalAccessPolicy', ['-Filter', "displayName eq 'CMMC-RemoteSession-Monitor'"])) as Row[];
    expect(got).toHaveLength(1);
    expect(got[0].state).toBe('enabled');
    expect(got[0].sessionControls.cloudAppSecurity).toEqual({ isEnabled: true, cloudAppSecurityType: 'monitorOnly' });
    expect(got[0].conditions.users.excludeUsers).toEqual(['user-50']);
  });

  for (const [id, body] of [
    ['AC.L2-3.1.18.ios-compliance', { '@odata.type': '#microsoft.graph.iosCompliancePolicy', displayName: 'CMMC-Compliance-iOS', passcodeRequired: true, passcodeBlockSimple: true, passcodeMinimumLength: 6, passcodeMinutesOfInactivityBeforeScreenTimeout: 15, securityBlockJailbrokenDevices: true }],
    ['AC.L2-3.1.19.android-compliance', { '@odata.type': '#microsoft.graph.androidWorkProfileCompliancePolicy', displayName: 'CMMC-Compliance-Android', passwordRequired: true, passwordRequiredType: 'numericComplex', passwordMinimumLength: 6, passwordMinutesOfInactivityBeforeLock: 15, storageRequireEncryption: true, securityBlockJailbrokenDevices: true }],
  ] as const) {
    it(`${id}: POST + /assign; the $expand=assignments GET reads the policy and its assignment`, async () => {
      const created = (await table.resolveUri('POST', `${G}/v1.0/deviceManagement/deviceCompliancePolicies`, { ...body, scheduledActionsForRule: [{ ruleName: 'PasswordRequired', scheduledActionConfigurations: [{ actionType: 'block', gracePeriodHours: 0 }] }] })) as Row;
      expect(created.id).toBeTruthy();
      await table.resolveUri('POST', `${G}/v1.0/deviceManagement/deviceCompliancePolicies/${created.id}/assign`, {
        assignments: [{ target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }],
      });
      const list = ((await table.resolveUri('GET', `${G}/v1.0/deviceManagement/deviceCompliancePolicies?$expand=assignments`)) as { value: Row[] }).value;
      const p = list.find((x) => x.displayName === body.displayName)!;
      for (const [k, v] of Object.entries(body)) expect(p[k]).toEqual(v);
      expect(p.assignments).toHaveLength(1);
    });
  }

  it('MP.L2-3.8.5.media-access (re-aimed read): the assigned removable-storage block the AC.L2-3.1.21 entry verifies is what the read selects', async () => {
    await store.create('deviceConfigurations', {
      id: 'dc-1', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'S1-Block-Removable-Storage', storageBlockRemovableStorage: true,
      assignments: [{ id: 'dc-1_group-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }],
    } as never);
    await store.create('deviceConfigurations', { id: 'dc-2', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'Unassigned-Block', storageBlockRemovableStorage: true, assignments: [] } as never);
    const list = ((await table.resolveUri('GET', `${G}/v1.0/deviceManagement/deviceConfigurations?$expand=assignments`)) as { value: Row[] }).value;
    // The read's Where-Object: removable storage blocked AND at least one assignment.
    const hit = list.filter((x) => x.storageBlockRemovableStorage === true && (x.assignments ?? []).length > 0);
    expect(hit.map((x) => x.displayName)).toEqual(['S1-Block-Removable-Storage']);
  });
});
