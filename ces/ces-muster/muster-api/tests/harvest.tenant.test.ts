// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * MG-13 / MG-14: the harvest's tenant-fact probes.
 *  1. Graph reads shaped like fixture customer (a)'s tenant produce EXACTLY the
 *     auto_detected facts that fixture's session carries (so the SPA fixture
 *     that proves SI/TCP parity is what the probes would write).
 *  2. A failed read yields no fact (FCA absence guardrail); nothing is
 *     inferred from absence.
 *  3. The facts pass the SPA's harvest-prefill seam as overridable pre-fills.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockGraphClient } from '../src/lib/graphClient.js';
import {
  ROLE_TEMPLATE,
  STANDING_GLOBAL_ADMIN_ACTIVITY,
  TENANT_READS,
  runTenantHarvest,
  tenantFactsFromReads,
  type TenantReads,
} from '../src/services/harvestService.js';
import { applyHarvestFacts } from '@/features/assessment/assessmentHelpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_A = path.resolve(HERE, '../../src/features/plan/__fixtures__/customers/a/muster-session.json');

const D = 'simtenant-a.onmicrosoft.us';
const BG1 = '00000000-0000-4002-8000-00000000000a';
const BG2 = '00000000-0000-4002-8000-0000000000b0';

/** Graph responses for fixture (a)'s synthetic tenant. */
const READS_A: TenantReads = {
  organization: {
    value: [
      {
        id: '00000000-0000-4000-8000-00000000000a',
        displayName: 'Simtenant Alpha Aerospace GCC High Tenant',
        verifiedDomains: [{ name: D, isDefault: true, isInitial: true }],
        // MG-16: the address the fixture's Policy Inputs pre-fills carry (PI.ORG.002-005).
        street: '100 Example Way',
        city: 'Testville',
        state: 'ZZ',
        postalCode: '00000',
      },
    ],
  },
  subscribedSkus: {
    value: [
      { skuPartNumber: 'SPE_E5_USGOV_GCCHIGH', consumedUnits: 85 },
      { skuPartNumber: 'SIM_ADDON_UNMAPPED', consumedUnits: 85 },
    ],
  },
  users: {
    value: [
      { id: 'u-admin', userPrincipalName: `admin@${D}`, onPremisesSyncEnabled: null },
      { id: BG1, userPrincipalName: `breakglass1@${D}`, onPremisesSyncEnabled: null },
      { id: BG2, userPrincipalName: `breakglass2@${D}`, onPremisesSyncEnabled: null },
      { id: 'u-sec', userPrincipalName: `secadmin@${D}`, onPremisesSyncEnabled: null },
      { id: 'u-comp', userPrincipalName: `complianceadmin@${D}`, onPremisesSyncEnabled: null },
    ],
  },
  roleAssignments: {
    value: [
      { principalId: 'u-admin', roleDefinitionId: ROLE_TEMPLATE.globalAdministrator },
      { principalId: BG1, roleDefinitionId: ROLE_TEMPLATE.globalAdministrator },
      { principalId: BG2, roleDefinitionId: ROLE_TEMPLATE.globalAdministrator },
      { principalId: 'u-sec', roleDefinitionId: ROLE_TEMPLATE.securityAdministrator },
      { principalId: 'u-comp', roleDefinitionId: ROLE_TEMPLATE.complianceAdministrator },
    ],
  },
  conditionalAccess: {
    value: Array.from({ length: 6 }, (_, i) => ({
      id: `ca-${i}`,
      state: i < 5 ? 'enabled' : 'disabled',
      conditions: {
        users: { includeUsers: ['All'], excludeUsers: [BG1, BG2] },
        applications: { includeApplications: i === 0 ? ['All'] : ['Office365'] },
      },
      grantControls: { operator: 'OR', builtInControls: i === 0 ? ['mfa'] : ['compliantDevice'] },
    })),
  },
  roleEligibility: { value: [{ id: 'elig-1' }] },
  groups: {
    value: ['CUI-Authorized-Users', 'CMMC-Operators', 'Evidence-Reviewers', 'Engineering'].map((n) => ({
      displayName: n,
      securityEnabled: true,
      groupTypes: ['DynamicMembership'],
    })),
  },
  managedDevices: {
    value: [
      { operatingSystem: 'Windows', joinType: 'azureADJoined' },
      { operatingSystem: 'macOS', joinType: 'unknown' },
      { operatingSystem: 'iOS', joinType: 'unknown' },
    ],
  },
  deviceConfigurations: { value: [{ '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', storageBlockRemovableStorage: true }] },
  me: { userPrincipalName: `admin@${D}` },
};

const key = (f: { question_id: string; answer: string; source?: string }) => `${f.question_id}=${f.answer} [${f.source}]`;

