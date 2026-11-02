// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// live.ts — FC-MU-2 (MU-03 / MU-06 live): the per-engagement live flag and
// the customer's device-code consent. Mounted at /api/live.
//
//   PUT  /engagements/:id/access   { enabled }    bhd_operator only — the flag
//   GET  /engagements/:id/access                  prime | bhd_operator
//   POST /engagements/:id/consent  { tenant_id, area? }  prime | bhd_operator —
//        starts the device-code sign-in for one area (graph | exchange |
//        purview | azure | teams; default graph), refused unless the flag is ON;
//        azure also takes { subscription_id } (FC-MU-5 reader check). Areas
//        other than graph are recorded only for a Global Reader (FC-MU-5).
//   GET  /consent/:consentId                      poll: pending | granted | refused
//   POST /consent/:consentId/abort                drop it; nothing recorded
//
// OFF by default: a new engagement has live_access_enabled = false, and every
// live read (discovery / harvest) re-checks the flag through authorizeLive.
import { Router } from 'express';
import { z } from 'zod';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import { LiveConsentError, type LiveGate } from '../services/liveAccess.js';

const accessSchema = z.object({ enabled: z.boolean() });
const consentSchema = z.object({
  tenant_id: z.string().min(1),
  /** FC-MU-3: which area this sign-in consents to (one token per resource). Default graph. */
  area: z.enum(['graph', 'exchange', 'purview', 'azure', 'teams']).optional(),
  /** FC-MU-5: required for area azure — the subscription the reader check covers. */
  subscription_id: z.string().min(1).optional(),
});

export function createLiveRouter(gate: LiveGate): Router {
  const router = Router();

  router.put('/engagements/:id/access', bearerAuth, requireRole('bhd_operator'), async (req, res, next) => {
    try {
      const body = accessSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
      }
      const ok = await gate.store.setEnabled(req.user!.tenant_id, req.params.id, body.data.enabled, req.user!.sub);
      if (!ok) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      if (!body.data.enabled) gate.consent.revokeEngagement(req.params.id);
      res.json({ engagement_id: req.params.id, live_access_enabled: body.data.enabled });
    } catch (err) {
      next(err);
    }
  });

  router.get('/engagements/:id/access', bearerAuth, requireRole('prime', 'bhd_operator'), async (req, res, next) => {
    try {
      const state = await gate.store.get(req.user!.tenant_id, req.params.id);
      if (!state) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json({
        engagement_id: req.params.id,
        live_access_enabled: state.enabled,
        consent: state.consent,
        // FC-MU-3: every recorded consent by area.
        consents: { ...(state.consent ? { graph: state.consent } : {}), ...state.areaConsents },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/engagements/:id/consent', bearerAuth, requireRole('prime', 'bhd_operator'), async (req, res, next) => {
    try {
      const body = consentSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
      }
      const state = await gate.store.get(req.user!.tenant_id, req.params.id);
      if (!state) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      if (!state.enabled) {
        res.status(403).json({ error: 'live_access_disabled' });
        return;
      }
      const started = await gate.consent.start(
        req.user!.tenant_id,
        req.params.id,
        body.data.tenant_id,
        body.data.area ?? 'graph',
        body.data.subscription_id ? { subscriptionId: body.data.subscription_id } : {}
      );
      res.status(202).json(started);
    } catch (err) {
      if (err instanceof LiveConsentError) {
        const status = err.code === 'bad_tenant' || err.code === 'bad_area' || err.code === 'subscription_required' ? 400 : 503;
        res.status(status).json({ error: err.code, ...(status === 503 ? { degraded: true } : {}) });
        return;
      }
      next(err);
    }
  });

  router.get('/consent/:consentId', bearerAuth, requireRole('prime', 'bhd_operator'), async (req, res, next) => {
    try {
      const out = await gate.consent.poll(req.params.consentId, req.user!.tenant_id);
      if (!out) {
        res.status(404).json({ error: 'No such consent' });
        return;
      }
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  router.post('/consent/:consentId/abort', bearerAuth, requireRole('prime', 'bhd_operator'), (req, res) => {
    const dropped = gate.consent.abort(req.params.consentId, req.user!.tenant_id);
    if (!dropped) {
      res.status(404).json({ error: 'No such consent' });
      return;
    }
    res.json({ status: 'aborted' });
  });

  return router;
}
