// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH7-EO (LOG-PH7-SEC open item 1): EC now asks a network (non-loopback) caller for the bearer on `/api/runs` and
 * `/api/findings`. EO sends EVIDENCE_OPS_SECRET on those reads whenever one is configured: the `/api/ec/*` proxy
 * (`createEcRouter`) and the integrity read (`fetchEcOpenFindings`). With no secret configured EO sends no header,
 * as before. The fake EC below demands the bearer on every call (the cross-host case). The browser never sees it.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import multer from 'multer';
import { createEcRouter } from '../../../src/eo/server/routers/ec-router';
import { fetchEcOpenFindings } from '../../../src/eo/collect/ecIntegrity';

const SECRET = 'ph7-eo-ec-secret';
const FINDING = { findingId: 'f-1', checkId: 'HASH_DRIFT', detectedAt: 't', severity: 'high', status: 'open', tenantSlug: 'acme-sim', detail: 'x' };

interface FakeEc { server: Server; url: string; auth: Array<{ path: string; auth: string }> }

/** EC as a network caller sees it: runs and findings need `Bearer <EVIDENCE_OPS_SECRET>`, else 401. */
function startGatedEc(): Promise<FakeEc> {
  const app = express();
  const auth: FakeEc['auth'] = [];
  const gate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    auth.push({ path: req.path, auth: req.headers.authorization ?? '' });
    if (req.headers.authorization !== `Bearer ${SECRET}`) { res.status(401).json({ error: 'unauthorized' }); return; }
    next();
  };
  app.get('/api/runs', gate, (_req, res) => res.json([{ runId: 'ecr-1' }]));
  app.get('/api/findings', gate, (_req, res) => res.json([FINDING]));
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, auth }));
  });
}

async function startEo(ecUrl: string, secret?: string): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(createEcRouter({ ecUrl, secret, upload: multer({ storage: multer.memoryStorage() }), timeoutMs: 1000 }));
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const close = (s: Server) => new Promise<void>(r => s.close(() => r()));

describe('PH7-EO: EO sends EC its bearer on runs / findings when a secret is configured', () => {
  let ec: FakeEc;
  let eo: { server: Server; base: string } | undefined;
  beforeEach(async () => { ec = await startGatedEc(); });
  afterEach(async () => { if (eo) await close(eo.server); eo = undefined; await close(ec.server); });

  it('the proxy forwards the bearer on /api/ec/runs and /api/ec/findings; the browser response carries no secret', async () => {
    eo = await startEo(ec.url, SECRET);
    const runs = await fetch(`${eo.base}/api/ec/runs`);
    expect(runs.status).toBe(200);
    const findings = await fetch(`${eo.base}/api/ec/findings?tenant=acme-sim&status=open`);
    expect(findings.status).toBe(200);
    const text = await findings.text();
    expect(JSON.parse(text)).toEqual([FINDING]);
    expect(text).not.toContain(SECRET);
    expect(ec.auth.map(a => a.auth)).toEqual([`Bearer ${SECRET}`, `Bearer ${SECRET}`]);
  });

  it('with no secret configured the proxy sends no header, and EC\'s 401 is passed through', async () => {
    eo = await startEo(ec.url, undefined);
    const res = await fetch(`${eo.base}/api/ec/findings`);
    expect(res.status).toBe(401);
    expect(ec.auth).toEqual([{ path: '/api/findings', auth: '' }]);
  });

  it('fetchEcOpenFindings sends the bearer when given and reads the findings', async () => {
    expect(await fetchEcOpenFindings(ec.url, 'acme-sim', 1000, SECRET)).toEqual([FINDING]);
    expect(ec.auth).toEqual([{ path: '/api/findings', auth: `Bearer ${SECRET}` }]);
  });

  it('fetchEcOpenFindings without a secret sends no header; a 401 reads as unreachable (null), as before', async () => {
    expect(await fetchEcOpenFindings(ec.url, 'acme-sim', 1000)).toBeNull();
    expect(ec.auth).toEqual([{ path: '/api/findings', auth: '' }]);
  });
});
