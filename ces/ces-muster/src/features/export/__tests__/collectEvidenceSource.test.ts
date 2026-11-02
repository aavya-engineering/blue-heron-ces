// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EVC.3 (R-2): the readiness collect column takes released evidence-catalog
// definitions (3.1.1) and marks every other row 'placeholder'.
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../../public/schemas/readiness-result.schema.json';
import { collectRow, RESIDUAL_MUST_HAVE, COLLECT_FALLBACK } from '../residualMustHave';
import { vendoredEvidenceCatalog } from '@/features/plan/evidenceCatalogBank';

const catalog = vendoredEvidenceCatalog();

describe('EVC.3 readiness collect column', () => {
  it('3.1.1 is catalog-sourced: 11 EMX ids, 14 definition ids as provenance', () => {
    for (const id of ['AC.L1-3.1.1', 'AC.L2-3.1.1']) {
      const row = collectRow(id, catalog);
      expect(row.evidence_source).toBe('catalog');
      expect(row.collect).toHaveLength(11);
      expect(row.collect.every((c) => /^EMX-/.test(c))).toBe(true);
      expect(row.catalog_definitions).toHaveLength(14);
    }
  });

  it('every other table row, and the fallback, is marked placeholder', () => {
    const others = Object.keys(RESIDUAL_MUST_HAVE).filter((id) => !id.endsWith('-3.1.1'));
    expect(others.length).toBeGreaterThan(100);
    for (const id of others) {
      const row = collectRow(id, catalog);
      expect(row.evidence_source, id).toBe('placeholder');
      expect(row.collect).toEqual(RESIDUAL_MUST_HAVE[id]);
      expect(row.catalog_definitions).toBeUndefined();
    }
    expect(collectRow('XX.L2-9.9.9', catalog)).toEqual({ collect: [COLLECT_FALLBACK], evidence_source: 'placeholder' });
  });

  it('the readiness-result schema accepts the marker on a gap row', () => {
    const validate = new Ajv({ strict: true }).compile((schema as any).properties.derived.properties.gaps);
    const gap = { requirement_id: 'AC.L1-3.1.1', weight: 5, fix_entry_ids: [], fixable: 'manual', ...collectRow('AC.L1-3.1.1', catalog) };
    expect(validate([gap])).toBe(true);
    expect(validate([{ ...gap, evidence_source: 'fact' }])).toBe(false);
  });
});
