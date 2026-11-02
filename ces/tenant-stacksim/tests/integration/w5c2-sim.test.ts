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
import { buildMusterPartialConfigSeed, COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID } from '../../src/seed/sets/musterPartialConfig.js';

/**
 * synthetic-customer W5 cycle 2 (2026-10-28): muster-partial's
 * configuration fields for EO's rewritten evaluators (the
 * muster-partial-config seed set), through the real resolver chain:
 *  - the 2 compliance policies carry S1's Windows password settings;
 *  - /v1.0/domains carries the password validity fields, and /beta/settings
 *    and /v1.0/groupSettings return the directory settings collection;
 *  - users carry signInActivity (all within 30 days) and the other fields
 *    EO selects, served on $select;
 *  - the generic PIM policy carries scopeType (see w5c1c-sim.test.ts);
 *  - no CUI policy label and no legacy-auth block are added (CES's job).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DAY = 86400000;
// The exact select ces-eo ComplianceSignalFetcher.ts sends (DIRECTORY_USER_SELECT; hard-coded, not imported across repos).
const EO_USER_SELECT = ['id', 'userPrincipalName', 'displayName', 'accountEnabled', 'userType', 'assignedLicenses', 'signInActivity', 'createdDateTime', 'onPremisesSyncEnabled', 'passwordPolicies', 'lastPasswordChangeDateTime'];
// Stamper IA.L2-3.5.8.password-policy-evidence (get_command and evidence_commands; follow-up 5: v1.0 is groupSettings).
const STAMPER_V1_GROUP_SETTINGS = 'https://graph.microsoft.us/v1.0/groupSettings';
const STAMPER_BETA_SETTINGS = 'https://graph.microsoft.us/beta/settings';
const STAMPER_DOMAINS = 'https://graph.microsoft.us/v1.0/domains';
const PIM_FILTER = "/v1.0/policies/roleManagementPolicies?$filter=scopeId%20eq%20'/'%20and%20scopeType%20eq%20'DirectoryRole'";

/** Stamper AC.L2-3.1.4.pim-approval step 1: $roleId = (Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq 'Compliance Administrator'").Id */
async function stamperRoleId(t: ResolverTable): Promise<string> {
  const r = asList(await t.resolveCmdlet('Get-MgRoleManagementDirectoryRoleDefinition', ['-Filter', "displayName eq 'Compliance Administrator'"]));
  expect(r).toHaveLength(1);
  return String(r[0].id);
}
/** Step 2: (Get-MgPolicyRoleManagementPolicyAssignment -Filter "scopeId eq '/' and scopeType eq 'DirectoryRole' and roleDefinitionId eq '$roleId'" | Select -First 1).PolicyId */
async function stamperPolicyId(t: ResolverTable, roleId: string): Promise<string> {
  const a = asList(await t.resolveCmdlet('Get-MgPolicyRoleManagementPolicyAssignment', ['-Filter', `scopeId eq '/' and scopeType eq 'DirectoryRole' and roleDefinitionId eq '${roleId}'`]));
  expect(a.length).toBeGreaterThan(0);
  return String(a[0].policyId);
}

type Row = Record<string, unknown>;

