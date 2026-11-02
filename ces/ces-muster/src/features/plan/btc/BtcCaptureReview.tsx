// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// BtcCaptureReview.tsx — MG-09 hand-off (e): the Plan tab's capture review.
// For each of the eight evidenced BTC questions a discovery capture covers,
// a person accepts the capture as the answer or rejects it
// (captureReviewSpec.ts). The verdict is stored on the session
// (btc_capture_reviews) and the plan is regenerated so the BTC gates read it.
// Register rows: questionRegisterJustifications.PLAN_TAB_QUESTIONS.
import { useEffect, useState } from 'react';
import { db } from '@/shared/db/schema';
import type { BtcCaptureReview as Review } from '@/shared/types/engagement';
import type { BTCConfirmationOutput } from '@/features/plan/engine/shared/types/artifacts';
import { PLAN_TAB_QUESTIONS } from '@/features/interview/questionRegisterJustifications';
import { captureReviewItems, type CaptureReviewItem } from './captureReviewSpec';

export default function BtcCaptureReview({
  btcConfirmation,
  sessionId,
  onReviewed,
}: {
  btcConfirmation: BTCConfirmationOutput | null;
  sessionId: string;
  /** Called after a verdict is stored (the Plan tab regenerates). */
  onReviewed: () => void;
}) {
  const [items, setItems] = useState<CaptureReviewItem[]>([]);

  useEffect(() => {
    let live = true;
    db.interview_sessions
      .get(sessionId)
      .then((s) => {
        if (live) setItems(captureReviewItems(btcConfirmation, s?.btc_capture_reviews));
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [btcConfirmation, sessionId]);

  if (items.length === 0) return null;

  const record = async (item: CaptureReviewItem, verdict: Review['verdict']) => {
    const session = await db.interview_sessions.get(sessionId);
    if (!session) return;
    const review: Review = {
      verdict,
      evidence_ids: item.evidence.map((e) => e.evidence_id),
      reviewed_on: new Date().toISOString(),
    };
    await db.interview_sessions.update(sessionId, {
      btc_capture_reviews: { ...(session.btc_capture_reviews ?? {}), [item.question_id]: review },
    });
    onReviewed();
  };

  return (
    <div data-testid="btc-capture-review" style={{ marginTop: 8 }}>
      <span>Boundary evidence review</span>
      <p>
        Discovery captured these records. Accept a capture if it answers the boundary question; reject it if it does
        not (the gate then stays open).
      </p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((item) => (
          <li key={item.question_id} data-testid={`btc-review-${item.question_id}`} style={{ marginBottom: 8 }}>
            <span>{PLAN_TAB_QUESTIONS.find((q) => q.id === `review.${item.question_id}`)?.text ?? item.question_id}</span>{' '}
            <span>{item.evidence.map((e) => e.location || e.evidence_id).join(', ')}</span>
            {item.review && (
              <span className="badge" data-testid={`btc-review-verdict-${item.question_id}`} style={{ marginLeft: 8 }}>
                {item.review.verdict}
              </span>
            )}
            <button
              className="btn-secondary"
              data-testid={`btc-review-accept-${item.question_id}`}
              onClick={() => void record(item, 'accepted')}
              style={{ marginLeft: 8 }}
            >
              Accept
            </button>
            <button
              className="btn-secondary"
              data-testid={`btc-review-reject-${item.question_id}`}
              onClick={() => void record(item, 'rejected')}
              style={{ marginLeft: 8 }}
            >
              Reject
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
