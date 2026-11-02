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
import { ResolverTable } from './ResolverTable.js';
import { QueryServer } from '../http/QueryServer.js';

/** FX-10: the sim rejects unresolved placeholders and invalid ids the way a real tenant would. */
describe('FX-10 input validation', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;
  const REF = (id: string) => ({ '@odata.id': `https://graph.microsoft.us/v1.0/directoryObjects/${id}` });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-fx10-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    await store.create('users', { id: 'user-1', userPrincipalName: 'sim.user1@simtenant.onmicrosoft.us', accountEnabled: true });
    await store.create('users', { id: 'user-2', userPrincipalName: 'sim.user2@simtenant.onmicrosoft.us', accountEnabled: true });
    await store.create('groups', { id: 'group-1', displayName: 'CUI-Authorized-Users' });
    await store.create('caPolicies', { id: 'caPolicy-1', displayName: 'Sim CA', conditions: { users: { includeUsers: ['All'], excludeUsers: [] } } });
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('rejects an unresolved {placeholder} value with a 400 and stores nothing', async () => {
    const before = JSON.stringify(await store.list('groupMember'));
    await expect(table.resolveCmdlet('New-MgGroupMemberByRef', ['-GroupId', '{cuiGroupId}', '-BodyParameter', REF('user-1')])).rejects.toThrow(
      /Request_BadRequest: .*"\{cuiGroupId\}"/,
    );
    await expect(table.resolveCmdlet('New-MgGroupMemberByRef', ['-GroupId', 'group-1', '-BodyParameter', REF('{operatorUserId}')])).rejects.toThrow(
      /Request_BadRequest/,
    );
    await expect(table.resolveCmdlet('Set-CsExternalAccessPolicy', ['-Identity', 'Global', '-AllowedDomains', '{wifiSsid}'])).rejects.toThrow(
      /Request_BadRequest/,
    );
    await expect(table.resolveUri('PATCH', '/v1.0/users/user-1', { mail: '{securityEmail}' })).rejects.toThrow(/Request_BadRequest/);
    await expect(table.resolveUri('GET', '/v1.0/users/{breakGlassUserId}')).rejects.toThrow(/Request_BadRequest/);
    expect(JSON.stringify(await store.list('groupMember'))).toBe(before);
    expect((await store.read('users', 'user-1'))?.mail).toBeUndefined();
  });

  it('rejects an unknown non-GUID id in each id-typed field with a 400', async () => {
    await expect(table.resolveCmdlet('Get-MgGroupMember', ['-GroupId', 'CUI-Authorized-Users'])).rejects.toThrow(/Request_BadRequest/);
    await expect(table.resolveCmdlet('Update-MgUser', ['-UserId', 'usr-1', '-AccountEnabled:', false])).rejects.toThrow(/Request_BadRequest/);
    await expect(table.resolveCmdlet('New-MgGroupMemberByRef', ['-GroupId', 'group-1', '-BodyParameter', REF('operator')])).rejects.toThrow(
      /Request_BadRequest/,
    );
    await expect(
      table.resolveUri('PATCH', '/v1.0/identity/conditionalAccess/policies/caPolicy-1', {
        conditions: { users: { excludeUsers: ['BreakGlass'] } },
      }),
    ).rejects.toThrow(/Request_BadRequest: excludeUsers/);
  });

  it('accepts existing sim ids, GUIDs and the CA keywords', async () => {
    await table.resolveCmdlet('New-MgGroupMemberByRef', ['-GroupId', 'group-1', '-BodyParameter', REF('user-1')]);
    const members = (await table.resolveCmdlet('Get-MgGroupMember', ['-GroupId', 'group-1'])) as Array<{ id: string }>;
    expect(members.map((m) => m.id)).toContain('user-1');
    await table.resolveCmdlet('Update-MgUser', ['-UserId', 'user-2', '-AccountEnabled:', false]);
    expect((await store.read('users', 'user-2'))?.accountEnabled).toBe(false);
    await table.resolveUri('PATCH', '/v1.0/identity/conditionalAccess/policies/caPolicy-1', {
      conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-1', 'GuestsOrExternalUsers', '7d1c2b3a-0000-4000-8000-000000000001'] } },
    });
    // a well-formed GUID that names nothing is still the real service's 404, not a 400
    await expect(table.resolveCmdlet('Get-MgGroupMember', ['-GroupId', '7d1c2b3a-0000-4000-8000-000000000002'])).rejects.toThrow(
      /Request_ResourceNotFound/,
    );
  });

  it('QueryServer maps the rejection to HTTP 400', async () => {
    const server = new QueryServer({ resolverTable: table });
    const port = await server.start(0);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'cmdlet', cmdlet: 'Get-MgGroupMember', args: ['-GroupId', '{cuiGroupId}'] }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/Request_BadRequest/);
    } finally {
      await server.stop();
    }
  });
});
