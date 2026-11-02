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
 * synthetic-customer W5 cycle 2, follow-up 6 (2026-10-28): the discovery-
 * coverage seeds (LOG-W5c3-muster.md §2.4 SIM-A1..A4, §3.5 SIM-B1..B11),
 * read the way Muster's harvest (muster-api harvestService.ts TENANT_READS)
 * and Stamper's registry get_commands read them, through the real resolver.
 * PowerShell `Where-Object` / `Select-Object` steps are done in the test.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DAY = 86400000;
const CA_TEMPLATE = '17315797-102d-40b4-93e0-432062caca18';
const GA_TEMPLATE = '62e90394-69f5-4237-9190-012177145e10';
const S1_DOMAIN = 's1-mach.simtenant.onmicrosoft.us';

type Row = Record<string, any>;

async function build(slug: string): Promise<{ dir: string; table: ResolverTable; store: ObjectStore; seedCounts: Record<string, number> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-fu6-${slug}-`));
  const tenantRoot = path.join(dir, 'tenant');
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  const result = await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
  const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
  return { dir, store, seedCounts: result.seedCounts, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);
const page = async (t: ResolverTable, uri: string) => ((await t.resolveUri('GET', uri)) as { value: Row[] }).value;
const typeOf = (c: Row) => String(c.AdditionalProperties?.['@odata.type'] ?? '');

describe('W5c2 follow-up 6: S1 discovery-coverage seeds', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('SIM-A1: /groups is routed, and the one group every enabled CA policy excludes is S1-Break-Glass (Muster TCP.PA.005)', async () => {
    const groups = await page(b.table, '/v1.0/groups');
    expect(groups).toHaveLength(14);
    const ca = (await page(b.table, '/v1.0/identity/conditionalAccess/policies')).filter((p) => p.state === 'enabled');
    expect(ca).toHaveLength(9);
    const ex = (p: Row): string[] => p.conditions?.users?.excludeGroups ?? [];
    const everywhere = [...new Set(ex(ca[0]))].filter((g) => ca.every((p) => ex(p).includes(g)));
    expect(everywhere).toEqual(['group-12']);
    expect(groups.find((g) => g.id === 'group-12')?.displayName).toBe('S1-Break-Glass');
  });

  it("SIM-A2: named locations (URI and cmdlet); Muster's TCP.CA.002 lines; CA06 excludes the US location", async () => {
    const locs = await page(b.table, '/v1.0/identity/conditionalAccess/namedLocations');
    const lines = locs.map((l) => (/countryNamedLocation/.test(l['@odata.type'])
      ? `${l.displayName}|country|${l.countriesAndRegions.join(' ')}`
      : `${l.displayName}|ip|${l.ipRanges.map((r: Row) => r.cidrAddress).join(' ')}`));
    expect(lines).toEqual(['S1 United States|country|US', 'S1 Quarrystone office egress|ip|198.51.100.0/24']);
    const ip = locs.find((l) => /ipNamedLocation/.test(l['@odata.type']))!;
    expect(ip.isTrusted).toBe(true);
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgIdentityConditionalAccessNamedLocation', []));
    expect(viaCmdlet.find((l) => l.id === ip.id)?.AdditionalProperties).toMatchObject({ '@odata.type': '#microsoft.graph.ipNamedLocation', isTrusted: true });
    const ca06 = (await page(b.table, '/v1.0/identity/conditionalAccess/policies')).find((p) => /^S1-CA06/.test(p.displayName))!;
    const us = locs.find((l) => /countryNamedLocation/.test(l['@odata.type']))!;
    expect(ca06.conditions.locations.excludeLocations).toEqual([us.id]);
  });

  it('SIM-A3: the S1 SKU lists its provisioned service plans', async () => {
    const sku = (await page(b.table, '/v1.0/subscribedSkus'))[0];
    expect(sku.servicePlans.length).toBe(14);
    expect(sku.servicePlans.every((p: Row) => p.provisioningStatus === 'Success' && /^51510000-00b2-/.test(p.servicePlanId))).toBe(true);
    expect(sku.servicePlans.map((p: Row) => p.servicePlanName)).toEqual(expect.arrayContaining(['EXCHANGE_S_ENTERPRISE_GOV', 'INTUNE_A', 'WINDEFATP', 'ATA', 'MIP_S_CLP2']));
  });

  it('SIM-A4: the ISSM admin account (user-46) is PIM-eligible for Compliance Administrator; no standing assignment', async () => {
    const elig = await page(b.table, `/v1.0/roleManagement/directory/roleEligibilitySchedules?$filter=roleDefinitionId eq '${CA_TEMPLATE}'`);
    expect(elig.map((e) => e.principalId)).toEqual(['user-46']);
    const active = await page(b.table, '/v1.0/roleManagement/directory/roleAssignments');
    expect(active.map((a) => a.principalId).sort()).toEqual(['user-50', 'user-51']);
    expect(active.every((a) => a.roleDefinitionId === GA_TEMPLATE)).toBe(true);
  });

  it('SIM-B1: Get-MgDirectoryRole lists the roles; Get-MgDirectoryRoleMember -DirectoryRoleId returns that role\'s active members only', async () => {
    const roles = asList(await b.table.resolveCmdlet('Get-MgDirectoryRole', []));
    expect(roles.map((r) => r.displayName).sort()).toEqual(['Compliance Administrator', 'Exchange Administrator', 'Global Administrator', 'Intune Administrator', 'Privileged Role Administrator', 'Security Administrator']);
    const ga = roles.find((r) => r.roleTemplateId === GA_TEMPLATE)!;
    const members = asList(await b.table.resolveCmdlet('Get-MgDirectoryRoleMember', ['-DirectoryRoleId', ga.id]));
    expect(members.map((m) => m.id).sort()).toEqual(['user-50', 'user-51']);
    expect(members.every((m) => m['@odata.type'] === '#microsoft.graph.user')).toBe(true);
    // CM.L2-3.4.5.access-restrict: the four admin roles -> members (only GA has a standing member).
    const four = roles.filter((r) => ['Intune Administrator', 'Global Administrator', 'Cloud Device Administrator', 'Security Administrator'].includes(r.displayName));
    const rows: Row[] = [];
    for (const r of four) for (const m of asList(await b.table.resolveCmdlet('Get-MgDirectoryRoleMember', ['-DirectoryRoleId', r.id]))) rows.push({ Role: r.displayName, Id: m.id, Type: m['@odata.type'] });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.Role === 'Global Administrator')).toBe(true);
  });

  it('SIM-B2: one windowsWifiConfiguration, S1-MACH-CORP, enterprise mode', async () => {
    const cfgs = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementDeviceConfiguration', []));
    const wifi = cfgs.filter((c) => typeOf(c) === '#microsoft.graph.windowsWifiConfiguration' || typeOf(c) === '#microsoft.graph.iosWiFiConfiguration');
    expect(wifi).toHaveLength(1);
    expect(wifi[0]).toMatchObject({ displayName: 'S1-MACH-CORP Wi-Fi', ssid: 'S1-MACH-CORP', wifiSecurityType: 'wpa2Enterprise' });
  });

  it('SIM-B3: Get-MgOrganizationBranding returns the default branding with the CUI sign-in notice', async () => {
    const br = asList(await b.table.resolveCmdlet('Get-MgOrganizationBranding', ['-OrganizationId', 'sim-tenant-s1-mach']));
    expect(br).toHaveLength(1);
    expect(br[0].id).toBe('0');
    expect(br[0].signInPageText).toMatch(/Authorized use only/);
    expect(br[0].signInPageText).toMatch(/\(FICTIONAL\)/);
    expect(br[0].signInPageText).toMatch(/Controlled Unclassified Information/);
  });

  it('SIM-B4 / B9: S1-Defender-AV (scheduled full scan, real time) and S1-Block-Removable-Storage on the cmdlet and the URI', async () => {
    const viaUri = await page(b.table, '/v1.0/deviceManagement/deviceConfigurations');
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementDeviceConfiguration', ['-All']));
    expect(viaUri.map((c) => c.id)).toEqual(viaCmdlet.map((c) => c.id));
    expect(viaUri).toHaveLength(3);
    const av = viaUri.find((c) => c.displayName === 'S1-Defender-AV')!;
    expect(av).toMatchObject({ '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', defenderScanType: 'full', defenderSystemScanSchedule: 'saturday', defenderRequireRealTimeMonitoring: true, defenderSignatureUpdateIntervalInHours: 4, defenderCloudBlockLevel: 'high', defenderScanRemovableDrivesDuringFullScan: true });
    // MP.L2-3.8.5.media-access (name match).
    const media = viaUri.filter((c) => /Removable|Storage/.test(c.displayName));
    expect(media.map((c) => c.displayName)).toEqual(['S1-Block-Removable-Storage']);
    expect(media[0].storageBlockRemovableStorage).toBe(true);
    // Muster S-27: a device configuration blocks removable storage.
    expect(viaUri.some((c) => c.storageBlockRemovableStorage === true)).toBe(true);
    // MP.L2-3.8.7.removable-media-intune filters on '*deviceRestriction*', which no Graph type contains: pinned (Stamper defect, LOG §14).
    expect(viaCmdlet.filter((c) => /deviceRestriction/.test(typeOf(c)))).toEqual([]);
  });

  it('SIM-B5: Intune audit events within 90 days, with type, operation, actor and resources', async () => {
    const ev = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementAuditEvent', ['-All']));
    expect(ev.length).toBeGreaterThanOrEqual(5);
    // W5c2 follow-up 10 (SIM-W4c6): + the wipe and retire actions (activityOperationType 'Action').
    for (const e of ev) {
      expect(Date.now() - Date.parse(e.activityDateTime)).toBeLessThan(91 * DAY);
      expect(e.activityResult).toBe('Success');
      expect(String(e.activityType)).toMatch(/^(Patch Device(Compliance)?(Policy|Configuration)|Wipe ManagedDevice|Retire ManagedDevice)$/);
      expect(e.activityOperationType).toBe(/^Patch/.test(e.activityType) ? 'Patch' : 'Action');
      expect(e.actor.userPrincipalName).toMatch(new RegExp(`@${S1_DOMAIN}$`));
      expect(e.resources).toHaveLength(1);
    }
  });

  it("SIM-B6: a compliance policy named with 'Defender' (MA.L2-3.7.4.media-check)", async () => {
    const pols = (await page(b.table, 'https://graph.microsoft.us/v1.0/deviceManagement/deviceCompliancePolicies')).filter((p) => /Defender/.test(p.displayName));
    expect(pols.map((p) => p.displayName)).toEqual(['S1 Windows 11 Defender for Endpoint risk compliance']);
    expect(pols[0]).toMatchObject({ deviceThreatProtectionEnabled: true, deviceThreatProtectionRequiredSecurityLevel: 'medium', passwordMinimumLength: 14 });
  });

  it("SIM-B7: Safe Links served under S1's names; Stamper's -Identity 'CMMC-*' gets stay a 404 (as before the seed); the message center answers", async () => {
    // W5c2 follow-up 11: the list also holds the built-in (IsDefault) policy.
    const all = asList(await b.table.resolveCmdlet('Get-SafeLinksPolicy', []));
    expect(all.map((x) => [x.Name, x.IsDefault]).sort()).toEqual([['Built-In Protection Policy', true], ['S1 Safe Links - all users', false]]);
    const pol = all.filter((x) => x.IsDefault !== true);
    expect(pol[0]).toMatchObject({ Name: 'S1 Safe Links - all users', EnableSafeLinksForEmail: true, ScanUrls: true, EnableForInternalSenders: true });
    // -Identity names the target (SIMFIX FIX-S1): a miss is a 404, never S1's own policy.
    await expect(b.table.resolveCmdlet('Get-SafeLinksPolicy', ['-Identity', 'CMMC-SafeLinks'])).rejects.toThrow(/no safeLinksPolicy object/);
    await expect(b.table.resolveCmdlet('Get-SafeLinksRule', ['-Identity', 'CMMC-SafeLinks-Rule'])).rejects.toThrow(/no safeLinksRule object/);
    const rule = asList(await b.table.resolveCmdlet('Get-SafeLinksRule', ['-Identity', 'S1 Safe Links rule']));
    expect(rule[0]).toMatchObject({ State: 'Enabled', SafeLinksPolicy: 'S1 Safe Links - all users', RecipientDomainIs: [S1_DOMAIN] });
    const msgs = await page(b.table, "https://graph.microsoft.us/v1.0/admin/serviceAnnouncement/messages?$top=5&$orderby=lastModifiedDateTime desc");
    expect(msgs).toHaveLength(4);
    const high = await page(b.table, "https://graph.microsoft.us/v1.0/admin/serviceAnnouncement/messages?$top=25&$orderby=lastModifiedDateTime desc&$filter=severity eq 'high'");
    expect(high.map((m) => m.id)).toEqual(['MC900102', 'MC900104']);
  });

  it('SIM-B8: Get-InsiderRiskPolicy returns the departing-users policy, enabled', async () => {
    const p = asList(await b.table.resolveCmdlet('Get-InsiderRiskPolicy', [])).filter((x) => /CMMC/.test(x.Name) || /Departing/.test(x.Name));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ Name: 'S1 Departing users - data theft', InsiderRiskScenario: 'IntellectualPropertyTheft', Enabled: true, IsEnabled: true });
    expect(JSON.stringify({ Name: p[0].Name, InsiderRiskScenario: p[0].InsiderRiskScenario, Enabled: p[0].Enabled })).toMatch(/Enabled.*true/i);
  });

  it('SIM-B10: DKIM for the S1 domain, enabled (list and -Identity {primaryDomain})', async () => {
    const all = asList(await b.table.resolveCmdlet('Get-DkimSigningConfig', []));
    expect(all.map((d) => d.Domain)).toEqual([S1_DOMAIN]);
    const one = asList(await b.table.resolveCmdlet('Get-DkimSigningConfig', ['-Identity', S1_DOMAIN]));
    expect(one[0]).toMatchObject({ Domain: S1_DOMAIN, Enabled: true, Status: 'Valid', KeySize: 2048 });
  });

  it('SIM-B11: Get-AzSentinelIncident mirrors the 2 Defender XDR incidents', async () => {
    const inc = asList(await b.table.resolveCmdlet('Get-AzSentinelIncident', ['-ResourceGroupName', 'rg-s1-mach-prod', '-WorkspaceName', 'law-s1']));
    const xdr = await page(b.table, '/v1.0/security/incidents');
    expect(inc).toHaveLength(xdr.length);
    expect(inc.map((i) => i.Title).sort()).toEqual(xdr.map((i) => i.displayName).sort());
    for (const i of inc) {
      expect(i).toMatchObject({ ProviderName: 'Microsoft XDR' });
      expect(['Low', 'Medium', 'High', 'Informational']).toContain(i.Severity);
      expect(['New', 'Active', 'Closed']).toContain(i.Status);
      expect(Number.isFinite(Date.parse(i.CreatedTimeUtc))).toBe(true);
    }
  });

  it("seeded counts for the re-baseline (E1 'seeded:' line)", () => {
    expect(b.seedCounts).toMatchObject({
      namedLocations: 2, deviceConfigurations: 3, deviceCompliancePolicies: 4, roleEligibilitySchedules: 7, // W7-SIM: + the operator's Global Administrator eligibility
      directoryRole: 6, directoryRoleMember: 2, organizationBranding: 1, safeLinksPolicy: 2, safeLinksRule: 1,
      messages: 4, insiderRiskPolicy: 1, dkimSigningConfig: 1, sentinelIncident: 2,
      roleManagementPolicies: 6, policyRoleManagementPolicyAssignment: 6, roleManagementDirectoryRoleDefinition: 6, deletedUsers: 2,
    });
    expect(b.seedCounts.deviceManagementAuditEvent).toBeGreaterThanOrEqual(5);
  });
});

describe('W5c2 follow-up 6: muster-partial gets the routes, no seeds', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('/groups and /namedLocations list its generic objects; the S1-only collections are empty', async () => {
    expect((await page(b.table, '/v1.0/groups')).map((g) => g.displayName)).toEqual(['CUI-Authorized-Users', 'Sim Group 2', 'Sim Group 3']);
    expect((await page(b.table, '/v1.0/identity/conditionalAccess/namedLocations')).map((l) => l.displayName)).toEqual(['Sim Named Location 1', 'Sim Named Location 2']);
    // W5c2 follow-up 9: muster-partial now has its own activated directory roles (w5c2-fu9-sim.test.ts).
    // W5c2 follow-up 11: Get-SafeLinksPolicy lists the built-in policy only.
    expect(asList(await b.table.resolveCmdlet('Get-SafeLinksPolicy', [])).map((x) => [x.Name, x.IsDefault])).toEqual([['Built-In Protection Policy', true]]);
    for (const c of ['Get-MgOrganizationBranding', 'Get-MgDeviceManagementAuditEvent', 'Get-InsiderRiskPolicy', 'Get-DkimSigningConfig', 'Get-AzSentinelIncident']) {
      expect(asList(await b.table.resolveCmdlet(c, [])), c).toEqual([]);
    }
    expect((await page(b.table, '/v1.0/deviceManagement/deviceConfigurations')).map((c) => c.displayName)).toEqual(['Sim Device Configuration 1', 'Sim Device Configuration 2']);
  });
});