describe('MG-13 / MG-14 tenant-fact probes', () => {
  it("fixture (a)'s tenant reads produce exactly the fixture's discovered facts", () => {
    // The W5 standing-Global-Administrator verdict postdates the fixture session (its own test below).
    const facts = tenantFactsFromReads(READS_A, '2026-01-15T00:00:00.000Z').filter((f) => f.question_id !== STANDING_GLOBAL_ADMIN_ACTIVITY);
    const session = JSON.parse(fs.readFileSync(FIXTURE_A, 'utf8')).session;
    const fixtureDiscovered = (session.facts as Array<{ question_id: string; answer: string; provenance: string; source?: string }>)
      .filter((f) => f.provenance === 'auto_detected');
    expect(facts.map(key).sort()).toEqual(fixtureDiscovered.map(key).sort());
    for (const f of facts) expect(f.provenance).toBe('auto_detected');
  });

  it('runTenantHarvest reads every tenant path once and is per-read non-fatal', async () => {
    const fixtures: Record<string, unknown> = {};
    for (const [name, p] of Object.entries(TENANT_READS)) fixtures[p] = READS_A[name as keyof TenantReads];
    fixtures[TENANT_READS.subscribedSkus] = new Error('403');
    const client = new MockGraphClient(fixtures);
    const facts = await runTenantHarvest(client, () => new Date('2026-01-15T00:00:00.000Z'));
    expect(client.calls.sort()).toEqual(Object.values(TENANT_READS).sort());
    const ids = new Set(facts.map((f) => f.question_id));
    expect(ids.has('TCP.LIC.001')).toBe(false);
    expect(ids.has('TCP.LIC.002')).toBe(false);
    expect(ids.has('TCP.TI.002')).toBe(true);
  });

  it('nothing is inferred from absence: no reads, no facts; no removable-storage block, no S-27', () => {
    expect(tenantFactsFromReads({}, 'now')).toEqual([]);
    const facts = tenantFactsFromReads({ deviceConfigurations: { value: [{ storageBlockRemovableStorage: false }] } }, 'now');
    expect(facts.find((f) => f.question_id === 'S-27')).toBeUndefined();
  });

  it('a synced directory is not labelled with a sync product; GCC vs Commercial is not guessed', () => {
    const facts = tenantFactsFromReads(
      {
        users: { value: [{ id: 'x', userPrincipalName: 'x@contoso.example', onPremisesSyncEnabled: true }] },
        organization: { value: [{ id: 'g', displayName: 'C', verifiedDomains: [{ name: 'contoso.onmicrosoft.com', isDefault: true }] }] },
      },
      'now'
    );
    const by = new Map(facts.map((f) => [f.question_id, f.answer]));
    expect(by.get('TCP.IA.005')).toBe('yes');
    expect(by.has('TCP.IA.004')).toBe(false);
    expect(by.has('TCP.TI.004')).toBe(false);
  });

  it('MG-16: the /organization address becomes the Policy Inputs address pre-fills; no address, no facts', () => {
    const org = { id: 'g', displayName: 'C', verifiedDomains: [{ name: 'contoso.onmicrosoft.com', isDefault: true }] };
    const withAddress = tenantFactsFromReads(
      { organization: { value: [{ ...org, street: '1 Example Way', city: 'Testville', state: 'ZZ', postalCode: '00000' }] } },
      'now'
    );
    const by = new Map(withAddress.map((f) => [f.question_id, f]));
    expect(['PI.ORG.002', 'PI.ORG.003', 'PI.ORG.004', 'PI.ORG.005'].map((id) => by.get(id)?.answer)).toEqual([
      '1 Example Way',
      'Testville',
      'ZZ',
      '00000',
    ]);
    expect(by.get('PI.ORG.002')?.source).toBe('graph:organization');
    const without = tenantFactsFromReads({ organization: { value: [org] } }, 'now');
    expect(without.filter((f) => f.question_id.startsWith('PI.'))).toEqual([]);
  });

  it('the facts pass the SPA harvest-prefill seam as overridable pre-fills', () => {
    const facts = tenantFactsFromReads(READS_A, 'now');
    const prefill = applyHarvestFacts(facts, { 'TCP.CA.003': '9' });
    expect(prefill.answers['TCP.TI.002']).toBe(D);
    expect(prefill.provenances['TCP.TI.002']).toBe('auto_detected');
    expect(prefill.answers['TCP.CA.003']).toBeUndefined(); // the operator's answer wins
  });
});

