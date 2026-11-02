// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EVC.6 (R-4): both practice-id spellings resolve to the same reference entry.
import { describe, it, expect } from 'vitest';
import controlsReference from '../data/cmmc-l2-controls.reference.json';
import { normalizePracticeId } from './practice-id.js';

interface RefControl {
  control_id: string;
  nist_ref: string;
  cmmc_level: number;
}

const controls = controlsReference.controls as RefControl[];
const byNist = new Map(controls.map((c) => [normalizePracticeId(c.control_id), c]));
const resolve = (id: string) => byNist.get(normalizePracticeId(id));

describe('EVC.6 practice-id convention (R-4)', () => {
  it('AC.L1-3.1.1 and AC.L2-3.1.1 resolve to the same reference entry', () => {
    const l1 = resolve('AC.L1-3.1.1');
    const l2 = resolve('AC.L2-3.1.1');
    expect(l1).toBeDefined();
    expect(l2).toBe(l1);
    expect(l1!.control_id).toBe('AC.L1-3.1.1');
  });

  it('normalises definition and objective suffixes and bare NIST numbers', () => {
    expect(normalizePracticeId('AC.L2-3.1.1#E01')).toBe('3.1.1');
    expect(normalizePracticeId('AC.L1-3.1.1[a]')).toBe('3.1.1');
    expect(normalizePracticeId('3.13.11')).toBe('3.13.11');
  });

  it('the reference spells the 17 Level 1 practices L1; every practice resolves in both forms', () => {
    expect(controls).toHaveLength(110);
    expect(controls.filter((c) => c.control_id.includes('.L1-'))).toHaveLength(17);
    expect(byNist.size).toBe(110);
    for (const c of controls) {
      const nist = normalizePracticeId(c.control_id);
      const fam = c.control_id.slice(0, 2);
      expect(resolve(`${fam}.L1-${nist}`)).toBe(c);
      expect(resolve(`${fam}.L2-${nist}`)).toBe(c);
    }
  });
});
