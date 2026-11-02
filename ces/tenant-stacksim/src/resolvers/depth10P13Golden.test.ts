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
import { StackShapeGate } from '../gating/StackShapeGate.js';

/**
 * PH-13 P13-REG simulator golden for the two re-aimed SI entries (existing routes; no new resolver):
 *  - SI.L1-3.14.5.scan-schedule-evidence: New-MgDeviceManagementDeviceConfiguration -BodyParameter with the
 *    Graph v1.0 type that carries the defender* properties (windows10GeneralConfiguration), /assign, then the
 *    ?$expand=assignments read returns scan type full, cloud block level high, signature interval 4 and
 *    one assignment (the entry's checks[] and its top-level literal $.defenderScanType = full).
 *  - SI.L1-3.14.4.av-update-evidence: the managedDevices list plus each Windows device's beta
 *    windowsProtectionState answer, and a device with no state is a 404 (the read records reported = false).
 */

type Row = Record<string, any>;
const DC = 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations';
const CUI_GROUP = 'group-cui-1';

describe('PH-13 P13-REG golden: SET then GET returns the expected value', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ph13-reg-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
    await store.create('groups', { id: CUI_GROUP, displayName: 'CUI Users' });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('SI.L1-3.14.5.scan-schedule-evidence: the windows10GeneralConfiguration Defender policy reads back full / high / 4 h, assigned', async () => {
    const body: Row = {
      '@odata.type': '#microsoft.graph.windows10GeneralConfiguration',
      displayName: 'CMMC-Defender-AntivirusPolicy',
      description: 'CMMC L2 required Defender antivirus and scheduled scan configuration',
      defenderScanType: 'full',
      defenderScheduledScanTime: '02:00',
      defenderScheduledQuickScanTime: '06:00',
      defenderDaysBeforeDeletingQuarantinedMalware: 30,
      defenderSignatureUpdateIntervalInHours: 4,
      defenderMonitorFileActivity: 'monitorAllFiles',
      defenderCloudBlockLevel: 'high',
      defenderSystemScanSchedule: 'sunday',
    };
    const created = (await table.resolveCmdlet('New-MgDeviceManagementDeviceConfiguration', ['-BodyParameter', body])) as Row;
    expect(created.id).toBeTruthy();
    await table.resolveUri('POST', `${DC}/${created.id}/assign`, {
      assignments: [{ target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: CUI_GROUP } }],
    });
    const list = ((await table.resolveUri('GET', `${DC}?$expand=assignments`)) as { value: Row[] }).value;
    const read = list.find((d) => d.displayName === 'CMMC-Defender-AntivirusPolicy');
    expect(read).toMatchObject({
      '@odata.type': '#microsoft.graph.windows10GeneralConfiguration',
      defenderScanType: 'full',
      defenderCloudBlockLevel: 'high',
      defenderSignatureUpdateIntervalInHours: 4,
      defenderSystemScanSchedule: 'sunday',
    });
    expect(read!.defenderScheduledScanTime).toBeTruthy();
    expect(read!.assignments).toHaveLength(1);
    expect(read!.assignments[0].target.groupId).toBe(CUI_GROUP);
  });

  it('SI.L1-3.14.4.av-update-evidence: each Windows device answers its protection state; a device with none is a 404', async () => {
    await store.create('managedDevices', { id: 'managedDevice-1', deviceName: 'S1-WS-001', operatingSystem: 'Windows' });
    await store.create('managedDevices', { id: 'managedDevice-2', deviceName: 'S1-WS-002', operatingSystem: 'Windows' });
    await store.create('managedDevices', { id: 'managedDevice-3', deviceName: 'S1-IP-003', operatingSystem: 'iOS' });
    await store.create('windowsProtectionStates', {
      id: 'managedDevice-1', managedDeviceId: 'managedDevice-1', malwareProtectionEnabled: true,
      signatureVersion: '1.421.1206.0', signatureUpdateDateTime: '2026-10-31T20:00:00.000Z', signatureUpdateOverdue: false,
    });
    const devices = ((await table.resolveUri('GET', 'https://graph.microsoft.us/v1.0/deviceManagement/managedDevices')) as { value: Row[] }).value;
    const windows = devices.filter((d) => d.operatingSystem === 'Windows');
    expect(windows.map((d) => d.id).sort()).toEqual(['managedDevice-1', 'managedDevice-2']);
    const state = (await table.resolveUri('GET', 'https://graph.microsoft.us/beta/deviceManagement/managedDevices/managedDevice-1/windowsProtectionState')) as Row;
    expect(state).toMatchObject({ signatureVersion: '1.421.1206.0', signatureUpdateOverdue: false, malwareProtectionEnabled: true });
    await expect(table.resolveUri('GET', 'https://graph.microsoft.us/beta/deviceManagement/managedDevices/managedDevice-2/windowsProtectionState')).rejects.toThrow(/reports no Windows protection state/);
  });
});
