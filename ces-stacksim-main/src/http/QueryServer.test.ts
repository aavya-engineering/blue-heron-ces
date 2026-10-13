// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../store/ObjectStore.js';
import { Ledger } from '../ledger/Ledger.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';
import { ResolverTable } from '../resolvers/ResolverTable.js';
import { EvidenceHold } from '../evidence/EvidenceHold.js';
import { EvidenceQuery } from '../evidence/EvidenceQuery.js';
import { QueryServer } from './QueryServer.js';
import type { ResolverEntry } from '../resolvers/types.js';

describe('QueryServer', () => {
  let dir: string;
  let store: ObjectStore;
  let ledger: Ledger;
  let evidenceHold: EvidenceHold;
  let evidenceQuery: EvidenceQuery;
  let server: QueryServer;
  let baseUrl: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-queryserver-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    await store.create('caPolicies', { id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' });
    await store.create('caPolicies', { id: 'caPolicy-2', displayName: 'Sim CA Policy 2', state: 'enabled' });

    ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
    evidenceHold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
    evidenceQuery = new EvidenceQuery(ledger, evidenceHold);

    const gate = new StackShapeGate('m365_azure');
    const resolverTable = new ResolverTable(store, gate, undefined, undefined, evidenceHold);
    server = new QueryServer({ resolverTable, ledger, evidenceQuery });
    const port = await server.start(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('POST /resolve (cmdlet) returns the resolved collection', async () => {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'cmdlet', cmdlet: 'Get-MgIdentityConditionalAccessPolicy' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(2);
  });

  it('POST /resolve (uri) for an unregistered URI returns 404', async () => {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'uri', method: 'GET', uri: '/v1.0/nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('an unknown route returns 404', async () => {
    const res = await fetch(`${baseUrl}/nope`, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('a StackShapeGate-blocked resolver returns 403', async () => {
    const fullTierEntries: ResolverEntry[] = [
      {
        kind: 'cmdlet',
        cmdlet: 'Get-AzStorageAccount',
        endpoint: '/subscriptions/x/providers/Microsoft.Storage/storageAccounts',
        collection: 'storageAccounts',
        verb: 'GET',
        azureTier: 'full',
      },
    ];
    const gate = new StackShapeGate('m365_only');
    const resolverTable = new ResolverTable(store, gate, fullTierEntries);
    const gatedServer = new QueryServer({ resolverTable });
    const port = await gatedServer.start(0);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'cmdlet', cmdlet: 'Get-AzStorageAccount' }),
      });
      expect(res.status).toBe(403);
    } finally {
      await gatedServer.stop();
    }
  });

  it('POST /ledger returns matching ledger entries (M5)', async () => {
    await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'cmdlet', cmdlet: 'Get-MgIdentityConditionalAccessPolicy' }),
    });

    const res = await fetch(`${baseUrl}/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'read-serve', objectType: 'caPolicies' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ objectType: string }> };
    expect(json.data).toHaveLength(1);
    expect(json.data[0].objectType).toBe('caPolicies');
  });

  it('POST /ledger with no filter returns all ledger entries', async () => {
    const res = await fetch(`${baseUrl}/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });

  it('POST /evidence returns matching evidence snapshots (M5)', async () => {
    await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'cmdlet', cmdlet: 'Get-MgIdentityConditionalAccessPolicy' }),
    });

    const res = await fetch(`${baseUrl}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectType: 'caPolicies' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ objectType: string; response: unknown }> };
    expect(json.data).toHaveLength(1);
    expect(json.data[0].objectType).toBe('caPolicies');
    expect(json.data[0].response).toHaveLength(2);
  });

  it('POST /ledger returns 500 when the server has no ledger configured', async () => {
    const gate = new StackShapeGate('m365_azure');
    const resolverTable = new ResolverTable(store, gate);
    const bareServer = new QueryServer({ resolverTable });
    const port = await bareServer.start(0);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(500);
    } finally {
      await bareServer.stop();
    }
  });
});
