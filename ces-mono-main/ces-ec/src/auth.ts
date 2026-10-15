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

import { getSecret } from './config.js';

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
