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
 * `/api/health|runs|findings` stay open here. PH7-EO: EC now asks a network (non-loopback) caller for the
 * bearer on `/api/runs` and `/api/findings` (P7-SEC), so the proxy sends it whenever a secret is configured.
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
import { checkCatalogIds, loadCatalog as defaultLoadCatalog, type CatalogLoad } from '../../evidence/EvidenceCatalog.js';

export interface EcRouterDeps {
  /** Base URL of the EC service (EC_URL env, default http://127.0.0.1:4001). */
  ecUrl: string;
  /** EVIDENCE_OPS_SECRET. Ingest is refused (503) when unset — EC would refuse it too. */
  secret?: string;
  /** Multer instance (memory storage) backing the upload form. */
  upload: Multer;
  timeoutMs?: number;
  /** EVC.5: evidence-catalog loader (default reads CES_EVIDENCE_CATALOG_PATH / defaults at call time). */
  loadCatalog?: () => CatalogLoad;
}

/** Multipart text field that may arrive once (comma-separated) or repeated. */
function listField(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  const parts = (Array.isArray(v) ? v : [v]).flatMap(x => String(x).split(','));
  return parts.map(x => x.trim()).filter(Boolean);
}

const DEFAULT_TIMEOUT_MS = 5000;

/** FIN-12: the uploader principal header EC reads on POST /api/ingest (ces-ec src/auth.ts, NS-0). */
export const PRINCIPAL_HEADER = 'x-ces-principal';

/** The caller's uploader token, trimmed; undefined when absent or blank. */
function principalHeader(req: Request): string | undefined {
  const raw = req.headers[PRINCIPAL_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

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
  const { secret, upload, timeoutMs = DEFAULT_TIMEOUT_MS, loadCatalog = defaultLoadCatalog } = deps;
  const base = deps.ecUrl.replace(/\/+$/, '');
  const router = express.Router();

  async function proxyGet(ecPath: string, req: Request, res: Response): Promise<void> {
    const url = new URL(`${base}${ecPath}`);
    const tenant = req.query.tenant;
    if (typeof tenant === 'string' && tenant.length > 0) url.searchParams.set('tenant', tenant);
    const status = req.query.status;
    if (typeof status === 'string' && status.length > 0) url.searchParams.set('status', status);
    try {
      const resp = await fetchWithTimeout(url.toString(), secret ? { headers: { Authorization: `Bearer ${secret}` } } : {}, timeoutMs);
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
  // submittedByRole, form_id?, emx_ids?} to EC's POST /api/ingest, plus the caller's
  // x-ces-principal header (FIN-12) so EC can record the uploader. EVC.5: the optional
  // catalog ids (`form_id`, `emx_ids` comma-separated) are validated here against the
  // evidence catalog (400 naming the unknown id); EC validates them again and records them.
  // They never change a status (DEC-7).
  // PH-12 (LOG-PH5-EO.md open item 6): a refused upload (over the 10 MB cap, or a multer error)
  // answers JSON (413 for the size cap, else 400), not Express's 500 HTML page.
  const singleFile: express.RequestHandler = (req, res, next) => {
    (upload.single('file') as unknown as express.RequestHandler)(req, res, (err?: unknown) => {
      if (!err) { next(); return; }
      const code = (err as { code?: unknown }).code;
      const detail = err instanceof Error ? err.message : String(err);
      if (code === 'LIMIT_FILE_SIZE') { res.status(413).json({ error: 'file_too_large', detail }); return; }
      res.status(400).json({ error: 'invalid_upload', detail });
    });
  };
  router.post(
    '/api/ec/ingest',
    singleFile,
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

      const rawBody = req.body as Record<string, unknown>;
      const formId = typeof rawBody.form_id === 'string' && rawBody.form_id.trim() ? rawBody.form_id.trim() : undefined;
      const emxIds = listField(rawBody.emx_ids);
      if (formId !== undefined || emxIds !== undefined) {
        const load = loadCatalog();
        if (load.status === 'unavailable') console.warn(`[ec-router] evidence catalog unavailable; forwarding catalog ids unvalidated: ${load.reason}`);
        const check = checkCatalogIds({ form_id: formId, emx_ids: emxIds }, load);
        if (!check.ok) {
          res.status(400).json({ error: 'invalid_request', field: check.field, id: check.id, detail: check.detail });
          return;
        }
      }

      const ingestBody = {
        tenantSlug,
        controlIds,
        source,
        filename: req.file.originalname,
        mediaType: req.file.mimetype || 'application/octet-stream',
        contentBase64: req.file.buffer.toString('base64'),
        submittedByRole,
        ...(formId !== undefined ? { form_id: formId } : {}),
        ...(emxIds !== undefined ? { emx_ids: emxIds } : {}),
      };

      // FIN-12 (NS-audit F-2): forward the uploader's x-ces-principal token verbatim. EC verifies it
      // (CES_EC_PRINCIPAL_SECRET) and records uploadedBy from it; a bad token is EC's 401, passed
      // through. EO never verifies, mints or invents an uploader. No header => EC records
      // uploadedBy: null (uploader unknown), and GD-b can never count a review of that item.
      const principal = principalHeader(req);
      try {
        const resp = await fetchWithTimeout(`${base}/api/ingest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secret}`,
            ...(principal ? { [PRINCIPAL_HEADER]: principal } : {}),
          },
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
