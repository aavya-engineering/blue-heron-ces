// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M6 gate — SPRS parity assertion; matrix fixture rows render via the
// ResultsMatrixArtifact contract only (no raw-data matrix construction in
// the component). Renders via react-dom/server (same node-renderability
// discipline as MusterNav/IndividualContractor.test.tsx).
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test, expect } from 'vitest';
import ReadinessTab from '../ReadinessTab';
import { RESULTS_MATRIX_FIXTURE } from '@/__fixtures__/resultsMatrix';
import { computeSprs } from '@/features/scoring/sprsCalc';

describe('ReadinessTab — SPRS parity + fixture-only matrix contract', () => {
  test('the rendered SPRS number equals computeSprs output for the same requirement-result set', () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessTab));

    const requirementResults = RESULTS_MATRIX_FIXTURE.map((row) => ({
      requirement_id: row.control_id,
      status: row.status === 'met' ? 'met' : 'not_met',
    }));
    const expected = computeSprs(requirementResults);

    expect(html).toContain(`>${expected.sprs}<`);
  });

  test('every fixture row renders in the matrix table', () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessTab));
    for (const row of RESULTS_MATRIX_FIXTURE) {
      expect(html).toContain(`readiness-matrix-row-${row.objective_id}`);
      expect(html).toContain(row.control_id);
      expect(html).toContain(row.status);
    }
  });

  test('component renders exactly RESULTS_MATRIX_FIXTURE.length matrix rows (no recomputation from raw data)', () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessTab));
    const rowMatches = html.match(/data-testid="readiness-matrix-row-/g) ?? [];
    expect(rowMatches).toHaveLength(RESULTS_MATRIX_FIXTURE.length);
  });
});
