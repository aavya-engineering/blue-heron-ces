// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2: the four evaluators that read collected records test a condition on the rows,
 * not their presence (fixture rows in the recorded shapes):
 *  - AU.L2-3.3.1 auditEventsEvaluator: UAL records exist for the window, each with event and time,
 *    and they cover Entra ID, Exchange and SharePoint;
 *  - AU.L2-3.3.2 auditReviewEvaluator: every sign-in / directory audit names its actor, one a user;
 *  - AU.L2-3.3.6 auditReductionEvaluator: the date-bounded UAL query returned rows;
 *  - AC.L2-3.1.7 privilegedFunctionEvaluator: each PIM activation is logged with principal, role,
 *    action and time.
 * Unread or empty reads stay not_assessed (W1.0); only a non-empty read failing the test is not_met.
 */
import type { SignalResult } from 'ces-shared/types/signal';
import { evaluatorRegistry, PRESENCE_ONLY_EVALUATORS } from '../../../src/eo/mapping/evaluators/index';
import { COLLECTED, UAL_ENDPOINT } from '../../../src/eo/collect/index';
import { fixture } from './scriptedTenant';

const T = '2026-10-27T12:00:00.000Z';
const view = (signalId: string, endpoint: string, rows: unknown[], source: 'graph' | 'powershell' = 'graph'): SignalResult =>
  ({ signalId, source, endpoint, timestamp: T, rawData: { value: rows }, status: 'success' });
const failed = (signalId: string, endpoint: string, status: 'error' | 'not_assessed' = 'error'): SignalResult =>
  ({ signalId, source: 'graph', endpoint, timestamp: T, rawData: null, status, error: 'read failed: timed out' });

const UAL = fixture('ual-rows.json').rows as Array<Record<string, unknown>>;
const DA = fixture('directory-audits.json').value as Array<Record<string, unknown>>;
const SI = fixture('sign-ins.json').value as Array<Record<string, unknown>>;
const PIM = fixture('pim-activations.json').value as Array<Record<string, unknown>>;
const ual = (rows: unknown[]) => view(COLLECTED.UNIFIED_AUDIT_LOG, UAL_ENDPOINT, rows, 'powershell');

describe('AU.L2-3.3.1 auditEventsEvaluator (collected UAL records)', () => {
  const ev = evaluatorRegistry.auditEventsEvaluator;
  it('met: records in the window, each with event and time, covering Entra ID, Exchange and SharePoint', () => {
    const r = ev([ual(UAL)]);
    expect(r.status).toBe('met');
    expect(r.evidence).toContain('AzureActiveDirectory 2, Exchange 1, SharePoint 1');
  });
  it('not_assessed when a workload in scope has no records (quiet or not audited)', () => {
    const r = ev([ual(UAL.filter((x) => !/SharePoint/.test(String(x.RecordType))))]);
    expect(r.status).toBe('not_assessed');
    expect(r.evidence).toMatch(/none for SharePoint/);
  });
  it('not_met when a record lacks its event or time', () => {
    const r = ev([ual([...UAL, { Identity: 'ual-x', RecordType: 'ExchangeAdmin', UserIds: 'a@example.test' }])]);
    expect(r.status).toBe('not_met');
    expect(r.evidence).toMatch(/^1 of 6 unified-audit-log record/);
  });
  it('not_assessed when the UAL was not read, failed, or returned nothing', () => {
    expect(ev([]).status).toBe('not_assessed');
    expect(ev([failed(COLLECTED.UNIFIED_AUDIT_LOG, UAL_ENDPOINT)]).status).toBe('not_assessed');
    expect(ev([ual([])]).status).toBe('not_assessed');
  });
});

