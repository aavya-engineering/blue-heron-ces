// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { PlanOfActionMilestones } from 'ces-shared/types/poam';
import { getCesRepository } from 'ces-shared/persistence/node';

// G2: POA&Ms persist in the unified SQLite repository, tenant-isolated by tenantSlug, replacing
// {storageRoot}/poam/{tenantSlug}/{poamId}.json (+ latest.json). See ADR-002. "latest" is no
// longer a duplicate record — it's a query over the collection ordered by generatedAt.
const POAM_COLLECTION = 'eo_poam';

export class PoamStore {
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private get repo() {
    return getCesRepository();
  }

  save(tenantSlug: string, poam: PlanOfActionMilestones): string {
    this.repo.put(POAM_COLLECTION, {
      id: poam.poamId,
      ces: { tenantSlug },
      data: poam,
    });
    return poam.poamId;
  }

  loadLatest(tenantSlug: string): PlanOfActionMilestones | null {
    const records = this.repo.list<PlanOfActionMilestones>(POAM_COLLECTION, { tenantSlug });
    if (records.length === 0) return null;
    return records
      .map((r) => r.data)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  }

  load(tenantSlug: string, poamId: string): PlanOfActionMilestones | null {
    const rec = this.repo.get<PlanOfActionMilestones>(POAM_COLLECTION, poamId, { tenantSlug });
    return rec ? rec.data : null;
  }

  listSnapshots(tenantSlug: string): Array<{
    poamId: string;
    generatedAt: string;
    totalItems: number;
    eligible: boolean;
  }> {
    return this.repo
      .list<PlanOfActionMilestones>(POAM_COLLECTION, { tenantSlug })
      .map((r) => r.data)
      .map((poam) => ({
        poamId: poam.poamId,
        generatedAt: poam.generatedAt,
        totalItems: poam.items.length,
        eligible: poam.eligibility.eligible,
      }));
  }
}
