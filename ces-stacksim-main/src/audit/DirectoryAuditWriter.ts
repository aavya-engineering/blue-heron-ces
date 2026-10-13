// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { randomUUID } from 'node:crypto';
import type { ObjectStore } from '../store/ObjectStore.js';
import type { Ledger } from '../ledger/Ledger.js';
import type { LedgerActor, LedgerEntry } from '../ledger/LedgerTypes.js';
import type { StoreObject } from '../store/StoreTypes.js';

export type MutationVerb = 'POST' | 'PATCH' | 'DELETE';

export interface RecordMutationParams {
  /** ObjectStore collection the mutation targeted. */
  objectType: string;
  /** id of the mutated object within `objectType`. */
  objectId: string;
  /** Human-readable summary, e.g. "PATCH /v1.0/policies/authorizationPolicy". */
  activityDisplayName: string;
  requestVerb: MutationVerb;
  /** Cmdlet or URI that produced this mutation, for traceability. */
  source: string;
  actor?: LedgerActor;
  sessionType?: string;
  milestone?: string;
}

export interface RecordMutationResult {
  auditEntry: StoreObject;
  ledgerEntry: LedgerEntry;
}

/**
 * Appends a Graph-shaped `auditLogs/directoryAudits` entry (readable via
 * `Get-MgAuditLogDirectoryAudit`) AND a `ledger.jsonl` entry on every
 * sim-state mutation (PLAN.md M4 File Inventory: "every sim-state mutation
 * generates a Graph-shaped entry in the sim's auditLogs/directoryAudits
 * collection ... AND a ledger.jsonl entry"). Both writes go through the
 * same server-owned ObjectStore/Ledger instances (Core Design (f)).
 */
export class DirectoryAuditWriter {
  constructor(
    private readonly store: ObjectStore,
    private readonly ledger: Ledger,
  ) {}

  async recordMutation(params: RecordMutationParams): Promise<RecordMutationResult> {
    const ts = new Date().toISOString();
    const auditId = randomUUID();

    const auditEntry: StoreObject = {
      id: auditId,
      activityDisplayName: params.activityDisplayName,
      activityDateTime: ts,
      loggedByService: 'Stacksim',
      category: 'PolicyManagement',
      result: 'success',
      operationType: params.requestVerb,
      targetResources: [
        {
          id: params.objectId,
          displayName: params.objectId,
          type: params.objectType,
          modifiedProperties: [],
        },
      ],
      initiatedBy: {
        app: { displayName: params.source },
      },
    };
    await this.store.create('directoryAudits', auditEntry);

    const ledgerEntry: LedgerEntry = {
      ts,
      type: 'mutate',
      objectType: params.objectType,
      objectId: params.objectId,
      actor: params.actor ?? 'ao',
      source: params.source,
      milestone: params.milestone ?? 'M4',
      sessionType: params.sessionType ?? 'graph',
      requestId: auditId,
    };
    await this.ledger.append(ledgerEntry);

    return { auditEntry, ledgerEntry };
  }
}
