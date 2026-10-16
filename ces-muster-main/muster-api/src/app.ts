// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import express, { Request, Response, NextFunction } from 'express';
import authRouter from './routes/auth.js';
import { createEngagementsRouter } from './routes/engagements.js';
import { createPartiesRouter, createPartyRouter } from './routes/parties.js';
import { createContractsRouter } from './routes/contracts.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createActionsRouter } from './routes/actions.js';
import { createHilRouter } from './routes/hil.js';
import { createTouchRouter } from './routes/touch.js';
import createNudgesRouter from './routes/nudges.js';
import interviewRouter from './routes/interview.js';
import coachRouter from './routes/coach.js';
import { createHarvestRouter } from './routes/harvest.js';
import sprsRouter from './routes/sprs.js';
import recipesRouter from './routes/recipes.js';
import reassessmentRouter from './routes/reassessment.js';
import { createDeliveryRouter, createPortalRouter } from './routes/delivery.js';
import { createPlanRouter } from './routes/plan.js';
import { createDiscoveryRouter } from './routes/discovery.js';
import { createLiveRouter } from './routes/live.js';
import { LiveConsentService, prismaLiveAccessStore, type LiveGate } from './services/liveAccess.js';
import { db } from './lib/prisma.js';

/** Body limit for the plan push (MP + TM in one JSON body). */
export const PLAN_BODY_LIMIT = '25mb';

const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

/**
 * Localhost-only CORS allowlist. Origins come from MUSTER_CORS_ORIGINS
 * (comma-separated) or default to the Vite dev/preview ports. A request from
 * any other origin gets no CORS headers, so the browser blocks it.
 */
export function localCors() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowed = (process.env.MUSTER_CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const origins = allowed.length > 0 ? allowed : DEFAULT_CORS_ORIGINS;
    const origin = req.headers.origin;
    const isAllowed = origin && (
      origins.includes('*') ||
      origins.includes(origin) ||
      origins.some((allowedOrigin) => allowedOrigin.startsWith('*.') && origin.endsWith(allowedOrigin.slice(1))) ||
      /(\.|\b)sslip\.io(:\d+)?$/.test(origin)
    );
    if (origin && isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-concierge-session');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

export interface AppOptions {
  /** FC-MU-2: the live gate (engagement flag + device-code consent). Default:
   * the Prisma engagement store + an in-memory consent service. Tests inject
   * one built on mockDb and a fake device-code transport. */
  live?: LiveGate;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  // FC-MU-2 (MU-03/MU-06 live): ONE gate shared by /api/live, discovery and
  // harvest, so a consent granted on /api/live is the one the reads check.
  const liveStore = opts.live?.store ?? prismaLiveAccessStore(db);
  const live: LiveGate = opts.live ?? { store: liveStore, consent: new LiveConsentService(liveStore) };

  // FX-MU1: the Plan tab calls muster-api from the browser (Vite dev 5173 /
  // preview 4173), so a localhost-only CORS allowlist answers the preflight
  // that Authorization + JSON triggers. Sim only: no non-localhost default.
  app.use(localCors());

  // MS-R5 / FX-MU1: plan push — writes artifacts to Stamper's plans folder.
  // Mounted BEFORE the global express.json(): a generated Mission Plan is
  // ~2.5MB compact, far over the global parser's 100kb default, and the first
  // body parser to run wins (the global one would 413 the push).
  app.use('/api/plan', express.json({ limit: PLAN_BODY_LIMIT }), createPlanRouter());

  app.use(express.json());

  // Auth (keep as-is)
  app.use('/auth', authRouter);

  // API routes
  app.use('/api/engagements', createEngagementsRouter(db));
  // Parties sub-resource of engagements (mergeParams picks up :engagementId)
  app.use('/api/engagements/:engagementId/parties', createPartiesRouter(db));
  // Individual party read + sub self-only guard
  app.use('/api/parties', createPartyRouter(db));
  // Party actions (mergeParams picks up :id from parent path)
  app.use('/api/parties/:id/actions', createActionsRouter(db));
  app.use('/api/contracts', createContractsRouter(db));
  app.use('/api/sessions', createSessionsRouter(db));
  app.use('/api/hil', createHilRouter(db));
  app.use('/api/touch', createTouchRouter(db));
  app.use('/api/nudges', createNudgesRouter(db));
  app.use('/api/interview', interviewRouter);
  app.use('/api/coach', coachRouter);
  app.use('/api/harvest', createHarvestRouter(undefined, undefined, { live }));
  app.use('/api/sprs', sprsRouter);
  app.use('/api/recipes', recipesRouter);
  app.use('/api/reassessment', reassessmentRouter);
  // W4-MU2 (MU-02): the SPA's "Run discovery" — sim-only discovery run jobs.
  app.use('/api/discovery', createDiscoveryRouter({ live }));
  // FC-MU-2: the per-engagement live flag + device-code consent (OFF by default).
  app.use('/api/live', createLiveRouter(live));
  // GP-MUSTER-2 M2: delivery portal — operator lane + grantee download lane.
  app.use('/api/delivery', createDeliveryRouter(db));
  app.use('/portal', createPortalRouter(db));

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export const app = createApp();
