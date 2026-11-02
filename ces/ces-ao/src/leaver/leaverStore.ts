// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 P13-LV: the leaver flow's records in the shared DB ({CES_PIPELINE_ROOT}\ces.db).
//
// Four AdminOps-owned collections (AD-1 tool boundary: AO writes only its own collections; EvidenceOps
// reads the escalations, Muster never sees any of this):
//  - adminops_leaver_flows        one record per leaver flow (its state changes: awaiting -> confirmed -> done);
//  - adminops_leaver_settings     one record per tenant (admin recipients, BHD opt-in, the windows);
//  - adminops_mail_outbox         the simulated mail outbox (FD-6: composed and RECORDED, never delivered), the
//                                 same record shape as Muster's muster_mail_outbox (mailOutbox.ts), insert-only.
//                                 PL-122 (clean-room CR-24): a confirm link's token is never stored here. The stored
//                                 body carries `?t=<redacted>` and the sha256 covers that stored body; the clear copy
//                                 (the simulated recipient's mail) lives only in this process's memory (see
//                                 rememberDelivered below);
//  - adminops_leaver_escalations  one record per unconfirmed (or failed) leaver flow, insert-only; EO's collection
//                                 scheduler records each as an EO finding.
// The two insert-only collections are not yet on ces-shared's DEFAULT_WORM_COLLECTIONS (another owner's file;
// LOG-PH13-LV.md STOP 1). Until then this module refuses to overwrite an existing id itself.

import { createHash } from 'node:crypto';
import { getCesRepository } from 'ces-shared/persistence/node';

export const LEAVER_COLLECTIONS = {
  flows: 'adminops_leaver_flows',
  settings: 'adminops_leaver_settings',
  outbox: 'adminops_mail_outbox',
  escalations: 'adminops_leaver_escalations',
} as const;

/** Sender shown on simulated messages: a reserved, non-routable domain (never a person). */
export const AO_OUTBOX_FROM = 'adminops-noreply@ces.invalid';

/** The objective this flow evidences (CMMC PS.L2-3.9.2[b]). */
export const LEAVER_OBJECTIVE = 'PS.L2-3.9.2[b]';
export const LEAVER_CONTROL = 'PS.L2-3.9.2';

/** The AdminOps op the flow runs on confirmation. */
export const LEAVER_OP = 'A-22';

/** Microsoft Learn: the leave signal and its permissions (recorded on every Graph-detected flow). */
export const LEAVE_SIGNAL_SOURCE_URLS = [
  'https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0',
  'https://learn.microsoft.com/en-us/graph/tutorial-lifecycle-workflows-set-employeeleavedatetime',
] as const;

export type LeaverFlowStatus =
  | 'awaiting_confirmation'
  | 'executing'
  | 'pending_two_person_approval'
  | 'done'
  | 'failed'
  | 'declined';

export const OPEN_STATUSES: readonly LeaverFlowStatus[] = ['awaiting_confirmation', 'pending_two_person_approval'];

export type OutboxKind =
  | 'leaver_confirm_request'
  | 'leaver_reminder'
  | 'leaver_escalation'
  | 'leaver_done'
  | 'leaver_done_bhd'
  | 'leaver_failed'
  | 'leaver_declined';

export interface OutboxMessage {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  flow_id: string;
  kind: OutboxKind;
  source: { type: 'leaver_flow'; id: string };
  from: string;
  to: string[];
  /** 'tenant_admins' or 'bhd' (BHD = the operator's role mailbox from config, never a person). */
  audience: 'tenant_admins' | 'bhd';
  subject: string;
  body: string;
  transport: 'simulated';
  delivered: false;
  undeliverable?: 'no_recipient_on_record' | 'no_bhd_mailbox_configured';
  /** SHA-256 over the canonical message (from, to, subject, body, kind, source): Muster's outboxHash rule. */
  sha256: string;
  created_at: string;
}

export interface LeaverSettings {
  schema: 'ces-ao/leaver-settings@1';
  tenantSlug: string;
  /** The tenant's administrator mailboxes that receive the confirmation request. */
  adminRecipients: string[];
  /** Customer opt-in: a done notice also goes to BHD's role mailbox. Default off. */
  notifyBhdOnDone: boolean;
  /** Minutes after the request at which one reminder goes out (default 1440 = 24 h). */
  reminderAfterMinutes: number;
  /** Minutes after the request at which an unconfirmed flow escalates (default 4320 = 72 h). */
  confirmWindowMinutes: number;
  updatedAt: string;
  updatedBy: string | null;
}

export const DEFAULT_REMINDER_MINUTES = 24 * 60;
export const DEFAULT_WINDOW_MINUTES = 72 * 60;
/** A confirm link keeps working this long after the window ends (a late confirm is still honoured). */
export const TOKEN_GRACE_MINUTES = 7 * 24 * 60;
export const MAX_WINDOW_MINUTES = 30 * 24 * 60;

