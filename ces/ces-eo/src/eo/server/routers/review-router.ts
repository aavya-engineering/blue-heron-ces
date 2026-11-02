// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// NS-1 (2026-10-30, GD-b): document reviews of non-stack evidence.
//
//   POST /api/reviews   header x-ces-principal: <minted approver token>
//                       body { tenant, controlId, objectiveId, artifactHash, verdict: 'met'|'not_met', notes? }
//   GET  /api/reviews?tenant=<slug>[&controlId=<id>]
//
// The reviewer is the identity a minted approver token proves (verifyMintedApproverToken: signature,
// expiry, ao-approver role, tenant GUID, WORM mint record). The cited artifact hash must name an EC
// item for the control; the item's uploader must be known (uploadedBy set) and must not be the
// reviewer (compared by UPN). Rows go to the WORM collection `eo_document_reviews` (ces-shared
// DEFAULT_WORM_COLLECTIONS), each under a fresh id, never overwritten. ControlAssessor counts them
// under GD-b only.
//
// FIN-12 (NS-audit F-7, founder FD-8): the latest review per objective counts. Each new row carries
// `supersedes`: the ids of the tenant's live rows for the same (controlId, objectiveId) at write time.
// The superseded rows stay in the WORM collection untouched; `DocumentReviewStore.list()` returns
// only live rows (no other row names them), so the assessment (assessment-router -> merge ->
// decideByReviews) sees the latest review per objective. `listAll()` returns the full history with
// `supersededBy` set. Legacy rows written before FIN-12 have no `supersedes`; the next review of the
// same objective supersedes all of them.
//
//   GET  /api/reviews?tenant=<slug>[&controlId=<id>][&history=1]
//        -> { tenant, reviews: <live rows> [, history: <all rows, supersededBy set>] }

import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { getCesRepository } from 'ces-shared/persistence/node';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { resolveTenantScope } from '../tenant-resolve.js';
import { ApproverTokenMintLog } from '../../approver-tokens/ApproverTokenMintLog.js';
import { verifyMintedApproverToken, type ApproverTokenMintSource } from '../../approver-tokens/ApproverTokenVerifier.js';
import { EcEvidenceReader } from '../../evidence/EcEvidenceReader.js';
import { objectiveIdsByControl, type DocumentReview } from '../../assessment/ControlAssessor.js';

export const DOCUMENT_REVIEW_COLLECTION = 'eo_document_reviews';

/**
 * FIN-12: a stored review row. `supersedes` (optional; absent on rows written before FIN-12) names
 * the earlier rows for the same (controlId, objectiveId) this row replaces for scoring.
 */
export type StoredDocumentReview = DocumentReview & { supersedes?: string[] };

/** FIN-12: a row of the full history, with the id of the row that superseded it (if any). */
export type DocumentReviewHistoryRow = StoredDocumentReview & { supersededBy?: string };

/** FIN-12: the supersede key. One live review per (controlId, objectiveId) once FIN-12 rows exist. */
export const reviewKey = (r: Pick<DocumentReview, 'controlId' | 'objectiveId'>): string => `${r.controlId}|${r.objectiveId}`;

/** FIN-12: reviewId -> the id of the row whose `supersedes` names it. */
export function supersededByIndex(rows: StoredDocumentReview[]): Map<string, string> {
  const by = new Map<string, string>();
  for (const r of rows) for (const id of r.supersedes ?? []) if (id !== r.reviewId && !by.has(id)) by.set(id, r.reviewId);
  return by;
}

/** FIN-12: the live rows: those no other row supersedes. Order is preserved. */
export function liveReviews<T extends StoredDocumentReview>(rows: T[]): T[] {
  const by = supersededByIndex(rows);
  return rows.filter((r) => !by.has(r.reviewId));
}

/** Append-only store for document reviews (WORM is enforced by the repository's default list). */
export class DocumentReviewStore {
  constructor(private readonly dbPath?: string) {}

  private get repo() {
    return getCesRepository(this.dbPath);
  }

  record(review: StoredDocumentReview, tenantId: string): void {
    this.repo.put(DOCUMENT_REVIEW_COLLECTION, {
      id: review.reviewId,
      ces: { tenantSlug: review.tenantSlug, tenantId },
      data: review,
    });
  }

  private rows(tenant: { slug: string; tenantId: string }): StoredDocumentReview[] {
    return this.repo
      .list<StoredDocumentReview>(DOCUMENT_REVIEW_COLLECTION, { tenantSlug: tenant.slug, tenantId: tenant.tenantId })
      .map((r) => r.data);
  }

  /**
   * The live reviews (FIN-12: superseded rows excluded), optionally for one control. This is what
   * the assessment counts under GD-b.
   */
  list(tenant: { slug: string; tenantId: string }, controlId?: string): StoredDocumentReview[] {
    return liveReviews(this.rows(tenant)).filter((r) => !controlId || r.controlId === controlId);
  }

  /** FIN-12: every row ever written (WORM history), each with `supersededBy` when it was replaced. */
  listAll(tenant: { slug: string; tenantId: string }, controlId?: string): DocumentReviewHistoryRow[] {
    const rows = this.rows(tenant);
    const by = supersededByIndex(rows);
    return rows
      .filter((r) => !controlId || r.controlId === controlId)
      .map((r) => (by.has(r.reviewId) ? { ...r, supersededBy: by.get(r.reviewId)! } : r));
  }
}

