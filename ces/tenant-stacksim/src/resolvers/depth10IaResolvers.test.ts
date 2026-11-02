// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../store/ObjectStore.js';
import { ResolverTable } from './ResolverTable.js';
import { DEPTH10_IA_URIS, resolveDepth10IaUri } from './depth10IaResolvers.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';

type Row = Record<string, any>;
const PRS = '5cf42378-d67d-4f36-ba46-e8b86229381d';
const ENROLL = '/v1.0/deviceManagement/deviceEnrollmentConfigurations';
const G = 'https://graph.microsoft.us';

/**
 * DEPTH-10.2 golden (P12-R1): each IA write the new and re-aimed registry entries send, then the
 * read the entry verifies, through the ResolverTable (the path /resolve takes).
 */
describe('DEPTH-10.2 IA resolvers (depth10IaResolvers.ts)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth10ia-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_only'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('IA.L2-3.5.7.password-protection: POST a Password Rule Settings setting when none exists, then the list read shows it', async () => {
    expect(((await table.resolveUri('GET', `${G}/v1.0/groupSettings`)) as Row).value).toEqual([]);
    const created = (await table.resolveUri('POST', `${G}/v1.0/groupSettings`, { templateId: PRS, values: [{ name: 'EnableBannedPasswordCheck', value: 'True' }, { name: 'BannedPasswordList', value: 'password\twelcome' }] })) as Row;
    expect(created).toMatchObject({ displayName: 'Password Rule Settings', templateId: PRS });
    const list = ((await table.resolveUri('GET', `${G}/v1.0/groupSettings`)) as Row).value as Row[];
    expect(list).toHaveLength(1);
    expect(list[0].values).toEqual([{ name: 'EnableBannedPasswordCheck', value: 'True' }, { name: 'BannedPasswordList', value: 'password\twelcome' }]);
    await expect(table.resolveUri('POST', `${G}/v1.0/groupSettings`, { templateId: PRS, values: [] })).rejects.toThrow(/already exists/);
  });

  it('IA.L2-3.5.7.password-protection: PATCH replaces the values of the seeded setting, and the item read shows them', async () => {
    await store.create('directorySettings', { id: 's-1', displayName: 'Password Rule Settings', templateId: PRS, values: [{ name: 'EnableBannedPasswordCheck', value: 'False' }, { name: 'LockoutThreshold', value: '10' }] });
    expect(await table.resolveUri('PATCH', `${G}/v1.0/groupSettings/s-1`, JSON.stringify({ values: [{ name: 'EnableBannedPasswordCheck', value: 'True' }, { name: 'LockoutThreshold', value: '10' }, { name: 'BannedPasswordList', value: 'cmmc' }] }))).toBeNull();
    const one = (await table.resolveUri('GET', `${G}/v1.0/groupSettings/s-1`)) as Row;
    expect(one.values).toEqual([{ name: 'EnableBannedPasswordCheck', value: 'True' }, { name: 'LockoutThreshold', value: '10' }, { name: 'BannedPasswordList', value: 'cmmc' }]);
    await expect(table.resolveUri('PATCH', `${G}/v1.0/groupSettings/nope`, { values: [] })).rejects.toThrow(/no directory setting/);
    await expect(table.resolveUri('PATCH', `${G}/v1.0/groupSettings/s-1`, {})).rejects.toThrow(/values is required/);
  });

  it('IA.L2-3.5.3.whfb-tenant: the default WHfB configuration is listed; PATCH enables it and the list read shows the change', async () => {
    const before = ((await table.resolveUri('GET', `${G}${ENROLL}`)) as Row).value as Row[];
    const whfb = before.find((c) => String(c.id).endsWith('_DefaultWindowsHelloForBusiness'))!;
    expect(whfb).toMatchObject({ '@odata.type': '#microsoft.graph.deviceEnrollmentWindowsHelloForBusinessConfiguration', state: 'notConfigured', priority: 0 });
    expect(await table.resolveUri('PATCH', `${G}${ENROLL}/${encodeURIComponent(whfb.id)}`, JSON.stringify({ '@odata.type': '#microsoft.graph.deviceEnrollmentWindowsHelloForBusinessConfiguration', state: 'enabled', pinMinimumLength: 6, securityDeviceRequired: true }))).toBeNull();
    const after = ((await table.resolveUri('GET', `${G}${ENROLL}`)) as Row).value as Row[];
    expect(after.filter((c) => String(c.id).endsWith('_DefaultWindowsHelloForBusiness'))).toHaveLength(1);
    expect(after.find((c) => c.id === whfb.id)).toMatchObject({ state: 'enabled', pinMinimumLength: 6, securityDeviceRequired: true });
    await expect(table.resolveUri('PATCH', `${G}${ENROLL}/${whfb.id}`, { state: 'on' })).rejects.toThrow(/state must be/);
    await expect(table.resolveUri('PATCH', `${G}${ENROLL}/${whfb.id}`, { pinMinimumLength: 2 })).rejects.toThrow(/pinMinimumLength/);
    await expect(table.resolveUri('PATCH', `${G}${ENROLL}/other`, { state: 'enabled' })).rejects.toThrow(/no enrollment configuration/);
  });

  it('every listed path is answered by this module (and nothing else is)', async () => {
    await store.create('directorySettings', { id: 's-1', templateId: PRS, values: [] });
    for (const { method, pattern } of DEPTH10_IA_URIS) {
      const uri = pattern.replace('*', pattern.includes('groupSettings') ? 's-1' : 'sim-tenant_DefaultWindowsHelloForBusiness');
      const body = method === 'POST' ? { templateId: '62375ab9-6b52-47ed-826b-58e47e0e304b', values: [] } : method === 'PATCH' ? { values: [], state: 'enabled' } : undefined;
      expect([method, pattern, await resolveDepth10IaUri({ store }, method, uri, body)]).not.toEqual([method, pattern, undefined]);
    }
    expect(await resolveDepth10IaUri({ store }, 'GET', '/v1.0/groupSettings', undefined)).toBeUndefined();
    expect(await resolveDepth10IaUri({ store }, 'GET', '/v1.0/users', undefined)).toBeUndefined();
  });

  it('IA.L1-3.5.1.app-consent-restrict: PATCH of authorizationPolicy defaultUserRolePermissions reads back', async () => {
    await store.create('authorizationPolicy', { id: 'authorizationPolicy', defaultUserRolePermissions: { allowedToCreateApps: true, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy'] } });
    await table.resolveUri('PATCH', `${G}/v1.0/policies/authorizationPolicy`, { defaultUserRolePermissions: { allowedToCreateApps: false, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: [] } });
    const p = (await table.resolveUri('GET', `${G}/v1.0/policies/authorizationPolicy`)) as Row;
    const one = Array.isArray(p) ? p[0] : p;
    expect(one.defaultUserRolePermissions).toEqual({ allowedToCreateApps: false, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: [] });
  });

  // PH-13 FX (R-F10 S1): a PATCH naming only some defaultUserRolePermissions members keeps the others, as on
  // Graph (Update authorizationPolicy examples 3 and 5). The shallow merge dropped permissionGrantPoliciesAssigned
  // after AC.L1-3.1.2.default-user-permissions' 3-key PATCH, and app-consent-restrict's SET then threw.
  it('PH-13 FX: a 3-key defaultUserRolePermissions PATCH (cmdlet or URI) keeps the members it does not name', async () => {
    await store.create('authorizationPolicy', { id: 'authorizationPolicy', allowInvitesFrom: 'adminsAndGuestInviters', defaultUserRolePermissions: { allowedToCreateApps: true, allowedToCreateSecurityGroups: true, allowedToCreateTenants: false, allowedToReadBitlockerKeysForOwnedDevice: true, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy'] } });
    await table.resolveCmdlet('Update-MgPolicyAuthorizationPolicy', ['-BodyParameter', { defaultUserRolePermissions: { allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowedToCreateTenants: false } }]);
    let one = (await store.read('authorizationPolicy', 'authorizationPolicy')) as Row;
    expect(one.defaultUserRolePermissions).toEqual({ allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowedToCreateTenants: false, allowedToReadBitlockerKeysForOwnedDevice: true, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy'] });
    expect(one.allowInvitesFrom).toBe('adminsAndGuestInviters');
    await table.resolveUri('PATCH', `${G}/v1.0/policies/authorizationPolicy`, { defaultUserRolePermissions: { allowedToCreateApps: false, permissionGrantPoliciesAssigned: [] } });
    one = (await store.read('authorizationPolicy', 'authorizationPolicy')) as Row;
    expect(one.defaultUserRolePermissions).toEqual({ allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowedToCreateTenants: false, allowedToReadBitlockerKeysForOwnedDevice: true, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: [] });
  });
});
