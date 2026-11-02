// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// adaptiveInterviewService.ts — Claude-powered adaptive question sequencing.
//
// FCA GUARDRAIL: This service NEVER converts an 'unknown' or 'unsure' answer
// into a pass and NEVER scores readiness. Its sole responsibility is sequencing
// questions from a pre-validated bank. Scoring lives in the SPRS layer.
// Conservative routing: any unknown/unsure answer is treated as not-passed
// downstream. [validate with BHD]

import Anthropic, { RateLimitError, APIConnectionError, InternalServerError, APIError } from '@anthropic-ai/sdk';
import { getClaude } from '../lib/claude.js';

export interface QuestionSummary {
  id: string;
  text: string;
  cluster: string;
}

export interface PriorFact {
  question_id: string;
  answer: string;
}

export interface NextQuestionInput {
  priorFacts: PriorFact[];
  stacks: string[];
  remainingQuestions: QuestionSummary[];
}

export interface NextQuestionResult {
  question_id: string | null;
  rationale: string;
  provenance: 'ai_adaptive';
  confidence: 'high' | 'medium' | 'low';
}

export interface RetroConfidenceFact {
  question_id: string;
  answer: string;
}

export interface RetroConfidenceResult {
  question_id: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  weight: number;
}

function isDegradedSdkError(err: unknown): boolean {
  return (
    err instanceof RateLimitError ||
    err instanceof APIConnectionError ||
    err instanceof InternalServerError
  );
}

export function createAdaptiveInterviewService(injectedClient?: Anthropic | null) {
  const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-4-8';

  function resolveClient(): Anthropic | null {
    return injectedClient !== undefined ? injectedClient : getClaude();
  }

  return {
    /**
     * Picks the next interview question from remainingQuestions using Claude.
     * Throws { degraded: true, status: 503 } when no key is configured.
     * Re-throws SDK rate/connection/server errors as { degraded: true, status: 503 };
     * other APIErrors as { degraded: true, status: 502 }.
     *
     * Validates that the returned question_id exists in remainingQuestions;
     * falls back to remainingQuestions[0] if the model returns an unknown id.
     */
    async nextQuestion(input: NextQuestionInput): Promise<NextQuestionResult> {
      const client = resolveClient();
      if (!client) {
        throw { degraded: true, status: 503 };
      }

      const { priorFacts, stacks, remainingQuestions } = input;

      const systemPrompt =
        'You are an AI assistant conducting a CMMC (Cybersecurity Maturity Model Certification) ' +
        'readiness interview for small defense contractors. ' +
        'Select the single most informative next question from the provided question bank, ' +
        'considering the contractor\'s prior answers and technology stacks. ' +
        'You MUST only select a question id that appears in the remaining_questions list. ' +
        'Never invent question ids or text outside the provided bank.';

      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                prior_facts: priorFacts,
                technology_stacks: stacks,
                remaining_questions: remainingQuestions,
              }),
            },
          ],
          output_config: {
            format: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  next_question_id: { type: ['string', 'null'] },
                  rationale: { type: 'string' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
                required: ['next_question_id', 'rationale', 'confidence'],
                additionalProperties: false,
              },
            },
          },
        });

        const block = response.content[0];
        if (block.type !== 'text') {
          throw new Error(`Unexpected content block type: ${block.type}`);
        }
        const parsed = JSON.parse(block.text) as {
          next_question_id: string | null;
          rationale: string;
          confidence: 'high' | 'medium' | 'low';
        };

        // Validate: returned id must be in remainingQuestions; fall back if not.
        const validIds = new Set(remainingQuestions.map((q) => q.id));
        let questionId = parsed.next_question_id;
        if (questionId !== null && !validIds.has(questionId)) {
          questionId = remainingQuestions[0]?.id ?? null;
        }

        return {
          question_id: questionId,
          rationale: String(parsed.rationale ?? ''),
          provenance: 'ai_adaptive',
          confidence: parsed.confidence,
        };
      } catch (err) {
        if (isDegradedSdkError(err)) throw { degraded: true, status: 503 };
        if (err instanceof APIError) throw { degraded: true, status: 502 };
        throw err;
      }
    },

    /**
     * Assigns confidence + weight to each fact from an offline-resync batch.
     * On degraded (no key or SDK error), returns confidence 'low' weight 3 for
     * every fact — 'low' + weight 3 satisfies the EXACT HIL routing rule
     * (hilService: confidence === 'low' AND weight >= 3), so every degraded
     * offline fact routes to the advisor queue before score release
     * (CRITIQUE_P1 defect 2 fix). [validate with BHD]
     */
    async retroConfidence(facts: RetroConfidenceFact[]): Promise<RetroConfidenceResult[]> {
      const client = resolveClient();
      if (!client) {
        return facts.map((f) => ({
          question_id: f.question_id,
          confidence: 'low' as const,
          weight: 3,
        }));
      }

      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system:
            'You are a CMMC readiness analyst. Assign a confidence level and weight (1–5) ' +
            'to each interview fact based on the question topic and answer quality. ' +
            'Be conservative — unsure or unknown answers must receive low confidence.',
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                facts,
                instructions:
                  'Return a confidence level (high, medium, or low) and weight (integer 1-5) ' +
                  'for each fact in the same order as provided.',
              }),
            },
          ],
          output_config: {
            format: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  results: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        question_id: { type: 'string' },
                        confidence: {
                          type: 'string',
                          enum: ['high', 'medium', 'low'],
                        },
                        weight: { type: 'number' },
                      },
                      required: ['question_id', 'confidence', 'weight'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['results'],
                additionalProperties: false,
              },
            },
          },
        });

        const block = response.content[0];
        if (block.type !== 'text') {
          throw new Error(`Unexpected content block type: ${block.type}`);
        }
        const parsed = JSON.parse(block.text) as {
          results: RetroConfidenceResult[];
        };
        return parsed.results;
      } catch (err) {
        if (isDegradedSdkError(err) || err instanceof APIError) {
          // Degraded: conservative default — 'low' + weight 3 matches the
          // EXACT HIL rule so every fact routes (CRITIQUE_P1 defect 2 fix)
          return facts.map((f) => ({
            question_id: f.question_id,
            confidence: 'low' as const,
            weight: 3,
          }));
        }
        throw err;
      }
    },
  };
}

export type AdaptiveInterviewService = ReturnType<typeof createAdaptiveInterviewService>;
