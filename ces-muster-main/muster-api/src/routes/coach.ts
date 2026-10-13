// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// coach.ts — CMMC readiness coaching chat route.
// POST /coach/chat — send a message thread to the Claude coach.
//
// Do NOT wire this file into app.ts directly — see muster-api/WIRING_S3.md.

import { Router } from 'express';
import { z } from 'zod';
import { RateLimitError, APIConnectionError, InternalServerError, APIError } from '@anthropic-ai/sdk';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import { getClaude, isDegraded } from '../lib/claude.js';
import { createCoachService } from '../services/coachService.js';

const router = Router();

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const chatSchema = z.object({
  sessionId: z.string(),
  messages: z.array(chatMessageSchema).min(1),
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

// POST /coach/chat
// Roles: sub | prime | bhd_operator
router.post(
  '/chat',
  bearerAuth,
  requireRole('sub', 'prime', 'bhd_operator'),
  async (req, res, next) => {
    if (isDegraded()) {
      res.status(503).json({ degraded: true });
      return;
    }

    const result = chatSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error.flatten() });
      return;
    }

    const client = getClaude();
    const svc = createCoachService(client);

    try {
      const output = await svc.chat({
        sessionId: result.data.sessionId,
        messages: result.data.messages,
      });
      res.json(output);
    } catch (err) {
      if (!handleDegradedError(err, res)) next(err);
    }
  }
);

export default router;
