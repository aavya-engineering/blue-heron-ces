// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// NS-2 (2026-10-30): interview records from Muster.
//
//   POST /api/interviews   body { tenant, records: InterviewRecord[] }   (ces-shared/types/interview-record)
//   GET  /api/interviews?tenant=<slug>[&controlId=<id>][&questionId=<id>]
//
// The global EO bearer (CES_EO_AUTH_TOKEN) guards both. Each record must name the request's tenant,
// carry recordId = canonicalSha256(record without recordId), and cite only objectives that belong
// to their control (ces-shared assessment-objectives). Any failure is a 400 and nothing is written.
// Rows go to the WORM collection `eo_interview_records` under recordId: a record already stored is
// skipped (same id = same content), never overwritten. EO does not score them and sends nothing back
// to Muster beyond this receipt.

import express, { type Request, type Response } from 'express';
import { getCesRepository } from 'ces-shared/persistence/node';
import { canonicalSha256 } from 'ces-shared/crypto';
import { InterviewRecordBatchSchema, type InterviewRecord } from 'ces-shared/types/interview-record';
import { resolveTenantScope } from '../tenant-resolve.js';
import { objectiveIdsByControl } from '../../assessment/ControlAssessor.js';

export const INTERVIEW_RECORD_COLLECTION = 'eo_interview_records';

/** Append-only store for interview records (WORM via the repository's default list). */
export class InterviewRecordStore {
  constructor(private readonly dbPath?: string) {}

  private get repo() {
    return getCesRepository(this.dbPath);
  }

  /** Stores the record unless its id is already stored. Returns true when written. */
  record(rec: InterviewRecord, tenantId: string): boolean {
    const scope = { tenantSlug: rec.tenantSlug, tenantId };
    if (this.repo.get(INTERVIEW_RECORD_COLLECTION, rec.recordId, scope)) return false;
    this.repo.put(INTERVIEW_RECORD_COLLECTION, { id: rec.recordId, ces: scope, data: rec });
    return true;
  }

  list(tenant: { slug: string; tenantId: string }, filter: { controlId?: string; questionId?: string } = {}): InterviewRecord[] {
    return this.repo
      .list<InterviewRecord>(INTERVIEW_RECORD_COLLECTION, { tenantSlug: tenant.slug, tenantId: tenant.tenantId })
      .map((r) => r.data)
      .filter((r) => !filter.questionId || r.questionId === filter.questionId)
      .filter((r) => !filter.controlId || r.objectives.some((o) => o.controlId === filter.controlId));
  }
}

export interface InterviewRouterDeps {
  /** Stamper root, for slug -> tenant GUID resolution. */
  stamperRoot: string;
  store?: InterviewRecordStore;
}

export function interviewRecordId(rec: Omit<InterviewRecord, 'recordId'> & { recordId?: string }): string {
  const { recordId: _omit, ...rest } = rec;
  return canonicalSha256(rest);
}

export function createInterviewRouter(deps: InterviewRouterDeps): express.Router {
  const router = express.Router();
  const store = deps.store ?? new InterviewRecordStore();

  const fail = (res: Response, status: number, error: string, detail?: unknown) =>
    res.status(status).json({ error, ...(detail !== undefined ? { detail } : {}) });

  router.post('/api/interviews', (req: Request, res: Response, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const scope = resolveTenantScope(body.tenant, deps.stamperRoot);
      if (!scope.ok) return fail(res, scope.status, scope.status === 404 ? 'tenant_unknown' : 'tenant_required', scope.message);

      const parsed = InterviewRecordBatchSchema.safeParse(body);
      if (!parsed.success) return fail(res, 400, 'records_invalid', parsed.error.issues.slice(0, 20));

      const objectives = objectiveIdsByControl();
      const problems: string[] = [];
      for (const rec of parsed.data.records) {
        if (rec.tenantSlug !== scope.slug) problems.push(`${rec.questionId}: tenantSlug ${rec.tenantSlug} is not ${scope.slug}`);
        if (interviewRecordId(rec) !== rec.recordId) problems.push(`${rec.questionId}: recordId does not match the record's canonical sha256`);
        for (const o of rec.objectives) {
          const known = objectives.get(o.controlId);
          if (!known) { problems.push(`${rec.questionId}: unknown control ${o.controlId}`); continue; }
          for (const id of o.objectiveIds) if (!known.includes(id)) problems.push(`${rec.questionId}: ${id} is not an objective of ${o.controlId}`);
        }
      }
      if (problems.length > 0) return fail(res, 400, 'records_invalid', problems.slice(0, 20));

      let stored = 0;
      let skipped = 0;
      for (const rec of parsed.data.records) {
        if (store.record(rec, scope.tenantId)) stored++;
        else skipped++;
      }
      res.status(201).json({
        tenant: scope.slug,
        received: parsed.data.records.length,
        stored,
        skipped,
        recordIds: parsed.data.records.map((r) => r.recordId),
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/interviews', (req: Request, res: Response) => {
    const scope = resolveTenantScope(req.query.tenant, deps.stamperRoot);
    if (!scope.ok) return fail(res, scope.status, scope.status === 404 ? 'tenant_unknown' : 'tenant_required', scope.message);
    const pick = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    res.json({
      tenant: scope.slug,
      records: store.list({ slug: scope.slug, tenantId: scope.tenantId }, { controlId: pick(req.query.controlId), questionId: pick(req.query.questionId) }),
    });
  });

  return router;
}
