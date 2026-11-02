// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 P13-LV: the leaver flow (founder decision 2026-11-01 for CMMC PS.L2-3.9.2[b], "system access and
// credentials are terminated consistent with personnel actions"): APPROVE FIRST, THEN ACT.
//
//  1. Detect. CES finds a leaver for a tenant: a user whose employeeLeaveDateTime has passed and whose account
//     is still enabled (the Graph read in leaverSignal.ts; no Entra ID Governance licence is named for the
//     property, only the User-LifeCycleInfo permissions), or an operator / HR input naming the leaver.
//  2. Ask. CES records one confirmation request per tenant administrator in the simulated mail outbox, each
//     with its own single-use confirm link (a capability token; only its SHA-256 is stored on the flow, and the
//     stored outbox record shows the link as `?t=<redacted>`, PL-122: the clear link exists only in the simulated
//     delivery, in process memory).
//  3. Act. On confirm, AdminOps A-22 (leaver access termination) runs through the governed AO pipeline
//     (executeInvocation: sim-only rail, CMMC gate, two-person gate when it is on, get-then-set, evidence).
//     The evidence row carries objective PS.L2-3.9.2[b]; EvidenceOps collects it (collector C10).
//  4. Tell. A done notice goes to the tenant administrators, and to BHD's role mailbox only when the customer
//     opted in (per-tenant setting notifyBhdOnDone, default off).
//  5. Never drop it, never act silently. With no confirmation: one reminder, then at the window's end an
//     escalation (an AO escalation record EvidenceOps turns into a finding, plus a message). A late confirm
//     is still honoured. Nothing touches the tenant before a confirm. Two-person approval stays off by default
//     (when CES_TWO_PERSON_APPROVAL=1 the flow waits for that approval and resumes). AI is not used.

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AO_OUTBOX_FROM, LEAVER_CONTROL, LEAVER_OBJECTIVE, LEAVER_OP, LEAVE_SIGNAL_SOURCE_URLS, OPEN_STATUSES, TOKEN_GRACE_MINUTES,
  forgetDelivered, getFlow, getSettings, isMailbox, listFlows, outboxHash, recordEscalation, recordMessage, redactConfirmTokens,
  rememberDelivered, saveFlow, sha256Hex,
  type FlowToken, type LeaverEscalation, type LeaverFlow, type OutboxKind, type OutboxMessage,
} from './leaverStore.js';

// ─── Dependencies ────────────────────────────────────────────────

export interface LeaverSignalUser {
  id?: string | null;
  upn: string;
  displayName?: string | null;
  accountEnabled: boolean | null;
  employeeLeaveDateTime?: string | null;
}

export interface LeaverSignalRead {
  /** The query that was sent (recorded on each flow it starts). */
  query: string;
  /** Users whose employeeLeaveDateTime is at or before now (enabled or not). */
  users: LeaverSignalUser[];
}

export interface LeaverExecResult {
  /** Two-person approval is on and opened an approval: the flow waits for it. */
  pendingApprovalId?: string;
  success: boolean;
  outcome?: string;
  verdict?: string;
  evidencePath?: string;
  evidencePersisted?: boolean;
  evidenceSha256?: string;
  summary: string;
}

export interface LeaverExecArgs {
  tenantSlug: string;
  upn: string;
  requestorUPN: string;
  correlationId: string;
  approvalId?: string;
}

export interface LeaverFlowDeps {
  /** Tenant id (and any admin contacts the tenant record names) for a slug; throws for an unknown tenant. */
  resolveTenant(slug: string): Promise<{ tenantId: string; adminContacts?: string[] }>;
  /** The Graph leave-signal read for a tenant (leaverSignal.ts in production). */
  readSignal(slug: string): Promise<LeaverSignalRead>;
  /** Runs A-22 through the governed pipeline (defaultLeaverExecutor in production). */
  execute(args: LeaverExecArgs): Promise<LeaverExecResult>;
  /** Base URL of AO's confirm route as tenant administrators reach it (CES_AO_PUBLIC_URL). */
  publicBaseUrl: string;
  /** BHD's role mailbox for opted-in done notices (CES_BHD_NOTICE_MAILBOX); never a person. */
  bhdMailbox?: string;
  /** Simulator only (CES_AO_LEAVER_SINCE, as EO's CES_EO_ADMINOPS_SINCE): flows created before this ISO time belong to
   *  another run and never count as tracked. ces.db is shared across runs; unset in production (R-F12, LOG-RF12-DIAG). */
  trackedSince?: string;
  now?(): Date;
  logger?: Pick<Console, 'log' | 'warn'>;
}

