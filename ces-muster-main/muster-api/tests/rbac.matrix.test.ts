// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * rbac.matrix.test.ts — ONE authorization test per role, driving the full
 * Express middleware chain (bearerAuth → requireRole → ownership guard).
 *
 * No live DB: route factories are injected with a hand-rolled in-memory mockDb.
 * Transport: native Node.js http.Server on port 0 + global fetch (Node 18+).
 * No supertest dependency required.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createEngagementsRouter } from '../src/routes/engagements.js';
import { createPartyRouter } from '../src/routes/parties.js';
import { createContractsRouter } from '../src/routes/contracts.js';
import { mintToken } from '../src/lib/jwt.js';
import { createMockDb } from './helpers/mockDb.js';

// ─── Seed data ────────────────────────────────────────────────────────────────

const TENANT_A = '00000000-aaaa-0000-0000-000000000001';
const TENANT_B = '00000000-bbbb-0000-0000-000000000002';
const ENG_A_ID = '00000000-0000-aaaa-0000-000000000001';
const ENG_B_ID = '00000000-0000-bbbb-0000-000000000002';
const PARTY_MINE = '00000000-0000-0000-aaaa-000000000001';
const PARTY_OTHER = '00000000-0000-0000-bbbb-000000000002';

const CONTRACT_BODY = {
  party_id: PARTY_MINE,
  engagement_id: ENG_A_ID,
  contract_number: 'FA8621-22-C-0001',
  program_name: 'Test Program',
  cmmc_level_required: 2,
  cui_categories: ['CTI'],
};

let db: ReturnType<typeof createMockDb>;
let server: http.Server;
let base: string;

// ─── Token factories ──────────────────────────────────────────────────────────

function primeToken() {
  return mintToken({ sub: 'user-prime', tenant_id: TENANT_A, party_id: null, role: 'prime' });
}

function subToken(partyId: string) {
  return mintToken({ sub: 'user-sub', tenant_id: TENANT_A, party_id: partyId, role: 'sub' });
}

function bhdToken() {
  return mintToken({ sub: 'user-bhd', tenant_id: TENANT_A, party_id: null, role: 'bhd_operator' });
}

function assessorToken() {
  return mintToken({ sub: 'user-assessor', tenant_id: TENANT_A, party_id: null, role: 'assessor_read_only' });
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Test app construction (no prisma import) ─────────────────────────────────

function createTestApp(mockDb: ReturnType<typeof createMockDb>) {
  const app = express();
  app.use(express.json());
  app.use('/api/engagements', createEngagementsRouter(mockDb));
  app.use('/api/parties', createPartyRouter(mockDb));
  app.use('/api/contracts', createContractsRouter(mockDb));
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found' });
  });
  return app;
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

beforeAll(async () => {
  db = createMockDb();

  // Seed: engagement in tenant-A (prime's tenant)
  await db.engagement.create({
    data: { id: ENG_A_ID, tenant_id: TENANT_A, engagement_kind: 'prime_and_subs' },
  });
  // Seed: engagement in tenant-B (different tenant — cross-tenant test)
  await db.engagement.create({
    data: { id: ENG_B_ID, tenant_id: TENANT_B, engagement_kind: 'prime_and_subs' },
  });
  // Seed: party in tenant-A owned by PARTY_OTHER (sub self-only test)
  await db.party.create({
    data: {
      id: PARTY_OTHER,
      tenant_id: TENANT_A,
      engagement_id: ENG_A_ID,
      name: 'Other Party',
      on_prem_ot: 'no',
      lifecycle: 'invited',
    },
  });

  const app = createTestApp(db);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rbac.matrix — one authorization test per role', () => {
  it('prime: roster-read GET /api/engagements is allowed (200)', async () => {
    const res = await fetch(`${base}/api/engagements`, {
      headers: authHeader(primeToken()),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    // prime sees their own tenant's engagements
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('prime: cross-tenant GET /api/engagements/:id is denied (403)', async () => {
    // ENG_B_ID belongs to TENANT_B; prime is in TENANT_A
    const res = await fetch(`${base}/api/engagements/${ENG_B_ID}`, {
      headers: authHeader(primeToken()),
    });
    expect(res.status).toBe(403);
  });

  it('sub: self-only — accessing other party returns 403', async () => {
    // sub user has party_id = PARTY_MINE (different from PARTY_OTHER in db)
    const res = await fetch(`${base}/api/parties/${PARTY_OTHER}`, {
      headers: authHeader(subToken(PARTY_MINE)),
    });
    expect(res.status).toBe(403);
  });

  it('bhd_operator: write (POST /api/contracts) is allowed (201)', async () => {
    const res = await fetch(`${base}/api/contracts`, {
      method: 'POST',
      headers: { ...authHeader(bhdToken()), 'Content-Type': 'application/json' },
      body: JSON.stringify(CONTRACT_BODY),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.contract_number).toBe(CONTRACT_BODY.contract_number);
  });

  it('assessor_read_only: mutating POST /api/contracts returns 403', async () => {
    const res = await fetch(`${base}/api/contracts`, {
      method: 'POST',
      headers: { ...authHeader(assessorToken()), 'Content-Type': 'application/json' },
      body: JSON.stringify(CONTRACT_BODY),
    });
    expect(res.status).toBe(403);
  });
});
