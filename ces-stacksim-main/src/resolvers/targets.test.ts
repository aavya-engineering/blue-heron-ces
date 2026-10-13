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
import { StackShapeGate } from '../gating/StackShapeGate.js';
import { ResolverTable, cmdletArgsToPatch } from './ResolverTable.js';
import { findCmdletTarget, matchTarget, parseODataEqFilter, extractODataFilter } from './targets.js';

/**
 * SIMFIX FIX-S1 (2026-09-27, P0 data safety): a cmdlet or URI that names
 * its target acts on exactly that object or returns not-found - never the
 * first user / the singleton id. Uses the REAL default resolver table
 * (hand-authored + inventory-derived entries), i.e. the exact
 * Remove-MgUser/Update-MgUser/... entries AO's ops reach.
 */
const UPN = (n: number) => `sim.user${n}@simtenant.onmicrosoft.us`;

describe('FIX-S1 target resolution (wrong-user class)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-fixs1-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    for (let n = 1; n <= 5; n++) {
      await store.create('users', { id: `user-${n}`, displayName: `Sim User ${n}`, userPrincipalName: UPN(n), accountEnabled: true });
    }
    await store.create('groups', { id: 'group-1', displayName: 'CUI-Authorized-Users' });
    await store.create('managedDevices', { id: 'managedDevice-1', deviceName: 'Sim Managed Device 1' });
    await store.create('roleAssignments', { id: 'ra-1', principalId: 'user-1', roleDefinitionId: 'ga' });
    await store.create('roleAssignments', { id: 'ra-2', principalId: 'user-2', roleDefinitionId: 'ga' });
    await store.create('roleAssignments', { id: 'ra-3', principalId: 'user-1', roleDefinitionId: 'other' });
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const snapshot = async () => JSON.stringify(await store.list('users'));

  it('Remove-MgUser -UserId <UPN of user-3> deletes user-3 and leaves user-1 untouched (the A-03 defect)', async () => {
    const user1Before = await store.read('users', 'user-1');
    await table.resolveCmdlet('Remove-MgUser', ['-UserId', UPN(3), '-ErrorAction', 'Stop']);
    expect(await store.read('users', 'user-3')).toBeUndefined();
    expect(await store.read('users', 'user-1')).toEqual(user1Before);
    expect(await store.list('users')).toHaveLength(4);
  });

  it('Update-MgUser -UserId <UPN> -AccountEnabled:$false updates only that user, with a real boolean', async () => {
    // PS 5.1 forwards `-AccountEnabled:$false` as ['-AccountEnabled:', false].
    await table.resolveCmdlet('Update-MgUser', ['-UserId', UPN(3), '-AccountEnabled:', false]);
    expect((await store.read('users', 'user-3'))?.accountEnabled).toBe(false);
    expect((await store.read('users', 'user-1'))?.accountEnabled).toBe(true);
    // the target parameter names the object; it is not written onto it
    expect(await store.read('users', 'user-3')).not.toHaveProperty('userId');
  });

  it('an unknown UPN is not-found for delete, update, action and read - and changes nothing', async () => {
    const before = await snapshot();
    const ghost = 'nobody@simtenant.onmicrosoft.us';
    await expect(table.resolveCmdlet('Remove-MgUser', ['-UserId', ghost])).rejects.toThrow(/Request_ResourceNotFound/);
    await expect(table.resolveCmdlet('Update-MgUser', ['-UserId', ghost, '-AccountEnabled:', false])).rejects.toThrow(
      /Request_ResourceNotFound/,
    );
    await expect(table.resolveCmdlet('Revoke-MgUserSignInSession', ['-UserId', ghost])).rejects.toThrow(
      /Request_ResourceNotFound/,
    );
    await expect(table.resolveCmdlet('Get-MgUser', ['-UserId', ghost])).rejects.toThrow(/Request_ResourceNotFound/);
    expect(await snapshot()).toBe(before);
  });

  it('Get-MgUser -UserId <UPN> returns that ONE user, not the collection', async () => {
    const u = (await table.resolveCmdlet('Get-MgUser', ['-UserId', UPN(3)])) as Record<string, unknown>;
    expect(Array.isArray(u)).toBe(false);
    expect(u.id).toBe('user-3');
  });

  it('an action cmdlet on a user records against THAT user (Revoke-MgUserSignInSession)', async () => {
    await table.resolveCmdlet('Revoke-MgUserSignInSession', ['-UserId', UPN(3)]);
    expect((await store.read('users', 'user-3'))?.signInSessionsValidFromDateTime).toBeTruthy();
    expect(await store.read('users', 'user-1')).not.toHaveProperty('signInSessionsValidFromDateTime');
  });

  it('URI PATCH/DELETE on /v1.0/users/{upn} resolve the UPN; an unknown one 404s and creates no phantom user', async () => {
    await table.resolveUri('PATCH', `/v1.0/users/${UPN(3)}`, { department: 'Engineering' });
    expect((await store.read('users', 'user-3'))?.department).toBe('Engineering');
    expect(await store.list('users')).toHaveLength(5);
    await expect(table.resolveUri('PATCH', '/v1.0/users/nobody@simtenant.onmicrosoft.us', { department: 'x' })).rejects.toThrow(
      /Request_ResourceNotFound/,
    );
    expect(await store.list('users')).toHaveLength(5);
  });

  it('other resolvers never fall back either: device, group and -Identity reads', async () => {
    await expect(
      table.resolveCmdlet('Set-MgDeviceManagementManagedDeviceName', ['-ManagedDeviceId', 'managedDevice-99', '-ManagedDeviceName', 'x']),
    ).rejects.toThrow(/Request_ResourceNotFound/);
    await expect(table.resolveCmdlet('Get-MgGroupMember', ['-GroupId', 'group-99'])).rejects.toThrow(/Request_ResourceNotFound/);
    await expect(table.resolveCmdlet('Get-DlpCompliancePolicy', ['-Identity', "'No-Such-Policy'"])).rejects.toThrow(
      /Request_ResourceNotFound/,
    );
    expect((await store.read('managedDevices', 'managedDevice-1'))?.deviceName).toBe('Sim Managed Device 1');
  });

  it('$filter on a URI collection GET is applied (A-10 would otherwise DELETE every role assignment)', async () => {
    const flt = encodeURIComponent("principalId eq 'user-1' and roleDefinitionId eq 'ga'");
    const out = (await table.resolveUri('GET', `/v1.0/roleManagement/directory/roleAssignments?$filter=${flt}`)) as {
      value: Array<{ id: string }>;
    };
    expect(out.value.map((a) => a.id)).toEqual(['ra-1']);
    const unencoded = (await table.resolveUri(
      'GET',
      "/v1.0/roleManagement/directory/roleAssignments?$filter=roleDefinitionId eq 'ga'",
    )) as { value: Array<{ id: string }> };
    expect(unencoded.value.map((a) => a.id).sort()).toEqual(['ra-1', 'ra-2']);
  });
});

