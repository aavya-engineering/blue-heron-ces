// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// M2 acceptance: health, authenticated ingest, run/finding/item lists, tenant scoping,
// sim rail. Every test calls production code (createApp over real HTTP on 127.0.0.1:0).

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EcEvidenceItemSchema,
  EcFindingSchema,
  EcHealthSchema,
  EcLedgerEntrySchema,
  EcRunSchema,
} from 'ces-shared/types/evidence-collector';

import { tokensMatch } from '../src/auth.js';
import { readRefusals } from '../src/simRail.js';
import {
  SECRET,
  auth,
  ecTenantDir,
  ingestBody,
  makeSandbox,
  registerTenant,
  startApp,
  type Running,
  type Sandbox,
} from './helpers.js';

let sb: Sandbox;
let ec: Running;

beforeEach(async () => {
  sb = makeSandbox();
  registerTenant(sb, 'ec-sim-a', 'sim');
  registerTenant(sb, 'ec-sim-b', 'sim');
  registerTenant(sb, 'ec-live-a', 'live');
  ec = await startApp({ resolveTenant: sb.resolver });
});

afterEach(async () => {
  await ec.close();
  sb.restore();
});

async function ingest(slug: string, content: Buffer | string, extra: Record<string, unknown> = {}, token = SECRET) {
  return fetch(`${ec.base}/api/ingest`, { method: 'POST', headers: auth(token), body: ingestBody(slug, content, extra) });
}

describe('GET /api/health', () => {
  it('returns a contract-valid EcHealth with mode sim by default', async () => {
    const res = await fetch(`${ec.base}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const h = EcHealthSchema.parse(body);
    expect(h.status).toBe('ok');
    expect(h.mode).toBe('sim');
    expect(body.contractVersion).toBe('1.0.0');
  });

  it('is degraded (still 200, for the launcher) when EVIDENCE_OPS_SECRET is unset', async () => {
    delete process.env.EVIDENCE_OPS_SECRET;
    const res = await fetch(`${ec.base}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.reasons.join(' ')).toMatch(/EVIDENCE_OPS_SECRET/);
  });
});

