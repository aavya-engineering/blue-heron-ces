// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discovery.ts — W4-MU2 (MU-02): the SPA's "Run discovery" reaches the real
// executor. A full-registry walk against stacksim takes ~1.5 minutes, so the
// run is a job: POST /api/discovery/run starts it (202 + job_id) and
// GET /api/discovery/run/:id polls it (running | done + envelope | failed).
//
// Sim only, structurally: the run is services/simDiscoveryRun.ts (the same
// function `mu discovery --sim` calls). It targets the SIM_URL constant and a
// sim-psmodules-only session; nothing in the request selects a tenant URL.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import {
  runSimDiscovery,
  type SimDiscoveryDeps,
  type SimDiscoveryOutcome,
} from '../services/simDiscoveryRun.js';
import { runLiveDiscovery, type LiveDiscoveryDeps } from '../services/liveDiscoveryRun.js';
import { authorizeLive, type LiveGate } from '../services/liveAccess.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_SLUG = 'stacksim-local';
const MAX_JOBS = 20;

type Job =
  | { status: 'running'; started_at: string }
  | ({ status: 'done' | 'failed'; started_at: string; finished_at: string } & { outcome: SimDiscoveryOutcome });

export interface DiscoveryRouterOptions {
  /** Test seam: the run function (default: the production sim run). */
  run?: typeof runSimDiscovery;
  /** Test seam: deps forwarded to the run (fake session, probe, …). */
  runDeps?: SimDiscoveryDeps;
  /** Where each job's captures land (default: <tmp>/muster-discovery-runs). */
  workRoot?: string;
  /**
   * FC-MU-2 (MU-03 live): the live gate (engagement flag + device-code
   * consent). Absent → every `live: true` request is refused. The sim path
   * never consults it.
   */
  live?: LiveGate;
  /** Test seam: the live run function (default: runLiveDiscovery). */
  runLive?: typeof runLiveDiscovery;
  /** Test seam: deps forwarded to the live run (tests inject a fake session). */
  runLiveDeps?: LiveDiscoveryDeps;
}

export function createDiscoveryRouter(opts: DiscoveryRouterOptions = {}): Router {
  const router = Router();
  const run = opts.run ?? runSimDiscovery;
  const workRoot = opts.workRoot ?? path.join(os.tmpdir(), 'muster-discovery-runs');
  const jobs = new Map<string, Job>();

  function remember(id: string, job: Job): void {
    jobs.set(id, job);
    // Bounded: drop the oldest finished jobs.
    while (jobs.size > MAX_JOBS) {
      const oldest = [...jobs.entries()].find(([, j]) => j.status !== 'running');
      if (!oldest) break;
      jobs.delete(oldest[0]);
    }
  }

  router.post('/run', bearerAuth, requireRole('prime', 'bhd_operator'), async (req, res, next) => {
    const slug = (req.body?.tenant_slug as unknown) ?? DEFAULT_SLUG;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      res.status(400).json({ error: 'tenant_slug must match /^[a-z0-9][a-z0-9-]{0,63}$/' });
      return;
    }
    const live = req.body?.live === true;
    let started: Promise<SimDiscoveryOutcome>;
    const id = randomUUID();
    if (live) {
      // FC-MU-2: the live path — engagement flag ON + a granted consent, or refused.
      let auth;
      try {
        // FC-MU-3: one consent per area — `consent_ids` (list) or `consent_id`.
        auth = await authorizeLive(opts.live, req.user!.tenant_id, req.body?.engagement_id, req.body?.consent_ids ?? req.body?.consent_id);
      } catch (err) {
        next(err);
        return;
      }
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.code });
        return;
      }
      started = Promise.resolve().then(() =>
        (opts.runLive ?? runLiveDiscovery)(
          {
            slug,
            outDir: path.join(workRoot, id),
            engagementId: req.body.engagement_id as string,
            grants: auth.grants,
          },
          opts.runLiveDeps
        )
      );
    } else {
      started = Promise.resolve().then(() => run({ slug, outDir: path.join(workRoot, id) }, opts.runDeps));
    }
    const startedAt = new Date().toISOString();
    remember(id, { status: 'running', started_at: startedAt });

    void started
      .catch((e): SimDiscoveryOutcome => ({
        ok: false,
        code: 'envelope_invalid',
        message: e instanceof Error ? e.message : String(e),
      }))
      .then((outcome) => {
        remember(id, {
          status: outcome.ok ? 'done' : 'failed',
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          outcome,
        });
      });

    res.status(202).json({ job_id: id, status: 'running', tenant_kind: live ? 'live' : 'sim' });
  });

  router.get('/run/:id', bearerAuth, requireRole('prime', 'bhd_operator'), (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'No such discovery run' });
      return;
    }
    if (job.status === 'running') {
      res.json({ status: 'running', started_at: job.started_at });
      return;
    }
    const o = job.outcome;
    if (o.ok) {
      res.json({
        status: 'done',
        started_at: job.started_at,
        finished_at: job.finished_at,
        stats: o.stats,
        postures: o.postures,
        envelope: o.envelope,
      });
    } else {
      res.json({ status: 'failed', started_at: job.started_at, finished_at: job.finished_at, code: o.code, error: o.message });
    }
  });

  return router;
}