// ─── Errors ──────────────────────────────────────────────────────

/** A refused confirm (bad or used token, closed flow). `status` is the HTTP status the route returns. */
export class LeaverConfirmError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 410, message: string) {
    super(message);
    this.name = 'LeaverConfirmError';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

const MIN = 60_000;
const iso = (d: Date) => d.toISOString();
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function tokenMatches(token: string, sha: string): boolean {
  const a = Buffer.from(sha256Hex(token), 'hex');
  const b = Buffer.from(sha, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function correlationIdOf(flowId: string): string {
  return `leaver-flow:${flowId}`;
}

// ─── Service ─────────────────────────────────────────────────────

export interface ScanResult {
  tenantSlug: string;
  query: string;
  pastLeavers: number;
  enabledPastLeavers: number;
  started: LeaverFlow[];
  alreadyTracked: Array<{ upn: string; flowId: string; status: string }>;
}

export class LeaverFlowService {
  private readonly log: Pick<Console, 'log' | 'warn'>;

  constructor(private readonly deps: LeaverFlowDeps) {
    this.log = deps.logger ?? console;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private event(flow: LeaverFlow, event: string, detail?: string): void {
    flow.history.push({ at: iso(this.now()), event, ...(detail ? { detail } : {}) });
  }

  /** The flow already tracking this leaver (same tenant, same UPN, same leave date), if any. */
  private tracked(tenantSlug: string, upn: string, leaveAt: string | null | undefined): LeaverFlow | undefined {
    const key = upn.trim().toLowerCase();
    const since = this.deps.trackedSince ? Date.parse(this.deps.trackedSince) : NaN;
    return listFlows(tenantSlug).find((f) =>
      !(Number.isFinite(since) && Date.parse(f.createdAt) < since) &&
      f.leaver.upn.toLowerCase() === key &&
      ((f.leaver.employeeLeaveDateTime ?? null) === (leaveAt ?? null) || OPEN_STATUSES.includes(f.status)));
  }

  private async recipients(tenantSlug: string, adminContacts: string[] | undefined): Promise<string[]> {
    const s = getSettings(tenantSlug, iso(this.now()));
    const list = s.adminRecipients.length ? s.adminRecipients : (adminContacts ?? []).filter(isMailbox).map((a) => a.toLowerCase());
    return [...new Set(list)].sort();
  }

  private confirmLink(flowId: string, token: string): string {
    return `${this.deps.publicBaseUrl.replace(/\/+$/, '')}/leaver/confirm/${encodeURIComponent(flowId)}?t=${encodeURIComponent(token)}`;
  }

  private message(flow: LeaverFlow, kind: OutboxKind, audience: OutboxMessage['audience'], to: string[], subject: string, body: string, undeliverable?: OutboxMessage['undeliverable']): OutboxMessage {
    const source = { type: 'leaver_flow' as const, id: flow.flowId };
    // PL-122: ces.db keeps the body with the confirm token redacted (the hash covers what is stored); the clear
    // body is the simulated delivery, kept in process memory only.
    const stored = redactConfirmTokens(body);
    const base = { from: AO_OUTBOX_FROM, to, subject, body: stored, kind, source };
    const m: OutboxMessage = {
      id: `aom-${randomUUID()}`,
      tenant_id: flow.tenantId,
      tenant_slug: flow.tenantSlug,
      flow_id: flow.flowId,
      ...base,
      audience,
      transport: 'simulated',
      delivered: false,
      ...(undeliverable ? { undeliverable } : to.length === 0 ? { undeliverable: 'no_recipient_on_record' as const } : {}),
      sha256: outboxHash(base),
      created_at: iso(this.now()),
    };
    recordMessage(m);
    if (stored !== body) rememberDelivered(m.id, body);
    flow.messageIds.push(m.id);
    return m;
  }

  /** One message per administrator, each with its own single-use confirm link. With none on record, one undeliverable record. */
  private askAdmins(flow: LeaverFlow, kind: 'leaver_confirm_request' | 'leaver_reminder' | 'leaver_escalation', subject: string, lead: string): void {
    const expiresAt = iso(plus(new Date(flow.confirmBy), TOKEN_GRACE_MINUTES));
    if (flow.recipients.length === 0) {
      this.message(flow, kind, 'tenant_admins', [], subject, `${lead}\n\nNo tenant administrator mailbox is on record for ${flow.tenantSlug}, so no confirm link could be sent. ` +
        'Add one (PUT /api/leaver/settings) and the next reminder or escalation carries the link; an operator can also see this flow in AdminOps.');
      return;
    }
    for (const r of flow.recipients) {
      const token = newToken();
      const t: FlowToken = { recipient: r, sha256: sha256Hex(token), expiresAt };
      flow.tokens.push(t);
      this.message(flow, kind, 'tenant_admins', [r], subject,
        `${lead}\n\nConfirm or decline here (this link is for you only and works once): ${this.confirmLink(flow.flowId, token)}\n\n` +
        `On confirm, CES runs AdminOps ${LEAVER_OP} (leaver access termination): it disables the account, revokes every sign-in session, ` +
        'removes the group memberships and licences, and deletes the registered MFA methods. Nothing is changed before someone confirms.\n' +
        `Flow ${flow.flowId}; confirm by ${flow.confirmBy}.`);
    }
  }

  private describeLeaver(flow: LeaverFlow): string {
    const when = flow.leaver.employeeLeaveDateTime ? ` (leave date ${flow.leaver.employeeLeaveDateTime})` : '';
    return `${flow.leaver.upn}${when}`;
  }

  /**
   * Start a flow for one leaver (Graph-detected or operator input). Returns the existing flow when this leaver
   * is already tracked (an open flow, or a closed one for the same leave date): never two flows for one leaver.
   */
  async start(input: {
    tenantSlug: string;
    upn: string;
    displayName?: string | null;
    userId?: string | null;
    employeeLeaveDateTime?: string | null;
    source: LeaverFlow['source'];
  }): Promise<{ flow: LeaverFlow; created: boolean }> {
    const upn = input.upn.trim();
    if (!isMailbox(upn)) throw new Error(`not a user principal name: "${input.upn}"`);
    const existing = this.tracked(input.tenantSlug, upn, input.employeeLeaveDateTime);
    if (existing) return { flow: existing, created: false };
    const tenant = await this.deps.resolveTenant(input.tenantSlug);
    const now = this.now();
    const s = getSettings(input.tenantSlug, iso(now));
    const flow: LeaverFlow = {
      schema: 'ces-ao/leaver-flow@1',
      flowId: `lvf-${randomUUID()}`,
      tenantSlug: input.tenantSlug,
      tenantId: tenant.tenantId,
      leaver: { upn, displayName: input.displayName ?? null, employeeLeaveDateTime: input.employeeLeaveDateTime ?? null, userId: input.userId ?? null },
      source: input.source,
      status: 'awaiting_confirmation',
      createdAt: iso(now),
      remindAt: iso(plus(now, s.reminderAfterMinutes)),
      confirmBy: iso(plus(now, s.confirmWindowMinutes)),
      recipients: await this.recipients(input.tenantSlug, tenant.adminContacts),
      tokens: [],
      messageIds: [],
      escalationIds: [],
      doneNoticeIds: [],
      bhdNotified: false,
      history: [],
    };
    this.event(flow, 'detected', `${input.source.kind}: ${input.source.detail}`);
    this.askAdmins(flow, 'leaver_confirm_request',
      `Action needed: confirm that ${upn} has left so CES can end their access`,
      `CES found a leaver in tenant ${flow.tenantSlug}: ${this.describeLeaver(flow)}. Their account is still able to sign in.`);
    this.event(flow, 'confirmation_requested', `${flow.recipients.length} administrator(s): ${flow.recipients.join(', ') || 'none on record'}`);
    saveFlow(flow);
    this.log.log(`[LeaverFlow] ${flow.tenantSlug}: flow ${flow.flowId} started for ${upn} (${input.source.kind}); ${flow.recipients.length} confirmation request(s) recorded`);
    return { flow, created: true };
  }

  /** Read the tenant's leave signal and start a flow for every past leaver whose account is still enabled. */
  async scan(tenantSlug: string): Promise<ScanResult> {
    const read = await this.deps.readSignal(tenantSlug);
    const nowMs = this.now().getTime();
    const past = read.users.filter((u) => {
      const t = Date.parse(String(u.employeeLeaveDateTime ?? ''));
      return Number.isFinite(t) && t <= nowMs;
    });
    const enabled = past.filter((u) => u.accountEnabled === true);
    const out: ScanResult = { tenantSlug, query: read.query, pastLeavers: past.length, enabledPastLeavers: enabled.length, started: [], alreadyTracked: [] };
    for (const u of enabled) {
      const r = await this.start({
        tenantSlug,
        upn: u.upn,
        displayName: u.displayName ?? null,
        userId: u.id ?? null,
        employeeLeaveDateTime: u.employeeLeaveDateTime ?? null,
        source: {
          kind: 'graph_employeeLeaveDateTime',
          detail: `employeeLeaveDateTime ${u.employeeLeaveDateTime} has passed and the account is enabled (${read.query})`,
          sourceUrls: [...LEAVE_SIGNAL_SOURCE_URLS],
        },
      });
      if (r.created) out.started.push(r.flow);
      else out.alreadyTracked.push({ upn: u.upn, flowId: r.flow.flowId, status: r.flow.status });
    }
    return out;
  }

  /** What the confirm page shows. Validates the token; changes nothing. */
  view(flowId: string, token: string): { flow: LeaverFlow; recipient: string } {
    const { flow, t } = this.checkToken(flowId, token);
    return { flow, recipient: t.recipient };
  }

  private checkToken(flowId: string, token: string): { flow: LeaverFlow; t: FlowToken } {
    if (typeof token !== 'string' || token.length < 20) throw new LeaverConfirmError(403, 'a confirm token is required');
    const flow = getFlow(flowId);
    if (!flow) throw new LeaverConfirmError(404, 'no such leaver flow');
    const t = flow.tokens.find((x) => tokenMatches(token, x.sha256));
    if (!t) throw new LeaverConfirmError(403, 'this confirm link is not valid for this flow');
    if (t.usedAt) throw new LeaverConfirmError(409, `this confirm link was already used (${t.usedAt})`);
    if (Date.parse(t.expiresAt) < this.now().getTime()) throw new LeaverConfirmError(410, `this confirm link expired at ${t.expiresAt}`);
    if (flow.status !== 'awaiting_confirmation') throw new LeaverConfirmError(409, `this flow is ${flow.status}; nothing to confirm`);
    return { flow, t };
  }

  /**
   * The administrator's answer through the token-gated route. `confirm` runs A-22; `decline` closes the flow
   * with the reason and changes nothing in the tenant. The token is spent either way.
   */
  async decide(flowId: string, token: string, decision: 'confirm' | 'decline', reason?: string): Promise<LeaverFlow> {
    const { flow, t } = this.checkToken(flowId, token);
    t.usedAt = iso(this.now());
    if (decision === 'decline') {
      flow.status = 'declined';
      flow.declinedBy = t.recipient;
      flow.declinedReason = String(reason ?? '').trim().slice(0, 500) || 'no reason given';
      this.event(flow, 'declined', `${t.recipient}: ${flow.declinedReason}`);
      this.message(flow, 'leaver_declined', 'tenant_admins', flow.recipients, `Recorded: ${flow.leaver.upn} was declined as a leaver`,
        `${t.recipient} declined the leaver flow for ${this.describeLeaver(flow)}: ${flow.declinedReason}. CES changed nothing. ` +
        'If the leave date is wrong, correct or clear employeeLeaveDateTime on the account, or the next scan will not start a new flow for this date.');
      saveFlow(flow);
      forgetDelivered(flow.messageIds);
      return flow;
    }
    flow.confirmedBy = t.recipient;
    flow.confirmedAt = t.usedAt;
    this.event(flow, 'confirmed', t.recipient);
    return this.run(flow);
  }

  /** Two-person approval on: after the approval is decided, run A-22 with it. */
  async resume(flowId: string): Promise<LeaverFlow> {
    const flow = getFlow(flowId);
    if (!flow) throw new LeaverConfirmError(404, 'no such leaver flow');
    if (flow.status !== 'pending_two_person_approval' || !flow.approvalId) throw new LeaverConfirmError(409, `this flow is ${flow.status}; nothing to resume`);
    return this.run(flow, flow.approvalId);
  }

  private async run(flow: LeaverFlow, approvalId?: string): Promise<LeaverFlow> {
    flow.status = 'executing';
    saveFlow(flow);
    const correlationId = correlationIdOf(flow.flowId);
    let r: LeaverExecResult;
    try {
      r = await this.deps.execute({
        tenantSlug: flow.tenantSlug,
        upn: flow.leaver.upn,
        requestorUPN: flow.confirmedBy ?? 'unknown-confirmer',
        correlationId,
        ...(approvalId ? { approvalId } : {}),
      });
    } catch (e) {
      r = { success: false, summary: e instanceof Error ? e.message : String(e) };
    }
    if (r.pendingApprovalId) {
      flow.status = 'pending_two_person_approval';
      flow.approvalId = r.pendingApprovalId;
      this.event(flow, 'awaiting_two_person_approval', `${LEAVER_OP} waits for approval ${r.pendingApprovalId} (CES_TWO_PERSON_APPROVAL is on); then POST /api/leaver/flows/${flow.flowId}/resume`);
      saveFlow(flow);
      return flow;
    }
    flow.execution = {
      op: LEAVER_OP,
      correlationId,
      success: r.success,
      ...(r.outcome ? { outcome: r.outcome } : {}),
      ...(r.verdict ? { verdict: r.verdict } : {}),
      ...(r.evidencePath ? { evidencePath: r.evidencePath } : {}),
      ...(r.evidencePersisted !== undefined ? { evidencePersisted: r.evidencePersisted } : {}),
      ...(r.evidenceSha256 ? { evidenceSha256: r.evidenceSha256 } : {}),
      summary: r.summary,
      at: iso(this.now()),
    };
    if (r.success) {
      flow.status = 'done';
      this.event(flow, 'terminated', r.summary);
      const done = this.message(flow, 'leaver_done', 'tenant_admins', flow.recipients, `Done: access ended for ${flow.leaver.upn}`,
        `Confirmed by ${flow.confirmedBy}. AdminOps ${LEAVER_OP} ended the access of ${this.describeLeaver(flow)} in tenant ${flow.tenantSlug}: ${r.summary}\n` +
        `Evidence: an AdminOps evidence row for ${LEAVER_OBJECTIVE} (correlation ${correlationId}), collected by EvidenceOps.`);
      flow.doneNoticeIds.push(done.id);
      const s = getSettings(flow.tenantSlug, iso(this.now()));
      if (s.notifyBhdOnDone) {
        const bhd = this.deps.bhdMailbox && isMailbox(this.deps.bhdMailbox) ? [this.deps.bhdMailbox.toLowerCase()] : [];
        const m = this.message(flow, 'leaver_done_bhd', 'bhd', bhd, `Done (customer opt-in notice): leaver access ended in ${flow.tenantSlug}`,
          `The customer asked for this notice. In tenant ${flow.tenantSlug}, a tenant administrator confirmed a leaver and AdminOps ${LEAVER_OP} ended their access: ${r.summary}\n` +
          `Flow ${flow.flowId}; evidence correlation ${correlationId}.`, bhd.length ? undefined : 'no_bhd_mailbox_configured');
        flow.doneNoticeIds.push(m.id);
        flow.bhdNotified = bhd.length > 0;
        this.event(flow, 'bhd_notice', bhd.length ? 'recorded for the BHD role mailbox (customer opt-in)' : 'customer opted in but CES_BHD_NOTICE_MAILBOX is not set: recorded undeliverable');
      }
    } else {
      flow.status = 'failed';
      this.event(flow, 'failed', r.summary);
      this.message(flow, 'leaver_failed', 'tenant_admins', flow.recipients, `Failed: CES could not end the access of ${flow.leaver.upn}`,
        `AdminOps ${LEAVER_OP} did not complete for ${this.describeLeaver(flow)}: ${r.summary}\nThe account may still have access. An escalation was recorded; an operator must finish this by hand or re-run ${LEAVER_OP}.`);
      this.escalate(flow, 'execution_failed', r.summary);
    }
    saveFlow(flow);
    // The flow is closed (done or failed): its links can no longer confirm anything, so the delivered copies go.
    forgetDelivered(flow.messageIds);
    return flow;
  }

  private escalate(flow: LeaverFlow, reason: LeaverEscalation['reason'], detail: string): LeaverEscalation {
    const e: LeaverEscalation = {
      schema: 'ces-ao/leaver-escalation@1',
      escalationId: `lve-${randomUUID()}`,
      flowId: flow.flowId,
      tenantSlug: flow.tenantSlug,
      tenantId: flow.tenantId,
      leaverUpn: flow.leaver.upn,
      controlId: LEAVER_CONTROL,
      objectiveId: LEAVER_OBJECTIVE,
      reason,
      detail,
      flowCreatedAt: flow.createdAt,
      confirmBy: flow.confirmBy,
      raisedAt: iso(this.now()),
    };
    recordEscalation(e);
    flow.escalationIds.push(e.escalationId);
    if (!flow.escalatedAt) flow.escalatedAt = e.raisedAt;
    this.event(flow, 'escalated', `${reason}: ${detail}`);
    this.log.warn(`[LeaverFlow] ${flow.tenantSlug}: ESCALATED flow ${flow.flowId} (${flow.leaver.upn}): ${reason}`);
    return e;
  }

  /** Reminders and escalations for a tenant's open flows. Never writes to the tenant. */
  tick(tenantSlug: string): { reminded: string[]; escalated: string[] } {
    const nowMs = this.now().getTime();
    const out = { reminded: [] as string[], escalated: [] as string[] };
    for (const flow of listFlows(tenantSlug)) {
      if (flow.status !== 'awaiting_confirmation') continue;
      let changed = false;
      if (!flow.remindedAt && nowMs >= Date.parse(flow.remindAt)) {
        this.askAdmins(flow, 'leaver_reminder', `Reminder: confirm that ${flow.leaver.upn} has left`,
          `Reminder: ${this.describeLeaver(flow)} is still able to sign in to tenant ${flow.tenantSlug}. Nobody has confirmed the leaver yet; ` +
          `if nobody does by ${flow.confirmBy}, this is escalated and recorded as an open finding.`);
        flow.remindedAt = iso(this.now());
        this.event(flow, 'reminded');
        out.reminded.push(flow.flowId);
        changed = true;
      }
      if (!flow.escalatedAt && nowMs >= Date.parse(flow.confirmBy)) {
        this.escalate(flow, 'unconfirmed_in_window', `no tenant administrator confirmed by ${flow.confirmBy}; the account keeps its access`);
        this.askAdmins(flow, 'leaver_escalation', `Escalated: ${flow.leaver.upn} has not been confirmed as a leaver`,
          `Escalated: nobody confirmed the leaver ${this.describeLeaver(flow)} by ${flow.confirmBy}. The account still has access. ` +
          `This is now an open finding for ${LEAVER_OBJECTIVE} in EvidenceOps. Confirming still works.`);
        out.escalated.push(flow.flowId);
        changed = true;
      }
      if (changed) saveFlow(flow);
    }
    return out;
  }
}

/** A flow without its token hashes (what the API shows). */
export function publicFlow(flow: LeaverFlow): Omit<LeaverFlow, 'tokens'> & { tokens: Array<Omit<FlowToken, 'sha256'>> } {
  return { ...flow, tokens: flow.tokens.map(({ sha256: _s, ...rest }) => rest) };
}
