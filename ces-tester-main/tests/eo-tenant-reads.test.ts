// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FX-TE5 — the EO reads outside the show ops (the demo:e2e EO beat and the
 * headless EO leg) carry the tenant they just assessed.
 *
 * ces-eo FX-EO8 (a44f6b4) made every route tenant-scoped: no `?tenant=` is a
 * 400, an unknown tenant is a 404, and there is no default fallback
 * (REQ-ces-tester-eo-tenant-on-assessment-reads). The fake server below
 * enforces exactly that, and the tests use a slug that is NOT the fixture
 * default `demo-dib-small`, so a hard-coded fallback cannot pass.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { fetchControl } from '../src/demo/eo-leg.js';
import { readEoBeatApi } from '../src/demo/e2e-run.js';
import { DEMO_MFA_CONTROL_ID } from '../src/demo/needle-run.js';

const TENANT = 'acme-dib-large';

interface FakeEo {
  readonly port: number;
  readonly baseUrl: string;
  readonly urls: string[];
  close(): Promise<void>;
}

async function fakeEo(tenant: string): Promise<FakeEo> {
  const urls: string[] = [];
  const server = http.createServer((req, res) => {
    urls.push(req.url ?? '');
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const asked = u.searchParams.get('tenant');
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!asked) return send(400, { error: 'tenant required' });
    if (asked !== tenant) return send(404, { error: `unknown tenant ${asked}` });
    if (u.pathname === '/api/assessment') {
      return send(200, { controls_met: 57, controls_not_met: 12, liveAssessmentCount: 3 });
    }
    if (u.pathname === '/api/sprs') return send(200, { score: -38 });
    if (u.pathname.startsWith('/api/controls/')) {
      const id = decodeURIComponent(u.pathname.slice('/api/controls/'.length));
      return send(200, { control_id: id, status: 'not_met', nist_ref: '3.5.3' });
    }
    return send(404, { error: 'no route' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    urls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let open: FakeEo | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe('eo-leg fetchControl (FX-TE5)', () => {
  it('sends the assessed tenant and gets the control back', async () => {
    open = await fakeEo(TENANT);
    const detail = await fetchControl(open.port, 'IA.L2-3.5.3', TENANT);
    expect(detail).toEqual({ controlId: 'IA.L2-3.5.3', status: 'not_met', nistRef: '3.5.3' });
    expect(open.urls).toEqual([`/api/controls/IA.L2-3.5.3?tenant=${TENANT}`]);
  });

  it('gets nothing for another tenant, and never sends a tenantless read', async () => {
    open = await fakeEo(TENANT);
    expect(await fetchControl(open.port, 'IA.L2-3.5.3', 'demo-dib-small')).toBeUndefined();
    // Blank tenant: the URL builder refuses, the best-effort read swallows it,
    // and no request reaches EO at all.
    expect(await fetchControl(open.port, 'IA.L2-3.5.3', '')).toBeUndefined();
    expect(open.urls).toEqual(['/api/controls/IA.L2-3.5.3?tenant=demo-dib-small']);
  });
});

describe('e2e-run readEoBeatApi (FX-TE5)', () => {
  it('reads assessment, SPRS and the MFA control for the beat tenant', async () => {
    open = await fakeEo(TENANT);
    const r = await readEoBeatApi(open.baseUrl, TENANT);
    expect(r.summary).toMatchObject({ controlsMet: 57, controlsNotMet: 12, liveAssessmentCount: 3 });
    expect(r.sprsScore).toBe(-38);
    expect(r.mfaControl).toMatchObject({ controlId: DEMO_MFA_CONTROL_ID, status: 'not_met' });
    const q = `?tenant=${TENANT}`;
    expect(open.urls.sort()).toEqual(
      [`/api/assessment${q}`, `/api/controls/${encodeURIComponent(DEMO_MFA_CONTROL_ID)}${q}`, `/api/sprs${q}`].sort(),
    );
  });

  it('fails the beat read for a tenant EO does not know (no silent fallback)', async () => {
    open = await fakeEo(TENANT);
    await expect(readEoBeatApi(open.baseUrl, 'demo-dib-small')).rejects.toThrow(/404/);
    await expect(readEoBeatApi(open.baseUrl, '')).rejects.toThrow(/requires a tenant/);
  });
});
