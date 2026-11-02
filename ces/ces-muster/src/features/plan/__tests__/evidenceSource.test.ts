// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EVC.3 (R-2), Muster side: the vendored gap compiler takes the released
// evidence catalog (compileGapSet arg 9) for 3.1.1 and marks every other MP
// gap row 'placeholder'.
import { describe, it, expect } from 'vitest';
import { compileGapSet } from '@/features/gaps/gapCompiler';
import type { ReadinessPosture, SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import { vendoredEvidenceCatalog } from '../evidenceCatalogBank';
import { loadBanks } from './planTestSupport';

const store = loadBanks().cmmcRequirements as { requirements: any[] };
const catalog = vendoredEvidenceCatalog();

describe('EVC.3 MP gap rows: evidence archetypes from the released catalog or marked placeholder', () => {
  const posture = { ces: { requirement_results: [] } } as unknown as ReadinessPosture;
  const si = {
    si_baseline: { operations: {}, scope: {}, dependencies: {}, target: { target_cmmc_level: 'L3' } },
  } as unknown as SIBaseline;
  const { gaps } = compileGapSet(si, posture, store, { entries: [] }, undefined, null, null, null, catalog);

  it('3.1.1 lists the catalog\'s 11 EMX ids with its 14 definition ids as provenance', () => {
    const defs = catalog.definitionsForPractice('3.1.1');
    const emx = [...new Set(defs.flatMap((d) => d.emx_ids))];
    expect(emx).toHaveLength(11);
    const rows = gaps.filter((g) => g.requirement_id.endsWith('-3.1.1'));
    expect(rows.map((g) => g.requirement_id).sort()).toEqual(['AC.L1-3.1.1', 'AC.L2-3.1.1']);
    for (const g of rows) {
      expect(g.evidence_source).toBe('catalog');
      expect(g.missing_evidence_archetypes).toEqual(emx);
      expect(g.catalog_definitions).toHaveLength(14);
      expect(g.catalog_definitions).toEqual(defs.map((d) => d.definition_id));
    }
  });

  it('every other practice is marked placeholder, without catalog provenance', () => {
    const other = gaps.find((g) => g.requirement_id === 'AC.L2-3.1.2');
    expect(other?.evidence_source).toBe('placeholder');
    expect(other?.catalog_definitions).toBeUndefined();
    const rest = gaps.filter((g) => !g.requirement_id.endsWith('-3.1.1'));
    expect(rest.length).toBe(gaps.length - 2);
    for (const g of rest) expect(g.evidence_source, g.requirement_id).toBe('placeholder');
  });

  it('without the catalog every row stays placeholder', () => {
    const bare = compileGapSet(si, posture, store, { entries: [] });
    expect(bare.gaps.every((g) => g.evidence_source === 'placeholder')).toBe(true);
  });
});
