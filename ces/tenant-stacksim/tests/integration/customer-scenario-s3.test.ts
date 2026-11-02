// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadScenario, applyScenario, type ScenarioFile } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { buildCustomerHistorySeed } from '../../src/seed/sets/customerHistory.js';
import { buildCustomerHistoryS3Seed } from '../../src/seed/sets/customerHistoryS3.js';
// @ts-expect-error plain-JS generator script (no type declarations)
import { buildCustomerScenario, loadCustomerConfig, loadCustomer } from '../../scripts/build-customer-scenario.mjs';

/**
 * synthetic-customer W6 (2026-10-28): the synthetic customer S3 `s3-def`,
 * deficient by design (PLAN §2.1b).
 *  - drift guard: scenarios/s3-def.json = build(config + customer.json), and
 *    customer.json = its own generator's output;
 *  - each seeded deficiency (customers/s3-def/deficiencies.json);
 *  - the E6X injection the tester sends (a PATCH through /resolve) and the
 *    A-02 confirming read work on this store; the harness's offboard_upn
 *    discoverer picks the stale admin;
 *  - what S3 lacks is empty, never an error: every read S1 answers, S3 answers;
 *  - no S1 fiction survives the rewrite; determinism; the identity scan.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const SLUG = 's3-def';
const SET = 'customer-history-s3';
const DOMAIN = `${SLUG}.simtenant.onmicrosoft.us`;
const SCENARIO_PATH = path.join(SIM_ROOT, 'scenarios', `${SLUG}.json`);
const CONFIG_PATH = path.join(SIM_ROOT, 'scenarios', `${SLUG}.config.json`);
const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { customer: string };
const CUSTOMER_PATH = path.resolve(SIM_ROOT, CONFIG.customer);
const CUSTOMER_GEN = path.join(path.dirname(CUSTOMER_PATH), 'gen-customer.mjs');
const SCAN_TOKENS = path.resolve(SIM_ROOT, '..', '..', 'nb-tools', 'scan-tokens.txt');
const haveCustomer = existsSync(CUSTOMER_PATH);
const ANCHOR_ISO = haveCustomer ? (JSON.parse(readFileSync(CUSTOMER_PATH, 'utf8')) as { history_anchor: string }).history_anchor : '2026-10-01T00:00:00.000Z';
const ANCHOR = Date.parse(ANCHOR_ISO);
const DAY = 86400000;
const GA = '62e90394-69f5-4237-9190-012177145e10';
const STALE_ADMIN = 'user-59';

type Row = Record<string, any>;
type Store = { collections: Record<string, Record<string, Row>> };
const asList = (v: unknown): Row[] => {
  if (Array.isArray(v)) return v as Row[];
  if (v && typeof v === 'object' && Array.isArray((v as { value?: unknown }).value)) return (v as { value: Row[] }).value;
  return v ? [v as Row] : [];
};

async function buildFixed(root: string, scenario: ScenarioFile): Promise<Store> {
  const prev = process.env.STACKSIM_FIXED_NOW;
  process.env.STACKSIM_FIXED_NOW = ANCHOR_ISO;
  try {
    await applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot: root });
  } finally {
    if (prev === undefined) delete process.env.STACKSIM_FIXED_NOW;
    else process.env.STACKSIM_FIXED_NOW = prev;
  }
  return JSON.parse(await fs.readFile(path.join(root, 'store.json'), 'utf8')) as Store;
}
const rows = (s: Store, c: string) => Object.values(s.collections[c] ?? {});
/** EO's inactivity rule (ia-evaluators.ts inactivity): the latest of the three sign-in times. */
const lastActive = (u: Row): number => {
  const a = (u.signInActivity ?? {}) as Row;
  const t = [a.lastSignInDateTime, a.lastNonInteractiveSignInDateTime, a.lastSuccessfulSignInDateTime].map((x) => (typeof x === 'string' ? Date.parse(x) : NaN)).filter(Number.isFinite);
  return t.length ? Math.max(...t) : Date.parse(String(u.createdDateTime));
};

