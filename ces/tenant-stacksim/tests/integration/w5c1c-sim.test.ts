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
 * synthetic-customer W5 cycle 1, simulator part c (2026-10-28): the reads
 * EO's fetcher makes after its select/expand fix (LOG-W5c1-eo-fetch.md §2),
 * through the real resolver chain:
 *  - GET /beta/deviceManagement/configurationPolicies?$expand=settings is
 *    served from the cmdlet's collection, settings inline only on $expand;
 *  - GET /v1.0/policies/roleManagementPolicies with the scope $filter and
 *    $expand=rules, rules inline only on $expand.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ANCHOR_ISO = '2026-10-01T00:00:00.000Z';
// The exact URIs ces-eo ComplianceSignalFetcher.ts sends (CONFIGURATION_POLICIES_URI, PIM_POLICIES_URI).
const EO_CONFIG_URI = '/beta/deviceManagement/configurationPolicies?$expand=settings';
const EO_PIM_URI = "/v1.0/policies/roleManagementPolicies?$filter=scopeId%20eq%20'/'%20and%20scopeType%20eq%20'DirectoryRole'&$expand=rules";
const PIM_FILTER_ONLY = "/v1.0/policies/roleManagementPolicies?$filter=scopeId%20eq%20'/'%20and%20scopeType%20eq%20'DirectoryRole'";

type Row = Record<string, unknown>;

