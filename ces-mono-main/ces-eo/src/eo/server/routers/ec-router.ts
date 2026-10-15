// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Server-side proxy to the Evidence Collector (EC) service (plan M4a, REQ-ces-eo-ec-wiring).
 *
 * EC is a standalone process (tool-boundary rule — EO never links against it). The browser
 * never sees `EVIDENCE_OPS_SECRET`: only this router attaches the bearer, on the two
 * authenticated EC routes (`/api/items` via EcEvidenceReader, and `/api/ingest` here).
 * `/api/health|runs|findings` are open on EC's side and stay open here.
 *
 * Deviation from the REQ's suggested transport for ingest: the upload form posts
 * multipart/form-data (like EO's existing personnel-attachment uploads), not a raw JSON
 * body with a pre-encoded `contentBase64` field. This route base64-encodes the buffer
 * server-side before forwarding to EC's `POST /api/ingest`, so no route-specific
 * `express.json` size limit is needed here — the multer instance backing this route caps
 * the decoded upload at EC's own 10 MB ingest ceiling (see EoServer.ts).
 */
import express, { type Request, type Response } from 'express';
import type { Multer } from 'multer';

export interface EcRouterDeps {
  /** Base URL of the EC service (EC_URL env, default http://127.0.0.1:4001). */
  ecUrl: string;
  /** EVIDENCE_OPS_SECRET. Ingest is refused (503) when unset — EC would refuse it too. */
  secret?: string;
  /** Multer instance (memory storage) backing the upload form. */
  upload: Multer;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** The global fetch Response type, aliased to avoid colliding with express's `Response` import. */
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<FetchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sendUnreachable(res: Response): void {
  res.status(503).json({ status: 'unreachable' });
}

async function forwardResponse(resp: FetchResponse, res: Response): Promise<void> {
  const text = await resp.text();
  res.status(resp.status);
  res.type(resp.headers.get('content-type') ?? 'application/json');
  res.send(text);
}

export function createEcRouter(deps: EcRouterDeps): express.Router {
  const { secret, upload, timeoutMs = DEFAULT_TIMEOUT_MS } = deps;
  const base = deps.ecUrl.replace(/\/+$/, '');
  const router = express.Router();

  async function proxyGet(ecPath: string, req: Request, res: Response): Promise<void> {
    const url = new URL(`${base}${ecPath}`);
    const tenant = req.query.tenant;
    if (typeof tenant === 'string' && tenant.length > 0) url.searchParams.set('tenant', tenant);
    const status = req.query.status;
    if (typeof status === 'string' && status.length > 0) url.searchParams.set('status', status);
    try {
      const resp = await fetchWithTimeout(url.toString(), {}, timeoutMs);
      await forwardResponse(resp, res);
    } catch {
      sendUnreachable(res);
    }
  }

  // GET /api/ec/health — open on EC's side; not tenant-scoped (aggregate service status).
  router.get('/api/ec/health', (req, res) => { void proxyGet('/api/health', req, res); });

  // GET /api/ec/runs[?tenant=] — open on EC's side.
  router.get('/api/ec/runs', (req, res) => { void proxyGet('/api/runs', req, res); });

  // GET /api/ec/findings[?tenant=&status=] — open on EC's side.
  router.get('/api/ec/findings', (req, res) => { void proxyGet('/api/findings', req, res); });

  // POST /api/ec/ingest — multipart upload; EO adds the bearer server-side and forwards a
  // JSON {tenantSlug, controlIds, source, filename, mediaType, contentBase64,
  // submittedByRole} to EC's POST /api/ingest.
  router.post(
    '/api/ec/ingest',
    upload.single('file') as unknown as express.RequestHandler,
    async (req: Request, res: Response): Promise<void> => {
      if (!req.file) { res.status(400).json({ error: 'no_file', detail: 'file field is required' }); return; }

      const body = req.body as Record<string, string | undefined>;
      const tenantSlug = body.tenantSlug;
      const source = body.source;
      const submittedByRole = body.submittedByRole;
      const controlIdsRaw = body.controlIds;

      if (!tenantSlug || !source || !submittedByRole || !controlIdsRaw) {
        res.status(400).json({
          error: 'invalid_request',
          detail: 'tenantSlug, controlIds, source and submittedByRole are required',
        });
        return;
      }
      if (!secret) {
        res.status(503).json({ status: 'unreachable', detail: 'EVIDENCE_OPS_SECRET is not configured' });
        return;
      }

      const controlIds = controlIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
      if (controlIds.length === 0) {
        res.status(400).json({ error: 'invalid_request', detail: 'controlIds must contain at least one control id' });
        return;
      }

      const ingestBody = {
        tenantSlug,
        controlIds,
        source,
        filename: req.file.originalname,
        mediaType: req.file.mimetype || 'application/octet-stream',
        contentBase64: req.file.buffer.toString('base64'),
        submittedByRole,
      };

      try {
        const resp = await fetchWithTimeout(`${base}/api/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify(ingestBody),
        }, timeoutMs);
        await forwardResponse(resp, res);
      } catch {
        sendUnreachable(res);
      }
    },
  );

  return router;
}