describe('FIX-S1 helpers', () => {
  it('findCmdletTarget picks the naming parameter and ignores payload references', () => {
    expect(findCmdletTarget(['-GroupId', 'g1', '-DirectoryObjectId', 'u1'])).toMatchObject({ param: 'GroupId', value: 'g1' });
    expect(findCmdletTarget(['-DirectoryObjectId', 'u1'])).toBeUndefined();
    expect(findCmdletTarget(['-UserIds', ['u1']])).toBeUndefined();
    expect(findCmdletTarget(['-Identity', "'CMMC-CUI-Block'"])).toMatchObject({ param: 'Identity', value: 'CMMC-CUI-Block' });
    expect(findCmdletTarget(['-UserId:', 'x@y'])).toMatchObject({ param: 'UserId', value: 'x@y' });
  });

  it('matchTarget refuses an ambiguous alternate key rather than guessing', () => {
    const objs = [
      { id: 'a', name: 'Dup' },
      { id: 'b', name: 'Dup' },
    ];
    expect(() => matchTarget(objs, 'Dup', ['name'])).toThrow(/ambiguous/);
    expect(matchTarget(objs, 'b', ['name'])?.id).toBe('b');
  });

  it('OData filter parsing: eq/and only, anything else is reported unparseable', () => {
    expect(parseODataEqFilter("a eq 'x' and b eq true")).toEqual([
      { field: 'a', value: 'x' },
      { field: 'b', value: 'true' },
    ]);
    expect(parseODataEqFilter("startswith(a,'x')")).toBeUndefined();
    expect(extractODataFilter("/v1.0/x?$filter=a%20eq%20'1'&$top=5")).toBe("a eq '1'");
  });

  it('cmdletArgsToPatch unwraps PS 5.1 array wrappers and reads -Switch:$value pairs', () => {
    expect(cmdletArgsToPatch(['-UserIds', { value: ['u1'], Count: 1 }, '-Enabled:', true])).toEqual({
      UserIds: ['u1'],
      Enabled: true,
    });
  });
});
