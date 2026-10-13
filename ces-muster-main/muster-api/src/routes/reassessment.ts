// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// reassessment.ts — /reassessment routes: tick + drift-check.
//
// Wiring: see muster-api/WIRING_T4.md — do NOT edit app.ts directly.
//
// createReassessmentRouter(db) is the injectable factory (used in tests).
// The default export is the production router.

import { Router } from 'express';
import { z } from 'zod';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import { createReassessmentService } from '../services/reassessmentService.js';
import { createDriftService } from '../services/driftService.js';
import { db, withTenant } from '../lib/prisma.js';

const tickSchema = z.object({
  now: z.string().datetime().optional(),
  engagement_id: z.string().optional(),
});

const factSnapshotSchema = z.object({
  question_id: z.string().min(1),
  answer: z.string().min(1),
  provenance: z.string().min(1),
  source: z.string().optional(),
});

const driftCheckSchema = z.object({
  party_id: z.string().min(1),
  session_id: z.string().optional(),
  previous_facts: z.array(factSnapshotSchema),
  current_facts: z.array(factSnapshotSchema),
  now: z.string().datetime().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createReassessmentRouter(injectedDb: any): Router {
  const router = Router();

  // POST /api/reassessment/tick — bhd_operator only.
  // Runs one reassessment cadence cycle, optionally scoped to a single engagement.
  // [validate with BHD] annual cadence (REASSESS_DAYS=365 default)
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
        const nowDate = result.data.now ? new Date(result.data.now) : new Date();
        const engagementId = result.data.engagement_id ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out = await withTenant(req.user!.tenant_id, (tx: any) =>
          createReassessmentService(tx).tick(engagementId, nowDate)
        , injectedDb);
        res.json(out);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/reassessment/drift-check — prime | bhd_operator.
  // Compares previous and current machine-evidence facts for a party and fires
  // drift alerts (yes→no) or records improvements (no→yes).
  router.post(
    '/drift-check',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    async (req, res, next) => {
      try {
        const result = driftCheckSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }
        const { party_id, session_id, previous_facts, current_facts, now } = result.data;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out = await withTenant(req.user!.tenant_id, (tx: any) =>
          createDriftService(tx).detectDrift({
            partyId: party_id,
            sessionId: session_id,
            previousFacts: previous_facts,
            currentFacts: current_facts,
            now: now ? new Date(now) : undefined,
          })
        , injectedDb);
        res.status(201).json(out);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) {
          res.status(404).json({ error: msg });
          return;
        }
        next(err);
      }
    }
  );

  return router;
}

// Default export: production router with real Prisma db.
const reassessmentRouter = createReassessmentRouter(db);
export default reassessmentRouter;
