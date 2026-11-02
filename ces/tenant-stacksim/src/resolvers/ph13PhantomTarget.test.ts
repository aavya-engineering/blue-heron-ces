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
import { emptyNamedTarget, BadRequestError } from './targets.js';

/**
 * PH-13 P13-REG (LOG-PH12-AO.md STOP 2): an action cmdlet (semantics.ts TARGET_ACTIONS) called with its
 * target parameter present but null or empty is a 400, as in real Graph. It used to fall through to the
 * generic upsert and create a phantom object (R-F9 S1 AO B-01 created managedDevice-60 on a null id).
 */
describe('emptyNamedTarget', () => {
  it('names a target parameter given null, empty, a following -Param, or nothing', () => {
    expect(emptyNamedTarget(['-ManagedDeviceId', null, '-ManagedDeviceName', 'x'])).toBe('ManagedDeviceId');
    expect(emptyNamedTarget(['-UserId', ''])).toBe('UserId');
    expect(emptyNamedTarget(['-UserId', "''"])).toBe('UserId');
    expect(emptyNamedTarget(['-ApplicationId', '-PasswordCredential', {}])).toBe('ApplicationId');
    expect(emptyNamedTarget(['-GroupId'])).toBe('GroupId');
    expect(emptyNamedTarget(['-Identity:', ''])).toBe('Identity');
  });

  it('is undefined when every named target has a value, or no target parameter is named', () => {
    expect(emptyNamedTarget(['-ManagedDeviceId', 'managedDevice-1'])).toBeUndefined();
    expect(emptyNamedTarget(['-KeyId', null, '-ApplicationId', 'app-1'])).toBeUndefined(); // -KeyId references, it does not name
    expect(emptyNamedTarget(['-DisplayName', ''])).toBeUndefined();
    expect(emptyNamedTarget(undefined)).toBeUndefined();
    expect(emptyNamedTarget(['-GroupId', null], 'New-AzPrivateLinkServiceConnection')).toBeUndefined(); // Az -GroupId is not a Graph target
  });
});

describe('TARGET_ACTIONS with an empty target (no phantom create)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ph13-phantom-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
    await store.create('managedDevices', { id: 'managedDevice-1', deviceName: 'S1-WS-001', serialNumber: 'S1SN00001' });
    await store.create('users', { id: 'user-1', userPrincipalName: 'a@x.example' });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.each([
    ['Set-MgDeviceManagementManagedDeviceName', ['-ManagedDeviceId', null, '-ManagedDeviceName', 'S1-AOSWEEP-01']],
    ['Invoke-MgDeviceManagementManagedDeviceSyncDevice', ['-ManagedDeviceId', '']],
    ['Clear-MgDeviceManagementManagedDevice', ['-ManagedDeviceId', null]],
    ['Revoke-MgUserSignInSession', ['-UserId', '']],
    ['Set-MgUserLicense', ['-UserId', null, '-AddLicenses', [], '-RemoveLicenses', []]],
  ])('%s refuses a null or empty target and writes nothing', async (cmdlet, args) => {
    const devicesBefore = await store.list('managedDevices');
    const usersBefore = await store.list('users');
    await expect(table.resolveCmdlet(cmdlet, args)).rejects.toBeInstanceOf(BadRequestError);
    // FX-10's input validation already refuses an empty -UserId string; the new guard covers the rest.
    await expect(table.resolveCmdlet(cmdlet, args)).rejects.toThrow(/is required \(got no value\)|invalid object identifier ""/);
    expect(await store.list('managedDevices')).toEqual(devicesBefore);
    expect(await store.list('users')).toEqual(usersBefore);
  });

  it('a named target still acts on exactly that object', async () => {
    await table.resolveCmdlet('Set-MgDeviceManagementManagedDeviceName', ['-ManagedDeviceId', 'managedDevice-1', '-ManagedDeviceName', 'S1-WS-001R']);
    const devices = await store.list('managedDevices');
    expect(devices).toHaveLength(1);
    expect((devices[0] as Record<string, unknown>).deviceActionResults).toBeDefined();
  });

  it('an unknown target is still a 404, not a create', async () => {
    await expect(table.resolveCmdlet('Clear-MgDeviceManagementManagedDevice', ['-ManagedDeviceId', 'managedDevice-99'])).rejects.toThrow(/no managedDevices object/);
    expect(await store.list('managedDevices')).toHaveLength(1);
  });
});
