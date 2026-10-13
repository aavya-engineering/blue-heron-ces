// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// delivery.portal.test.ts — GP-MUSTER-2 M2 gate: the delivery portal enforces
// docs/design/result-handling-policy.md THROUGH the full Express chain
// (operator JWT lane + grantee capability lane), not just in the service.
// Proves: per-engagement scope, named short-lived grants, token hashed at
// rest, download-only, audit on every touch, 90-day retention purge,
// close-out purge, operator-role gating.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createHash } from 'node:crypto';
import { createDeliveryRouter, createPortalRouter } from '../src/routes/delivery.js';
import {
  createDeliveryService,
  RETENTION_DAYS,
} from '../src/services/deliveryService.js';
import { mintToken } from '../src/lib/jwt.js';
import { createMockDb } from './helpers/mockDb.js';

const TENANT_A = '00000000-aaaa-0000-0000-000000000001';
const ENG_A = '00000000-0000-aaaa-0000-000000000001';
const ENG_B = '00000000-0000-bbbb-0000-000000000002';

const DAY_MS = 24 * 60 * 60 * 1000;

const RESULT_JSON = JSON.stringify({ schema_version: 'readiness-result/1.0.0', hello: 'world' });

let db: ReturnType<typeof createMockDb>;
let server: http.Server;
let base: string;

function operatorToken() {
  return mintToken({ sub: 'op-1', tenant_id: TENANT_A, party_id: null, role: 'bhd_operator' });
}
function primeToken() {
  return mintToken({ sub: 'prime-1', tenant_id: TENANT_A, party_id: null, role: 'prime' });
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  db = createMockDb();
  const app = express();
  app.use(express.json());
  app.use('/api/delivery', createDeliveryRouter(db));
  app.use('/portal', createPortalRouter(db));
  app.use((_req: express.Request, res: express.Response) =>
    res.status(404).json({ error: 'Not found' })
  );
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('operator lane gating', () => {
  it('rejects unauthenticated and non-operator callers', async () => {
    const body = JSON.stringify({
      engagement_id: ENG_A,
      kind: 'readiness_result',
      filename: 'r.json',
      content_base64: Buffer.from(RESULT_JSON).toString('base64'),
    });
    const noAuth = await fetch(`${base}/api/delivery/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(noAuth.status).toBe(401);

    const wrongRole = await fetch(`${base}/api/delivery/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(primeToken()) },
      body,
    });
    expect(wrongRole.status).toBe(403);

    const audit = await fetch(`${base}/api/delivery/audit?engagement_id=${ENG_A}`, {
      headers: bearer(primeToken()),
    });
    expect(audit.status).toBe(403);
  });
});

