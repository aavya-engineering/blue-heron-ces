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
import { ObjectStore } from '../store/ObjectStore.js';
import { ResolverTable } from './ResolverTable.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';

/**
 * DEPTH-10.5 (PH-12 P12-R4, SI batch) simulator golden: for each new Stamper registry entry, the SET the
 * entry sends, then the GET it reads, returns the value its verification block expects. The routes are
 * the existing ones (Intune deviceConfigurations POST + /assign + ?$expand=assignments; Conditional
 * Access New-MgIdentityConditionalAccessPolicy + /identity/conditionalAccess/policies), so this batch
 * adds no resolver. The bodies are the registry SETs' hashtables as PowerShell sends them.
 */

type Row = Record<string, any>;
const DC = '/v1.0/deviceManagement/deviceConfigurations';
const CA = '/v1.0/identity/conditionalAccess/policies';
const CUI_GROUP = 'group-cui-1';
const BREAK_GLASS = 'user-breakglass-1';

describe('DEPTH-10.5 SI golden: SET then GET returns the expected value', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth10-si-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
    // The CA exclusion and the Intune assignment name objects that must exist (inputValidation.ts).
    await store.create('users', { id: BREAK_GLASS, userPrincipalName: 'breakglass@sim.example', accountEnabled: true });
    await store.create('groups', { id: CUI_GROUP, displayName: 'CUI Users' });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /**
   * POST the profile, assign it to the CUI group, read it back by name. The body is the parsed object: the
   * PowerShell shim turns a `-Body (... | ConvertTo-Json)` string back into an object before it posts.
   */
  async function intuneSetThenGet(body: Row): Promise<Row | undefined> {
    const created = (await table.resolveUri('POST', `https://graph.microsoft.us${DC}`, body)) as Row;
    expect(created.id).toBeTruthy();
    await table.resolveUri('POST', `https://graph.microsoft.us${DC}/${created.id}/assign`, {
      assignments: [{ target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: CUI_GROUP } }],
    });
    const list = ((await table.resolveUri('GET', `https://graph.microsoft.us${DC}?$expand=assignments`)) as { value: Row[] }).value;
    return list.find((d) => d.displayName === body.displayName);
  }

  async function caSetThenGet(body: Row): Promise<Row | undefined> {
    await table.resolveCmdlet('New-MgIdentityConditionalAccessPolicy', ['-BodyParameter', body]);
    const list = ((await table.resolveUri('GET', `https://graph.microsoft.us${CA}`)) as { value: Row[] }).value;
    return list.find((p) => p.displayName === body.displayName);
  }

  it('SI.L1-3.14.1.mde-onboarding: the Defender for Endpoint profile reads back with sample sharing, expedited telemetry and an assignment', async () => {
    expect(((await table.resolveUri('GET', `${DC}?$expand=assignments`)) as { value: Row[] }).value.find((d) => d.displayName === 'CMMC-MDE-Onboarding')).toBeUndefined();
    const read = await intuneSetThenGet({
      '@odata.type': '#microsoft.graph.windowsDefenderAdvancedThreatProtectionConfiguration',
      displayName: 'CMMC-MDE-Onboarding',
      description: 'CMMC L2: onboard devices to Microsoft Defender for Endpoint (EDR and Defender Vulnerability Management)',
      allowSampleSharing: true,
      enableExpeditedTelemetryReporting: true,
    });
    expect(read).toMatchObject({ '@odata.type': '#microsoft.graph.windowsDefenderAdvancedThreatProtectionConfiguration', allowSampleSharing: true, enableExpeditedTelemetryReporting: true });
    expect(read!.assignments).toHaveLength(1);
    expect(read!.assignments[0].target.groupId).toBe(CUI_GROUP);
  });

  it('SI.L2-3.14.6.defender-traffic-monitoring: network inspection, real-time monitoring, mail scanning and file monitoring read back', async () => {
    const read = await intuneSetThenGet({
      '@odata.type': '#microsoft.graph.windows10GeneralConfiguration',
      displayName: 'CMMC-Defender-TrafficMonitoring',
      description: 'CMMC L2: Defender network inspection of device traffic, real-time monitoring, incoming mail and download scanning',
      defenderRequireNetworkInspectionSystem: true,
      defenderRequireRealTimeMonitoring: true,
      defenderScanIncomingMail: true,
      defenderScanDownloads: true,
      defenderMonitorFileActivity: 'monitorAllFiles',
    });
    expect(read).toMatchObject({ defenderRequireNetworkInspectionSystem: true, defenderRequireRealTimeMonitoring: true, defenderScanIncomingMail: true, defenderMonitorFileActivity: 'monitorAllFiles' });
    expect(read!.assignments).toHaveLength(1);
  });

  it('SI.L2-3.14.7.signin-risk-policy: an enabled all-users policy on medium/high sign-in risk, MFA, every time', async () => {
    const read = await caSetThenGet({
      displayName: 'CMMC-SignInRisk-MFA',
      state: 'enabled',
      conditions: {
        users: { includeUsers: ['All'], excludeUsers: [BREAK_GLASS] },
        applications: { includeApplications: ['All'] },
        clientAppTypes: ['all'],
        signInRiskLevels: ['high', 'medium'],
      },
      grantControls: { operator: 'OR', builtInControls: ['mfa'] },
      sessionControls: { signInFrequency: { isEnabled: true, frequencyInterval: 'everyTime', authenticationType: 'primaryAndSecondaryAuthentication' } },
    });
    expect(read).toBeDefined();
    expect(read!.state).toBe('enabled');
    expect(read!.conditions.users.includeUsers).toEqual(['All']);
    expect(read!.conditions.users.excludeUsers).toEqual([BREAK_GLASS]);
    expect(read!.conditions.signInRiskLevels).toEqual(['high', 'medium']);
    expect(read!.grantControls.builtInControls).toEqual(['mfa']);
    expect(read!.sessionControls.signInFrequency.frequencyInterval).toBe('everyTime');
  });

  it('SI.L2-3.14.7.user-risk-policy: an enabled all-users policy on high user risk, MFA AND password change, every time', async () => {
    const read = await caSetThenGet({
      displayName: 'CMMC-UserRisk-Remediate',
      state: 'enabled',
      conditions: {
        users: { includeUsers: ['All'], excludeUsers: [BREAK_GLASS] },
        applications: { includeApplications: ['All'] },
        clientAppTypes: ['all'],
        userRiskLevels: ['high'],
      },
      grantControls: { operator: 'AND', builtInControls: ['mfa', 'passwordChange'] },
      sessionControls: { signInFrequency: { isEnabled: true, frequencyInterval: 'everyTime', authenticationType: 'primaryAndSecondaryAuthentication' } },
    });
    expect(read).toBeDefined();
    expect(read!.state).toBe('enabled');
    expect(read!.conditions.userRiskLevels).toEqual(['high']);
    expect(read!.grantControls).toMatchObject({ operator: 'AND', builtInControls: ['mfa', 'passwordChange'] });
    expect(read!.sessionControls.signInFrequency.frequencyInterval).toBe('everyTime');
  });

  it('the two risk policies are two objects (one per displayName), not one overwritten singleton', async () => {
    for (const [name, cond] of [['CMMC-SignInRisk-MFA', { signInRiskLevels: ['high'] }], ['CMMC-UserRisk-Remediate', { userRiskLevels: ['high'] }]] as const) {
      await table.resolveCmdlet('New-MgIdentityConditionalAccessPolicy', ['-BodyParameter', { displayName: name, state: 'enabled', conditions: cond }]);
    }
    const names = ((await table.resolveUri('GET', CA)) as { value: Row[] }).value.map((p) => p.displayName).sort();
    expect(names).toEqual(['CMMC-SignInRisk-MFA', 'CMMC-UserRisk-Remediate']);
  });
});
