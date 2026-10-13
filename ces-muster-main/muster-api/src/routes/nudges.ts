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
import { createNudgeService } from '../services/nudgeService.js';
import { withTenant } from '../lib/prisma.js';

const tickSchema = z.object({
  now: z.string().datetime().optional(),
  engagement_id: z.string().uuid().optional(),
});

const digestSchema = z.object({
  engagement_id: z.string().uuid(),
  now: z.string().datetime().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createNudgesRouter(db: any) {
  const router = Router();

  // POST /api/nudges/tick — bhd_operator only; body {now?: ISO, engagement_id?}
  // Returns {fired: NudgeEvent[]} for all events fired in this tick.
  // [validate with BHD] bhd_operator tenant_id scopes party visibility — correct.
  router.post(
    '/tick',
    bearerAuth,
    requireRole('bhd_operator'),
    async (req, res, next) => {
      try {
        const result = tickSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        const now = result.data.now ? new Date(result.data.now) : new Date();
        const engagementId = result.data.engagement_id ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fired = await withTenant(req.user!.tenant_id, (tx: any) =>
          createNudgeService(tx).evaluate(engagementId, now)
        , db);
        res.json({ fired });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/nudges/digest — body {engagement_id, now?}
  // Returns {digest: NudgeEvent | null}.
  router.post(
    '/digest',
    bearerAuth,
    requireRole('bhd_operator'),
    async (req, res, next) => {
      try {
        const result = digestSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        const now = result.data.now ? new Date(result.data.now) : new Date();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const digest = await withTenant(req.user!.tenant_id, (tx: any) =>
          createNudgeService(tx).escalationDigest(result.data.engagement_id, now)
        , db);
        res.json({ digest });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

export default createNudgesRouter;
