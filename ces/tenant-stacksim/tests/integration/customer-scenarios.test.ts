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
import { seedAnchorMs } from '../../src/seed/SeedEngine.js';
import { buildCustomerHistorySeed } from '../../src/seed/sets/customerHistory.js';
// @ts-expect-error plain-JS generator script (no type declarations)
import { buildCustomerScenario, loadCustomerConfig, loadCustomer } from '../../scripts/build-customer-scenario.mjs';

/**
 * synthetic-customer W0 (2026-10-28): the synthetic customer S1 `s1-mach`.
 *  - drift guard: scenarios/s1-mach.json = build(s1-mach.config.json + customer.json),
 *    and customer.json = its own generator's output;
 *  - the customer-history seed inventory (PLAN §2.1 S1 column);
 *  - determinism: two builds with the same anchor give the same store;
 *  - the clock anchor (day floor / STACKSIM_FIXED_NOW);
 *  - the synthetic-identity scan (generateFixtures.test.ts's rules, adapted to
 *    the §2 identity rules, plus <WS>\nb-tools\scan-tokens.txt and a
 *    real-entity denylist).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const SLUG = 's1-mach';
const SCENARIO_PATH = path.join(SIM_ROOT, 'scenarios', `${SLUG}.json`);
const CONFIG_PATH = path.join(SIM_ROOT, 'scenarios', `${SLUG}.config.json`);
const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { customer: string };
const CUSTOMER_PATH = path.resolve(SIM_ROOT, CONFIG.customer);
const CUSTOMER_GEN = path.join(path.dirname(CUSTOMER_PATH), 'gen-customer.mjs');
const SCAN_TOKENS = path.resolve(SIM_ROOT, '..', '..', 'nb-tools', 'scan-tokens.txt');
const haveCustomer = existsSync(CUSTOMER_PATH);
/** customer.json's history_anchor (a fixed fiction date); used as STACKSIM_FIXED_NOW. */
const ANCHOR_ISO = haveCustomer ? (JSON.parse(readFileSync(CUSTOMER_PATH, 'utf8')) as { history_anchor: string }).history_anchor : '2026-10-01T00:00:00.000Z';
const ANCHOR = Date.parse(ANCHOR_ISO);
const DAY = 86400000;

type Row = Record<string, unknown>;
type Store = { collections: Record<string, Record<string, Row>> };

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

