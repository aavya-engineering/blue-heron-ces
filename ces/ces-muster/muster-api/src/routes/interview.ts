// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// interview.ts — adaptive interview routes.
// POST /interview/adaptive/next — pick next question via Claude.
// POST /interview/retro-confidence — batch confidence assignment for offline facts.
//
// Do NOT wire this file into app.ts directly — see muster-api/WIRING_S3.md.

import { Router } from 'express';
import { z } from 'zod';
import { RateLimitError, APIConnectionError, InternalServerError, APIError } from '@anthropic-ai/sdk';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import { getClaude, isDegraded } from '../lib/claude.js';
import { createAdaptiveInterviewService } from '../services/adaptiveInterviewService.js';

const router = Router();

const questionSummarySchema = z.object({
  id: z.string(),
  text: z.string(),
  cluster: z.string(),
});

const priorFactSchema = z.object({
  question_id: z.string(),
  answer: z.string(),
});

const adaptiveNextSchema = z.object({
  sessionId: z.string(),
  priorFacts: z.array(priorFactSchema),
  stacks: z.array(z.string()),
  remainingQuestions: z.array(questionSummarySchema),
});

const retroConfidenceSchema = z.object({
  facts: z.array(
    z.object({
      question_id: z.string(),
      answer: z.string(),
    })
  ),
});

function handleDegradedError(err: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  if (
    err instanceof RateLimitError ||
    err instanceof APIConnectionError ||
    err instanceof InternalServerError
  ) {
    res.status(503).json({ degraded: true });
    return true;
  }
  if (err instanceof APIError) {
    res.status(502).json({ degraded: true });
    return true;
  }
  if (typeof err === 'object' && err !== null && 'degraded' in err) {
    const typed = err as { degraded: boolean; status: number };
    res.status(typed.status ?? 503).json({ degraded: true });
    return true;
  }
  return false;
}

// POST /interview/adaptive/next
// Roles: sub | prime | bhd_operator
router.post(
  '/adaptive/next',
  bearerAuth,
  requireRole('sub', 'prime', 'bhd_operator'),
  async (req, res, next) => {
    if (isDegraded()) {
      res.status(503).json({ degraded: true });
      return;
    }

    const result = adaptiveNextSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error.flatten() });
      return;
    }

    const client = getClaude();
    const svc = createAdaptiveInterviewService(client);

    try {
      const output = await svc.nextQuestion({
        priorFacts: result.data.priorFacts,
        stacks: result.data.stacks,
        remainingQuestions: result.data.remainingQuestions,
      });
      res.json({ ...output, degraded: false });
    } catch (err) {
      if (!handleDegradedError(err, res)) next(err);
    }
  }
);

// POST /interview/retro-confidence
// Roles: sub | prime | bhd_operator
// On degraded, returns per-fact confidence:'low' weight:3 (conservative —
// matches the exact HIL rule so every fact routes to the advisor queue).
router.post(
  '/retro-confidence',
  bearerAuth,
  requireRole('sub', 'prime', 'bhd_operator'),
  async (req, res, next) => {
    const result = retroConfidenceSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error.flatten() });
      return;
    }

    // Pass null client when degraded — service returns conservative defaults.
    const client = isDegraded() ? null : getClaude();
    const svc = createAdaptiveInterviewService(client);

    try {
      const confidences = await svc.retroConfidence(result.data.facts);
      res.json({ results: confidences });
    } catch (err) {
      if (!handleDegradedError(err, res)) next(err);
    }
  }
);

export default router;
