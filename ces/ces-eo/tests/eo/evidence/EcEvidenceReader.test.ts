// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-F (M4a) — EcEvidenceReader is EO's read-side HTTP client for the standalone EC
 * service. Drives it against a small fake EC (an in-process express app on an ephemeral
 * port, per the tool-boundary rule: EO never links against EC's code), covering the
 * REQ-ces-eo-ec-wiring contract: bearer auth, tenant/controlId filtering, strict-contract
 * exclusion of a malformed row, and "never throws" on an unreachable EC or an unset secret.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { EC_CONTRACT_VERSION, type EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EcEvidenceReader, EcUnavailableError, ecItemsToSources, ecItemIdsByControl, fetchFailureReason, isStaleSocketFailure } from '../../../src/eo/evidence/EcEvidenceReader';

const SECRET = 'test-secret-123';

function validItem(overrides: Partial<EcEvidenceItem> = {}): EcEvidenceItem {
  return {
    contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
    itemId: 'eci-item-1',
    tenantSlug: 'acme-sim',
    controlIds: ['AC.L1-3.1.1'],
    source: 'manual_upload',
    filename: 'roster.pdf',
    mediaType: 'application/pdf',
    sha256: 'b'.repeat(64),
    sizeBytes: 512,
    collectedAt: '2026-09-28T00:00:00.000Z',
    submittedByRole: 'compliance_officer',
    mode: 'sim',
    ...overrides,
  };
}

interface FakeEc {
  server: Server;
  url: string;
  receivedAuth: string[];
  receivedQueries: Array<Record<string, unknown>>;
}

function startFakeEc(items: unknown[], contentByItemId: Record<string, { body: Buffer; contentType: string; sha256: string }> = {}): Promise<FakeEc> {
  const app = express();
  const receivedAuth: string[] = [];
  const receivedQueries: Array<Record<string, unknown>> = [];

  app.get('/api/items', (req, res) => {
    receivedAuth.push(req.headers.authorization ?? '');
    receivedQueries.push({ ...req.query });
    if (req.headers.authorization !== `Bearer ${SECRET}`) { res.status(401).json({ error: 'unauthorized' }); return; }
    const controlId = typeof req.query.controlId === 'string' ? req.query.controlId : undefined;
    let out = items as EcEvidenceItem[];
    if (controlId) out = out.filter(i => i.controlIds?.includes(controlId));
    res.json(out);
  });

  app.get('/api/items/:itemId/content', (req, res) => {
    receivedAuth.push(req.headers.authorization ?? '');
    if (req.headers.authorization !== `Bearer ${SECRET}`) { res.status(401).json({ error: 'unauthorized' }); return; }
    const found = contentByItemId[req.params.itemId];
    if (!found) { res.status(404).json({ error: 'not_found' }); return; }
    res.setHeader('Content-Type', found.contentType);
    res.setHeader('X-EC-Sha256', found.sha256);
    res.send(found.body);
  });

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, receivedAuth, receivedQueries });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('EcEvidenceReader.readItems', () => {
  let fake: FakeEc;

  afterEach(async () => {
    if (fake) await closeServer(fake.server);
  });

  it('returns [] without a secret configured (never sends an open request)', async () => {
    fake = await startFakeEc([validItem()]);
    const reader = new EcEvidenceReader({ ecUrl: fake.url }); // no secret
    const items = await reader.readItems('acme-sim');
    expect(items).toEqual([]);
    expect(fake.receivedAuth).toEqual([]); // no request was made at all
  });

  it('EVC.5: keeps an item carrying the four catalog fields; still excludes a verdict row', async () => {
    const tagged = validItem({ form_id: 'access_control_policy', emx_ids: ['EMX-IAM-004'], form_id_matched_by: 'form_id', catalog: 'validated' });
    fake = await startFakeEc([tagged, { ...validItem({ itemId: 'eci-bad' }), verdict: 'SAT' }]);
    const items = await new EcEvidenceReader({ ecUrl: fake.url, secret: SECRET }).readItems('acme-sim');
    expect(items).toEqual([tagged]);
  });

  it('returns parsed items with the bearer attached', async () => {
    fake = await startFakeEc([validItem()]);
    const reader = new EcEvidenceReader({ ecUrl: fake.url, secret: SECRET });
    const items = await reader.readItems('acme-sim');
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe('eci-item-1');
    expect(fake.receivedAuth).toEqual([`Bearer ${SECRET}`]);
  });

  it('forwards tenant and controlId as query params', async () => {
    fake = await startFakeEc([validItem(), validItem({ itemId: 'eci-item-2', controlIds: ['SC.L1-3.13.1'] })]);
    const reader = new EcEvidenceReader({ ecUrl: fake.url, secret: SECRET });
    const items = await reader.readItems('acme-sim', 'SC.L1-3.13.1');
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe('eci-item-2');
    expect(fake.receivedQueries[0]).toMatchObject({ tenant: 'acme-sim', controlId: 'SC.L1-3.13.1' });
  });

  it('excludes a row that fails the strict contract parse (e.g. carries a verdict) and logs a warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fake = await startFakeEc([validItem(), { ...validItem({ itemId: 'eci-bad' }), verdict: 'SAT' }]);
    const reader = new EcEvidenceReader({ ecUrl: fake.url, secret: SECRET });
    const items = await reader.readItems('acme-sim');
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe('eci-item-1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns [] on an empty store', async () => {
    fake = await startFakeEc([]);
    const reader = new EcEvidenceReader({ ecUrl: fake.url, secret: SECRET });
    expect(await reader.readItems('acme-sim')).toEqual([]);
  });

  it('never throws when EC is unreachable (closed port)', async () => {
    const reader = new EcEvidenceReader({ ecUrl: 'http://127.0.0.1:1', secret: SECRET, timeoutMs: 500 });
    await expect(reader.readItems('acme-sim')).resolves.toEqual([]);
  });
});

describe('EcEvidenceReader.readItemsOrThrow (R-F1: an unreadable list fails, it never looks empty)', () => {
  let fake: FakeEc | undefined;
  afterEach(async () => { if (fake) await closeServer(fake.server); fake = undefined; });

  it('throws EcUnavailableError when EC is unreachable', async () => {
    const reader = new EcEvidenceReader({ ecUrl: 'http://127.0.0.1:1', secret: SECRET, timeoutMs: 500 });
    await expect(reader.readItemsOrThrow('acme-sim')).rejects.toBeInstanceOf(EcUnavailableError);
  });

  it('throws on a non-2xx answer (wrong secret -> 401), where readItems returns []', async () => {
    fake = await startFakeEc([validItem()]);
    const reader = new EcEvidenceReader({ ecUrl: fake.url, secret: 'wrong' });
    await expect(reader.readItemsOrThrow('acme-sim')).rejects.toThrow(/HTTP 401/);
    await expect(reader.readItems('acme-sim')).resolves.toEqual([]);
  });

  it('throws on a timeout and says so', async () => {
    const app = express();
    app.get('/api/items', () => { /* never answers */ });
    const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const reader = new EcEvidenceReader({ ecUrl: url, secret: SECRET, timeoutMs: 200 });
      await expect(reader.readItemsOrThrow('acme-sim')).rejects.toThrow(/no answer within 200 ms/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('returns items, or [] for a genuinely empty store or no secret', async () => {
    fake = await startFakeEc([validItem()]);
    expect(await new EcEvidenceReader({ ecUrl: fake.url, secret: SECRET }).readItemsOrThrow('acme-sim')).toHaveLength(1);
    expect(await new EcEvidenceReader({ ecUrl: fake.url }).readItemsOrThrow('acme-sim')).toEqual([]);
  });
});

/**
 * PH-11 (R-F5 / R-F8 S1 + S2 E7 "fetch failed"): fetch puts the reason in `cause`; the reader names it. The reproduced
 * cause (a kept-alive socket EC closed while EO's loop was blocked: ECONNRESET; ph11-c11-then-ec-read.test.ts) is
 * retried once; nothing else is.
 */
describe('EcEvidenceReader: a failed fetch names its cause; a stale socket is retried once (PH-11)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const fetchFailed = (code: string, message: string): TypeError =>
    Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) });
  const okList = (): Response => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

  it('ECONNREFUSED (EC is down): one call, never retried, the reason carries the cause', async () => {
    let n = 0;
    global.fetch = (async () => { n++; throw fetchFailed('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:4999'); }) as typeof fetch;
    const reader = new EcEvidenceReader({ ecUrl: 'http://127.0.0.1:4999', secret: SECRET });
    await expect(reader.readItemsOrThrow('acme-sim')).rejects.toThrow('EC item list unavailable: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:4999)');
    expect(n).toBe(1);
  });

  it.each([['ECONNRESET', 'read ECONNRESET'], ['EPIPE', 'write EPIPE'], ['UND_ERR_SOCKET', 'other side closed']])(
    '%s (stale socket): retried once, then answers', async (code, message) => {
      let n = 0;
      global.fetch = (async () => { n++; if (n === 1) throw fetchFailed(code, message); return okList(); }) as typeof fetch;
      const reader = new EcEvidenceReader({ ecUrl: 'http://127.0.0.1:4999', secret: SECRET });
      await expect(reader.readItemsOrThrow('acme-sim')).resolves.toEqual([]);
      expect(n).toBe(2);
    });

  it('a second stale-socket failure fails the read (bounded: one retry) and names the cause', async () => {
    let n = 0;
    global.fetch = (async () => { n++; throw fetchFailed('ECONNRESET', 'read ECONNRESET'); }) as typeof fetch;
    const reader = new EcEvidenceReader({ ecUrl: 'http://127.0.0.1:4999', secret: SECRET });
    await expect(reader.readItemsOrThrow('acme-sim')).rejects.toThrow('EC item list unavailable: fetch failed (ECONNRESET: read ECONNRESET)');
    expect(n).toBe(2);
  });

  it('an HTTP error answer is never retried', async () => {
    let n = 0;
    global.fetch = (async () => { n++; return new Response('{}', { status: 500 }); }) as typeof fetch;
    const reader = new EcEvidenceReader({ ecUrl: 'http://127.0.0.1:4999', secret: SECRET });
    await expect(reader.readItemsOrThrow('acme-sim')).rejects.toThrow(/HTTP 500/);
    expect(n).toBe(1);
  });

  it('isStaleSocketFailure: only the reset / broken-pipe / closed-socket codes', () => {
    expect(isStaleSocketFailure(fetchFailed('ECONNRESET', 'x'))).toBe(true);
    expect(isStaleSocketFailure(fetchFailed('ECONNREFUSED', 'x'))).toBe(false);
    expect(isStaleSocketFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false);
    expect(isStaleSocketFailure(new TypeError('fetch failed'))).toBe(false);
  });

  it('a real refused connection names ECONNREFUSED', async () => {
    const probe = await new Promise<Server>(resolve => { const s = express().listen(0, '127.0.0.1', () => resolve(s)); });
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>(resolve => probe.close(() => resolve())); // the port is free now: a connect is refused
    const reader = new EcEvidenceReader({ ecUrl: `http://127.0.0.1:${port}`, secret: SECRET, timeoutMs: 2000 });
    await expect(reader.readItemsOrThrow('acme-sim')).rejects.toThrow(/fetch failed \(ECONNREFUSED: /);
  });

  it('fetchFailureReason: no cause keeps the message; a cause without a message gives its code', () => {
    expect(fetchFailureReason(new TypeError('fetch failed'))).toBe('fetch failed');
    expect(fetchFailureReason(Object.assign(new TypeError('fetch failed'), { cause: { code: 'EPIPE' } }))).toBe('fetch failed (EPIPE)');
    expect(fetchFailureReason('plain')).toBe('plain');
  });
});

describe('EcEvidenceReader.readItemContent', () => {
  let fake: FakeEc;
  afterEach(async () => { if (fake) await closeServer(fake.server); });

  it('returns bytes, content-type and sha256 header', async () => {
    const body = Buffer.from('hello evidence');
    fake = await startFakeEc([], { 'eci-item-1': { body, contentType: 'text/plain', sha256: 'deadbeef' } });
    const reader = new EcEvidenceReader({ ecUrl: fake.url, secret: SECRET });
    const content = await reader.readItemContent('acme-sim', 'eci-item-1');
    expect(content).not.toBeNull();
    expect(content!.buffer.toString('utf-8')).toBe('hello evidence');
    expect(content!.contentType).toBe('text/plain');
    expect(content!.sha256).toBe('deadbeef');
  });

  it('returns null for an unknown item (404)', async () => {
    fake = await startFakeEc([]);
    const reader = new EcEvidenceReader({ ecUrl: fake.url, secret: SECRET });
    expect(await reader.readItemContent('acme-sim', 'no-such-item')).toBeNull();
  });

  it('returns null without a secret configured', async () => {
    fake = await startFakeEc([], { 'eci-item-1': { body: Buffer.from('x'), contentType: 'text/plain', sha256: 'x' } });
    const reader = new EcEvidenceReader({ ecUrl: fake.url });
    expect(await reader.readItemContent('acme-sim', 'eci-item-1')).toBeNull();
  });
});

describe('ecItemsToSources / ecItemIdsByControl', () => {
  it('maps items to per-control AssessmentSources with result:no_query (never verdict-positive)', () => {
    const sources = ecItemsToSources([validItem({ controlIds: ['AC.L1-3.1.1', 'SC.L1-3.13.1'] })]);
    expect(sources.get('AC.L1-3.1.1')?.[0]).toMatchObject({ type: 'ec_capture', result: 'no_query' });
    expect(sources.get('SC.L1-3.13.1')?.[0]).toMatchObject({ type: 'ec_capture', result: 'no_query' });
  });

  it('maps items to per-control ids', () => {
    const ids = ecItemIdsByControl([validItem({ itemId: 'eci-xyz', controlIds: ['AC.L1-3.1.1'] })]);
    expect(ids.get('AC.L1-3.1.1')).toEqual(['eci-xyz']);
  });
});
