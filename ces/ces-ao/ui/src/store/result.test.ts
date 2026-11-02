// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the request-flow view helpers are ports of the legacy page; pin their outputs.

import { describe, expect, it } from 'vitest';
import { A02, F12 } from '../test/fixtures';
import {
  costFields,
  costNoticeFromReply,
  dp2Text,
  firewallState,
  initialInputs,
  objectiveGroups,
  requestKey,
  resultView,
  twoPersonFromReply,
} from './result';

describe('resultView (legacy displayExecutionResult)', () => {
  it('maps the reply shapes to the AO-UI-TEST-HOOKS states', () => {
    expect(resultView({ success: true, evidence: { outcome: 'dry_run', metadata: { dryRun: true } } }, 'c1').state).toBe('dry_run');
    expect(resultView({ success: true, evidence: { outcome: 'automated_success', complianceVerdict: 'SAT' } }, 'c1')).toMatchObject({
      state: 'executed',
      badge: 'SUCCESS',
      verdict: 'SAT',
      evidence: { sat: true },
    });
    expect(resultView({ success: false, error: 'Missing required parameter: targetUPN' }, 'c1')).toMatchObject({ state: 'denied', badge: 'REFUSED' });
    expect(resultView({ success: false, result: { error: 'boom' }, evidence: { outcome: 'automated_failure' } }, 'c1')).toMatchObject({ state: 'failed', output: 'boom' });
    expect(resultView({ success: false, applyGuard: 'refused', error: 'guard', result: { error: 'guard' }, evidence: { outcome: 'denied_apply_guard' } }, 'c1').state).toBe('denied');
    expect(resultView({ status: 'pending_approval', approvalId: 'a1' }, 'c1')).toMatchObject({ state: 'pending_approval', approvalId: 'a1', outcome: 'blocked_pending_approval' });
  });

  it('prefers the server correlation id, else the one sent', () => {
    expect(resultView({ success: true, correlationId: 'srv' }, 'sent').correlationId).toBe('srv');
    expect(resultView({ success: true }, 'sent').correlationId).toBe('sent');
  });
});

describe('two-person and cost signals', () => {
  it('reads the two-person mode only from the server record', () => {
    expect(twoPersonFromReply({ status: 'pending_approval' })).toBe(true);
    expect(twoPersonFromReply({ evidence: { metadata: { twoPersonApproval: { mode: 'off' } } } })).toBe(false);
    expect(twoPersonFromReply({ evidence: { metadata: { twoPersonApproval: { mode: 'on' } } } })).toBe(true);
    expect(twoPersonFromReply({ success: true })).toBeNull();
  });

  it('takes a cost notice only from a recurring classification with hash and figure', () => {
    const reply = { evidence: { metadata: { costGate: { classification: 'recurring', ackHash: 'h', monthlyUsd: 12.5, priceDate: 'd' } } } };
    const n = costNoticeFromReply(reply, 'F-12')!;
    expect(n).toMatchObject({ opId: 'F-12', ackHash: 'h', monthlyUsd: 12.5 });
    expect(dp2Text(n)).toBe('F-12 12.50');
    expect(costNoticeFromReply({ evidence: { metadata: { costGate: { classification: 'free' } } } }, 'F-12')).toBeNull();
  });

  it('builds DP-1 only with the tick and a notice for this op; DP-2 whenever typed', () => {
    const n = { opId: 'F-12', ackHash: 'h', monthlyUsd: 1, priceDate: 'd' };
    const form = { ackChecked: true, noOtherMeans: ' why ', confirmCost: ' F-12 1.00 ', operator: 'op@example.test' };
    expect(costFields(F12, n, form, () => 'T')).toEqual({
      costAck: { opId: 'F-12', ackHash: 'h', monthlyUsd: 1, priceDate: 'd', operator: 'op@example.test', at: 'T', noOtherMeans: 'why' },
      confirmCost: 'F-12 1.00',
    });
    expect(costFields(F12, n, { ...form, ackChecked: false }).costAck).toBeUndefined();
    expect(costFields(F12, { ...n, opId: 'F-11' }, form).costAck).toBeUndefined();
    expect(costFields(A02, n, form)).toEqual({});
  });
});

describe('form helpers', () => {
  it('fills sourced params from bindings and selects from the first option', () => {
    expect(initialInputs(A02, { tenantDomain: 'd.example.test' })).toEqual({ targetUPN: '', tenantDomain: 'd.example.test', reason: 'leaver' });
  });

  it('keys a request by tenant, command and inputs, independent of key order', () => {
    expect(requestKey('t', 'A-02', { a: '1', b: '2' })).toBe(requestKey('t', 'A-02', { b: '2', a: '1' }));
    expect(requestKey('t', 'A-02', { a: '1' })).not.toBe(requestKey('t', 'A-02', { a: '2' }));
    expect(requestKey('t', 'A-02', {})).not.toBe(requestKey('u', 'A-02', {}));
  });

  it('groups objectives under the command practices (display only)', () => {
    expect(objectiveGroups(A02)).toEqual([
      { control: 'AC.L1-3.1.1', objectives: ['AC.L1-3.1.1[a]'] },
      { control: 'PS.L2-3.9.2', objectives: ['PS.L2-3.9.2[b]'] },
    ]);
  });

  it('reads the firewall state as the legacy pre-check does', () => {
    const ok = (stdout: string) => firewallState('F-11', true, { success: true, result: { stdout } });
    expect(ok(JSON.stringify({ AllocationState: 'Deallocated', ProvisioningState: 'Succeeded' }))).toMatchObject({
      badge: 'DEALLOCATED',
      stateClass: 'deallocated',
      prov: 'SUCCEEDED',
      warning: 'Firewall is already DEALLOCATED — proceeding may error.',
    });
    expect(ok('AllocationState: Allocated')).toMatchObject({ badge: 'ALLOCATED', warning: undefined });
    expect(ok('nothing')).toMatchObject({ badge: 'STATE UNKNOWN' });
    expect(firewallState('F-11', false, { error: 'no tenant' })).toMatchObject({ badge: 'REFUSED' });
  });
});