describe('synthetic customer S3 (s3-def, deficient by design)', () => {
  let dir: string;
  let scenario: ScenarioFile;
  let store: Store;
  let table: ResolverTable;
  let s1Table: ResolverTable;
  let s2Table: ResolverTable;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-s3-'));
    scenario = await loadScenario(SCENARIO_PATH);
    store = await buildFixed(path.join(dir, 'tenant'), scenario);
    table = new ResolverTable(new ObjectStore(path.join(dir, 'tenant', 'store.json')), new StackShapeGate('m365_azure'));
    await buildFixed(path.join(dir, 's1'), await loadScenario(path.join(SIM_ROOT, 'scenarios', 's1-mach.json')));
    s1Table = new ResolverTable(new ObjectStore(path.join(dir, 's1', 'store.json')), new StackShapeGate('m365_azure'));
    await buildFixed(path.join(dir, 's2'), await loadScenario(path.join(SIM_ROOT, 'scenarios', 's2-eng.json')));
    s2Table = new ResolverTable(new ObjectStore(path.join(dir, 's2', 'store.json')), new StackShapeGate('m365_azure'));
  }, 120_000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!haveCustomer)('drift guard: the committed scenario matches its config + customer.json, and customer.json matches its generator', async () => {
    const cfg = loadCustomerConfig(SLUG);
    expect(buildCustomerScenario(cfg, loadCustomer(cfg))).toEqual(JSON.parse(await fs.readFile(SCENARIO_PATH, 'utf8')));
    const gen = (await import(pathToFileURL(CUSTOMER_GEN).href)) as { buildCustomer: () => unknown };
    expect(gen.buildCustomer()).toEqual(JSON.parse(readFileSync(CUSTOMER_PATH, 'utf8')));
  });

  it('builds on stance m365_azure with its own seed set and references the customer file by path', () => {
    expect(scenario.stance).toBe('m365_azure');
    expect(scenario.seedSets).toEqual([SET]);
    expect(Object.keys(scenario.seedContext ?? {})).toEqual([SET]);
    expect(CONFIG.customer).toBe(`../../pkg/ces-muster-run/customers/${SLUG}/customer.json`);
  });

  it('seeds 60 accounts, all enabled: 4 idle beyond 90 days (incl. the stale admin), 1 leaver still enabled; break-glass inside 90 days', () => {
    const users = rows(store, 'users');
    expect(users).toHaveLength(60);
    expect(users.every((u) => String(u.userPrincipalName).endsWith(`@${DOMAIN}`))).toBe(true);
    expect(users.some((u) => String(u.displayName).startsWith('Sim User'))).toBe(false);
    expect(users.filter((u) => u.accountEnabled === false)).toHaveLength(0);
    const idle = users.filter((u) => (ANCHOR - lastActive(u)) / DAY > 90).map((u) => u.id).sort();
    expect(idle).toEqual(['user-16', 'user-33', 'user-40', STALE_ADMIN].sort());
    // Stamper's disable-inactive filter needs a non-null lastSignInDateTime on each idle account.
    for (const id of idle) expect(users.find((u) => u.id === id)!.signInActivity.lastSignInDateTime).toBeTruthy();
    const stale = users.find((u) => u.id === STALE_ADMIN)!;
    expect(Math.round((ANCHOR - Date.parse(stale.employeeLeaveDateTime)) / DAY)).toBe(140);
    expect(stale.assignedLicenses).toEqual([]);
    const leavers = users.filter((u) => u.employeeLeaveDateTime).map((u) => u.id).sort();
    expect(leavers).toEqual(['user-51', STALE_ADMIN].sort());
    const bg = users.find((u) => u.jobTitle === 'Emergency Access')!;
    expect((ANCHOR - lastActive(bg)) / DAY).toBeLessThan(90);
    expect(rows(store, 'signInLogs').some((r) => r.userId === STALE_ADMIN)).toBe(false);
    expect(rows(store, 'signInLogs').every((r) => !['user-16', 'user-33', 'user-40'].includes(r.userId) || ANCHOR - Date.parse(r.createdDateTime) > 90 * DAY)).toBe(true);
  });

  it("the harness's offboard_upn discoverer (enabled, leave date passed, oldest first) picks the stale admin", async () => {
    const page = asList(await table.resolveUri('GET', '/v1.0/users', undefined));
    const pick = page
      .filter((u) => u.accountEnabled === true && typeof u.employeeLeaveDateTime === 'string' && Date.parse(u.employeeLeaveDateTime) <= ANCHOR)
      .sort((a, b) => String(a.employeeLeaveDateTime).localeCompare(String(b.employeeLeaveDateTime)) || String(a.userPrincipalName).localeCompare(String(b.userPrincipalName)))[0];
    expect(pick.id).toBe(STALE_ADMIN);
  });

  it('3 standing Global Administrators (the licensed owner, the operator, the emergency account), a standing Security Administrator, no PIM', () => {
    const ra = rows(store, 'roleAssignments');
    expect(ra.filter((r) => r.roleDefinitionId === GA).map((r) => r.principalId).sort()).toEqual(['user-1', 'user-58', 'user-60']);
    expect(ra.filter((r) => r.roleDefinitionId !== GA).map((r) => r.principalId)).toEqual([STALE_ADMIN]);
    const owner = rows(store, 'users').find((u) => u.id === 'user-1')!;
    expect(owner.assignedLicenses.length).toBe(2);
    expect(rows(store, 'roleEligibilitySchedules')).toEqual([]);
    expect(rows(store, 'roleAssignmentScheduleRequests')).toEqual([]);
    expect(rows(store, 'accessReviewDefinitions')).toEqual([]);
    for (const p of rows(store, 'roleManagementPolicies')) {
      const approval = p.rules.find((r: Row) => r.id === 'Approval_EndUser_Assignment');
      expect(approval.setting.isApprovalRequired).toBe(false);
    }
    expect(rows(store, 'directoryRoleMember').filter((m) => m.directoryRoleId === rows(store, 'directoryRole').find((r) => r.roleTemplateId === GA)!.id)).toHaveLength(3);
  });

  it('2 report-only MFA CA policies excluding nobody; no legacy-authentication block; legacy and single-factor sign-ins', () => {
    const ca = rows(store, 'caPolicies');
    expect(ca.map((p) => p.displayName).sort()).toEqual(['S3-CA01 Require MFA - all users', 'S3-CA02 Require MFA - administrators']);
    for (const p of ca) {
      expect(p.state).toBe('enabledForReportingButNotEnforced');
      expect(p.conditions.users.excludeUsers).toEqual([]);
      expect(p.conditions.users.excludeGroups).toEqual([]);
      expect(p.grantControls.builtInControls).toEqual(['mfa']);
      expect(p.conditions.clientAppTypes ?? []).not.toContain('exchangeActiveSync');
    }
    const s = rows(store, 'signInLogs');
    expect(s.every((r) => r.conditionalAccessStatus === 'notApplied')).toBe(true);
    expect(s.filter((r) => ['Exchange ActiveSync', 'IMAP4'].includes(r.clientAppUsed)).length).toBeGreaterThan(20);
    expect(s.filter((r) => r.authenticationRequirement === 'singleFactorAuthentication').length).toBeGreaterThan(200);
  });

  it('MFA: Authenticator and FIDO2 disabled (SMS and voice only); 33 accounts without MFA registration', async () => {
    const cfg = Object.fromEntries(rows(store, 'authenticationMethodsPolicyConfigurations').map((c) => [c.id, c.state]));
    expect(cfg).toMatchObject({ MicrosoftAuthenticator: 'disabled', Fido2: 'disabled', Sms: 'enabled', Voice: 'enabled' });
    const one = asList(await table.resolveUri('GET', '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/MicrosoftAuthenticator', undefined))[0];
    expect(one.state).toBe('disabled');
    const reg = rows(store, 'authenticationMethodUserRegistrationDetails');
    expect(reg).toHaveLength(60);
    expect(reg.filter((r) => r.isMfaRegistered === false)).toHaveLength(33);
    expect(rows(store, 'authMethods').some((m) => ['microsoftAuthenticator', 'fido2', 'softwareOath'].includes(m.methodType))).toBe(false);
  });

  it('34 Windows devices (28 compliant, 3 unencrypted); 41 CVEs with 9 critical unremediated, one per listed device', () => {
    const md = rows(store, 'managedDevices');
    expect(md).toHaveLength(34);
    expect(md.every((d) => d.operatingSystem === 'Windows')).toBe(true);
    expect(md.filter((d) => d.complianceState === 'compliant')).toHaveLength(28);
    expect(md.filter((d) => d.isEncrypted === false)).toHaveLength(3);
    const v = rows(store, 'vulnerabilities');
    expect(v).toHaveLength(41);
    const crit = v.filter((x) => x.severity === 'critical');
    expect(crit).toHaveLength(9);
    expect(crit.every((x) => x.remediated === false && x.remediatedDateTime === null)).toBe(true);
    const c = JSON.parse(readFileSync(CUSTOMER_PATH, 'utf8')) as { devices: { critical_cve_devices: string[] } };
    const critDevices = rows(store, 'tvmSoftwareVulnerabilities').filter((r) => r.VulnerabilitySeverityLevel === 'Critical').map((r) => r.DeviceName).sort();
    expect(critDevices).toEqual([...c.devices.critical_cve_devices].sort());
    expect(rows(store, 'tvmSoftwareVulnerabilities').filter((r) => r.VulnerabilitySeverityLevel === 'Critical').every((r) => r.CveMitigationStatus === '')).toBe(true);
  });

  it('Intune: one Windows compliance policy, unassigned; Defender AV unassigned; no removable-storage, settings-catalog or app-protection policy', async () => {
    const compliance = asList(await table.resolveUri('GET', '/v1.0/deviceManagement/deviceCompliancePolicies?$expand=assignments', undefined));
    expect(compliance).toHaveLength(1);
    expect(compliance[0].assignments).toEqual([]);
    const configs = asList(await table.resolveUri('GET', '/v1.0/deviceManagement/deviceConfigurations?$expand=assignments', undefined));
    expect(configs.map((c) => c.displayName).sort()).toEqual(['S3-DEF-CORP Wi-Fi', 'S3-Defender-AV']);
    expect(configs.find((c) => c.displayName === 'S3-Defender-AV')!.assignments).toEqual([]);
    expect(rows(store, 'deviceManagementConfigurationPolicies')).toEqual([]);
    expect(rows(store, 'iosManagedAppProtections')).toEqual([]);
  });

  it('data protection: no DLP, no sensitivity label; the program drawings site shared to anyone', async () => {
    for (const c of ['dlpPolicies', 'dlpCompliancePolicy', 'label', 'labelPolicy', 'policyLabels', 'sensitivityLabels']) expect(rows(store, c), c).toEqual([]);
    expect(asList(await table.resolveCmdlet('Get-Label', []))).toEqual([]);
    expect(asList(await table.resolveCmdlet('Get-DlpCompliancePolicy', []))).toEqual([]);
    const site = rows(store, 'spoSites')[0];
    expect(site).toMatchObject({ Url: `https://${SLUG}.sharepoint.us/sites/program-drawings`, SharingCapability: 'ExternalUserAndGuestSharing', DefaultSharingLinkType: 'AnonymousAccess', SensitivityLabel: null });
    expect(rows(store, 'unifiedAuditLog').some((r) => r.Operations === 'AnonymousLinkCreated')).toBe(true);
  });

  it('security operations: 2 alerts new and unassigned for 20 days in 2 active incidents; training missing; no lifecycle workflows', () => {
    const alerts = rows(store, 'alerts');
    expect(alerts).toHaveLength(2);
    for (const a of alerts) {
      expect(a).toMatchObject({ status: 'new', assignedTo: null });
      expect(Math.floor((ANCHOR - Date.parse(a.createdDateTime)) / DAY)).toBe(20);
    }
    expect(rows(store, 'securityIncidents').every((i) => i.status === 'active' && i.assignedTo === null)).toBe(true);
    const training = rows(store, 'trainingUserCoverage');
    expect(training).toHaveLength(56);
    const current = training.filter((t) => t.userTrainings.some((x: Row) => x.trainingStatus === 'completed' && ANCHOR - Date.parse(x.completionDateTime) < 365 * DAY));
    expect(current).toHaveLength(0);
    expect(rows(store, 'lifecycleWorkflows')).toEqual([]);
  });

  it('no Azure resource is seeded (stance m365_azure kept), and the reads answer empty', async () => {
    for (const c of ['vnets', 'nsgs', 'keyVaults', 'keyVaultKeys', 'keyVaultCertificates', 'logAnalyticsWorkspaces', 'armResources', 'backupJobs', 'azRoleAssignments', 'actionGroup', 'storageAccounts', 'automationAccounts', 'managedIdentities', 'firewalls']) {
      expect(rows(store, c), c).toEqual([]);
    }
    expect(asList(await table.resolveCmdlet('Get-AzVM', []))).toEqual([]);
    expect(asList(await table.resolveCmdlet('Get-AzKeyVault', []))).toEqual([]);
  });

  it('licensing: G3 (GCC High) plus the E5 Security add-on', async () => {
    const skus = asList(await table.resolveUri('GET', '/v1.0/subscribedSkus', undefined));
    expect(skus.map((s) => s.skuPartNumber).sort()).toEqual(['SIM_M365_E5_SECURITY_GCCHIGH', 'SIM_M365_G3_GCCHIGH']);
  });

  it('E6X: the tester injection (PATCH /v1.0/users/user-59 accountEnabled true) re-enables the stale admin after a disable; the A-02 confirm read selects it by UPN', async () => {
    const copy = path.join(dir, 'e6x');
    await fs.mkdir(copy, { recursive: true });
    await fs.copyFile(path.join(dir, 'tenant', 'store.json'), path.join(copy, 'store.json'));
    const t = new ResolverTable(new ObjectStore(path.join(copy, 'store.json')), new StackShapeGate('m365_azure'));
    const upn = rows(store, 'users').find((u) => u.id === STALE_ADMIN)!.userPrincipalName;
    await t.resolveUri('PATCH', `/v1.0/users/${STALE_ADMIN}`, { accountEnabled: false }); // what Stamper's disable-inactive does at E6
    await t.resolveUri('PATCH', `/v1.0/users/${STALE_ADMIN}`, { accountEnabled: true }); // the E6X injection
    const after = asList(await t.resolveUri('GET', '/v1.0/users', undefined)).find((u) => u.userPrincipalName === upn)!;
    expect(after.accountEnabled).toBe(true);
    await t.resolveUri('PATCH', `/v1.0/users/${STALE_ADMIN}`, { accountEnabled: false }); // AO A-02 at E7A
    expect(asList(await t.resolveUri('GET', '/v1.0/users', undefined)).find((u) => u.userPrincipalName === upn)!.accountEnabled).toBe(false);
  });

  it('every collection the S1 history seeds exists on S3 (empty where S3 lacks the object)', () => {
    const s1 = buildCustomerHistorySeed(ANCHOR, JSON.parse(readFileSync(path.join(SIM_ROOT, 'scenarios', 's1-mach.json'), 'utf8')).seedContext['customer-history']);
    const s3 = buildCustomerHistoryS3Seed(ANCHOR, scenario.seedContext![SET]);
    for (const k of Object.keys(s1.add)) expect(Object.keys(s3.add), k).toContain(k);
    for (const k of Object.keys(s1.enrich)) expect(Object.keys(s3.enrich), k).toContain(k);
  });

  it('every read S1 or S2 answers, S3 answers (URIs EO, Muster and Stamper send; cmdlets Stamper and EO send)', async () => {
    const uris = [
      '/v1.0/organization', '/v1.0/subscribedSkus', '/v1.0/me', '/v1.0/users?$select=id,userPrincipalName,onPremisesSyncEnabled', '/v1.0/groups',
      '/v1.0/identity/conditionalAccess/policies', '/v1.0/identity/conditionalAccess/namedLocations', '/v1.0/identity/conditionalAccess/authenticationStrength/policies',
      '/v1.0/roleManagement/directory/roleAssignments', '/v1.0/roleManagement/directory/roleEligibilitySchedules', '/v1.0/directoryRoles?$expand=members',
      '/v1.0/deviceManagement/managedDevices', '/v1.0/deviceManagement/deviceConfigurations?$expand=assignments', '/v1.0/deviceManagement/deviceCompliancePolicies?$expand=assignments',
      '/beta/deviceManagement/configurationPolicies?$expand=settings,assignments', '/beta/deviceManagement/templates', '/beta/deviceManagement/remoteActionAudits', '/beta/deviceManagement/windowsMalwareInformation',
      '/v1.0/deviceAppManagement/iosManagedAppProtections?$expand=assignments', '/v1.0/deviceAppManagement/androidManagedAppProtections?$expand=assignments',
      '/v1.0/domains', '/v1.0/groupSettings', '/v1.0/identityGovernance/accessReviews/definitions', '/v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks',
      '/v1.0/identityGovernance/termsOfUse/agreements', '/v1.0/reports/security/getAttackSimulationTrainingUserCoverage', '/v1.0/admin/serviceAnnouncement/messages',
      '/v1.0/sites?search=*&$select=id,webUrl,displayName', '/v1.0/policies/authenticationMethodsPolicy', '/v1.0/reports/authenticationMethods/userRegistrationDetails',
      '/v1.0/security/alerts_v2', '/v1.0/security/incidents', '/v1.0/identityProtection/riskDetections', '/v1.0/auditLogs/signIns', '/v1.0/auditLogs/directoryAudits',
      '/v1.0/directory/deletedItems/microsoft.graph.user', '/v1.0/security/secureScores', '/v1.0/security/secureScoreControlProfiles',
    ];
    const cmdlets: Array<[string, string[]]> = [
      ['Get-MgDirectoryRole', []], ['Get-MgDeviceManagementAuditEvent', ['-All']], ['Get-MgOrganizationBranding', ['-OrganizationId', 'x']],
      ['Get-SafeLinksPolicy', []], ['Get-SafeLinksRule', []], ['Get-DkimSigningConfig', []], ['Get-InsiderRiskPolicy', []], ['Get-ProtectionAlert', []],
      ['Get-Label', []], ['Get-LabelPolicy', []], ['Get-DlpCompliancePolicy', []], ['Get-AzKeyVault', []], ['Get-AzActionGroup', []], ['Get-AzVM', []],
      ['Get-AzSentinelIncident', ['-ResourceGroupName', 'rg', '-WorkspaceName', 'ws']], ['Get-MgDeviceAppManagementIosManagedAppProtection', ['-All']], ['Get-MgDeviceAppManagementAndroidManagedAppProtection', ['-All']], ['Get-AzRoleAssignment', []],
      ['Get-MgUser', ['-All']], ['Get-MgRoleManagementDirectoryRoleEligibilitySchedule', ['-All']], ['Get-SPOSite', []],
    ];
    const answered: string[] = [];
    const failedOnS3: string[] = [];
    const either = async (f: (t: ResolverTable) => Promise<unknown>) => { for (const t of [s1Table, s2Table]) { try { await f(t); return true; } catch { /* next */ } } return false; };
    for (const u of uris) {
      if (!(await either((t) => t.resolveUri('GET', u, undefined)))) continue;
      answered.push(u);
      try { await table.resolveUri('GET', u, undefined); } catch (e) { failedOnS3.push(`${u}: ${String(e)}`); }
    }
    for (const [c, args] of cmdlets) {
      if (!(await either((t) => t.resolveCmdlet(c, args)))) continue;
      answered.push(c);
      try { await table.resolveCmdlet(c, args); } catch (e) { failedOnS3.push(`${c}: ${String(e)}`); }
    }
    expect(answered.length).toBeGreaterThan(40);
    expect(failedOnS3).toEqual([]);
  });

  it('no S1 or S2 fiction survives in the S3 store (ids, names, city, software and documents)', () => {
    const text = JSON.stringify(store.collections);
    expect(text).not.toMatch(/\bS1\b|S1[-:]|s1h-|-s1-|51510000|Fennick|Quarrystone|Hollinford|CNC|[Kk]iosk|[Mm]achinist|[Mm]achining|cam-suite|cmm-|s1-mach|\bS2\b|S2[-:]|52520000|s2-eng|Wrenmoor|Tamberlow|198\.51\.100\.20\b/);
  });

  it('two builds with the same anchor produce the same store (only the live directory-audit trail differs)', async () => {
    const a = await buildFixed(path.join(dir, 'a'), scenario);
    const b = await buildFixed(path.join(dir, 'b'), scenario);
    const strip = (s: Store) => {
      const { directoryAudits, ...rest } = s.collections;
      return { ...rest, directoryAudits: Object.fromEntries(Object.entries(directoryAudits ?? {}).filter(([k]) => k.startsWith('s3h-'))) };
    };
    expect(strip(a)).toEqual(strip(b));
    const ctx = scenario.seedContext![SET];
    expect(JSON.stringify(buildCustomerHistoryS3Seed(ANCHOR, ctx))).toBe(JSON.stringify(buildCustomerHistoryS3Seed(ANCHOR, ctx)));
  }, 90_000);

  describe('synthetic-identity scan (V49 rules, as the S1 suite)', () => {
    const tokens: RegExp[] = [];
    if (existsSync(SCAN_TOKENS)) {
      for (const raw of readFileSync(SCAN_TOKENS, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const ci = line.startsWith('(?i)');
        tokens.push(new RegExp(ci ? line.slice(4) : line, ci ? 'i' : ''));
      }
    }
    for (const t of ['Blue\\s*Heron', '\\bBHD\\b', 'aavya']) tokens.push(new RegExp(t, 'i'));
    const ALLOWED_GUIDS = [
      /^53530000-[0-9a-f]{4}-4000-8000-[0-9a-f]{12}$/, // the S3 sim family
      /^62e90394-69f5-4237-9190-012177145e10$/, // Global Administrator template (platform constant)
      /^194ae4cb-b126-40b2-bd5b-6091b380977d$/, // Security Administrator
      /^17315797-102d-40b4-93e0-432062caca18$/, // Compliance Administrator
      /^5cf42378-d67d-4f36-ba46-e8b86229381d$/, // directory setting template "Password Rule Settings"
      /^1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950$/, // lifecycle-workflow built-in task "Disable user account"
    ];
    const scanText = (rel: string, text: string, guids: boolean): string[] => {
      const offenders: string[] = [];
      for (const rx of tokens) if (rx.test(text)) offenders.push(`${rel}: denylist ${rx}`);
      for (const m of text.matchAll(/[A-Za-z0-9._%+{}-]+@([A-Za-z0-9.{}-]+\.[A-Za-z]{2,})/g)) if (m[1] !== DOMAIN) offenders.push(`${rel}: address ${m[0]}`);
      for (const m of text.matchAll(/[A-Za-z0-9-]+\.onmicrosoft\.(com|us)/g)) {
        if (m[0] !== DOMAIN && m[0] !== 'simtenant.onmicrosoft.us') offenders.push(`${rel}: tenant domain ${m[0]}`);
      }
      for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
        if (![`${SLUG}.sharepoint.us`, 'security.microsoft.us'].includes(m[1])) offenders.push(`${rel}: host ${m[1]}`);
      }
      if (/(?<![A-Za-z])[A-Za-z]:[\\/]|\\\\[A-Za-z]|[\\/]Users[\\/]|[\\/]home[\\/]/.test(text)) offenders.push(`${rel}: workstation-path pattern`);
      if (guids) {
        for (const m of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) {
          if (!ALLOWED_GUIDS.some((rx) => rx.test(m[0]))) offenders.push(`${rel}: guid ${m[0]}`);
        }
      }
      return offenders;
    };

    it('the scan tokens file is present (V49 input)', () => {
      expect(tokens.length).toBeGreaterThan(4);
    });

    it('customer.json, the config, the generated scenario and the seed output hold synthetic identifiers only', () => {
      const files = [CONFIG_PATH, SCENARIO_PATH, ...(haveCustomer ? [CUSTOMER_PATH] : [])];
      const offenders = files.flatMap((f) => scanText(path.relative(SIM_ROOT, f), readFileSync(f, 'utf8'), true));
      offenders.push(...scanText(SET, JSON.stringify(buildCustomerHistoryS3Seed(ANCHOR, scenario.seedContext![SET])), true));
      expect(offenders.slice(0, 20)).toEqual([]);
    });

    it('the built S3 store holds no denylisted token and no foreign address or tenant domain', () => {
      expect(scanText('store.json', JSON.stringify(store), false).slice(0, 20)).toEqual([]);
    });

    it.skipIf(!haveCustomer)('organisation ids follow the §2 synthetic patterns and names come from S3’s own invented pools', async () => {
      const c = JSON.parse(readFileSync(CUSTOMER_PATH, 'utf8')) as {
        organization: { legal_name: string; uei: string; cage: string; phone: string; address: { zip: string }; domain: string };
        accounts: Array<{ kind: string; display_name: string; shared?: boolean }>;
      };
      expect(c.organization.legal_name).toMatch(/\(FICTIONAL\)$/);
      expect(c.organization.uei).toMatch(/^SIMX[A-Z0-9]{8}$/);
      expect(c.organization.cage).toMatch(/^9S[A-Z0-9]{3}$/);
      expect(c.organization.phone).toMatch(/^\+1-555-01\d\d$/);
      expect(c.organization.address.zip).toBe('00000');
      expect(c.organization.domain).toBe(DOMAIN);
      const gen = (await import(pathToFileURL(CUSTOMER_GEN).href)) as { FIRST: string[]; SUR_A: string[]; SUR_B: string[] };
      const s1 = (await import(pathToFileURL(path.join(path.dirname(CUSTOMER_GEN), '..', 's1-mach', 'gen-customer.mjs')).href)) as { FIRST: string[] };
      const s2 = (await import(pathToFileURL(path.join(path.dirname(CUSTOMER_GEN), '..', 's2-eng', 'gen-customer.mjs')).href)) as { FIRST: string[] };
      expect(gen.FIRST.filter((f) => s1.FIRST.includes(f) || s2.FIRST.includes(f))).toEqual([]);
      const surnames = new Set(gen.SUR_A.flatMap((a) => gen.SUR_B.map((b) => a + b)));
      for (const a of c.accounts.filter((x) => (x.kind === 'staff' && !x.shared) || x.kind === 'admin')) {
        const [first, last] = a.display_name.replace(/ \(Admin\)$/, '').split(' ');
        expect(gen.FIRST, a.display_name).toContain(first);
        expect(surnames.has(last), a.display_name).toBe(true);
      }
    });
  });
});
