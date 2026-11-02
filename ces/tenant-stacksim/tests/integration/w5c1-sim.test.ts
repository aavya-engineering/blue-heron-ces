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
import { graphResolvers } from '../../src/resolvers/graphResolvers.js';
import { LCW_DISABLE_USER_TASK_ID, PASSWORD_RULE_SETTINGS_TEMPLATE_ID } from '../../src/seed/sets/customerHistory.js';

/**
 * synthetic-customer W5 cycle 1 (2026-10-28), the simulator slice:
 *  - W3 Stamper findings: the muster-partial seed group carries
 *    securityEnabled; Update-MgPolicyAuthorizationPolicy PATCHes the one
 *    singleton every reader returns; New-DkimSigningConfig reports Domain;
 *  - W3 DLP-postcheck finding F-4: cmdlet `-Filter startsWith(...)`;
 *  - fixed URI entries for alerts_v2, secureScores, secureScoreControlProfiles;
 *  - S1's new seeds (training coverage, lifecycle workflows, lockout and
 *    password settings, PIM activation rules, per-user methods and MFA state,
 *    compliance settings, alert comment trail, control-profile review state),
 *    read through the real resolver chain.
 * S1 is built with its fixed history anchor (customer.json history_anchor).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ANCHOR_ISO = '2026-10-01T00:00:00.000Z';
const DAY = 86400000;
const GA = '62e90394-69f5-4237-9190-012177145e10';

type Row = Record<string, unknown>;

interface Built {
  dir: string;
  table: ResolverTable;
  scenario: ScenarioFile;
  rows: (c: string) => Promise<Row[]>;
}

async function build(slug: string, fixed?: string): Promise<Built> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c1-${slug}-`));
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

const page = async (t: ResolverTable, uri: string) => {
  const out = (await t.resolveUri('GET', uri)) as Row;
  expect(out).not.toHaveProperty('@odata.nextLink');
  return out.value as Row[];
};
const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);

describe('W5c1: fixed security URI entries (no longer inventory-derived)', () => {
  it.each(['/v1.0/security/alerts_v2', '/v1.0/security/secureScores', '/v1.0/security/secureScoreControlProfiles'])('%s has exactly one entry, the manual value-envelope GET', (pattern) => {
    const entries = graphResolvers.filter((e) => e.kind === 'uri' && e.pattern === pattern);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ verb: 'GET', envelope: 'value' });
    expect(entries[0]).not.toHaveProperty('mutationVerbs');
  });
});

describe('W5c1: muster-partial (W3 Stamper findings a, b, c; F-4)', () => {
  let b: Built;
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('(a) the seed group CUI-Authorized-Users is a security group', async () => {
    const g = asList(await b.table.resolveCmdlet('Get-MgGroup', ['-Filter', "displayName eq 'CUI-Authorized-Users'"]));
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ securityEnabled: true, mailEnabled: false });
    expect((await b.rows('groups')).every((x) => x.securityEnabled === true)).toBe(true);
  });

  it('(b) Update-MgPolicyAuthorizationPolicy lands on the singleton the cmdlet and URI reads return', async () => {
    await b.table.resolveCmdlet('Update-MgPolicyAuthorizationPolicy', [
      '-BodyParameter',
      { allowInvitesFrom: 'adminsAndGuestInviters', allowedToSignUpEmailBasedSubscriptions: false, allowEmailVerifiedUsersToJoinOrganization: false },
    ]);
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgPolicyAuthorizationPolicy', []));
    expect(viaCmdlet).toHaveLength(1);
    expect(viaCmdlet[0]).toMatchObject({ id: 'authorizationPolicy', allowedToSignUpEmailBasedSubscriptions: false, allowEmailVerifiedUsersToJoinOrganization: false });
    const viaUri = (await b.table.resolveUri('GET', '/v1.0/policies/authorizationPolicy')) as Row;
    expect(viaUri).toMatchObject({ allowedToSignUpEmailBasedSubscriptions: false, allowEmailVerifiedUsersToJoinOrganization: false });
    expect(await b.rows('policyAuthorizationPolicy').catch(() => [])).toEqual([]);
  });

  it('(c) New-DkimSigningConfig -DomainName reports Domain / Identity, one object per domain, and Set -Identity updates it', async () => {
    const d1 = 'muster-partial.simtenant.onmicrosoft.us';
    const d2 = 'simtenant.onmicrosoft.us';
    await b.table.resolveCmdlet('New-DkimSigningConfig', ['-DomainName', d1, '-Enabled', true]);
    await b.table.resolveCmdlet('New-DkimSigningConfig', ['-DomainName', d2, '-Enabled', true]);
    const all = asList(await b.table.resolveCmdlet('Get-DkimSigningConfig', []));
    expect(all.map((x) => x.Domain).sort()).toEqual([d1, d2].sort());
    expect(all.every((x) => x.Identity === x.Domain && x.Enabled === true)).toBe(true);
    await b.table.resolveCmdlet('Set-DkimSigningConfig', ['-Identity', d1, '-Enabled', false]);
    const one = asList(await b.table.resolveCmdlet('Get-DkimSigningConfig', ['-Identity', d1]));
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ Domain: d1, Enabled: false });
  });

  it('(F-4) Get-MgUser -Filter "startsWith(displayName, ...)" returns only the matching users', async () => {
    const q = ['-Filter', "startsWith(displayName, 'Admin-')"];
    expect(asList(await b.table.resolveCmdlet('Get-MgUser', q))).toEqual([]);
    await b.table.resolveCmdlet('New-MgUser', ['-DisplayName', 'Admin-Fixture', '-UserPrincipalName', 'admin-fixture@simtenant.onmicrosoft.us', '-AccountEnabled', true, '-MailNickname', 'adminfixture']);
    const after = asList(await b.table.resolveCmdlet('Get-MgUser', q));
    expect(after.map((u) => u.displayName)).toEqual(['Admin-Fixture']);
    // The URI $filter grammar still refuses startswith (W1 / B20 rule).
    await expect(b.table.resolveUri('GET', "/v1.0/users?$filter=startswith(displayName,'Admin-')")).rejects.toThrow();
  });
});

describe('W5c1: S1 (s1-mach) seeds for the collectors and the evaluator rewrites', () => {
  let b: Built;
  const anchor = Date.parse(ANCHOR_ISO);
  beforeAll(async () => {
    b = await build('s1-mach', ANCHOR_ISO);
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('training coverage covers every licensed, enabled member user with a completed awareness and insider-threat course in 365 days', async () => {
    const cov = await page(b.table, '/v1.0/reports/security/getAttackSimulationTrainingUserCoverage');
    const users = await page(b.table, '/v1.0/users?$select=id,userPrincipalName,accountEnabled,userType,assignedLicenses&$top=999');
    const population = users.filter((u) => u.accountEnabled === true && (u.userType ?? 'Member') === 'Member' && Array.isArray(u.assignedLicenses) && (u.assignedLicenses as unknown[]).length > 0);
    expect(population).toHaveLength(44);
    expect(cov).toHaveLength(44);
    for (const u of population) {
      const row = cov.find((r) => (r.attackSimulationUser as Row).userId === u.id)!;
      expect(row, String(u.id)).toBeDefined();
      const done = (row.userTrainings as Row[]).filter((t) => t.trainingStatus === 'completed' && anchor - Date.parse(String(t.completionDateTime)) <= 365 * DAY);
      expect(done.some((t) => /awareness/i.test(String(t.displayName)))).toBe(true);
      expect(done.some((t) => /insider/i.test(String(t.displayName)))).toBe(true);
    }
  });

  it('lifecycle workflows: scheduled joiner and mover, on-demand leaver whose first task disables the account', async () => {
    const wf = await page(b.table, '/v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks');
    expect(wf.map((w) => w.category).sort()).toEqual(['joiner', 'leaver', 'mover']);
    const leaver = wf.find((w) => w.category === 'leaver')!;
    expect(leaver).toMatchObject({ isEnabled: true, isSchedulingEnabled: false });
    expect((leaver.tasks as Row[])[0]).toMatchObject({ taskDefinitionId: LCW_DISABLE_USER_TASK_ID, isEnabled: true });
    expect(wf.filter((w) => w.category !== 'leaver').every((w) => w.isEnabled === true && w.isSchedulingEnabled === true)).toBe(true);
  });

  it('lockout and banned passwords (Password Rule Settings), domain password expiry and per-user password policy', async () => {
    const s = asList(await b.table.resolveCmdlet('Get-MgDirectorySetting', [])).filter((x) => x.displayName === 'Password Rule Settings');
    expect(s).toHaveLength(1);
    expect(s[0].templateId).toBe(PASSWORD_RULE_SETTINGS_TEMPLATE_ID);
    const v = Object.fromEntries((s[0].values as Row[]).map((x) => [x.name, x.value]));
    expect(v).toMatchObject({ LockoutThreshold: '5', LockoutDurationInSeconds: '300', EnableBannedPasswordCheck: 'True' });
    const domains = await page(b.table, '/v1.0/domains');
    expect(domains.map((d) => d.id)).toEqual(['s1-mach.simtenant.onmicrosoft.us', 'simtenant.onmicrosoft.us']);
    expect(domains.every((d) => d.passwordValidityPeriodInDays === 2147483647)).toBe(true);
    const users = await b.rows('users');
    expect(users.every((u) => u.passwordPolicies === 'None' || u.passwordPolicies === 'DisablePasswordExpiration')).toBe(true);
  });

  it('PIM: role definition -> policy assignment -> policy rules (MFA, justification, ticket, PT4H; approval for Global and Privileged Role Administrator)', async () => {
    const eligible = await b.rows('roleEligibilitySchedules');
    // W5c2 follow-up 6: Compliance Administrator is also eligible now, but S1
    // does not manage its PIM settings (Entra defaults), so the managed-role
    // checks below cover the other 5.
    const roleIds = [...new Set([GA, ...eligible.map((e) => String(e.roleDefinitionId))])].filter((r) => r !== '17315797-102d-40b4-93e0-432062caca18');
    expect(roleIds).toHaveLength(5);
    const policies = await page(b.table, "/v1.0/policies/roleManagementPolicies?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole'&$expand=rules");
    // W5c2 follow-up 4: the 5 managed roles plus the built-in Compliance
    // Administrator at Entra defaults (Stamper's pim-approval looks it up).
    expect(policies).toHaveLength(6);
    for (const roleId of roleIds) {
      const def = asList(await b.table.resolveUri('GET', `/v1.0/roleManagement/directory/roleDefinitions?$filter=id eq '${roleId}'`).then((x) => (x as Row).value));
      expect(def, roleId).toHaveLength(1);
      // Stamper's cmdlet chain (coverage/inventory.json pim-approval): definition by name -> assignment by role -> policy.
      const byName = asList(await b.table.resolveCmdlet('Get-MgRoleManagementDirectoryRoleDefinition', ['-Filter', `displayName eq '${def[0].displayName}'`]));
      expect(byName[0].id).toBe(roleId);
      const asg = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicyAssignment', ['-Filter', `scopeId eq '/' and scopeType eq 'DirectoryRole' and roleDefinitionId eq '${roleId}'`]));
      expect(asg, roleId).toHaveLength(1);
      const pol = policies.find((p) => p.id === asg[0].policyId)!;
      const rule = (id: string) => (pol.rules as Row[]).find((r) => r.id === id)!;
      expect(rule('Enablement_EndUser_Assignment').enabledRules).toEqual(['MultiFactorAuthentication', 'Justification', 'Ticketing']);
      expect(rule('Expiration_EndUser_Assignment')).toMatchObject({ isExpirationRequired: true, maximumDuration: 'PT4H' });
      expect(rule('Expiration_Admin_Eligibility')).toMatchObject({ isExpirationRequired: true, maximumDuration: 'P365D' });
      const approval = (rule('Approval_EndUser_Assignment').setting as Row);
      const needs = ['Global Administrator', 'Privileged Role Administrator'].includes(String(def[0].displayName));
      expect(approval.isApprovalRequired, String(def[0].displayName)).toBe(needs);
      if (needs) {
        // W5c1-b amended: the ISSM's admin account (user-46) is the first
        // approver of both roles. It holds Global Administrator itself, and PIM
        // never lets a requestor approve their own request, so the rule is now
        // "at least one approver does not hold the role", not "the first one".
        const approvers = ((approval.approvalStages as Row[])[0].primaryApprovers as Row[]).map((a) => String(a.userId));
        expect(approvers[0]).toBe('user-46');
        const holders = eligible.filter((e) => e.roleDefinitionId === roleId).map((e) => e.principalId);
        expect(approvers.some((a) => !holders.includes(a)), String(def[0].displayName)).toBe(true);
      }
    }
    // The two recorded activations fit the policy: PT4H, no approval (Security / Exchange Administrator).
    const acts = await b.rows('roleAssignmentScheduleRequests');
    expect(acts.every((a) => (a.scheduleInfo as Row & { expiration: Row }).expiration.duration === 'PT4H' && a.approvalId === null)).toBe(true);
    // Standing Global Administrator stays break-glass only.
    expect((await b.rows('roleAssignments')).map((r) => r.principalId)).toEqual(['user-50', 'user-51']);
  });

  it('per-user authentication methods and MFA state', async () => {
    const methods = (userId: string) => b.table.resolveCmdlet('Get-MgUserAuthenticationMethod', ['-UserId', userId]).then(asList);
    const staff = await methods('user-10');
    expect(staff.map((m) => m.methodType).sort()).toEqual(['microsoftAuthenticator', 'password', 'softwareOath']);
    const admin = await methods('user-48');
    expect(admin.map((m) => m.methodType).sort()).toEqual(['fido2', 'password']);
    const reg = await b.rows('authenticationMethodUserRegistrationDetails');
    expect(reg).toHaveLength(51);
    expect(reg.every((r) => r.isMfaRegistered === true && typeof r.defaultMfaMethod === 'string' && Array.isArray(r.systemPreferredAuthenticationMethods))).toBe(true);
    // MFA is enforced by Conditional Access, so per-user MFA is 'disabled' (the Microsoft value for CA tenants).
    expect(await b.table.resolveUri('GET', '/beta/users/user-10/authentication/requirements')).toEqual({ perUserMfaState: 'disabled' });
  });

  it('device compliance policies carry their settings; every device reports complianceState', async () => {
    const pols = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementDeviceCompliancePolicy', []));
    // W5c2 follow-up 6 (SIM-B6): + the Defender for Endpoint risk policy (same Windows settings).
    expect(pols).toHaveLength(4);
    const win = pols.filter((p) => p['@odata.type'] === '#microsoft.graph.windows10CompliancePolicy');
    expect(win).toHaveLength(3);
    expect(win.every((p) => p.bitLockerEnabled === true && p.passwordRequired === true && p.passwordMinimumLength === 14)).toBe(true);
    expect(pols.find((p) => p['@odata.type'] === '#microsoft.graph.iosCompliancePolicy')).toMatchObject({ passcodeRequired: true, securityBlockJailbrokenDevices: true });
    const devices = await page(b.table, '/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,complianceState,lastSyncDateTime');
    expect(devices).toHaveLength(58);
    expect(devices.filter((d) => d.complianceState === 'compliant')).toHaveLength(50);
  });

  it('CA policies: grant controls incl. mfa and compliantDevice, session controls, break-glass excluded from all 9 (already seeded in W0)', async () => {
    const ca = await page(b.table, '/v1.0/identity/conditionalAccess/policies');
    expect(ca).toHaveLength(9);
    const grants = ca.flatMap((p) => ((p.grantControls as Row | undefined)?.builtInControls as string[] | undefined) ?? []);
    expect(grants).toContain('mfa');
    expect(grants).toContain('compliantDevice');
    expect(ca.some((p) => (p.sessionControls as Row | undefined)?.signInFrequency)).toBe(true);
    expect(ca.every((p) => ((p.conditions as Row).users as Row & { excludeUsers: string[] }).excludeUsers.includes('user-50'))).toBe(true);
  });

  it('alerts: at least one alert moved new -> inProgress -> resolved, recorded in order in its comment trail', async () => {
    const alerts = await page(b.table, '/v1.0/security/alerts_v2');
    const moved = alerts.filter((a) => a.status === 'resolved' && Array.isArray(a.comments) && (a.comments as Row[]).length === 2);
    expect(moved.length).toBeGreaterThanOrEqual(1);
    for (const a of moved) {
      const [first, second] = a.comments as Row[];
      expect(String(first.comment)).toMatch(/from new to inProgress/);
      expect(String(second.comment)).toMatch(/from inProgress to resolved/);
      const t = (x: unknown) => Date.parse(String(x));
      expect(t(a.createdDateTime)).toBeLessThan(t(first.createdDateTime));
      expect(t(first.createdDateTime)).toBeLessThan(t(second.createdDateTime));
      expect(t(second.createdDateTime)).toBe(t(a.resolvedDateTime));
    }
    expect(alerts.find((a) => a.status === 'new')!.comments).toEqual([]);
    expect(alerts.find((a) => a.status === 'inProgress')!.comments as Row[]).toHaveLength(1);
  });

  it('Secure Score: control profiles carry their review state, and the cmdlet and URI read the same profiles', async () => {
    const viaUri = await page(b.table, '/v1.0/security/secureScoreControlProfiles');
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgSecuritySecureScoreControlProfile', ['-All']));
    expect(viaUri).toHaveLength(8);
    expect(viaCmdlet.map((p) => p.id)).toEqual(viaUri.map((p) => p.id));
    expect(viaUri.every((p) => Array.isArray(p.controlStateUpdates) && (p.controlStateUpdates as Row[]).length === 1 && typeof p.remediation === 'string')).toBe(true);
    const open = viaUri.filter((p) => p.implementationStatus !== 'implemented');
    expect(open.map((p) => p.id)).toEqual(['mdo_safelinksforemail']);
    expect((open[0].controlStateUpdates as Row[])[0].assignedTo).toMatch(/@s1-mach\.simtenant\.onmicrosoft\.us$/);
    const scores = await page(b.table, '/v1.0/security/secureScores?$top=90');
    expect(scores).toHaveLength(90);
    expect((scores[0].controlScores as Row[]).length).toBe(8);
  });
});
