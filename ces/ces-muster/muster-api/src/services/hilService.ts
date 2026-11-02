// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// hilService.ts — Human-in-the-loop escalation queue.
// Routing rule (exact per spec):
//   (confidence === 'low' AND weight >= 3) OR sub_flagged === true → queue
// All other facts → null (no routing).

interface HilDb {
  hilItem: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
    }): Promise<Record<string, unknown>[]>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
}

export interface RoutableFact {
  tenant_id: string;
  party_id: string;
  session_id?: string;
  question_id: string;
  answer: unknown;
  confidence: string;
  weight: number;
  sub_flagged?: boolean;
}

export function createHilService(db: HilDb, now: () => Date = () => new Date()) {
  return {
    /**
     * Routes a fact to the HIL queue if routing criteria are met.
     * EXACT rule: (confidence === 'low' AND weight >= 3) OR sub_flagged === true.
     * Returns created HilItem or null if no routing needed.
     * [validate with BHD] weight threshold of 3 aligns to high-impact domain classification.
     */
    async routeFact(fact: RoutableFact): Promise<Record<string, unknown> | null> {
      const shouldRoute =
        (fact.confidence === 'low' && fact.weight >= 3) || fact.sub_flagged === true;
      if (!shouldRoute) return null;

      // reason distinguishes how the item entered the queue
      const reason: string = fact.sub_flagged
        ? 'sub_flagged'
        : 'low_confidence_high_weight';

      return db.hilItem.create({
        data: {
          tenant_id: fact.tenant_id,
          party_id: fact.party_id,
          session_id: fact.session_id ?? null,
          question_id: fact.question_id,
          reason,
          fact: {
            answer: fact.answer,
            confidence: fact.confidence,
            weight: fact.weight,
          },
          created_at: now(),
        },
      });
    },

    async getQueue(tenantId: string): Promise<Record<string, unknown>[]> {
      return db.hilItem.findMany({
        where: { tenant_id: tenantId, resolved_at: null },
        orderBy: { created_at: 'asc' },
      });
    },

    async resolve(
      id: string,
      byUserId: string,
      advisorMinutes: number
    ): Promise<Record<string, unknown>> {
      const item = await db.hilItem.findUnique({ where: { id } });
      if (!item) throw new Error(`HilItem not found: ${id}`);
      if (item['resolved_at']) throw new Error('HilItem is already resolved');

      return db.hilItem.update({
        where: { id },
        data: {
          resolved_at: now(),
          resolved_by_user_id: byUserId,
          advisor_minutes: advisorMinutes,
        },
      });
    },
  };
}
