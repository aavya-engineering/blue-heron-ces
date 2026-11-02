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
import { Ledger } from './Ledger.js';
import type { LedgerEntry } from './LedgerTypes.js';

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    ts: new Date().toISOString(),
    type: 'create',
    objectType: 'users',
    objectId: 'user-1',
    actor: 'stamper',
    source: 'test',
    milestone: 'M0',
    sessionType: 'graph',
    requestId: 'req-1',
    ...overrides,
  };
}

describe('Ledger', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ledger-'));
    filePath = path.join(dir, 'ledger.jsonl');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips append -> query', async () => {
    const ledger = new Ledger(filePath);
    await ledger.append(makeEntry({ objectId: 'user-1' }));
    await ledger.append(makeEntry({ objectId: 'user-2', type: 'mutate' }));

    const all = await ledger.query();
    expect(all).toHaveLength(2);
    expect(all[0].objectId).toBe('user-1');
    expect(all[1].objectId).toBe('user-2');

    const mutations = await ledger.query({ type: 'mutate' });
    expect(mutations).toHaveLength(1);
    expect(mutations[0].objectId).toBe('user-2');

    const byActor = await ledger.query({ actor: 'stamper' });
    expect(byActor).toHaveLength(2);
  });

  it('query on a ledger file that does not exist yet returns an empty array', async () => {
    const ledger = new Ledger(filePath);
    const result = await ledger.query();
    expect(result).toEqual([]);
  });

  it('resolves 50 concurrent in-process append() calls with no interleaved/corrupt lines', async () => {
    const ledger = new Ledger(filePath);
    const appends = Array.from({ length: 50 }, (_, i) =>
      ledger.append(makeEntry({ objectId: `user-${i}`, requestId: `req-${i}` })),
    );
    await Promise.all(appends);

    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(50);

    // Every line must be independently parseable JSON — a corrupt/interleaved
    // write would produce a line that fails JSON.parse.
    const parsed = lines.map((line) => JSON.parse(line) as LedgerEntry);
    const ids = new Set(parsed.map((entry) => entry.objectId));
    expect(ids.size).toBe(50);

    const queried = await ledger.query();
    expect(queried).toHaveLength(50);
  });
});
