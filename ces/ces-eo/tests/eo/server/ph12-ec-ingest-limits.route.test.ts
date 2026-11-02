// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-12 (LOG-PH5-EO.md open item 6): EO's EC upload proxy answers a refused upload with JSON
 * (413 over the size cap, 400 for any other multer refusal), never Express's 500 HTML page, and
 * nothing reaches EC. Real router over listen(0), a fake EC on its own random port.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import multer from 'multer';
import { createEcRouter } from '../../../src/eo/server/routers/ec-router';

const listen = (app: express.Express): Promise<Server> =>
  new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const close = (s: Server): Promise<void> => new Promise((resolve) => s.close(() => resolve()));
const urlOf = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

describe('POST /api/ec/ingest: refused uploads answer JSON (PH-12)', () => {
  let ec: Server;
  let eo: Server;
  let ecCalls = 0;
  const fields = { tenantSlug: 'acme-sim', controlIds: 'AT.L2-3.2.1', source: 'manual_upload', submittedByRole: 'compliance_officer' };
  const form = (bytes: number, field = 'file') => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set(field, new Blob([Buffer.alloc(bytes, 0x61)], { type: 'application/pdf' }), 'doc.pdf');
    return fd;
  };

  beforeEach(async () => {
    ecCalls = 0;
    const fake = express();
    fake.use(express.json({ limit: '20mb' }));
    fake.post('/api/ingest', (_req, res) => { ecCalls += 1; res.status(201).json({ id: 'eci-1', uploadedBy: null }); });
    ec = await listen(fake);
    const app = express();
    app.use(createEcRouter({ ecUrl: urlOf(ec), secret: 's', upload: multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 } }), timeoutMs: 2000 }));
    eo = await listen(app);
  });
  afterEach(async () => { await close(eo); await close(ec); });

  it('413 JSON over the size cap; EC is not called', async () => {
    const res = await fetch(`${urlOf(eo)}/api/ec/ingest`, { method: 'POST', body: form(4096) });
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).error).toBe('file_too_large');
    expect(ecCalls).toBe(0);
  });

  it('400 JSON for another multer refusal (unexpected file field); EC is not called', async () => {
    const res = await fetch(`${urlOf(eo)}/api/ec/ingest`, { method: 'POST', body: form(10, 'other') });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).error).toBe('invalid_upload');
    expect(ecCalls).toBe(0);
  });

  it('an upload within the cap still reaches EC (201)', async () => {
    const res = await fetch(`${urlOf(eo)}/api/ec/ingest`, { method: 'POST', body: form(100) });
    expect(res.status).toBe(201);
    expect(ecCalls).toBe(1);
  });
});
