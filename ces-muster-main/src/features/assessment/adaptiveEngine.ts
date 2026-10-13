// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * Adaptive interview state machine.
 *
 * Modes:
 *   'adaptive'  — questions suggested via POST /interview/adaptive/next
 *   'degraded'  — static QuestionGraph (identical to offline-only behavior)
 *
 * Mode transition triggers (DONE-WHEN #6):
 *   - THREE consecutive failed/timeout calls to /interview/adaptive/next
 *   - Browser 'offline' event
 *
 * A success resets the consecutive-failure counter (but does NOT un-degrade).
 * Once degraded, the engine stays degraded for the session.
 *
 * Answers are queued in Dexie 'queued_answers' whenever the engine is active.
 * Resync: POST /sessions/sync on 'online' event or manual call.
 * Finish gate: canFinish() returns false when unsynced answers exist
 * (the SPA blocks finishInterview with a visible note in that case).
 */

import { db } from '@/shared/db/schema';
import { api } from '@/shared/api/musterApi';
import type { InterviewFact, InterviewSession, QueuedAnswer } from '@/shared/types/engagement';
import type { QuestionNode } from '@/features/interview/questionGraphService';
import { nanoid } from '@/shared/utils/nanoid';

export type AdaptiveMode = 'adaptive' | 'degraded';

export interface AdaptiveNextResult {
  question: QuestionNode | null;
  mode: AdaptiveMode;
}

/** Summary shape POST /interview/adaptive/next requires for the pickable bank. */
export interface QuestionSummary {
  id: string;
  text: string;
  cluster: string;
}

/** Per-fact assignment returned by POST /interview/retro-confidence. */
export interface RetroAssignment {
  question_id: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  weight: number;
}

// ── Contract payload builders ───────────────────────────────────────────────
// These are exported pure functions so muster-api/tests/resync.contract.test.ts
// can validate them against the server's actual Zod schemas — the resync path
// broke once because SPA payloads drifted from the server contract (CRITIQUE_P1
// defects 1 and 3); keep every cross-boundary body in a builder here.

/** Body for POST /sessions/sync — must satisfy syncSchema in routes/sessions.ts. */
export function buildSyncPayload(session: InterviewSession) {
  return {
    id: session.id,
    party_id: session.party_id,
    facts: session.facts,
    timing_segments: session.timing_segments,
    selected_stacks: session.selected_stacks ?? [],
    status: session.status,
    completed_at: session.completed_at ?? null,
  };
}

/** Body for POST /hil/flag — must satisfy flagSchema in routes/hil.ts. */
export function buildHilFlagPayload(
  sessionId: string,
  assignment: RetroAssignment,
  answer: string
) {
  return {
    session_id: sessionId,
    question_id: assignment.question_id,
    fact: {
      answer,
      confidence: assignment.confidence,
      weight: assignment.weight,
    },
  };
}

/** Facts with retro-assigned confidences merged in (immutably). */
export function mergeRetroConfidence(
  facts: InterviewFact[],
  assignments: RetroAssignment[]
): InterviewFact[] {
  const byId = new Map(assignments.map((a) => [a.question_id, a]));
  return facts.map((f) => {
    const a = byId.get(f.question_id);
    return a ? { ...f, confidence: a.confidence } : f;
  });
}

/**
 * Assignments that must route to HIL before score release.
 * EXACT rule (mirrors hilService.routeFact): confidence 'low' AND weight >= 3.
 */
export function hilCandidates(assignments: RetroAssignment[]): RetroAssignment[] {
  return assignments.filter((a) => a.confidence === 'low' && a.weight >= 3);
}

export class AdaptiveEngine {
  private mode: AdaptiveMode = 'adaptive';
  private failureCount = 0;
  private sessionId: string;
  private offlineHandler: () => void;
  private onlineHandler: () => void;
  private onModeChange?: (mode: AdaptiveMode) => void;
  private onPendingSyncChange?: (pending: boolean) => void;

  constructor(
    sessionId: string,
    opts?: {
      onModeChange?: (mode: AdaptiveMode) => void;
      onPendingSyncChange?: (pending: boolean) => void;
    }
  ) {
    this.sessionId = sessionId;
    this.onModeChange = opts?.onModeChange;
    this.onPendingSyncChange = opts?.onPendingSyncChange;

    this.offlineHandler = () => this.handleOffline();
    this.onlineHandler = () => void this.handleOnline();

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', this.offlineHandler);
      window.addEventListener('online', this.onlineHandler);
    }
  }

  getMode(): AdaptiveMode {
    return this.mode;
  }

  handleOffline(): void {
    this.degradeTo();
  }

  async handleOnline(): Promise<void> {
    await this.resync();
  }

  private degradeTo(): void {
    if (this.mode !== 'degraded') {
      this.mode = 'degraded';
      this.onModeChange?.('degraded');
    }
  }

  /**
   * Request the next suggested question from the server.
   * Returns null for the question on any failure (caller falls back to static graph).
   * THREE consecutive failures permanently switch mode to 'degraded'.
   */
  async getNextQuestion(
    priorFacts: InterviewFact[],
    stacks: string[],
    remainingQuestions: QuestionSummary[]
  ): Promise<AdaptiveNextResult> {
    if (this.mode === 'degraded') {
      return { question: null, mode: 'degraded' };
    }

    const result = await api.post<{ question: QuestionNode | null; degraded?: boolean }>(
      '/interview/adaptive/next',
      {
        sessionId: this.sessionId,
        priorFacts: priorFacts.map((f) => ({ question_id: f.question_id, answer: f.answer })),
        stacks,
        remainingQuestions,
      }
    );

    if (!result.ok) {
      this.failureCount += 1;
      if (this.failureCount >= 3) {
        this.degradeTo();
      }
      return { question: null, mode: this.mode };
    }

    // Success — reset consecutive failure counter (stays in adaptive mode)
    this.failureCount = 0;
    if (result.data.degraded) {
      this.degradeTo();
      return { question: null, mode: 'degraded' };
    }
    return { question: result.data.question, mode: this.mode };
  }

  /**
   * Queue an answer to Dexie for later sync.
   * Should be called whenever an answer is recorded in adaptive mode
   * (including degraded mode — answers still need to sync).
   */
  async queueAnswer(questionId: string, answer: string): Promise<void> {
    const qa: QueuedAnswer = {
      id: nanoid(),
      session_id: this.sessionId,
      question_id: questionId,
      answer,
      recorded_at: new Date().toISOString(),
      synced: 0,
    };
    await db.queued_answers.add(qa);
    this.onPendingSyncChange?.(true);
  }

  /**
   * Sync all unsynced queued answers to the server (DONE-WHEN #6).
   * Called automatically on 'online' event or manually by the "Resync" button.
   *
   * Sequence:
   *   1. POST /interview/retro-confidence with the queued answers — the server
   *      retro-assigns confidence + weight per fact. If that call fails or is
   *      degraded, fall back to the same conservative default the server uses
   *      when degraded: confidence 'low', weight 3 (routes to HIL)
   *      [validate with BHD].
   *   2. Merge the assignments into the session facts and persist to Dexie so
   *      the confidences are in place BEFORE score release.
   *   3. POST /sessions/sync with the FULL server-contract payload
   *      (buildSyncPayload — see contract test).
   *   4. Mark queued answers synced; route low+weight>=3 facts to /hil/flag.
   */
  async resync(): Promise<void> {
    const unsynced = await db.queued_answers
      .where('session_id')
      .equals(this.sessionId)
      .filter((q) => q.synced === 0)
      .toArray();

    if (unsynced.length === 0) {
      this.onPendingSyncChange?.(false);
      return;
    }

    const session = await db.interview_sessions.get(this.sessionId);
    if (!session) return;

    // 1. Retro-assign confidence (server call, conservative local fallback)
    const retro = await api.post<{ results?: RetroAssignment[] }>('/interview/retro-confidence', {
      facts: unsynced.map((q) => ({ question_id: q.question_id, answer: q.answer })),
    });
    const assignments: RetroAssignment[] =
      retro.ok && retro.data.results && retro.data.results.length > 0
        ? retro.data.results
        : unsynced.map((q) => ({
            question_id: q.question_id,
            confidence: 'low' as const,
            weight: 3,
          }));

    // 2. Merge + persist confidences before score release
    const mergedFacts = mergeRetroConfidence(session.facts, assignments);
    await db.interview_sessions.update(this.sessionId, { facts: mergedFacts });

    // 3. Full-contract session sync
    const result = await api.post('/sessions/sync', buildSyncPayload({ ...session, facts: mergedFacts }));
    if (!result.ok) return; // stays pending; user can retry

    // 4. Mark synced + HIL routing (exact rule: low AND weight >= 3)
    await Promise.all(unsynced.map((qa) => db.queued_answers.update(qa.id, { synced: 1 })));

    const answerById = new Map(unsynced.map((q) => [q.question_id, q.answer]));
    for (const a of hilCandidates(assignments)) {
      // Fire-and-forget HIL flag — a failure here does not re-block the session
      void api.post(
        '/hil/flag',
        buildHilFlagPayload(this.sessionId, a, answerById.get(a.question_id) ?? '')
      );
    }

    this.onPendingSyncChange?.(false);
  }

  /**
   * True when the session has no unsynced queued answers.
   * AssessmentPage calls this to gate finishInterview.
   */
  async canFinish(): Promise<boolean> {
    const unsynced = await db.queued_answers
      .where('session_id')
      .equals(this.sessionId)
      .filter((q) => q.synced === 0)
      .toArray();
    return unsynced.length === 0;
  }

  /** Detach browser event listeners. Call on component unmount. */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', this.offlineHandler);
      window.removeEventListener('online', this.onlineHandler);
    }
  }
}
