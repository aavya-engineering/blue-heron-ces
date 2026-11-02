// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// captureReviewSpec.ts — MG-09 hand-off (e): the capture review for the eight
// BTC questions a discovery read evidences (btcEvidenceMap.json: BTC.ID.001/002,
// BTC.DEV.001/002, BTC.LOG.001-004). Discovery captures the record; a person
// decides whether it answers the question. Accepting records the bank option
// that says the capture is clean (the "expected" answer below) as a
// client_assertion citing the captures; rejecting leaves the gate unanswered
// (and drops a discovery-verdict answer for it). Register rows:
// questionRegisterJustifications.PLAN_TAB_QUESTIONS.
import type { BTCConfirmationOutput } from '@/features/plan/engine/shared/types/artifacts';
import type { BtcCaptureReview } from '@/shared/types/engagement';

/** The bank option an accepted capture records, per question (bank options, verbatim). */
export const CAPTURE_REVIEW_ACCEPT: Record<string, string | boolean> = {
  'BTC.ID.001': true, // boolean question: "Does it match declared scope?"
  'BTC.ID.002': 'No unexpected roles',
  'BTC.DEV.001': 'Yes',
  'BTC.DEV.002': 'No',
  'BTC.LOG.001': 'Yes',
  'BTC.LOG.002': 'Yes',
  'BTC.LOG.003': 'Yes',
  'BTC.LOG.004': 'Yes',
};

/** A substituted entry (BTC.DEV.002 -> its Conditional Access proof) records the virtual question's option. */
export const CAPTURE_REVIEW_ACCEPT_SUBSTITUTE: Record<string, string> = {
  'BTC.DEV.002.CA_ENFORCEMENT_PROOF': 'Proof provided (exports/screenshots)',
};

export const CAPTURE_REVIEW_IDS: readonly string[] = Object.keys(CAPTURE_REVIEW_ACCEPT);

export interface CaptureReviewItem {
  question_id: string;
  evidence: Array<{ evidence_id: string; location: string; notes?: string }>;
  review?: BtcCaptureReview;
}

/** The reviewable questions of a compiled BTC: the eight, when a capture evidences them. */
export function captureReviewItems(
  btc: BTCConfirmationOutput | null | undefined,
  reviews: Record<string, BtcCaptureReview> | undefined
): CaptureReviewItem[] {
  if (!btc) return [];
  const refs = btc.btc_confirmation.evidence_refs ?? [];
  return CAPTURE_REVIEW_IDS.map((qid) => ({
    question_id: qid,
    evidence: refs
      .filter((r) => r.question_id === qid)
      .map((r) => ({ evidence_id: r.evidence_id, location: r.location, notes: r.notes })),
    ...(reviews?.[qid] ? { review: reviews[qid] } : {}),
  })).filter((i) => i.evidence.length > 0);
}

/** The answer an accepted review records for a runlist entry, or null when it names none. */
export function acceptedAnswer(questionId: string, substituteSourceId?: string): string | boolean | null {
  if (substituteSourceId) return CAPTURE_REVIEW_ACCEPT_SUBSTITUTE[substituteSourceId] ?? null;
  return CAPTURE_REVIEW_ACCEPT[questionId] ?? null;
}
