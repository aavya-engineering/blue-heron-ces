// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// mailOutbox.ts — FIN-25 / FD-6: the simulated mail outbox.
//
// In V1 "sends" means: the message is composed and RECORDED, never delivered.
// There is no mail transport in muster-api (identity rule; the work-mailbox
// send path is retired). Each nudge, escalation digest and reassessment
// reminder writes one message to `muster_mail_outbox` in ces.db — an
// append-only (WORM) collection — with the SHA-256 of the message, so the
// record is evidence of what would have been sent, to whom, and when.
//
// Recipients are the users on record for the party (or the tenant's operators
// for a digest). With no user on record the message is still recorded, with
// an empty `to` and `undeliverable: 'no_recipient_on_record'`.

import { createHash } from 'node:crypto';

/** Sender shown on simulated messages. A reserved, non-routable domain. */
export const OUTBOX_FROM = 'muster-noreply@ces.invalid';

export type OutboxKind =
  | 'nudge_t3'
  | 'nudge_t7'
  | 'nudge_t14'
  | 'nudge_stall'
  | 'nudge_manual'
  | 'escalation_digest'
  | 'reassessment_due';

export interface OutboxMessage {
  id?: string;
  tenant_id: string;
  engagement_id: string;
  party_id: string | null;
  kind: OutboxKind;
  /** What caused the message: a nudge event id or a reassessment flip. */
  source: { type: 'nudge_event' | 'reassessment'; id: string };
  from: string;
  to: string[];
  subject: string;
  body: string;
  transport: 'simulated';
  delivered: false;
  undeliverable?: 'no_recipient_on_record';
  /** SHA-256 over the canonical message (from, to, subject, body, kind, source). */
  sha256: string;
  created_at: Date;
}

interface OutboxDb {
  mailOutbox?: { create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> };
  user?: { findMany(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown>[]> };
}

const SUBJECTS: Record<OutboxKind, string> = {
  nudge_t3: 'Reminder: your CMMC readiness interview is waiting',
  nudge_t7: 'Second reminder: your CMMC readiness interview is waiting',
  nudge_t14: 'Final reminder: your CMMC readiness interview is waiting',
  nudge_stall: 'Your CMMC readiness interview has stalled',
  nudge_manual: 'A reminder from your CMMC readiness team',
  escalation_digest: 'Escalation digest: stalled parties',
  reassessment_due: 'Your annual CMMC reassessment is due',
};

export function outboxHash(m: Pick<OutboxMessage, 'from' | 'to' | 'subject' | 'body' | 'kind' | 'source'>): string {
  const canonical = JSON.stringify({ from: m.from, to: m.to, subject: m.subject, body: m.body, kind: m.kind, source: m.source });
  return createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

async function recipients(db: OutboxDb, where: Record<string, unknown>): Promise<string[]> {
  if (!db.user) return [];
  const users = await db.user.findMany({ where });
  return [...new Set(users.map((u) => u['email']).filter((e): e is string => typeof e === 'string' && e.length > 0))].sort();
}

/**
 * Record one simulated message. A no-op (returns null) when the db has no
 * outbox collection (older test doubles). Never sends anything.
 */
export async function recordSimulatedMail(
  db: OutboxDb,
  input: {
    tenant_id: string;
    engagement_id: string;
    party_id: string | null;
    kind: OutboxKind;
    source: OutboxMessage['source'];
    body: string;
    now: Date;
    /** Recipient filter; default: the users of the party. */
    recipientWhere?: Record<string, unknown>;
  }
): Promise<OutboxMessage | null> {
  if (!db.mailOutbox) return null;
  const where = input.recipientWhere ?? (input.party_id ? { party_id: input.party_id } : null);
  const to = where ? await recipients(db, where) : [];
  const subject = SUBJECTS[input.kind];
  const base = { from: OUTBOX_FROM, to, subject, body: input.body, kind: input.kind, source: input.source };
  const message: Omit<OutboxMessage, 'id'> = {
    tenant_id: input.tenant_id,
    engagement_id: input.engagement_id,
    party_id: input.party_id,
    ...base,
    transport: 'simulated',
    delivered: false,
    ...(to.length === 0 ? { undeliverable: 'no_recipient_on_record' as const } : {}),
    sha256: outboxHash(base),
    created_at: input.now,
  };
  return (await db.mailOutbox.create({ data: message as unknown as Record<string, unknown> })) as unknown as OutboxMessage;
}

export function nudgeBody(type: string, idleDays: number | null): string {
  const idle = idleDays === null ? '' : ` It has been ${idleDays} day${idleDays === 1 ? '' : 's'} since the last activity.`;
  switch (type) {
    case 'stall':
      return `Your CMMC readiness interview has had no activity and is now marked stalled.${idle} Sign in to Muster to continue where you left off.`;
    case 'escalation':
      return `Your CMMC readiness team asked us to remind you about your interview. Sign in to Muster to continue.`;
    default:
      return `Your CMMC readiness interview is not finished yet.${idle} Sign in to Muster to continue where you left off.`;
  }
}
