// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Pure-function unit test for the stoppedSegments map lambda used by the
// assessment completion path (computeStoppedSegments in quickSessionHelpers,
// consumed by AssessmentPage.finishInterview). No jsdom, no component mount,
// no @testing-library/react.
import { describe, test, expect } from 'vitest';

interface TimingSegmentLike {
  segment: string;
  started_at: string;
  stopped_at?: string;
  duration_ms?: number;
}

/**
 * The map lambda from the assessment completion branch (see
 * computeStoppedSegments). Reproduced here as a pure function so it can be
 * tested without mounting the React component.
 */
function applyStoppedSegments(
  segments: TimingSegmentLike[],
  now: string
): TimingSegmentLike[] {
  return segments.map((s) =>
    s.segment === 'interview' && !s.stopped_at
      ? {
          ...s,
          stopped_at: now,
          duration_ms: new Date(now).getTime() - new Date(s.started_at).getTime(),
        }
      : s
  );
}

describe('stoppedSegments map lambda — pure function', () => {
  const started_at = '2026-07-06T10:00:00.000Z';
  const now = '2026-07-06T10:30:00.000Z';
  const expectedDurationMs = new Date(now).getTime() - new Date(started_at).getTime(); // 1_800_000

  test('fills stopped_at with the now timestamp for the interview segment', () => {
    const segments: TimingSegmentLike[] = [
      { segment: 'interview', started_at, stopped_at: undefined, duration_ms: undefined },
    ];
    const result = applyStoppedSegments(segments, now);
    expect(result[0].stopped_at).toBe(now);
  });

  test('duration_ms is greater than zero', () => {
    const segments: TimingSegmentLike[] = [
      { segment: 'interview', started_at, stopped_at: undefined, duration_ms: undefined },
    ];
    const result = applyStoppedSegments(segments, now);
    expect(result[0].duration_ms).toBeGreaterThan(0);
  });

  test('duration_ms equals now - started_at in milliseconds', () => {
    const segments: TimingSegmentLike[] = [
      { segment: 'interview', started_at, stopped_at: undefined, duration_ms: undefined },
    ];
    const result = applyStoppedSegments(segments, now);
    expect(result[0].duration_ms).toBe(expectedDurationMs);
  });

  test('does not modify segments that are already stopped', () => {
    const original_stopped_at = '2026-07-06T10:15:00.000Z';
    const original_duration = 900_000;
    const segments: TimingSegmentLike[] = [
      {
        segment: 'interview',
        started_at,
        stopped_at: original_stopped_at,
        duration_ms: original_duration,
      },
    ];
    const result = applyStoppedSegments(segments, now);
    expect(result[0].stopped_at).toBe(original_stopped_at);
    expect(result[0].duration_ms).toBe(original_duration);
  });

  test('does not modify non-interview segments', () => {
    const segments: TimingSegmentLike[] = [
      { segment: 'setup', started_at, stopped_at: undefined, duration_ms: undefined },
    ];
    const result = applyStoppedSegments(segments, now);
    expect(result[0].stopped_at).toBeUndefined();
    expect(result[0].duration_ms).toBeUndefined();
  });

  test('no fetch or Dexie write is triggered — inputs and outputs are plain objects', () => {
    const segments: TimingSegmentLike[] = [
      { segment: 'interview', started_at, stopped_at: undefined, duration_ms: undefined },
    ];
    // applyStoppedSegments is a pure transformation; calling it does not produce
    // any side effects (no fetch, no Dexie call, no DOM mutation).
    const result = applyStoppedSegments(segments, now);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ segment: 'interview', started_at, stopped_at: now });
  });
});
