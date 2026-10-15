// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EC HTTP surface (plan M2). Routes:
//   GET  /api/health                         open    EcHealth (+ contractVersion, simOnly, reasons)
//   GET  /api/runs[?tenant=]                 open    EcRun[] newest first (no tenant = all admitted tenants)
//   GET  /api/findings[?tenant=&status=]     open    EcFinding[] newest first (same aggregation)
//   GET  /api/items?tenant=[&controlId=]     bearer  EcEvidenceItem[]
//   GET  /api/items/:itemId/content?tenant=  bearer  raw bytes (Content-Type = item mediaType)
//   POST /api/ingest                         bearer  JSON {tenantSlug, controlIds, source, filename,
//                                                    mediaType, contentBase64, submittedByRole,
//                                                    collectedAt?} -> 201 EcEvidenceItem
//   POST /api/index?tenant=                  bearer  run one index pass now -> EcRun + new findings
// Status codes: 400 bad slug/body · 401 bad token · 403 sim-rail refusal · 404 unknown item
//               409 pass in flight · 413 upload > 10 MB · 503 secret unset.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import {
  EC_CONTRACT_VERSION,
  EcEvidenceSource,
  EcHealthSchema,
  type EcEvidenceItem,
  type EcFinding,
  type EcRun,
} from 'ces-shared/types/evidence-collector';

import { requireBearer } from './auth.js';
import { INGEST_JSON_LIMIT, MAX_INGEST_BYTES, getSecret, isSimOnly } from './config.js';
import { IndexInFlightError, IndexService } from './scheduler.js';
import { checkTenant, logRefusal, registryTenantResolver, type TenantResolver } from './simRail.js';
import {
  BadTenantSlugError,
  appendRun,
  listFindings,
  listItems,
  listRuns,
  listStoredTenants,
  newItemId,
  readItem,
  sha256Hex,
  tenantRoot,
  writeItem,
} from './store.js';

const PKG_VERSION: string = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.resolve(here, '..', 'package.json'), 'utf-8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export interface AppDeps {
  resolveTenant?: TenantResolver;
  indexService?: IndexService;
  now?: () => Date;
  startedAt?: string;
}

/** Strict request body: an unknown key (e.g. `verdict`, `dryRun`) is a 400. */
const IngestRequestSchema = z
  .object({
    tenantSlug: z.string().min(1),
    controlIds: z.array(z.string().min(1)).min(1),
    source: EcEvidenceSource,
    filename: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(255),
    contentBase64: z.string(),
    submittedByRole: z.string().min(1),
    collectedAt: z.string().datetime().optional(),
  })
  .strict();

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function decodedLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function queryTenant(req: Request): string | undefined {
  const t = req.query.tenant;
  return typeof t === 'string' && t.length > 0 ? t : undefined;
}

