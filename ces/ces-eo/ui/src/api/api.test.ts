// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, apiEventStream, apiRequest, buildUrl, setServiceToken } from './http';
import { readClaims, sameUpn, tokenExpired, tokenUpn } from './token';
import { eoApi } from './eo';
import { fakeEo, fakeToken } from '../testUtils';
import { compositeRisk } from '../screens/risk';
import { frameToEntry } from '../screens/assess';

let eo: ReturnType<typeof fakeEo> | null = null;
afterEach(() => { eo?.restore(); eo = null; setServiceToken(null); });

describe('http', () => {
  it('buildUrl keeps key order and drops null and undefined', () => {
    expect(buildUrl('/api/x', { tenant: 'a b', n: null, u: undefined, h: 1 })).toBe('/api/x?tenant=a+b&h=1');
  });

  it('ApiError carries the server code and a readable detail', async () => {
    eo = fakeEo({ 'GET /api/x': () => ({ status: 401, body: { error: 'unauthorized', reason: 'missing_token' } }) });
    const e = (await apiRequest('GET', '/api/x').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('unauthorized');
    expect(e.detail).toBe('unauthorized: missing_token');
  });

  it('the service token rides every call; the event stream parses data frames split across chunks', async () => {
    setServiceToken('svc-2');
    const frames: unknown[] = [];
    eo = fakeEo({ 'GET /api/assess': { text: 'data: {"type":"a"}\n\nnoise\ndata: not json\ndata: {"type":"b"}' } });
    await apiEventStream('/api/assess', { tenant: 't' }, (f) => frames.push(f));
    expect(frames).toEqual([{ type: 'a' }, { type: 'b' }]);
    expect(eo.calls[0].headers.authorization).toBe('Bearer svc-2');
  });

  it('role population routes use the tenant in the path (LOG-FIN-26b)', async () => {
    eo = fakeEo({ 'PUT /api/personnel/s3-def/role-population': { tenantSlug: 's3-def', population: null } });
    await eoApi.saveRolePopulation('s3-def', []);
    expect(eo.calls[0].body).toEqual({ roles: [] });
    expect(eo.calls[0].query).toEqual({});
  });
});

describe('token claims (display only)', () => {
  it('reads upn and expiry; tolerates junk', () => {
    const t = fakeToken({ upn: 'A@x.test', exp: 10 });
    expect(readClaims(t)).toMatchObject({ upn: 'A@x.test' });
    expect(tokenUpn(`Bearer ${t}`)).toBe('A@x.test');
    expect(tokenExpired(t, 11_000)).toBe(true);
    expect(tokenExpired(t, 9_000)).toBe(false);
    expect(readClaims('nope')).toBeNull();
    expect(tokenExpired('nope')).toBe(false);
    expect(sameUpn(' a@X.test', 'A@x.test ')).toBe(true);
    expect(sameUpn(null, 'a')).toBe(false);
  });
});

describe('screen helpers', () => {
  it('compositeRisk follows the legacy NIST matrix', () => {
    expect(compositeRisk('very_low', 'very_high')).toBe('moderate');
    expect(compositeRisk('high', 'low')).toBe('moderate');
    expect(compositeRisk('very_high', 'very_high')).toBe('very_high');
    expect(compositeRisk('high', undefined)).toBeUndefined();
  });

  it('frameToEntry maps assess frames to console rows', () => {
    expect(frameToEntry({ type: 'assess_check', status: 'error', entryId: 'E', label: 'L' })).toEqual({ level: 'error', message: '[ERROR] E — L' });
    expect(frameToEntry({ type: 'assess_done' })).toBeNull();
  });
});
