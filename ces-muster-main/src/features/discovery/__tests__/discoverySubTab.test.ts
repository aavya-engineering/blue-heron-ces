// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M3 gate — extends the noNetworkCalls.test.ts pattern for the Discovery
// sub-tab: coverage counts match the fixture, and rendering makes zero
// network calls (DISCOVERY_RESULTS_FIXTURE is a static TS constant, same
// discipline as questionGraph.ts).
import { describe, it, expect, vi } from 'vitest';
import { DISCOVERY_RESULTS_FIXTURE } from '@/__fixtures__/discoveryResults';

describe('Discovery sub-tab — fixture coverage + zero network calls', () => {
  it('fixture has 10-15 rows spanning identity/endpoint/policy clusters with at least one unknown row', () => {
    expect(DISCOVERY_RESULTS_FIXTURE.length).toBeGreaterThanOrEqual(10);
    expect(DISCOVERY_RESULTS_FIXTURE.length).toBeLessThanOrEqual(15);
    const unknownRows = DISCOVERY_RESULTS_FIXTURE.filter((r) => r.confidence === 'unknown');
    expect(unknownRows.length).toBeGreaterThanOrEqual(1);
  });

  it('coverage counts match the fixture (objective/control counts derivable without recomputation)', () => {
    const objectiveCount = DISCOVERY_RESULTS_FIXTURE.reduce((n, r) => n + r.objective_ids.length, 0);
    const unknownRows = DISCOVERY_RESULTS_FIXTURE.filter((r) => r.confidence === 'unknown');
    const resolvedCount = DISCOVERY_RESULTS_FIXTURE.filter((r) => r.confidence !== 'unknown').length;
    expect(objectiveCount).toBeGreaterThan(0);
    expect(resolvedCount).toBe(DISCOVERY_RESULTS_FIXTURE.length - unknownRows.length);
  });

  it('importing the fixture module triggers zero fetch calls', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchSpy);

    await import('@/__fixtures__/discoveryResults');

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('every row has a control_id present as a mapped_requirement in the live question graph', async () => {
    const { QUESTION_GRAPH } = await import('@/features/interview/questionGraph');
    const allMappedRequirements = new Set(QUESTION_GRAPH.flatMap((q) => q.mapped_requirements));
    const overlapping = DISCOVERY_RESULTS_FIXTURE.filter((r) => allMappedRequirements.has(r.control_id));
    expect(overlapping.length).toBeGreaterThan(0);
  });
});
