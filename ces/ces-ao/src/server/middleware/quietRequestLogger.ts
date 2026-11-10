// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Quiet variant of ces-shared's requestLogger: same request-id assignment/propagation
// (observability floor, G-ENG-6), but per-request completion lines are only emitted for
// failures (status >= 400) or slow requests (>= 1s). Routine 2xx/3xx traffic — static
// assets, registry fetches, approvals polling — stays off the console.
// Set AO_LOG_REQUESTS=all to restore the full per-request log stream.

import { randomUUID } from 'node:crypto';
import { structuredLog } from 'ces-shared/observability';

const SLOW_MS = 1000;

interface ReqLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
}
interface ResLike {
  statusCode?: number;
  setHeader?(name: string, value: string): void;
  on(event: 'finish', cb: () => void): void;
}

export function quietRequestLogger(service: string) {
  // Read once at middleware construction, not per request: toggling AO_LOG_REQUESTS
  // requires a server restart (deliberate — this is an operator-local tool).
  const logAll = process.env.AO_LOG_REQUESTS === 'all';
  return (req: ReqLike, res: ResLike, next: () => void): void => {
    const inbound = req.headers?.['x-request-id'];
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();
    req.requestId = requestId;
    res.setHeader?.('x-request-id', requestId);
    const start = Date.now();
    res.on('finish', () => {
      // A missing statusCode is an anomaly — treat it as loggable rather than coercing to 0
      // and silently filtering it.
      const status = res.statusCode;
      const ms = Date.now() - start;
      if (!logAll && status !== undefined && status < 400 && ms < SLOW_MS) return;
      const level = status !== undefined && status >= 500 ? 'error'
        : status !== undefined && status >= 400 ? 'warn' : 'info';
      structuredLog(level, 'request', {
        service,
        requestId,
        method: req.method,
        path: req.originalUrl ?? req.url,
        status,
        ms,
      });
    });
    next();
  };
}
