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
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { SECURITY_BASELINE_TEMPLATE } from '../../src/seed/sets/base.js';

/** P1.4b: four sim-vs-real-tenant gaps found by run 4 (see each test). */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIGS = '/v1.0/deviceManagement/deviceConfigurations';

describe('P1.4b simulator fidelity', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-p14b-'));
    const tenantRoot = path.join(dir, 'tenant');
    const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', 'muster-partial.json'));
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('Get-OrganizationConfig reports IsDehydrated true until Enable-OrganizationCustomization, then false', async () => {
    const before = (await table.resolveCmdlet('Get-OrganizationConfig', [])) as Array<Record<string, unknown>>;
    expect(before).toHaveLength(1);
    expect(before[0].IsDehydrated).toBe(true);
    await table.resolveCmdlet('Enable-OrganizationCustomization', []);
    const after = (await table.resolveCmdlet('Get-OrganizationConfig', [])) as Array<Record<string, unknown>>;
    expect(after[0].IsDehydrated).toBe(false);
  });

  it('a deviceConfigurations list holding mixed configuration types (URI POSTs and the SDK create cmdlet) lists every one', async () => {
    await table.resolveUri('POST', CONFIGS, { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'CMMC-ScreenLock-Policy', passwordRequired: true });
    await table.resolveUri('POST', CONFIGS, { '@odata.type': '#microsoft.graph.windowsWifiConfiguration', displayName: 'CMMC-WiFi-Secure', ssid: 'SIM-CUI-WIFI' });
    const created = (await table.resolveCmdlet('New-MgDeviceManagementDeviceConfiguration', [
      '-BodyParameter',
      { '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration', displayName: 'CMMC-Defender-AntivirusPolicy', defenderScanType: 'full' },
    ])) as { id: string };
    expect(created.id).not.toBe('deviceConfigurations');
    await table.resolveUri('POST', CONFIGS, { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'CMMC-CollaborativeDeviceBlock', cameraBlocked: true });

    const list = (await table.resolveUri('GET', `https://graph.microsoft.us${CONFIGS}`)) as { value: Array<Record<string, unknown>> };
    const names = list.value.map((c) => c.displayName);
    expect(names).toEqual(expect.arrayContaining(['CMMC-ScreenLock-Policy', 'CMMC-WiFi-Secure', 'CMMC-Defender-AntivirusPolicy', 'CMMC-CollaborativeDeviceBlock']));
    expect(new Set(list.value.map((c) => c.id)).size).toBe(list.value.length);
  });

  it('a store that already holds an object keyed by the collection name (older runs) still lists the collection', async () => {
    await store.create('deviceConfigurations', { id: 'deviceConfigurations', '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration', displayName: 'Legacy' });
    await table.resolveUri('POST', CONFIGS, { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'CMMC-CollaborativeDeviceBlock', cameraBlocked: true });
    const list = (await table.resolveUri('GET', CONFIGS)) as { value: Array<Record<string, unknown>> };
    expect(Array.isArray(list.value)).toBe(true);
    expect(list.value.map((c) => c.displayName)).toEqual(expect.arrayContaining(['Legacy', 'CMMC-CollaborativeDeviceBlock']));
  });

  it('Exchange rules report State as a string derived from Enabled', async () => {
    await table.resolveCmdlet('New-SafeAttachmentRule', ['-Name', 'CMMC-SafeAttach-Rule', '-SafeAttachmentPolicy', 'CMMC-SafeAttach', '-Enabled', true]);
    await table.resolveCmdlet('New-AntiPhishRule', ['-Name', 'CMMC-AntiPhish-Rule', '-AntiPhishPolicy', 'CMMC-AntiPhish', '-Enabled', false]);
    await table.resolveCmdlet('New-SafeLinksRule', ['-Name', 'CMMC-SafeLinks-Rule', '-SafeLinksPolicy', 'CMMC-SafeLinks']);
    const sa = (await table.resolveCmdlet('Get-SafeAttachmentRule', ['-Identity', 'CMMC-SafeAttach-Rule'])) as Record<string, unknown>;
    expect(sa.State).toBe('Enabled');
    const ap = (await table.resolveCmdlet('Get-AntiPhishRule', [])) as Array<Record<string, unknown>>;
    expect(ap.find((r) => r.Name === 'CMMC-AntiPhish-Rule')?.State).toBe('Disabled');
    const sl = (await table.resolveCmdlet('Get-SafeLinksRule', [])) as Array<Record<string, unknown>>;
    expect(sl.find((r) => r.Name === 'CMMC-SafeLinks-Rule')?.State).toBe('Enabled');
  });

  it('the security-baseline template is found by display name and readable by id', async () => {
    const flt = encodeURIComponent(`displayName eq '${SECURITY_BASELINE_TEMPLATE.displayName}'`);
    const list = (await table.resolveUri('GET', `https://graph.microsoft.us/beta/deviceManagement/templates?$filter=${flt}`)) as {
      value: Array<Record<string, unknown>>;
    };
    expect(list.value).toHaveLength(1);
    expect(list.value[0].id).toBe(SECURITY_BASELINE_TEMPLATE.id);
    expect(list.value[0].templateType).toBe('securityBaseline');
    const one = (await table.resolveUri('GET', `/beta/deviceManagement/templates/${SECURITY_BASELINE_TEMPLATE.id}`)) as Record<string, unknown>;
    expect(one.displayName).toBe(SECURITY_BASELINE_TEMPLATE.displayName);
  });
});
