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
import { loadScenario, applyScenario } from '../scenarios/ScenarioEngine.js';
import { ObjectStore } from '../store/ObjectStore.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';
import { ResolverTable } from './ResolverTable.js';

/**
 * PH-12 P12-AO (2026-11-01) golden tests: every AO op the R-F9 S1 sweep (E7S, V77) could not apply
 * now SETs, and the GET after it reads the SET's value, on the simulator:
 *  - A-01's Temporary Access Pass (aoResolvers.ts): GET empty, POST, GET one (value never readable);
 *  - F-08's `az resource update --ids <ARM id>` on S1's storage account (seed: ARM ids + armResources);
 *  - B-08 / B-09 on S1's Android app protection policy (seed);
 *  - D-11's discovery value, the CUI group's mail (seed: mail-enabled), and the label write;
 *  - S2 and S3 keep their CUI group and app protection as before.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ANCHOR_ISO = '2026-10-01T00:00:00.000Z';
type Row = Record<string, unknown>;

async function build(slug: string): Promise<{ dir: string; table: ResolverTable; store: ObjectStore }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-p12ao-${slug}-`));
  const tenantRoot = path.join(dir, 'tenant');
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  const prev = process.env.STACKSIM_FIXED_NOW;
  process.env.STACKSIM_FIXED_NOW = ANCHOR_ISO;
  try {
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
  } finally {
    if (prev === undefined) delete process.env.STACKSIM_FIXED_NOW;
    else process.env.STACKSIM_FIXED_NOW = prev;
  }
  const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
  return { dir, store, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const value = (v: unknown): Row[] => ((v as { value?: Row[] }).value ?? (Array.isArray(v) ? (v as Row[]) : [v as Row]));
const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);

describe('P12-AO on S1 (s1-mach)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 180_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  describe('A-01: Temporary Access Pass (aoResolvers.ts)', () => {
    const upn = 'alvane.ashenmere@s1-mach.simtenant.onmicrosoft.us';
    const uri = (id: string) => `/v1.0/users/${id}/authentication/temporaryAccessPassMethods`;

    it('GET is empty, POST issues one, GET then reads it (by id and by UPN) with no pass value', async () => {
      const user = asList(await b.table.resolveCmdlet('Get-MgUser', ['-Filter', `userPrincipalName eq '${upn}'`]))[0];
      expect(user).toBeDefined();
      const id = String(user.id ?? user.Id);
      expect(value(await b.table.resolveUri('GET', uri(id)))).toEqual([]);
      const created = (await b.table.resolveUri('POST', uri(id), { isUsableOnce: true, lifetimeInMinutes: 480 })) as Row;
      expect(created).toMatchObject({ '@odata.type': '#microsoft.graph.temporaryAccessPassAuthenticationMethod', isUsableOnce: true, lifetimeInMinutes: 480, isUsable: true });
      expect(typeof created.temporaryAccessPass).toBe('string');
      expect(String(created.temporaryAccessPass)).toHaveLength(8);
      const after = value(await b.table.resolveUri('GET', uri(id)));
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id: created.id, lifetimeInMinutes: 480, temporaryAccessPass: null });
      expect(value(await b.table.resolveUri('GET', `https://graph.microsoft.us${uri(encodeURIComponent(upn))}`))).toHaveLength(1);
      expect(await b.table.resolveUri('GET', `${uri(id)}/${String(created.id)}`)).toMatchObject({ id: created.id, temporaryAccessPass: null });
      // the store never holds the value
      expect(JSON.stringify(await b.store.list('temporaryAccessPassMethods'))).not.toContain(String(created.temporaryAccessPass));
      // one pass per user
      await expect(b.table.resolveUri('POST', uri(id), { isUsableOnce: true, lifetimeInMinutes: 60 })).rejects.toMatchObject({ statusCode: 400 });
      // DELETE removes it
      await b.table.resolveUri('DELETE', `${uri(id)}/${String(created.id)}`);
      expect(value(await b.table.resolveUri('GET', uri(id)))).toEqual([]);
    });

    it('refuses what the service refuses: unknown user 404; outside the policy lifetime, or multi-use under a one-time policy, 400', async () => {
      await expect(b.table.resolveUri('GET', uri('no-such-user'))).rejects.toMatchObject({ statusCode: 404 });
      await expect(b.table.resolveUri('POST', uri('no-such-user'), { isUsableOnce: true })).rejects.toMatchObject({ statusCode: 404 });
      const user = asList(await b.table.resolveCmdlet('Get-MgUser', ['-Filter', `userPrincipalName eq '${upn}'`]))[0];
      const id = String(user.id ?? user.Id);
      await expect(b.table.resolveUri('POST', uri(id), { isUsableOnce: true, lifetimeInMinutes: 481 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(b.table.resolveUri('POST', uri(id), { isUsableOnce: false, lifetimeInMinutes: 60 })).rejects.toMatchObject({ statusCode: 400 });
      expect(value(await b.table.resolveUri('GET', uri(id)))).toEqual([]);
    });
  });

  it('F-08: Get-AzStorageAccount carries the ARM id, and az resource update on it PATCHes the armResources row', async () => {
    const sas = asList(await b.table.resolveCmdlet('Get-AzStorageAccount', []));
    const first = sas.find((s) => s.id === 'storageAccount-1' || s.Id === '/subscriptions/51510000-00a2-4000-8000-000000000001/resourceGroups/rg-s1-mach-prod/providers/Microsoft.Storage/storageAccounts/simstorage1')!;
    expect(first).toBeDefined();
    const armId = String(first.Id);
    expect(armId).toBe('/subscriptions/51510000-00a2-4000-8000-000000000001/resourceGroups/rg-s1-mach-prod/providers/Microsoft.Storage/storageAccounts/simstorage1');
    // the az shim escapes --ids into one path segment (azshim/az-shim.ps1 'resource update')
    await b.table.resolveUri('PATCH', `/azcli/resource/${encodeURIComponent(armId)}`, { supportsHttpsTrafficOnly: 'true' });
    const row = (await b.store.list('armResources')).find((r) => r.id === armId) as Row | undefined;
    expect(row).toMatchObject({ type: 'Microsoft.Storage/storageAccounts', name: 'simstorage1', supportsHttpsTrafficOnly: 'true' });
  });

  it('B-08 / B-09: the Android app protection policy is discoverable (non-CMMC), its apps take a new app, and its settings update', async () => {
    const pols = value(await b.table.resolveUri('GET', '/v1.0/deviceAppManagement/androidManagedAppProtections'));
    const customer = pols.filter((p) => !/^CMMC-/i.test(String(p.displayName)));
    expect(customer).toHaveLength(1);
    const pid = String(customer[0].id);
    // B-08 set, then its get
    await b.table.resolveCmdlet('New-MgDeviceAppManagementAndroidManagedAppProtectionApp', [
      '-AndroidManagedAppProtectionId', pid,
      '-BodyParameter', { '@odata.type': '#microsoft.graph.managedMobileApp', mobileAppIdentifier: { '@odata.type': '#microsoft.graph.androidMobileAppIdentifier', packageId: 'com.microsoft.office.outlook' } },
    ]);
    const apps = asList(await b.table.resolveCmdlet('Get-MgDeviceAppManagementAndroidManagedAppProtectionApp', ['-AndroidManagedAppProtectionId', pid, '-All']));
    expect(JSON.stringify(apps)).toContain('com.microsoft.office.outlook');
    // B-09 set (Android half), then its get
    await b.table.resolveCmdlet('Update-MgDeviceAppManagementAndroidManagedAppProtection', ['-AndroidManagedAppProtectionId', pid, '-DataBackupBlocked:$true', '-SendOrgDataToOtherApps', 'none', '-ReceiveDataFromOtherApps', 'none', '-SaveAsBlocked:$true']);
    const got = asList(await b.table.resolveCmdlet('Get-MgDeviceAppManagementAndroidManagedAppProtection', ['-All'])).find((p) => String(p.id ?? p.Id) === pid)!;
    expect(got).toBeDefined();
    expect(JSON.stringify(got)).toMatch(/"(S|s)endOrgDataToOtherApps":"none"/);
    // B-09 set (iOS half) on S1's iOS policy, then its read
    const ios = value(await b.table.resolveUri('GET', '/v1.0/deviceAppManagement/iosManagedAppProtections')).filter((p) => !/^CMMC-/i.test(String(p.displayName)));
    expect(ios).toHaveLength(1);
    const iid = String(ios[0].id);
    await b.table.resolveCmdlet('Update-MgDeviceAppManagementIosManagedAppProtection', ['-IosManagedAppProtectionId', iid, '-DataBackupBlocked:$true', '-SendOrgDataToOtherApps', 'none', '-ReceiveDataFromOtherApps', 'none', '-SaveAsBlocked:$true']);
    const gotIos = asList(await b.table.resolveCmdlet('Get-MgDeviceAppManagementIosManagedAppProtection', ['-All'])).find((p) => String(p.id ?? p.Id) === iid)!;
    expect(JSON.stringify(gotIos)).toMatch(/"(S|s)endOrgDataToOtherApps":"none"/);
  });

  it('D-11: the CUI group is a mail-enabled security group with an address; Set-Label grants it rights', async () => {
    const groups = value(await b.table.resolveUri('GET', '/v1.0/groups'));
    const cui = groups.filter((g) => g.displayName === 'CUI-Authorized-Users');
    expect(cui).toHaveLength(1);
    expect(cui[0]).toMatchObject({ securityEnabled: true, mailEnabled: true, mail: 'cui-authorized-users@s1-mach.simtenant.onmicrosoft.us' });
    const mail = String(cui[0].mail);
    const label = asList(await b.table.resolveCmdlet('Get-Label', [])).find((l) => l.DisplayName === 'CUI' || l.displayName === 'CUI')!;
    expect(label).toBeDefined();
    const guid = String(label.Guid ?? label.ImmutableId ?? label.id);
    await b.table.resolveCmdlet('Set-Label', ['-Identity', guid, '-EncryptionEnabled', true, '-EncryptionProtectionType', 'Template', '-EncryptionRightsDefinitions', `${mail}:VIEW,VIEWRIGHTSDATA,DOCEDIT,EDIT,PRINT,EXTRACT,REPLY,REPLYALL,FORWARD,OBJMODEL`]);
    const after = asList(await b.table.resolveCmdlet('Get-Label', [])).find((l) => String(l.Guid ?? l.ImmutableId ?? l.id) === guid)!;
    expect(after).toMatchObject({ EncryptionEnabled: true });
    expect(JSON.stringify(after)).toContain(mail);
  });
});

describe.each(['s2-eng', 's3-def'])('P12-AO leaves %s as it was', (slug) => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build(slug);
  }, 180_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('the CUI group stays security-only (no S1 override)', async () => {
    const cui = value(await b.table.resolveUri('GET', '/v1.0/groups')).filter((g) => g.displayName === 'CUI-Authorized-Users');
    expect(cui).toHaveLength(1);
    expect(cui[0]).toMatchObject({ securityEnabled: true, mailEnabled: false });
    expect(cui[0].mail ?? null).toBeNull();
  });

  it('the Android app protection is the scenario\'s own (S2: its BYOD policy; S3: none)', async () => {
    const pols = value(await b.table.resolveUri('GET', '/v1.0/deviceAppManagement/androidManagedAppProtections'));
    if (slug === 's3-def') expect(pols).toEqual([]);
    else expect(pols.map((p) => p.id)).toEqual(['androidManagedAppProtection-1']);
  });
});
