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
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { Ledger } from '../../src/ledger/Ledger.js';
import { SeedEngine } from '../../src/seed/SeedEngine.js';
import { loadProfile, resolveProfilePath } from '../../src/profiles/ProfileLoader.js';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';

/**
 * synthetic-customer W5 cycle 2, follow-up 13 (2026-10-28): pins
 * REQ-tenant-stacksim-vpn-device-configurations on the GENERIC tenant
 * (`stacksim serve m365_azure`, the profile's gcc-high-g5 seed): the
 * Always-On VPN profile with enableSplitTunneling false is served on the
 * exact read EvidenceOps now makes (DEVICE_CONFIGURATIONS_URI, with
 * `$expand=assignments`) and on the cmdlet, top-level and in
 * AdditionalProperties. The scenario tenants (S1, S2, S3, muster-partial)
 * model their own customers and carry no such profile, by design: a test
 * that reads them instead of the generic tenant cannot find it.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES = path.join(SIM_ROOT, 'profiles');
const EO_DEVICE_CONFIGURATIONS_URI = '/v1.0/deviceManagement/deviceConfigurations?$expand=assignments';
type Row = Record<string, any>;
const isVpn = (d: Row) => /VpnConfiguration/i.test(String(d?.['@odata.type'] ?? d?.AdditionalProperties?.['@odata.type'] ?? ''));

describe('W5c2 follow-up 13: the generic m365_azure tenant serves the seeded VPN profile', () => {
  let dir: string;
  let table: ResolverTable;
  let seededCount = 0;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-w5c2-fu13-'));
    const store = new ObjectStore(path.join(dir, 'store.json'));
    const profile = await loadProfile(resolveProfilePath('m365_azure', PROFILES));
    expect(profile.seedSets).toEqual(['gcc-high-g5']);
    const r = await new SeedEngine(store, new Ledger(path.join(dir, 'ledger.jsonl'))).seed(profile);
    seededCount = r.counts.deviceConfigurations;
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  }, 60_000);
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("EO's exact read ($expand=assignments) and the absolute-URL form return the VPN profile with enableSplitTunneling false, top-level and in AdditionalProperties", async () => {
    expect(seededCount).toBe(3);
    for (const uri of [EO_DEVICE_CONFIGURATIONS_URI, `https://graph.microsoft.us${EO_DEVICE_CONFIGURATIONS_URI}`, '/v1.0/deviceManagement/deviceConfigurations']) {
      const items = ((await table.resolveUri('GET', uri)) as { value: Row[] }).value;
      const vpn = items.filter(isVpn);
      expect(vpn.map((v) => v.id), uri).toEqual(['deviceConfiguration-vpn-1']);
      expect(vpn[0]).toMatchObject({ displayName: 'Sim Always On VPN - Enclave', enableSplitTunneling: false, connectionName: 'Enclave' });
      expect(vpn[0].AdditionalProperties).toMatchObject({ '@odata.type': '#microsoft.graph.windows10VpnConfiguration', enableSplitTunneling: false });
    }
  });

  it('the cmdlet read (Get-MgDeviceManagementDeviceConfiguration) returns it too', async () => {
    const items = (await table.resolveCmdlet('Get-MgDeviceManagementDeviceConfiguration', [])) as Row[];
    expect(items.filter(isVpn).map((v) => v.enableSplitTunneling)).toEqual([false]);
  });
});

describe('W5c2 follow-up 13: the scenario tenants carry no generic VPN profile (they are not the generic tenant)', () => {
  for (const slug of ['s1-mach', 'muster-partial']) {
    it(`${slug}: no VpnConfiguration on the device-configuration read`, async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-fu13-${slug}-`));
      try {
        const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
        await applyScenario(scenario, { profilesDir: PROFILES, tenantRoot: path.join(dir, 't') });
        const t = new ResolverTable(new ObjectStore(path.join(dir, 't', 'store.json')), new StackShapeGate('m365_azure'));
        const items = ((await t.resolveUri('GET', EO_DEVICE_CONFIGURATIONS_URI)) as { value: Row[] }).value;
        expect(items.length).toBeGreaterThan(0);
        expect(items.filter(isVpn)).toEqual([]);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }, 60_000);
  }
});
