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

describe('EvidenceHold', () => {
  let dir: string;
  let ledger: Ledger;
  let hold: EvidenceHold;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-evidencehold-'));
    ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
    hold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('record() writes an immutable snapshot file and a matching read-serve ledger entry', async () => {
    const { snapshot, ledgerEntry } = await hold.record({
      objectType: 'caPolicies',
      request: { kind: 'cmdlet', identifier: 'Get-MgIdentityConditionalAccessPolicy', verb: 'GET' },
      response: [{ id: 'caPolicy-1' }],
      source: 'Get-MgIdentityConditionalAccessPolicy',
    });

    expect(snapshot.objectType).toBe('caPolicies');
    expect(snapshot.response).toEqual([{ id: 'caPolicy-1' }]);
    expect(snapshot.requestId).toBe(ledgerEntry.requestId);

    const stored = await hold.read(snapshot.requestId);
    expect(stored).toEqual(snapshot);

    const ledgerEntries = await ledger.query({ type: 'read-serve' });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toEqual(ledgerEntry);
    expect(ledgerEntries[0].objectType).toBe('caPolicies');
    expect(ledgerEntries[0].objectId).toBe(snapshot.requestId);
  });

  it('defaults actor to "eo", sessionType to "graph", and milestone to "M5"', async () => {
    const { ledgerEntry, snapshot } = await hold.record({
      objectType: 'directoryAudits',
      request: { kind: 'cmdlet', identifier: 'Get-MgAuditLogDirectoryAudit', verb: 'GET' },
      response: [],
      source: 'Get-MgAuditLogDirectoryAudit',
    });

    expect(ledgerEntry.actor).toBe('eo');
    expect(snapshot.sessionType).toBe('graph');
    expect(snapshot.milestone).toBe('M5');
  });

  it('honors explicit actor/sessionType/milestone overrides', async () => {
    const { ledgerEntry, snapshot } = await hold.record({
      objectType: 'caPolicies',
      request: { kind: 'uri', identifier: '/v1.0/identity/conditionalAccess/policies', verb: 'GET' },
      response: { value: [] },
      source: '/v1.0/identity/conditionalAccess/policies',
      actor: 'probe',
      sessionType: 'graph-probe',
      milestone: 'M3',
    });

    expect(ledgerEntry.actor).toBe('probe');
    expect(snapshot.sessionType).toBe('graph-probe');
    expect(snapshot.milestone).toBe('M3');
  });

  it('read() returns undefined for an unknown requestId', async () => {
    const result = await hold.read('does-not-exist');
    expect(result).toBeUndefined();
  });
});