describe('W1: the Intune security-baseline template read (baselineTemplateId)', () => {
  const tmpl = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    templateType: 'securityBaseline',
    platformType: 'windows10AndLater',
    isDeprecated: false,
    ...extra,
  });

  it('reads the beta-only templates list', () => {
    expect(TENANT_READS.deviceManagementTemplates).toBe('/beta/deviceManagement/templates');
  });

  it('exactly one current Windows 10+ security baseline gives an OPV.baselineTemplateId fact with its read', () => {
    const facts = tenantFactsFromReads(
      { deviceManagementTemplates: { value: [tmpl('t-1'), tmpl('t-old', { isDeprecated: true }), tmpl('t-edge', { templateType: 'microsoftEdgeSecurityBaseline' })] } },
      'now'
    );
    expect(facts).toEqual([
      { question_id: 'OPV.baselineTemplateId', answer: 't-1', provenance: 'auto_detected', confidence: 'high', captured_at: 'now', source: 'graph:deviceManagementTemplates' },
    ]);
  });

  it('several candidates, none, or a failed read give no fact (a choice is not a reading)', () => {
    expect(tenantFactsFromReads({ deviceManagementTemplates: { value: [tmpl('t-1'), tmpl('t-2')] } }, 'now')).toEqual([]);
    expect(tenantFactsFromReads({ deviceManagementTemplates: { value: [] } }, 'now')).toEqual([]);
    expect(tenantFactsFromReads({}, 'now')).toEqual([]);
  });

  it("the SPA's derived role template ids equal the harvest's ROLE_TEMPLATE", async () => {
    const { ENTRA_ROLE_TEMPLATE } = await import('@/features/plan/derive/operatorValues');
    expect(ENTRA_ROLE_TEMPLATE.globalAdministrator).toBe(ROLE_TEMPLATE.globalAdministrator);
    expect(ENTRA_ROLE_TEMPLATE.complianceAdministrator).toBe(ROLE_TEMPLATE.complianceAdministrator);
  });
});

describe('W5 (MG-02): the standing Global Administrator verdict (RR-ACT-AC_L2_3_1_5)', () => {
  const GA = ROLE_TEMPLATE.globalAdministrator;
  const verdict = (reads: TenantReads) => tenantFactsFromReads(reads, '2026-10-28T00:00:00.000Z').filter((f) => f.question_id === STANDING_GLOBAL_ADMIN_ACTIVITY);
  // S1 shape: permanent Global Administrator = the two break-glass accounts; the admin account holds it through PIM.
  const S1_LIKE: TenantReads = {
    users: { value: [{ id: 'user-46', userPrincipalName: `adm.one@${D}` }, { id: BG1, userPrincipalName: `bg1@${D}` }, { id: BG2, userPrincipalName: `bg2@${D}` }] },
    roleAssignments: { value: [{ principalId: BG1, roleDefinitionId: GA }, { principalId: BG2, roleDefinitionId: GA }, { principalId: 'user-46', roleDefinitionId: GA }] },
    roleEligibility: { value: [{ principalId: 'user-46', roleDefinitionId: GA, status: 'Provisioned' }] },
    conditionalAccess: { value: [{ id: 'ca-1', state: 'enabled', conditions: { users: { includeUsers: ['All'], excludeUsers: [BG1, BG2] } } }] },
  };

  it('only break-glass and PIM-eligible holders -> yes, from the role assignments read', () => {
    expect(verdict(S1_LIKE)).toEqual([
      { question_id: STANDING_GLOBAL_ADMIN_ACTIVITY, answer: 'yes', provenance: 'auto_detected', confidence: 'high', captured_at: '2026-10-28T00:00:00.000Z', source: 'graph:roleAssignments' },
    ]);
  });

  it('a permanent Global Administrator outside break-glass and PIM -> no (fixture (a): admin@ is standing; S3: three standing)', () => {
    expect(verdict(READS_A).map((f) => f.answer)).toEqual(['no']);
    const s3: TenantReads = {
      ...S1_LIKE,
      roleAssignments: { value: ['u1', 'u2', 'u3'].map((principalId) => ({ principalId, roleDefinitionId: GA })) },
      users: { value: ['u1', 'u2', 'u3'].map((id) => ({ id, userPrincipalName: `${id}@${D}` })) },
      roleEligibility: { value: [] },
    };
    expect(verdict(s3).map((f) => f.answer)).toEqual(['no']);
  });

  it('an eligibility for another role does not excuse a Global Administrator assignment', () => {
    const reads = { ...S1_LIKE, roleEligibility: { value: [{ principalId: 'user-46', roleDefinitionId: ROLE_TEMPLATE.securityAdministrator }] } };
    expect(verdict(reads).map((f) => f.answer)).toEqual(['no']);
  });

  it('nothing from absence: a missing read (assignments, eligibility, CA, users) or no Global Administrator assignment gives no fact', () => {
    for (const drop of ['roleAssignments', 'roleEligibility', 'conditionalAccess', 'users'] as const) {
      const reads = { ...S1_LIKE };
      delete reads[drop];
      expect(verdict(reads), drop).toEqual([]);
    }
    expect(verdict({ ...S1_LIKE, roleAssignments: { value: [{ principalId: 'user-46', roleDefinitionId: ROLE_TEMPLATE.securityAdministrator }] } })).toEqual([]);
  });
});

