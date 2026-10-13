// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { buildInventory } from './InventoryExtractor.js';

/**
 * G-STACKSIM-2 iteration 1 - extractor completeness gate. Minimums below are
 * derived from actually running the extractor against the real
 * ces-stamper/ces-eo/ces-ao sources at authoring time (see
 * IMPLEMENTATION_LOG.md iteration 1 section for the exact counts observed:
 * stamper 348, eo 36, ao 139), not invented targets. A regression that drops
 * extraction below these floors (e.g. a registry/file read silently failing)
 * fails this test rather than shrinking coverage/inventory.json unnoticed.
 */
describe('buildInventory (G-STACKSIM-2 iteration 1)', () => {
  it('extracts a non-trivial number of items from each source', async () => {
    const report = await buildInventory();

    expect(report.counts.stamper).toBeGreaterThan(300);
    expect(report.counts.eo).toBeGreaterThanOrEqual(30);
    expect(report.counts.ao).toBeGreaterThan(100);

    expect(report.items.length).toBe(report.counts.stamper + report.counts.eo + report.counts.ao);
  }, 60_000);

  it('every item has the required fields and a valid classification/source', async () => {
    const report = await buildInventory();
    for (const item of report.items) {
      expect(['stamper', 'eo', 'ao']).toContain(item.source);
      expect(['read', 'write']).toContain(item.classification);
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(typeof item.sourceRef).toBe('string');
      if (item.excluded) {
        expect(typeof item.exclusionReason).toBe('string');
        expect((item.exclusionReason as string).length).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  it('never silently drops a Stamper manual_gate entry - excludes it with a reason instead', async () => {
    const report = await buildInventory();
    const manualItems = report.items.filter((i) => i.source === 'stamper' && i.sourceRef.endsWith(':manual'));
    expect(manualItems.length).toBeGreaterThan(0);
    for (const item of manualItems) {
      expect(item.excluded).toBe(true);
      expect(item.exclusionReason).toBeTruthy();
    }
  }, 60_000);

  it('produces unique ids across the whole inventory', async () => {
    const report = await buildInventory();
    const ids = report.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);
});
