// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W7-EO: (4) AC.L1-3.1.1 credits only a policy that targets all users or a group; (5) founder ruling 1:
 * no SC.L2-3.13.15 / SI.L1-3.14.2 evaluator credits a built-in Exchange protection policy; (6) founder
 * ruling 2: the sign-in frequency bound is the CES 8-hour baseline (an organisation value only tightens
 * it), and a tenant policy that signs in less often is a reconciliation row naming both values.
 * Simulator-style ids and fictional names only.
 */
import { describe, test, expect } from '@jest/globals';
import type { SignalResult } from 'ces-shared/types/signal';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index.js';
import { REQUIREMENT_DEFAULTS } from '../../../src/eo/mapping/evaluators/conditions.js';
import { buildPolicyReconciliation, applyPolicyReconciliation, RECONCILIATION_SOURCES, POLICY_LEAD, type TenantRead } from '../../../src/eo/ssp/PolicyReconciliation.js';

const TS = '2026-10-29T03:06:24.000Z';
const sig = (signalId: string, endpoint: string, rows: unknown[], source: 'graph' | 'powershell' = 'graph'): SignalResult =>
  ({ signalId, source, endpoint, timestamp: TS, rawData: { value: rows }, status: 'success' } as SignalResult);
const fn = (name: string) => evaluatorRegistry[name];
const ca = (rows: unknown[]) => sig('conditionalAccess', '/identity/conditionalAccess/policies', rows);

const policy = (displayName: string, users: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: displayName, displayName, state: 'enabled',
  conditions: { users, applications: { includeApplications: ['All'] } },
  grantControls: { operator: 'AND', builtInControls: ['mfa', 'compliantDevice'] }, ...extra,
});

