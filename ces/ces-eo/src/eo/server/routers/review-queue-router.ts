// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31: read-only data for the EO kit UI's review screen (GD-b document reviews).
//
//   GET /api/review-queue/controls
//       -> { controls: [{ controlId, objectiveIds }] }   the non-stack set (AssessorApproach), sorted
//   GET /api/review-queue?tenant=<slug>&controlId=<id>
//       -> { tenant, controlId, nonStack, objectiveIds, items, reviews }
//          items:   the EC items on the control (itemId, filename, sha256, uploadedBy, collectedAt, ...)
//          reviews: the live reviews of the control (FIN-12: superseded rows excluded)
//
// Nothing here writes, decides or scores. The review itself is POST /api/reviews (review-router.ts),
// which keeps every GD-b check (minted approver token, known uploader, reviewer != uploader).

import express, { type Request, type Response } from 'express';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { resolveTenantScope } from '../tenant-resolve.js';
import { validateControlId } from '../eo-router-utils.js';
import { EcEvidenceReader } from '../../evidence/EcEvidenceReader.js';
import { objectiveIdsByControl } from '../../assessment/ControlAssessor.js';
import { nonStackPractices } from '../../ssp/AssessorApproach.js';
import { DocumentReviewStore } from './review-router.js';

export interface ReviewQueueRouterDeps {
  stamperRoot: string;
  ecUrl?: string;
  secret?: string;
  /** EC item lookup (default EcEvidenceReader.readItems). Tests inject one. */
  ecItems?: (tenantSlug: string, controlId: string) => Promise<EcEvidenceItem[]>;
  store?: DocumentReviewStore;
}

/** The fields the review screen shows. Content is never returned. */
export interface ReviewQueueItem {
  itemId: string;
  filename: string;
  sha256: string;
  controlIds: string[];
  source: string;
  submittedByRole?: string;
  collectedAt: string;
  uploadedBy: { upn: string; subjectId?: string } | null;
}

export function createReviewQueueRouter(deps: ReviewQueueRouterDeps): express.Router {
  const router = express.Router();
  const store = deps.store ?? new DocumentReviewStore();
  const ecItems = deps.ecItems ?? ((slug: string, controlId: string) =>
    new EcEvidenceReader({ ecUrl: deps.ecUrl ?? '', secret: deps.secret }).readItems(slug, controlId));

  router.get('/api/review-queue/controls', (_req: Request, res: Response) => {
    const objectives = objectiveIdsByControl();
    const controls = [...nonStackPractices()].sort().map((controlId) => ({ controlId, objectiveIds: objectives.get(controlId) ?? [] }));
    res.json({ controls });
  });

  router.get('/api/review-queue', async (req: Request, res: Response, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const scope = resolveTenantScope(req.query.tenant, deps.stamperRoot);
      if (!scope.ok) {
        res.status(scope.status).json({ error: scope.status === 404 ? 'tenant_unknown' : 'tenant_required', detail: scope.message });
        return;
      }
      const controlId = typeof req.query.controlId === 'string' ? req.query.controlId : '';
      if (!controlId || !validateControlId(controlId)) {
        res.status(400).json({ error: 'controlId_invalid', detail: 'controlId must be a control id such as PE.L2-3.10.2' });
        return;
      }
      const items: ReviewQueueItem[] = (await ecItems(scope.slug, controlId))
        .filter((i) => i.controlIds.includes(controlId))
        .map((i) => ({
          itemId: i.itemId,
          filename: i.filename,
          sha256: i.sha256,
          controlIds: i.controlIds,
          source: i.source,
          ...(i.submittedByRole ? { submittedByRole: i.submittedByRole } : {}),
          collectedAt: i.collectedAt,
          uploadedBy: i.uploadedBy?.upn ? { upn: i.uploadedBy.upn, subjectId: i.uploadedBy.subjectId } : null,
        }));
      res.json({
        tenant: scope.slug,
        controlId,
        nonStack: nonStackPractices().has(controlId),
        objectiveIds: objectiveIdsByControl().get(controlId) ?? [],
        items,
        reviews: store.list({ slug: scope.slug, tenantId: scope.tenantId }, controlId),
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
