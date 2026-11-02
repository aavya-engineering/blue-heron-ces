// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 P13-LV: the leaver flow (LeaverFlowService.ts) on a real ces.db in a temp CES_PIPELINE_ROOT, with the
// tenant read and the A-22 execution faked at their interfaces (leaverSignal.ts is the production pair).
// Founder decision 2026-11-01: approve first, then act; never drop it; never act silently.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeAllCesRepositories, getCesRepository } from 'ces-shared/persistence/node';
import { LeaverConfirmError, LeaverFlowService, correlationIdOf, publicFlow, type LeaverExecArgs, type LeaverExecResult, type LeaverSignalUser } from '../src/leaver/LeaverFlowService.js';
import {
  LEAVER_COLLECTIONS, getFlow, getSettings, listEscalations, listOutbox, outboxHash, putSettings, recordMessage, type OutboxMessage,
} from '../src/leaver/leaverStore.js';
import { parseSignalOutput, signalCommand, SIGNAL_BEGIN, SIGNAL_END } from '../src/leaver/leaverSignal.js';
import { readOnlyViolation } from '../src/execution/GetThenSetExecutor.js';
import { getCommandTemplates } from '../src/registry/TemplateRegistry.js';
import registry from '../src/registry/ao-commands.registry.json' assert { type: 'json' };

const SLUG = 'lv-sim';
const TENANT_ID = 'lv-sim-tenant';
const ADMINS = ['it-admin@lv-sim.example', 'owner-admin@lv-sim.example'];
const BHD = 'ces-notices@bhd.example';
const LEAVER = 'merrin.hollinmere@lv-sim.example';

let tmp: string;
let savedRoot: string | undefined;
let clock: Date;
let calls: LeaverExecArgs[];
let execResult: LeaverExecResult;
let signal: LeaverSignalUser[];

function service(opts: { bhdMailbox?: string } = {}) {
  return new LeaverFlowService({
    resolveTenant: async () => ({ tenantId: TENANT_ID }),
    readSignal: async () => ({ query: 'GET /v1.0/users?$filter=employeeLeaveDateTime le <now>', users: signal }),
    execute: async (a) => {
      calls.push(a);
      return execResult;
    },
    publicBaseUrl: 'http://ao.test:3001',
    ...(opts.bhdMailbox ? { bhdMailbox: opts.bhdMailbox } : {}),
    now: () => clock,
    logger: { log: () => undefined, warn: () => undefined },
  });
}

const tokenOf = (m: OutboxMessage): string => {
  const hit = /\/leaver\/confirm\/([^?\s]+)\?t=([A-Za-z0-9_-]+)/.exec(m.body);
  if (!hit) throw new Error(`no confirm link in ${m.kind}`);
  return decodeURIComponent(hit[2]);
};
const requests = (kind = 'leaver_confirm_request') => listOutbox(SLUG).filter((m) => m.kind === kind);
const advance = (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60_000); };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-p13lv-'));
  savedRoot = process.env.CES_PIPELINE_ROOT;
  process.env.CES_PIPELINE_ROOT = tmp;
  closeAllCesRepositories();
  clock = new Date('2026-11-01T12:00:00.000Z');
  calls = [];
  execResult = { success: true, outcome: 'executed', verdict: 'SAT', summary: "leaver 'merrin.hollinmere@lv-sim.example': account disabled; sign-in sessions revoked; 3 group membership(s) removed; 1 licence(s) removed; 2 MFA method(s) deleted", evidencePersisted: true };
  signal = [
    { id: 'user-7', upn: LEAVER, displayName: 'Merrin Hollinmere', accountEnabled: true, employeeLeaveDateTime: '2026-10-22T00:00:00Z' },
    { id: 'user-40', upn: 'gone.already@lv-sim.example', accountEnabled: false, employeeLeaveDateTime: '2026-09-22T00:00:00Z' },
    { id: 'user-9', upn: 'leaves.later@lv-sim.example', accountEnabled: true, employeeLeaveDateTime: '2026-12-31T00:00:00Z' },
  ];
  putSettings(SLUG, TENANT_ID, { adminRecipients: ADMINS }, null, clock.toISOString());
});

