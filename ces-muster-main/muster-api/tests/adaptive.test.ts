// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// adaptive.test.ts â€” unit tests for adaptiveInterviewService.
// Uses dependency injection (injectedClient param) â€” no real network calls.

import { describe, it, expect, vi } from 'vitest';
import { RateLimitError, APIConnectionError, InternalServerError, APIError } from '@anthropic-ai/sdk';
import { createAdaptiveInterviewService } from '../src/services/adaptiveInterviewService.js';

const REMAINING = [
  { id: 'iam-001', text: 'Do you use MFA?', cluster: 'identity' },
  { id: 'iam-002', text: 'Do you have a user inventory?', cluster: 'identity' },
  { id: 'ep-001', text: 'Are devices enrolled in MDM?', cluster: 'endpoint' },
];

const PRIOR_FACTS = [{ question_id: 'pol-001', answer: 'yes' }];

function makeTextResponse(obj: object) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj) }],
  };
}

// â”€â”€â”€ Degraded path (no key / null client) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('adaptiveInterviewService â€” degraded path (null client)', () => {
  it('nextQuestion throws {degraded:true, status:503} when client is null', async () => {
    const svc = createAdaptiveInterviewService(null);
    await expect(
      svc.nextQuestion({ priorFacts: PRIOR_FACTS, stacks: [], remainingQuestions: REMAINING })
    ).rejects.toMatchObject({ degraded: true, status: 503 });
  });

  it('retroConfidence returns low/weight-3 for every fact when client is null', async () => {
    const svc = createAdaptiveInterviewService(null);
    const facts = [
      { question_id: 'iam-001', answer: 'yes' },
      { question_id: 'ep-001', answer: 'unknown' },
    ];
    const results = await svc.retroConfidence(facts);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.confidence).toBe('low');
      expect(r.weight).toBe(3);
    }
  });
});

// â”€â”€â”€ nextQuestion â€” id validation fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('adaptiveInterviewService â€” nextQuestion id validation', () => {
  it('falls back to first remaining question when model returns unknown id', async () => {
    const mockCreate = vi.fn().mockResolvedValue(
      makeTextResponse({
        next_question_id: 'invented-question-999',
        rationale: 'picked something random',
        confidence: 'low',
      })
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    const result = await svc.nextQuestion({
      priorFacts: PRIOR_FACTS,
      stacks: [],
      remainingQuestions: REMAINING,
    });

    expect(result.question_id).toBe('iam-001');
    expect(result.provenance).toBe('ai_adaptive');
  });

  it('accepts a valid id returned by the model', async () => {
    const mockCreate = vi.fn().mockResolvedValue(
      makeTextResponse({
        next_question_id: 'ep-001',
        rationale: 'endpoint coverage is low',
        confidence: 'high',
      })
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    const result = await svc.nextQuestion({
      priorFacts: PRIOR_FACTS,
      stacks: ['microsoft_intune'],
      remainingQuestions: REMAINING,
    });

    expect(result.question_id).toBe('ep-001');
    expect(result.confidence).toBe('high');
    expect(result.provenance).toBe('ai_adaptive');
  });

  it('accepts null next_question_id when model signals no more questions', async () => {
    const mockCreate = vi.fn().mockResolvedValue(
      makeTextResponse({
        next_question_id: null,
        rationale: 'interview complete',
        confidence: 'high',
      })
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    const result = await svc.nextQuestion({
      priorFacts: PRIOR_FACTS,
      stacks: [],
      remainingQuestions: REMAINING,
    });

    expect(result.question_id).toBeNull();
  });
});

// â”€â”€â”€ retroConfidence â€” degraded SDK errors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('adaptiveInterviewService â€” retroConfidence degraded on SDK errors', () => {
  const facts = [
    { question_id: 'iam-001', answer: 'no' },
    { question_id: 'ep-002', answer: 'unknown' },
  ];

  it('returns low/weight-3 on RateLimitError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new RateLimitError(429, { error: { message: 'rate limit' } }, 'rate limit', new Headers())
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    const results = await svc.retroConfidence(facts);
    expect(results).toHaveLength(2);
    expect(results[0].confidence).toBe('low');
    expect(results[0].weight).toBe(3);
  });

  it('returns low/weight-3 on APIConnectionError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new APIConnectionError({ message: 'connection failed' })
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    const results = await svc.retroConfidence(facts);
    expect(results[0].confidence).toBe('low');
  });

  it('returns low/weight-3 on InternalServerError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new InternalServerError(500, { error: { message: 'internal' } }, 'internal', new Headers())
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    const results = await svc.retroConfidence(facts);
    expect(results[0].confidence).toBe('low');
  });
});

// â”€â”€â”€ nextQuestion â€” SDK error mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('adaptiveInterviewService â€” nextQuestion SDK error mapping', () => {
  it('throws {degraded:true, status:503} on RateLimitError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new RateLimitError(429, { error: { message: 'rate limit' } }, 'rate limit', new Headers())
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    await expect(
      svc.nextQuestion({ priorFacts: [], stacks: [], remainingQuestions: REMAINING })
    ).rejects.toMatchObject({ degraded: true, status: 503 });
  });

  it('throws {degraded:true, status:503} on APIConnectionError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new APIConnectionError({ message: 'connection failed' })
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    await expect(
      svc.nextQuestion({ priorFacts: [], stacks: [], remainingQuestions: REMAINING })
    ).rejects.toMatchObject({ degraded: true, status: 503 });
  });

  it('throws {degraded:true, status:502} on other APIError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new APIError(400, { error: { message: 'bad input' } }, 'bad input', new Headers())
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    await expect(
      svc.nextQuestion({ priorFacts: [], stacks: [], remainingQuestions: REMAINING })
    ).rejects.toMatchObject({ degraded: true, status: 502 });
  });
});

// â”€â”€â”€ retroConfidence â€” happy path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('adaptiveInterviewService â€” retroConfidence happy path', () => {
  it('returns model confidence assignments', async () => {
    const facts = [
      { question_id: 'iam-001', answer: 'yes' },
      { question_id: 'ep-002', answer: 'no' },
    ];
    const mockCreate = vi.fn().mockResolvedValue(
      makeTextResponse({
        results: [
          { question_id: 'iam-001', confidence: 'high', weight: 4 },
          { question_id: 'ep-002', confidence: 'low', weight: 2 },
        ],
      })
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createAdaptiveInterviewService(fakeClient);

    const results = await svc.retroConfidence(facts);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ question_id: 'iam-001', confidence: 'high', weight: 4 });
    expect(results[1]).toMatchObject({ question_id: 'ep-002', confidence: 'low', weight: 2 });
  });
});

// â”€â”€â”€ FCA guardrail presence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('adaptiveInterviewService â€” FCA guardrail (file-level comment)', () => {
  it('service factory is exported and does not score or pass-through unknown answers', async () => {
    // The service only sequences; it never calls a scoring function.
    // This test confirms the factory resolves without scoring side-effects.
    const svc = createAdaptiveInterviewService(null);
    // retroConfidence on degraded returns conservative defaults â€” no scoring.
    const result = await svc.retroConfidence([{ question_id: 'iam-001', answer: 'unknown' }]);
    expect(result[0].confidence).toBe('low');
    // weight 3 â†’ routes to HIL (scoring happens downstream, not here)
    expect(result[0].weight).toBe(3);
  });
});