export interface FlowToken {
  /** The recipient this token was sent to (the confirmer, when used). */
  recipient: string;
  /** SHA-256 of the token; the token itself is only in the delivered (in-memory) copy of the message, never stored. */
  sha256: string;
  expiresAt: string;
  usedAt?: string;
}

export interface FlowEvent {
  at: string;
  event: string;
  detail?: string;
}

export interface LeaverFlow {
  schema: 'ces-ao/leaver-flow@1';
  flowId: string;
  tenantSlug: string;
  tenantId: string;
  leaver: { upn: string; displayName?: string | null; employeeLeaveDateTime?: string | null; userId?: string | null };
  /** How the leaver was detected. */
  source: {
    kind: 'graph_employeeLeaveDateTime' | 'operator_input';
    detail: string;
    sourceUrls?: string[];
    requestedBy?: string | null;
  };
  status: LeaverFlowStatus;
  createdAt: string;
  remindAt: string;
  confirmBy: string;
  recipients: string[];
  tokens: FlowToken[];
  messageIds: string[];
  remindedAt?: string;
  escalatedAt?: string;
  escalationIds: string[];
  confirmedBy?: string;
  confirmedAt?: string;
  declinedBy?: string;
  declinedReason?: string;
  approvalId?: string;
  execution?: {
    op: typeof LEAVER_OP;
    correlationId: string;
    success: boolean;
    outcome?: string;
    verdict?: string;
    evidencePath?: string;
    evidencePersisted?: boolean;
    evidenceSha256?: string;
    summary: string;
    at: string;
  };
  doneNoticeIds: string[];
  bhdNotified: boolean;
  history: FlowEvent[];
}