describe('AU.L2-3.3.2 auditReviewEvaluator (collected sign-ins and directory audits)', () => {
  const ev = evaluatorRegistry.auditReviewEvaluator;
  const si = (rows: unknown[]) => view(COLLECTED.SIGN_INS, '/auditLogs/signIns', rows);
  const da = (rows: unknown[]) => view(COLLECTED.DIRECTORY_AUDITS, '/auditLogs/directoryAudits', rows);
  it('met: every record names its actor and users are among them (app-initiated audits count as attributed)', () => {
    const r = ev([si(SI), da(DA)]);
    expect(r.status).toBe('met');
    expect(r.evidence).toContain('4 attributed to a named user, 2 to an application or service, 0 to no one');
  });
  it('not_met when a record names no actor', () => {
    const r = ev([si(SI), da([...DA, { id: 'da-x', activityDisplayName: 'Delete group', activityDateTime: T, initiatedBy: {} }])]);
    expect(r.status).toBe('not_met');
    expect(r.evidence).toMatch(/^1 of 7 audit record/);
  });
  it('not_assessed when only applications act (no user action to trace)', () => {
    expect(ev([da(DA.filter((d) => (d.initiatedBy as any).app))]).status).toBe('not_assessed');
  });
  it('not_assessed when unread or empty', () => {
    expect(ev([]).status).toBe('not_assessed');
    expect(ev([si([]), da([])]).status).toBe('not_assessed');
  });
  it('falls back to the point-in-time W0 reads only when no collected view is present', () => {
    const w0 = { ...view('signInLogs', '/auditLogs/signIns', SI) };
    expect(ev([w0]).status).toBe('met');
    // a collected view that failed is not replaced by the point-in-time read
    expect(ev([failed(COLLECTED.SIGN_INS, '/auditLogs/signIns'), w0]).evidence).toMatch(/read of 'collect\.signIns' failed/);
  });
});

describe('AU.L2-3.3.6 auditReductionEvaluator (date-bounded UAL query)', () => {
  const ev = evaluatorRegistry.auditReductionEvaluator;
  it('met when the date-bounded query returned rows', () => {
    const r = ev([ual(UAL)]);
    expect(r.status).toBe('met');
    expect(r.evidence).toMatch(/returned 5 record\(s\) across 5 record type\(s\)/);
  });
  it('not_assessed when empty or unread (was not_met on an unfetched Graph query before W2)', () => {
    expect(ev([ual([])]).status).toBe('not_assessed');
    expect(ev([]).status).toBe('not_assessed');
  });
});

describe('AC.L2-3.1.7 privilegedFunctionEvaluator (collected PIM activations)', () => {
  const ev = evaluatorRegistry.privilegedFunctionEvaluator;
  const pim = (rows: unknown[]) => view(COLLECTED.PIM_ACTIVATIONS, '/roleManagement/directory/roleAssignmentScheduleRequests', rows);
  it('met when every activation is logged with principal, role, action and time', () => {
    const r = ev([pim(PIM)]);
    expect(r.status).toBe('met');
    expect(r.evidence).toMatch(/^2 privileged-role activation request/);
  });
  it('not_met when an activation lacks its principal', () => {
    const r = ev([pim([...PIM, { ...PIM[0], id: 'rasr-x', principalId: '' }])]);
    expect(r.status).toBe('not_met');
  });
  it('not_assessed when none are in the window, the read failed, or nothing was read', () => {
    expect(ev([pim([])]).status).toBe('not_assessed');
    expect(ev([failed(COLLECTED.PIM_ACTIVATIONS, '/roleManagement/directory/roleAssignmentScheduleRequests')]).status).toBe('not_assessed');
    expect(ev([]).status).toBe('not_assessed');
  });
});

describe('the four evaluators are no longer declared presence only', () => {
  it.each(['auditEventsEvaluator', 'auditReviewEvaluator', 'auditReductionEvaluator', 'privilegedFunctionEvaluator'])('%s', (name) => {
    expect(PRESENCE_ONLY_EVALUATORS.has(name)).toBe(false);
    expect(evaluatorRegistry[name].presenceOnly).toBeUndefined();
  });
});
