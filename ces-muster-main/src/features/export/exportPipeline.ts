// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Export pipeline — wired end-to-end: Dexie → scoring → StatusPayload → download
// App.tsx calls executeExportAndDownload(sessionId); tests can call executeExport(sessionId).
import { db } from '@/shared/db/schema';
import { scoreFacts } from '@/features/scoring/scoringService';
import { routeFacts } from '@/features/scoring/factRouter';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { buildStatusPayload, downloadStatusPayload, type StatusPayload } from './statusPayloadService';

/**
 * Load all records from Dexie, score the facts through the full cascade, and
 * build a StatusPayload. Returns the payload without downloading — used by tests.
 */
export async function executeExport(sessionId: string): Promise<StatusPayload> {
  const session = await db.interview_sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const party = await db.assessed_parties.get(session.party_id);
  if (!party) throw new Error(`Party not found: ${session.party_id}`);

  const engagement = await db.engagements.get(party.engagement_id);
  if (!engagement) throw new Error(`Engagement not found: ${party.engagement_id}`);

  const graph = await loadQuestionGraph(session.selected_stacks ?? []);
  // GO-2 brutal-critic D2: unconfirmed drafts are excluded BEFORE routing.
  // Two reasons, both load-bearing: (1) StatusPayload.interview_facts has no
  // draft-marking contract — a leaked draft reads as an answer to any
  // downstream consumer; (2) routing first would let a draft WIN a group and
  // shadow the human fact scoring should have seen (scoreFacts filters its
  // input, so a filtered winner's suppressed alternatives are lost). Drafts
  // belong in the readiness-result.v1 payload (facts[] with attestation),
  // never in this artifact.
  //
  // A→C→B per-objective router: harvested facts outrank captured evidence
  // outrank interview answers; one conservative winner per question_id
  // (T2 wiring — see docs/WIRING_T2.md). With single-source facts this is
  // an identity transform, so pre-P2 payloads are unchanged.
  const routedFacts = routeFacts(scorableFacts(session.facts));
  const { posture, conservativeScore } = await scoreFacts(
    routedFacts,
    graph,
    session.selected_stacks ?? []
  );
  return buildStatusPayload(engagement, party, { ...session, facts: routedFacts }, conservativeScore, posture);
}

/** Full wiring: build payload and trigger browser download. */
export async function executeExportAndDownload(sessionId: string): Promise<void> {
  const payload = await executeExport(sessionId);
  downloadStatusPayload(payload);
}
