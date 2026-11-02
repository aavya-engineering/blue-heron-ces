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

/**
 * synthetic-customer W5 cycle 2, follow-up 7 (2026-10-28): Intune
 * assignments for Stamper's create + assign SETs and its `$expand=assignments`
 * lookups (LOG-W5c3-stamper2.md §1.2, §2.3, §5 rows 1-3), through the real
 * resolver, with Stamper's exact URIs (absolute graph.microsoft.us form).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const G = 'https://graph.microsoft.us';
const CFG = `${G}/v1.0/deviceManagement/deviceConfigurations`;
const CAT = `${G}/beta/deviceManagement/configurationPolicies`;
const MAM = `${G}/v1.0/deviceAppManagement/iosManagedAppProtections`;
const GROUP_TARGET = '#microsoft.graph.groupAssignmentTarget';

type Row = Record<string, any>;

async function build(slug: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-fu7-${slug}-`));
  const tenantRoot = path.join(dir, 'tenant');
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
  const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
  return { dir, store, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const page = async (t: ResolverTable, uri: string) => ((await t.resolveUri('GET', uri)) as { value: Row[] }).value;
/** Stamper's assign body, as `@{assignments=@(@{target=@{...}})} | ConvertTo-Json -Depth 10` sends it (a JSON string). */
const assignBody = (groupId: string) => JSON.stringify({ assignments: [{ target: { '@odata.type': GROUP_TARGET, groupId } }] });

describe('W5c2 follow-up 7: create + assign on muster-partial (its seeds stay unassigned)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('device configuration: POST, then POST /{id}/assign; the expanded list shows the assignment, the bare list does not', async () => {
    const created = (await b.table.resolveUri('POST', CFG, { '@odata.type': '#microsoft.graph.windowsWifiConfiguration', displayName: 'CMMC-WiFi-Secure', ssid: 'SIM-CUI-WLAN', wifiSecurityType: 'wpa2Enterprise' })) as Row;
    expect(typeof created.id).toBe('string');
    expect(created.id).not.toBe('deviceConfigurations');
    const assigned = (await b.table.resolveUri('POST', `${CFG}/${created.id}/assign`, assignBody('group-1'))) as { value: Row[] };
    expect(assigned.value).toEqual([{ id: `${created.id}_group-1`, target: { '@odata.type': GROUP_TARGET, groupId: 'group-1' } }]);

    const expanded = await page(b.table, `${CFG}?$expand=assignments`);
    const mine = expanded.find((c) => c.displayName === 'CMMC-WiFi-Secure')!;
    expect(mine.assignments).toHaveLength(1);
    expect(mine.assignments[0].target.groupId).toBe('group-1');
    // Its generic seeds are unassigned: the expanded read gives them an empty array.
    for (const c of expanded.filter((x) => x.displayName !== 'CMMC-WiFi-Secure')) expect(c.assignments).toEqual([]);

    const bare = await page(b.table, CFG);
    expect(bare.every((c) => !('assignments' in c))).toBe(true);
    expect((await page(b.table, `${CFG}/${created.id}/assignments`)).map((a) => a.id)).toEqual([`${created.id}_group-1`]);
  });

  it('settings catalog: create + assign; $expand=settings,assignments returns both', async () => {
    const created = (await b.table.resolveUri('POST', CAT, { name: 'CMMC-ASR-Rules', platforms: 'windows10', technologies: 'mdm', settings: [{ id: '0', settingInstance: { settingDefinitionId: 'sim_asr' } }] })) as Row;
    await b.table.resolveUri('POST', `${CAT}/${created.id}/assign`, assignBody('group-1'));
    const both = (await page(b.table, `${CAT}?$expand=settings,assignments`)).find((p) => p.name === 'CMMC-ASR-Rules')!;
    expect(both.settings).toHaveLength(1);
    expect(both.assignments).toHaveLength(1);
    const settingsOnly = (await page(b.table, `${CAT}?$expand=settings`)).find((p) => p.name === 'CMMC-ASR-Rules')!;
    expect('assignments' in settingsOnly).toBe(false);
  });

  it('iOS app protection: create + assign; expanded read', async () => {
    const created = (await b.table.resolveUri('POST', MAM, { displayName: 'CMMC-iOS-MAM', appDataEncryptionType: 'whenDeviceLocked' })) as Row;
    await b.table.resolveUri('POST', `${MAM}/${created.id}/assign`, assignBody('group-1'));
    const mine = (await page(b.table, `${MAM}?$expand=assignments`)).find((p) => p.displayName === 'CMMC-iOS-MAM')!;
    expect(mine.assignments.map((a: Row) => a.target.groupId)).toEqual(['group-1']);
    expect(mine.isAssigned).toBe(true);
  });

  it('assign replaces the set; an unknown object is a 404; a body without assignments is a 400', async () => {
    const created = (await b.table.resolveUri('POST', CFG, { displayName: 'CMMC-CollaborativeDeviceBlock', cameraBlocked: true })) as Row;
    await b.table.resolveUri('POST', `${CFG}/${created.id}/assign`, assignBody('group-1'));
    await b.table.resolveUri('POST', `${CFG}/${created.id}/assign`, { assignments: [{ target: { '@odata.type': GROUP_TARGET, groupId: 'group-2' } }] });
    expect((await page(b.table, `${CFG}/${created.id}/assignments`)).map((a) => a.target.groupId)).toEqual(['group-2']);
    await expect(b.table.resolveUri('POST', `${CFG}/nope/assign`, assignBody('group-1'))).rejects.toThrow(/no deviceConfigurations object/);
    await expect(b.table.resolveUri('POST', `${CFG}/${created.id}/assign`, { target: {} })).rejects.toThrow(/assignments array/);
  });
});

