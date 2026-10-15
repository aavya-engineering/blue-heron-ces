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
import { EcEvidenceReader, ecItemsToSources, ecItemIdsByControl } from '../../../src/eo/evidence/EcEvidenceReader';

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
