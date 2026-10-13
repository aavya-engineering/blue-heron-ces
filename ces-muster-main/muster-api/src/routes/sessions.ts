// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { Router } from 'express';
import { z } from 'zod';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import { createSessionsService } from '../services/sessionsService.js';
import { withTenant } from '../lib/prisma.js';

// Exported for the SPA<->server contract test (tests/resync.contract.test.ts).
// NOTE: ids are min(1) strings, NOT .uuid() — the SPA generates nanoid ids
// (21-char url-safe), which are not UUIDs (CRITIQUE_P1 follow-up fix).
export const syncSchema = z.object({
  id: z.string().min(1),
  party_id: z.string().min(1),
  facts: z.unknown(),
  timing_segments: z.unknown(),
  selected_stacks: z.array(z.string()),
  status: z.enum(['in_progress', 'complete']),
  completed_at: z.coerce.date().optional().nullable(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSessionsRouter(db: any) {
  const router = Router();

  // POST /api/sessions/sync — sub (own party) + prime + bhd_operator
  router.post(
    '/sync',
    bearerAuth,
    requireRole('sub', 'prime', 'bhd_operator'),
    async (req, res, next) => {
      try {
        const result = syncSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        // sub may only sync sessions for their own party (pre-flight, outside tx)
        if (
          req.user!.role === 'sub' &&
          req.user!.party_id !== result.data.party_id
        ) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session = await withTenant(req.user!.tenant_id, (tx: any) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createSessionsService(tx).sync(result.data as any)
        , db);
        res.json(session);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/sessions/:id
  router.get(
    '/:id',
    bearerAuth,
    requireRole('sub', 'prime', 'bhd_operator', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session = await withTenant(req.user!.tenant_id, (tx: any) =>
          createSessionsService(tx).get(req.params.id)
        , db);
        if (!session) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        // sub may only access their own party's sessions
        if (
          req.user!.role === 'sub' &&
          req.user!.party_id !== session.party_id
        ) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        res.json(session);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
