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
import { createContractsService } from '../services/contractsService.js';
import { withTenant } from '../lib/prisma.js';

const contractSchema = z.object({
  party_id: z.string().uuid(),
  engagement_id: z.string().uuid(),
  contract_number: z.string().min(1),
  program_name: z.string().min(1),
  cage_code: z.string().optional().nullable(),
  uei: z.string().optional().nullable(),
  contracting_office: z.string().optional().nullable(),
  co_name: z.string().optional().nullable(),
  award_date: z.coerce.date().optional().nullable(),
  pop_start: z.coerce.date().optional().nullable(),
  pop_end: z.coerce.date().optional().nullable(),
  cmmc_level_required: z.number().int().min(1).max(3),
  cui_categories: z.unknown(),
});

const updateContractSchema = contractSchema
  .omit({ party_id: true, engagement_id: true })
  .partial();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createContractsRouter(db: any) {
  const router = Router();

  // GET /api/contracts
  router.get(
    '/',
    bearerAuth,
    requireRole('prime', 'bhd_operator', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        const filters: { party_id?: string; engagement_id?: string } = {};
        if (typeof req.query.party_id === 'string') filters.party_id = req.query.party_id;
        if (typeof req.query.engagement_id === 'string') filters.engagement_id = req.query.engagement_id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contracts = await withTenant(req.user!.tenant_id, (tx: any) =>
          createContractsService(tx).list(filters)
        , db);
        res.json(contracts);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/contracts/:id
  router.get(
    '/:id',
    bearerAuth,
    requireRole('prime', 'bhd_operator', 'assessor_read_only'),
    async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contract = await withTenant(req.user!.tenant_id, (tx: any) =>
          createContractsService(tx).get(req.params.id)
        , db);
        if (!contract) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        res.json(contract);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/contracts — prime (own tenant) + bhd_operator
  router.post(
    '/',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    async (req, res, next) => {
      try {
        const result = contractSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contract = await withTenant(req.user!.tenant_id, (tx: any) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createContractsService(tx).create(result.data as any)
        , db);
        res.status(201).json(contract);
      } catch (err) {
        next(err);
      }
    }
  );

  // PUT /api/contracts/:id
  router.put(
    '/:id',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    async (req, res, next) => {
      try {
        const result = updateContractSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contract = await withTenant(req.user!.tenant_id, (tx: any) =>
          createContractsService(tx).update(req.params.id, result.data)
        , db);
        res.json(contract);
      } catch (err) {
        next(err);
      }
    }
  );

  // DELETE /api/contracts/:id — bhd_operator only [validate with BHD]
  router.delete(
    '/:id',
    bearerAuth,
    requireRole('bhd_operator'),
    async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenant(req.user!.tenant_id, (tx: any) =>
          createContractsService(tx).delete(req.params.id)
        , db);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
