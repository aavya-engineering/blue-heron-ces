// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-GO-2 M3 gate: the script-upload (import-file) path produces
// boundary-draft behavior IDENTICAL to the canned-fixture path — asserted as
// equivalence, not described. One mechanism, no second format.
import { describe, test, expect } from 'vitest';
import { DISCOVERY_RESULTS_FIXTURE } from '@/__fixtures__/discoveryResults';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { synthesizeFactsFromDiscovery } from '@/features/interview/discoveryFactJoin';
import { inferBoundaryDrafts } from '@/features/interview/boundaryInference';
import { parseDiscoveryResultsFile } from '../importResultsFile';

/** Strip volatile timestamps so equivalence compares substance. */
function stable<T extends { recorded_at: string }>(facts: T[]): Omit<T, 'recorded_at'>[] {
  return facts.map(({ recorded_at: _r, ...rest }) => rest);
}

describe('GO-2 M3 — script-upload == import-file (auth-ladder tier 2)', () => {
  test('an uploaded results file round-trips to the exact fixture shape', () => {
    const uploaded = parseDiscoveryResultsFile(JSON.stringify(DISCOVERY_RESULTS_FIXTURE));
    expect(uploaded).toEqual(DISCOVERY_RESULTS_FIXTURE);
  });

  test('the wrapped { results: [...] } flavor parses to the same rows', () => {
    const uploaded = parseDiscoveryResultsFile(
      JSON.stringify({ generated_by: 'admin-script', results: DISCOVERY_RESULTS_FIXTURE })
    );
    expect(uploaded).toEqual(DISCOVERY_RESULTS_FIXTURE);
  });

  test('EQUIVALENCE: upload path and fixture path produce identical synthesized facts and boundary drafts', () => {
    const uploaded = parseDiscoveryResultsFile(JSON.stringify(DISCOVERY_RESULTS_FIXTURE));

    expect(stable(synthesizeFactsFromDiscovery(uploaded, QUESTION_GRAPH))).toEqual(
      stable(synthesizeFactsFromDiscovery(DISCOVERY_RESULTS_FIXTURE, QUESTION_GRAPH))
    );
    expect(stable(inferBoundaryDrafts(uploaded))).toEqual(
      stable(inferBoundaryDrafts(DISCOVERY_RESULTS_FIXTURE))
    );
  });

  test('malformed uploads fail loudly, never ingest partially', () => {
    expect(() => parseDiscoveryResultsFile('not json')).toThrow(/not valid JSON/);
    expect(() => parseDiscoveryResultsFile('{"nope":1}')).toThrow(/expected a JSON array/);
    expect(() => parseDiscoveryResultsFile('[]')).toThrow(/no discovery results/);
    expect(() =>
      parseDiscoveryResultsFile(
        JSON.stringify([{ control_id: 'AC.L1-3.1.1', objective_ids: ['a'], confidence: 'certain' }])
      )
    ).toThrow(/row 0 is not a valid discovery result/);
  });
});