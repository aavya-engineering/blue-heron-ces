// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5c1 EO-fetch: the directory users read selects what the evaluators read (signInActivity among
 * them), the PIM policy read expands rules, the settings-catalog read expands settings. Each is
 * paged, and the recorded query (describeRead, the evidence store's `query`) shows the
 * select/expand. A fetched read without the property or expansion leaves the dependent evaluator
 * not_assessed; with it, the condition is tested. Fixtures use simulator-style ids only.
 */
import { describe, it, expect } from '@jest/globals';
import type { SignalResult } from 'ces-shared/types/signal';
import {
  ComplianceSignalFetcher, DIRECTORY_USER_SELECT, PIM_POLICIES_URI, CONFIGURATION_POLICIES_URI,
} from '../ComplianceSignalFetcher.js';
import { evaluatorRegistry } from '../../mapping/evaluators/index.js';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function recordingSession(reply: (cmd: string) => string) {
  const stats = { cmds: [] as string[] };
  return {
    stats,
    execute: async (_engine: string, cmd: string) => {
      stats.cmds.push(cmd);
      return { stdout: reply(cmd), stderr: '', exitCode: 0, durationMs: 0 };
    },
  };
}
const stubPs = { runExchangeCommands: async (): Promise<SignalResult[]> => [], runPurviewCommands: async (): Promise<SignalResult[]> => [] };
const fetcherWith = (reply: (cmd: string) => string) => {
  const s = recordingSession(reply);
  return { s, f: new ComplianceSignalFetcher(s as any, stubPs as any) };
};
const envelope = (rows: unknown[]) => JSON.stringify({ value: rows });
const PAGING = "$u = $r.'@odata.nextLink'";

describe('W5c1 EO-fetch: query strings', () => {
  it('the users read selects every property the evaluators read, pages, and records the query', async () => {
    const { s, f } = fetcherWith(() => envelope([]));
    const out = await f.fetchCoverageSignals(NOW);
    const sig = out.find(x => x.signalId === 'directoryUsers')!;
    expect(sig.endpoint).toBe('/users');
    const uri = `/v1.0/users?$select=${DIRECTORY_USER_SELECT}&$top=999`;
    const cmd = s.stats.cmds.find(c => c.includes('/v1.0/users?'))!;
    expect(cmd).toContain(uri);
    expect(cmd).toContain(PAGING);
    for (const p of ['id', 'userPrincipalName', 'displayName', 'accountEnabled', 'userType', 'assignedLicenses', 'signInActivity',
      'createdDateTime', 'onPremisesSyncEnabled', 'passwordPolicies', 'lastPasswordChangeDateTime']) {
      expect(DIRECTORY_USER_SELECT.split(',')).toContain(p);
    }
    expect(f.describeRead(sig).query).toBe(`GET ${uri}`);
  });

  it('the PIM policy read filters to directory roles, expands rules, pages, and records the query', async () => {
    const { s, f } = fetcherWith(() => envelope([]));
    const [sig] = await f.fetchPimPolicies();
    expect(sig.signalId).toBe('pimPolicies');
    expect(sig.endpoint).toBe('/policies/roleManagementPolicies');
    expect(PIM_POLICIES_URI).toContain('$expand=rules');
    expect(PIM_POLICIES_URI).toContain("$filter=scopeId%20eq%20'/'%20and%20scopeType%20eq%20'DirectoryRole'");
    // single quotes are doubled inside the PowerShell literal
    expect(s.stats.cmds[0]).toContain(PIM_POLICIES_URI.replace(/'/g, "''"));
    expect(s.stats.cmds[0]).toContain(PAGING);
    expect(f.describeRead(sig).query).toBe(`GET ${PIM_POLICIES_URI}`);
  });

  it('the settings-catalog read expands settings, pages, records the query, and runs after deviceConfigurations', async () => {
    const { s, f } = fetcherWith(() => envelope([]));
    const [sig] = await f.fetchConfigurationPolicies();
    expect(sig.signalId).toBe('configurationPolicies');
    expect(sig.endpoint).toBe('/deviceManagement/configurationPolicies');
    // W5 cycle 3: and the policies' assignments.
    expect(CONFIGURATION_POLICIES_URI).toBe('/beta/deviceManagement/configurationPolicies?$expand=settings,assignments');
    expect(s.stats.cmds[0]).toContain(CONFIGURATION_POLICIES_URI);
    expect(s.stats.cmds[0]).toContain(PAGING);
    expect(f.describeRead(sig).query).toBe(`GET ${CONFIGURATION_POLICIES_URI}`);
    const ids = (await fetcherWith(() => '[]').f.fetchAllSignals()).map(x => x.signalId);
    expect(ids.indexOf('configurationPolicies')).toBe(ids.indexOf('deviceConfigurations') + 1);
  });
});

describe('W5c1 EO-fetch: fetched reads into the dependent evaluators', () => {
  const policy = (rules?: unknown[]) => ({ id: 'roleManagementPolicy-1', displayName: 'S1 Global Administrator', scopeId: '/', scopeType: 'DirectoryRole', ...(rules ? { rules } : {}) });
  const approvalRule = (required: boolean) => ({
    '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyApprovalRule', id: 'Approval_EndUser_Assignment',
    setting: { isApprovalRequired: required, approvalStages: [{ primaryApprovers: [{ '@odata.type': '#microsoft.graph.singleUser', userId: 'user-46' }] }] },
  });
  const pim = async (rows: unknown[]) => (await fetcherWith(() => envelope(rows)).f.fetchPimPolicies());

  it('AC.L2-3.1.4: policies without rules -> not_assessed; with rules the approval condition decides', async () => {
    const bare = evaluatorRegistry.pimApprovalEvaluator(await pim([policy()]));
    expect(bare.status).toBe('not_assessed');
    expect(bare.evidence).toContain('$expand=rules');
    expect(evaluatorRegistry.pimApprovalEvaluator(await pim([policy([approvalRule(true)])])).status).toBe('met');
    expect(evaluatorRegistry.pimApprovalEvaluator(await pim([policy([approvalRule(false)])])).status).toBe('not_met');
  });

  const user = (id: string, extra: Record<string, unknown> = {}) => ({
    id, userPrincipalName: `${id}@s1-mach.simtenant.onmicrosoft.us`, accountEnabled: true, userType: 'Member',
    createdDateTime: '2025-01-01T00:00:00.000Z', ...extra,
  });
  const signIn = (daysAgo: number) => ({ signInActivity: { lastSignInDateTime: new Date(NOW - daysAgo * DAY).toISOString() } });
  const usersRead = async (rows: unknown[]) => {
    const out = await fetcherWith(c => (c.includes('/v1.0/users?') ? envelope(rows) : envelope([]))).f.fetchCoverageSignals(NOW);
    return out.filter(x => x.signalId === 'directoryUsers').map(x => ({ ...x, timestamp: new Date(NOW).toISOString() }));
  };

  it('IA.L2-3.5.6: users without signInActivity -> not_assessed; with it the inactivity condition decides', async () => {
    const bare = evaluatorRegistry.accountDisableEvaluator(await usersRead([user('user-1'), user('user-2')]));
    expect(bare.status).toBe('not_assessed');
    expect(bare.evidence).toContain('signInActivity');
    expect(evaluatorRegistry.accountDisableEvaluator(await usersRead([user('user-1', signIn(3)), user('user-2', signIn(10))])).status).toBe('met');
    const stale = evaluatorRegistry.accountDisableEvaluator(await usersRead([user('user-1', signIn(3)), user('user-2', signIn(200))]));
    expect(stale.status).toBe('not_met');
    expect(stale.evidence).toContain('user-2');
  });

  // CM.L2-3.4.1 is presence-only (sim-b §9): it does not go not_assessed on a bare policy. Recorded
  // as it is; the expansion changes what its keyword scan sees.
  it('CM.L2-3.4.1: a bare settings-catalog policy reads met (presence only, unchanged); with settings expanded the scan sees them', async () => {
    const cfgRead = async (rows: unknown[]) => (await fetcherWith(() => envelope(rows)).f.fetchConfigurationPolicies());
    const bare = { id: 'configurationPolicy-1', name: 'S1 Windows 11 credential UI', platforms: 'windows10', technologies: 'mdm' };
    expect(evaluatorRegistry.securityBaselineEvaluator(await cfgRead([bare])).status).toBe('met');
    const expanded = { ...bare, settings: [{ id: '0', settingInstance: {
      '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance',
      settingDefinitionId: 'device_vendor_msft_policy_config_credentialsui_disablepasswordreveal',
      choiceSettingValue: { value: 'device_vendor_msft_policy_config_credentialsui_disablepasswordreveal_1' },
    } }] };
    const r = evaluatorRegistry.securityBaselineEvaluator(await cfgRead([expanded]));
    expect(r.status).toBe('partial');
    expect(r.evidence).toContain('password complexity');
  });
});