async function build(slug: string): Promise<{ dir: string; table: ResolverTable; store: ObjectStore }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-${slug}-`));
  const tenantRoot = path.join(dir, 'tenant');
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
  const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
  return { dir, store, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);
const page = async (t: ResolverTable, uri: string) => (await t.resolveUri('GET', uri)) as { value: Row[] } & Row;

describe('W5c2: muster-partial configuration fields', () => {
  let b: { dir: string; table: ResolverTable; store: ObjectStore };
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('opts into muster-partial-config after eo-collection-b20', async () => {
    const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', 'muster-partial.json'));
    expect(scenario.seedSets).toEqual(['eo-collection-b20', 'muster-partial-config']);
  });

  it('(1) both generic compliance policies carry the password settings, on the cmdlet and the URI', async () => {
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementDeviceCompliancePolicy', []));
    const viaUri = (await page(b.table, '/v1.0/deviceManagement/deviceCompliancePolicies')).value;
    for (const list of [viaCmdlet, viaUri]) {
      expect(list.map((p) => p.displayName).sort()).toEqual(['Sim Compliance Policy 1', 'Sim Compliance Policy 2']);
      for (const p of list) {
        expect(p).toMatchObject({
          '@odata.type': '#microsoft.graph.windows10CompliancePolicy',
          platformType: 'windows10',
          passwordRequired: true,
          passwordBlockSimple: true,
          passwordMinimumLength: 14,
          passwordRequiredType: 'alphanumeric',
          passwordMinutesOfInactivityBeforeLock: 15,
          passwordPreviousPasswordBlockCount: 24,
        });
        expect('passwordExpirationDays' in p && p.passwordExpirationDays === null).toBe(true);
      }
    }
  });

  it('(2) /v1.0/domains carries the password validity fields (Stamper evidence projection is non-empty)', async () => {
    const domains = (await page(b.table, STAMPER_DOMAINS)).value;
    expect(domains.map((d) => d.id).sort()).toEqual(['muster-partial.simtenant.onmicrosoft.us', 'simtenant.onmicrosoft.us']);
    for (const d of domains) {
      expect(d.passwordValidityPeriodInDays).toBe(2147483647);
      expect(d.passwordNotificationWindowInDays).toBe(14);
    }
    // Same names as the organization's verified domains.
    const org = (await page(b.table, '/v1.0/organization')).value[0];
    expect(((org.verifiedDomains as Row[]).map((d) => d.name) as string[]).sort()).toEqual(domains.map((d) => d.id).sort());
  });

  it('(2) /beta/settings and /v1.0/groupSettings (Stamper\'s absolute URLs) return the same directory settings collection', async () => {
    const beta = await page(b.table, STAMPER_BETA_SETTINGS);
    const group = await page(b.table, STAMPER_V1_GROUP_SETTINGS);
    expect(group).toEqual(beta);
    for (const out of [beta, group]) {
      expect(out.value).toHaveLength(1);
      expect(out['@odata.nextLink']).toBeUndefined();
      expect(out.value[0]).toMatchObject({ displayName: 'Password Rule Settings', templateId: '5cf42378-d67d-4f36-ba46-e8b86229381d' });
      const values = Object.fromEntries((out.value[0].values as Array<{ name: string; value: string }>).map((v) => [v.name, v.value]));
      expect(values).toMatchObject({ LockoutThreshold: '10', LockoutDurationInSeconds: '60', EnableBannedPasswordCheck: 'True' });
    }
    const cmdlet = asList(await b.table.resolveCmdlet('Get-MgDirectorySetting', []));
    expect(cmdlet.map((s) => s.id)).toEqual(beta.value.map((s) => s.id));
  });

  it('(3) EO\'s user select returns every selected field on all 5 users; every sign-in is within 30 days', async () => {
    const out = (await page(b.table, `/v1.0/users?$select=${EO_USER_SELECT.join(',')}&$top=999`)).value;
    expect(out).toHaveLength(5);
    for (const u of out) {
      expect(Object.keys(u).sort()).toEqual([...EO_USER_SELECT].sort());
      expect(u).toMatchObject({ accountEnabled: true, userType: 'Member', onPremisesSyncEnabled: false, passwordPolicies: 'None' });
      const last = Date.parse((u.signInActivity as { lastSignInDateTime: string }).lastSignInDateTime);
      expect((Date.now() - last) / DAY).toBeLessThan(30);
      expect(Date.parse(String(u.createdDateTime))).toBeLessThan(last);
      expect(Number.isFinite(Date.parse(String(u.lastPasswordChangeDateTime)))).toBe(true);
    }
  });

  it('(3) the fields come back only when $select names them', async () => {
    const out = (await page(b.table, '/v1.0/users?$select=id,displayName')).value;
    expect(out.every((u) => Object.keys(u).sort().join() === 'displayName,id')).toBe(true);
    const whole = (await page(b.table, '/v1.0/users')).value;
    expect(whole.every((u) => 'signInActivity' in u && 'passwordPolicies' in u)).toBe(true);
  });

  it('(4) follow-up: EO\'s PIM read with $expand=rules returns the policy with Entra\'s default rules (no approval); without $expand no rules', async () => {
    const pimFilter = "/v1.0/policies/roleManagementPolicies?$filter=scopeId%20eq%20'/'%20and%20scopeType%20eq%20'DirectoryRole'";
    const expanded = (await page(b.table, `${pimFilter}&$expand=rules`)).value;
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toMatchObject({ id: 'roleManagementPolicy-1', scopeId: '/', scopeType: 'DirectoryRole' });
    const rules = expanded[0].rules as Row[];
    expect(rules.map((r) => r.id)).toEqual([
      'Expiration_Admin_Eligibility', 'Expiration_Admin_Assignment', 'Enablement_Admin_Assignment',
      'Expiration_EndUser_Assignment', 'Enablement_EndUser_Assignment', 'Approval_EndUser_Assignment', 'Notification_Admin_EndUser_Assignment',
    ]);
    const approval = rules.find((r) => r.id === 'Approval_EndUser_Assignment')!;
    expect(approval['@odata.type']).toBe('#microsoft.graph.unifiedRoleManagementPolicyApprovalRule');
    expect(approval.setting).toMatchObject({ isApprovalRequired: false, approvalStages: [] });
    const bare = (await page(b.table, pimFilter)).value;
    expect(bare.map((p) => p.id)).toEqual(['roleManagementPolicy-1']);
    expect('rules' in bare[0]).toBe(false);
  });

  it("(4) follow-up 2: Stamper's two-step lookup (role by displayName, then the policy assignment) returns the policy id", async () => {
    const roleId = await stamperRoleId(b.table);
    expect(roleId).toBe(COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID);
    expect(await stamperPolicyId(b.table, roleId)).toBe('roleManagementPolicy-1');
    // pim-policy-get's last step.
    const p = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicy', ['-UnifiedRoleManagementPolicyId', 'roleManagementPolicy-1']));
    expect(p.map((x) => x.id)).toContain('roleManagementPolicy-1');
    // pim-approval's get, before the write.
    const before = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', 'roleManagementPolicy-1', '-Filter', "id eq 'Approval_EndUser_Assignment'"]));
    expect(before).toHaveLength(1);
    expect((before[0].setting as Row).isApprovalRequired).toBe(false);
  });

  it("(4) follow-up 2: Stamper's Update of Approval_EndUser_Assignment (approval required, one approver) is on EO's next $expand=rules read", async () => {
    const roleId = await stamperRoleId(b.table);
    const policyId = await stamperPolicyId(b.table, roleId);
    // $approverId = (Get-MgUser -Filter "userPrincipalName eq '{approverUPN}'").Id - the Sim tenant config's approver_upn.
    const approver = asList(await b.table.resolveCmdlet('Get-MgUser', ['-Filter', "userPrincipalName eq 'sim.user3@simtenant.onmicrosoft.us'"]));
    expect(approver.map((u) => u.id)).toEqual(['user-3']);
    // Stamper's -BodyParameter, with the array PS 5.1 may wrap as {value, Count}.
    const body = {
      '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyApprovalRule',
      id: 'Approval_EndUser_Assignment',
      setting: {
        isApprovalRequired: true,
        isApprovalRequiredForExtension: false,
        isRequestorJustificationRequired: true,
        approvalMode: 'SingleStage',
        approvalStages: { value: [{ approvalStageTimeOutInDays: 1, isApproverJustificationRequired: true, isEscalationEnabled: false, primaryApprovers: [{ '@odata.type': '#microsoft.graph.singleUser', userId: approver[0].id }] }], Count: 1 },
      },
    };
    await b.table.resolveCmdlet('Update-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', policyId, '-UnifiedRoleManagementPolicyRuleId', 'Approval_EndUser_Assignment', '-BodyParameter', body]);
    const policies = (await page(b.table, `${PIM_FILTER}&$expand=rules`)).value;
    const rule = (policies[0].rules as Row[]).find((r) => r.id === 'Approval_EndUser_Assignment')!;
    const setting = rule.setting as { isApprovalRequired: boolean; approvalStages: Array<{ primaryApprovers: Row[] }> };
    expect(setting.isApprovalRequired).toBe(true);
    expect(setting.approvalStages).toHaveLength(1);
    expect(setting.approvalStages[0].primaryApprovers.map((a) => a.userId)).toEqual(['user-3']);
    expect(policies[0].rules as Row[]).toHaveLength(7);
    // EO's pimApprovalEvaluator condition (ac-evaluators.ts) now holds for this policy.
    const approving = policies.filter((p) => (p.rules as any[]).some((r) =>
      (/ApprovalRule$/.test(String(r?.['@odata.type'] ?? '')) || String(r?.id ?? '').startsWith('Approval_'))
      && r?.setting?.isApprovalRequired === true
      && (r.setting.approvalStages ?? []).some((st: any) => (st?.primaryApprovers ?? []).length > 0)));
    expect(approving).toHaveLength(1);
    // Stamper's post-check get reads the same rule.
    const after = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', policyId, '-Filter', "id eq 'Approval_EndUser_Assignment'"]));
    expect((after[0].setting as Row).isApprovalRequired).toBe(true);
    // Still expand-only on the URI read.
    expect('rules' in (await page(b.table, PIM_FILTER)).value[0]).toBe(false);
  });

  it('(4) follow-up 2: the rules URIs read and PATCH the same list; unknown ids are a 404, a null policy id a 400', async () => {
    const list = await page(b.table, "/v1.0/policies/roleManagementPolicies/roleManagementPolicy-1/rules?$filter=id eq 'Expiration_EndUser_Assignment'");
    expect(list.value.map((r) => r.maximumDuration)).toEqual(['PT8H']);
    await b.table.resolveUri('PATCH', 'https://graph.microsoft.us/v1.0/policies/roleManagementPolicies/roleManagementPolicy-1/rules/Expiration_EndUser_Assignment', {
      '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule', id: 'Expiration_EndUser_Assignment', isExpirationRequired: true, maximumDuration: 'PT4H',
    });
    const item = (await b.table.resolveUri('GET', '/beta/policies/roleManagementPolicies/roleManagementPolicy-1/rules/Expiration_EndUser_Assignment')) as Row;
    expect(item.maximumDuration).toBe('PT4H');
    const expanded = (await page(b.table, `${PIM_FILTER}&$expand=rules`)).value[0].rules as Row[];
    expect(expanded.find((r) => r.id === 'Expiration_EndUser_Assignment')?.maximumDuration).toBe('PT4H');
    await expect(b.table.resolveUri('GET', '/v1.0/policies/roleManagementPolicies/nope/rules')).rejects.toThrow(/no role management policy/);
    await expect(b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', 'roleManagementPolicy-1', '-UnifiedRoleManagementPolicyRuleId', 'Nope'])).rejects.toThrow(/no such rule/);
    await expect(b.table.resolveCmdlet('Update-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', null, '-UnifiedRoleManagementPolicyRuleId', 'Approval_EndUser_Assignment', '-BodyParameter', {}])).rejects.toThrow(/required/);
  });

  it('honest gaps stay: no CUI policy label and no legacy-authentication block are added', async () => {
    const set = buildMusterPartialConfigSeed(Date.now());
    const touched = [...Object.keys(set.enrich), ...Object.keys(set.add)];
    for (const c of ['policyLabels', 'sensitivityLabels', 'label', 'labelPolicy', 'caPolicies']) expect(touched).not.toContain(c);
    const labels = asList(await b.table.resolveCmdlet('Get-MgInformationProtectionPolicyLabel', []));
    expect(labels.some((l) => /cui/i.test(String(l.name ?? l.displayName ?? '')))).toBe(false);
    const ca = asList(await b.table.resolveCmdlet('Get-MgIdentityConditionalAccessPolicy', []));
    const blocksLegacy = ca.some((p) => {
      const conditions = (p.conditions ?? {}) as Row;
      const grant = (p.grantControls ?? {}) as Row;
      return Array.isArray(conditions.clientAppTypes) && ((grant.builtInControls as string[] | undefined) ?? []).includes('block');
    });
    expect(blocksLegacy).toBe(false);
  });
});

describe('W5c2: the settings routes are Sim-wide (S1 serves its own Password Rule Settings)', () => {
  let b: { dir: string; table: ResolverTable; store: ObjectStore };
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it("follow-up 2: the rule cmdlet reads each S1 policy's own rules (the list $expand=rules returns)", async () => {
    const expanded = (await page(b.table, `${PIM_FILTER}&$expand=rules`)).value;
    // W5c2 follow-up 4: S1's 5 managed roles plus Compliance Administrator (Entra defaults).
    expect(expanded.length).toBe(6);
    for (const p of expanded) {
      const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', String(p.id)]));
      expect(viaCmdlet).toEqual(p.rules);
    }
  });

  it('follow-up 4 (SIM-11): deleted users are served on the type-cast path (v1.0 and beta), $select honoured, none reused', async () => {
    const sel = '/v1.0/directory/deletedItems/microsoft.graph.user?$select=id,userPrincipalName,deletedDateTime';
    const out = await page(b.table, sel);
    expect(out['@odata.nextLink']).toBeUndefined();
    expect(out.value).toHaveLength(2);
    const users = (await page(b.table, '/v1.0/users')).value;
    for (const d of out.value) {
      expect(Object.keys(d).sort()).toEqual(['deletedDateTime', 'id', 'userPrincipalName']);
      const age = (Date.now() - Date.parse(String(d.deletedDateTime))) / DAY;
      expect(age).toBeLessThan(30);
      const prefix = String(d.id).replace(/-/g, '');
      expect(String(d.userPrincipalName).startsWith(prefix)).toBe(true);
      const original = String(d.userPrincipalName).slice(prefix.length);
      expect(original.endsWith('@s1-mach.simtenant.onmicrosoft.us')).toBe(true);
      // Not in the directory, and no account (enabled or not) holds the original UPN.
      expect(users.some((u) => u.id === d.id)).toBe(false);
      expect(users.some((u) => String(u.userPrincipalName).toLowerCase() === original.toLowerCase())).toBe(false);
    }
    const beta = (await page(b.table, '/beta/directory/deletedItems/microsoft.graph.user')).value;
    expect(beta.map((d) => d.id).sort()).toEqual(out.value.map((d) => d.id).sort());
    expect(beta.every((d) => d.accountEnabled === false && typeof d.displayName === 'string')).toBe(true);
    // Each deletion is in the directory audit log.
    const audits = (await page(b.table, "/v1.0/auditLogs/directoryAudits?$filter=activityDisplayName eq 'Delete user'")).value;
    expect(audits.map((a) => ((a.targetResources as Row[])[0]).id).sort()).toEqual(out.value.map((d) => d.id).sort());
  });

  it('follow-up 3: the Graph label reads still return only the seeded CUI label (the Purview row has the same id)', async () => {
    const policy = asList(await b.table.resolveCmdlet('Get-MgInformationProtectionPolicyLabel', []));
    const sens = asList(await b.table.resolveCmdlet('Get-MgInformationProtectionSensitivityLabel', []));
    expect(policy).toHaveLength(1);
    expect(sens).toHaveLength(1);
    expect(policy[0]).toMatchObject({ id: '51510000-001a-4000-8000-000000000001', name: 'CUI', color: '#C00000' });
    expect(sens[0]).toMatchObject({ id: '51510000-001a-4000-8000-000000000001', name: 'CUI', hasProtection: true });
  });

  it('follow-up 5: /v1.0/groupSettings (Stamper\'s absolute URL) returns the same data as /beta/settings', async () => {
    const group = await page(b.table, STAMPER_V1_GROUP_SETTINGS);
    const beta = await page(b.table, STAMPER_BETA_SETTINGS);
    expect(group).toEqual(beta);
    expect(group.value).toHaveLength(1);
    expect(group.value[0].displayName).toBe('Password Rule Settings');
    const values = Object.fromEntries((group.value[0].values as Array<{ name: string; value: string }>).map((v) => [v.name, v.value]));
    expect(values).toMatchObject({ LockoutThreshold: '5', LockoutDurationInSeconds: '300' });
  });

  it('follow-up 5: the /v1.0/settings alias is gone (no directory settings there)', async () => {
    const out = (await b.table.resolveUri('GET', 'https://graph.microsoft.us/v1.0/settings').catch((e: Error) => e)) as unknown;
    const ids = out && typeof out === 'object' && Array.isArray((out as { value?: unknown }).value) ? ((out as { value: Row[] }).value).map((s) => s.id) : [];
    const group = (await page(b.table, STAMPER_V1_GROUP_SETTINGS)).value.map((s) => s.id);
    expect(ids.some((id) => group.includes(id))).toBe(false);
  });
});

describe('W5c2 follow-up 3: Stamper-created labels and CA policies on muster-partial (fresh build)', () => {
  let b: { dir: string; table: ResolverTable; store: ObjectStore };
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  // EO's AC.L2-3.1.3 informationFlowEvaluator condition (ac-evaluators.ts CUI_LABEL_RE).
  const CUI_LABEL_RE = /\bCUI\b|controlled unclassified/i;
  const activeCui = (labels: Row[]) => labels.filter((l) => l.isActive !== false && CUI_LABEL_RE.test(String(l.name ?? l.displayName ?? '')));

  it("Stamper's New-Label (rights and content marking) is stored as posted and shows on both Graph label reads as an active, protected CUI label", async () => {
    expect(activeCui(asList(await b.table.resolveCmdlet('Get-MgInformationProtectionPolicyLabel', [])))).toEqual([]);
    await b.table.resolveCmdlet('New-Label', [
      '-Name', 'CUI', '-DisplayName', 'CUI - Controlled Unclassified Information', '-Tooltip', 'Contains CUI',
      '-EncryptionEnabled', true, '-EncryptionProtectionType', 'Template', '-EncryptionEncryptOnly', false,
      '-EncryptionRightsDefinitions', 'muster-partial.simtenant.onmicrosoft.us:VIEW,VIEWRIGHTSDATA,DOCEDIT,EDIT,PRINT,EXTRACT,REPLY,REPLYALL,FORWARD,OBJMODEL',
      '-ApplyContentMarkingHeaderEnabled', true, '-ApplyContentMarkingHeaderText', 'CUI',
      '-ApplyContentMarkingFooterEnabled', true, '-ApplyContentMarkingFooterText', 'CUI',
    ]);
    const row = asList(await b.table.resolveCmdlet('Get-Label', ['-Identity', 'CUI']))[0];
    expect(row).toMatchObject({
      Name: 'CUI', EncryptionEnabled: true,
      EncryptionRightsDefinitions: 'muster-partial.simtenant.onmicrosoft.us:VIEW,VIEWRIGHTSDATA,DOCEDIT,EDIT,PRINT,EXTRACT,REPLY,REPLYALL,FORWARD,OBJMODEL',
      ApplyContentMarkingHeaderEnabled: true, ApplyContentMarkingHeaderText: 'CUI',
      ApplyContentMarkingFooterEnabled: true, ApplyContentMarkingFooterText: 'CUI',
    });
    const policy = asList(await b.table.resolveCmdlet('Get-MgInformationProtectionPolicyLabel', []));
    expect(policy.map((l) => l.name)).toEqual(['Sim Policy Label 1', 'CUI - Controlled Unclassified Information']);
    const cui = activeCui(policy);
    expect(cui).toHaveLength(1);
    expect(cui[0]).toEqual({ id: 'CUI', name: 'CUI - Controlled Unclassified Information', displayName: 'CUI - Controlled Unclassified Information', isActive: true, hasProtection: true });
    const sens = asList(await b.table.resolveCmdlet('Get-MgInformationProtectionSensitivityLabel', []));
    expect(sens.find((l) => l.id === 'CUI')).toMatchObject({ isActive: true, hasProtection: true });
    // The Graph collections themselves are not written (read-time projection).
    expect((await b.store.list('policyLabels')).map((l) => l.id)).toEqual(['policyLabel-1']);
  });

  it('a disabled Purview label reads isActive false', async () => {
    await b.table.resolveCmdlet('Set-Label', ['-Identity', 'CUI', '-Disabled', true]);
    const l = asList(await b.table.resolveCmdlet('Get-MgInformationProtectionPolicyLabel', [])).find((x) => x.id === 'CUI');
    expect(l?.isActive).toBe(false);
    await b.table.resolveCmdlet('Set-Label', ['-Identity', 'CUI', '-Disabled', false]);
  });

  it("Stamper's CMMC-Block-Legacy-Auth is stored exactly as posted and listed on the cmdlet and URI reads", async () => {
    const posted = {
      displayName: 'CMMC-Block-Legacy-Auth', state: 'enabled',
      conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-2'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] },
      grantControls: { operator: 'OR', builtInControls: ['block'] },
    };
    await b.table.resolveCmdlet('New-MgIdentityConditionalAccessPolicy', ['-BodyParameter', posted]);
    const viaCmdlet = asList(await b.table.resolveCmdlet('Get-MgIdentityConditionalAccessPolicy', [])).find((p) => p.displayName === 'CMMC-Block-Legacy-Auth');
    const viaUri = (await page(b.table, 'https://graph.microsoft.us/v1.0/identity/conditionalAccess/policies')).value.find((p) => p.displayName === 'CMMC-Block-Legacy-Auth');
    for (const p of [viaCmdlet, viaUri]) expect(p).toMatchObject(posted);
  });
});

describe("W5c2 follow-up 4 (A): Stamper's AC.L2-3.1.4.pim-approval chain on S1, step by step", () => {
  let b: { dir: string; table: ResolverTable; store: ObjectStore };
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });
  // The run-46 approverUPN (S1's ISSM admin account, user-46).
  const APPROVER_UPN = 'adm.tamsel.kettlevane@s1-mach.simtenant.onmicrosoft.us';

  it('steps 1-4 and the state post-check succeed; the write is on the next EO $expand=rules read', async () => {
    // 1. $roleId = (Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq 'Compliance Administrator'").Id
    const roleId = await stamperRoleId(b.table);
    expect(roleId).toBe(COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID);
    // 2. $pimPolicyId = (Get-MgPolicyRoleManagementPolicyAssignment -Filter "... and roleDefinitionId eq '$roleId'" | Select-Object -First 1).PolicyId
    const policyId = await stamperPolicyId(b.table, roleId);
    expect(policyId).toMatch(/^DirectoryRole_sim-tenant-s1-mach_51510000-009a-/);
    // 3. $approverId = (Get-MgUser -Filter "userPrincipalName eq '{approverUPN}'").Id
    const approver = asList(await b.table.resolveCmdlet('Get-MgUser', ['-Filter', `userPrincipalName eq '${APPROVER_UPN}'`]));
    expect(approver.map((u) => u.id)).toEqual(['user-46']);
    // 4. Update-MgPolicyRoleManagementPolicyRule with the registry's body.
    const approvalStage = { approvalStageTimeOutInDays: 1, isApproverJustificationRequired: true, isEscalationEnabled: false, primaryApprovers: [{ '@odata.type': '#microsoft.graph.singleUser', userId: approver[0].id }] };
    const body = { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyApprovalRule', id: 'Approval_EndUser_Assignment', setting: { isApprovalRequired: true, isApprovalRequiredForExtension: false, isRequestorJustificationRequired: true, approvalMode: 'SingleStage', approvalStages: [approvalStage] } };
    await b.table.resolveCmdlet('Update-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', policyId, '-UnifiedRoleManagementPolicyRuleId', 'Approval_EndUser_Assignment', '-BodyParameter', body]);
    // State post-check: Get-MgPolicyRoleManagementPolicyRule -UnifiedRoleManagementPolicyId $pimPolicyId -Filter "id eq 'Approval_EndUser_Assignment'"
    // (verification: regex isApprovalRequired.*true, $.setting.isApprovalRequired equals "true").
    const got = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', policyId, '-Filter', "id eq 'Approval_EndUser_Assignment'"]));
    expect(got).toHaveLength(1);
    expect(JSON.stringify(got[0])).toMatch(/isApprovalRequired.*true/);
    expect(String((got[0].setting as Row).isApprovalRequired)).toBe('true');
    // EO's next read: 3 of 6 policies require a named approver (GA, PRA, and now Compliance Administrator).
    const policies = (await page(b.table, `${PIM_FILTER}&$expand=rules`)).value;
    const approving = policies.filter((p) => (p.rules as any[]).some((r) => String(r?.id ?? '').startsWith('Approval_') && r?.setting?.isApprovalRequired === true
      && (r.setting.approvalStages ?? []).some((st: any) => (st?.primaryApprovers ?? []).length > 0)));
    expect(policies).toHaveLength(6);
    expect(approving).toHaveLength(3);
    expect(approving.map((p) => p.id)).toContain(policyId);
  });

  it('before the fix the chain broke at step 1: with no role id, step 2 finds nothing and the Update is a 400 (faithful to Graph on a null id)', async () => {
    const none = asList(await b.table.resolveCmdlet('Get-MgPolicyRoleManagementPolicyAssignment', ['-Filter', "scopeId eq '/' and scopeType eq 'DirectoryRole' and roleDefinitionId eq ''"]));
    expect(none).toEqual([]);
    await expect(b.table.resolveCmdlet('Update-MgPolicyRoleManagementPolicyRule', ['-UnifiedRoleManagementPolicyId', null, '-UnifiedRoleManagementPolicyRuleId', 'Approval_EndUser_Assignment', '-BodyParameter', {}])).rejects.toThrow(/UnifiedRoleManagementPolicyId is required/);
  });
});

describe('W5c2 follow-up 4 (SIM-11): muster-partial has an empty recycle bin', () => {
  let b: { dir: string; table: ResolverTable; store: ObjectStore };
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('EO\'s deleted-users read returns an empty value on v1.0 and beta', async () => {
    expect((await page(b.table, '/v1.0/directory/deletedItems/microsoft.graph.user?$select=id,userPrincipalName,deletedDateTime')).value).toEqual([]);
    expect((await page(b.table, '/beta/directory/deletedItems/microsoft.graph.user')).value).toEqual([]);
  });
});
