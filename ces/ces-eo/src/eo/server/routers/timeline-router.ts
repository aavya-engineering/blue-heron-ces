// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express, { type Request, type Response } from 'express';
import type { EoConfig } from '../../config/EoConfig.js';
import { AssessmentStore } from '../../assessment/AssessmentStore.js';
import {
  sendError,
  requireTenantScope,
  loadTimeline,
  saveTimeline,
  type TimelineEvent,
} from '../eo-router-utils.js';

export interface TimelineRouterDeps {
  config: EoConfig;
  assessmentStore: AssessmentStore;
  /** FX-EO8: slug -> tenant resolution; ?tenant= is required (no config.tenantSlug fallback). */
  stamperRoot: string;
}

export function createTimelineRouter(deps: TimelineRouterDeps): express.Router {
  const { config, assessmentStore, stamperRoot } = deps;
  const router = express.Router();

  // ── Assessment Timeline Endpoints ──

  // GET /api/timeline?tenant=slug
  router.get('/api/timeline', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const tenantSlug = scope.slug;
    const timeline = loadTimeline(config.storageRoot, tenantSlug);

    // Auto-populate assessment events from snapshots
    const snapshots = assessmentStore.listSnapshotsForTenant(scope.tenantId); // FX-EO8: this tenant's only
    const existingIds = new Set(timeline.events.map(e => e.eventId));
    for (const snap of snapshots) {
      const eventId = `assessment-${snap.snapshotId}`;
      if (!existingIds.has(eventId)) {
        timeline.events.push({
          eventId,
          type: 'assessment',
          title: `Assessment: SPRS ${snap.sprs_score}`,
          date: snap.generatedAt,
          detail: `SPRS Score: ${snap.sprs_score}`,
        });
      }
    }

    timeline.events.sort((a, b) => a.date.localeCompare(b.date));
    res.json(timeline);
  });

  // POST /api/timeline/events — add custom timeline event
  router.post('/api/timeline/events', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const tenantSlug = scope.slug;

    const { title, date, type, detail } = req.body;
    if (!title || !date) {
      sendError(res, 400, 'title and date are required');
      return;
    }

    const timeline = loadTimeline(config.storageRoot, tenantSlug);
    const event: TimelineEvent = {
      eventId: `custom-${Date.now()}`,
      type: type || 'custom',
      title,
      date,
      detail,
    };
    timeline.events.push(event);
    saveTimeline(config.storageRoot, timeline);

    res.json(event);
  });

  return router;
}