describe('auth on POST /api/ingest', () => {
  it('wrong token -> 401 and nothing written', async () => {
    const res = await ingest('ec-sim-a', 'x', {}, 'not-the-secret');
    expect(res.status).toBe(401);
    expect(fs.existsSync(path.join(ecTenantDir(sb, 'ec-sim-a'), 'items'))).toBe(false);
  });

  it('a different-length token is a 401, not a timingSafeEqual throw (500)', async () => {
    expect((await ingest('ec-sim-a', 'x', {}, 'a')).status).toBe(401);
    expect((await ingest('ec-sim-a', 'x', {}, SECRET + SECRET + 'longer')).status).toBe(401);
  });

  it('missing Authorization header -> 401', async () => {
    const res = await fetch(`${ec.base}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ingestBody('ec-sim-a', 'x'),
    });
    expect(res.status).toBe(401);
  });

  it('unset secret -> 503 (fail closed, never an open write endpoint)', async () => {
    delete process.env.EVIDENCE_OPS_SECRET;
    const res = await ingest('ec-sim-a', 'x', {}, 'anything');
    expect(res.status).toBe(503);
  });

  it('tokensMatch compares via equal-length digests (constant-time path)', () => {
    expect(tokensMatch(SECRET, SECRET)).toBe(true);
    expect(tokensMatch('short', SECRET)).toBe(false);
    expect(tokensMatch('', SECRET)).toBe(false);
  });
});

describe('POST /api/ingest (sim tenant)', () => {
  it('stores the item; recorded and ledgered sha256 match the content', async () => {
    const content = crypto.randomBytes(2048);
    const expected = crypto.createHash('sha256').update(content).digest('hex');
    const res = await ingest('ec-sim-a', content, { controlIds: ['PE.L1-3.10.1', 'PE.L1-3.10.3'] });
    expect(res.status).toBe(201);
    const item = EcEvidenceItemSchema.parse(await res.json());
    expect(item.sha256).toBe(expected);
    expect(item.sizeBytes).toBe(2048);
    expect(item.mode).toBe('sim');
    expect(item.tenantSlug).toBe('ec-sim-a');

    const dir = path.join(ecTenantDir(sb, 'ec-sim-a'), 'items');
    const bin = fs.readFileSync(path.join(dir, `${item.itemId}.bin`));
    expect(bin.equals(content)).toBe(true);
    const meta = EcEvidenceItemSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, `${item.itemId}.json`), 'utf-8')));
    expect(meta.sha256).toBe(expected);

    const ledger = fs
      .readFileSync(path.join(ecTenantDir(sb, 'ec-sim-a'), 'ledger.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => EcLedgerEntrySchema.parse(JSON.parse(l)));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ tenantSlug: 'ec-sim-a', origin: 'ec', path: `items/${item.itemId}.bin`, sha256: expected });
  });

  it('never uses the client filename as a storage path', async () => {
    const res = await ingest('ec-sim-a', 'evil', { filename: '../../../escape.txt' });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.filename).toBe('escape.txt');
    expect(fs.existsSync(path.join(sb.pipelineRoot, 'EvidenceCollector', 'escape.txt'))).toBe(false);
    expect(fs.readdirSync(path.join(ecTenantDir(sb, 'ec-sim-a'), 'items')).every((n) => n.startsWith('eci-'))).toBe(true);
  });

  it('a body carrying a verdict (or dryRun) key is rejected 400 — EC assigns no verdicts', async () => {
    expect((await ingest('ec-sim-a', 'x', { verdict: 'SAT' })).status).toBe(400);
    expect((await ingest('ec-sim-a', 'x', { dryRun: true })).status).toBe(400);
    expect(fs.existsSync(path.join(ecTenantDir(sb, 'ec-sim-a'), 'items'))).toBe(false);
  });

  it('missing controlIds / empty controlIds / bad source / bad base64 -> 400', async () => {
    expect((await ingest('ec-sim-a', 'x', { controlIds: [] })).status).toBe(400);
    expect((await ingest('ec-sim-a', 'x', { controlIds: undefined })).status).toBe(400);
    expect((await ingest('ec-sim-a', 'x', { source: 'stamper' })).status).toBe(400);
    expect((await ingest('ec-sim-a', 'x', { contentBase64: 'not base64!!' })).status).toBe(400);
  });

  it('content over 10 MB -> 413, nothing written', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 7);
    const res = await ingest('ec-sim-a', big);
    expect(res.status).toBe(413);
    expect(fs.existsSync(path.join(ecTenantDir(sb, 'ec-sim-a'), 'items'))).toBe(false);
  });

  it('exactly 10 MB is accepted', async () => {
    const res = await ingest('ec-sim-a', Buffer.alloc(10 * 1024 * 1024, 1));
    expect(res.status).toBe(201);
  });

  it('records a successful ingest run', async () => {
    await ingest('ec-sim-a', 'one');
    const runs = await (await fetch(`${ec.base}/api/runs?tenant=ec-sim-a`)).json();
    expect(runs).toHaveLength(1);
    const run = EcRunSchema.parse(runs[0]);
    expect(run).toMatchObject({ runType: 'ingest', status: 'success', artifactsWritten: 1 });
  });
});

describe('sim rail (CES_EC_SIM_ONLY on by default)', () => {
  it('refuses a live tenant with 403, writes nothing, and logs the refusal', async () => {
    const res = await ingest('ec-live-a', 'x');
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toMatch(/CES_EC_SIM_ONLY/);
    expect(fs.existsSync(ecTenantDir(sb, 'ec-live-a'))).toBe(false);
    const refusals = readRefusals();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ tenantSlug: 'ec-live-a', operation: 'ingest' });
  });

  it('refuses an unregistered tenant even with the rail off', async () => {
    process.env.CES_EC_SIM_ONLY = '0';
    const res = await ingest('ec-nobody', 'x');
    expect(res.status).toBe(403);
    expect(readRefusals().map((r) => r.tenantSlug)).toContain('ec-nobody');
  });

  it('refuses a sim-kind record whose endpoint is not loopback', async () => {
    registerTenant(sb, 'ec-sim-leaky', 'sim', 'https://graph.example.invalid/v1.0');
    const res = await ingest('ec-sim-leaky', 'x');
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toMatch(/non-loopback/);
  });

  it('refuses a live tenant on every tenant-scoped route', async () => {
    for (const [method, url] of [
      ['GET', '/api/runs?tenant=ec-live-a'],
      ['GET', '/api/findings?tenant=ec-live-a'],
      ['GET', '/api/items?tenant=ec-live-a'],
      ['POST', '/api/index?tenant=ec-live-a'],
    ] as const) {
      const res = await fetch(`${ec.base}${url}`, { method, headers: auth() });
      expect(res.status, `${method} ${url}`).toBe(403);
    }
    expect(readRefusals()).toHaveLength(4);
  });

  it('CES_EC_SIM_ONLY=0 admits a registered live tenant and reports mode live', async () => {
    process.env.CES_EC_SIM_ONLY = '0';
    const res = await ingest('ec-live-a', 'x');
    expect(res.status).toBe(201);
    expect((await res.json()).mode).toBe('live');
    expect((await (await fetch(`${ec.base}/api/health`)).json()).mode).toBe('live');
  });

  it('any value other than exactly "0" keeps the rail on', async () => {
    process.env.CES_EC_SIM_ONLY = 'false';
    expect((await ingest('ec-live-a', 'x')).status).toBe(403);
  });
});

describe('tenant scoping', () => {
  it('a traversal slug is a 400 (getEcTenantRoot throws -> bad_tenant)', async () => {
    for (const slug of ['../escape', 'a/b', '..', 'a\\b']) {
      const r1 = await ingest(slug, 'x');
      expect(r1.status, slug).toBe(400);
      const r2 = await fetch(`${ec.base}/api/runs?tenant=${encodeURIComponent(slug)}`);
      expect(r2.status, slug).toBe(400);
    }
  });

  it('items are listed only for the tenant asked for, and filter by controlId', async () => {
    await ingest('ec-sim-a', 'a1', { controlIds: ['AC.L1-3.1.1'] });
    await ingest('ec-sim-a', 'a2', { controlIds: ['PE.L1-3.10.1'] });
    await ingest('ec-sim-b', 'b1', { controlIds: ['AC.L1-3.1.1'] });
    const a = await (await fetch(`${ec.base}/api/items?tenant=ec-sim-a`, { headers: auth() })).json();
    expect(a).toHaveLength(2);
    expect(a.every((i: { tenantSlug: string }) => i.tenantSlug === 'ec-sim-a')).toBe(true);
    const filtered = await (await fetch(`${ec.base}/api/items?tenant=ec-sim-a&controlId=AC.L1-3.1.1`, { headers: auth() })).json();
    expect(filtered).toHaveLength(1);
  });

  it('GET /api/items requires the bearer and a tenant', async () => {
    expect((await fetch(`${ec.base}/api/items?tenant=ec-sim-a`)).status).toBe(401);
    expect((await fetch(`${ec.base}/api/items`, { headers: auth() })).status).toBe(400);
  });

  it('GET /api/items/:id/content returns the exact bytes; unknown or malformed id -> 404', async () => {
    const content = crypto.randomBytes(512);
    const item = await (await ingest('ec-sim-a', content)).json();
    const res = await fetch(`${ec.base}/api/items/${item.itemId}/content?tenant=ec-sim-a`, { headers: auth() });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ec-sha256')).toBe(item.sha256);
    expect(Buffer.from(await res.arrayBuffer()).equals(content)).toBe(true);
    // another tenant cannot read it
    expect((await fetch(`${ec.base}/api/items/${item.itemId}/content?tenant=ec-sim-b`, { headers: auth() })).status).toBe(404);
    expect((await fetch(`${ec.base}/api/items/..%2F..%2Fx/content?tenant=ec-sim-a`, { headers: auth() })).status).toBe(404);
  });

  it('runs/findings without ?tenant aggregate admitted tenants as plain arrays (EO page shape)', async () => {
    await ingest('ec-sim-a', 'a');
    await ingest('ec-sim-b', 'b');
    const runs = await (await fetch(`${ec.base}/api/runs`)).json();
    expect(Array.isArray(runs)).toBe(true);
    expect(new Set(runs.map((r: { tenantSlug: string }) => r.tenantSlug))).toEqual(new Set(['ec-sim-a', 'ec-sim-b']));
    const findings = await (await fetch(`${ec.base}/api/findings`)).json();
    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings) EcFindingSchema.parse(f);
  });

  it('aggregation excludes a stored tenant that the rail no longer admits', async () => {
    process.env.CES_EC_SIM_ONLY = '0';
    await ingest('ec-live-a', 'x');
    await ingest('ec-sim-a', 'y');
    process.env.CES_EC_SIM_ONLY = '1';
    const runs = await (await fetch(`${ec.base}/api/runs`)).json();
    expect(runs.map((r: { tenantSlug: string }) => r.tenantSlug)).toEqual(['ec-sim-a']);
  });
});
