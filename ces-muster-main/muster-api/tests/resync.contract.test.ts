// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// SPA <-> server contract test for the offline-resync path (CRITIQUE_P1
// defects 1 and 3). The SPA builds its cross-boundary payloads in exported
// pure functions (src/features/assessment/adaptiveEngine.ts); this test runs
// those builders against the server's ACTUAL Zod schemas so any drift on
// either side fails here instead of silently 400ing in production.
//
// Cross-package import is intentional (same repo, no shared package) — the
// same pattern tests/sprs.parity.test.ts uses.
import { describe, it, expect } from 'vitest';
import {
  buildSyncPayload,
  buildHilFlagPayload,
  mergeRetroConfidence,
  hilCandidates,
  type RetroAssignment,
} from '../../src/features/assessment/adaptiveEngine';
import type { InterviewSession } from '../../src/shared/types/engagement';
import { syncSchema } from '../src/routes/sessions.js';
import { flagSchema } from '../src/routes/hil.js';

// Realistic SPA-shaped session: nanoid-style ids (NOT uuids)
const session: InterviewSession = {
  id: 'V1StGXR8_Z5jdHi6B-myT',
  party_id: 'p9StGXR8_Z5jdHi6B-abc',
  facts: [
    {
      question_id: 'iam-001',
      question_text: 'MFA enforced?',
      answer: 'yes',
      provenance: 'operator_interview',
      confidence: 'high',
      recorded_at: '2026-07-07T12:00:00.000Z',
    },
  ],
  timing_segments: [],
  status: 'in_progress',
  created_at: '2026-07-07T11:00:00.000Z',
  selected_stacks: ['microsoft_intune'],
  current_question_index: 1,
};

describe('resync contract — POST /sessions/sync', () => {
  it('buildSyncPayload satisfies the server syncSchema', () => {
    const parsed = syncSchema.safeParse(buildSyncPayload(session));
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.flatten())).toBe(true);
  });

  it('accepts nanoid-style ids (regression: schema must not require uuid)', () => {
    const parsed = syncSchema.safeParse(buildSyncPayload(session));
    expect(parsed.success).toBe(true);
  });

  it('accepts a completed session with completed_at', () => {
    const done: InterviewSession = {
      ...session,
      status: 'complete',
      completed_at: '2026-07-07T12:30:00.000Z',
    };
    const parsed = syncSchema.safeParse(buildSyncPayload(done));
    expect(parsed.success).toBe(true);
  });
});

describe('resync contract — POST /hil/flag', () => {
  const assignment: RetroAssignment = {
    question_id: 'iam-001',
    confidence: 'low',
    weight: 3,
  };

  it('buildHilFlagPayload satisfies the server flagSchema', () => {
    const body = buildHilFlagPayload(session.id, assignment, 'yes');
    const parsed = flagSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.flatten())).toBe(true);
  });

  it('carries the fact object the server routes on', () => {
    const body = buildHilFlagPayload(session.id, assignment, 'yes');
    expect(body.fact).toEqual({ answer: 'yes', confidence: 'low', weight: 3 });
  });
});

describe('resync helpers — HIL rule + confidence merge', () => {
  it('hilCandidates applies the EXACT rule: low AND weight >= 3', () => {
    const assignments: RetroAssignment[] = [
      { question_id: 'a', confidence: 'low', weight: 3 }, // routes
      { question_id: 'b', confidence: 'low', weight: 2 }, // does NOT
      { question_id: 'c', confidence: 'high', weight: 5 }, // does NOT
      { question_id: 'd', confidence: 'unknown', weight: 5 }, // does NOT (rule is exact)
      { question_id: 'e', confidence: 'low', weight: 5 }, // routes
    ];
    expect(hilCandidates(assignments).map((a) => a.question_id)).toEqual(['a', 'e']);
  });

  it('mergeRetroConfidence updates matching facts and leaves others intact', () => {
    const merged = mergeRetroConfidence(session.facts, [
      { question_id: 'iam-001', confidence: 'low', weight: 3 },
      { question_id: 'not-present', confidence: 'high', weight: 1 },
    ]);
    expect(merged[0].confidence).toBe('low');
    expect(merged[0].answer).toBe('yes');
    expect(merged).toHaveLength(1);
  });
});
