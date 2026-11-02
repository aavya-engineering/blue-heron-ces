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
 * synthetic-customer W5 cycle 2, follow-up 12 (2026-10-28): Azure Monitor
 * action groups for Stamper's AZ-MON-001 (infrastructure registry): its
 * lookup over `Get-AzActionGroup` (by name 'CMMC-AlertGroup', or by effect:
 * enabled and mailing {cisoEmail}), its SET (New-AzActionGroupEmailReceiverObject
 * + New-AzActionGroup), Set-AzActionGroup, and the ARM list.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const S1_SECURITY = 'security@s1-mach.simtenant.onmicrosoft.us';
type Row = Record<string, any>;
const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);

async function build(slug: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-fu12-${slug}-`));
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot: path.join(dir, 'tenant') });
  return { dir, table: new ResolverTable(new ObjectStore(path.join(dir, 'tenant', 'store.json')), new StackShapeGate('m365_azure')) };
}

/** AZ-MON-001's lookup (get_command), reproduced. */
async function azMon001Lookup(t: ResolverTable, cisoEmail: string): Promise<Row | undefined> {
  const projected = asList(await t.resolveCmdlet('Get-AzActionGroup', [])).map((g) => ({
    Name: g.Name, ResourceGroupName: g.ResourceGroupName, Enabled: g.Enabled,
    EmailAddresses: [...asList(g.EmailReceiver), ...asList(g.EmailReceivers)].filter(Boolean).map((r) => r.EmailAddress),
  }));
  const hits = projected.filter((g) => g.Name === 'CMMC-AlertGroup' || (g.Enabled === true && g.EmailAddresses.includes(cisoEmail)));
  return hits.sort((a, b) => Number(a.Name !== 'CMMC-AlertGroup') - Number(b.Name !== 'CMMC-AlertGroup'))[0];
}

describe('W5c2 follow-up 12: S1 action group (found by effect, no create)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('Get-AzActionGroup, subscription-wide and resource-group scoped, with Name, ResourceGroupName, Enabled, Location, EmailReceiver[]', async () => {
    const all = asList(await b.table.resolveCmdlet('Get-AzActionGroup', []));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ Name: 'ag-s1-security-alerts', ResourceGroupName: 'rg-s1-mach-prod', Enabled: true, Location: 'Global' });
    expect(all[0].EmailReceiver).toEqual([{ Name: 'S1 Security mailbox', EmailAddress: S1_SECURITY, UseCommonAlertSchema: true, Status: 'Enabled' }]);
    expect(asList(await b.table.resolveCmdlet('Get-AzActionGroup', ['-ResourceGroupName', 'rg-s1-mach-prod']))).toHaveLength(1);
    expect(asList(await b.table.resolveCmdlet('Get-AzActionGroup', ['-ResourceGroupName', 'other-rg']))).toEqual([]);
    expect(asList(await b.table.resolveCmdlet('Get-AzActionGroup', ['-ResourceGroupName', 'rg-s1-mach-prod', '-Name', 'CMMC-AlertGroup']))).toEqual([]);
  });

  it("AZ-MON-001's lookup finds S1's group by effect for {cisoEmail} = the security mailbox", async () => {
    const found = await azMon001Lookup(b.table, S1_SECURITY);
    expect(found).toEqual({ Name: 'ag-s1-security-alerts', ResourceGroupName: 'rg-s1-mach-prod', Enabled: true, EmailAddresses: [S1_SECURITY] });
    expect(await azMon001Lookup(b.table, 'someone.else@example.test')).toBeUndefined();
  });

  it('the ARM list (Invoke-AzRestMethod -Path .../providers/Microsoft.Insights/actionGroups)', async () => {
    const sub = '51510000-00a2-4000-8000-000000000001';
    const out = (await b.table.resolveCmdlet('Invoke-AzRestMethod', ['-Path', `/subscriptions/${sub}/providers/Microsoft.Insights/actionGroups?api-version=2023-01-01`, '-Method', 'GET'])) as { value: Row[] };
    expect(out.value).toHaveLength(1);
    expect(out.value[0]).toMatchObject({ name: 'ag-s1-security-alerts', type: 'Microsoft.Insights/ActionGroups', properties: { enabled: true, emailReceivers: [{ emailAddress: S1_SECURITY }] } });
    const rgScoped = (await b.table.resolveCmdlet('Invoke-AzRestMethod', ['-Path', `/subscriptions/${sub}/resourceGroups/rg-s1-mach-prod/providers/Microsoft.Insights/actionGroups?api-version=2023-01-01`, '-Method', 'GET'])) as { value: Row[] };
    expect(rgScoped.value).toHaveLength(1);
  });
});

describe('W5c2 follow-up 12: muster-partial (no group; CES creates one)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  const RG = 'sim-rg-muster-partial';
  const CISO = 'security@muster-partial.simtenant.onmicrosoft.us';
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it("empty before; AZ-MON-001's SET creates CMMC-AlertGroup with its receiver; the lookup then finds it by name; Set- updates it", async () => {
    expect(asList(await b.table.resolveCmdlet('Get-AzActionGroup', []))).toEqual([]);
    expect(await azMon001Lookup(b.table, CISO)).toBeUndefined();
    const receiver = await b.table.resolveCmdlet('New-AzActionGroupEmailReceiverObject', ['-Name', 'CISO', '-EmailAddress', CISO, '-UseCommonAlertSchema', true]);
    expect(receiver).toMatchObject({ Name: 'CISO', EmailAddress: CISO, UseCommonAlertSchema: true });
    // PS 5.1 may wrap @($emailReceiver) as {value, Count}.
    await b.table.resolveCmdlet('New-AzActionGroup', ['-ResourceGroupName', RG, '-Name', 'CMMC-AlertGroup', '-ShortName', 'CMMCAlert', '-Location', 'Global', '-EmailReceiver', { value: [receiver], Count: 1 }]);
    const found = await azMon001Lookup(b.table, CISO);
    expect(found).toEqual({ Name: 'CMMC-AlertGroup', ResourceGroupName: RG, Enabled: true, EmailAddresses: [CISO] });
    const g = asList(await b.table.resolveCmdlet('Get-AzActionGroup', ['-ResourceGroupName', RG, '-Name', 'CMMC-AlertGroup']))[0];
    expect(g).toMatchObject({ GroupShortName: 'CMMCAlert', Location: 'Global', Id: `/subscriptions/sim-sub/resourceGroups/${RG}/providers/Microsoft.Insights/actionGroups/CMMC-AlertGroup` });
    await b.table.resolveCmdlet('Set-AzActionGroup', ['-ResourceGroupName', RG, '-Name', 'CMMC-AlertGroup', '-EmailReceiver', [{ Name: 'ISSO', EmailAddress: 'isso@muster-partial.simtenant.onmicrosoft.us' }]]);
    expect(asList(await b.table.resolveCmdlet('Get-AzActionGroup', []))[0].EmailReceiver.map((r: Row) => r.EmailAddress)).toEqual(['isso@muster-partial.simtenant.onmicrosoft.us']);
    // New- again is create-or-update (one group), Set- on a missing group is a 404.
    await b.table.resolveCmdlet('New-AzActionGroup', ['-ResourceGroupName', RG, '-Name', 'CMMC-AlertGroup', '-ShortName', 'CMMCAlert', '-EmailReceiver', [receiver]]);
    expect(asList(await b.table.resolveCmdlet('Get-AzActionGroup', []))).toHaveLength(1);
    await expect(b.table.resolveCmdlet('Set-AzActionGroup', ['-ResourceGroupName', RG, '-Name', 'nope'])).rejects.toThrow(/no action group/);
    // The receiver constructor stored nothing.
    expect(asList(await b.table.resolveCmdlet('Get-AzActionGroup', [])).every((x) => x.Name === 'CMMC-AlertGroup')).toBe(true);
  });
});
