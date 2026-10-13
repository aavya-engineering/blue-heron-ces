// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Finding 4 invariant: pruneByCoverage(QUESTION_GRAPH, []) is a no-op —
// M4's pruning call, given facts: [], is behaviorally identical to today's
// ungated loadQuestionGraph path. This test must exist before M4 is
// considered done (see PLAN.md Finding 4); M5 then only adds the e2e
// regression check on top of this unit invariant.
import { describe, test, expect } from 'vitest';
import { pruneByCoverage } from '../factCoveragePruner';
import { QUESTION_GRAPH } from '../questionGraph';

describe('pruneByCoverage — empty-facts invariant (Finding 4)', () => {
  test('returns the input array unchanged: same length, same node ids, same order', () => {
    const result = pruneByCoverage(QUESTION_GRAPH, []);
    expect(result).toHaveLength(QUESTION_GRAPH.length);
    expect(result.map((n) => n.id)).toEqual(QUESTION_GRAPH.map((n) => n.id));
  });
});
