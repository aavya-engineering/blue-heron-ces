// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Pure-function unit tests for Quick Session logic.
// No jsdom, no component mount, no @testing-library/react.
import { describe, test, expect } from 'vitest';
import {
  updateAnswer,
  validateForm,
  computeStoppedSegments,
} from '@/features/quick/quickSessionHelpers';
import { QUICK_SESSION_EXAMPLES } from '@/__fixtures__/quickSessionExamples';

// ---------------------------------------------------------------------------
// updateAnswer — answer-state reducer
// ---------------------------------------------------------------------------

describe('updateAnswer', () => {
  test('adds a new entry to an empty map', () => {
    const result = updateAnswer({}, 'iam-001', 'yes');
    expect(result).toEqual({ 'iam-001': 'yes' });
  });

  test('overwrites an existing entry without mutating the original', () => {
    const original = { 'iam-001': 'yes' };
    const updated = updateAnswer(original, 'iam-001', 'no');
    expect(updated['iam-001']).toBe('no');
    // original is unchanged
    expect(original['iam-001']).toBe('yes');
  });

  test('preserves existing entries when adding a new one', () => {
    const result = updateAnswer({ 'iam-001': 'yes' }, 'iam-002', 'no');
    expect(result).toEqual({ 'iam-001': 'yes', 'iam-002': 'no' });
  });
});

// ---------------------------------------------------------------------------
// validateForm — validation gate
// ---------------------------------------------------------------------------

describe('validateForm', () => {
  test('returns false when partyName is empty', () => {
    expect(validateForm('', 'yes')).toBe(false);
  });

  test('returns false when partyName is whitespace only', () => {
    expect(validateForm('   ', 'yes')).toBe(false);
  });

  test('returns false when onPremOt is empty', () => {
    expect(validateForm('Acme', '')).toBe(false);
  });

  test('returns true when both fields are populated', () => {
    expect(validateForm('Acme', 'yes')).toBe(true);
  });

  test('returns true for all valid onPremOt values', () => {
    expect(validateForm('Acme', 'no')).toBe(true);
    expect(validateForm('Acme', 'unsure')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeStoppedSegments — stoppedSegments computation
// Mirror of interviewAutoTimer.test.ts pattern.
// ---------------------------------------------------------------------------

describe('computeStoppedSegments', () => {
  test('fills stopped_at with a non-empty ISO string for an open interview segment', () => {
    const started_at = '2026-01-01T10:00:00.000Z';
    const segments = [{ segment: 'interview' as const, started_at }];
    const result = computeStoppedSegments(segments, 'interview');
    expect(result[0].stopped_at).toBeTruthy();
    expect(typeof result[0].stopped_at).toBe('string');
  });

  test('duration_ms is non-negative', () => {
    const started_at = '2026-01-01T10:00:00.000Z';
    const segments = [{ segment: 'interview' as const, started_at }];
    const result = computeStoppedSegments(segments, 'interview');
    expect(result[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('does not modify segments that are already stopped', () => {
    const original_stopped_at = '2026-01-01T10:15:00.000Z';
    const segments = [
      {
        segment: 'interview' as const,
        started_at: '2026-01-01T10:00:00.000Z',
        stopped_at: original_stopped_at,
        duration_ms: 900_000,
      },
    ];
    const result = computeStoppedSegments(segments, 'interview');
    expect(result[0].stopped_at).toBe(original_stopped_at);
    expect(result[0].duration_ms).toBe(900_000);
  });

  test('does not modify non-matching segments', () => {
    const segments = [
      { segment: 'setup' as const, started_at: '2026-01-01T09:00:00.000Z' },
    ];
    const result = computeStoppedSegments(segments, 'interview');
    expect(result[0].stopped_at).toBeUndefined();
    expect(result[0].duration_ms).toBeUndefined();
  });

  test('returns plain objects with no side effects', () => {
    const segments = [{ segment: 'interview' as const, started_at: '2026-01-01T10:00:00.000Z' }];
    const result = computeStoppedSegments(segments, 'interview');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ segment: 'interview', started_at: '2026-01-01T10:00:00.000Z' });
    expect(result[0].stopped_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Fixture integrity
// ---------------------------------------------------------------------------

describe('QUICK_SESSION_EXAMPLES fixture integrity', () => {
  test('fixture 1 has 24 answer keys', () => {
    expect(Object.keys(QUICK_SESSION_EXAMPLES[0].answers).length).toBe(24);
  });

  test('fixture 1 passes validateForm', () => {
    const f = QUICK_SESSION_EXAMPLES[0];
    expect(validateForm(f.partyName, f.onPremOt)).toBe(true);
  });

  test('fixture 2 has 25 answer keys', () => {
    expect(Object.keys(QUICK_SESSION_EXAMPLES[1].answers).length).toBe(25);
  });

  test('fixture 2 passes validateForm', () => {
    const f = QUICK_SESSION_EXAMPLES[1];
    expect(validateForm(f.partyName, f.onPremOt)).toBe(true);
  });

  test('fixture 3 has 23 answer keys', () => {
    expect(Object.keys(QUICK_SESSION_EXAMPLES[2].answers).length).toBe(23);
  });

  test('fixture 3 passes validateForm', () => {
    const f = QUICK_SESSION_EXAMPLES[2];
    expect(validateForm(f.partyName, f.onPremOt)).toBe(true);
  });
});
