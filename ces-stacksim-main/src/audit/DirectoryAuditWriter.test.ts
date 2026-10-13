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
import { DirectoryAuditWriter } from './DirectoryAuditWriter.js';

describe('DirectoryAuditWriter', () => {
  let dir: string;
  let store: ObjectStore;
  let ledger: Ledger;
  let writer: DirectoryAuditWriter;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-auditwriter-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
    writer = new DirectoryAuditWriter(store, ledger);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('recordMutation appends a Graph-shaped directoryAudits entry and a matching ledger entry', async () => {
    const { auditEntry, ledgerEntry } = await writer.recordMutation({
      objectType: 'authorizationPolicy',
      objectId: 'authorizationPolicy',
      activityDisplayName: "PATCH /v1.0/policies/authorizationPolicy",
      requestVerb: 'PATCH',
      source: '/v1.0/policies/authorizationPolicy',
    });

    const stored = await store.list('directoryAudits');
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(auditEntry.id);
    expect(stored[0].activityDisplayName).toBe("PATCH /v1.0/policies/authorizationPolicy");
    expect(stored[0].result).toBe('success');
    const targetResources = stored[0].targetResources as Array<{ id: string; type: string }>;
    expect(targetResources[0].id).toBe('authorizationPolicy');
    expect(targetResources[0].type).toBe('authorizationPolicy');

    const ledgerEntries = await ledger.query({ type: 'mutate' });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toEqual(ledgerEntry);
    expect(ledgerEntries[0].objectType).toBe('authorizationPolicy');
    expect(ledgerEntries[0].objectId).toBe('authorizationPolicy');
    expect(ledgerEntries[0].source).toBe('/v1.0/policies/authorizationPolicy');
  });

  it('defaults actor to "ao" and milestone to "M4" when not specified', async () => {
    const { ledgerEntry } = await writer.recordMutation({
      objectType: 'authenticationMethodsPolicyConfigurations',
      objectId: 'Fido2',
      activityDisplayName: 'PATCH Fido2 config',
      requestVerb: 'PATCH',
      source: '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2',
    });

    expect(ledgerEntry.actor).toBe('ao');
    expect(ledgerEntry.milestone).toBe('M4');
  });

  it('honors an explicit actor override', async () => {
    const { ledgerEntry } = await writer.recordMutation({
      objectType: 'authenticationMethodsPolicyConfigurations',
      objectId: 'Fido2',
      activityDisplayName: 'PATCH Fido2 config',
      requestVerb: 'PATCH',
      source: '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2',
      actor: 'stamper',
    });

    expect(ledgerEntry.actor).toBe('stamper');
  });
});
