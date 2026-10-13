// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// harvest.ts — /harvest routes: run (sim | live device-code | injected test client).
// FC-MU-3: the client-secret consent-url / callback routes are retired.
//
// Wiring: see muster-api/WIRING_S5.md — do NOT edit app.ts directly.
//
// createHarvestRouter(testClient?) accepts an optional GraphClient for tests.
// The default export is the production router (no injected client).

import { Router } from 'express';
import { z } from 'zod';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import type { GraphClient } from '../lib/graphClient.js';
import { realGraphClient } from '../lib/graphClient.js';
import { runHarvest } from '../services/harvestService.js';
import { SIM_URL, ledgerReachable } from '../services/liveSimSession.js';
import { authorizeLive, LIVE_GRAPH_RESOURCE, type LiveGate } from '../services/liveAccess.js';

/** FC-MU-2 (MU-06 live): builds the Graph client for a consented live read.
 * Default: realGraphClient(token, <GCC High graph>/v1.0). Tests inject a fake. */
export type LiveGraphClientFactory = (accessToken: string) => GraphClient;

/** W4-MU2 (MU-06): stacksim serves Microsoft Graph REST under /v1.0 on
 * localhost. Sim mode targets ONLY this constant — never a request- or
 * env-supplied URL (FD-LIVE-SMOKE / W4 ground rule 1). */
export const SIM_GRAPH_BASE = `${SIM_URL}/v1.0`;

const runSchema = z.object({
  access_token: z.string().optional(),
  tenant_slug: z.string().optional(),
  /** W4-MU2 (MU-06): probe the local stacksim Graph instead of a tenant. */
  sim: z.boolean().optional(),
  /** FC-MU-2 (MU-06 live): read a consented live tenant (flag + device-code consent). */
  live: z.boolean().optional(),
  engagement_id: z.string().optional(),
  consent_id: z.string().optional(),
});

export interface HarvestLiveOptions {
  /** The live gate (engagement flag + consent). Absent → live requests refused. */
  live?: LiveGate;
  /** Test seam: the live Graph client factory. */
  liveClient?: LiveGraphClientFactory;
}

/**
 * createHarvestRouter — router factory.
 *
 * @param testClient - Optional GraphClient injected for tests. When provided,
 *                     POST /run uses it unconditionally (ignores access_token).
 */
export function createHarvestRouter(
  testClient?: GraphClient,
  simProbe: (url: string) => Promise<boolean> = ledgerReachable,
  liveOpts: HarvestLiveOptions = {}
): Router {
  const router = Router();

  // FC-MU-3 (founder decision 2026-09-28 #9): the client-secret
  // `GET /consent-url` and `POST /callback` routes are RETIRED. Device-code
  // (routes/live.ts → POST /run { live: true, engagement_id, consent_id }) is
  // the only live path; no client secret exists anywhere in muster-api.

  // POST /api/harvest/run {access_token?, tenant_slug?} — prime | bhd_operator only.
  // When testClient injected: uses it unconditionally (test mode).
  // FC-MU-2: { live: true, engagement_id, consent_id } reads a consented live
  //   tenant (engagement flag ON + granted device-code consent), else 400/403/404.
  // A bare access_token is refused (403) — no live read without flag + consent.
  // Otherwise: 503 {degraded:true}.
  router.post(
    '/run',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    async (req, res, next) => {
      try {
        const result = runSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: result.error.flatten() });
          return;
        }

        let client: GraphClient;
        let consent: unknown;
        if (result.data.live === true) {
          // FC-MU-2 (MU-06 live): engagement flag ON + granted device-code
          // consent, or refused. Checked before any injected client is used.
          const auth = await authorizeLive(
            liveOpts.live,
            req.user!.tenant_id,
            result.data.engagement_id,
            result.data.consent_id,
            // FC-MU-3: the harvest probes are Graph reads — only a Graph consent serves them.
            { requireArea: 'graph' }
          );
          if (!auth.ok) {
            res.status(auth.status).json({ error: auth.code });
            return;
          }
          const factory = liveOpts.liveClient ?? ((t: string) => realGraphClient(t, `${LIVE_GRAPH_RESOURCE}/v1.0`));
          client = factory(auth.grant.accessToken);
          consent = auth.grant.consent;
        } else if (testClient) {
          client = testClient;
        } else if (result.data.sim === true) {
          // W4-MU2 (MU-06): sim harvest. access_token / tenant_slug /
          // GRAPH_BASE_URL are ignored — the base is the localhost constant.
          if (!(await simProbe(SIM_URL))) {
            res.status(503).json({ error: `stacksim sim server not reachable at ${SIM_URL}` });
            return;
          }
          client = realGraphClient('stacksim', SIM_GRAPH_BASE);
        } else if (result.data.access_token) {
          // FC-MU-2: a caller-supplied bearer token reached a real tenant with
          // no engagement flag and no recorded consent. Retired: the only live
          // read is { live: true, engagement_id, consent_id }.
          res.status(403).json({ error: 'live_path_requires_engagement_consent' });
          return;
        } else {
          res.status(503).json({ degraded: true });
          return;
        }

        const facts = await runHarvest(client);
        res.json(consent ? { facts, tenant_kind: 'live', consent } : { facts });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

// Default export: production router with no injected test client.
const harvestRouter = createHarvestRouter();
export default harvestRouter;
