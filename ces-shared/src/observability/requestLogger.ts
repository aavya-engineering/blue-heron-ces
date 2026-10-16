// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Shared observability primitive (G-ENG-6): structured logging + a request-ID middleware.
//
// The observability floor for CES servers: every request gets a correlation id, and privileged
// actions log a structured (JSON-line) record rather than ad-hoc console.* sprawl. Dependency-free
// (no winston — logging to stdout/stderr is enough for an operator-local tool) so any module can
// adopt it without adding to the install/audit surface.

import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

/** Emit one structured JSON line. error/warn -> stderr, else stdout. Never throws. */
export function structuredLog(level: LogLevel, message: string, fields: LogFields = {}): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  } catch {
    // Logging must never break the request path.
  }
}

// Minimal shapes so this stays framework-agnostic (no express type dependency in ces-shared).
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

/**
 * Express-compatible middleware: assigns/propagates a request id (honoring an inbound
 * `x-request-id`), echoes it on the response header, stashes it on `req.requestId`, and logs a
 * structured completion line with method, path, status, and duration.
 */
export interface RequestLoggerOptions {
  /**
   * Exact request paths (query string ignored) whose completion log line is suppressed — e.g. a health
   * poller. Skipped requests still get the request id assigned and echoed on `x-request-id`.
   */
  skipPaths?: string[];
}

export function requestLogger(service: string, options: RequestLoggerOptions = {}) {
  const skip = new Set(options.skipPaths ?? []);
  return (req: ReqLike, res: ResLike, next: () => void): void => {
    const inbound = req.headers?.['x-request-id'];
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();
    req.requestId = requestId;
    res.setHeader?.('x-request-id', requestId);
    if (skip.size > 0 && skip.has((req.originalUrl ?? req.url ?? '').split('?')[0]!)) return next();
    const start = Date.now();
    res.on('finish', () => {
      structuredLog('info', 'request', {
        service,
        requestId,
        method: req.method,
        path: req.originalUrl ?? req.url,
        status: res.statusCode,
        ms: Date.now() - start,
      });
    });
    next();
  };
}
