// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { SECURITY_BASELINE_TEMPLATE } from '../../src/seed/sets/base.js';
import { BUILTIN_ROLES } from '../../src/seed/sets/gccHighG5.js';

/** P1.4c: the three sim gaps behind run 5's last Stamper failures, plus the collection-name id sweep. */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('P1.4c simulator fidelity', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-p14c-'));
    const tenantRoot = path.join(dir, 'tenant');
    const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', 'muster-partial.json'));
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('an adminAssign eligibility request provisions a schedule the Get- cmdlet returns, with an "and" -Filter honoured', async () => {
    const ga = BUILTIN_ROLES.globalAdministrator;
    await table.resolveCmdlet('New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest', [
      '-BodyParameter',
      { action: 'adminAssign', justification: 'CMMC L2 least privilege', roleDefinitionId: ga, directoryScopeId: '/', principalId: 'user-1', scheduleInfo: { startDateTime: new Date().toISOString() } },
    ]);
    const all = (await table.resolveCmdlet('Get-MgRoleManagementDirectoryRoleEligibilitySchedule', ['-All'])) as Array<Record<string, unknown>>;
    const mine = all.filter((s) => s.principalId === 'user-1' && s.roleDefinitionId === ga);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ directoryScopeId: '/', status: 'Provisioned' });

    const filtered = (await table.resolveCmdlet('Get-MgRoleManagementDirectoryRoleEligibilitySchedule', [
      '-Filter', `principalId eq 'user-1' and roleDefinitionId eq '${ga}'`, '-All',
    ])) as Array<Record<string, unknown>>;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].principalId).toBe('user-1');
    const none = (await table.resolveCmdlet('Get-MgRoleManagementDirectoryRoleEligibilitySchedule', [
      '-Filter', `principalId eq 'user-2' and roleDefinitionId eq '${ga}'`,
    ])) as unknown[];
    expect(none).toHaveLength(0);
  });

  it('Get-HostedContentFilterPolicy -Identity CMMC-AntiSpam reports IsValid true after New- or Set-', async () => {
    await table.resolveCmdlet('New-HostedContentFilterPolicy', ['-Name', 'CMMC-AntiSpam', '-SpamAction', 'MoveToJmf', '-BulkThreshold', 6]);
    const p = (await table.resolveCmdlet('Get-HostedContentFilterPolicy', ['-Identity', "'CMMC-AntiSpam'"])) as Record<string, unknown>;
    expect(p.IsValid).toBe(true);
    await table.resolveCmdlet('Set-HostedContentFilterPolicy', ['-Identity', 'Default', '-BulkThreshold', 5]);
    const d = (await table.resolveCmdlet('Get-HostedContentFilterPolicy', ['-Identity', 'Default'])) as Record<string, unknown>;
    expect(d.IsValid).toBe(true);
  });

  it('P1.4d: Get-HostedOutboundSpamFilterPolicy -Identity CMMC-OutboundSpam reports IsValid true (and the other EXO protection policies)', async () => {
    await table.resolveCmdlet('New-HostedOutboundSpamFilterPolicy', [
      '-Name', 'CMMC-OutboundSpam', '-ActionWhenThresholdReached', 'BlockUser', '-RecipientLimitExternalPerHour', 500,
    ]);
    const p = (await table.resolveCmdlet('Get-HostedOutboundSpamFilterPolicy', ['-Identity', "'CMMC-OutboundSpam'"])) as Record<string, unknown>;
    expect(p).toMatchObject({ ActionWhenThresholdReached: 'BlockUser', IsValid: true });
    for (const cmdlet of ['Get-MalwareFilterPolicy', 'Get-AntiPhishPolicy']) {
      const all = (await table.resolveCmdlet(cmdlet, [])) as Array<Record<string, unknown>>;
      expect(all.length, cmdlet).toBeGreaterThan(0);
      for (const o of all) expect(o.IsValid, cmdlet).toBe(true);
    }
  });

  it('createInstance on the baseline template creates an intent with a GUID id and the template id, listed both ways', async () => {
    const created = (await table.resolveUri(
      'POST',
      `https://graph.microsoft.us/beta/deviceManagement/templates/${SECURITY_BASELINE_TEMPLATE.id}/createInstance`,
      { displayName: 'CMMC-Win11-Baseline', assignments: [{ target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }] },
    )) as Record<string, unknown>;
    expect(created.id).toMatch(GUID);
    expect(created.templateId).toBe(SECURITY_BASELINE_TEMPLATE.id);

    const list = (await table.resolveUri('GET', 'https://graph.microsoft.us/beta/deviceManagement/intents')) as { value: Array<Record<string, unknown>> };
    expect(list.value.find((i) => i.displayName === 'CMMC-Win11-Baseline')?.id).toBe(created.id);
    const byCmdlet = (await table.resolveCmdlet('Get-MgDeviceManagementIntent', ['-Filter', "displayName eq 'CMMC-Win11-Baseline'"])) as Array<
      Record<string, unknown>
    >;
    expect(byCmdlet).toHaveLength(1);
    expect(byCmdlet[0]).toMatchObject({ id: created.id, templateId: SECURITY_BASELINE_TEMPLATE.id });
    expect(await store.list('deviceManagementInstances')).toHaveLength(0);
    await expect(
      table.resolveUri('POST', '/beta/deviceManagement/templates/0bad0bad-0000-4000-8000-000000000000/createInstance', { displayName: 'x' }),
    ).rejects.toThrow(/Request_ResourceNotFound/);
  });

  it('sweep: a create that names nothing is never stored under its collection name', async () => {
    // seeded true singletons (authorizationPolicy, ...) legitimately carry their collection's name
    const named = async () => {
      const out: string[] = [];
      for (const c of Object.keys(await store.collectionCounts())) if ((await store.list(c)).some((o) => o.id === c)) out.push(c);
      return out;
    };
    const before = await named();
    await table.resolveCmdlet('New-MgAgreement', ['-BodyParameter', { displayName: 'Sim Terms' }]);
    await table.resolveCmdlet('New-ComplianceSearch', ['-ContentMatchQuery', 'CUI']);
    await table.resolveCmdlet('New-MgDeviceManagementDeviceConfiguration', ['-BodyParameter', { displayName: 'Sim Config' }]);
    expect(await named()).toEqual(before);
  });
});
