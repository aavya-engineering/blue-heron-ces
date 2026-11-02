// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 1C — `compareEoChange` (D.16), the pure before/after delta.
 *
 * The load-bearing property: the named control's status and the SPRS delta are
 * INDEPENDENT. A remediation can move the score without flipping the specific
 * control, so `flipped` and `sprsDelta` must be derivable separately and neither
 * inferred from the other. These fixtures pin exactly that.
 */

import { describe, it, expect } from 'vitest';
import {
  compareEoChange,
  type EoAssessmentArtifact,
} from '../src/demo/show/ops/eo-show-change-captured-op.js';

const CONTROL = 'IA.L2-3.5.3';

function artifact(status: string | undefined, sprs: number | undefined, generatedAt: string): EoAssessmentArtifact {
  return {
    assessment: {
      controls: status === undefined ? [] : [{ control_id: CONTROL, status }],
      generatedAt,
    },
    sprs: sprs === undefined ? {} : { score: sprs },
  };
}

describe('compareEoChange', () => {
  it('detects a genuine flip and computes the SPRS delta', () => {
    const before = artifact('not_met', -108, '2026-01-01T00:00:00Z');
    const after = artifact('met', -89, '2026-01-01T00:05:00Z');
    const cmp = compareEoChange(before, after, CONTROL);
    expect(cmp.flipped).toBe(true);
    expect(cmp.beforeStatus).toBe('not_met');
    expect(cmp.afterStatus).toBe('met');
    expect(cmp.sprsDelta).toBe(19);
    expect(cmp.beforeGeneratedAt! < cmp.afterGeneratedAt!).toBe(true);
  });

  it('THE MIXED CASE: the control does not change but the SPRS still moves', () => {
    // A-18 can move the score without flipping IA.L2-3.5.3. `flipped` must be
    // false while `sprsDelta` is non-zero — the two facts are independent.
    const before = artifact('not_met', -108, '2026-01-01T00:00:00Z');
    const after = artifact('not_met', -89, '2026-01-01T00:05:00Z');
    const cmp = compareEoChange(before, after, CONTROL);
    expect(cmp.flipped).toBe(false);
    expect(cmp.sprsDelta).toBe(19);
  });

  it('never calls an absent control a flip', () => {
    const before = artifact(undefined, -108, '2026-01-01T00:00:00Z');
    const after = artifact('met', -89, '2026-01-01T00:05:00Z');
    const cmp = compareEoChange(before, after, CONTROL);
    expect(cmp.flipped).toBe(false);
    expect(cmp.beforeStatus).toBe('(absent)');
  });

  it('leaves the SPRS delta undefined when a score is missing', () => {
    const before = artifact('not_met', undefined, '2026-01-01T00:00:00Z');
    const after = artifact('not_met', -89, '2026-01-01T00:05:00Z');
    const cmp = compareEoChange(before, after, CONTROL);
    expect(cmp.sprsDelta).toBeUndefined();
  });

  it('treats undefined artifacts as absent, never as a flip', () => {
    const cmp = compareEoChange(undefined, undefined, CONTROL);
    expect(cmp.flipped).toBe(false);
    expect(cmp.beforeStatus).toBe('(absent)');
    expect(cmp.afterStatus).toBe('(absent)');
  });
});