describe('delivery flow — policy rules through the wire', () => {
  let artifactA: string;
  let artifactB: string;
  let grantToken: string;
  let grantId: string;

  it('operator registers artifacts and issues a named grant (token visible once, hashed at rest)', async () => {
    const reg = await fetch(`${base}/api/delivery/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(operatorToken()) },
      body: JSON.stringify({
        engagement_id: ENG_A,
        kind: 'readiness_result',
        filename: 'readiness-result-party-a.json',
        content_base64: Buffer.from(RESULT_JSON).toString('base64'),
      }),
    });
    expect(reg.status).toBe(201);
    artifactA = ((await reg.json()) as { id: string }).id;

    const regB = await fetch(`${base}/api/delivery/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(operatorToken()) },
      body: JSON.stringify({
        engagement_id: ENG_B,
        kind: 'readiness_report',
        filename: 'other-engagement.pdf',
        content_base64: Buffer.from('other engagement bytes').toString('base64'),
      }),
    });
    artifactB = ((await regB.json()) as { id: string }).id;

    const issue = await fetch(`${base}/api/delivery/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(operatorToken()) },
      body: JSON.stringify({
        engagement_id: ENG_A,
        grantee_name: 'Pat Contractor',
        grantee_email: 'pat@contractor.example',
      }),
    });
    expect(issue.status).toBe(201);
    const issued = (await issue.json()) as { grant_id: string; token: string; expires_at: string };
    expect(issued.token.length).toBeGreaterThanOrEqual(40);
    grantToken = issued.token;
    grantId = issued.grant_id;

    // Token hashed at rest: the stored row carries sha256(token), never the token.
    const stored = db.deliveryGrant._records[0] as Record<string, unknown>;
    expect(stored.token_hash).toBe(createHash('sha256').update(grantToken).digest('hex'));
    expect(Object.values(stored)).not.toContain(grantToken);
    expect(stored).not.toHaveProperty('token');
  });

  it('grantee lists ONLY their engagement artifacts, metadata only', async () => {
    const res = await fetch(`${base}/portal/artifacts`, { headers: bearer(grantToken) });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    expect(list.map((a) => a.id)).toEqual([artifactA]); // ENG_B's artifact invisible
    expect(list[0]).not.toHaveProperty('content');
  });

  it('grantee pulls the bytes; the pull is audited', async () => {
    const res = await fetch(`${base}/portal/artifacts/${artifactA}`, {
      headers: bearer(grantToken),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('readiness-result-party-a.json');
    expect(Buffer.from(await res.arrayBuffer()).toString('utf8')).toBe(RESULT_JSON);

    const audit = await fetch(`${base}/api/delivery/audit?engagement_id=${ENG_A}`, {
      headers: bearer(operatorToken()),
    });
    const entries = (await audit.json()) as Array<Record<string, unknown>>;
    const pull = entries.find((e) => e.action === 'pull');
    expect(pull).toBeDefined();
    expect(pull!.artifact_id).toBe(artifactA);
    expect(pull!.actor).toBe('Pat Contractor');
  });

  it("cross-engagement pull is refused as not-found and audited as denied (rule 1: nothing browsable outside the grant's engagement)", async () => {
    const res = await fetch(`${base}/portal/artifacts/${artifactB}`, {
      headers: bearer(grantToken),
    });
    expect(res.status).toBe(404);

    const audit = await fetch(`${base}/api/delivery/audit?engagement_id=${ENG_A}`, {
      headers: bearer(operatorToken()),
    });
    const entries = (await audit.json()) as Array<Record<string, unknown>>;
    const denied = entries.find((e) => e.action === 'denied' && e.artifact_id === artifactB);
    expect(denied).toBeDefined();
    expect(denied!.outcome).toBe('out_of_scope');
  });

  it('unknown tokens get 401; the portal is download-only (no mutating routes exist)', async () => {
    const unknown = await fetch(`${base}/portal/artifacts`, {
      headers: bearer('not-a-real-token'),
    });
    expect(unknown.status).toBe(401);

    const post = await fetch(`${base}/portal/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(grantToken) },
      body: '{}',
    });
    expect(post.status).toBe(404); // no such route — nothing to mutate

    const del = await fetch(`${base}/portal/artifacts/${artifactA}`, {
      method: 'DELETE',
      headers: bearer(grantToken),
    });
    expect(del.status).toBe(404);
  });

  it('an expired grant is refused and the denial audited (rule 3: expiry ends access)', async () => {
    // Issue a grant whose clock started 100 days ago (service-level now injection).
    const svc = createDeliveryService(db);
    const old = await svc.issueGrant({
      tenant_id: TENANT_A,
      engagement_id: ENG_A,
      grantee_name: 'Old Grantee',
      grantee_email: 'old@contractor.example',
      issued_by: 'op-1',
      expires_in_days: 7,
      now: new Date(Date.now() - 100 * DAY_MS),
    });
    const res = await fetch(`${base}/portal/artifacts`, { headers: bearer(old.token) });
    expect(res.status).toBe(401);

    const trail = await svc.auditTrail({ tenant_id: TENANT_A, engagement_id: ENG_A });
    const denied = trail.find(
      (e: Record<string, unknown>) => e.action === 'denied' && e.grant_id === old.grant_id
    );
    expect(denied).toBeDefined();
    expect(denied!.outcome).toBe('expired');
  });

  it('a revoked grant is refused and the denial audited', async () => {
    const revoke = await fetch(`${base}/api/delivery/grants/${grantId}/revoke`, {
      method: 'POST',
      headers: bearer(operatorToken()),
    });
    expect(revoke.status).toBe(200);

    const res = await fetch(`${base}/portal/artifacts`, { headers: bearer(grantToken) });
    expect(res.status).toBe(401);

    const svc = createDeliveryService(db);
    const trail = await svc.auditTrail({ tenant_id: TENANT_A, engagement_id: ENG_A });
    const denied = trail.filter(
      (e: Record<string, unknown>) => e.action === 'denied' && e.grant_id === grantId
    );
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[denied.length - 1].outcome).toBe('revoked');
  });
});

