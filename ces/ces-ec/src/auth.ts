// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Bearer auth against EVIDENCE_OPS_SECRET (the existing EvidenceOps secret, plan M2).
// Constant-time: both sides are SHA-256'd to equal-length digests before
// crypto.timingSafeEqual, so a wrong-length token is a 401, never a throw/500.
// Unset secret => 503 (fail closed: EC never runs an open write endpoint).

import * as crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  DEFAULT_PRINCIPAL_HEADER,
  createHs256PrincipalVerifier,
  requirePrincipal,
} from 'ces-shared/http/principal';
import { isLoopbackRequest } from 'ces-shared/http';

import { getPrincipalConfig, getSecret } from './config.js';

export function tokensMatch(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented, 'utf-8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf-8').digest();
  return crypto.timingSafeEqual(a, b);
}

export function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const secret = getSecret();
  if (!secret) {
    res.status(503).json({ error: 'not_configured', detail: 'EVIDENCE_OPS_SECRET is not set; authenticated routes are disabled' });
    return;
  }
  const header = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || !tokensMatch(m[1].trim(), secret)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

// PH7-SEC: the read routes that are open by design (/api/runs, /api/findings) stay open to loopback
// callers (EO on the same host reads them without a token). Now that EC listens on every interface,
// a NETWORK caller must present the same bearer as the protected routes; with no secret set, a
// network caller is refused (401), never served. /api/health stays open to everyone.
export function requireBearerFromNetwork(req: Request, res: Response, next: NextFunction): void {
  if (isLoopbackRequest(req)) {
    next();
    return;
  }
  const secret = getSecret();
  const header = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!secret || !m || !tokensMatch(m[1].trim(), secret)) {
    res.status(401).json({
      error: 'unauthorized',
      detail: 'network access to the Evidence Collector requires the bearer token (loopback access needs none)',
    });
    return;
  }
  next();
}

// NS-0: the uploader's identity. OPTIONAL per request: no x-ces-principal header => no principal
// (the item records uploadedBy: null). A header that is present must verify against
// CES_EC_PRINCIPAL_SECRET (optional _ISSUER / _AUDIENCE), else 401 — never a silent downgrade to null.
// No dev principal. Modelled on ces-ao src/server/principal.ts optionalAoPrincipal.
export function optionalUploaderPrincipal(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers[DEFAULT_PRINCIPAL_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !String(value).trim()) {
    next();
    return;
  }
  const cfg = getPrincipalConfig();
  if (!cfg || cfg.secret.length < 16) {
    res.status(401).json({ error: 'unauthorized', detail: 'principal token supplied but CES_EC_PRINCIPAL_SECRET is not configured (>= 16 chars)' });
    return;
  }
  const guard = requirePrincipal({ verifier: createHs256PrincipalVerifier(cfg), apiPrefix: '/', service: 'evidence-collector' });
  guard(req, res, next);
}
