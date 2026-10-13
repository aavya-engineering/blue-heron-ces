// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Adaptive engine unit tests — jsdom env (window available for offline/online events,
// fake-indexeddb provides real Dexie storage).
// Mock fetch — no real network calls in these tests. Resync mocks are
// URL-AWARE so payload-shape drift fails here (see also
// muster-api/tests/resync.contract.test.ts for schema-level validation).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '@/shared/db/schema';
import type { InterviewSession } from '@/shared/types/engagement';
import { AdaptiveEngine } from '../adaptiveEngine';

// Reset fake DB before each test
beforeEach(async () => {
  await db.queued_answers.clear();
  await db.interview_sessions.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Seed the Dexie session record resync() reads its sync payload from. */
async function seedSession(id: string): Promise<InterviewSession> {
  const session: InterviewSession = {
    id,
    party_id: `party-${id}`,
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
    selected_stacks: [],
    current_question_index: 1,
  };
  await db.interview_sessions.add(session);
  return session;
}

interface RecordedCall {
  url: string;
  body: unknown;
}

/**
 * URL-aware fetch mock for the resync flow. Returns retro assignments for
 * /interview/retro-confidence, ok for /sessions/sync and /hil/flag.
 */
function mockResyncFetch(retroResults: unknown[] | 'fail') {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    if (String(url).includes('/interview/retro-confidence')) {
      if (retroResults === 'fail') {
        return { ok: false, status: 503, json: async () => ({ degraded: true }) };
      }
      return { ok: true, json: async () => ({ results: retroResults }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

// ── Mode transition: 3 consecutive failures → degraded ────────────────────

describe('3 consecutive failures → degraded', () => {
  it('stays adaptive after 1 failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const engine = new AdaptiveEngine('sess-1');
    await engine.getNextQuestion([], [], []);
    expect(engine.getMode()).toBe('adaptive');
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('stays adaptive after 2 consecutive failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const engine = new AdaptiveEngine('sess-2');
    await engine.getNextQuestion([], [], []);
    await engine.getNextQuestion([], [], []);
    expect(engine.getMode()).toBe('adaptive');
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('switches to degraded after 3 consecutive failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const engine = new AdaptiveEngine('sess-3');
    await engine.getNextQuestion([], [], []);
    await engine.getNextQuestion([], [], []);
    await engine.getNextQuestion([], [], []);
    expect(engine.getMode()).toBe('degraded');
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('calls onModeChange callback when transitioning to degraded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const onModeChange = vi.fn();
    const engine = new AdaptiveEngine('sess-4', { onModeChange });
    await engine.getNextQuestion([], [], []);
    await engine.getNextQuestion([], [], []);
    await engine.getNextQuestion([], [], []);
    expect(onModeChange).toHaveBeenCalledWith('degraded');
    engine.destroy();
    vi.unstubAllGlobals();
  });
});

// ── Success resets failure counter ────────────────────────────────────────

describe('success resets failure counter', () => {
  it('2 failures then 1 success then 2 more failures — stays adaptive (counter reset)', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ question: null, degraded: false }) })
      .mockRejectedValueOnce(new Error('fail 3'))
      .mockRejectedValueOnce(new Error('fail 4'));

    vi.stubGlobal('fetch', mockFetch);
    const engine = new AdaptiveEngine('sess-5');
    await engine.getNextQuestion([], [], []); // fail 1
    await engine.getNextQuestion([], [], []); // fail 2
    await engine.getNextQuestion([], [], []); // success — resets to 0
    await engine.getNextQuestion([], [], []); // fail 3 (count=1)
    await engine.getNextQuestion([], [], []); // fail 4 (count=2)
    // count is 2 — not yet degraded (needs 3 consecutive)
    expect(engine.getMode()).toBe('adaptive');
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('3 failures then success then 3 more failures → degraded on last batch', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      // degraded already after 3rd — success doesn't un-degrade
      .mockResolvedValueOnce({ ok: true, json: async () => ({ question: null }) });

    vi.stubGlobal('fetch', mockFetch);
    const engine = new AdaptiveEngine('sess-6');
    await engine.getNextQuestion([], [], []);
    await engine.getNextQuestion([], [], []);
    await engine.getNextQuestion([], [], []); // → degraded
    expect(engine.getMode()).toBe('degraded');
    // success call still returns degraded (mode is sticky)
    await engine.getNextQuestion([], [], []);
    expect(engine.getMode()).toBe('degraded');
    engine.destroy();
    vi.unstubAllGlobals();
  });
});

// ── getNextQuestion carries the full server contract ──────────────────────

describe('getNextQuestion request contract', () => {
  it('posts sessionId, priorFacts (id+answer only), stacks, and remainingQuestions', async () => {
    const { calls } = mockResyncFetch([]);
    const engine = new AdaptiveEngine('sess-contract');
    await engine.getNextQuestion(
      [
        {
          question_id: 'iam-001',
          question_text: 'MFA?',
          answer: 'yes',
          provenance: 'operator_interview',
          confidence: 'high',
          recorded_at: '2026-07-07T12:00:00.000Z',
        },
      ],
      ['microsoft_intune'],
      [{ id: 'ep-001', text: 'MDM enrolled?', cluster: 'endpoint' }]
    );
    const call = calls.find((c) => c.url.includes('/interview/adaptive/next'));
    expect(call).toBeDefined();
    expect(call!.body).toEqual({
      sessionId: 'sess-contract',
      priorFacts: [{ question_id: 'iam-001', answer: 'yes' }],
      stacks: ['microsoft_intune'],
      remainingQuestions: [{ id: 'ep-001', text: 'MDM enrolled?', cluster: 'endpoint' }],
    });
    engine.destroy();
    vi.unstubAllGlobals();
  });
});

// ── Offline event → degraded ──────────────────────────────────────────────

describe('browser offline event → degraded', () => {
  it('fires offline event → engine switches to degraded', () => {
    vi.stubGlobal('fetch', vi.fn());
    const engine = new AdaptiveEngine('sess-7');
    expect(engine.getMode()).toBe('adaptive');
    window.dispatchEvent(new Event('offline'));
    expect(engine.getMode()).toBe('degraded');
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('direct handleOffline() call → degraded', () => {
    vi.stubGlobal('fetch', vi.fn());
    const engine = new AdaptiveEngine('sess-8');
    engine.handleOffline();
    expect(engine.getMode()).toBe('degraded');
    engine.destroy();
    vi.unstubAllGlobals();
  });
});

// ── Queue round-trip with fake-indexeddb ─────────────────────────────────

describe('queueAnswer round-trip with Dexie', () => {
  it('queues an answer and the record appears in Dexie with synced=0', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const engine = new AdaptiveEngine('sess-q1');
    await engine.queueAnswer('iam-001', 'yes');

    const rows = await db.queued_answers.where('session_id').equals('sess-q1').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].question_id).toBe('iam-001');
    expect(rows[0].answer).toBe('yes');
    expect(rows[0].synced).toBe(0);
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('queues multiple answers', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const engine = new AdaptiveEngine('sess-q2');
    await engine.queueAnswer('iam-001', 'yes');
    await engine.queueAnswer('ep-001', 'no');

    const rows = await db.queued_answers.where('session_id').equals('sess-q2').toArray();
    expect(rows).toHaveLength(2);
    engine.destroy();
    vi.unstubAllGlobals();
  });
});

// ── Resync flow (DONE-WHEN #6 — post-CRITIQUE_P1 contract) ────────────────

describe('resync — retro-confidence, full-contract sync, HIL routing', () => {
  it('marks answers synced and posts the FULL session-sync contract body', async () => {
    const { calls } = mockResyncFetch([
      { question_id: 'iam-001', confidence: 'high', weight: 1 },
    ]);
    const session = await seedSession('sess-q3');
    const engine = new AdaptiveEngine('sess-q3');
    await engine.queueAnswer('iam-001', 'yes');

    await engine.resync();

    const rows = await db.queued_answers.where('session_id').equals('sess-q3').toArray();
    expect(rows[0].synced).toBe(1);

    const syncCall = calls.find((c) => c.url.includes('/sessions/sync'));
    expect(syncCall).toBeDefined();
    const body = syncCall!.body as Record<string, unknown>;
    // Server syncSchema contract: id, party_id, facts, timing_segments,
    // selected_stacks, status (NOT {sessionId, answers})
    expect(body.id).toBe(session.id);
    expect(body.party_id).toBe(session.party_id);
    expect(Array.isArray(body.facts)).toBe(true);
    expect(body.status).toBe('in_progress');
    expect(body.selected_stacks).toEqual([]);
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('routes low+weight>=3 assignments to /hil/flag with the fact object', async () => {
    const { calls } = mockResyncFetch([
      { question_id: 'iam-001', confidence: 'low', weight: 3 },
    ]);
    await seedSession('sess-hil');
    const engine = new AdaptiveEngine('sess-hil');
    await engine.queueAnswer('iam-001', 'yes');

    await engine.resync();
    // fire-and-forget flag — flush microtasks
    await new Promise((r) => setTimeout(r, 0));

    const flagCall = calls.find((c) => c.url.includes('/hil/flag'));
    expect(flagCall).toBeDefined();
    expect(flagCall!.body).toEqual({
      session_id: 'sess-hil',
      question_id: 'iam-001',
      fact: { answer: 'yes', confidence: 'low', weight: 3 },
    });
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('does NOT flag high-confidence or low-weight assignments', async () => {
    const { calls } = mockResyncFetch([
      { question_id: 'iam-001', confidence: 'high', weight: 5 },
      { question_id: 'ep-001', confidence: 'low', weight: 2 },
    ]);
    await seedSession('sess-nohil');
    const engine = new AdaptiveEngine('sess-nohil');
    await engine.queueAnswer('iam-001', 'yes');
    await engine.queueAnswer('ep-001', 'no');

    await engine.resync();
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.some((c) => c.url.includes('/hil/flag'))).toBe(false);
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('falls back to conservative low/weight-3 (→ HIL) when retro-confidence is degraded', async () => {
    const { calls } = mockResyncFetch('fail');
    await seedSession('sess-degraded');
    const engine = new AdaptiveEngine('sess-degraded');
    await engine.queueAnswer('iam-001', 'unsure');

    await engine.resync();
    await new Promise((r) => setTimeout(r, 0));

    // Conservative default still syncs AND routes to HIL
    const rows = await db.queued_answers.where('session_id').equals('sess-degraded').toArray();
    expect(rows[0].synced).toBe(1);
    const flagCall = calls.find((c) => c.url.includes('/hil/flag'));
    expect(flagCall).toBeDefined();
    expect((flagCall!.body as { fact: { confidence: string; weight: number } }).fact).toMatchObject(
      { confidence: 'low', weight: 3 }
    );
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('persists retro-assigned confidences into the Dexie session facts before score release', async () => {
    mockResyncFetch([{ question_id: 'iam-001', confidence: 'low', weight: 3 }]);
    await seedSession('sess-persist');
    const engine = new AdaptiveEngine('sess-persist');
    await engine.queueAnswer('iam-001', 'yes');

    await engine.resync();

    const stored = await db.interview_sessions.get('sess-persist');
    expect(stored!.facts[0].confidence).toBe('low');
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('resync does nothing when there are no unsynced answers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const engine = new AdaptiveEngine('sess-q4');
    // No answers queued
    await engine.resync();
    // fetch should not be called (no sync payload to POST)
    expect(fetchMock).not.toHaveBeenCalled();
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('leaves answers unsynced (pending) when the session sync call fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/interview/retro-confidence')) {
        return { ok: true, json: async () => ({ results: [] }) };
      }
      return { ok: false, status: 400, json: async () => ({ error: 'bad' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    await seedSession('sess-syncfail');
    const engine = new AdaptiveEngine('sess-syncfail');
    await engine.queueAnswer('iam-001', 'yes');

    await engine.resync();

    const rows = await db.queued_answers.where('session_id').equals('sess-syncfail').toArray();
    expect(rows[0].synced).toBe(0);
    expect(await engine.canFinish()).toBe(false);
    engine.destroy();
    vi.unstubAllGlobals();
  });
});

// ── Finish-gating logic ───────────────────────────────────────────────────

describe('canFinish — finish-gating', () => {
  it('returns true when there are no queued answers', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const engine = new AdaptiveEngine('sess-fg1');
    const can = await engine.canFinish();
    expect(can).toBe(true);
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('returns false when unsynced answers exist', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const engine = new AdaptiveEngine('sess-fg2');
    await engine.queueAnswer('iam-001', 'yes');
    const can = await engine.canFinish();
    expect(can).toBe(false);
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('returns true after all answers are synced', async () => {
    mockResyncFetch([]);
    await seedSession('sess-fg3');
    const engine = new AdaptiveEngine('sess-fg3');
    await engine.queueAnswer('iam-001', 'yes');
    expect(await engine.canFinish()).toBe(false);
    await engine.resync();
    expect(await engine.canFinish()).toBe(true);
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('onPendingSyncChange is called true when answer queued', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const onPendingSyncChange = vi.fn();
    const engine = new AdaptiveEngine('sess-fg4', { onPendingSyncChange });
    await engine.queueAnswer('iam-001', 'yes');
    expect(onPendingSyncChange).toHaveBeenCalledWith(true);
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('onPendingSyncChange is called false after successful resync', async () => {
    mockResyncFetch([]);
    await seedSession('sess-fg5');
    const onPendingSyncChange = vi.fn();
    const engine = new AdaptiveEngine('sess-fg5', { onPendingSyncChange });
    await engine.queueAnswer('iam-001', 'yes');
    await engine.resync();
    // Last call should be false (sync complete)
    const calls = onPendingSyncChange.mock.calls;
    expect(calls[calls.length - 1][0]).toBe(false);
    engine.destroy();
    vi.unstubAllGlobals();
  });
});
