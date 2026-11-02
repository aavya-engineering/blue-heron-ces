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
import { Ledger } from '../ledger/Ledger.js';
import { EvidenceHold } from './EvidenceHold.js';
import { EvidenceQuery } from './EvidenceQuery.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('EvidenceQuery', () => {
  let dir: string;
  let ledger: Ledger;
  let hold: EvidenceHold;
  let query: EvidenceQuery;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-evidencequery-'));
    ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
    hold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
    query = new EvidenceQuery(ledger, hold);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('query({objectType}) returns only snapshots served for that object type', async () => {
    await hold.record({
      objectType: 'caPolicies',
      request: { verb: 'GET' },
      response: [{ id: 'caPolicy-1' }],
      source: 'Get-MgIdentityConditionalAccessPolicy',
    });
    await hold.record({
      objectType: 'directoryAudits',
      request: { verb: 'GET' },
      response: [],
      source: 'Get-MgAuditLogDirectoryAudit',
    });

    const results = await query.query({ objectType: 'caPolicies' });
    expect(results).toHaveLength(1);
    expect(results[0].objectType).toBe('caPolicies');
    expect(results[0].response).toEqual([{ id: 'caPolicy-1' }]);
  });

  it('query({from, to}) returns only snapshots served within the time range', async () => {
    const { snapshot: first } = await hold.record({
      objectType: 'caPolicies',
      request: { verb: 'GET' },
      response: [],
      source: 'Get-MgIdentityConditionalAccessPolicy',
    });
    await sleep(10);
    const boundary = new Date().toISOString();
    await sleep(10);
    const { snapshot: second } = await hold.record({
      objectType: 'caPolicies',
      request: { verb: 'GET' },
      response: [],
      source: 'Get-MgIdentityConditionalAccessPolicy',
    });

    const before = await query.query({ to: boundary });
    expect(before.map((s) => s.requestId)).toEqual([first.requestId]);

    const after = await query.query({ from: boundary });
    expect(after.map((s) => s.requestId)).toEqual([second.requestId]);
  });

  it('query() with no filter returns every held snapshot', async () => {
    await hold.record({ objectType: 'caPolicies', request: {}, response: [], source: 'a' });
    await hold.record({ objectType: 'directoryAudits', request: {}, response: [], source: 'b' });

    const results = await query.query();
    expect(results).toHaveLength(2);
  });

  it('query() returns an empty array when nothing has been held', async () => {
    const results = await query.query({ objectType: 'caPolicies' });
    expect(results).toEqual([]);
  });
});
