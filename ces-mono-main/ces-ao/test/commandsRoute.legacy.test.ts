// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AO-22 (2026-09-27, FC-AO): the legacy `POST /api/commands/:id/execute` route used to
// return 200 {status:'queued', message:'Execution not implemented'} for any registered
// command id — looked like success, did nothing. Founder default (2026-09-27): retire
// it with a 410 that points callers at the real route (`POST /api/execute/:commandId`).
//
// This test calls the production router (`createCommandsRouter`) on a real loopback
// server — no mocks, no tenant/session machinery needed since the route never reached
// execution even before this fix.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createCommandsRouter } from '../src/server/routes/commands.routes.js';
import { makeAoCommand } from './fixtures.js';

const REGISTRY = [makeAoCommand({ id: 'A-01', domain: 'A', domainName: 'Identity & Access Management' })];

let server: Server;
let base: string;

beforeEach(async () => {
  const app = express();
  app.use(express.json());
  app.use(createCommandsRouter(REGISTRY));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('AO-22: legacy POST /api/commands/:id/execute is gone', () => {
  it('returns 410 with a pointer to the real execute route, for a registered command id', async () => {
    const res = await fetch(`${base}/api/commands/A-01/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body: any = await res.json();

    expect(res.status).toBe(410);
    expect(body).toEqual({ error: 'gone: use POST /api/execute/:commandId' });
  });

  it('still returns 410 for an unregistered id (the route is gone outright, not id-gated)', async () => {
    const res = await fetch(`${base}/api/commands/NOT-A-REAL-ID/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(410);
  });

  it('does NOT leave the old 200 queued/not-implemented shape reachable', async () => {
    const res = await fetch(`${base}/api/commands/A-01/execute`, { method: 'POST' });
    expect(res.status).not.toBe(200);
    const body: any = await res.json();
    expect(body.status).not.toBe('queued');
  });
});
