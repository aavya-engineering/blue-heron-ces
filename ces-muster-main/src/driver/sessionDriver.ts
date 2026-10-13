// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Session driver — headless facade over production services.
// Node-callable; no browser process; uses fake-indexeddb in tests.
// NOT a backend: no HTTP server, no persisted state beyond the in-memory Dexie instance.
import type { EngagementKind, AssessedParty, InterviewFact, InterviewSession } from '@/shared/types/engagement';
import type { StatusPayload } from '@/features/export/statusPayloadService';
import { db } from '@/shared/db/schema';
import { nanoid } from '@/shared/utils/nanoid';
import { createEngagement } from '@/features/intake/engagementService';
import { executeExport } from '@/features/export/exportPipeline';
import { PROVISIONING_NODE_IDS } from '@/features/interview/tcpProvisioningNodes';
import { generateInitialPassword as generateSecret, storeTouFile } from '@/features/plan/provisioningInputs';

export interface SessionOpts {
  /** Tile names fed to InterviewSession.selected_stacks and scoreFacts. E.g. 'Microsoft 365'. */
  stacks?: string[];
  /** Overrides for the auto-generated AssessedParty record. */
  party?: { name?: string; on_prem_ot?: AssessedParty['on_prem_ot'] };
}

export interface SessionHandle {
  sessionId: string;
  partyId: string;
  engagementId: string;
}

/** Create engagement + assessed party + in-progress session in Dexie (fake-indexeddb in tests). */
export async function createSession(kind: EngagementKind, opts?: SessionOpts): Promise<SessionHandle> {
  const engagement = await createEngagement(kind);

  const party: AssessedParty = {
    id: nanoid(),
    engagement_id: engagement.id,
    name: opts?.party?.name ?? 'Driver Corp',
    on_prem_ot: opts?.party?.on_prem_ot ?? 'no',
    created_at: new Date().toISOString(),
  };
  await db.assessed_parties.add(party);

  const session: InterviewSession = {
    id: nanoid(),
    party_id: party.id,
    facts: [],
    timing_segments: [],
    status: 'in_progress',
    created_at: new Date().toISOString(),
    selected_stacks: opts?.stacks ?? [],
  };
  await db.interview_sessions.add(session);

  return {
    sessionId: session.id,
    partyId: party.id,
    engagementId: engagement.id,
  };
}

/** Append one InterviewFact to the session.
 *  value='unsure' records answer="I'm not sure", confidence='unknown'. */
export async function answer(handle: SessionHandle, questionId: string, value: string | 'unsure'): Promise<void> {
  const session = await db.interview_sessions.get(handle.sessionId);
  if (!session) throw new Error(`Session not found: ${handle.sessionId}`);

  const isUnsure = value === 'unsure';
  const fact: InterviewFact = {
    question_id: questionId,
    question_text: questionId,
    answer: isUnsure ? "I'm not sure" : value,
    provenance: 'operator_interview',
    confidence: isUnsure ? 'unknown' : 'high',
    recorded_at: new Date().toISOString(),
  };

  const updatedFacts = [...session.facts, fact];
  await db.interview_sessions.update(handle.sessionId, { facts: updatedFacts });
}

/** FC-MU-2 (MS-5): upload the terms-of-use PDF through the production store
 *  (what TouFileField calls) and record the TCP.MU.002 fact. Returns the answer. */
export async function attachTouFile(handle: SessionHandle, name: string, bytes: Uint8Array): Promise<string> {
  const ref = await storeTouFile(handle.sessionId, name, bytes);
  await answer(handle, PROVISIONING_NODE_IDS.touFile, ref);
  return ref;
}

/** FC-MU-2 (MS-5): generate the initial password through the production
 *  generator (what InitialPasswordField calls) and record ONLY its reference
 *  as the TCP.MU.003 fact. The value is returned to the caller, never stored. */
export async function generateInitialPassword(handle: SessionHandle): Promise<{ password: string; ref: string }> {
  const secret = generateSecret();
  await answer(handle, PROVISIONING_NODE_IDS.initialPassword, secret.ref);
  return secret;
}

/** Mark session status='complete' and set completed_at. */
export async function completeInterview(handle: SessionHandle): Promise<void> {
  await db.interview_sessions.update(handle.sessionId, {
    status: 'complete',
    completed_at: new Date().toISOString(),
  });
}

/** Calls executeExport(handle.sessionId) from @/features/export/exportPipeline — returns StatusPayload. */
export async function exportPayload(handle: SessionHandle): Promise<StatusPayload> {
  return executeExport(handle.sessionId);
}