afterEach(() => {
  closeAllCesRepositories();
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
  else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('detect -> ask (nothing is changed in the tenant)', () => {
  it('a scan starts one flow per enabled past leaver and records one confirm request per admin, each with its own link', async () => {
    const r = await service().scan(SLUG);
    expect(r.pastLeavers).toBe(2);
    expect(r.enabledPastLeavers).toBe(1);
    expect(r.started).toHaveLength(1);
    const flow = r.started[0];
    expect(flow.status).toBe('awaiting_confirmation');
    expect(flow.leaver).toMatchObject({ upn: LEAVER, employeeLeaveDateTime: '2026-10-22T00:00:00Z', userId: 'user-7' });
    expect(flow.source.kind).toBe('graph_employeeLeaveDateTime');
    expect(flow.source.sourceUrls?.[0]).toMatch(/^https:\/\/learn\.microsoft\.com\//);
    expect(flow.recipients).toEqual([...ADMINS].sort());
    const msgs = requests();
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.to)).toEqual([[ADMINS[0]], [ADMINS[1]]].sort());
    for (const m of msgs) {
      expect(m).toMatchObject({ transport: 'simulated', delivered: false, audience: 'tenant_admins', from: 'adminops-noreply@ces.invalid', flow_id: flow.flowId });
      expect(m.sha256).toBe(outboxHash(m));
      expect(m.body).toContain(`http://ao.test:3001/leaver/confirm/${flow.flowId}?t=`);
    }
    expect(new Set(msgs.map(tokenOf)).size).toBe(2);
    // only hashes are stored on the flow; the API view drops them too
    const stored = JSON.stringify(getFlow(flow.flowId));
    for (const m of msgs) expect(stored).not.toContain(tokenOf(m));
    expect(JSON.stringify(publicFlow(getFlow(flow.flowId)!))).not.toContain('sha256');
    expect(calls).toEqual([]);
  });

  it('a second scan does not start a second flow for the same leaver', async () => {
    await service().scan(SLUG);
    const again = await service().scan(SLUG);
    expect(again.started).toEqual([]);
    expect(again.alreadyTracked).toEqual([expect.objectContaining({ upn: LEAVER, status: 'awaiting_confirmation' })]);
    expect(requests()).toHaveLength(2);
  });

  it('operator / HR input starts a flow without a leave date', async () => {
    const r = await service().start({ tenantSlug: SLUG, upn: 'hr.named@lv-sim.example', source: { kind: 'operator_input', detail: 'HR ticket 42', requestedBy: 'operator@lv-sim.example' } });
    expect(r.created).toBe(true);
    expect(r.flow.leaver.employeeLeaveDateTime).toBeNull();
    expect(r.flow.source).toMatchObject({ kind: 'operator_input', requestedBy: 'operator@lv-sim.example' });
    await expect(service().start({ tenantSlug: SLUG, upn: 'not a upn', source: { kind: 'operator_input', detail: 'x' } })).rejects.toThrow(/not a user principal name/);
  });

  it('with no admin on record the request is still recorded (undeliverable) and the flow still escalates', async () => {
    putSettings(SLUG, TENANT_ID, { adminRecipients: [], reminderAfterMinutes: 0, confirmWindowMinutes: 0 }, null, clock.toISOString());
    const { started: [flow] } = await service().scan(SLUG);
    expect(requests()).toEqual([expect.objectContaining({ to: [], undeliverable: 'no_recipient_on_record' })]);
    const t = service().tick(SLUG);
    expect(t.escalated).toEqual([flow.flowId]);
    expect(listEscalations(SLUG)).toHaveLength(1);
  });
});

describe('confirm -> act -> tell', () => {
  it('a confirm runs A-22 once, as the confirming admin, and records the done notice (BHD off by default)', async () => {
    const { started: [flow] } = await service().scan(SLUG);
    const m = requests().find((x) => x.to[0] === ADMINS[1])!;
    const done = await service().decide(flow.flowId, tokenOf(m), 'confirm');
    expect(calls).toEqual([{ tenantSlug: SLUG, upn: LEAVER, requestorUPN: ADMINS[1], correlationId: correlationIdOf(flow.flowId) }]);
    expect(done.status).toBe('done');
    expect(done.confirmedBy).toBe(ADMINS[1]);
    expect(done.execution).toMatchObject({ op: 'A-22', success: true, verdict: 'SAT', correlationId: `leaver-flow:${flow.flowId}` });
    const notices = listOutbox(SLUG).filter((x) => x.kind === 'leaver_done');
    expect(notices).toHaveLength(1);
    expect(notices[0].to).toEqual([...ADMINS].sort());
    expect(listOutbox(SLUG).filter((x) => x.audience === 'bhd')).toEqual([]);
    expect(done.bhdNotified).toBe(false);
  });

  it('BHD gets the done notice only when the customer opted in, at the role mailbox from config', async () => {
    putSettings(SLUG, TENANT_ID, { notifyBhdOnDone: true }, null, clock.toISOString());
    const { started: [flow] } = await service({ bhdMailbox: BHD }).scan(SLUG);
    const done = await service({ bhdMailbox: BHD }).decide(flow.flowId, tokenOf(requests()[0]), 'confirm');
    const bhd = listOutbox(SLUG).filter((x) => x.audience === 'bhd');
    expect(bhd).toEqual([expect.objectContaining({ kind: 'leaver_done_bhd', to: [BHD], transport: 'simulated' })]);
    expect(done.bhdNotified).toBe(true);
  });

  it('opted in but no BHD mailbox configured: the notice is recorded undeliverable, never sent to anyone else', async () => {
    putSettings(SLUG, TENANT_ID, { notifyBhdOnDone: true }, null, clock.toISOString());
    const { started: [flow] } = await service().scan(SLUG);
    await service().decide(flow.flowId, tokenOf(requests()[0]), 'confirm');
    expect(listOutbox(SLUG).filter((x) => x.audience === 'bhd')).toEqual([expect.objectContaining({ to: [], undeliverable: 'no_bhd_mailbox_configured' })]);
  });

  it('a token works once, only for its flow; a bad token is refused; the other admin cannot confirm again', async () => {
    const { started: [flow] } = await service().scan(SLUG);
    const other = await service().start({ tenantSlug: SLUG, upn: 'other.leaver@lv-sim.example', source: { kind: 'operator_input', detail: 'x' } });
    const [a, b] = requests().filter((x) => x.flow_id === flow.flowId);
    await expect(service().decide(other.flow.flowId, tokenOf(a), 'confirm')).rejects.toMatchObject({ status: 403 });
    await expect(service().decide(flow.flowId, 'x'.repeat(43), 'confirm')).rejects.toMatchObject({ status: 403 });
    await expect(service().decide('lvf-nope', tokenOf(a), 'confirm')).rejects.toMatchObject({ status: 404 });
    await service().decide(flow.flowId, tokenOf(a), 'confirm');
    await expect(service().decide(flow.flowId, tokenOf(a), 'confirm')).rejects.toBeInstanceOf(LeaverConfirmError);
    await expect(service().decide(flow.flowId, tokenOf(b), 'confirm')).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(1);
  });

  it('a decline changes nothing in the tenant and is recorded with the reason', async () => {
    const { started: [flow] } = await service().scan(SLUG);
    const d = await service().decide(flow.flowId, tokenOf(requests()[0]), 'decline', 'still employed: the HR date is wrong');
    expect(d.status).toBe('declined');
    expect(d.declinedReason).toBe('still employed: the HR date is wrong');
    expect(calls).toEqual([]);
    expect(listOutbox(SLUG).filter((x) => x.kind === 'leaver_declined')).toHaveLength(1);
    expect((await service().scan(SLUG)).started).toEqual([]);
  });

  it('a failed A-22 is never silent: status failed, a failure notice and an execution_failed escalation', async () => {
    execResult = { success: false, summary: 'Remove-MgGroupMemberByRef: 403 Forbidden' };
    const { started: [flow] } = await service().scan(SLUG);
    const f = await service().decide(flow.flowId, tokenOf(requests()[0]), 'confirm');
    expect(f.status).toBe('failed');
    expect(listOutbox(SLUG).filter((x) => x.kind === 'leaver_failed')).toHaveLength(1);
    expect(listEscalations(SLUG)).toEqual([expect.objectContaining({ reason: 'execution_failed', objectiveId: 'PS.L2-3.9.2[b]', controlId: 'PS.L2-3.9.2', leaverUpn: LEAVER })]);
  });

  it('two-person approval on: the flow waits for the approval, then resume runs A-22 with it', async () => {
    execResult = { pendingApprovalId: 'appr-1', success: false, summary: 'needs second-person approval' };
    const { started: [flow] } = await service().scan(SLUG);
    const p = await service().decide(flow.flowId, tokenOf(requests()[0]), 'confirm');
    expect(p.status).toBe('pending_two_person_approval');
    expect(p.approvalId).toBe('appr-1');
    execResult = { success: true, summary: 'done' };
    const r = await service().resume(flow.flowId);
    expect(r.status).toBe('done');
    expect(calls.at(-1)).toMatchObject({ approvalId: 'appr-1' });
  });
});

describe('no confirmation: remind, then escalate (never dropped)', () => {
  it('nothing before the reminder time; one reminder; at the window end one escalation record and message; a late confirm still works', async () => {
    const { started: [flow] } = await service().scan(SLUG);
    expect(service().tick(SLUG)).toEqual({ reminded: [], escalated: [] });
    advance(24 * 60);
    expect(service().tick(SLUG)).toEqual({ reminded: [flow.flowId], escalated: [] });
    expect(requests('leaver_reminder')).toHaveLength(2);
    expect(service().tick(SLUG)).toEqual({ reminded: [], escalated: [] });
    advance(48 * 60);
    expect(service().tick(SLUG)).toEqual({ reminded: [], escalated: [flow.flowId] });
    expect(service().tick(SLUG)).toEqual({ reminded: [], escalated: [] });
    const esc = listEscalations(SLUG);
    expect(esc).toEqual([expect.objectContaining({ flowId: flow.flowId, reason: 'unconfirmed_in_window', objectiveId: 'PS.L2-3.9.2[b]' })]);
    expect(requests('leaver_escalation')).toHaveLength(2);
    expect(calls).toEqual([]);
    const late = await service().decide(flow.flowId, tokenOf(requests('leaver_escalation')[0]), 'confirm');
    expect(late.status).toBe('done');
    expect(late.escalatedAt).toBeDefined();
  });

  it('a link expires a week after the window', async () => {
    const { started: [flow] } = await service().scan(SLUG);
    advance(72 * 60 + 7 * 24 * 60 + 1);
    await expect(service().decide(flow.flowId, tokenOf(requests()[0]), 'confirm')).rejects.toMatchObject({ status: 410 });
  });
});

describe('store rules', () => {
  it('the outbox and the escalations are insert-only', () => {
    const msg: OutboxMessage = {
      id: 'aom-fixed', tenant_id: TENANT_ID, tenant_slug: SLUG, flow_id: 'lvf-x', kind: 'leaver_done', source: { type: 'leaver_flow', id: 'lvf-x' },
      from: 'adminops-noreply@ces.invalid', to: [], audience: 'tenant_admins', subject: 's', body: 'b', transport: 'simulated', delivered: false, sha256: 'x', created_at: clock.toISOString(),
    };
    recordMessage(msg);
    expect(() => recordMessage({ ...msg, body: 'changed' })).toThrow(/append-only/);
    expect(getCesRepository().findById<OutboxMessage>(LEAVER_COLLECTIONS.outbox, 'aom-fixed')?.data.body).toBe('b');
  });

  it('settings: defaults (BHD off, 24 h reminder, 72 h window) and validation', () => {
    expect(getSettings('other-tenant', clock.toISOString())).toMatchObject({ notifyBhdOnDone: false, reminderAfterMinutes: 1440, confirmWindowMinutes: 4320, adminRecipients: [] });
    expect(() => putSettings(SLUG, TENANT_ID, { adminRecipients: ['not-a-mailbox'] }, null, clock.toISOString())).toThrow(/mailbox/);
    expect(() => putSettings(SLUG, TENANT_ID, { reminderAfterMinutes: 100, confirmWindowMinutes: 50 }, null, clock.toISOString())).toThrow(/not be later/);
    expect(() => putSettings(SLUG, TENANT_ID, { notifyBhdOnDone: 'yes' as unknown as boolean }, null, clock.toISOString())).toThrow(/true or false/);
  });
});

describe('the leave-signal read and A-22 templates', () => {
  it('the signal read is read-only and parses through banner noise', () => {
    expect(readOnlyViolation(signalCommand())).toBeUndefined();
    expect(signalCommand()).toContain('employeeLeaveDateTime le $now');
    const out = `banner\r\n${SIGNAL_BEGIN}\r\n[{"id":"user-7","userPrincipalName":"${LEAVER}","accountEnabled":true,"employeeLeaveDateTime":"2026-10-22T00:00:00Z"}]\r\n${SIGNAL_END}\r\nSTAMPER_EXECUTION_SUCCESS`;
    expect(parseSignalOutput(out)).toEqual([{ id: 'user-7', upn: LEAVER, displayName: null, accountEnabled: true, employeeLeaveDateTime: '2026-10-22T00:00:00Z' }]);
    expect(parseSignalOutput(`${SIGNAL_BEGIN}\n{"id":"u","userPrincipalName":"a@b.c","accountEnabled":false}\n${SIGNAL_END}`)).toHaveLength(1);
    expect(() => parseSignalOutput('no markers')).toThrow(/no result markers/);
  });

  it('A-22 is in the registry (Tier 2, PS.L2-3.9.2[b], no cost gate) and its get is read-only; its set runs the steps in order', () => {
    const a22 = (registry as Array<Record<string, any>>).find((c) => c.id === 'A-22')!;
    expect(a22).toMatchObject({ sodTier: 'Tier 2', cmmcPractices: ['PS.L2-3.9.2'], evidence_objectives: ['PS.L2-3.9.2[b]'], idempotencyClass: 'get-then-set' });
    expect(a22.cost_gate).toBeUndefined();
    const t = getCommandTemplates('A-22')!;
    expect(readOnlyViolation(t.get_command)).toBeUndefined();
    expect(t.get_command).toContain('SignInSessionsValidFromDateTime');
    const order = ['Update-MgUser', 'Revoke-MgUserSignInSession', 'Remove-MgGroupMemberByRef', 'Set-MgUserLicense', "Invoke-MgGraphRequest -Method DELETE"];
    const at = order.map((s) => t.set_command.indexOf(s));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(t.set_command).toContain("'DynamicMembership'");
    expect(t.set_command).not.toMatch(/passwordMethods/);
  });
});
