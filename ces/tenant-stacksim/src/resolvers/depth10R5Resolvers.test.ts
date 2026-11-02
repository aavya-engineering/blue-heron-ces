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
 * DEPTH-10.6..10.11 golden (PH-12, P12-R5): for every new or re-aimed Stamper registry entry of the CM, MA, PS
 * and RA+CA batches, the SET as Stamper sends it (exact absolute graph.microsoft.us URI, body as the HTTP
 * layer parses Stamper's `@{...} | ConvertTo-Json -Depth 10` JSON; the Intune /assign action takes the raw JSON string), then the entry's GET, read back through the real
 * ResolverTable on a seeded scenario. The GET's PowerShell filter (Where-Object displayName -eq ...) is applied
 * here; the value each test pins is the entry's verification expected value (ces-strategy
 * docs/context/finish/LOG-PH12-R5.md, SPOTCHECK-DEPTH-10.6.md and later sheets).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const G = 'https://graph.microsoft.us';
const CFG = `${G}/v1.0/deviceManagement/deviceConfigurations`;
const GROUP_TARGET = '#microsoft.graph.groupAssignmentTarget';

type Row = Record<string, any>;

async function build(slug: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-depth10-r5-${slug}-`));
  const tenantRoot = path.join(dir, 'tenant');
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
  const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
  return { dir, store, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const page = async (t: ResolverTable, uri: string) => ((await t.resolveUri('GET', uri)) as { value: Row[] }).value;
const byName = (rows: Row[], key: string, name: string) => {
  const hits = rows.filter((r) => r[key] === name);
  expect(hits).toHaveLength(1);
  return hits[0];
};

/** Stamper's Intune create + assign SET, then its `$expand=assignments` GET filtered by displayName. */
async function intuneCreateAssignRead(t: ResolverTable, body: Row): Promise<Row> {
  const created = (await t.resolveUri('POST', CFG, body)) as Row;
  expect(typeof created.id).toBe('string');
  await t.resolveUri('POST', `${CFG}/${created.id}/assign`, JSON.stringify({ assignments: [{ target: { '@odata.type': GROUP_TARGET, groupId: 'group-1' } }] }));
  return byName(await page(t, `${CFG}?$expand=assignments`), 'displayName', body.displayName);
}

for (const slug of ['s1-mach', 'muster-partial']) {
  describe(`DEPTH-10.6 CM: SET then GET on ${slug}`, () => {
    let b: Awaited<ReturnType<typeof build>>;
    beforeAll(async () => {
      b = await build(slug);
    }, 60_000);
    afterAll(async () => {
      await fs.rm(b.dir, { recursive: true, force: true });
    });

    it('CM.L2-3.4.7.firewall-ports: every profile reads firewall on and inbound blocked', async () => {
      const profile = { firewallEnabled: 'allowed', inboundConnectionsBlocked: true };
      const read = await intuneCreateAssignRead(b.table, {
        '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration',
        displayName: 'CMMC-Firewall-PortPolicy',
        firewallBlockStatefulFTP: true,
        firewallProfileDomain: profile,
        firewallProfilePrivate: profile,
        firewallProfilePublic: profile,
      });
      for (const p of ['firewallProfileDomain', 'firewallProfilePrivate', 'firewallProfilePublic']) {
        expect(read[p]).toEqual({ firewallEnabled: 'allowed', inboundConnectionsBlocked: true });
      }
      expect(read.firewallBlockStatefulFTP).toBe(true);
      expect(read.assignments).toHaveLength(1);
    });

    it('CM.L2-3.4.7.nonessential-functions and .nonessential-services read their blocks back', async () => {
      const fn = await intuneCreateAssignRead(b.table, { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'CMMC-NonEssential-Functions', windowsSpotlightBlockConsumerSpecificFeatures: true, gameDvrBlocked: true });
      expect(fn).toMatchObject({ windowsSpotlightBlockConsumerSpecificFeatures: true, gameDvrBlocked: true });
      expect(fn.assignments).toHaveLength(1);
      const svc = await intuneCreateAssignRead(b.table, { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'CMMC-NonEssential-Services', connectedDevicesServiceBlocked: true, internetSharingBlocked: true });
      expect(svc).toMatchObject({ connectedDevicesServiceBlocked: true, internetSharingBlocked: true });
      expect(svc.assignments).toHaveLength(1);
    });

    it('CM.L2-3.4.8.app-control: AppLocker reads enforceComponentsAndStoreApps; the re-aimed evidence read finds it', async () => {
      const read = await intuneCreateAssignRead(b.table, { '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration', displayName: 'CMMC-AppControl-AppLocker', appLockerApplicationControl: 'enforceComponentsAndStoreApps' });
      expect(read.appLockerApplicationControl).toBe('enforceComponentsAndStoreApps');
      expect(read.assignments).toHaveLength(1);
      // CM.L2-3.4.8.app-protection-evidence's GET: the bare list, filtered on type and an enforce mode.
      const evidence = (await page(b.table, CFG)).filter((c) => c['@odata.type'] === '#microsoft.graph.windows10EndpointProtectionConfiguration' && String(c.appLockerApplicationControl ?? '').startsWith('enforce'));
      expect(evidence.map((c) => c.displayName)).toContain('CMMC-AppControl-AppLocker');
    });

    it('CM.L2-3.4.7.legacy-protocols: Set-TransportConfig -SmtpClientAuthenticationDisabled then Get-TransportConfig', async () => {
      await b.table.resolveCmdlet('Set-TransportConfig', ['-SmtpClientAuthenticationDisabled', true]);
      const rows = (await b.table.resolveCmdlet('Get-TransportConfig')) as Row[] | Row;
      const cfg = Array.isArray(rows) ? rows : [rows];
      expect(cfg).toHaveLength(1);
      expect(cfg[0].SmtpClientAuthenticationDisabled).toBe(true);
    });

    it('CM.L2-3.4.1.device-cleanup: the clean-up rule is created once and read back (new resolver)', async () => {
      const uri = `${G}/beta/deviceManagement/managedDeviceCleanupRules`;
      expect(await page(b.table, uri)).toEqual([]);
      const created = (await b.table.resolveUri('POST', uri, { displayName: 'CMMC-Device-Cleanup-90d', deviceCleanupRulePlatformType: 'all', deviceInactivityBeforeRetirementInDays: 90 })) as Row;
      expect(typeof created.id).toBe('string');
      const read = byName(await page(b.table, uri), 'displayName', 'CMMC-Device-Cleanup-90d');
      expect(read).toMatchObject({ deviceCleanupRulePlatformType: 'all', deviceInactivityBeforeRetirementInDays: 90 });
    });
  });
}

for (const slug of ['s1-mach', 'muster-partial']) {
  describe(`DEPTH-10.9 MA / 10.10 PS: SET then GET on ${slug}`, () => {
    let b: Awaited<ReturnType<typeof build>>;
    beforeAll(async () => {
      b = await build(slug);
    }, 60_000);
    afterAll(async () => {
      await fs.rm(b.dir, { recursive: true, force: true });
    });

    it('MA.L2-3.7.5.session-terminate: the admin-session CA policy reads 4 hours, never persistent, enabled', async () => {
      await b.table.resolveCmdlet('New-MgIdentityConditionalAccessPolicy', ['-BodyParameter', {
        displayName: 'CMMC-AdminSession-Terminate',
        state: 'enabled',
        conditions: {
          users: { includeRoles: ['62e90394-69f5-4237-9190-012177145e10', '194ae4cb-b126-40b2-bd5b-6091b380977d', '3a2c62db-5318-420d-8d74-23affee5d9d5'], excludeUsers: ['00000000-0000-4000-8000-0000000000b9'] },
          applications: { includeApplications: ['All'] },
          clientAppTypes: ['all'],
        },
        sessionControls: { signInFrequency: { value: 4, type: 'hours', isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } },
      }]);
      const read = byName(await page(b.table, `${G}/v1.0/identity/conditionalAccess/policies`), 'displayName', 'CMMC-AdminSession-Terminate');
      expect(read.state).toBe('enabled');
      expect(read.sessionControls).toEqual({ signInFrequency: { value: 4, type: 'hours', isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } });
      expect(read.conditions.users.excludeUsers).toEqual(['00000000-0000-4000-8000-0000000000b9']);
    });

    it('PS.L2-3.9.2.access-review: POST a definition (new resolver), read it back by name; the item read still works', async () => {
      const AR = `${G}/v1.0/identityGovernance/accessReviews/definitions`;
      const before = (await page(b.table, AR)).length;
      const created = (await b.table.resolveUri('POST', AR, {
        displayName: 'CMMC-CUI-Group-Access-Review',
        scope: { '@odata.type': '#microsoft.graph.accessReviewQueryScope', query: '/groups/group-1/transitiveMembers', queryType: 'MicrosoftGraph' },
        reviewers: [{ query: '/groups/group-1/owners', queryType: 'MicrosoftGraph' }],
        settings: { defaultDecisionEnabled: true, defaultDecision: 'Deny', autoApplyDecisionsEnabled: true, instanceDurationInDays: 14, recurrence: { pattern: { type: 'absoluteMonthly', interval: 3 }, range: { type: 'noEnd', startDate: '2026-11-01' } } },
      })) as Row;
      expect(typeof created.id).toBe('string');
      const all = await page(b.table, AR);
      expect(all).toHaveLength(before + 1); // the seeded definitions (EO's coverage read) are still listed
      const read = byName(all, 'displayName', 'CMMC-CUI-Group-Access-Review');
      expect(read.settings).toMatchObject({ defaultDecision: 'Deny', autoApplyDecisionsEnabled: true, recurrence: { pattern: { interval: 3 } } });
      expect(read.scope.query).toMatch(/^\/groups\/[^/]+\/transitiveMembers$/);
      const one = (await b.table.resolveUri('GET', `${AR}/${created.id}`)) as Row;
      expect(one.displayName).toBe('CMMC-CUI-Group-Access-Review');
    });
  });
}