describe('W5c3 (SC-8b): break-glass exclusion group and named locations', () => {
  const BG_GROUP = 'group-12';
  const groups = {
    value: [
      { id: 'group-1', displayName: 'CUI-Authorized-Users', securityEnabled: true, groupTypes: [] },
      { id: BG_GROUP, displayName: 'S1-Break-Glass', securityEnabled: true, groupTypes: [] },
      { id: 'group-14', displayName: 'S1-Kiosk-Devices', securityEnabled: true, groupTypes: [] },
    ],
  };
  // customer.json: 9 enforced CA policies, each excluding the break-glass group (group-12).
  const caExcluding = (perPolicy: (i: number) => string[], states: string[] = Array(9).fill('enabled')) => ({
    value: states.map((state, i) => ({
      id: `caPolicy-${i + 1}`,
      displayName: `S1-CA0${i + 1}`,
      state,
      conditions: { users: { includeUsers: ['All'], excludeUsers: [], excludeGroups: perPolicy(i) }, applications: { includeApplications: ['All'] } },
      grantControls: { operator: 'OR', builtInControls: ['mfa'] },
    })),
  });
  const pa005 = (reads: TenantReads) => tenantFactsFromReads(reads, 'now').find((f) => f.question_id === 'TCP.PA.005');

  it('the one group every enabled policy excludes is the break-glass exclusion group', () => {
    const f = pa005({ conditionalAccess: caExcluding(() => [BG_GROUP]), groups });
    expect(f).toMatchObject({ answer: 'S1-Break-Glass', provenance: 'auto_detected', source: 'graph:conditionalAccess' });
    // A disabled policy that does not exclude it does not matter.
    expect(pa005({ conditionalAccess: caExcluding((i) => (i === 8 ? [] : [BG_GROUP]), [...Array(8).fill('enabled'), 'disabled']), groups })?.answer).toBe('S1-Break-Glass');
  });

  it('no fact when one enabled policy does not exclude it, when two groups qualify, when the group is unknown or nothing is excluded', () => {
    expect(pa005({ conditionalAccess: caExcluding((i) => (i === 3 ? [] : [BG_GROUP])), groups })).toBeUndefined();
    expect(pa005({ conditionalAccess: caExcluding(() => [BG_GROUP, 'group-14']), groups })).toBeUndefined();
    expect(pa005({ conditionalAccess: caExcluding(() => ['group-99']), groups })).toBeUndefined();
    expect(pa005({ conditionalAccess: caExcluding(() => []), groups })).toBeUndefined();
    expect(pa005({ conditionalAccess: caExcluding(() => [BG_GROUP]) })).toBeUndefined();
  });

  it('named locations become the bank lines Name|ip|<ranges> and Name|country|<codes>', () => {
    const facts = tenantFactsFromReads(
      {
        namedLocations: {
          value: [
            {
              '@odata.type': '#microsoft.graph.ipNamedLocation',
              id: 'namedLocation-1',
              displayName: 'S1 Office Egress',
              isTrusted: true,
              ipRanges: [
                { '@odata.type': '#microsoft.graph.iPv4CidrRange', cidrAddress: '198.51.100.0/24' },
                { '@odata.type': '#microsoft.graph.iPv4CidrRange', cidrAddress: '192.0.2.0/24' },
              ],
            },
            { '@odata.type': '#microsoft.graph.countryNamedLocation', id: 'namedLocation-2', displayName: 'United States', countriesAndRegions: ['US'] },
          ],
        },
      },
      'now'
    );
    expect(facts.find((f) => f.question_id === 'TCP.CA.002')).toMatchObject({
      answer: 'S1 Office Egress|ip|198.51.100.0/24 192.0.2.0/24, United States|country|US',
      source: 'graph:namedLocations',
    });
  });

  it('a named location with no range or country (a bare seed row), or no named locations, gives no fact', () => {
    const bare = { value: [{ id: 'namedLocation-1', displayName: 'Sim Named Location 1', isTrusted: true }] };
    expect(tenantFactsFromReads({ namedLocations: bare }, 'now').find((f) => f.question_id === 'TCP.CA.002')).toBeUndefined();
    expect(tenantFactsFromReads({ namedLocations: { value: [] } }, 'now').find((f) => f.question_id === 'TCP.CA.002')).toBeUndefined();
  });
});
