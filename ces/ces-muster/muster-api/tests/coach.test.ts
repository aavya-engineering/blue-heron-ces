// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// coach.test.ts — unit tests for coachService.
// Uses dependency injection (injectedClient param) — no real network calls.

import { describe, it, expect, vi } from 'vitest';
import { RateLimitError, APIConnectionError, InternalServerError, APIError } from '@anthropic-ai/sdk';
import { createCoachService } from '../src/services/coachService.js';

const SESSION_ID = 'test-session-001';
const MESSAGES = [{ role: 'user' as const, content: 'What is CMMC Level 2?' }];

function makeTextResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

// ─── Degraded path (null client) ─────────────────────────────────────────────

describe('coachService — degraded path (null client)', () => {
  it('throws {degraded:true, status:503} when client is null', async () => {
    const svc = createCoachService(null);
    await expect(svc.chat({ sessionId: SESSION_ID, messages: MESSAGES })).rejects.toMatchObject({
      degraded: true,
      status: 503,
    });
  });
});

// ─── SDK error mapping ────────────────────────────────────────────────────────

describe('coachService — SDK error mapping', () => {
  it('throws {degraded:true, status:503} on RateLimitError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new RateLimitError(429, { error: { message: 'rate limit' } }, 'rate limit', new Headers())
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createCoachService(fakeClient);

    await expect(svc.chat({ sessionId: SESSION_ID, messages: MESSAGES })).rejects.toMatchObject({
      degraded: true,
      status: 503,
    });
  });

  it('throws {degraded:true, status:503} on APIConnectionError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new APIConnectionError({ message: 'connection failed' })
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createCoachService(fakeClient);

    await expect(svc.chat({ sessionId: SESSION_ID, messages: MESSAGES })).rejects.toMatchObject({
      degraded: true,
      status: 503,
    });
  });

  it('throws {degraded:true, status:503} on InternalServerError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new InternalServerError(500, { error: { message: 'server error' } }, 'server error', new Headers())
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createCoachService(fakeClient);

    await expect(svc.chat({ sessionId: SESSION_ID, messages: MESSAGES })).rejects.toMatchObject({
      degraded: true,
      status: 503,
    });
  });

  it('throws {degraded:true, status:502} on other APIError', async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new APIError(422, { error: { message: 'unprocessable' } }, 'unprocessable', new Headers())
    );
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createCoachService(fakeClient);

    await expect(svc.chat({ sessionId: SESSION_ID, messages: MESSAGES })).rejects.toMatchObject({
      degraded: true,
      status: 502,
    });
  });
});

// ─── Guardrail system prompt ──────────────────────────────────────────────────

describe('coachService — Tier-1 guardrail system prompt', () => {
  it('system prompt contains "NEVER promises certification"', () => {
    const svc = createCoachService(null);
    expect(svc.getSystemPrompt()).toContain('NEVER promises certification');
  });

  it('system prompt contains "NEVER gives quote-binding gap advice"', () => {
    const svc = createCoachService(null);
    expect(svc.getSystemPrompt()).toContain('NEVER gives quote-binding gap advice');
  });

  it('system prompt contains "Tier-1 SCRE deliverable"', () => {
    const svc = createCoachService(null);
    expect(svc.getSystemPrompt()).toContain('Tier-1 SCRE deliverable');
  });

  it('system prompt is passed to messages.create on each call', async () => {
    const mockCreate = vi.fn().mockResolvedValue(makeTextResponse('CMMC Level 2 requires 110 practices.'));
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createCoachService(fakeClient);

    await svc.chat({ sessionId: SESSION_ID, messages: MESSAGES });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('NEVER promises certification');
    expect(callArgs.system).toContain('NEVER gives quote-binding gap advice');
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('coachService — happy path', () => {
  it('returns reply from model response', async () => {
    const replyText = 'CMMC Level 2 covers 110 practices aligned with NIST SP 800-171.';
    const mockCreate = vi.fn().mockResolvedValue(makeTextResponse(replyText));
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createCoachService(fakeClient);

    const result = await svc.chat({ sessionId: SESSION_ID, messages: MESSAGES });
    expect(result).toEqual({ reply: replyText });
  });

  it('passes model from env or default', async () => {
    const mockCreate = vi.fn().mockResolvedValue(makeTextResponse('ok'));
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createCoachService(fakeClient);

    await svc.chat({ sessionId: SESSION_ID, messages: MESSAGES });

    const callArgs = mockCreate.mock.calls[0][0] as { model: string; max_tokens: number };
    expect(callArgs.model).toBe('claude-opus-4-8'); // CLAUDE_MODEL not set in test env
    expect(callArgs.max_tokens).toBe(1024);
  });

  it('passes conversation messages to the model', async () => {
    const mockCreate = vi.fn().mockResolvedValue(makeTextResponse('Got it'));
    const fakeClient = { messages: { create: mockCreate } } as never;
    const svc = createCoachService(fakeClient);

    const thread = [
      { role: 'user' as const, content: 'What is CUI?' },
      { role: 'assistant' as const, content: 'CUI stands for Controlled Unclassified Information.' },
      { role: 'user' as const, content: 'How do I protect it?' },
    ];

    await svc.chat({ sessionId: SESSION_ID, messages: thread });

    const callArgs = mockCreate.mock.calls[0][0] as { messages: typeof thread };
    expect(callArgs.messages).toHaveLength(3);
    expect(callArgs.messages[2].content).toBe('How do I protect it?');
  });
});
