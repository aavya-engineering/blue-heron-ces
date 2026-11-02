// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W5c3 (P-2): the discovery walk fills the registry's `{variable}` placeholders
// from reads Muster already makes, before running a get_command.
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MockGraphClient } from '../src/lib/graphClient.js';
import { runDiscovery, substituteVariables, type DiscoverySession, type RegistryGetEntry } from '../src/services/discoveryService.js';
import { ROLE_TEMPLATE, TENANT_READS } from '../src/services/harvestService.js';
import {
  WORKSPACE_READ,
  resolveDiscoveryVariables,
  variableCoverage,
  variablesFromTenantFacts,
  variablesFromWorkspaceRead,
} from '../src/services/discoveryVariables.js';

const D = 's1-mach.simtenant.onmicrosoft.us';
const OP = `adm.operator@${D}`;
const BG = `bg.access01@${D}`;
const SUB = '51510000-00a2-4000-8000-000000000001';

/** Graph reads shaped like the S1 sim tenant (fictional ids). */
const READS: Record<string, unknown> = {
  [TENANT_READS.organization]: {
    value: [{ id: '51510000-0000-4000-8000-000000000001', displayName: 'Sim Org (FICTIONAL)', verifiedDomains: [{ name: D, isDefault: true }] }],
  },
  [TENANT_READS.users]: {
    value: [
      { id: 'user-47', userPrincipalName: OP, onPremisesSyncEnabled: null },
      { id: 'user-50', userPrincipalName: BG, onPremisesSyncEnabled: null },
    ],
  },
  [TENANT_READS.roleAssignments]: {
    value: [
      { principalId: 'user-47', roleDefinitionId: ROLE_TEMPLATE.globalAdministrator },
      { principalId: 'user-50', roleDefinitionId: ROLE_TEMPLATE.globalAdministrator },
    ],
  },
  [TENANT_READS.conditionalAccess]: {
    value: [{ id: 'ca-1', state: 'enabled', conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-50'] }, applications: { includeApplications: ['All'] } }, grantControls: { builtInControls: ['mfa'] } }],
  },
  [TENANT_READS.me]: { userPrincipalName: OP },
};
/** The az workspace read (Get-AzOperationalInsightsWorkspace | ConvertTo-Json) on the S1 facade. */
const WORKSPACE = JSON.stringify(
  {
    id: 'logAnalyticsWorkspace-1',
    name: 'law-s1-mach-prod',
    ResourceId: `/subscriptions/${SUB}/resourceGroups/rg-s1-mach-prod/providers/Microsoft.OperationalInsights/workspaces/law-s1-mach-prod`,
    Location: 'usgovvirginia',
  },
  null,
  4
);
const sessionWith = (workspace: string | null): DiscoverySession => ({
  execute: vi.fn(async (_e: string, cmd: string) =>
    cmd === WORKSPACE_READ && workspace !== null
      ? { stdout: workspace, stderr: '', exitCode: 0, durationMs: 1 }
      : { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
  ),
});

describe('W5c3 P-2: substituteVariables', () => {
  it('fills a known placeholder and leaves unknown ones, script blocks and @{} hashtables alone', () => {
    const cmd = `Get-MgUser -Filter "userPrincipalName eq '{operatorUPN}'" | Where-Object { $_.DisplayName -eq 'Admin-{adminUserName}' } | Select @{n='x';e={1}}`;
    expect(substituteVariables(cmd, { operatorUPN: OP })).toBe(
      `Get-MgUser -Filter "userPrincipalName eq '${OP}'" | Where-Object { $_.DisplayName -eq 'Admin-{adminUserName}' } | Select @{n='x';e={1}}`
    );
    expect(substituteVariables(cmd, {})).toBe(cmd);
    expect(substituteVariables("'{tenantName}'", { tenantName: '' })).toBe("'{tenantName}'");
  });
});

describe('W5c3 P-2: one test per variable', () => {
  it('resolves every documented variable from the S1-shaped reads', async () => {
    const vars = await resolveDiscoveryVariables(new MockGraphClient(READS), sessionWith(WORKSPACE));
    expect(vars).toEqual({
      operatorUPN: OP,
      breakGlassUPN: BG,
      tenantId: '51510000-0000-4000-8000-000000000001',
      tenantName: 's1-mach',
      primaryDomain: D,
      operatorUserId: 'user-47',
      roleDefId: ROLE_TEMPLATE.globalAdministrator,
      complianceRoleId: ROLE_TEMPLATE.complianceAdministrator,
      lawWorkspaceName: 'law-s1-mach-prod',
      resourceGroup: 'rg-s1-mach-prod',
      subscriptionId: SUB,
      // W5c4: the strengths read is not served here, so the platform's built-in id.
      phishingResistantStrengthId: '00000000-0000-0000-0000-000000000004',
      // W5c7: always set; no answered convention here, so Stamper's match-nothing pattern.
      adminNamingPattern: '(?!)',
    });
  });

  const fact = (question_id: string, answer: string) => ({ question_id, answer, provenance: 'auto_detected' as const, confidence: 'high' as const, captured_at: 'now', source: 'graph:x' });
  it('operatorUPN <- TCP.MU.004 (graph:me); absent under app-only (no /me)', () => {
    expect(variablesFromTenantFacts([fact('TCP.MU.004', OP)]).operatorUPN).toBe(OP);
    expect(variablesFromTenantFacts([]).operatorUPN).toBeUndefined();
  });
  it('breakGlassUPN <- the first TCP.IA.001 account', () => {
    expect(variablesFromTenantFacts([fact('TCP.IA.001', `${BG}, bg.access02@${D}`)]).breakGlassUPN).toBe(BG);
  });
  it('tenantId <- TCP.TI.001', () => {
    expect(variablesFromTenantFacts([fact('TCP.TI.001', 'tid-1')]).tenantId).toBe('tid-1');
  });
  it('tenantName <- the primary domain first label (TCP.TI.002)', () => {
    expect(variablesFromTenantFacts([fact('TCP.TI.002', D)]).tenantName).toBe('s1-mach');
  });
  it('operatorUserId <- the users read id of operatorUPN (case-insensitive); none without the operator', () => {
    expect(variablesFromTenantFacts([fact('TCP.MU.004', OP.toUpperCase())], READS[TENANT_READS.users]).operatorUserId).toBe('user-47');
    expect(variablesFromTenantFacts([], READS[TENANT_READS.users]).operatorUserId).toBeUndefined();
  });
  it('roleDefId and complianceRoleId <- the built-in role templates (platform constants)', () => {
    const v = variablesFromTenantFacts([]);
    expect(v.roleDefId).toBe('62e90394-69f5-4237-9190-012177145e10');
    expect(v.complianceRoleId).toBe('17315797-102d-40b4-93e0-432062caca18');
  });
  it('lawWorkspaceName, resourceGroup, subscriptionId <- the one workspace; several, none or text: nothing', () => {
    expect(variablesFromWorkspaceRead(WORKSPACE)).toEqual({ lawWorkspaceName: 'law-s1-mach-prod', resourceGroup: 'rg-s1-mach-prod', subscriptionId: SUB });
    expect(variablesFromWorkspaceRead(`[${WORKSPACE},${WORKSPACE}]`)).toEqual({});
    expect(variablesFromWorkspaceRead('[]')).toEqual({});
    expect(variablesFromWorkspaceRead('Name : law')).toEqual({});
    // An explicit ResourceGroupName wins over the ResourceId segment.
    expect(variablesFromWorkspaceRead(JSON.stringify({ Name: 'law-x', ResourceGroupName: 'rg-x' }))).toEqual({ lawWorkspaceName: 'law-x', resourceGroup: 'rg-x' });
  });
  it('adminUserName is never resolved (no read holds it); failed reads give no value', async () => {
    const failing = { get: async () => { throw new Error('403'); } };
    const vars = await resolveDiscoveryVariables(failing, sessionWith(null));
    expect(vars).toEqual({
      roleDefId: ROLE_TEMPLATE.globalAdministrator,
      complianceRoleId: ROLE_TEMPLATE.complianceAdministrator,
      // W5c4: a platform constant, not a reading (see discovery.lookup.test.ts).
      phishingResistantStrengthId: '00000000-0000-0000-0000-000000000004',
      adminNamingPattern: '(?!)',
    });
    expect('adminUserName' in vars).toBe(false);
  });
});

describe('W5c3 P-2: the walk runs the substituted command', () => {
  it('runDiscovery executes get_command with the values, and the literal command without them', async () => {
    const entry: RegistryGetEntry = {
      entry_id: 'AC.L2-3.1.1.operator-discover',
      control_ids: ['AC.L1-3.1.1'],
      engine: 'mgraph',
      get_command: `Get-MgUser -Filter "userPrincipalName eq '{operatorUPN}'" | ConvertTo-Json`,
    };
    const seen: string[] = [];
    const session: DiscoverySession = { execute: vi.fn(async (_e: string, cmd: string) => (seen.push(cmd), { stdout: '', stderr: '', exitCode: 0, durationMs: 1 })) };
    await runDiscovery([entry], session, { write: (id) => id }, { variables: { operatorUPN: OP } });
    await runDiscovery([entry], session, { write: (id) => id });
    expect(seen).toEqual([`Get-MgUser -Filter "userPrincipalName eq '${OP}'" | ConvertTo-Json`, entry.get_command]);
  });
});

describe('W5c3 P-2: entries affected (the registry, read-only)', () => {
  const root = path.resolve('..', '..', 'ces-stamper', 'src', 'registry');
  const files = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'].map((f) => path.join(root, f));
  it.skipIf(!files.every((f) => fs.existsSync(f)))('counts the get_commands with placeholders the S1 variables fill', async () => {
    const entries = files.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).entries as Array<{ entry_id: string; get_command?: string; manual_only?: boolean }>);
    const vars = await resolveDiscoveryVariables(new MockGraphClient(READS), sessionWith(WORKSPACE));
    const c = variableCoverage(entries, vars);
    console.log('[W5c3 P-2] variable coverage', JSON.stringify(c));
    expect(c.withPlaceholders).toBeGreaterThan(0);
    expect(c.filled + c.partial).toBeGreaterThan(0);
    expect(c.filled).toBeLessThanOrEqual(c.withPlaceholders);
  });
});
