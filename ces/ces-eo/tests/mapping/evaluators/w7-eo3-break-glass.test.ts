// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W7-EO3 (AC.L2-3.1.7): the organisation's designated break-glass account (TM tenant_identity
 * breakGlassUserId / breakGlassUPN, or the supplied break-glass list) holds a standing Global Administrator
 * by design: it is exempt from the standing-admin finding and listed as "break-glass (exempt)". The
 * exemption follows the designation only, never a name pattern. Simulator-style ids and fictional names only.
 */
import { describe, test, expect } from '@jest/globals';
import type { SignalResult } from 'ces-shared/types/signal';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index.js';
import { evaluatorContextsFromTm } from '../../../src/eo/mapping/evaluators/tmContext.js';
import { COLLECTED } from '../../../src/eo/collect/Collector.js';

const TS = '2026-10-29T03:06:24.000Z';
const sig = (signalId: string, endpoint: string, rows: unknown[]): SignalResult =>
  ({ signalId, source: 'graph', endpoint, timestamp: TS, rawData: { value: rows }, status: 'success' } as SignalResult);
const run = evaluatorRegistry.privilegedFunctionEvaluator;
const GA = '62e90394-69f5-4237-9190-012177145e10';
const LIC = [{ disabledPlans: [], skuId: 'sim-sku-g5-gcchigh' }];
const domain = 'simtenant.onmicrosoft.us';
const user = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `user-${n}`, userPrincipalName: `sim.user${n}@${domain}`, displayName: `Sim User ${n}`, accountEnabled: true, assignedLicenses: LIC, ...extra,
});
const users = [user(1), user(2, { jobTitle: 'Emergency Access (Break Glass)' }), user(3), user(4),
  user(9, { userPrincipalName: `breakglass.ops@${domain}`, displayName: 'Breakglass Ops' })];
const standing = (...principals: string[]) => sig('roleAssignmentsAll', '/roleManagement/directory/roleAssignments',
  principals.map((p, i) => ({ id: `roleAssignment-${i + 1}`, principalId: p, roleDefinitionId: GA, directoryScopeId: '/' })));
const eligible = sig('roleEligibilitySchedules', '/roleManagement/directory/roleEligibilitySchedules',
  [{ id: 'elig-1', principalId: 'user-3', roleDefinitionId: GA, directoryScopeId: '/' }]);
const noActivations = sig(COLLECTED.PIM_ACTIVATIONS, '/roleManagement/directory/roleAssignmentScheduleRequests', []);
const reads = (...principals: string[]): SignalResult[] => [sig('directoryUsers', '/users', users), standing(...principals), eligible, noActivations];
const tmCtx = (tenantIdentity: Record<string, unknown>, signals: SignalResult[]) =>
  evaluatorContextsFromTm({ tenant_manifest: { tenant_identity: { tenant_id: 'sim-tenant-muster-partial', ...tenantIdentity } } }, signals, { tenantId: 'sim-tenant-muster-partial' })
    .forControl('AC.L2-3.1.7');
const EXEMPT_2 = `break-glass (exempt): user-2 (sim.user2@${domain}, 'Sim User 2') standing Global Administrator`;

describe('W7-EO3 AC.L2-3.1.7: the designated break-glass account is exempt from the standing-admin finding', () => {
  test('(1) the designated break-glass standing GA alone, other privileged roles PIM-eligible -> met, listed as exempt', () => {
    const signals = reads('user-2');
    const v = run(signals, tmCtx({ breakGlassUPN: `sim.user2@${domain}` }, signals));
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("every standing privileged assignment is held by the organisation's designated break-glass account(s)");
    expect(v.evidence).toContain('1 privileged eligibility(ies)');
    expect(v.evidence).toContain(EXEMPT_2);
  });

  test('(2) the break-glass account plus a standing licensed normal account -> not_met, the finding names only the normal account', () => {
    const signals = reads('user-1', 'user-2');
    const v = run(signals, tmCtx({ breakGlassUserId: 'user-2' }, signals));
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain('1 standing privileged assignment(s) on accounts that are not dedicated admin accounts');
    expect(v.evidence).toContain(`user-1 (sim.user1@${domain}, 'Sim User 1') holds standing Global Administrator as a licensed normal user account`);
    expect(v.evidence.split('; break-glass (exempt): ')[0]).not.toContain('user-2');
    expect(v.evidence).toContain(EXEMPT_2);
  });

  test('(3) a non-designated account with "breakglass" in its name is still a violation', () => {
    const signals = reads('user-9', 'user-2');
    const v = run(signals, tmCtx({ breakGlassUserId: 'user-2' }, signals));
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain(`user-9 (breakglass.ops@${domain}, 'Breakglass Ops') holds standing Global Administrator as a licensed normal user account`);
    expect(v.evidence).toContain(EXEMPT_2);
    // With no designation at all, both accounts are named (no name or job-title pattern exempts).
    const none = run(signals);
    expect(none.status).toBe('not_met');
    expect(none.evidence).toContain('2 standing privileged assignment(s)');
    expect(none.evidence).not.toContain('break-glass (exempt)');
  });

  test('without the PIM eligibility read, a break-glass-only tenant is not credited (the activation records still decide)', () => {
    const signals = [sig('directoryUsers', '/users', users), standing('user-2'), noActivations];
    const v = run(signals, { designatedBreakGlassIds: ['user-2'] });
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toContain(EXEMPT_2);
  });

  test('the TM designation feeds only designatedBreakGlassIds, not the shared break-glass list', () => {
    const signals = [sig('directoryUsers', '/users', users)];
    expect(tmCtx({ breakGlassUPN: `SIM.USER2@${domain}`, breakGlassUserId: 'user-2' }, signals)).toEqual({ designatedBreakGlassIds: ['user-2'] });
    expect(tmCtx({ breakGlassUPN: `nobody@${domain}` }, signals)).toBeUndefined();
  });
});
