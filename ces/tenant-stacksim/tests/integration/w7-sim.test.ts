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
import { DirectoryAuditWriter } from '../../src/audit/DirectoryAuditWriter.js';
import { Ledger } from '../../src/ledger/Ledger.js';
import { buildCustomerHistoryS3Seed } from '../../src/seed/sets/customerHistoryS3.js';

/**
 * W7-SIM (2026-10-29, ces-strategy PLAN.md §3 row W7-SIM):
 *  (1) PATCH of one lifecycle workflow (AO's A-21), audited, visible on GET;
 *  (2) AO's A-10 (eligibility request, assignment delete) and A-19 (CA
 *      policy excludeUsers) routes;
 *  (3) the S1 / S2 seeds for the empty discovery reads;
 *  (4) the MFA registration read with -All;
 *  (5) S3 opts out of the seeds.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXED = '2026-10-01T00:00:00.000Z';
const GA = '62e90394-69f5-4237-9190-012177145e10';
const WF = '/v1.0/identityGovernance/lifecycleWorkflows/workflows';
const ARM_WS = '/subscriptions/sub-x/resourceGroups/rg-x/providers/Microsoft.OperationalInsights/workspaces/law-x/providers/Microsoft.SecurityInsights';

type Row = Record<string, any>;
const value = (v: unknown): Row[] => (v as { value: Row[] }).value;

async function build(root: string, slug: string): Promise<ObjectStore> {
  const prev = process.env.STACKSIM_FIXED_NOW;
  process.env.STACKSIM_FIXED_NOW = FIXED;
  try {
    await applyScenario(await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`)), { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot: root });
  } finally {
    if (prev === undefined) delete process.env.STACKSIM_FIXED_NOW;
    else process.env.STACKSIM_FIXED_NOW = prev;
  }
  return new ObjectStore(path.join(root, 'store.json'));
}

function audited(store: ObjectStore, root: string): ResolverTable {
  return new ResolverTable(store, new StackShapeGate('m365_azure'), undefined, new DirectoryAuditWriter(store, new Ledger(path.join(root, 'w7-ledger.jsonl'))));
}

describe('W7-SIM', () => {
  let dir: string;
  const stores: Record<string, ObjectStore> = {};
  const tables: Record<string, ResolverTable> = {};

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-w7-'));
    for (const slug of ['s1-mach', 's2-eng', 's3-def']) {
      const root = path.join(dir, slug);
      stores[slug] = await build(root, slug);
      tables[slug] = audited(stores[slug], root);
    }
  }, 120_000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('(1) lifecycle workflow PATCH', () => {
    it('S2 has the S1 builder workflows: joiner and mover scheduled, the leaver (disable task) on demand', async () => {
      const wfs = value(await tables['s2-eng'].resolveUri('GET', `${WF}?$expand=tasks`));
      expect(wfs.map((w) => [w.id, w.category, w.isEnabled, w.isSchedulingEnabled])).toEqual([
        ['52520000-001f-4000-8000-000000000001', 'joiner', true, true],
        ['52520000-001f-4000-8000-000000000002', 'mover', true, true],
        ['52520000-001f-4000-8000-000000000003', 'leaver', true, false],
      ]);
      const leaver = wfs[2];
      expect(leaver.displayName).toBe('S2 Leaver - disable account and remove access');
      expect((leaver.tasks as Row[]).map((t) => t.displayName)).toEqual(['Disable user account', 'Remove user from all groups', 'Remove all licenses for user']);
      expect((leaver.tasks as Row[])[0].taskDefinitionId).toBe('1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950');
    });

    it('A-21 shape: a JSON-string body schedules the S1 leaver; item and list GET show it; one audit row and one ledger mutate', async () => {
      const t = tables['s1-mach'];
      const id = '51510000-001f-4000-8000-000000000003';
      expect((await t.resolveUri('GET', `${WF}/${id}`) as Row).isSchedulingEnabled).toBe(false);
      const before = (await stores['s1-mach'].list('directoryAudits')).length;
      await t.resolveUri('PATCH', `${WF}/${id}`, JSON.stringify({ isSchedulingEnabled: true }));
      const item = (await t.resolveUri('GET', `${WF}/${id}`)) as Row;
      expect(item).toMatchObject({ id, category: 'leaver', isEnabled: true, isSchedulingEnabled: true });
      expect((item.tasks as Row[]).length).toBe(3);
      expect(value(await t.resolveUri('GET', `${WF}?$expand=tasks`)).find((w) => w.id === id)?.isSchedulingEnabled).toBe(true);
      const audits = await stores['s1-mach'].list('directoryAudits');
      expect(audits.length).toBe(before + 1);
      const row = audits.find((a) => a.activityDisplayName === `PATCH ${WF}/*`) as Row;
      expect(row.targetResources[0].id).toBe(id);
      const ledger = await new Ledger(path.join(dir, 's1-mach', 'w7-ledger.jsonl')).query({ type: 'mutate' });
      expect(ledger.filter((e) => e.objectType === 'lifecycleWorkflows')).toHaveLength(1);
      // The mover is untouched.
      expect((await t.resolveUri('GET', `${WF}/51510000-001f-4000-8000-000000000002`) as Row).isSchedulingEnabled).toBe(true);
    });

    it('an object body with both flags is accepted; isEnabled false alone on a scheduled workflow is a 400; other properties are a 400; an unknown id is a 404', async () => {
      const t = tables['s2-eng'];
      const id = '52520000-001f-4000-8000-000000000003';
      await t.resolveUri('PATCH', `${WF}/${id}`, { isEnabled: true, isSchedulingEnabled: true });
      expect((await t.resolveUri('GET', `${WF}/${id}`) as Row).isSchedulingEnabled).toBe(true);
      await expect(t.resolveUri('PATCH', `${WF}/${id}`, { isEnabled: false })).rejects.toThrow(/Request_BadRequest: .*cannot be scheduled while it is disabled/);
      await expect(t.resolveUri('PATCH', `${WF}/${id}`, { displayName: 'x' })).rejects.toThrow(/Request_BadRequest: .*"displayName" cannot be updated/);
      await expect(t.resolveUri('PATCH', `${WF}/${id}`, { isSchedulingEnabled: 'yes' })).rejects.toThrow(/Request_BadRequest: .*must be a boolean/);
      await expect(t.resolveUri('PATCH', `${WF}/no-such-workflow`, { isSchedulingEnabled: true })).rejects.toThrow(/Request_ResourceNotFound/);
      // Unscheduling and disabling together is valid.
      await t.resolveUri('PATCH', `${WF}/${id}`, { isEnabled: false, isSchedulingEnabled: false });
      expect(await t.resolveUri('GET', `${WF}/${id}`)).toMatchObject({ isEnabled: false, isSchedulingEnabled: false });
    });
  });

  describe('(2) A-10 and A-19 routes', () => {
    it('A-10: the eligibility request provisions a schedule and instance; the assignment DELETE also drops the directory-role member', async () => {
      const t = tables['s3-def'];
      const standing = value(await t.resolveUri('GET', `/v1.0/roleManagement/directory/roleAssignments?$filter=roleDefinitionId eq '${GA}'`));
      expect(standing.length).toBeGreaterThan(0);
      const principal = String(standing[0].principalId);
      await t.resolveUri('POST', '/v1.0/roleManagement/directory/roleEligibilityScheduleRequests', {
        action: 'adminAssign', principalId: principal, roleDefinitionId: GA, directoryScopeId: '/', justification: 'test',
        scheduleInfo: { startDateTime: '2026-01-01T00:00:00.000Z', expiration: { type: 'noExpiration' } },
      });
      const inst = value(await t.resolveUri('GET', `/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?$filter=principalId eq '${principal}'`));
      expect(inst.map((i) => i.roleDefinitionId)).toContain(GA);
      const gaMembers = async () => (value(await t.resolveUri('GET', '/v1.0/directoryRoles?$expand=members')).find((r) => r.roleTemplateId === GA)?.members as Row[]).map((m) => m.id);
      expect(await gaMembers()).toContain(principal);
      const flt = encodeURIComponent(`principalId eq '${principal}' and roleDefinitionId eq '${GA}'`);
      const act = value(await t.resolveUri('GET', `/v1.0/roleManagement/directory/roleAssignments?$filter=${flt}`));
      expect(act).toHaveLength(1);
      for (const a of act) await t.resolveUri('DELETE', `/v1.0/roleManagement/directory/roleAssignments/${a.id}`);
      expect(value(await t.resolveUri('GET', `/v1.0/roleManagement/directory/roleAssignments?$filter=${flt}`))).toHaveLength(0);
      expect(await gaMembers()).not.toContain(principal);
      expect(standing.length - 1).toBe(value(await t.resolveUri('GET', `/v1.0/roleManagement/directory/roleAssignments?$filter=roleDefinitionId eq '${GA}'`)).length);
    });

    it('A-19: a CA PATCH with conditions.users.excludeUsers replaces the conditions and the GET shows the exclusion', async () => {
      const t = tables['s3-def'];
      const pols = value(await t.resolveUri('GET', '/v1.0/identity/conditionalAccess/policies'));
      const p = pols[0];
      const bg = (await stores['s3-def'].list('users')).find((u) => String((u as Row).userPrincipalName).includes('emergency') || String((u as Row).displayName).includes('Emergency')) ?? (await stores['s3-def'].list('users'))[0];
      const users = { ...(p.conditions?.users ?? {}), excludeUsers: [...((p.conditions?.users?.excludeUsers as string[]) ?? []), bg.id] };
      await t.resolveUri('PATCH', `/v1.0/identity/conditionalAccess/policies/${p.id}`, JSON.parse(JSON.stringify({ conditions: { ...p.conditions, users } })));
      const after = (await t.resolveUri('GET', `/v1.0/identity/conditionalAccess/policies/${p.id}`)) as Row;
      expect(after.conditions.users.excludeUsers).toContain(bg.id);
      expect(after.conditions.users.includeUsers).toEqual(p.conditions.users.includeUsers);
      await expect(t.resolveUri('PATCH', `/v1.0/identity/conditionalAccess/policies/${p.id}`, { conditions: { users: { excludeUsers: ['not-a-user'] } } })).rejects.toThrow(/Request_BadRequest/);
    });
  });

  describe('(3) S1 / S2 seeds for the empty discovery reads', () => {
    for (const [slug, operator, prefix] of [['s1-mach', 'user-48', 'S1'], ['s2-eng', 'user-32', 'S2']] as const) {
      it(`${slug}: the operator is PIM-eligible for Global Administrator, and no standing role was added`, async () => {
        const t = tables[slug];
        const elig = (await t.resolveCmdlet('Get-MgRoleManagementDirectoryRoleEligibilitySchedule', ['-Filter', `principalId eq '${operator}' and roleDefinitionId eq '${GA}'`])) as Row[];
        expect(elig).toHaveLength(1);
        expect(elig[0]).toMatchObject({ principalId: operator, roleDefinitionId: GA, status: 'Provisioned', directoryScopeId: '/' });
        // AC.L2-3.1.2 role-assign and AU.L2-3.3.8 audit-protect stay empty by design (no standing roles).
        expect(await t.resolveCmdlet('Get-MgRoleManagementDirectoryRoleAssignment', ['-Filter', `principalId eq '${operator}' and roleDefinitionId eq '${GA}'`])).toEqual([]);
        expect(await t.resolveCmdlet('Get-MgRoleManagementDirectoryRoleAssignment', ['-Filter', "roleDefinitionId eq '17315797-102d-40b4-93e0-432062caca18'", '-All'])).toEqual([]);
        const breakGlass = (await stores[slug].list('users')).filter((u) => /Emergency Access/.test(String((u as Row).displayName))).map((u) => u.id);
        expect((await stores[slug].list('roleAssignments')).every((a) => breakGlass.includes(String((a as Row).principalId)))).toBe(true);
      });

      it(`${slug}: the customer's monthly audit-review compliance search and the branding read return data`, async () => {
        const t = tables[slug];
        const searches = (await t.resolveCmdlet('Get-ComplianceSearch', [])) as Row[];
        expect(searches.map((s) => s.Name)).toEqual([`${prefix} Monthly audit review - admin and CUI site activity`]);
        expect(searches[0]).toMatchObject({ Status: 'Completed', Items: 412 });
        const branding = await t.resolveCmdlet('Get-MgOrganizationBranding', ['-OrganizationId', `sim-tenant-${slug}`]);
        expect((Array.isArray(branding) ? branding[0] : branding) as Row).toMatchObject({ id: '0' });
      });
    }

    it('s1-mach: Sentinel is onboarded with the Office 365 (Exchange, SharePoint, Teams) and Defender XDR connectors', async () => {
      const t = tables['s1-mach'];
      expect(await t.resolveUri('GET', `https://management.usgovcloudapi.net${ARM_WS}/onboardingStates/default?api-version=2023-11-01`)).toMatchObject({ name: 'default' });
      const o365 = (await t.resolveUri('GET', `https://management.usgovcloudapi.net${ARM_WS}/dataConnectors/office365?api-version=2024-03-01`)) as Row;
      expect(o365.properties.dataTypes).toEqual({ exchange: { state: 'enabled' }, sharePoint: { state: 'enabled' }, teams: { state: 'enabled' } });
      expect((await stores['s1-mach'].list('sentinelDataConnectors')).map((c) => (c as Row).kind)).toEqual(['Office365', 'MicrosoftThreatProtection']);
    });

    it('s2-eng: no Sentinel, so the data-connector read is a 404 (the honest answer)', async () => {
      await expect(tables['s2-eng'].resolveUri('GET', `${ARM_WS}/dataConnectors/office365`)).rejects.toThrow(/Request_ResourceNotFound/);
      expect(await stores['s2-eng'].list('sentinelDataConnectors')).toEqual([]);
    });
  });

  describe('(4) MFA registration details with -All', () => {
    it('the cmdlet with -All and the REST list return every registration row in one page', async () => {
      const t = tables['s1-mach'];
      const all = await stores['s1-mach'].list('authenticationMethodUserRegistrationDetails');
      expect(all.length).toBeGreaterThan(0);
      expect(await t.resolveCmdlet('Get-MgReportAuthenticationMethodUserRegistrationDetail', ['-All'])).toHaveLength(all.length);
      const rest = (await t.resolveUri('GET', '/v1.0/reports/authenticationMethods/userRegistrationDetails')) as Row;
      expect(rest.value).toHaveLength(all.length);
      expect(rest['@odata.nextLink']).toBeUndefined();
    });
  });

  describe('(5) S3 opts out', () => {
    it('S3 has none of the W7 seeds: the collections are emitted empty and no extra eligibility exists', async () => {
      const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', 's3-def.json'));
      const seed = buildCustomerHistoryS3Seed(Date.parse(FIXED), scenario.seedContext?.['customer-history-s3']);
      for (const c of ['sentinelOnboardingStates', 'sentinelDataConnectors', 'complianceSearch', 'roleEligibilitySchedules']) expect(seed.add[c], c).toEqual([]);
      // (the A-10 test above adds one eligibility to the S3 store, so only the seed is checked for it)
      for (const c of ['sentinelOnboardingStates', 'sentinelDataConnectors', 'complianceSearch']) expect(await stores['s3-def'].list(c), c).toEqual([]);
    });
  });
});