describe('synthetic customer S1 (s1-mach)', () => {
  let dir: string;
  let scenario: ScenarioFile;
  let store: Store;
  let tenantRoot: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-s1-'));
    tenantRoot = path.join(dir, 'tenant');
    scenario = await loadScenario(SCENARIO_PATH);
    store = await buildFixed(tenantRoot, scenario);
  }, 180_000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!haveCustomer)('drift guard: the committed scenario matches its config + customer.json, and customer.json matches its generator', async () => {
    const cfg = loadCustomerConfig(SLUG);
    const generated = buildCustomerScenario(cfg, loadCustomer(cfg)) as unknown;
    const committed = JSON.parse(await fs.readFile(SCENARIO_PATH, 'utf8')) as unknown;
    expect(generated).toEqual(committed);
    const gen = (await import(pathToFileURL(CUSTOMER_GEN).href)) as { buildCustomer: () => unknown };
    expect(gen.buildCustomer()).toEqual(JSON.parse(readFileSync(CUSTOMER_PATH, 'utf8')));
  });

  it('builds on stance m365_azure with the customer-history set and references the customer file by path', () => {
    expect(scenario.stance).toBe('m365_azure');
    expect(scenario.seedSets).toEqual(['customer-history']);
    expect(CONFIG.customer).toBe(`../../pkg/ces-muster-run/customers/${SLUG}/customer.json`);
    expect(Object.keys(CONFIG)).not.toContain('accounts');
  });

  it('seeds the S1 roster, groups, devices and policies (PLAN §2.1)', () => {
    const users = rows(store, 'users');
    expect(users).toHaveLength(53);
    expect(users.some((u) => String(u.displayName).startsWith('Sim User'))).toBe(false);
    expect(users.every((u) => String(u.userPrincipalName).endsWith(`@${SLUG}.simtenant.onmicrosoft.us`))).toBe(true);
    const disabled = users.filter((u) => u.accountEnabled === false);
    expect(disabled).toHaveLength(1);
    const leavers = users.filter((u) => u.employeeLeaveDateTime);
    expect(leavers).toHaveLength(2);
    expect(leavers.filter((u) => u.accountEnabled === true)).toHaveLength(1);
    const joiners = users.filter((u) => u.employeeHireDate);
    expect(joiners).toHaveLength(1);
    expect(Date.parse(String(joiners[0].createdDateTime))).toBeGreaterThan(ANCHOR - 90 * DAY);

    const groups = rows(store, 'groups');
    expect(groups).toHaveLength(14);
    expect(groups.some((g) => String(g.displayName).startsWith('Sim Group'))).toBe(false);
    const cui = groups.find((g) => g.displayName === 'CUI-Authorized-Users')!;
    expect(rows(store, 'groupMember').filter((m) => m.groupId === cui.id)).toHaveLength(18);

    const md = rows(store, 'managedDevices');
    expect(md).toHaveLength(58);
    expect(md.filter((d) => d.operatingSystem === 'Windows')).toHaveLength(52);
    expect(md.filter((d) => d.operatingSystem === 'iOS')).toHaveLength(6);
    expect(md.filter((d) => d.complianceState === 'compliant')).toHaveLength(50);
    expect(md.filter((d) => String(d.deviceName).startsWith('S1-KIOSK-'))).toHaveLength(8);
    for (const d of md) {
      expect(Date.parse(String(d.lastSyncDateTime))).toBeGreaterThan(ANCHOR - 7 * DAY);
      if (d.operatingSystem === 'Windows') expect(Date.parse(String(d.lastTvmAssessed))).toBeGreaterThan(ANCHOR - 7 * DAY);
    }
    expect(rows(store, 'devices')).toHaveLength(58);

    const ca = rows(store, 'caPolicies');
    expect(ca).toHaveLength(9);
    const bgIds = users.filter((u) => u.jobTitle === 'Emergency Access (Break Glass)').map((u) => u.id);
    expect(bgIds).toHaveLength(2);
    for (const p of ca) {
      expect(p.state).toBe('enabled');
      expect(((p.conditions as Row).users as Row).excludeUsers).toEqual(bgIds);
    }
    // Permanent Global Administrator = break-glass only; 6 PIM-eligible roles
    // (the 5 from customer.json + Compliance Administrator for the ISSM's
    // admin account, W5c2 follow-up 6 SIM-A4).
    const ra = rows(store, 'roleAssignments');
    expect(ra.map((r) => r.principalId).sort()).toEqual([...bgIds].sort());
    const elig = rows(store, 'roleEligibilitySchedules');
    expect(new Set(elig.map((e) => e.roleDefinitionId)).size).toBe(6);
    expect(rows(store, 'dlpCompliancePolicy')).toHaveLength(3);
    expect(rows(store, 'dlpPolicies')).toHaveLength(3);
    expect(rows(store, 'label').map((l) => l.Name)).toEqual(['CUI']);
  });

  it('seeds the 90-day history in the B20 shapes (PLAN §2.1 S1 column)', () => {
    const within90 = (field: string, c: string) => {
      for (const r of rows(store, c)) {
        const t = Date.parse(String(r[field]));
        expect(t, `${c}.${field}`).toBeLessThanOrEqual(ANCHOR);
        expect(t, `${c}.${field}`).toBeGreaterThan(ANCHOR - 91 * DAY);
      }
    };
    expect(rows(store, 'unifiedAuditLog')).toHaveLength(240);
    within90('CreationDate', 'unifiedAuditLog');
    expect(new Set(rows(store, 'unifiedAuditLog').map((r) => JSON.parse(String(r.AuditData)).Workload))).toEqual(
      new Set(['Exchange', 'SharePoint', 'AzureActiveDirectory', 'MicrosoftTeams']),
    );
    expect(rows(store, 'signInLogs')).toHaveLength(900);
    within90('createdDateTime', 'signInLogs');
    const seededAudits = rows(store, 'directoryAudits').filter((r) => String(r.id).startsWith('s1h-diraudit-'));
    expect(seededAudits).toHaveLength(120);
    for (const r of seededAudits) expect(Date.parse(String(r.activityDateTime))).toBeGreaterThan(ANCHOR - 91 * DAY);
    expect(seededAudits.filter((r) => r.category === 'RoleManagement')).toHaveLength(2);

    const alerts = rows(store, 'alerts');
    expect(alerts).toHaveLength(6);
    expect(alerts.filter((a) => a.status === 'resolved')).toHaveLength(4);
    for (const a of alerts.filter((x) => x.status === 'resolved')) {
      expect(Date.parse(String(a.lastUpdateDateTime))).toBeGreaterThan(Date.parse(String(a.createdDateTime)));
    }
    const incidents = rows(store, 'securityIncidents');
    expect(incidents).toHaveLength(2);
    const sources = incidents.map((i) => new Set((i.alerts as Row[]).map((a) => a.serviceSource)).size).sort();
    expect(sources).toEqual([1, 2]);
    expect(rows(store, 'riskDetections')).toHaveLength(3);
    expect(rows(store, 'roleAssignmentScheduleRequests')).toHaveLength(2);

    const scores = rows(store, 'secureScores').sort((a, b) => String(a.createdDateTime).localeCompare(String(b.createdDateTime)));
    expect(scores).toHaveLength(90);
    expect(scores[0].currentScore).toBe(61);
    expect(scores[89].currentScore).toBe(72);
    for (const s of scores) expect((s.controlScores as Row[]).length).toBeGreaterThan(0);
    expect(rows(store, 'secureScoreControlProfiles').length).toBeGreaterThan(0);

    const tvm = rows(store, 'tvmSoftwareVulnerabilities');
    const cves = new Map<string, Row[]>();
    for (const r of tvm) cves.set(String(r.CveId), [...(cves.get(String(r.CveId)) ?? []), r]);
    expect(cves.size).toBe(34);
    expect([...cves.values()].filter((rs) => rs.every((r) => r.CveMitigationStatus === 'applied'))).toHaveLength(28);
    expect(rows(store, 'vulnerabilities')).toHaveLength(34);
  });

  it('serves per-CVE rows for DeviceTvmSoftwareVulnerabilities and keeps the recency rows for DeviceTvmInfoGathering', async () => {
    const table = new ResolverTable(new ObjectStore(path.join(tenantRoot, 'store.json')), new StackShapeGate('m365_azure'));
    const hunt = async (Query: string) => (await table.resolveUri('POST', '/v1.0/security/runHuntingQuery', { Query })) as { results: Row[] };
    const vul = await hunt('DeviceTvmSoftwareVulnerabilities | project DeviceId, CveId');
    expect(vul.results.length).toBe(rows(store, 'tvmSoftwareVulnerabilities').length);
    expect(vul.results.every((r) => /^CVE-2026-9\d{4}$/.test(String(r.CveId)))).toBe(true);
    const rec = await hunt('DeviceTvmInfoGathering | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName');
    expect(rec.results).toHaveLength(52);
    expect(rec.results[0]).toHaveProperty('LastAssessed');
  });

  it('builds the Azure Government facade with readable names (PLAN §2.2)', () => {
    const vnet = rows(store, 'vnets');
    expect(vnet).toHaveLength(1);
    expect(vnet[0].name).toBe('vnet-s1-mach-prod');
    expect((vnet[0].Subnets as Row[]).map((s) => s.AddressPrefix)).toEqual(['10.51.1.0/24', '10.51.2.0/24', '10.51.3.0/24']);
    expect(rows(store, 'nsgs').map((n) => n.name)).toEqual(['nsg-s1-workload']);
    expect(rows(store, 'keyVaults').map((n) => n.name)).toEqual(['kv-s1-mach-prod']);
    expect(rows(store, 'logAnalyticsWorkspaces').map((n) => n.name)).toEqual(['law-s1-mach-prod']);
    const arm = rows(store, 'armResources');
    expect(arm.filter((r) => r.type === 'Microsoft.Compute/virtualMachines')).toHaveLength(3);
    expect(arm.filter((r) => r.type === 'Microsoft.RecoveryServices/vaults').map((r) => r.name)).toEqual(['rsv-s1-mach-prod']);
    const sub = arm.find((r) => r.type === 'Microsoft.Resources/subscriptions')!;
    expect(String(sub.subscriptionId)).toMatch(/^51510000-00a2-4000-8000-[0-9a-f]{12}$/);
  });

  it('two builds with the same anchor produce the same store (only the live directory-audit trail differs)', async () => {
    const a = await buildFixed(path.join(dir, 'a'), scenario);
    const b = await buildFixed(path.join(dir, 'b'), scenario);
    const strip = (s: Store) => {
      const { directoryAudits, ...rest } = s.collections;
      const seeded = Object.fromEntries(Object.entries(directoryAudits ?? {}).filter(([k]) => k.startsWith('s1h-')));
      return { ...rest, directoryAudits: seeded };
    };
    expect(strip(a)).toEqual(strip(b));
    expect(Object.keys(a.collections.directoryAudits).length).toBe(Object.keys(b.collections.directoryAudits).length);
    const ctx = scenario.seedContext!['customer-history'];
    expect(JSON.stringify(buildCustomerHistorySeed(ANCHOR, ctx))).toBe(JSON.stringify(buildCustomerHistorySeed(ANCHOR, ctx)));
  }, 180_000);

  it('anchors seeded history to the UTC day floor, or to STACKSIM_FIXED_NOW', () => {
    expect(seedAnchorMs(Date.parse('2026-10-28T13:45:10.123Z'), {})).toBe(Date.parse('2026-10-28T00:00:00.000Z'));
    expect(seedAnchorMs(Date.parse('2026-10-28T13:45:10.123Z'), { STACKSIM_FIXED_NOW: ANCHOR_ISO })).toBe(ANCHOR);
    expect(() => seedAnchorMs(Date.now(), { STACKSIM_FIXED_NOW: 'not-a-date' })).toThrow(/STACKSIM_FIXED_NOW/);
    const s = rows(store, 'secureScores').map((r) => Date.parse(String(r.createdDateTime)));
    expect(Math.max(...s)).toBe(ANCHOR);
  });

  describe('synthetic-identity scan (V49 rules, adapted from ces-muster generateFixtures.test.ts)', () => {
    const tokens: RegExp[] = [];
    if (existsSync(SCAN_TOKENS)) {
      for (const raw of readFileSync(SCAN_TOKENS, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const ci = line.startsWith('(?i)');
        tokens.push(new RegExp(ci ? line.slice(4) : line, ci ? 'i' : ''));
      }
    }
    // Real-entity denylist (case-insensitive).
    for (const t of ['Blue\\s*Heron', '\\bBHD\\b', 'aavya']) tokens.push(new RegExp(t, 'i'));
    const ALLOWED_GUIDS = [
      /^51510000-[0-9a-f]{4}-4000-8000-[0-9a-f]{12}$/, // the S1 sim family
      /^62e90394-69f5-4237-9190-012177145e10$/, // Global Administrator template (platform constant)
      /^e8611ab8-c189-46e8-94e1-60213ab1f814$/, // Privileged Role Administrator
      /^194ae4cb-b126-40b2-bd5b-6091b380977d$/, // Security Administrator
      /^3a2c62db-5318-420d-8d74-23affee5d9d5$/, // Intune Administrator
      /^29232cdf-9323-42fd-ade2-1d097af3e4de$/, // Exchange Administrator
      /^17315797-102d-40b4-93e0-432062caca18$/, // Compliance Administrator (W5c2 follow-up 4)
      /^00000000-0000-0000-0000-000000000004$/, // built-in phishing-resistant authentication strength
      // synthetic-customer W5 cycle 1 (platform constants, customerHistory.ts):
      /^5cf42378-d67d-4f36-ba46-e8b86229381d$/, // directory setting template "Password Rule Settings"
      /^1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950$/, // lifecycle-workflow built-in task "Disable user account"
    ];

    const files = () => [CONFIG_PATH, SCENARIO_PATH, ...(haveCustomer ? [CUSTOMER_PATH] : [])];
    const scanText = (rel: string, text: string, guids: boolean): string[] => {
      const offenders: string[] = [];
      for (const rx of tokens) if (rx.test(text)) offenders.push(`${rel}: denylist ${rx}`);
      for (const m of text.matchAll(/[A-Za-z0-9._%+{}-]+@([A-Za-z0-9.{}-]+\.[A-Za-z]{2,})/g)) {
        if (m[1] !== `${SLUG}.simtenant.onmicrosoft.us`) offenders.push(`${rel}: address ${m[0]}`);
      }
      for (const m of text.matchAll(/[A-Za-z0-9-]+\.onmicrosoft\.(com|us)/g)) {
        // The sim's shared base tenant name (base seed organizationConfig) is allowed beside the slug domain.
        if (m[0] !== `${SLUG}.simtenant.onmicrosoft.us` && m[0] !== 'simtenant.onmicrosoft.us') offenders.push(`${rel}: tenant domain ${m[0]}`);
      }
      for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
        if (![`${SLUG}.sharepoint.us`, 'security.microsoft.us', 'kv-s1-mach-prod.vault.usgovcloudapi.net'].includes(m[1])) offenders.push(`${rel}: host ${m[1]}`);
      }
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

    it('customer.json, the config and the generated scenario hold synthetic identifiers only', () => {
      const offenders = files().flatMap((f) => scanText(path.relative(SIM_ROOT, f), readFileSync(f, 'utf8'), true));
      expect(offenders.slice(0, 20)).toEqual([]);
    });

    it('the customer-history seed output holds synthetic identifiers only', () => {
      const seed = buildCustomerHistorySeed(ANCHOR, scenario.seedContext!['customer-history']);
      expect(scanText('customer-history', JSON.stringify(seed), true).slice(0, 20)).toEqual([]);
    });

    it('W5c1: the scanned seed output includes the new collections (training, lifecycle, PIM rules, methods, settings, domains, compliance)', () => {
      const seed = buildCustomerHistorySeed(ANCHOR, scenario.seedContext!['customer-history']);
      const added = seed.add as Record<string, unknown[]>;
      for (const c of ['trainingUserCoverage', 'lifecycleWorkflows', 'roleManagementPolicies', 'policyRoleManagementPolicyAssignment', 'roleManagementDirectoryRoleDefinition', 'authMethods', 'directorySettings', 'domains', 'deviceCompliancePolicies']) {
        expect(added[c]?.length ?? 0, c).toBeGreaterThan(0);
        expect(scanText(c, JSON.stringify(added[c]), true).slice(0, 20), c).toEqual([]);
      }
      expect(scanText('enrich', JSON.stringify(seed.enrich), true).slice(0, 20)).toEqual([]);
      // Every training and workflow subject is a roster account (no invented person outside the roster).
      const ctx = scenario.seedContext!['customer-history'] as { accounts: Array<{ seedId: string }> };
      const ids = new Set<string>(ctx.accounts.map((a) => a.seedId));
      expect((added.trainingUserCoverage as Row[]).every((r) => ids.has(String((r.attackSimulationUser as Row).userId)))).toBe(true);
      expect((added.authMethods as Row[]).every((r) => ids.has(String(r.userId)))).toBe(true);
    });

    it('W5c1-b: the scanned seed output includes the SIM-row seeds (methods, labels, label policy, site, settings catalog, iOS app protection, cross-tenant and methods-policy enrich)', () => {
      const seed = buildCustomerHistorySeed(ANCHOR, scenario.seedContext!['customer-history']);
      const added = seed.add as Record<string, unknown[]>;
      for (const c of ['authenticationMethodsPolicyConfigurations', 'policyLabels', 'sensitivityLabels', 'label', 'labelPolicy', 'spoSites', 'deviceManagementConfigurationPolicies', 'iosManagedAppProtections', 'roleManagementPolicies', 'deviceCompliancePolicies']) {
        expect(added[c]?.length ?? 0, c).toBeGreaterThan(0);
        expect(scanText(c, JSON.stringify(added[c]), true).slice(0, 20), c).toEqual([]);
      }
      const enrich = seed.enrich as Record<string, Record<string, unknown>>;
      for (const c of ['authenticationMethodsPolicy', 'crossTenantAccessPolicy']) {
        expect(Object.keys(enrich[c] ?? {}).length, c).toBeGreaterThan(0);
        expect(scanText(c, JSON.stringify(enrich[c]), true).slice(0, 20), c).toEqual([]);
      }
      // Every person the new seeds name is a roster account: the label's rights holders, the PIM approvers, the site owner.
      const ctx = scenario.seedContext!['customer-history'] as { accounts: Array<{ seedId: string; upn: string }> };
      const upns = new Set<string>(ctx.accounts.map((a) => a.upn));
      const ids = new Set<string>(ctx.accounts.map((a) => a.seedId));
      const rights = String((added.label as Row[])[0].EncryptionRightsDefinitions).split(';').map((r) => r.split(':')[0]);
      expect(rights.length).toBeGreaterThan(0);
      expect(rights.every((u) => upns.has(u))).toBe(true);
      expect(upns.has(String((added.spoSites as Row[])[0].Owner))).toBe(true);
      const approvers = (added.roleManagementPolicies as Row[]).flatMap((p) => (p.rules as Row[]).flatMap((r) => (((r.setting as Row | undefined)?.approvalStages as Row[] | undefined) ?? []).flatMap((s) => (s.primaryApprovers as Row[]).map((a) => String(a.userId)))));
      expect(approvers.length).toBeGreaterThan(0);
      expect(approvers.every((a) => ids.has(a))).toBe(true);
      // No generic placeholder name survives in the replaced collections.
      expect(JSON.stringify(added)).not.toMatch(/Sim (Policy Label|Role Management Policy|Configuration Policy|Compliance Policy) \d/);
    });

    it('the built S1 store holds no denylisted token and no foreign address or tenant domain', () => {
      // Runtime directory-audit ids are random UUIDs, so the GUID rule applies to the seed output above, not here.
      expect(scanText('store.json', JSON.stringify(store), false).slice(0, 20)).toEqual([]);
    });

    it.skipIf(!haveCustomer)('organisation ids follow the §2 synthetic patterns and names come from the invented pools', async () => {
      const c = JSON.parse(readFileSync(CUSTOMER_PATH, 'utf8')) as {
        organization: { legal_name: string; uei: string; cage: string; phone: string; address: { zip: string }; domain: string };
        accounts: Array<{ kind: string; display_name: string }>;
      };
      expect(c.organization.legal_name).toMatch(/\(FICTIONAL\)$/);
      expect(c.organization.uei).toMatch(/^SIMX[A-Z0-9]{8}$/);
      expect(c.organization.cage).toMatch(/^9S[A-Z0-9]{3}$/);
      expect(c.organization.phone).toMatch(/^\+1-555-01\d\d$/);
      expect(c.organization.address.zip).toBe('00000');
      expect(c.organization.domain).toBe(`${SLUG}.simtenant.onmicrosoft.us`);
      const gen = (await import(pathToFileURL(CUSTOMER_GEN).href)) as { FIRST: string[]; SUR_A: string[]; SUR_B: string[] };
      const surnames = new Set(gen.SUR_A.flatMap((a) => gen.SUR_B.map((b) => a + b)));
      for (const a of c.accounts.filter((x) => x.kind === 'staff' || x.kind === 'admin')) {
        const [first, last] = a.display_name.replace(/ \(Admin\)$/, '').split(' ');
        expect(gen.FIRST, a.display_name).toContain(first);
        expect(surnames.has(last), a.display_name).toBe(true);
      }
    });
  });
});
