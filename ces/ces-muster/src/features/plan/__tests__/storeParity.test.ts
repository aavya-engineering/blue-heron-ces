// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EVC.2 Store-parity test (R-1), Muster side. The vendored gap compiler must
// emit the ces-shared reference text (vendored copy) for every Store row in
// public/knowledge/ that has a reference entry. The Store rows are not fixed
// yet; the disagreement count is printed, not asserted.
import { describe, it, expect } from 'vitest';
import controlsReference from 'ces-shared/data/cmmc-l2-controls';
import { compileGapSet } from '@/features/gaps/gapCompiler';
import { vendoredEvidenceCatalog } from '../evidenceCatalogBank';
import { toNistRef, withReferenceText } from '@/features/plan/engine/shared/services/practiceReference';
import type { ReadinessPosture, SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import { loadBanks } from './planTestSupport';

const store = loadBanks().cmmcRequirements as { requirements: any[] };
const rows: any[] = store.requirements;

const REF = new Map<string, string>(
  (controlsReference.controls as Array<{ nist_ref: string; practice: string }>).map((c) => [c.nist_ref, c.practice]),
);

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

describe('EVC.2 Store parity (Muster): requirement text comes from the ces-shared reference', () => {
  it('reference has 110 unique NIST refs', () => {
    expect(REF.size).toBe(110);
  });

  it('every Store row with a reference entry gets the reference text', () => {
    let fromReference = 0;
    for (const row of rows) {
      const out = withReferenceText(row);
      const ref = REF.get(toNistRef(row.requirement_id));
      if (ref !== undefined) {
        expect(out.requirement_text, row.requirement_id).toBe(ref);
        expect(out.text_source).toBe('reference');
        fromReference++;
      } else {
        expect(out.text_source, row.requirement_id).toBe('store');
        expect(out.requirement_text).toBe(row.requirement_text);
      }
    }
    expect(fromReference).toBe(127);
  });

  it('every MP gap row emitted by the vendored gap compiler carries the reference text', () => {
    const posture = { ces: { requirement_results: [] } } as unknown as ReadinessPosture;
    const si = {
      si_baseline: { operations: {}, scope: {}, dependencies: {}, target: { target_cmmc_level: 'L3' } },
    } as unknown as SIBaseline;
    const { gaps } = compileGapSet(si, posture, store, { entries: [] }, undefined, null, null, null, vendoredEvidenceCatalog());
    expect(gaps.length).toBe(rows.length);
    for (const g of gaps) {
      const ref = REF.get(toNistRef(g.requirement_id));
      if (ref !== undefined) {
        expect(g.requirement_text, g.requirement_id).toBe(ref);
        expect(g.text_source).toBe('reference');
      } else {
        expect(g.text_source, g.requirement_id).toBe('store');
      }
    }
  });

  it('reports how many raw Store rows disagree with the reference (informational)', () => {
    const refEntries = [...REF.entries()];
    let comparable = 0;
    let notExact = 0;
    let shifted = 0;
    for (const row of rows) {
      const nist = toNistRef(row.requirement_id);
      const ref = REF.get(nist);
      if (ref === undefined) continue;
      comparable++;
      const text = norm(row.requirement_text);
      if (text !== norm(ref)) notExact++;
      const head = text.slice(0, 40);
      if (refEntries.some(([n, t]) => n !== nist && norm(t).slice(0, 40) === head)) shifted++;
    }
    console.log(
      `[EVC.2 parity] Store rows comparable=${comparable} notExactMatch=${notExact} shiftedToOtherPractice=${shifted}`,
    );
    expect(comparable).toBe(127);
  });
});