export interface ReviewRouterDeps {
  /** Stamper root, for slug -> tenant GUID resolution. */
  stamperRoot: string;
  /** EC base URL and bearer secret (EcEvidenceReader) for looking up the cited artifact. */
  ecUrl?: string;
  secret?: string;
  /** EC item lookup (default: EcEvidenceReader.readItems). Tests inject one. */
  ecItems?: (tenantSlug: string, controlId: string) => Promise<EcEvidenceItem[]>;
  env?: Record<string, string | undefined>;
  mints?: ApproverTokenMintSource;
  store?: DocumentReviewStore;
  now?: () => number;
}

const REVIEWER_HEADER = 'x-ces-principal';

export function createReviewRouter(deps: ReviewRouterDeps): express.Router {
  const router = express.Router();
  const mints = deps.mints ?? new ApproverTokenMintLog();
  const store = deps.store ?? new DocumentReviewStore();
  const ecItems = deps.ecItems ?? ((slug: string, controlId: string) =>
    new EcEvidenceReader({ ecUrl: deps.ecUrl ?? '', secret: deps.secret }).readItems(slug, controlId));
  const clock = deps.now ?? Date.now;

  const fail = (res: Response, status: number, error: string, detail?: string) =>
    res.status(status).json({ error, ...(detail ? { detail } : {}) });

  router.post('/api/reviews', async (req: Request, res: Response, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const scope = resolveTenantScope(body.tenant, deps.stamperRoot);
      if (!scope.ok) return fail(res, scope.status, scope.status === 404 ? 'tenant_unknown' : 'tenant_required', scope.message);
      const tenant = { slug: scope.slug, tenantId: scope.tenantId };

      const auth = verifyMintedApproverToken(
        typeof req.headers[REVIEWER_HEADER] === 'string' ? (req.headers[REVIEWER_HEADER] as string) : undefined,
        tenant,
        { mints, env: deps.env ?? process.env, ...(deps.now ? { now: deps.now } : {}) },
      );
      if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });

      const { controlId, objectiveId, artifactHash, verdict, notes } = body;
      if (typeof controlId !== 'string' || !controlId) return fail(res, 400, 'controlId_required');
      if (typeof objectiveId !== 'string' || !objectiveId) return fail(res, 400, 'objectiveId_required');
      if (typeof artifactHash !== 'string' || !artifactHash.trim()) return fail(res, 400, 'artifactHash_required');
      if (verdict !== 'met' && verdict !== 'not_met') return fail(res, 400, 'verdict_invalid', "verdict must be 'met' or 'not_met'");
      if (notes !== undefined && typeof notes !== 'string') return fail(res, 400, 'notes_invalid');
      if (!(objectiveIdsByControl().get(controlId) ?? []).includes(objectiveId)) {
        return fail(res, 400, 'objective_unknown', `${objectiveId} is not an assessment objective of ${controlId}`);
      }

      const hash = artifactHash.trim().toLowerCase();
      const matching = (await ecItems(tenant.slug, controlId))
        .filter((i) => i.controlIds.includes(controlId) && i.sha256.toLowerCase() === hash);
      if (matching.length === 0) return fail(res, 404, 'artifact_not_found', 'no EC item for this control carries that sha256');
      if (matching.some((i) => !i.uploadedBy?.upn)) {
        return fail(res, 409, 'uploader_unknown', 'the artifact has no recorded uploader, so reviewer independence cannot be checked');
      }
      const reviewerUpn = auth.reviewer.upn.trim().toLowerCase();
      if (matching.some((i) => i.uploadedBy!.upn.trim().toLowerCase() === reviewerUpn)) {
        return fail(res, 403, 'reviewer_is_uploader', 'a reviewer may not review an artifact they uploaded');
      }

      const first = matching[0].uploadedBy!;
      // FIN-12 (FD-8): this review replaces every live review of the same objective for scoring.
      const supersedes = store.list(tenant, controlId)
        .filter((r) => reviewKey(r) === reviewKey({ controlId, objectiveId }))
        .map((r) => r.reviewId);
      const review: StoredDocumentReview = {
        reviewId: randomUUID(),
        tenantSlug: tenant.slug,
        controlId,
        objectiveId,
        artifactHash: hash,
        verdict,
        ...(notes ? { notes } : {}),
        reviewer: {
          upn: auth.reviewer.upn,
          subjectId: auth.reviewer.subjectId,
          tokenId: auth.reviewer.tokenId,
          ...(auth.reviewer.displayName ? { displayName: auth.reviewer.displayName } : {}),
        },
        uploader: { upn: first.upn, subjectId: first.subjectId },
        ecItemIds: matching.map((i) => i.itemId),
        reviewedAt: new Date(clock()).toISOString(),
        ...(supersedes.length ? { supersedes } : {}),
      };
      store.record(review, tenant.tenantId);
      res.status(201).json(review);
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/reviews', (req: Request, res: Response) => {
    const scope = resolveTenantScope(req.query.tenant, deps.stamperRoot);
    if (!scope.ok) return fail(res, scope.status, scope.status === 404 ? 'tenant_unknown' : 'tenant_required', scope.message);
    const controlId = typeof req.query.controlId === 'string' && req.query.controlId ? req.query.controlId : undefined;
    const t = { slug: scope.slug, tenantId: scope.tenantId };
    const history = req.query.history === '1' || req.query.history === 'true';
    res.json({ tenant: scope.slug, reviews: store.list(t, controlId), ...(history ? { history: store.listAll(t, controlId) } : {}) });
  });

  return router;
}
