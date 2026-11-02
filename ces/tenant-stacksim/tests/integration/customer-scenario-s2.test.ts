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
import { buildCustomerHistoryS2Seed } from '../../src/seed/sets/customerHistoryS2.js';
// @ts-expect-error plain-JS generator script (no type declarations)
import { buildCustomerScenario, loadCustomerConfig, loadCustomer } from '../../scripts/build-customer-scenario.mjs';

/**
 * synthetic-customer W6 (2026-10-28): the synthetic customer S2 `s2-eng`
 * (engineering services, hybrid identity, no Sentinel).
 *  - drift guard: scenarios/s2-eng.json = build(config + customer.json), and
 *    customer.json = its own generator's output;
 *  - the S2 inventory (roster, hybrid flags, groups, devices, CA, MAM);
 *  - what S2 lacks is empty, never an error: every read S1 answers, S2 answers;
 *  - no S1 fiction survives the rewrite; determinism; the identity scan.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const SLUG = 's2-eng';
const SET = 'customer-history-s2';
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

describe('synthetic customer S2 (s2-eng)', () => {
  let dir: string;
  let scenario: ScenarioFile;
  let store: Store;
  let table: ResolverTable;
  let s1Table: ResolverTable;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-s2-'));
    scenario = await loadScenario(SCENARIO_PATH);
    store = await buildFixed(path.join(dir, 'tenant'), scenario);
    table = new ResolverTable(new ObjectStore(path.join(dir, 'tenant', 'store.json')), new StackShapeGate('m365_azure'));
    await buildFixed(path.join(dir, 's1'), await loadScenario(path.join(SIM_ROOT, 'scenarios', 's1-mach.json')));
    s1Table = new ResolverTable(new ObjectStore(path.join(dir, 's1', 'store.json')), new StackShapeGate('m365_azure'));
  }, 90_000);

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

  it('seeds the S2 roster: 35 accounts, 26 synced from on-premises AD, the rest cloud-only; 1 joiner, 1 leaver still enabled', () => {
    const users = rows(store, 'users');
    expect(users).toHaveLength(35);
    expect(users.every((u) => String(u.userPrincipalName).endsWith(`@${DOMAIN}`))).toBe(true);
    expect(users.some((u) => String(u.displayName).startsWith('Sim User'))).toBe(false);
    const synced = users.filter((u) => u.onPremisesSyncEnabled === true);
    expect(synced).toHaveLength(26);
    for (const u of synced) {
      expect(Buffer.from(String(u.onPremisesImmutableId), 'base64')).toHaveLength(16);
      expect(u.onPremisesDomainName).toBe('corp.s2-eng.sim');
      expect(String(u.onPremisesSecurityIdentifier)).toMatch(/^S-1-5-21-\d+-\d+-\d+-\d+$/);
      expect(u.onPremisesUserPrincipalName).toBe(u.userPrincipalName);
      expect(Date.parse(String(u.onPremisesLastSyncDateTime))).toBeGreaterThan(ANCHOR - DAY);
      expect(u.passwordPolicies).toBe('DisablePasswordExpiration');
    }
    const cloud = users.filter((u) => u.onPremisesSyncEnabled !== true);
    expect(cloud).toHaveLength(9);
    expect(cloud.every((u) => u.onPremisesSyncEnabled === null && u.onPremisesImmutableId === undefined)).toBe(true);
    expect(cloud.filter((u) => String(u.userPrincipalName).startsWith('adm-'))).toHaveLength(3);
    expect(cloud.filter((u) => u.employeeType === 'Contractor')).toHaveLength(3);
    const leavers = users.filter((u) => u.employeeLeaveDateTime);
    expect(leavers).toHaveLength(1);
    expect(leavers[0]).toMatchObject({ accountEnabled: true, employeeType: 'Contractor', onPremisesSyncEnabled: null });
    expect(users.filter((u) => u.employeeHireDate)).toHaveLength(1);
    expect(users.filter((u) => u.accountEnabled === false)).toHaveLength(0);
    const org = rows(store, 'organization')[0];
    expect(org).toMatchObject({ id: 'sim-tenant-s2-eng', displayName: 'Tamberlow Systems Engineering LLC (FICTIONAL)', onPremisesSyncEnabled: true });
    expect(Date.parse(String(org.onPremisesLastPasswordSyncDateTime))).toBeGreaterThan(ANCHOR - DAY);
    expect(rows(store, 'deletedUsers').every((d) => d.onPremisesSyncEnabled === true && String(d.userPrincipalName).endsWith(`@${DOMAIN}`))).toBe(true);
  });

  it("Muster's harvest read sees directory sync (TCP.IA.005 yes) through the resolver", async () => {
    const page = asList(await table.resolveUri('GET', '/v1.0/users?$select=id,userPrincipalName,onPremisesSyncEnabled', undefined));
    expect(page).toHaveLength(35);
    expect(page.some((u) => u.onPremisesSyncEnabled === true)).toBe(true);
  });

  it('seeds the groups, devices (Windows, company iOS, personal Android) and 3 enforced CA policies excluding break-glass', () => {
    const groups = rows(store, 'groups');
    expect(groups).toHaveLength(12);
    const cui = groups.find((g) => g.displayName === 'CUI-Authorized-Users')!;
    expect(rows(store, 'groupMember').filter((m) => m.groupId === cui.id)).toHaveLength(12);
    expect(groups.find((g) => g.id === 'group-12')!.displayName).toBe('S2-Break-Glass');

    const md = rows(store, 'managedDevices');
    expect(md).toHaveLength(42);
    expect(md.filter((d) => d.operatingSystem === 'Windows')).toHaveLength(30);
    expect(md.filter((d) => d.operatingSystem === 'iOS')).toHaveLength(6);
    const droid = md.filter((d) => d.operatingSystem === 'Android');
    expect(droid).toHaveLength(6);
    expect(droid.every((d) => d.managedDeviceOwnerType === 'personal' && /^S2-ADR-\d\d$/.test(String(d.deviceName)) && d.lastTvmAssessed === undefined)).toBe(true);
    expect(md.filter((d) => d.complianceState === 'compliant')).toHaveLength(39);
    expect(rows(store, 'devices').filter((d) => d.operatingSystem === 'Android').every((d) => d.trustType === 'Workplace')).toBe(true);
    expect(rows(store, 'windowsProtectionStates')).toHaveLength(30);

    const ca = rows(store, 'caPolicies');
    expect(ca.map((p) => p.displayName).sort()).toEqual(['S2-CA01 Require MFA - all users', 'S2-CA02 Block legacy authentication', 'S2-CA03 Require MFA - admin roles']);
    const bg = rows(store, 'users').filter((u) => u.jobTitle === 'Emergency Access (Break Glass)').map((u) => u.id);
    for (const p of ca) {
      expect(p.state).toBe('enabled');
      expect(p.conditions.users.excludeUsers).toEqual(bg);
      expect(p.conditions.users.excludeGroups).toEqual(['group-12']);
      expect(p.sessionControls ?? null).toBeNull();
    }
    expect(ca.find((p) => p.displayName.startsWith('S2-CA03'))!.grantControls.authenticationStrength).toBeUndefined();
    expect(rows(store, 'roleAssignments').map((r) => r.principalId).sort()).toEqual([...bg].sort());
    expect(new Set(rows(store, 'roleEligibilitySchedules').map((e) => e.roleDefinitionId)).size).toBe(6);
    // Directory audits of CA changes name S2's own policies.
    const caTargets = rows(store, 'directoryAudits').filter((r) => String(r.id).startsWith('s2h-')).flatMap((r) => r.targetResources).filter((t: Row) => t.type === 'Policy');
    expect(caTargets.length).toBeGreaterThan(0);
    expect(caTargets.every((t: Row) => ['caPolicy-1', 'caPolicy-2', 'caPolicy-3'].includes(t.id))).toBe(true);
  });

  it('app protection (MAM): iOS and Android policies on the tenant object ids, assigned, backup still allowed (the B-09 gap)', async () => {
    const ios = asList(await table.resolveUri('GET', '/v1.0/deviceAppManagement/iosManagedAppProtections?$expand=assignments', undefined));
    const droid = asList(await table.resolveUri('GET', '/v1.0/deviceAppManagement/androidManagedAppProtections?$expand=assignments', undefined));
    expect(ios.map((p) => p.id)).toEqual(['iosManagedAppProtection-1']);
    expect(droid.map((p) => p.id)).toEqual(['androidManagedAppProtection-1']);
    for (const p of [...ios, ...droid]) {
      expect(p.isAssigned).toBe(true);
      expect(p.assignments.map((a: Row) => a.target.groupId).sort()).toEqual(['group-1', 'group-10']);
      expect(p).toMatchObject({ dataBackupBlocked: false, saveAsBlocked: false, pinRequired: true });
    }
    const compliance = asList(await table.resolveUri('GET', '/v1.0/deviceManagement/deviceCompliancePolicies?$expand=assignments', undefined));
    expect(compliance.map((p) => p.displayName)).toContain('S2 Android work profile compliance (BYOD)');
    expect(compliance.every((p) => p.assignments.length > 0)).toBe(true);
  });

  it('what S2 lacks is empty: no Sentinel incidents, no key vault, no action group; Defender XDR alerts and incidents present', async () => {
    expect(rows(store, 'sentinelIncident')).toEqual([]);
    expect(rows(store, 'keyVaults')).toEqual([]);
    expect(rows(store, 'azRoleAssignments')).toEqual([]);
    expect(rows(store, 'actionGroup')).toEqual([]);
    expect(rows(store, 'armResources').some((r) => r.type === 'Microsoft.KeyVault/vaults')).toBe(false);
    expect(asList(await table.resolveCmdlet('Get-AzKeyVault', ['-ResourceGroupName', 'rg-s2-eng-prod']))).toEqual([]);
    expect(asList(await table.resolveCmdlet('Get-AzActionGroup', []))).toEqual([]);
    expect(rows(store, 'alerts')).toHaveLength(6);
    expect(rows(store, 'securityIncidents')).toHaveLength(2);
    expect(rows(store, 'logAnalyticsWorkspaces').map((w) => [w.name, w.sentinelEnabled])).toEqual([['law-s2-eng-prod', false]]);
    expect(rows(store, 'armResources').filter((r) => r.type === 'Microsoft.Compute/virtualMachines').map((r) => r.name)).toEqual(['vm-s2-sync-01', 'vm-s2-lic-01']);
  });

  it('every collection the S1 history seeds exists on S2 (empty where S2 lacks the object)', () => {
    const s1 = buildCustomerHistorySeed(ANCHOR, JSON.parse(readFileSync(path.join(SIM_ROOT, 'scenarios', 's1-mach.json'), 'utf8')).seedContext['customer-history']);
    const s2 = buildCustomerHistoryS2Seed(ANCHOR, scenario.seedContext![SET]);
    for (const k of Object.keys(s1.add)) expect(Object.keys(s2.add), k).toContain(k);
    for (const k of Object.keys(s1.enrich)) expect(Object.keys(s2.enrich), k).toContain(k);
  });

  it('every read S1 answers, S2 answers (URIs EO, Muster and Stamper send; cmdlets Stamper and EO send)', async () => {
    const uris = [
      '/v1.0/organization', '/v1.0/subscribedSkus', '/v1.0/me', '/v1.0/users?$select=id,userPrincipalName,onPremisesSyncEnabled', '/v1.0/groups',
      '/v1.0/identity/conditionalAccess/policies', '/v1.0/identity/conditionalAccess/namedLocations', '/v1.0/identity/conditionalAccess/authenticationStrength/policies',
      '/v1.0/roleManagement/directory/roleAssignments', '/v1.0/roleManagement/directory/roleEligibilitySchedules', '/v1.0/directoryRoles?$expand=members',
      '/v1.0/deviceManagement/managedDevices', '/v1.0/deviceManagement/deviceConfigurations?$expand=assignments', '/v1.0/deviceManagement/deviceCompliancePolicies?$expand=assignments',
      '/beta/deviceManagement/configurationPolicies?$expand=settings,assignments', '/beta/deviceManagement/templates', '/beta/deviceManagement/remoteActionAudits', '/beta/deviceManagement/windowsMalwareInformation',
      '/v1.0/deviceAppManagement/iosManagedAppProtections?$expand=assignments', '/v1.0/deviceAppManagement/androidManagedAppProtections?$expand=assignments',
      '/v1.0/domains', '/v1.0/groupSettings', '/v1.0/identityGovernance/accessReviews/definitions', '/v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks',
      '/v1.0/identityGovernance/termsOfUse/agreements', '/v1.0/reports/security/getAttackSimulationTrainingUserCoverage', '/v1.0/admin/serviceAnnouncement/messages',
      '/v1.0/sites?search=*&$select=id,webUrl,displayName', '/v1.0/policies/authenticationMethodsPolicy',
    ];
    const cmdlets: Array<[string, string[]]> = [
      ['Get-MgDirectoryRole', []], ['Get-MgDeviceManagementAuditEvent', ['-All']], ['Get-MgOrganizationBranding', ['-OrganizationId', 'x']],
      ['Get-SafeLinksPolicy', []], ['Get-SafeLinksRule', []], ['Get-DkimSigningConfig', []], ['Get-InsiderRiskPolicy', []], ['Get-ProtectionAlert', []],
      ['Get-Label', []], ['Get-LabelPolicy', []], ['Get-DlpCompliancePolicy', []], ['Get-AzKeyVault', []], ['Get-AzActionGroup', []], ['Get-AzVM', []],
      ['Get-AzSentinelIncident', ['-ResourceGroupName', 'rg', '-WorkspaceName', 'ws']], ['Get-MgDeviceAppManagementAndroidManagedAppProtection', ['-All']],
      ['Get-MgDeviceAppManagementIosManagedAppProtection', ['-All']], ['Get-AzRoleAssignment', []],
    ];
    const answered: string[] = [];
    const failedOnS2: string[] = [];
    for (const u of uris) {
      let s1ok = true;
      try { await s1Table.resolveUri('GET', u, undefined); } catch { s1ok = false; }
      if (!s1ok) continue;
      answered.push(u);
      try { await table.resolveUri('GET', u, undefined); } catch (e) { failedOnS2.push(`${u}: ${String(e)}`); }
    }
    for (const [c, args] of cmdlets) {
      let s1ok = true;
      try { await s1Table.resolveCmdlet(c, args); } catch { s1ok = false; }
      if (!s1ok) continue;
      answered.push(c);
      try { await table.resolveCmdlet(c, args); } catch (e) { failedOnS2.push(`${c}: ${String(e)}`); }
    }
    expect(answered.length).toBeGreaterThan(40);
    expect(failedOnS2).toEqual([]);
  });

  it('no S1 fiction survives in the S2 store (ids, names, city, machining software and documents)', () => {
    const text = JSON.stringify(store.collections);
    expect(text).not.toMatch(/\bS1\b|S1[-:]|s1h-|-s1-|51510000|Fennick|Quarrystone|Hollinford|CNC|[Kk]iosk|[Mm]achinist|[Mm]achining|cam-suite|cmm-|s1-mach/);
  });

  it('two builds with the same anchor produce the same store (only the live directory-audit trail differs)', async () => {
    const a = await buildFixed(path.join(dir, 'a'), scenario);
    const b = await buildFixed(path.join(dir, 'b'), scenario);
    const strip = (s: Store) => {
      const { directoryAudits, ...rest } = s.collections;
      return { ...rest, directoryAudits: Object.fromEntries(Object.entries(directoryAudits ?? {}).filter(([k]) => k.startsWith('s2h-'))) };
    };
    expect(strip(a)).toEqual(strip(b));
    const ctx = scenario.seedContext![SET];
    expect(JSON.stringify(buildCustomerHistoryS2Seed(ANCHOR, ctx))).toBe(JSON.stringify(buildCustomerHistoryS2Seed(ANCHOR, ctx)));
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
      /^52520000-[0-9a-f]{4}-4000-8000-[0-9a-f]{12}$/, // the S2 sim family
      /^62e90394-69f5-4237-9190-012177145e10$/, // Global Administrator template (platform constant)
      /^e8611ab8-c189-46e8-94e1-60213ab1f814$/, // Privileged Role Administrator
      /^194ae4cb-b126-40b2-bd5b-6091b380977d$/, // Security Administrator
      /^3a2c62db-5318-420d-8d74-23affee5d9d5$/, // Intune Administrator
      /^29232cdf-9323-42fd-ade2-1d097af3e4de$/, // Exchange Administrator
      /^17315797-102d-40b4-93e0-432062caca18$/, // Compliance Administrator
      /^00000000-0000-0000-0000-000000000004$/, // built-in phishing-resistant authentication strength
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

    // PL-123 / CR-14: the token list is BHD's private file (<WS>/nb-tools/scan-tokens.txt, identity tokens, not shipped).
    // Without it this one assertion is skipped with the reason in its name; the denylist, address, domain, host and
    // GUID scans below still run.
    const tokensNote = existsSync(SCAN_TOKENS) ? '' : ` [skipped: ${SCAN_TOKENS} is absent; it is BHD's private list and is not shipped]`;
    if (tokensNote) console.warn(`customer-scenario identity scan:${tokensNote}`);
    it.skipIf(!existsSync(SCAN_TOKENS))(`the scan tokens file is present (V49 input)${tokensNote}`, () => {
      expect(tokens.length).toBeGreaterThan(4);
    });

    it('customer.json, the config, the generated scenario and the seed output hold synthetic identifiers only', () => {
      const files = [CONFIG_PATH, SCENARIO_PATH, ...(haveCustomer ? [CUSTOMER_PATH] : [])];
      const offenders = files.flatMap((f) => scanText(path.relative(SIM_ROOT, f), readFileSync(f, 'utf8'), true));
      offenders.push(...scanText(SET, JSON.stringify(buildCustomerHistoryS2Seed(ANCHOR, scenario.seedContext![SET])), true));
      expect(offenders.slice(0, 20)).toEqual([]);
    });

    it('the built S2 store holds no denylisted token and no foreign address or tenant domain', () => {
      expect(scanText('store.json', JSON.stringify(store), false).slice(0, 20)).toEqual([]);
    });

    it.skipIf(!haveCustomer)('organisation ids follow the §2 synthetic patterns and names come from S2’s own invented pools', async () => {
      const c = JSON.parse(readFileSync(CUSTOMER_PATH, 'utf8')) as {
        organization: { legal_name: string; uei: string; cage: string; phone: string; address: { zip: string }; domain: string };
        accounts: Array<{ kind: string; display_name: string }>;
      };
      expect(c.organization.legal_name).toMatch(/\(FICTIONAL\)$/);
      expect(c.organization.uei).toMatch(/^SIMX[A-Z0-9]{8}$/);
      expect(c.organization.cage).toMatch(/^9S[A-Z0-9]{3}$/);
      expect(c.organization.phone).toMatch(/^\+1-555-01\d\d$/);
      expect(c.organization.address.zip).toBe('00000');
      expect(c.organization.domain).toBe(DOMAIN);
      const gen = (await import(pathToFileURL(CUSTOMER_GEN).href)) as { FIRST: string[]; SUR_A: string[]; SUR_B: string[] };
      const s1 = (await import(pathToFileURL(path.join(path.dirname(CUSTOMER_GEN), '..', 's1-mach', 'gen-customer.mjs')).href)) as { FIRST: string[] };
      expect(gen.FIRST.filter((f) => s1.FIRST.includes(f))).toEqual([]);
      const surnames = new Set(gen.SUR_A.flatMap((a) => gen.SUR_B.map((b) => a + b)));
      for (const a of c.accounts.filter((x) => x.kind === 'staff' || x.kind === 'admin')) {
        const [first, last] = a.display_name.replace(/ \(Admin\)$/, '').split(' ');
        expect(gen.FIRST, a.display_name).toContain(first);
        expect(surnames.has(last), a.display_name).toBe(true);
      }
    });
  });
});
