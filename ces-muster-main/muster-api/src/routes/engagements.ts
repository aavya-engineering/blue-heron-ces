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
import { createProgressService } from '../services/progressService.js';
import { withTenant } from '../lib/prisma.js';

const createEngagementSchema = z.object({
  engagement_kind: z.enum(['prime_and_subs', 'individual_contractor']),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEngagementsRouter(db: any) {
  const router = Router();

  // GET /api/engagements
  router.get(
    '/',
    bearerAuth,
    requireRole('prime', 'bhd_operator', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        // engagement has no RLS policy; wrap for uniformity and future policies.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const engagements = await withTenant(req.user!.tenant_id, (tx: any) =>
          tx.engagement.findMany({
            where: { tenant_id: req.user!.tenant_id },
            orderBy: { created_at: 'desc' },
          })
        , db);
        res.json(engagements);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/engagements
  router.post(
    '/',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    async (req, res, next) => {
      try {
        const result = createEngagementSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        // engagement has no RLS policy; wrap for uniformity and future policies.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const engagement = await withTenant(req.user!.tenant_id, (tx: any) =>
          tx.engagement.create({
            data: {
              tenant_id: req.user!.tenant_id,
              engagement_kind: result.data.engagement_kind,
            },
          })
        , db);
        res.status(201).json(engagement);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/engagements/:id
  router.get(
    '/:id',
    bearerAuth,
    requireRole('prime', 'bhd_operator', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        // engagement has no RLS policy; wrap for uniformity and future policies.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const engagement: any = await withTenant(req.user!.tenant_id, (tx: any) =>
          tx.engagement.findUnique({
            where: { id: req.params.id },
          })
        , db);
        if (!engagement) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        // Cross-tenant guard
        if (engagement.tenant_id !== req.user!.tenant_id) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        res.json(engagement);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/engagements/:id/progress
  router.get(
    '/:id/progress',
    bearerAuth,
    requireRole('prime', 'bhd_operator', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        // engagement check uses plain db (no RLS on engagements)
        const engagement = await db.engagement.findUnique({
          where: { id: req.params.id },
        });
        if (!engagement) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        if (engagement.tenant_id !== req.user!.tenant_id) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        // progressService reads parties (RLS-protected) — must run inside withTenant
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const progress = await withTenant(req.user!.tenant_id, (tx: any) =>
          createProgressService(tx).getEngagementProgress(req.params.id)
        , db);
        res.json(progress);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
