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
 * synthetic-customer W5 cycle 2, follow-up 11 (2026-10-28): what Stamper's
 * W5c5 entries need (LOG-W5c5-stamper.md §7):
 *  - SC.L2-3.13.10.key-vault: Get-AzKeyVault (list / -VaultName) with the
 *    Az.KeyVault properties, New-AzKeyVault, Get-/New-AzRoleAssignment on the
 *    vault scope, Get-AzVM identities, Get-AzUserAssignedIdentity;
 *  - the Exchange policy / rule pairs: list reads with the built-ins
 *    (IsDefault), and New-*Rule on a captured (customer) policy name.
 * The registry's PowerShell is reproduced step by step in TypeScript.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROLE = 'Key Vault Crypto Service Encryption User';
type Row = Record<string, any>;
const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);

async function build(slug: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-fu11-${slug}-`));
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot: path.join(dir, 'tenant') });
  const store = new ObjectStore(path.join(dir, 'tenant', 'store.json'));
  return { dir, store, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

/** The SC.L2-3.13.10.key-vault get_command (lookup), reproduced. */
async function keyVaultLookup(t: ResolverTable, rg: string, keyVaultName: string): Promise<Row | undefined> {
  const mis = [
    ...asList(await t.resolveCmdlet('Get-AzVM', ['-ResourceGroupName', rg, '-ErrorAction', 'SilentlyContinue'])).map((v) => v.Identity?.PrincipalId),
    ...asList(await t.resolveCmdlet('Get-AzUserAssignedIdentity', ['-ResourceGroupName', rg, '-ErrorAction', 'SilentlyContinue'])).map((m) => m.PrincipalId),
  ].filter(Boolean);
  const rows: Row[] = [];
  for (const listed of asList(await t.resolveCmdlet('Get-AzKeyVault', ['-ResourceGroupName', rg]))) {
    const v = asList(await t.resolveCmdlet('Get-AzKeyVault', ['-ResourceGroupName', rg, '-VaultName', listed.VaultName]))[0];
    const held = asList(await t.resolveCmdlet('Get-AzRoleAssignment', ['-Scope', v.ResourceId, '-RoleDefinitionName', ROLE, '-ErrorAction', 'SilentlyContinue'])).map((a) => a.ObjectId);
    rows.push({
      VaultName: v.VaultName, ResourceId: v.ResourceId, VaultUri: v.VaultUri,
      EnablePurgeProtection: !!v.EnablePurgeProtection, EnableSoftDelete: !!v.EnableSoftDelete, SoftDeleteRetentionInDays: v.SoftDeleteRetentionInDays,
      EnableRbacAuthorization: !!v.EnableRbacAuthorization, EnclaveIdentities: mis, UnassignedIdentities: mis.filter((m) => !held.includes(m)),
    });
  }
  const hits = rows.filter((r) => r.VaultName === keyVaultName || (r.EnablePurgeProtection && r.EnableSoftDelete && r.SoftDeleteRetentionInDays != null && Number(r.SoftDeleteRetentionInDays) >= 7 && r.UnassignedIdentities.length === 0));
  return hits.sort((a, b) => Number(a.VaultName !== keyVaultName) - Number(b.VaultName !== keyVaultName))[0];
}

/** The SC.L2-3.13.10.key-vault set_command, reproduced. */
async function keyVaultSet(t: ResolverTable, rg: string, keyVaultName: string): Promise<Row> {
  const kv = (await t.resolveCmdlet('New-AzKeyVault', ['-ResourceGroupName', rg, '-VaultName', keyVaultName, '-Location', 'usgovvirginia', '-Sku', 'Premium', '-EnablePurgeProtection', '-SoftDeleteRetentionInDays', 90, '-EnableRbacAuthorization'])) as Row;
  const mis = [
    ...asList(await t.resolveCmdlet('Get-AzVM', ['-ResourceGroupName', rg])).map((v) => v.Identity?.PrincipalId),
    ...asList(await t.resolveCmdlet('Get-AzUserAssignedIdentity', ['-ResourceGroupName', rg])).map((m) => m.PrincipalId),
  ].filter(Boolean);
  for (const mi of mis) await t.resolveCmdlet('New-AzRoleAssignment', ['-ObjectId', mi, '-RoleDefinitionName', ROLE, '-Scope', kv.ResourceId]);
  return { VaultName: kv.VaultName, ResourceId: kv.ResourceId, VaultUri: kv.VaultUri };
}

/** The verification of the key-vault entry (state rule). */
const verifies = (r: Row | undefined) => !!r && r.EnablePurgeProtection === true && r.EnableSoftDelete === true && String(r.SoftDeleteRetentionInDays) === '90' && r.EnableRbacAuthorization === true && r.UnassignedIdentities.join(',') === '';

describe('W5c2 follow-up 11: key vault on S1 (verified, no create)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  const RG = 'rg-s1-mach-prod';
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('Get-AzKeyVault serves the Az.KeyVault properties, scoped by resource group', async () => {
    const list = asList(await b.table.resolveCmdlet('Get-AzKeyVault', ['-ResourceGroupName', RG]));
    expect(list.map((v) => v.VaultName)).toEqual(['kv-s1-mach-prod']);
    expect(list[0]).toMatchObject({ ResourceGroupName: RG, EnablePurgeProtection: true, EnableSoftDelete: true, SoftDeleteRetentionInDays: 90, EnableRbacAuthorization: true });
    expect(list[0].ResourceId).toMatch(/\/resourceGroups\/rg-s1-mach-prod\/providers\/Microsoft\.KeyVault\/vaults\/kv-s1-mach-prod$/);
    expect(asList(await b.table.resolveCmdlet('Get-AzKeyVault', ['-ResourceGroupName', 'some-other-rg']))).toEqual([]);
  });

  it("the enclave VMs' system-assigned identities all hold the crypto role on the vault; the lookup finds and verifies the seeded vault", async () => {
    const vms = asList(await b.table.resolveCmdlet('Get-AzVM', ['-ResourceGroupName', RG]));
    expect(vms.map((v) => v.Name).sort()).toEqual(['vm-s1-file-01', 'vm-s1-jump-01', 'vm-s1-prog-01']);
    expect(vms.every((v) => v.Identity?.Type === 'SystemAssigned' && /^51510000-00be-/.test(v.Identity.PrincipalId))).toBe(true);
    expect(asList(await b.table.resolveCmdlet('Get-AzUserAssignedIdentity', ['-ResourceGroupName', RG]))).toEqual([]);
    const found = await keyVaultLookup(b.table, RG, 's1mach-kv-cmmc');
    expect(found?.VaultName).toBe('kv-s1-mach-prod');
    expect(found?.EnclaveIdentities).toHaveLength(3);
    expect(verifies(found)).toBe(true);
  });

  it("New-AzRoleAssignment no longer lands on the Entra role assignments (they stay the 2 break-glass Global Administrators)", async () => {
    const vault = asList(await b.table.resolveCmdlet('Get-AzKeyVault', ['-ResourceGroupName', RG]))[0];
    await b.table.resolveCmdlet('New-AzRoleAssignment', ['-ObjectId', 'sim-extra-mi', '-RoleDefinitionName', ROLE, '-Scope', vault.ResourceId]);
    const entra = ((await b.table.resolveUri('GET', '/v1.0/roleManagement/directory/roleAssignments')) as { value: Row[] }).value;
    expect(entra.map((a) => a.principalId).sort()).toEqual(['user-50', 'user-51']);
    expect(asList(await b.table.resolveCmdlet('Get-AzRoleAssignment', ['-Scope', vault.ResourceId, '-RoleDefinitionName', ROLE])).map((a) => a.ObjectId)).toContain('sim-extra-mi');
    await expect(b.table.resolveCmdlet('New-AzRoleAssignment', ['-ObjectId', 'sim-extra-mi', '-RoleDefinitionName', ROLE, '-Scope', vault.ResourceId])).rejects.toThrow(/Conflict/);
  });
});

describe('W5c2 follow-up 11: key vault on muster-partial (no conforming vault, so CES creates one)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  const RG = 'sim-rg-muster-partial';
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('the lookup finds nothing; the SET creates a vault that the next lookup finds and verifies; the generic vault is untouched', async () => {
    expect(await keyVaultLookup(b.table, RG, 'kv-cmmc-mp')).toBeUndefined();
    const out = await keyVaultSet(b.table, RG, 'kv-cmmc-mp');
    expect(out.ResourceId).toBe('/subscriptions/sim-sub/resourceGroups/sim-rg-muster-partial/providers/Microsoft.KeyVault/vaults/kv-cmmc-mp');
    expect(out.VaultUri).toBe('https://kv-cmmc-mp.vault.usgovcloudapi.net/');
    const found = await keyVaultLookup(b.table, RG, 'kv-cmmc-mp');
    expect(found?.VaultName).toBe('kv-cmmc-mp');
    expect(found?.EnclaveIdentities).toEqual([]); // muster-partial has no VM or user-assigned identity in the group
    expect(verifies(found)).toBe(true);
    const all = asList(await b.table.resolveCmdlet('Get-AzKeyVault', []));
    expect(all.map((v) => v.VaultName).sort()).toEqual(['kv-cmmc-mp', 'sim-kv-1']);
    await expect(keyVaultSet(b.table, RG, 'kv-cmmc-mp')).rejects.toThrow(/already in use/);
  });

  it('a role assignment on the new vault is listed on the next read with its scope and role', async () => {
    const kv = asList(await b.table.resolveCmdlet('Get-AzKeyVault', ['-ResourceGroupName', RG, '-VaultName', 'kv-cmmc-mp']))[0];
    await b.table.resolveCmdlet('New-AzRoleAssignment', ['-ObjectId', 'sim-mi-principal', '-RoleDefinitionName', ROLE, '-Scope', kv.ResourceId]);
    expect(asList(await b.table.resolveCmdlet('Get-AzRoleAssignment', ['-Scope', kv.ResourceId, '-RoleDefinitionName', ROLE])).map((a) => [a.ObjectId, a.Scope])).toEqual([['sim-mi-principal', kv.ResourceId]]);
  });
});

const DEFAULTS: Array<[string, string]> = [
  ['Get-MalwareFilterPolicy', 'Default'],
  ['Get-SafeLinksPolicy', 'Built-In Protection Policy'],
  ['Get-SafeAttachmentPolicy', 'Built-In Protection Policy'],
  ['Get-AntiPhishPolicy', 'Office365 AntiPhish Default'],
  ['Get-HostedContentFilterPolicy', 'Default'],
  ['Get-HostedOutboundSpamFilterPolicy', 'Default'],
];

describe('W5c2 follow-up 11: Exchange policy / rule pairs on S1', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('each policy list (no -Identity) includes its built-in with IsDefault true', async () => {
    for (const [cmdlet, builtIn] of DEFAULTS) {
      const list = asList(await b.table.resolveCmdlet(cmdlet, []));
      expect(list.find((p) => p.Name === builtIn)?.IsDefault, cmdlet).toBe(true);
    }
  });

  it("Stamper's safe-links lookup picks S1's policy (not the built-in) and the rule lookup on the captured name picks S1's rule", async () => {
    const pol = asList(await b.table.resolveCmdlet('Get-SafeLinksPolicy', []))
      .filter((p) => p.Name === 'CMMC-SafeLinks' || (p.IsDefault !== true && p.EnableSafeLinksForEmail === true && p.ScanUrls === true && p.EnableForInternalSenders === true));
    expect(pol.map((p) => p.Name)).toEqual(['S1 Safe Links - all users']);
    const captured = pol[0].Name;
    const rules = asList(await b.table.resolveCmdlet('Get-SafeLinksRule', []))
      .filter((r) => r.Name === 'CMMC-SafeLinks-Rule' || (r.State === 'Enabled' && r.SafeLinksPolicy === captured && [r.RecipientDomainIs].flat().includes('s1-mach.simtenant.onmicrosoft.us')));
    expect(rules.map((r) => r.Name)).toEqual(['S1 Safe Links rule']);
  });

  it('the rule lists answer (empty for the pairs S1 does not configure)', async () => {
    for (const c of ['Get-MalwareFilterRule', 'Get-SafeAttachmentRule', 'Get-AntiPhishRule', 'Get-HostedContentFilterRule', 'Get-HostedOutboundSpamFilterRule']) {
      expect(asList(await b.table.resolveCmdlet(c, [])), c).toEqual([]);
    }
  });
});

describe('W5c2 follow-up 11: Exchange pairs on muster-partial (built-ins only, so CES creates)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('no non-default equivalent; New- then Get -Identity reads the name; New-*Rule stores the captured (or a customer) policy name as given', async () => {
    for (const [cmdlet] of DEFAULTS) {
      expect(asList(await b.table.resolveCmdlet(cmdlet, [])).filter((p) => p.IsDefault !== true), cmdlet).toEqual([]);
    }
    await b.table.resolveCmdlet('New-SafeLinksPolicy', ['-Name', 'CMMC-SafeLinks', '-EnableSafeLinksForEmail', true, '-ScanUrls', true, '-EnableForInternalSenders', true, '-DeliverMessageAfterScan', true]);
    const captured = asList(await b.table.resolveCmdlet('Get-SafeLinksPolicy', ['-Identity', 'CMMC-SafeLinks']))[0].Name;
    expect(captured).toBe('CMMC-SafeLinks');
    await b.table.resolveCmdlet('New-SafeLinksRule', ['-Name', 'CMMC-SafeLinks-Rule', '-SafeLinksPolicy', captured, '-RecipientDomainIs', 'muster-partial.simtenant.onmicrosoft.us', '-Enabled', true]);
    expect(asList(await b.table.resolveCmdlet('Get-SafeLinksRule', []))[0]).toMatchObject({ Name: 'CMMC-SafeLinks-Rule', SafeLinksPolicy: 'CMMC-SafeLinks', State: 'Enabled' });
    // A rule on a customer policy name keeps that name.
    await b.table.resolveCmdlet('New-MalwareFilterRule', ['-Name', 'CMMC-Malware-Rule', '-MalwareFilterPolicy', 'Customer Malware Policy', '-RecipientDomainIs', 'muster-partial.simtenant.onmicrosoft.us']);
    expect(asList(await b.table.resolveCmdlet('Get-MalwareFilterRule', []))[0]).toMatchObject({ MalwareFilterPolicy: 'Customer Malware Policy', State: 'Enabled' });
  });
});
