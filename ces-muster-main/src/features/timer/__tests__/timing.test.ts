// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DW#11 — Timing instrumentation: real pipe from Dexie → export payload
// fake-indexeddb provides a real IndexedDB implementation for the Node test environment.
// Proves that segments persisted to Dexie (as InterviewRunner does on completion)
// actually appear in the exported StatusPayload — not bypassed via hardcoded data.
import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'vitest';
import { db } from '@/shared/db/schema';
import { buildStatusPayload } from '@/features/export/statusPayloadService';
import { generateReadinessPosture } from '@/vendored/ces-spine/services/postureGenerator';
import type { TimingSegment } from '@/shared/types/engagement';

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  await db.subs.clear();
});

describe('DW#11 — timing segments: real Dexie → export pipe', () => {
  test('segments written to Dexie appear in StatusPayload export', async () => {
    const segments: TimingSegment[] = [
      {
        segment: 'setup',
        started_at: '2026-01-01T10:00:00Z',
        stopped_at: '2026-01-01T10:15:00Z',
        duration_ms: 900000,
      },
      {
        segment: 'interview',
        started_at: '2026-01-01T10:15:00Z',
        stopped_at: '2026-01-01T11:00:00Z',
        duration_ms: 2700000,
      },
    ];

    // Seed Dexie — mirrors what TimingProvider accumulates and
    // InterviewRunner writes to Dexie on session completion.
    await db.engagements.add({
      id: 'eng-t1',
      engagement_kind: 'prime_and_subs',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.assessed_parties.add({
      id: 'party-t1',
      engagement_id: 'eng-t1',
      name: 'Timer Corp',
      on_prem_ot: 'no',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.interview_sessions.add({
      id: 'sess-t1',
      party_id: 'party-t1',
      facts: [],
      timing_segments: segments,
      status: 'complete',
      created_at: '2026-01-01T09:00:00Z',
      completed_at: '2026-01-01T11:00:00Z',
    });

    // Read back from Dexie — exactly what executeExport does
    const session = await db.interview_sessions.get('sess-t1');
    const party = await db.assessed_parties.get('party-t1');
    const engagement = await db.engagements.get('eng-t1');
    const posture = generateReadinessPosture({}, [], {}, {});

    const payload = buildStatusPayload(engagement!, party!, session!, 0, posture);

    // Assert segments flow through the real pipe
    expect(payload.timing_segments).toHaveLength(2);
    expect(payload.timing_segments[0].segment).toBe('setup');
    expect(payload.timing_segments[0].duration_ms).toBe(900000);
    expect(payload.timing_segments[1].segment).toBe('interview');
    expect(payload.timing_segments[1].duration_ms).toBe(2700000);
  });

  test('session with no segments persisted to Dexie has empty timing_segments', async () => {
    await db.engagements.add({ id: 'eng-t2', engagement_kind: 'individual_contractor', created_at: '2026-01-01T00:00:00Z' });
    await db.assessed_parties.add({ id: 'party-t2', engagement_id: 'eng-t2', name: 'Solo Corp', on_prem_ot: 'unsure', created_at: '2026-01-01T00:00:00Z' });
    await db.interview_sessions.add({ id: 'sess-t2', party_id: 'party-t2', facts: [], timing_segments: [], status: 'complete', created_at: '2026-01-01T00:00:00Z' });

    const session = await db.interview_sessions.get('sess-t2');
    const party = await db.assessed_parties.get('party-t2');
    const engagement = await db.engagements.get('eng-t2');
    const posture = generateReadinessPosture({}, [], {}, {});

    const payload = buildStatusPayload(engagement!, party!, session!, 0, posture);
    expect(payload.timing_segments).toHaveLength(0);
  });

  test('all four segment types round-trip through Dexie correctly', async () => {
    const allSegments: TimingSegment[] = [
      { segment: 'setup', started_at: '2026-01-01T10:00:00Z', duration_ms: 600000 },
      { segment: 'interview', started_at: '2026-01-01T10:10:00Z', duration_ms: 3600000 },
      { segment: 'verification', started_at: '2026-01-01T11:10:00Z', duration_ms: 900000 },
      { segment: 'review', started_at: '2026-01-01T11:25:00Z', duration_ms: 600000 },
    ];

    await db.engagements.add({ id: 'eng-t3', engagement_kind: 'prime_and_subs', created_at: '2026-01-01T00:00:00Z' });
    await db.assessed_parties.add({ id: 'party-t3', engagement_id: 'eng-t3', name: 'Full Corp', on_prem_ot: 'yes', created_at: '2026-01-01T00:00:00Z' });
    await db.interview_sessions.add({ id: 'sess-t3', party_id: 'party-t3', facts: [], timing_segments: allSegments, status: 'complete', created_at: '2026-01-01T09:00:00Z' });

    const session = await db.interview_sessions.get('sess-t3');
    const party = await db.assessed_parties.get('party-t3');
    const engagement = await db.engagements.get('eng-t3');
    const posture = generateReadinessPosture({}, [], {}, {});

    const payload = buildStatusPayload(engagement!, party!, session!, 25, posture);
    expect(payload.timing_segments).toHaveLength(4);
    const names = payload.timing_segments.map((s) => s.segment);
    expect(names).toContain('setup');
    expect(names).toContain('interview');
    expect(names).toContain('verification');
    expect(names).toContain('review');
  });
});
