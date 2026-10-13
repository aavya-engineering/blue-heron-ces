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
import { createTouchService } from '../services/touchService.js';
import { withTenant } from '../lib/prisma.js';

const recordSchema = z.object({
  mode: z.enum(['a', 'c']),
  engagement_id: z.string().uuid(),
  kind: z.string().min(1),
  minutes: z.number().min(0).default(0),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTouchRouter(db: any) {
  const router = Router();

  // POST /api/touch/events
  router.post(
    '/events',
    bearerAuth,
    requireRole('bhd_operator', 'prime'),
    async (req, res, next) => {
      try {
        const result = recordSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const event = await withTenant(req.user!.tenant_id, (tx: any) =>
          createTouchService(tx).record(
            result.data.mode,
            result.data.kind,
            result.data.engagement_id,
            req.user!.tenant_id,
            result.data.minutes
          )
        , db);
        res.status(201).json(event);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/touch/report?engagement_id=...
  router.get(
    '/report',
    bearerAuth,
    requireRole('bhd_operator', 'prime', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        const engagementId = req.query.engagement_id;
        if (typeof engagementId !== 'string') {
          res.status(400).json({ error: 'engagement_id query param required' });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const report = await withTenant(req.user!.tenant_id, (tx: any) =>
          createTouchService(tx).report(engagementId)
        , db);
        res.json(report);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
