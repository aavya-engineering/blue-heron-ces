// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestLogger } from './requestLogger.js';

function mkRes() {
  const handlers: Array<() => void> = [];
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    headers,
    setHeader(n: string, v: string) { headers[n] = v; },
    on(_e: 'finish', cb: () => void) { handlers.push(cb); },
    finish() { handlers.forEach((h) => h()); },
  };
}
function logLines(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((l) => l.message === 'request');
}

describe('requestLogger skipPaths (REQ from ces-eo 2026-07-10, W4-SH3)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('zero-option call logs every request as before', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const mw = requestLogger('svc');
    const res = mkRes(); const next = vi.fn();
    mw({ method: 'GET', url: '/api/health', headers: {} }, res, next);
    res.finish();
    expect(next).toHaveBeenCalled();
    const lines = logLines(out);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ service: 'svc', method: 'GET', path: '/api/health', status: 200 });
  });

  it('a skipped path (query ignored) logs nothing but still gets and echoes x-request-id', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const mw = requestLogger('svc', { skipPaths: ['/api/health'] });
    const req: any = { method: 'GET', originalUrl: '/api/health?t=1', headers: { 'x-request-id': 'rid-1' } };
    const res = mkRes(); const next = vi.fn();
    mw(req, res, next);
    res.finish();
    expect(next).toHaveBeenCalled();
    expect(req.requestId).toBe('rid-1');
    expect(res.headers['x-request-id']).toBe('rid-1');
    expect(logLines(out)).toHaveLength(0);
  });

  it('other paths still log with the same fields', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const mw = requestLogger('svc', { skipPaths: ['/api/health'] });
    const res = mkRes();
    mw({ method: 'POST', url: '/api/runs', headers: {} }, res, vi.fn());
    res.finish();
    const lines = logLines(out);
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]).sort()).toEqual(['level', 'message', 'method', 'ms', 'path', 'requestId', 'service', 'status', 'ts']);
  });
});
