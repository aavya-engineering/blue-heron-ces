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
 * synthetic-customer W5 cycle 2, follow-up 9 (2026-10-28):
 *  - muster-partial's activated directory roles (run 50: AC.L1-3.1.2's
 *    `Get-MgDirectoryRole` / `Get-MgDirectoryRoleMember` read was empty),
 *    consistent with the role assignments EvidenceOps reads, on the cmdlets
 *    and the `/directoryRoles` URIs (both scenarios);
 *  - Stamper's Windows compliance-policy create (POST, with
 *    scheduledActionsForRule) followed by `/assign`, on both scenarios.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const G = 'https://graph.microsoft.us';
const GA = '62e90394-69f5-4237-9190-012177145e10';
const CA = '17315797-102d-40b4-93e0-432062caca18';
const DCP = `${G}/v1.0/deviceManagement/deviceCompliancePolicies`;

type Row = Record<string, any>;
const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);

async function build(slug: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-fu9-${slug}-`));
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot: path.join(dir, 'tenant') });
  return { dir, table: new ResolverTable(new ObjectStore(path.join(dir, 'tenant', 'store.json')), new StackShapeGate('m365_azure')) };
}
const page = async (t: ResolverTable, uri: string) => ((await t.resolveUri('GET', uri)) as { value: Row[] }).value;

/** Stamper's Windows compliance create body (scheduledActionsForRule is required by Graph on create). */
const complianceBody = {
  '@odata.type': '#microsoft.graph.windows10CompliancePolicy',
  displayName: 'CMMC-Windows-Compliance',
  passwordRequired: true,
  passwordMinimumLength: 14,
  bitLockerEnabled: true,
  scheduledActionsForRule: [{ ruleName: 'PasswordRequired', scheduledActionConfigurations: [{ actionType: 'block', gracePeriodHours: 0, notificationTemplateId: '', notificationMessageCCList: [] }] }],
};

describe('W5c2 follow-up 9: muster-partial directory roles', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it("Stamper's AC.L1-3.1.2.rbac-evidence read: Get-MgDirectoryRole lists the activated roles; members per role", async () => {
    const roles = asList(await b.table.resolveCmdlet('Get-MgDirectoryRole', []));
    expect(roles.map((r) => [r.displayName, r.roleTemplateId])).toEqual([['Global Administrator', GA], ['Compliance Administrator', CA]]);
    const count: Record<string, number> = {};
    for (const r of roles) count[r.displayName] = asList(await b.table.resolveCmdlet('Get-MgDirectoryRoleMember', ['-DirectoryRoleId', r.id])).length;
    expect(count).toEqual({ 'Global Administrator': 2, 'Compliance Administrator': 0 });
    const ga = asList(await b.table.resolveCmdlet('Get-MgDirectoryRoleMember', ['-DirectoryRoleId', roles[0].id]));
    expect(ga.map((m) => [m.id, m['@odata.type']])).toEqual([['user-1', '#microsoft.graph.user'], ['user-2', '#microsoft.graph.user']]);
  });

  it('consistent with the role assignments EvidenceOps reads (Global Administrator for user-1 and user-2; the generic role-1/role-2 rows are gone)', async () => {
    const ra = await page(b.table, '/v1.0/roleManagement/directory/roleAssignments');
    expect(ra.map((a) => [a.principalId, a.roleDefinitionId])).toEqual([['user-1', GA], ['user-2', GA]]);
    const members = (await page(b.table, `${G}/v1.0/directoryRoles?$expand=members`)).find((r) => r.roleTemplateId === GA)!.members as Row[];
    expect(members.map((m) => m.id).sort()).toEqual(ra.map((a) => a.principalId).sort());
  });

  it('the /directoryRoles URIs: list, $expand=members, item, members, 404', async () => {
    const list = await page(b.table, `${G}/v1.0/directoryRoles`);
    expect(list.map((r) => r.id)).toEqual(['directoryRole-1', 'directoryRole-2']);
    expect(list.every((r) => !('members' in r))).toBe(true);
    expect((await page(b.table, `/v1.0/directoryRoles?$filter=displayName eq 'Compliance Administrator'`)).map((r) => r.id)).toEqual(['directoryRole-2']);
    expect(((await b.table.resolveUri('GET', '/v1.0/directoryRoles/directoryRole-1')) as Row).displayName).toBe('Global Administrator');
    expect((await page(b.table, '/v1.0/directoryRoles/directoryRole-1/members')).map((m) => m.userPrincipalName)).toEqual(['sim.user1@simtenant.onmicrosoft.us', 'sim.user2@simtenant.onmicrosoft.us']);
    expect(await page(b.table, '/v1.0/directoryRoles/directoryRole-2/members')).toEqual([]);
    await expect(b.table.resolveUri('GET', '/v1.0/directoryRoles/nope/members')).rejects.toThrow(/no directory role/);
  });
});

for (const slug of ['muster-partial', 's1-mach']) {
  describe(`W5c2 follow-up 9: Windows compliance-policy create + assign on ${slug}`, () => {
    let b: Awaited<ReturnType<typeof build>>;
    beforeAll(async () => {
      b = await build(slug);
    }, 60_000);
    afterAll(async () => {
      await fs.rm(b.dir, { recursive: true, force: true });
    });

    it('POST creates a new policy (new id, scheduledActionsForRule kept); /assign stores the assignment; expanded read only', async () => {
      const before = (await page(b.table, DCP)).length;
      const created = (await b.table.resolveUri('POST', DCP, complianceBody)) as Row;
      expect(created.id).not.toBe('deviceCompliancePolicies');
      expect(created.scheduledActionsForRule[0].ruleName).toBe('PasswordRequired');
      await b.table.resolveUri('POST', `${DCP}/${created.id}/assign`, JSON.stringify({ assignments: [{ target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }] }));
      const list = await page(b.table, `${DCP}?$expand=assignments`);
      expect(list).toHaveLength(before + 1);
      const mine = list.find((p) => p.displayName === 'CMMC-Windows-Compliance')!;
      expect(mine.assignments).toEqual([{ id: `${created.id}_group-1`, target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }]);
      expect('assignments' in (await page(b.table, DCP)).find((p) => p.id === created.id)!).toBe(false);
      // The cmdlet read lists it too (EO's IA.L2-3.5.7/3.5.8 read).
      expect(asList(await b.table.resolveCmdlet('Get-MgDeviceManagementDeviceCompliancePolicy', [])).some((p) => p.id === created.id)).toBe(true);
    });

    if (slug === 's1-mach') {
      it('S1 /directoryRoles answers from its follow-up 6 roles (Global Administrator: the 2 break-glass accounts)', async () => {
        const ga = (await page(b.table, `/v1.0/directoryRoles?$expand=members`)).find((r) => r.roleTemplateId === GA)!;
        expect((ga.members as Row[]).map((m) => m.id).sort()).toEqual(['user-50', 'user-51']);
      });
    }
  });
}