export interface LeaverEscalation {
  schema: 'ces-ao/leaver-escalation@1';
  escalationId: string;
  flowId: string;
  tenantSlug: string;
  tenantId: string;
  leaverUpn: string;
  controlId: typeof LEAVER_CONTROL;
  objectiveId: typeof LEAVER_OBJECTIVE;
  reason: 'unconfirmed_in_window' | 'execution_failed';
  detail: string;
  flowCreatedAt: string;
  confirmBy: string;
  raisedAt: string;
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

/** Muster's outboxHash rule (muster-api mailOutbox.ts), so one verifier checks both outboxes. */
export function outboxHash(m: Pick<OutboxMessage, 'from' | 'to' | 'subject' | 'body' | 'kind' | 'source'>): string {
  const canonical = JSON.stringify({ from: m.from, to: m.to, subject: m.subject, body: m.body, kind: m.kind, source: m.source });
  return sha256Hex(canonical);
}

/** What a stored message body shows instead of a confirm token (PL-122). */
export const REDACTED_TOKEN = '<redacted>';
const CONFIRM_LINK_TOKEN = /(\/leaver\/confirm\/[^?\s]+\?t=)([^\s&#]+)/g;

/** A message body with every confirm-link token replaced by `<redacted>` (what ces.db keeps). */
export function redactConfirmTokens(body: string): string {
  return body.replace(CONFIRM_LINK_TOKEN, (_m, head: string) => `${head}${REDACTED_TOKEN}`);
}

// PL-122: the simulated delivery. Each message that carries a confirm link keeps its clear body here, in process
// memory only (never ces.db, never a file), so the operator's GET /api/leaver/outbox can show the simulated
// recipient's mail while the flow is open. Dropped when the flow closes, and capped so it cannot grow without end.
// A restart loses them; the next reminder or escalation mints fresh links.
const deliveredCopies = new Map<string, string>();
export const MAX_DELIVERED_COPIES = 5000;

export function rememberDelivered(messageId: string, clearBody: string): void {
  deliveredCopies.delete(messageId);
  deliveredCopies.set(messageId, clearBody);
  while (deliveredCopies.size > MAX_DELIVERED_COPIES) {
    const oldest = deliveredCopies.keys().next().value;
    if (oldest === undefined) break;
    deliveredCopies.delete(oldest);
  }
}

export function forgetDelivered(messageIds: readonly string[]): void {
  for (const id of messageIds) deliveredCopies.delete(id);
}

/**
 * The tenant's outbox as the simulated recipients see it: the stored records, with the clear body put back for
 * the messages whose copy is still in memory (`delivered_copy: true`; their sha256 still covers the stored,
 * redacted body). Used only by the bearer-gated operator route.
 */
export function listOutboxDelivered(tenantSlug: string): Array<OutboxMessage & { delivered_copy?: true }> {
  return listOutbox(tenantSlug).map((m) => {
    const clear = deliveredCopies.get(m.id);
    return clear === undefined ? m : { ...m, body: clear, delivered_copy: true as const };
  });
}

const repo = () => getCesRepository();

const scopeOf = (tenantSlug: string, tenantId?: string) => ({ tenantSlug, ...(tenantId ? { tenantId } : {}) });

/** Insert-only write (refuses an existing id), for the outbox and the escalations. */
function insertOnce(collection: string, id: string, ces: { tenantSlug: string; tenantId?: string }, data: unknown): void {
  if (repo().findById(collection, id)) throw new Error(`${collection} is append-only: record "${id}" already exists`);
  repo().put(collection, { id, ces, data });
}

export function saveFlow(flow: LeaverFlow): void {
  repo().put(LEAVER_COLLECTIONS.flows, { id: flow.flowId, ces: scopeOf(flow.tenantSlug, flow.tenantId), data: flow });
}

export function getFlow(flowId: string): LeaverFlow | null {
  return repo().findById<LeaverFlow>(LEAVER_COLLECTIONS.flows, flowId)?.data ?? null;
}

export function listFlows(tenantSlug: string): LeaverFlow[] {
  return repo().list<LeaverFlow>(LEAVER_COLLECTIONS.flows, { tenantSlug }).map((r) => r.data);
}

/** Insert one outbox record. A body that still carries a confirm token is refused (PL-122): redact it first. */
export function recordMessage(m: OutboxMessage): OutboxMessage {
  if (redactConfirmTokens(m.body) !== m.body) throw new Error(`${LEAVER_COLLECTIONS.outbox}: message "${m.id}" carries a confirm token; store it redacted`);
  insertOnce(LEAVER_COLLECTIONS.outbox, m.id, scopeOf(m.tenant_slug, m.tenant_id), m);
  return m;
}

export function listOutbox(tenantSlug: string): OutboxMessage[] {
  return repo().list<OutboxMessage>(LEAVER_COLLECTIONS.outbox, { tenantSlug }).map((r) => r.data);
}

export function recordEscalation(e: LeaverEscalation): LeaverEscalation {
  insertOnce(LEAVER_COLLECTIONS.escalations, e.escalationId, scopeOf(e.tenantSlug, e.tenantId), e);
  return e;
}

export function listEscalations(tenantSlug: string): LeaverEscalation[] {
  return repo().list<LeaverEscalation>(LEAVER_COLLECTIONS.escalations, { tenantSlug }).map((r) => r.data);
}

export function defaultSettings(tenantSlug: string, now: string): LeaverSettings {
  return {
    schema: 'ces-ao/leaver-settings@1',
    tenantSlug,
    adminRecipients: [],
    notifyBhdOnDone: false,
    reminderAfterMinutes: DEFAULT_REMINDER_MINUTES,
    confirmWindowMinutes: DEFAULT_WINDOW_MINUTES,
    updatedAt: now,
    updatedBy: null,
  };
}

export function getSettings(tenantSlug: string, now: string): LeaverSettings {
  return repo().findById<LeaverSettings>(LEAVER_COLLECTIONS.settings, tenantSlug)?.data ?? defaultSettings(tenantSlug, now);
}

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function isMailbox(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && EMAIL.test(v);
}

/** Validate and store a tenant's settings. Throws a plain-English error on a bad value. */
export function putSettings(
  tenantSlug: string,
  tenantId: string | undefined,
  patch: Partial<Pick<LeaverSettings, 'adminRecipients' | 'notifyBhdOnDone' | 'reminderAfterMinutes' | 'confirmWindowMinutes'>>,
  by: string | null,
  now: string,
): LeaverSettings {
  const cur = getSettings(tenantSlug, now);
  const next: LeaverSettings = { ...cur, updatedAt: now, updatedBy: by };
  if (patch.adminRecipients !== undefined) {
    if (!Array.isArray(patch.adminRecipients) || !patch.adminRecipients.every(isMailbox)) {
      throw new Error('adminRecipients must be a list of mailbox addresses');
    }
    next.adminRecipients = [...new Set(patch.adminRecipients.map((a) => a.trim().toLowerCase()))].sort();
  }
  if (patch.notifyBhdOnDone !== undefined) {
    if (typeof patch.notifyBhdOnDone !== 'boolean') throw new Error('notifyBhdOnDone must be true or false');
    next.notifyBhdOnDone = patch.notifyBhdOnDone;
  }
  for (const k of ['reminderAfterMinutes', 'confirmWindowMinutes'] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_WINDOW_MINUTES) {
      throw new Error(`${k} must be a number of minutes from 0 to ${MAX_WINDOW_MINUTES}`);
    }
    next[k] = v;
  }
  if (next.reminderAfterMinutes > next.confirmWindowMinutes) {
    throw new Error('reminderAfterMinutes must not be later than confirmWindowMinutes');
  }
  repo().put(LEAVER_COLLECTIONS.settings, { id: tenantSlug, ces: scopeOf(tenantSlug, tenantId), data: next });
  return next;
}
