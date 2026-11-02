// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// coachService.ts — Claude-powered CMMC readiness coaching chat.
//
// Guardrails (Tier-1 SCRE deliverable):
//   - NEVER promises CMMC certification or any specific certification outcome.
//   - NEVER gives quote-binding gap advice; all guidance is exploratory only.
// These guardrails are embedded in the system prompt verbatim per plan.

import Anthropic, { RateLimitError, APIConnectionError, InternalServerError, APIError } from '@anthropic-ai/sdk';
import { getClaude } from '../lib/claude.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  sessionId: string;
  messages: ChatMessage[];
}

export interface ChatResult {
  reply: string;
}

const COACH_SYSTEM_PROMPT =
  'You are a CMMC readiness coach for small defense contractors. ' +
  'Help users understand CMMC Level 2 requirements, identify gaps, and plan remediation. ' +
  'NEVER promises certification or any specific certification outcome. ' +
  'NEVER gives quote-binding gap advice; this is a Tier-1 SCRE deliverable only and all ' +
  'guidance is exploratory and informational, not binding.';

export function createCoachService(injectedClient?: Anthropic | null) {
  const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-4-8';

  function resolveClient(): Anthropic | null {
    return injectedClient !== undefined ? injectedClient : getClaude();
  }

  return {
    /**
     * Sends the conversation to Claude and returns the assistant reply.
     * Throws { degraded: true, status: 503 } when no key is configured.
     * Re-throws SDK rate/connection/server errors as { degraded: true, status: 503 };
     * other APIErrors as { degraded: true, status: 502 }.
     */
    async chat(input: ChatInput): Promise<ChatResult> {
      const client = resolveClient();
      if (!client) {
        throw { degraded: true, status: 503 };
      }

      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: COACH_SYSTEM_PROMPT,
          messages: input.messages,
        });

        const block = response.content[0];
        if (block.type !== 'text') {
          throw new Error(`Unexpected content block type: ${block.type}`);
        }

        return { reply: block.text };
      } catch (err) {
        if (
          err instanceof RateLimitError ||
          err instanceof APIConnectionError ||
          err instanceof InternalServerError
        ) {
          throw { degraded: true, status: 503 };
        }
        if (err instanceof APIError) {
          throw { degraded: true, status: 502 };
        }
        throw err;
      }
    },

    /** Exposed for testing — returns the system prompt verbatim. */
    getSystemPrompt(): string {
      return COACH_SYSTEM_PROMPT;
    },
  };
}

export type CoachService = ReturnType<typeof createCoachService>;