describe('retention and close-out purge', () => {
  it(`purges artifacts ${RETENTION_DAYS} days after delivery: content zeroed, row + audit remain, pull denied as purged`, async () => {
    const svc = createDeliveryService(db);
    const staged = await svc.registerArtifact({
      tenant_id: TENANT_A,
      engagement_id: ENG_A,
      kind: 'readiness_report',
      filename: 'stale-report.pdf',
      content: Buffer.from('stale bytes'),
      actor: 'op-1',
      delivered_at: new Date(Date.now() - (RETENTION_DAYS + 1) * DAY_MS),
    });

    const sweep = await fetch(`${base}/api/delivery/purge-expired`, {
      method: 'POST',
      headers: bearer(operatorToken()),
    });
    expect(sweep.status).toBe(200);
    expect(((await sweep.json()) as { purged: number }).purged).toBe(1);

    const row = db.deliveryArtifact._records.find(
      (r) => (r as Record<string, unknown>).id === staged.id
    ) as Record<string, unknown>;
    expect((row.content as Buffer).length).toBe(0);
    expect(row.purged_at).toBeInstanceOf(Date);
    expect(row.purge_reason).toBe('retention');

    // A fresh valid grant still cannot pull it — purged is purged.
    const fresh = await svc.issueGrant({
      tenant_id: TENANT_A,
      engagement_id: ENG_A,
      grantee_name: 'Late Puller',
      grantee_email: 'late@contractor.example',
      issued_by: 'op-1',
    });
    const res = await fetch(`${base}/portal/artifacts/${staged.id}`, {
      headers: bearer(fresh.token),
    });
    expect(res.status).toBe(404);

    const trail = await svc.auditTrail({ tenant_id: TENANT_A, engagement_id: ENG_A });
    expect(
      trail.some(
        (e: Record<string, unknown>) =>
          e.action === 'purge' && e.artifact_id === staged.id && e.detail === 'retention'
      )
    ).toBe(true);
    expect(
      trail.some(
        (e: Record<string, unknown>) => e.action === 'denied' && e.outcome === 'purged'
      )
    ).toBe(true);
  });

  it('close-out purge takes an explicit reason and records it (rule 7)', async () => {
    const svc = createDeliveryService(db);
    await svc.registerArtifact({
      tenant_id: TENANT_A,
      engagement_id: ENG_B,
      kind: 'capture',
      filename: 'capture.json',
      content: Buffer.from('{}'),
      actor: 'op-1',
    });

    const res = await fetch(`${base}/api/delivery/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(operatorToken()) },
      body: JSON.stringify({ engagement_id: ENG_B, reason: 'customer-requested close-out' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { purged: number }).purged).toBeGreaterThanOrEqual(1);

    const trail = await svc.auditTrail({ tenant_id: TENANT_A, engagement_id: ENG_B });
    expect(
      trail.some(
        (e: Record<string, unknown>) =>
          e.action === 'purge' && e.detail === 'customer-requested close-out'
      )
    ).toBe(true);
  });
});
