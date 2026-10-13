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
import { withTenant } from '../lib/prisma.js';

const createPartySchema = z.object({
  name: z.string().min(1),
  uei: z.string().optional().nullable(),
  cage: z.string().optional().nullable(),
  on_prem_ot: z.enum(['yes', 'no', 'unsure']),
});

/**
 * Handles GET/POST /api/engagements/:engagementId/parties.
 * Mount with mergeParams: app.use('/api/engagements/:engagementId/parties', createPartiesRouter(db))
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPartiesRouter(db: any) {
  const router = Router({ mergeParams: true });

  // GET /api/engagements/:engagementId/parties
  router.get(
    '/',
    bearerAuth,
    requireRole('prime', 'bhd_operator', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        const { engagementId } = req.params;
        // engagement has no RLS — plain db is fine for existence + tenant check
        const engagement = await db.engagement.findUnique({ where: { id: engagementId } });
        if (!engagement) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        if (engagement.tenant_id !== req.user!.tenant_id) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parties = await withTenant(req.user!.tenant_id, (tx: any) =>
          tx.party.findMany({
            where: { engagement_id: engagementId },
            orderBy: { created_at: 'asc' },
          })
        , db);
        res.json(parties);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/engagements/:engagementId/parties
  router.post(
    '/',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    async (req, res, next) => {
      try {
        const { engagementId } = req.params;
        // engagement has no RLS — plain db is fine for existence + tenant check
        const engagement = await db.engagement.findUnique({ where: { id: engagementId } });
        if (!engagement) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        if (engagement.tenant_id !== req.user!.tenant_id) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        const result = createPartySchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const party = await withTenant(req.user!.tenant_id, (tx: any) =>
          tx.party.create({
            data: {
              tenant_id: req.user!.tenant_id,
              engagement_id: engagementId,
              ...result.data,
              lifecycle: 'invited',
            },
          })
        , db);
        res.status(201).json(party);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

/**
 * Handles GET /api/parties/:id.
 * Mount at app.use('/api/parties', createPartyRouter(db))
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPartyRouter(db: any) {
  const router = Router();

  router.get(
    '/:id',
    bearerAuth,
    requireRole('prime', 'sub', 'bhd_operator', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const party: any = await withTenant(req.user!.tenant_id, (tx: any) =>
          tx.party.findUnique({ where: { id: req.params.id } })
        , db);
        if (!party) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        // sub may only read their own party
        if (req.user!.role === 'sub' && req.user!.party_id !== party.id) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        // Cross-tenant guard (redundant with RLS but preserved for explicit intent)
        if (party.tenant_id !== req.user!.tenant_id) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        res.json(party);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
