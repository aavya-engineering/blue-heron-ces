// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { PoamLedger } from './PoamLifecycle.js';
import { getCesRepository } from 'ces-shared/persistence/node';

// The objective-level POA&M ledger (with lifecycle/history) persists in the unified SQLite
// repository, tenant-isolated. Separate collection from the legacy practice-level POA&M
// (eo_poam) so the auto-close lifecycle is additive and does not disturb the existing path.
const POAM_LEDGER_COLLECTION = 'eo_poam_ledger';

export class PoamLedgerStore {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly storageRoot: string) {}

  private get repo() {
    return getCesRepository();
  }

  save(tenantSlug: string, ledger: PoamLedger): string {
    this.repo.put(POAM_LEDGER_COLLECTION, { id: ledger.poamId, ces: { tenantSlug }, data: ledger });
    return ledger.poamId;
  }

  loadLatest(tenantSlug: string): PoamLedger | null {
    const records = this.repo.list<PoamLedger>(POAM_LEDGER_COLLECTION, { tenantSlug });
    if (records.length === 0) return null;
    return records.map(r => r.data).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  }
}
