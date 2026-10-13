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
import { createHilService } from '../services/hilService.js';
import { withTenant } from '../lib/prisma.js';

const resolveSchema = z.object({
  advisor_minutes: z.number().min(0),
});

// POST /api/hil/flag — sub-initiated flag; sub_flagged=true bypasses threshold
// Exported for the SPA<->server contract test (tests/resync.contract.test.ts).
// session_id is min(1), not .uuid() — SPA session ids are nanoids.
export const flagSchema = z.object({
  session_id: z.string().min(1).optional(),
  question_id: z.string().min(1),
  fact: z.object({
    answer: z.unknown(),
    confidence: z.string().default('high'),
    weight: z.number().default(0),
  }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createHilRouter(db: any) {
  const router = Router();

  // GET /api/hil/queue — advisors view unresolved items
  // [validate with BHD] queue visibility: bhd_operator, prime, assessor_read_only
  router.get(
    '/queue',
    bearerAuth,
    requireRole('bhd_operator', 'prime', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queue = await withTenant(req.user!.tenant_id, (tx: any) =>
          createHilService(tx).getQueue(req.user!.tenant_id)
        , db);
        res.json(queue);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/hil/queue/:id/resolve — advisor resolves an item, captures time
  router.post(
    '/queue/:id/resolve',
    bearerAuth,
    requireRole('bhd_operator', 'prime'),
    async (req, res, next) => {
      try {
        const result = resolveSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const item = await withTenant(req.user!.tenant_id, (tx: any) =>
          createHilService(tx).resolve(
            req.params.id,
            req.user!.sub,
            result.data.advisor_minutes
          )
        , db);
        res.json(item);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found') || msg.includes('already resolved')) {
          res.status(404).json({ error: msg });
          return;
        }
        next(err);
      }
    }
  );

  // POST /api/hil/flag — sub flags a fact from their own session; always routes
  router.post(
    '/flag',
    bearerAuth,
    requireRole('sub'),
    async (req, res, next) => {
      try {
        const result = flagSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        const { session_id, question_id, fact } = result.data;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const item = await withTenant(req.user!.tenant_id, (tx: any) =>
          createHilService(tx).routeFact({
            tenant_id: req.user!.tenant_id,
            party_id: req.user!.party_id ?? '',
            session_id,
            question_id,
            answer: fact.answer,
            confidence: fact.confidence,
            weight: fact.weight,
            sub_flagged: true, // always route sub-initiated flags
          })
        , db);
        res.status(201).json(item);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
