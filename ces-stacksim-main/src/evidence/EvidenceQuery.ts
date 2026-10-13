// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { Ledger } from '../ledger/Ledger.js';
import type { EvidenceHold, EvidenceSnapshot } from './EvidenceHold.js';

export interface EvidenceQueryFilter {
  objectType?: string;
  from?: string;
  to?: string;
}

/**
 * Query interface over the EvidenceHold (Core Design (c) / File Inventory
 * M5 row). Finds the matching `read-serve` ledger entries (the index - Core
 * Design (a)) via `objectType`/`from`/`to`, then loads each entry's
 * snapshot file from the hold by its requestId. The ledger, not a directory
 * scan of `evidence/`, is the source of truth for which snapshots match.
 */
export class EvidenceQuery {
  constructor(
    private readonly ledger: Ledger,
    private readonly hold: EvidenceHold,
  ) {}

  async query(filter: EvidenceQueryFilter = {}): Promise<EvidenceSnapshot[]> {
    const entries = await this.ledger.query({
      type: 'read-serve',
      objectType: filter.objectType,
      from: filter.from,
      to: filter.to,
    });

    const snapshots: EvidenceSnapshot[] = [];
    for (const entry of entries) {
      const snapshot = await this.hold.read(entry.requestId);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }
    return snapshots;
  }
}
