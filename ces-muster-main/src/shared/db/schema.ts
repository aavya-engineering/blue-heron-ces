// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import Dexie, { type EntityTable } from 'dexie';
import type { Engagement, AssessedParty, InterviewSession, Sub, QueuedAnswer } from '../types/engagement';

export class MusterDB extends Dexie {
  engagements!: EntityTable<Engagement, 'id'>;
  assessed_parties!: EntityTable<AssessedParty, 'id'>;
  interview_sessions!: EntityTable<InterviewSession, 'id'>;
  subs!: EntityTable<Sub, 'id'>;
  queued_answers!: EntityTable<QueuedAnswer, 'id'>;

  constructor() {
    super('MusterDB');
    this.version(1).stores({
      engagements: 'id, engagement_kind, created_at',
      assessed_parties: 'id, engagement_id, created_at',
      interview_sessions: 'id, party_id, status, created_at',
      subs: 'id, engagement_id',
    });
    // v2: adds queued_answers for adaptive-mode offline answer queueing.
    this.version(2).stores({
      queued_answers: 'id, session_id, synced',
    });
  }
}

export const db = new MusterDB();
