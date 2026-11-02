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
import { loadScenario, applyScenario, type ScenarioFile } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';

/**
 * synthetic-customer W5 cycle 1, simulator part b (2026-10-28): the rows
 * SIM-1 ... SIM-10 the evaluator slice filed (LOG-W5c1-evaluators.md §6),
 * read through the real resolver chain the way EO reads them (the named
 * cmdlets of ComplianceSignalFetcher, plus the Graph URIs).
 *  - SIM-1 authentication methods policy with its per-method settings inline;
 *  - SIM-2 PIM approval: the ISSM's admin account approves;
 *  - SIM-3 cross-tenant access default: deny-all inbound and outbound;
 *  - SIM-4 the CUI label on the Graph label reads, its protection, policy and site;
 *  - SIM-5 /v1.0/groupSettings; SIM-6 S1-named compliance policies;
 *  - SIM-7 settings catalog DisablePasswordReveal; SIM-8 iOS app data encryption;
 *  - SIM-9 `$select` on users.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ANCHOR_ISO = '2026-10-01T00:00:00.000Z';
const GA = '62e90394-69f5-4237-9190-012177145e10';
const PRA = 'e8611ab8-c189-46e8-94e1-60213ab1f814';

type Row = Record<string, unknown>;

interface Built {
  dir: string;
  table: ResolverTable;
  scenario: ScenarioFile;
  rows: (c: string) => Promise<Row[]>;
}

async function build(slug: string, fixed?: string): Promise<Built> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c1b-${slug}-`));
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
  return { dir, scenario, table: new ResolverTable(store, new StackShapeGate('m365_azure')), rows: async (c) => (await store.list(c)) as Row[] };
}

const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);
const cfg = (p: Row, id: string) => (p.authenticationMethodConfigurations as Row[]).find((c) => c.id === id)!;

describe('W5c1-b: S1 (s1-mach) simulator rows SIM-1 ... SIM-9', () => {
  let b: Built;
  let ctx: { accounts: Array<{ seedId: string; kind: string; jobTitle: string; roles?: string[]; ownerSeedId?: string }>; groups: Array<{ name: string; memberSeedIds: string[] }> };
  beforeAll(async () => {
    b = await build('s1-mach', ANCHOR_ISO);
    ctx = b.scenario.seedContext!['customer-history'] as typeof ctx;
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('SIM-1: the methods policy read (cmdlet and URI) embeds the per-method settings', async () => {
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgPolicyAuthenticationMethodPolicy', []));
    expect(viaCmdlet).toHaveLength(1);
    const viaUri = (await b.table.resolveUri('GET', '/v1.0/policies/authenticationMethodsPolicy')) as Row;
    expect(Array.isArray(viaUri)).toBe(false);
    expect(viaUri.id).toBe('authenticationMethodsPolicy');
    for (const p of [viaCmdlet[0], viaUri]) {
      const configs = p.authenticationMethodConfigurations as Row[];
      expect(configs.map((c) => c.id).sort()).toEqual(['Email', 'Fido2', 'MicrosoftAuthenticator', 'SoftwareOath', 'Sms', 'TemporaryAccessPass', 'Voice', 'x509Certificate'].sort());
      expect(configs.every((c) => typeof c['@odata.type'] === 'string' && Array.isArray(c.includeTargets))).toBe(true);
      const on = configs.filter((c) => c.state === 'enabled').map((c) => c.id).sort();
      expect(on).toEqual(['Fido2', 'MicrosoftAuthenticator', 'SoftwareOath', 'TemporaryAccessPass']);
      expect(cfg(p, 'Sms').state).toBe('disabled');
      expect(cfg(p, 'Voice').state).toBe('disabled');
    }
    const p = viaUri;
    expect((cfg(p, 'Fido2').includeTargets as Row[])[0]).toMatchObject({ targetType: 'group', id: 'all_users' });
    expect((cfg(p, 'MicrosoftAuthenticator').featureSettings as Row & { numberMatchingRequiredState: Row }).numberMatchingRequiredState.state).toBe('enabled');
    expect(cfg(p, 'TemporaryAccessPass')).toMatchObject({ state: 'enabled', isUsableOnce: true, maximumLifetimeInMinutes: 480, defaultLifetimeInMinutes: 60 });
    expect(p.policyMigrationState).toBe('migrationComplete');
  });

  it('SIM-1: FIDO2 key restriction matches the keys the admin and break-glass accounts registered, as CA02 (phishing-resistant, admin roles) needs', async () => {
    const fido = (await b.rows('authenticationMethodsPolicyConfigurations')).find((c) => c.id === 'Fido2')!;
    const restriction = fido.keyRestrictions as { isEnforced: boolean; enforcementType: string; aaGuids: string[] };
    expect(restriction).toMatchObject({ isEnforced: true, enforcementType: 'allow' });
    const privileged = ctx.accounts.filter((a) => a.kind === 'admin' || a.kind === 'break_glass').map((a) => a.seedId);
    const keys = (await b.rows('authMethods')).filter((m) => m['@odata.type'] === '#microsoft.graph.fido2AuthenticationMethod');
    for (const id of privileged) {
      const mine = keys.filter((k) => k.userId === id);
      expect(mine.length, id).toBeGreaterThan(0);
      expect(mine.every((k) => restriction.aaGuids.includes(String(k.aaGuid)))).toBe(true);
    }
    const ca02 = (await b.rows('caPolicies')).find((c) => c.id === 'caPolicy-2')!;
    expect(((ca02.grantControls as Row).authenticationStrength as Row).id).toBe('00000000-0000-0000-0000-000000000004');
  });

  it('SIM-1: a per-method PATCH (Stamper IA.L2-3.5.10.cert-auth) is visible inline on the next policy read', async () => {
    await b.table.resolveUri('PATCH', '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate', { state: 'enabled' });
    const p = asList(await b.table.resolveCmdlet('Get-MgPolicyAuthenticationMethodPolicy', []))[0];
    expect(cfg(p, 'x509Certificate').state).toBe('enabled');
    await b.table.resolveUri('PATCH', '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate', { state: 'disabled' });
    const again = (await b.table.resolveUri('GET', '/v1.0/policies/authenticationMethodsPolicy')) as Row;
    expect(cfg(again, 'x509Certificate').state).toBe('disabled');
  });

  it('SIM-2: PIM policies are S1 only, with rules; the ISSM admin account approves Global and Privileged Role Administrator', async () => {
    const policies = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicy', []));
    // W5c2 follow-up 4: 5 managed roles + Compliance Administrator (Entra defaults, not managed by S1).
    expect(policies).toHaveLength(6);
    expect(policies.some((p) => /^Sim Role Management Policy/.test(String(p.displayName)))).toBe(false);
    const issm = ctx.accounts.find((a) => a.roles?.includes('issm'))!;
    expect(issm.jobTitle).toMatch(/ISSM/);
    const issmAdmin = ctx.accounts.find((a) => a.kind === 'admin' && a.ownerSeedId === issm.seedId)!;
    expect(issmAdmin.seedId).toBe('user-46');
    const asg = await b.rows('policyRoleManagementPolicyAssignment');
    const approversOf = (roleId: string) => {
      const pol = policies.find((p) => p.id === asg.find((a) => a.roleDefinitionId === roleId)!.policyId)!;
      const rule = (pol.rules as Row[]).find((r) => r.id === 'Approval_EndUser_Assignment')!;
      const setting = rule.setting as Row;
      expect(setting.isApprovalRequired).toBe(true);
      return ((setting.approvalStages as Row[])[0].primaryApprovers as Row[]).map((a) => String(a.userId));
    };
    // GA is held by the ISSM's own admin account: the ISSO's admin account is the second approver.
    expect(approversOf(GA)).toEqual(['user-46', 'user-47']);
    expect(approversOf(PRA)).toEqual(['user-46']);
    // Activation: MFA + justification + ticket, at most 4 hours, on every role S1 manages.
    const complianceAdminPolicy = asg.find((a) => a.roleDefinitionId === '17315797-102d-40b4-93e0-432062caca18')!.policyId;
    for (const p of policies.filter((x) => x.id !== complianceAdminPolicy)) {
      const rules = p.rules as Row[];
      expect(rules.find((r) => r.id === 'Enablement_EndUser_Assignment')!.enabledRules).toEqual(['MultiFactorAuthentication', 'Justification', 'Ticketing']);
      expect(rules.find((r) => r.id === 'Expiration_EndUser_Assignment')!.maximumDuration).toBe('PT4H');
    }
  });

  it('SIM-3: the cross-tenant access default denies B2B collaboration and direct connect, inbound and outbound (no partner in customer.json)', async () => {
    const d = asList(await b.table.resolveCmdlet('Get-MgPolicyCrossTenantAccessPolicyDefault', []));
    expect(d).toHaveLength(1);
    for (const k of ['b2bCollaborationInbound', 'b2bCollaborationOutbound', 'b2bDirectConnectInbound', 'b2bDirectConnectOutbound']) {
      const s = d[0][k] as { usersAndGroups: Row; applications: Row };
      expect(s.usersAndGroups, k).toEqual({ accessType: 'blocked', targets: [{ target: 'AllUsers', targetType: 'user' }] });
      expect(s.applications.accessType, k).toBe('blocked');
    }
    expect(d[0].inboundTrust).toEqual({ isMfaAccepted: false, isCompliantDeviceAccepted: false, isHybridAzureADJoinedDeviceAccepted: false });
    expect(JSON.stringify(b.scenario.seedContext)).not.toMatch(/partner/i);
  });

  it('SIM-4: the Graph label reads serve the CUI label (one id with the Purview label), not the generic placeholder', async () => {
    const labels = asList(await b.table.resolveCmdlet('Get-MgInformationProtectionPolicyLabel', []));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ name: 'CUI', isActive: true });
    const sens = asList(await b.table.resolveCmdlet('Get-MgInformationProtectionSensitivityLabel', []));
    expect(sens).toHaveLength(1);
    expect(sens[0]).toMatchObject({ name: 'CUI', isActive: true, hasProtection: true });
    const purview = asList(await b.table.resolveCmdlet('Get-Label', ['-Identity', 'CUI']));
    expect(purview).toHaveLength(1);
    expect(labels[0].id).toBe(purview[0].Guid);
    expect(sens[0].id).toBe(purview[0].Guid);
  });

  it('SIM-4: the CUI label encrypts for the enclave members, marks CUI, and is published to and applied on the enclave', async () => {
    const label = asList(await b.table.resolveCmdlet('Get-Label', ['-Identity', 'CUI']))[0];
    expect(label).toMatchObject({ EncryptionEnabled: true, EncryptionProtectionType: 'Template', ApplyContentMarkingHeaderEnabled: true, ApplyContentMarkingHeaderText: 'CUI', ApplyContentMarkingFooterEnabled: true, SiteAndGroupProtectionEnabled: true, SiteExternalSharingControlType: 'Disabled' });
    const enclave = ctx.groups.find((g) => g.name === 'CUI-Authorized-Users')!;
    const granted = String(label.EncryptionRightsDefinitions).split(';').map((r) => r.split(':')[0]);
    const users = await b.rows('users');
    const upnOf = (s: string) => String(users.find((u) => u.id === s)!.userPrincipalName);
    expect(granted.sort()).toEqual(enclave.memberSeedIds.map(upnOf).sort());
    expect(granted).toHaveLength(18);
    // Stamper's AC.L2-3.1.3 evidence read and MP.L2-3.8.1.label-policy create.
    const pol = asList(await b.table.resolveCmdlet('Get-LabelPolicy', [])).filter((p) => /CUI|CMMC/.test(String(p.Name)));
    expect(pol).toHaveLength(1);
    expect(pol[0]).toMatchObject({ Labels: ['CUI'], ExchangeLocation: ['CUI-Authorized-Users'] });
    await b.table.resolveCmdlet('New-LabelPolicy', ['-Name', 'CMMC-CUI-Policy', '-Labels', 'CUI', '-ExchangeLocation', 'All']);
    expect(asList(await b.table.resolveCmdlet('Get-LabelPolicy', [])).map((p) => p.Name).sort()).toEqual(['CMMC-CUI-Policy', String(pol[0].Name)].sort());
    const site = asList(await b.table.resolveCmdlet('Get-SPOSite', [])).find((s) => /\/sites\/cui-enclave$/.test(String(s.Url)))!;
    expect(site.SensitivityLabel).toBe(label.Guid);
    expect(site.SharingCapability).toBe('Disabled');
  });

  it('SIM-5: GET /v1.0/groupSettings serves Password Rule Settings (the same object Get-MgDirectorySetting reads)', async () => {
    const out = (await b.table.resolveUri('GET', '/v1.0/groupSettings')) as { value: Row[] };
    const prs = out.value.filter((s) => s.displayName === 'Password Rule Settings');
    expect(prs).toHaveLength(1);
    const v = Object.fromEntries((prs[0].values as Array<{ name: string; value: string }>).map((x) => [x.name, x.value]));
    expect(v).toMatchObject({ LockoutThreshold: '5', LockoutDurationInSeconds: '300' });
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgDirectorySetting', [])).find((s) => s.displayName === 'Password Rule Settings')!;
    expect(viaCmdlet.id).toBe(prs[0].id);
  });

  it('SIM-6: compliance policies carry S1 names and the password settings (length, history; expiry not configured)', async () => {
    const pols = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementDeviceCompliancePolicy', []));
    // W5c2 follow-up 6 (SIM-B6): + 'S1 Windows 11 Defender for Endpoint risk compliance'.
    expect(pols).toHaveLength(4);
    expect(pols.every((p) => /^S1 /.test(String(p.displayName)))).toBe(true);
    const win = pols.filter((p) => p['@odata.type'] === '#microsoft.graph.windows10CompliancePolicy');
    expect(win.map((p) => p.id).sort()).toEqual(['deviceCompliancePolicy-1', 'deviceCompliancePolicy-2', 'deviceCompliancePolicy-3']);
    for (const p of win) {
      expect(p).toMatchObject({ passwordMinimumLength: 14, passwordPreviousPasswordBlockCount: 24, passwordExpirationDays: null, platformType: 'windows10' });
    }
  });

  it('SIM-7: a settings-catalog policy disables the password reveal button (the EO IA.L2-3.5.11 setting)', async () => {
    // W5c2 follow-up 10: + 'S1 Windows time synchronisation (NTP)' (SIM-W4c5).
    const all = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementConfigurationPolicy', []));
    expect(all.map((p) => p.name).sort()).toEqual(['S1 Windows 11 credential UI', 'S1 Windows time synchronisation (NTP)']);
    const pols = all.filter((p) => p.name === 'S1 Windows 11 credential UI');
    expect(pols[0].name).toBe('S1 Windows 11 credential UI');
    const text = JSON.stringify(pols[0]);
    expect(text).toMatch(/disablepasswordreveal_1/);
    expect(text).not.toMatch(/Sim Configuration Policy/);
  });

  it('SIM-8: iOS app protection encrypts app data; Stamper\'s CMMC-iOS-MAM create adds a second policy', async () => {
    const read = () => b.table.resolveCmdlet('Get-MgDeviceAppManagementIosManagedAppProtection', []).then(asList);
    const before = await read();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ displayName: 'S1 iOS CUI app protection', appDataEncryptionType: 'whenDeviceLocked', deviceComplianceRequired: true, dataBackupBlocked: true });
    await b.table.resolveUri('POST', '/v1.0/deviceAppManagement/iosManagedAppProtections', { '@odata.type': '#microsoft.graph.iosManagedAppProtection', displayName: 'CMMC-iOS-MAM', periodOfflineBeforeWipeIsEnforced: 'P30D', allowedDataStorageLocations: ['oneDriveForBusiness', 'sharePoint'], dataBackupBlocked: true, deviceComplianceRequired: true });
    const after = await read();
    expect(after.map((p) => p.displayName).sort()).toEqual(['CMMC-iOS-MAM', 'S1 iOS CUI app protection']);
    expect(after.find((p) => p.displayName === 'S1 iOS CUI app protection')!.appDataEncryptionType).toBe('whenDeviceLocked');
  });

  it('SIM-9: /v1.0/users honours $select (EO\'s directoryUsers read gets only the selected properties)', async () => {
    // W5c1-c: EO's select after the fetch fix (ces-eo ComplianceSignalFetcher.ts DIRECTORY_USER_SELECT).
    const sel = ['id', 'userPrincipalName', 'displayName', 'accountEnabled', 'userType', 'assignedLicenses', 'signInActivity', 'createdDateTime', 'onPremisesSyncEnabled', 'passwordPolicies', 'lastPasswordChangeDateTime'];
    const eo = (await b.table.resolveUri('GET', `/v1.0/users?$select=${sel.join(',')}&$top=999`)) as { value: Row[] };
    expect(eo.value).toHaveLength(53);
    expect(eo.value.every((u) => Object.keys(u).every((k) => sel.includes(k)))).toBe(true);
    expect(eo.value.some((u) => 'signInActivity' in u)).toBe(true);
    expect(eo.value.every((u) => typeof u.id === 'string' && typeof u.userPrincipalName === 'string' && 'accountEnabled' in u)).toBe(true);
    expect(eo.value.some((u) => 'jobTitle' in u || 'employeeLeaveDateTime' in u)).toBe(false);
    // Case-insensitive names, combined with $filter, and on an item read.
    const f = (await b.table.resolveUri('GET', "/v1.0/users?$filter=accountEnabled eq true&$select=ID,UserPrincipalName,signInActivity")) as { value: Row[] };
    expect(f.value.length).toBeGreaterThan(0);
    expect(f.value.every((u) => Object.keys(u).sort().join() === 'id,signInActivity,userPrincipalName')).toBe(true);
    expect(await b.table.resolveUri('GET', '/v1.0/users/user-1?$select=displayName')).toEqual({ displayName: expect.any(String) });
    // Without $select the whole object comes back (as before).
    const all = (await b.table.resolveUri('GET', '/v1.0/users')) as { value: Row[] };
    expect(all.value.some((u) => 'signInActivity' in u)).toBe(true);
  });
});

describe('W5c1-b: muster-partial (the read-time projection is sim-wide)', () => {
  let b: Built;
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('SIM-1: its methods policy read carries its own 4 configurations, with Graph types, and sees a Stamper PATCH', async () => {
    const p = asList(await b.table.resolveCmdlet('Get-MgPolicyAuthenticationMethodPolicy', []))[0];
    const configs = p.authenticationMethodConfigurations as Row[];
    expect(configs.map((c) => c.id).sort()).toEqual(['Fido2', 'MicrosoftAuthenticator', 'TemporaryAccessPass', 'x509Certificate'].sort());
    expect(configs.every((c) => c.state === 'disabled')).toBe(true);
    expect(cfg(p, 'Fido2')['@odata.type']).toBe('#microsoft.graph.fido2AuthenticationMethodConfiguration');
    await b.table.resolveUri('PATCH', '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2', { state: 'enabled' });
    const after = (await b.table.resolveUri('GET', '/v1.0/policies/authenticationMethodsPolicy')) as Row;
    expect(cfg(after, 'Fido2').state).toBe('enabled');
  });
});
