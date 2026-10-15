// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type {
  ScreeningElementState,
  ScreeningReadiness,
  ScreeningElementNumber,
} from './screening.types.js';
import { ScreeningElementStateSchema } from './screening.types.js';
import { getCesRepository } from 'ces-shared/persistence/node';

// G2: screening element states persist in the unified SQLite repository, tenant-isolated by
// tenantSlug, replacing {storageRoot}/personnel/{tenantSlug}/screening/{personnelId}/element-N.json.
// See ADR-002.
const SCREENING_COLLECTION = 'eo_screening';

export class ScreeningElementStore {
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private get repo() {
    return getCesRepository();
  }

  /** Per-tenant key for a screening element record (collection PK is global). */
  private recordKey(tenantSlug: string, personnelId: string, elementNum: number): string {
    return `${tenantSlug}:${personnelId}:element-${elementNum}`;
  }

  load(tenantSlug: string, personnelId: string, elementNum: number): ScreeningElementState | null {
    const rec = this.repo.get<unknown>(SCREENING_COLLECTION, this.recordKey(tenantSlug, personnelId, elementNum), { tenantSlug });
    if (!rec) return null;
    try {
      return ScreeningElementStateSchema.parse(rec.data);
    } catch {
      return null;
    }
  }

  save(tenantSlug: string, personnelId: string, elementNum: number, state: ScreeningElementState): void {
    this.repo.put(SCREENING_COLLECTION, {
      id: this.recordKey(tenantSlug, personnelId, elementNum),
      ces: { tenantSlug },
      data: state,
    });
  }

  loadAll(tenantSlug: string, personnelId: string): ScreeningElementState[] {
    const elements: ScreeningElementState[] = [];
    for (let i = 1; i <= 7; i++) {
      const state = this.load(tenantSlug, personnelId, i);
      if (state) {
        elements.push(state);
      } else {
        elements.push({
          elementNumber: i as ScreeningElementNumber,
          status: 'not_started',
          data: null,
        });
      }
    }
    return elements;
  }

  getReadiness(tenantSlug: string, personnelId: string): ScreeningReadiness {
    const elements = this.loadAll(tenantSlug, personnelId);
    const elementsComplete: number[] = [];
    const elementsIncomplete: number[] = [];

    for (const el of elements) {
      if (el.status === 'completed') {
        elementsComplete.push(el.elementNumber);
      } else {
        elementsIncomplete.push(el.elementNumber);
      }
    }

    const el7 = elements.find(e => e.elementNumber === 7)!;
    let aoDetermination: 'approve' | 'deny' | null = null;
    if (el7.status === 'completed' && el7.data && '_elementType' in el7.data && el7.data._elementType === 'ao_sign_off') {
      aoDetermination = (el7.data as { determination: 'approve' | 'deny' }).determination;
    }

    const packageComplete = elementsComplete.length === 7 && aoDetermination === 'approve';

    return {
      elementsComplete,
      elementsIncomplete,
      element7Status: el7.status,
      aoDetermination,
      packageComplete,
    };
  }

  areElementsOneToSixComplete(tenantSlug: string, personnelId: string): boolean {
    for (let i = 1; i <= 6; i++) {
      const state = this.load(tenantSlug, personnelId, i);
      if (!state || state.status !== 'completed') return false;
    }
    return true;
  }
}