async function build(slug: string, fixed?: string): Promise<{ dir: string; table: ResolverTable }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c1c-${slug}-`));
  const tenantRoot = path.join(dir, 'tenant');
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  const prev = process.env.STACKSIM_FIXED_NOW;
  if (fixed) process.env.STACKSIM_FIXED_NOW = fixed;
  try {
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
  } finally {
    if (prev === undefined) delete process.env.STACKSIM_FIXED_NOW;
    else process.env.STACKSIM_FIXED_NOW = prev;
  }
  const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
  return { dir, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);
const page = async (t: ResolverTable, uri: string) => (await t.resolveUri('GET', uri)) as { value: Row[] } & Row;

describe('W5c1-c: S1 (s1-mach) EO settings-catalog and PIM reads', () => {
  let b: { dir: string; table: ResolverTable };
  beforeAll(async () => {
    b = await build('s1-mach', ANCHOR_ISO);
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('serves the SIM-7 settings-catalog policy on the beta URI, settings inline only with $expand=settings', async () => {
    const expanded = await page(b.table, EO_CONFIG_URI);
    // W5c2 follow-up 10: + the NTP policy (SIM-W4c5).
    expect(expanded.value).toHaveLength(2);
    expect(expanded['@odata.nextLink']).toBeUndefined();
    const p = expanded.value.find((x) => x.name === 'S1 Windows 11 credential UI')!;
    expect(p.name).toBe('S1 Windows 11 credential UI');
    const settings = p.settings as Row[];
    expect(settings).toHaveLength(2);
    expect(JSON.stringify(settings)).toMatch(/credentialsui_disablepasswordreveal_1/);
    // Same object as the cmdlet's read (one collection).
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementConfigurationPolicy', []));
    expect(viaCmdlet.map((c) => c.id)).toEqual(expanded.value.map((x) => x.id));
    // Without $expand: the policy, no settings key (Graph's shape).
    const bare = await page(b.table, '/beta/deviceManagement/configurationPolicies');
    expect(bare.value).toHaveLength(2);
    expect(bare.value.every((x) => !('settings' in x))).toBe(true);
    expect(bare.value[0]).toMatchObject({ id: p.id, name: 'S1 Windows 11 credential UI', settingCount: 2 });
    // $expand names are case-insensitive; an expand of something else does not bring settings.
    expect('settings' in (await page(b.table, '/beta/deviceManagement/configurationPolicies?$expand=Settings')).value[0]).toBe(true);
    expect('settings' in (await page(b.table, '/beta/deviceManagement/configurationPolicies?$expand=assignments')).value[0]).toBe(false);
    // The cmdlet path is unchanged: settings stay inline there.
    expect(Array.isArray(viaCmdlet[0].settings)).toBe(true);
  });

  it("keeps Stamper's ASR create working: the POST adds a new member the beta GET and the cmdlet both see", async () => {
    const created = (await b.table.resolveUri('POST', 'https://graph.microsoft.us/beta/deviceManagement/configurationPolicies', {
      name: 'CMMC-ASR-Rules',
      platforms: 'windows10',
      technologies: 'mdm',
      settings: [{ settingInstance: { settingDefinitionId: 'device_vendor_msft_policy_config_defender_attacksurfacereductionrules' } }],
    })) as Row;
    expect(created.id).not.toBe('deviceManagementConfigurationPolicies');
    const listed = (await page(b.table, 'https://graph.microsoft.us/beta/deviceManagement/configurationPolicies')).value;
    expect(listed.map((p) => p.name).sort()).toEqual(['CMMC-ASR-Rules', 'S1 Windows 11 credential UI', 'S1 Windows time synchronisation (NTP)']);
    expect(listed.filter((p) => String(p.name).startsWith('CMMC-ASR'))).toHaveLength(1);
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementConfigurationPolicy', []));
    expect(viaCmdlet.map((p) => p.name).sort()).toEqual(['CMMC-ASR-Rules', 'S1 Windows 11 credential UI', 'S1 Windows time synchronisation (NTP)']);
    const expanded = (await page(b.table, EO_CONFIG_URI)).value.find((p) => p.name === 'CMMC-ASR-Rules')!;
    expect(expanded.settings).toHaveLength(1);
  });

  // W5c2 follow-up 4: 6 = the 5 managed roles + Compliance Administrator (Entra defaults).
  it("EO's PIM read: the scope $filter returns S1's 6 directory-role policies, rules inline only with $expand=rules", async () => {
    const eo = await page(b.table, EO_PIM_URI);
    expect(eo.value).toHaveLength(6);
    expect(eo['@odata.nextLink']).toBeUndefined();
    for (const p of eo.value) {
      expect(p).toMatchObject({ scopeId: '/', scopeType: 'DirectoryRole' });
      expect((p.rules as Row[]).some((r) => r.id === 'Approval_EndUser_Assignment')).toBe(true);
    }
    const noExpand = await page(b.table, PIM_FILTER_ONLY);
    expect(noExpand.value.map((p) => p.id)).toEqual(eo.value.map((p) => p.id));
    expect(noExpand.value.some((p) => 'rules' in p)).toBe(false);
    // The filter is applied, not ignored.
    expect((await page(b.table, "/v1.0/policies/roleManagementPolicies?$filter=scopeId eq '/' and scopeType eq 'Directory'&$expand=rules")).value).toHaveLength(0);
    // The cmdlet path is unchanged: rules stay inline there.
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicy', []));
    expect(viaCmdlet.every((p) => Array.isArray(p.rules))).toBe(true);
  });
});

describe('W5c1-c: muster-partial EO settings-catalog and PIM reads', () => {
  let b: { dir: string; table: ResolverTable };
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('the beta settings-catalog read serves its one generic policy (it has no settings)', async () => {
    const out = await page(b.table, EO_CONFIG_URI);
    expect(out.value).toHaveLength(1);
    expect(out.value[0]).toMatchObject({ name: 'Sim Configuration Policy 1', platforms: 'windows10' });
    expect('settings' in out.value[0]).toBe(false);
  });

  // W5c2 (2026-10-28): the muster-partial-config set gives the generic policy
  // scopeType 'DirectoryRole' (it had scopeId '/' only, so this read was
  // empty) and Entra's default rules (no approval); w5c2-sim.test.ts tests them.
  it("EO's PIM read returns the generic policy (scopeId '/', scopeType 'DirectoryRole') with its rules", async () => {
    const out = (await page(b.table, EO_PIM_URI)).value;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'roleManagementPolicy-1', scopeId: '/', scopeType: 'DirectoryRole' });
    expect(Array.isArray(out[0].rules)).toBe(true);
    const all = (await page(b.table, '/v1.0/policies/roleManagementPolicies')).value;
    expect(all).toHaveLength(1);
  });
});