describe('W7-EO (4) AC.L1-3.1.1: caEnforcementEvaluator counts only all-users or group policies', () => {
  test('a policy for specific users or roles only is not counted (was credited as the baseline group)', () => {
    const v = fn('caEnforcementEvaluator')([ca([policy('Pilot users MFA and compliant device', { includeUsers: ['user-3'], includeRoles: ['62e90394-69f5-4237-9190-012177145e10'] })])]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain("Policy 'Pilot users MFA and compliant device' targets neither all users nor a group, so it is not counted");
    expect(v.evidence).not.toContain('Using baseline group');
  });
  test("S1-CA08's shape (all users, admin portals only) still credits: the app scope is FQ-4, not changed here", () => {
    const v = fn('caEnforcementEvaluator')([ca([policy('S1-CA08 Admin portals - compliant device and MFA', { includeUsers: ['All'], excludeUsers: ['user-50', 'user-51'] }, {
      conditions: { users: { includeUsers: ['All'] }, applications: { includeApplications: ['MicrosoftAdminPortals'] } },
    })])]);
    expect(v.status).toBe('met');
  });
  test("CES's CMMC-MFA-CompliantDevice (the CUI group) credits", () => {
    expect(fn('caEnforcementEvaluator')([ca([policy('CMMC-MFA-CompliantDevice', { includeGroups: ['group-cui'], excludeUsers: ['user-50'] })])]).status).toBe('met');
  });
});

describe('W7-EO (5) ruling 1: no built-in Exchange protection policy credits SC.L2-3.13.15 or SI.L1-3.14.2', () => {
  const builtIn = { Identity: 'Built-In Protection Policy', Name: 'Built-In Protection Policy', IsDefault: true, IsBuiltInProtection: true, Enable: true, EnableSafeLinksForEmail: true };
  const exchange = [
    sig('safeLinksPolicy', 'Get-SafeLinksPolicy', [builtIn], 'powershell'),
    sig('safeAttachmentPolicy', 'Get-SafeAttachmentPolicy', [builtIn], 'powershell'),
    sig('antiPhishPolicy', 'Get-AntiPhishPolicy', [{ Identity: 'Office365 AntiPhish Default', IsDefault: true, Enabled: true }], 'powershell'),
    sig('malwareFilterPolicy', 'Get-MalwareFilterPolicy', [{ Identity: 'Default', IsDefault: true }], 'powershell'),
  ];
  test('SC.L2-3.13.15 (emailProtectionEvaluator): built-in Exchange policies alone decide nothing; its verdict names no policy', () => {
    const v = fn('emailProtectionEvaluator')(exchange);
    expect(v.status).not.toBe('met');
    expect(v.evidence).not.toMatch(/Built-In Protection Policy|IsDefault/);
  });
  test('SI.L1-3.14.2 (malwareProtectionL1Evaluator): built-in Exchange policies alone decide nothing (it reads Intune Defender settings)', () => {
    const v = fn('malwareProtectionL1Evaluator')(exchange);
    expect(v.status).not.toBe('met');
    expect(v.evidence).not.toMatch(/Built-In Protection Policy|IsDefault/);
  });
});

describe('W7-EO (6) ruling 2: the sign-in frequency bound is the CES 8-hour baseline', () => {
  const freq = (displayName: string, value: number, users: Record<string, unknown>, type = 'hours') => ({
    id: displayName, displayName, state: 'enabled', conditions: { users, applications: { includeApplications: ['All'] } },
    sessionControls: { signInFrequency: { value, type, isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } },
  });
  const CA09 = freq('S1-CA09 Session lifetime 12h - browser', 12, { includeUsers: ['All'], excludeGroups: ['group-12'] });
  const CES = freq('CMMC-SessionTimeout', 8, { includeGroups: ['group-cui'], excludeUsers: ['user-50'] });

  test('the default is 8 hours', () => {
    expect(REQUIREMENT_DEFAULTS.SIGN_IN_FREQUENCY_MAX_HOURS).toBe(8);
  });
  test("S1 after E6: met on CES's 8-hour policy only; the 12-hour policy earns no credit", () => {
    const v = fn('sessionTimeoutEvaluator')([ca([CA09, CES])]);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("'CMMC-SessionTimeout' end sessions by sign-in frequency within 8 h");
    expect(v.evidence).not.toContain('S1-CA09');
  });
  test('the 12-hour policy alone is not met (was met under the 24-hour default)', () => {
    expect(fn('sessionTimeoutEvaluator')([ca([CA09])]).status).toBe('not_met');
  });
  test('an organisation value of 12 h does not relax the bound; one of 4 h tightens it', () => {
    const relax = fn('sessionTimeoutEvaluator')([ca([CA09, CES])], { expected: [{ path: 'sessionControls.signInFrequency.value', op: 'lte', value: 12, source: 'tm' }] });
    expect(relax.status).toBe('met');
    expect(relax.evidence).toContain('within 8 h (CES baseline; the 12 h organisation value: TM expected value (tm) would relax it (founder ruling 2))');
    expect(relax.evidence).not.toContain('S1-CA09');
    const tighten = fn('sessionTimeoutEvaluator')([ca([CA09, CES])], { expected: [{ path: 'sessionControls.signInFrequency.value', op: 'lte', value: 4, source: 'tm' }] });
    expect(tighten.status).toBe('not_met');
    expect(tighten.evidence).toContain('within 4 h');
  });

  const read = (sourceId: string, payload: unknown, query: string): TenantRead => ({ sourceId, recordId: `rec-${sourceId}`, query, collectedAt: TS, payloadSha256: 'c'.repeat(64), payload });
  const ODPS = { account_lockout_threshold: 3 };
  const controlIdOf = (n: string) => (n === '3.1.11' ? 'AC.L2-3.1.11' : n === '3.1.8' ? 'AC.L2-3.1.8' : undefined);

  test('the conditional access read is a reconciliation source', () => {
    expect(RECONCILIATION_SOURCES).toContain('conditionalAccess');
  });
  test('S1: one reconciliation row naming the 8-hour baseline and the 12-hour policy; the 8-hour policy gives none', () => {
    const reads = new Map([['conditionalAccess', read('conditionalAccess', { value: [CA09, CES, { ...freq('Disabled 24h', 24, { includeUsers: ['All'] }), state: 'disabled' }] }, 'Get-MgIdentityConditionalAccessPolicy')]]);
    const rows = buildPolicyReconciliation(ODPS, reads, controlIdOf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      controlId: 'AC.L2-3.1.11', odpId: 'CES.BASELINE', odpKey: 'sign_in_frequency_hours',
      policyValue: 'at most 8 hours (CES baseline, founder ruling 2; sign_in_frequency_hours)', tenantValue: '12 hours',
      sourceRows: ["conditional access policy 'S1-CA09 Session lifetime 12h - browser' signInFrequency = 12 hours"],
    });
    expect(rows[0].statement).toContain('AC.L2-3.1.11 CES.BASELINE: Policy states at most 8 hours');
    expect(rows[0].statement).toContain('the weaker policy earns no credit and no control status changes');
    expect(rows[0].statement).not.toMatch(/SPRS|projected/i);
  });
  test('S2 / S3 (no organisation session policy, CES 8 h only) and a days-based 1-day policy', () => {
    expect(buildPolicyReconciliation(ODPS, new Map([['conditionalAccess', read('conditionalAccess', { value: [CES] }, 'q')]]), controlIdOf)).toEqual([]);
    const day = buildPolicyReconciliation(ODPS, new Map([['conditionalAccess', read('conditionalAccess', { value: [freq('Daily', 1, { includeUsers: ['All'] }, 'days')] }, 'q')]]), controlIdOf);
    expect(day.map(r => r.tenantValue)).toEqual(['24 hours']);
  });
  test('on the SSP: the row is in policyReconciliation[] and the posture statements; idempotent; statuses untouched', () => {
    const ssp: any = {
      controlImplementations: [{ control_id: 'AC.L2-3.1.11', nist_ref: '3.1.11', status: 'met' }],
      postureReconciliation: { rows: [], statements: [] },
    };
    const reads = new Map([['conditionalAccess', read('conditionalAccess', { value: [CA09, CES] }, 'Get-MgIdentityConditionalAccessPolicy')]]);
    applyPolicyReconciliation(ssp, ODPS, reads);
    applyPolicyReconciliation(ssp, ODPS, reads);
    expect(ssp.policyReconciliation.map((r: any) => [r.controlId, r.odpId, r.tenantValue])).toEqual([['AC.L2-3.1.11', 'CES.BASELINE', '12 hours']]);
    expect(ssp.postureReconciliation.statements.filter((s: string) => s.startsWith(POLICY_LEAD))).toHaveLength(1);
    expect(ssp.postureReconciliation.statements.filter((s: string) => s.startsWith('AC.L2-3.1.11 CES.BASELINE'))).toHaveLength(1);
    expect(ssp.controlImplementations[0].status).toBe('met');
  });
});
