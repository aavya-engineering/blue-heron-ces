// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.4 (PH-12 P12-R3) golden: each new SC registry entry's SET, then its GET, through ResolverTable, reads
// back the entry's expected value. The PowerShell projection each GET applies (Where-Object / Select-Object /
// [pscustomobject]) is mirrored in JS below; the request bodies are the ones each SET sends.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStore } from '../store/ObjectStore.js';
import { ResolverTable } from './ResolverTable.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';
import { timespanSeconds } from './depth10SCResolvers.js';

type Row = Record<string, any>;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(HERE, '../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const registry: Row[] = existsSync(REGISTRY) ? (JSON.parse(readFileSync(REGISTRY, 'utf8')) as { entries: Row[] }).entries : [];
const entry = (id: string): Row | undefined => registry.find((e) => e.entry_id === id);

const G = 'https://graph.microsoft.us';
const ABT = `${G}/v1.0/policies/activityBasedTimeoutPolicies`;
const CP = `${G}/beta/deviceManagement/configurationPolicies`;
const def = (t: string) => [`{"ActivityBasedTimeoutPolicy":{"Version":1,"ApplicationPolicies":[{"ApplicationId":"default","WebSessionIdleTimeout":"${t}"}]}}`];

/** The JS mirror of SC.L2-3.13.9.idle-session-timeout's GET projection. */
function idleRead(list: Row[]): Row | undefined {
  const p = list.find((x) => x.isOrganizationDefault === true);
  if (!p) return undefined;
  const t = (JSON.parse(p.definition[0]).ActivityBasedTimeoutPolicy.ApplicationPolicies as Row[]).find((a) => a.ApplicationId === 'default')?.WebSessionIdleTimeout;
  return { displayName: p.displayName, isOrganizationDefault: p.isOrganizationDefault, webSessionIdleTimeout: t, idleTimeoutWithinOneHour: !!t && timespanSeconds(t)! <= 3600 };
}

/** The JS mirror of the Settings Catalog entries' GET projection. */
function catalogRead(list: Row[], name: string, defId: string, field: string): Row | undefined {
  const p = list.find((x) => x.name === name);
  if (!p) return undefined;
  const inst = (p.settings as Row[]).map((s) => s.settingInstance).find((i) => i.settingDefinitionId === defId);
  return { name: p.name, [field]: inst?.choiceSettingValue?.value, assignments: p.assignments ?? [] };
}

const CATALOG: Array<{ id: string; name: string; defId: string; field: string }> = [
  { id: 'SC.L1-3.13.1.network-protection', name: 'CMMC-NetworkProtection', defId: 'device_vendor_msft_policy_config_defender_enablenetworkprotection', field: 'networkProtection' },
  { id: 'SC.L2-3.13.4.pagefile-clear', name: 'CMMC-SharedResource-PagefileClear', defId: 'device_vendor_msft_policy_config_localpoliciessecurityoptions_shutdown_clearvirtualmemorypagefile', field: 'clearPagefileAtShutdown' },
  { id: 'SC.L2-3.13.11.fips-mode', name: 'CMMC-FIPS-Mode', defId: 'device_vendor_msft_policy_config_cryptography_allowfipsalgorithmpolicy', field: 'fipsAlgorithmPolicy' },
];

describe('DEPTH-10.4 SC golden (depth10SCResolvers.ts + Settings Catalog round trip)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth104-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('idle session timeout: the GET is empty before the SET; POST then GET reads 01:00:00, within one hour', async () => {
    expect(((await table.resolveUri('GET', ABT)) as Row).value).toEqual([]);
    const created = (await table.resolveUri('POST', ABT, JSON.stringify({ displayName: 'CMMC-IdleSessionTimeout', isOrganizationDefault: true, definition: def('01:00:00') }))) as Row;
    expect(created).toMatchObject({ displayName: 'CMMC-IdleSessionTimeout', isOrganizationDefault: true, definition: def('01:00:00') });
    const read = idleRead(((await table.resolveUri('GET', ABT)) as Row).value);
    expect(read).toEqual({ displayName: 'CMMC-IdleSessionTimeout', isOrganizationDefault: true, webSessionIdleTimeout: '01:00:00', idleTimeoutWithinOneHour: true });
    expect(await table.resolveUri('GET', `${ABT}/${created.id}`)).toMatchObject({ id: created.id });
  });

  it('idle session timeout: an existing 24-hour default reads NOT within one hour until the PATCH lowers it', async () => {
    const seeded = (await table.resolveUri('POST', ABT, { displayName: 'Admin center idle timeout', isOrganizationDefault: true, definition: def('1.00:00:00') })) as Row;
    expect(idleRead(((await table.resolveUri('GET', ABT)) as Row).value)!.idleTimeoutWithinOneHour).toBe(false);
    expect(await table.resolveUri('PATCH', `${ABT}/${seeded.id}`, JSON.stringify({ definition: def('01:00:00') }))).toBeNull();
    expect(idleRead(((await table.resolveUri('GET', ABT)) as Row).value)).toMatchObject({ displayName: 'Admin center idle timeout', webSessionIdleTimeout: '01:00:00', idleTimeoutWithinOneHour: true });
  });

  it('idle session timeout: the service rules (one default, valid definition, 5 minutes to one day, 404 on an unknown id)', async () => {
    await table.resolveUri('POST', ABT, { displayName: 'A', isOrganizationDefault: true, definition: def('00:30:00') });
    await expect(table.resolveUri('POST', ABT, { displayName: 'B', isOrganizationDefault: true, definition: def('00:30:00') })).rejects.toThrow(/already the organization default/);
    await expect(table.resolveUri('POST', ABT, { displayName: 'C', definition: def('00:01:00') })).rejects.toThrow(/between 00:05:00 and one day/);
    await expect(table.resolveUri('POST', ABT, { displayName: 'D', definition: ['not json'] })).rejects.toThrow(/not JSON/);
    await expect(table.resolveUri('POST', ABT, { definition: def('01:00:00') })).rejects.toThrow(/displayName is required/);
    await expect(table.resolveUri('GET', `${ABT}/nope`)).rejects.toThrow(/no activityBasedTimeoutPolicy/);
    await expect(table.resolveUri('PATCH', `${ABT}/nope`, { displayName: 'x' })).rejects.toThrow(/no activityBasedTimeoutPolicy/);
  });

  for (const c of CATALOG) {
    it(`${c.id}: POST + assign to all devices, then GET $expand=settings,assignments reads the expected value`, async () => {
      const e = entry(c.id);
      const value = `${c.defId}_1`;
      if (e) {
        // the registry entry sends exactly this setting and expects exactly this value
        expect(e.set_command).toContain(`settingDefinitionId='${c.defId}'`);
        expect(e.set_command).toContain(`value='${value}'`);
        expect(e.set_command).toContain('allDevicesAssignmentTarget');
        expect(e.verification.evidence).toMatchObject({ jsonpath: `$.${c.field}`, equals: value });
      }
      expect(catalogRead(((await table.resolveUri('GET', `${CP}?$expand=settings,assignments`)) as Row).value, c.name, c.defId, c.field)).toBeUndefined();
      // the PowerShell shim turns a ConvertTo-Json string body back into an object before it reaches the resolver
      const created = (await table.resolveUri('POST', CP, {
        name: c.name, description: 'golden', platforms: 'windows10', technologies: 'mdm',
        settings: [{ '@odata.type': '#microsoft.graph.deviceManagementConfigurationSetting', settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: c.defId, choiceSettingValue: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingValue', value } } }],
      })) as Row;
      await table.resolveUri('POST', `${CP}/${created.id}/assign`, { assignments: [{ target: { '@odata.type': '#microsoft.graph.allDevicesAssignmentTarget' } }] });
      const read = catalogRead(((await table.resolveUri('GET', `${CP}?$expand=settings,assignments`)) as Row).value, c.name, c.defId, c.field)!;
      expect(read[c.field]).toBe(value);
      expect(read.assignments).toHaveLength(1);
      expect(read.assignments[0].target['@odata.type']).toBe('#microsoft.graph.allDevicesAssignmentTarget');
    });
  }
});