export function createApp(deps: AppDeps = {}): express.Express {
  const resolveTenant = deps.resolveTenant ?? registryTenantResolver();
  const indexService = deps.indexService ?? new IndexService(resolveTenant, { now: deps.now });
  const now = deps.now ?? (() => new Date());
  const startedAt = deps.startedAt ?? now().toISOString();

  const app = express();
  app.disable('x-powered-by');

  /** Slug guard + sim rail. Sends 400/403 and returns false when the request must stop. */
  async function admit(res: Response, slug: string, operation: string): Promise<'sim' | 'live' | false> {
    try {
      tenantRoot(slug);
    } catch (err) {
      res.status(400).json({ error: 'bad_tenant', detail: (err as Error).message });
      return false;
    }
    const decision = await checkTenant(slug, resolveTenant);
    if (!decision.allowed) {
      logRefusal({ at: now().toISOString(), tenantSlug: slug, operation, reason: decision.reason });
      res.status(403).json({ error: 'refused', reason: decision.reason });
      return false;
    }
    return decision.mode;
  }

  /** Tenants a list route covers: the one asked for (admitted), or every admitted stored tenant. */
  async function tenantsFor(req: Request, res: Response, operation: string): Promise<string[] | undefined> {
    const one = queryTenant(req);
    if (one) return (await admit(res, one, operation)) ? [one] : undefined;
    const admitted: string[] = [];
    for (const slug of listStoredTenants()) {
      const d = await checkTenant(slug, resolveTenant);
      if (d.allowed) admitted.push(slug);
    }
    return admitted;
  }

  app.get('/api/health', (_req, res) => {
    const reasons: string[] = [];
    if (!getSecret()) reasons.push('EVIDENCE_OPS_SECRET not set: ingest/index/items routes disabled');
    const health = EcHealthSchema.parse({
      status: reasons.length === 0 ? 'ok' : 'degraded',
      mode: isSimOnly() ? 'sim' : 'live',
      startedAt,
      version: PKG_VERSION,
    });
    res.json({ ...health, contractVersion: EC_CONTRACT_VERSION, simOnly: isSimOnly(), reasons });
  });

  app.get('/api/runs', async (req, res, next) => {
    try {
      const tenants = await tenantsFor(req, res, 'list-runs');
      if (!tenants) return;
      const rows: Array<EcRun & { tenantSlug: string }> = tenants.flatMap((t) => listRuns(t));
      rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/findings', async (req, res, next) => {
    try {
      const tenants = await tenantsFor(req, res, 'list-findings');
      if (!tenants) return;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      let rows: EcFinding[] = tenants.flatMap((t) => listFindings(t));
      if (status) rows = rows.filter((f) => f.status === status);
      rows.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/items', requireBearer, async (req, res, next) => {
    try {
      const slug = queryTenant(req);
      if (!slug) {
        res.status(400).json({ error: 'bad_request', detail: 'tenant query parameter is required' });
        return;
      }
      if (!(await admit(res, slug, 'list-items'))) return;
      const controlId = typeof req.query.controlId === 'string' ? req.query.controlId : undefined;
      let items: EcEvidenceItem[] = listItems(slug);
      if (controlId) items = items.filter((i) => i.controlIds.includes(controlId));
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/items/:itemId/content', requireBearer, async (req, res, next) => {
    try {
      const slug = queryTenant(req);
      if (!slug) {
        res.status(400).json({ error: 'bad_request', detail: 'tenant query parameter is required' });
        return;
      }
      if (!(await admit(res, slug, 'read-item'))) return;
      const found = readItem(slug, req.params.itemId);
      if (!found) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.setHeader('Content-Type', found.item.mediaType);
      res.setHeader('X-EC-Sha256', found.item.sha256);
      res.send(found.content);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ingest', requireBearer, express.json({ limit: INGEST_JSON_LIMIT }), async (req, res, next) => {
    try {
      const parsed = IngestRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }
      const body = parsed.data;
      const mode = await admit(res, body.tenantSlug, 'ingest');
      if (!mode) return;

      const b64 = body.contentBase64.replace(/\s+/g, '');
      if (b64.length % 4 !== 0 || !BASE64_RE.test(b64)) {
        res.status(400).json({ error: 'invalid_request', detail: 'contentBase64 is not valid base64' });
        return;
      }
      if (decodedLength(b64) > MAX_INGEST_BYTES) {
        res.status(413).json({ error: 'too_large', detail: `decoded content exceeds ${MAX_INGEST_BYTES} bytes` });
        return;
      }
      const content = Buffer.from(b64, 'base64');
      if (content.length > MAX_INGEST_BYTES) {
        res.status(413).json({ error: 'too_large', detail: `decoded content exceeds ${MAX_INGEST_BYTES} bytes` });
        return;
      }

      const nowIso = now().toISOString();
      const item: EcEvidenceItem = {
        contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
        itemId: newItemId(),
        tenantSlug: body.tenantSlug,
        controlIds: body.controlIds,
        source: body.source,
        filename: path.basename(body.filename),
        mediaType: body.mediaType,
        sha256: sha256Hex(content),
        sizeBytes: content.length,
        collectedAt: body.collectedAt ?? nowIso,
        submittedByRole: body.submittedByRole,
        mode,
      };
      let written: EcEvidenceItem;
      try {
        written = writeItem(item, content, nowIso);
      } catch (err) {
        appendRun(body.tenantSlug, { runId: `ecr-${item.itemId}`, startedAt: nowIso, runType: 'ingest', status: 'failed', artifactsWritten: 0 });
        throw err;
      }
      appendRun(body.tenantSlug, { runId: `ecr-${item.itemId}`, startedAt: nowIso, runType: 'ingest', status: 'success', artifactsWritten: 1 });
      res.status(201).json(written);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/index', requireBearer, async (req, res, next) => {
    try {
      const slug = queryTenant(req);
      if (!slug) {
        res.status(400).json({ error: 'bad_request', detail: 'tenant query parameter is required' });
        return;
      }
      if (!(await admit(res, slug, 'index'))) return;
      const outcome = await indexService.indexTenant(slug, 'index');
      if (outcome.outcome !== 'indexed') {
        res.status(403).json({ error: 'refused', reason: outcome.outcome === 'refused' ? outcome.reason : 'busy' });
        return;
      }
      res.json({ run: outcome.result.run, filesSeen: outcome.result.filesSeen, newFindings: outcome.result.newFindings });
    } catch (err) {
      if (err instanceof IndexInFlightError) {
        res.status(409).json({ error: 'busy', detail: err.message });
        return;
      }
      next(err);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: 'too_large', detail: 'request body exceeds the ingest limit' });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_request', detail: 'body is not valid JSON' });
      return;
    }
    if (err instanceof BadTenantSlugError) {
      res.status(400).json({ error: 'bad_tenant', detail: err.message });
      return;
    }
    console.error(`[ces-ec] unhandled error: ${e?.message ?? String(err)}`);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
