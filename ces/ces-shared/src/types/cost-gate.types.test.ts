// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CostEstimatesSchema, CostItemsCatalogueSchema, RecurringCostNoticeSchema } from './cost-gate.types.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));

describe('cost-gate data (CG-2)', () => {
  const estimates = CostEstimatesSchema.parse(read('cost-estimates.reference.json'));
  const catalogue = CostItemsCatalogueSchema.parse(read('cost-items.reference.json'));

  it('every recurring item names a price; every free item a free_reason', () => {
    for (const item of catalogue.items) {
      const g = item.cost_gate;
      if (g.recurring) expect({ id: item.item_id, priced: !!(g.cost_key && estimates.prices[g.cost_key]) }).toEqual({ id: item.item_id, priced: true });
      else expect({ id: item.item_id, reason: !!g.free_reason }).toEqual({ id: item.item_id, reason: true });
    }
  });

  it('per-use billing is recurring (CQ-2): no free_reason per_call_only, and the Key Vault entries are recurring', () => {
    expect(JSON.stringify(catalogue)).not.toContain('per_call_only');
    for (const id of ['SC.L2-3.13.10.key-vault', 'AZ-KV-001', 'AZ-KV-003']) {
      expect(catalogue.items.find(i => i.item_id === id)?.cost_gate.recurring).toBe(true);
    }
  });

  it('the notice schema accepts an empty notice', () => {
    expect(RecurringCostNoticeSchema.safeParse({ price_date: estimates.price_date, items: [], licence_dependencies: [], total_estimate_low: 0, total_estimate_high: 0, items_hash: 'x', note: 'n' }).success).toBe(true);
  });
});
