// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, apiRequest, buildUrl, setFetcher, stamperApi, stamperStreams } from './index';
import type { Fetcher } from './index';

interface Call {
  url: string;
  method: string;
  body: unknown;
  contentType: string | null;
}

function recordingFetcher(calls: Call[], status = 200, payload: unknown = { ok: true }): Fetcher {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      contentType: headers.get('Content-Type'),
    });
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status });
  };
}

let restore: Fetcher | null = null;
afterEach(() => {
  if (restore) setFetcher(restore);
  restore = null;
});

describe('buildUrl', () => {
  it('keeps key order, encodes values, drops undefined and null', () => {
    expect(buildUrl('/api/x')).toBe('/api/x');
    expect(buildUrl('/api/x', { a: undefined, b: null })).toBe('/api/x');
    expect(buildUrl('/api/x', { tenant: 'ridge line', dryRun: true, n: 2 })).toBe('/api/x?tenant=ridge+line&dryRun=true&n=2');
  });
});

describe('apiRequest', () => {
  it('sends JSON bodies with a content type and parses JSON replies', async () => {
    const calls: Call[] = [];
    restore = setFetcher(recordingFetcher(calls, 200, { ok: true, n: 3 }));
    const reply = await apiRequest<{ n: number }>('POST', '/api/thing', { body: { a: 1 } });
    expect(reply.n).toBe(3);
    expect(calls[0]).toEqual({ url: '/api/thing', method: 'POST', body: { a: 1 }, contentType: 'application/json' });
  });

  it('sends no body or content type when there is none', async () => {
    const calls: Call[] = [];
    restore = setFetcher(recordingFetcher(calls));
    await apiRequest('POST', '/api/abort');
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].contentType).toBeNull();
  });

  it('throws ApiError with status and payload on a non-2xx reply', async () => {
    restore = setFetcher(recordingFetcher([], 400, { ok: false, error: 'bad' }));
    const err = await apiRequest('GET', '/api/tenants').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).payload).toEqual({ ok: false, error: 'bad' });
  });

  it('returns text when the reply is not JSON', async () => {
    restore = setFetcher(recordingFetcher([], 200, 'plain text'));
    expect(await apiRequest('GET', '/api/browse-file', { query: { path: 'x' } })).toBe('plain text');
  });
});

describe('stamperApi (request shapes the route handlers read)', () => {
  it('maps each call to its method, path, query and body', async () => {
    const calls: Call[] = [];
    restore = setFetcher(recordingFetcher(calls));
    await stamperApi.health();
    await stamperApi.listTenants();
    await stamperApi.getTenant('s1-mach');
    await stamperApi.getAssessState('s1-mach');
    await stamperApi.computeGaps('s1-mach');
    await stamperApi.lastTranslate('s1-mach');
    await stamperApi.translate({ missionPlan: 'mp.json', manifest: 'tm.json', tenant: 's1-mach' });
    await stamperApi.approve({ taskId: 'T1', decision: 'approve' });
    await stamperApi.abort();
    await stamperApi.evidenceContent('s1-mach', 'E1');
    await stamperApi.putRegistryEntry('m365', 'AC.L2-3.1.1', { id: 'x' });
    await stamperApi.browseCleanup('*.json', 's1-mach');
    await stamperApi.validateVariables('s1-mach');
    await stamperApi.planDataPaths();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /health',
      'GET /api/tenants',
      'GET /api/tenants/s1-mach',
      'GET /api/assess-state?tenant=s1-mach',
      'GET /api/compute-gaps?tenant=s1-mach',
      'GET /api/last-translate?tenant=s1-mach',
      'POST /api/translate',
      'POST /api/approve',
      'POST /api/abort',
      'GET /api/evidence-content?tenant=s1-mach&entryId=E1',
      'PUT /api/registry/m365/AC.L2-3.1.1',
      'DELETE /api/browse-cleanup?tenant=s1-mach&pattern=*.json',
      'POST /api/validate-variables',
      'GET /api/plan-data-paths',
    ]);
    expect(calls[6].body).toEqual({ missionPlan: 'mp.json', manifest: 'tm.json', tenant: 's1-mach' });
    expect(calls[7].body).toEqual({ taskId: 'T1', decision: 'approve' });
    expect(calls[12].body).toEqual({ tenant: 's1-mach' });
  });

  it('every client entry is a function', () => {
    for (const [name, fn] of Object.entries(stamperApi)) expect(typeof fn, name).toBe('function');
  });
});

describe('stamperStreams (SSE URLs)', () => {
  it('builds the stream URLs with the handler query keys', () => {
    expect(stamperStreams.connect('s1-mach')).toBe('/api/connect?tenant=s1-mach');
    expect(stamperStreams.installPrereq('ExchangeOnlineManagement')).toBe('/api/prereqs/install?module=ExchangeOnlineManagement');
    expect(stamperStreams.baseline('s1-mach', 'strict')).toBe('/api/baseline?tenant=s1-mach&posture=strict');
    expect(stamperStreams.preflight('s1-mach')).toBe('/api/preflight?tenant=s1-mach');
    expect(stamperStreams.assess({ tenant: 's1-mach', verbose: false })).toBe('/api/assess?tenant=s1-mach&verbose=false');
    expect(stamperStreams.execute({ plan: 'ep.json', mode: 'auto', tenant: 's1-mach' })).toBe(
      '/api/execute?plan=ep.json&mode=auto&tenant=s1-mach',
    );
  });
});
