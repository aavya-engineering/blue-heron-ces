// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Ledger } from '../ledger/Ledger.js';
import type { LedgerActor, LedgerEntry } from '../ledger/LedgerTypes.js';

export interface EvidenceSnapshot {
  requestId: string;
  ts: string;
  objectType: string;
  request: unknown;
  response: unknown;
  sessionType: string;
  milestone: string;
}

export interface RecordEvidenceParams {
  /** ObjectStore collection the served data came from. */
  objectType: string;
  /** What was asked for (cmdlet/URI, verb, args/body) - served for later query. */
  request: unknown;
  /** The exact payload served back to the caller. */
  response: unknown;
  /** Cmdlet or URI that produced this read, for ledger traceability (mirrors DirectoryAuditWriter's `source`). */
  source: string;
  actor?: LedgerActor;
  sessionType?: string;
  milestone?: string;
}

export interface RecordEvidenceResult {
  snapshot: EvidenceSnapshot;
  ledgerEntry: LedgerEntry;
}

/**
 * Retains an immutable snapshot of every GET-shaped resolver invocation
 * (Core Design (c) Evidence hold) under
 * .stacksim/tenants/{slug}/evidence/{requestId}.json, and indexes it in the
 * ledger via a `read-serve` entry (Core Design (a)) keyed by the same
 * requestId, so EvidenceQuery can filter on ledger fields (objectType,
 * from/to) without scanning every snapshot file.
 *
 * Writes go through a single Promise-chained queue, the same single-writer
 * pattern Ledger/ObjectStore already use (Core Design (f)) - one
 * fs.writeFile in flight at a time, and this class is only ever constructed
 * inside the `stacksim serve` process (the sole owner of the tenant's
 * on-disk state).
 */
export class EvidenceHold {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly evidenceDir: string,
    private readonly ledger: Ledger,
  ) {}

  async record(params: RecordEvidenceParams): Promise<RecordEvidenceResult> {
    const ts = new Date().toISOString();
    const requestId = randomUUID();

    const snapshot: EvidenceSnapshot = {
      requestId,
      ts,
      objectType: params.objectType,
      request: params.request,
      response: params.response,
      sessionType: params.sessionType ?? 'graph',
      milestone: params.milestone ?? 'M5',
    };

    const filePath = path.join(this.evidenceDir, `${requestId}.json`);
    const task = this.writeQueue.then(async () => {
      await fs.mkdir(this.evidenceDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    });
    this.writeQueue = task.catch(() => undefined);
    await task;

    const ledgerEntry: LedgerEntry = {
      ts,
      type: 'read-serve',
      objectType: params.objectType,
      // No single object id exists for a collection-shaped GET response;
      // requestId doubles as the ledger's join key back to the snapshot
      // file (see EvidenceQuery.query()).
      objectId: requestId,
      actor: params.actor ?? 'eo',
      source: params.source,
      milestone: snapshot.milestone,
      sessionType: snapshot.sessionType,
      requestId,
    };
    await this.ledger.append(ledgerEntry);

    return { snapshot, ledgerEntry };
  }

  async read(requestId: string): Promise<EvidenceSnapshot | undefined> {
    await this.writeQueue.catch(() => undefined);
    const filePath = path.join(this.evidenceDir, `${requestId}.json`);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as EvidenceSnapshot;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }
}
