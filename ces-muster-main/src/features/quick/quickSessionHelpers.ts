// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { TimingSegment } from '@/shared/types/engagement';

/**
 * Returns a new answers map with the given questionId set to value.
 * Pure function — no mutation of the input map.
 */
export function updateAnswer(
  answers: Record<string, string>,
  questionId: string,
  value: string
): Record<string, string> {
  return { ...answers, [questionId]: value };
}

/**
 * Returns true when the minimum required form fields are populated.
 * partyName must be non-empty after trimming; onPremOt must be non-empty.
 */
export function validateForm(partyName: string, onPremOt: string): boolean {
  return partyName.trim().length > 0 && onPremOt.length > 0;
}

/**
 * Maps over segments and stops any open segment whose name matches segmentName.
 * Mirrors the stoppedSegments inline lambda from InterviewRunner.tsx L108-112.
 */
export function computeStoppedSegments(
  segments: TimingSegment[],
  segmentName: string
): TimingSegment[] {
  const now = new Date().toISOString();
  return segments.map((s) =>
    s.segment === segmentName && !s.stopped_at
      ? {
          ...s,
          stopped_at: now,
          duration_ms: new Date(now).getTime() - new Date(s.started_at).getTime(),
        }
      : s
  );
}