describe('W5c2 follow-up 7: S1 Intune seeds are assigned to the CUI enclave group', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  const assignedToCui = (o: Row) => Array.isArray(o.assignments) && o.assignments.length === 1
    && o.assignments[0].target['@odata.type'] === GROUP_TARGET && o.assignments[0].target.groupId === 'group-1'
    && o.assignments[0].id === `${o.id}_group-1`;

  it('every S1 device configuration, compliance policy, settings-catalog policy and iOS app protection policy is assigned (expanded reads only)', async () => {
    for (const uri of [CFG, `${G}/v1.0/deviceManagement/deviceCompliancePolicies`, MAM]) {
      const expanded = await page(b.table, `${uri}?$expand=assignments`);
      expect(expanded.length, uri).toBeGreaterThan(0);
      expect(expanded.every(assignedToCui), uri).toBe(true);
      expect((await page(b.table, uri)).every((o) => !('assignments' in o)), uri).toBe(true);
    }
    const cat = await page(b.table, `${CAT}?$expand=settings,assignments`);
    expect(cat.map((p) => p.name)).toEqual(['S1 Windows 11 credential UI', 'S1 Windows time synchronisation (NTP)']);
    expect(cat.every(assignedToCui)).toBe(true);
    expect(cat[0].settings).toHaveLength(2);
  });

  it("Stamper's Intune lookups (by effect) now find S1's equivalents (LOG-W5c3-stamper2.md §2.3)", async () => {
    const list = await page(b.table, `${CFG}?$expand=assignments`);
    const assigned = (c: Row) => (c.assignments ?? []).length > 0;
    // AC.L2-3.1.16.wifi-profile: wpa2Enterprise, ssid = {wifiSsid} (S1-MACH-CORP), assigned.
    expect(list.filter((c) => c.wifiSecurityType === 'wpa2Enterprise' && c.ssid === 'S1-MACH-CORP' && assigned(c)).map((c) => c.displayName)).toEqual(['S1-MACH-CORP Wi-Fi']);
    // AC.L2-3.1.21.block-storage: storageBlockRemovableStorage true, assigned.
    expect(list.filter((c) => c.storageBlockRemovableStorage === true && assigned(c)).map((c) => c.displayName)).toEqual(['S1-Block-Removable-Storage']);
    // SI.L1-3.14.5.scan-schedule-evidence: quick/full scan, a day or everyday, a scan time, assigned.
    const days = ['everyday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    expect(list.filter((c) => ['quick', 'full'].includes(c.defenderScanType) && days.includes(c.defenderSystemScanSchedule) && !!c.defenderScheduledScanTime && assigned(c)).map((c) => c.displayName)).toEqual(['S1-Defender-AV']);
    // No S1 screen-lock, camera, app-control, install-control, update-ring or BitLocker configuration: those stay creates.
    expect(list.some((c) => c.passwordMinutesOfInactivityBeforeScreenTimeout !== undefined || c.cameraBlocked !== undefined || c.bitLockerEncryptDevice !== undefined || c.qualityUpdatesDeferralPeriodInDays !== undefined)).toBe(false);
  });

  it('the cmdlet read keeps returning the stored object (assignments inline, as the cmdlet path always has)', async () => {
    const viaCmdlet = (await b.table.resolveCmdlet('Get-MgDeviceManagementDeviceConfiguration', [])) as Row[];
    expect(viaCmdlet.every(assignedToCui)).toBe(true);
  });
});
