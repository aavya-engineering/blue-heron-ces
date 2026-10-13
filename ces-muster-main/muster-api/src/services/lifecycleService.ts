// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// lifecycleService.ts — 8-state PartyLifecycle transitions.
// abandoned/opted_out are NOT PartyLifecycle states; they are recorded as
// Disposition rows with DispositionState 'abandoned'/'opted_out'.

export type PartyLifecycleState =
  | 'invited'
  | 'in_progress'
  | 'stalled'
  | 'complete'
  | 'ready'
  | 'validate'
  | 'convert_to_enclave'
  | 'reassessment_due';

// DispositionState values written for action-driven lifecycle transitions.
// 'invited', 'in_progress', 'stalled', 'complete' are flow states and do not
// write Disposition rows.
const DISPOSITION_FOR_STATE: Partial<Record<PartyLifecycleState, string>> = {
  ready: 'ready',
  validate: 'validate',
  convert_to_enclave: 'convert_to_enclave',
  reassessment_due: 'schedule_reassessment',
};

// Legal transitions between PartyLifecycle states.
// [validate with BHD] stalled→in_progress (recovery path) included.
// [validate with BHD] reassessment_due→in_progress (restart cycle) included.
// Any non-terminal state may transition to reassessment_due (per spec "via schedule").
const LEGAL_TRANSITIONS: Record<PartyLifecycleState, PartyLifecycleState[]> = {
  invited: ['in_progress', 'reassessment_due'],
  in_progress: ['stalled', 'complete', 'reassessment_due'],
  stalled: ['in_progress', 'reassessment_due'],
  complete: ['ready', 'reassessment_due'],
  ready: ['validate', 'reassessment_due'],
  validate: ['convert_to_enclave', 'reassessment_due'],
  convert_to_enclave: [], // terminal — no outbound transitions
  reassessment_due: ['in_progress', 'reassessment_due'],
};

interface LifecycleDb {
  party: {
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
  disposition: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  };
}

export function createLifecycleService(
  db: LifecycleDb,
  now: () => Date = () => new Date()
) {
  async function requireParty(partyId: string): Promise<Record<string, unknown>> {
    const party = await db.party.findUnique({ where: { id: partyId } });
    if (!party) throw new Error(`Party not found: ${partyId}`);
    return party;
  }

  return {
    /**
     * Transitions partyId to the target lifecycle state.
     * Writes a Disposition row for action-driven target states (ready, validate,
     * convert_to_enclave, reassessment_due). Throws on illegal transitions.
     */
    async transition(
      partyId: string,
      to: PartyLifecycleState,
      byUserId: string
    ): Promise<Record<string, unknown>> {
      const party = await requireParty(partyId);
      const from = party['lifecycle'] as PartyLifecycleState;
      const allowed = LEGAL_TRANSITIONS[from] ?? [];
      if (!allowed.includes(to)) {
        throw new Error(`Illegal lifecycle transition: ${from} → ${to}`);
      }

      const dispositionState = DISPOSITION_FOR_STATE[to];
      if (dispositionState) {
        await db.disposition.create({
          data: {
            party_id: partyId,
            engagement_id: party['engagement_id'] as string,
            state: dispositionState,
            set_by_user_id: byUserId,
            set_at: now(),
          },
        });
      }

      return db.party.update({
        where: { id: partyId },
        data: { lifecycle: to, last_activity_at: now() },
      });
    },

    /**
     * Records an abandoned Disposition. Party.lifecycle is NOT changed because
     * 'abandoned' is not a PartyLifecycle state.
     */
    async markAbandoned(
      partyId: string,
      byUserId: string,
      notes?: string
    ): Promise<unknown> {
      const party = await requireParty(partyId);
      if (party['lifecycle'] === 'convert_to_enclave') {
        throw new Error('Cannot abandon a party in terminal state convert_to_enclave');
      }
      const existing = await db.disposition.findMany({
        where: { party_id: partyId, state: 'abandoned' },
      });
      if (existing.length > 0) throw new Error('Party is already abandoned');

      const disposition = await db.disposition.create({
        data: {
          party_id: partyId,
          engagement_id: party['engagement_id'] as string,
          state: 'abandoned',
          set_by_user_id: byUserId,
          set_at: now(),
          notes: notes ?? null,
        },
      });

      await db.party.update({
        where: { id: partyId },
        data: { last_activity_at: now() },
      });
      return disposition;
    },

    /**
     * Records an opted_out Disposition. Party.lifecycle is NOT changed because
     * 'opted_out' is not a PartyLifecycle state.
     */
    async optOut(
      partyId: string,
      byUserId: string,
      notes?: string
    ): Promise<unknown> {
      const party = await requireParty(partyId);
      if (party['lifecycle'] === 'convert_to_enclave') {
        throw new Error('Cannot opt out a party in terminal state convert_to_enclave');
      }
      const existing = await db.disposition.findMany({
        where: { party_id: partyId, state: 'opted_out' },
      });
      if (existing.length > 0) throw new Error('Party has already opted out');

      const disposition = await db.disposition.create({
        data: {
          party_id: partyId,
          engagement_id: party['engagement_id'] as string,
          state: 'opted_out',
          set_by_user_id: byUserId,
          set_at: now(),
          notes: notes ?? null,
        },
      });

      await db.party.update({
        where: { id: partyId },
        data: { last_activity_at: now() },
      });
      return disposition;
    },
  };
}
