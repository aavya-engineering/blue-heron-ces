// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DW#5 CI assertion: zero API-origin network calls during an interview run.
// The question graph is a static TypeScript constant — loadQuestionGraph never calls fetch.
// The scoring cascade fetches /knowledge/* static assets — local-only, never an API origin.
import { describe, it, expect, vi } from 'vitest';
import { loadQuestionGraph } from '../questionGraphService';

describe('Interview — no API-origin network calls', () => {
  it('loadQuestionGraph never calls fetch (static TS graph, no YAML loading needed)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchSpy);

    await loadQuestionGraph([]);

    // The question graph is pure static data — no fetch at all
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('loadQuestionGraph with stacks also never calls fetch', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchSpy);

    await loadQuestionGraph(['m365_e3', 'microsoft_intune', 'microsoft_sentinel']);

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('returns fewer questions when no stacks declared (stack-gated questions excluded)', async () => {
    const noStack = await loadQuestionGraph([]);
    const withStack = await loadQuestionGraph(['microsoft_intune', 'microsoft_sentinel']);
    expect(withStack.length).toBeGreaterThan(noStack.length);
  });

  it('all returned nodes have required fields', async () => {
    const nodes = await loadQuestionGraph(['m365_e3', 'microsoft_intune', 'microsoft_sentinel', 'on_prem_ad']);
    for (const node of nodes) {
      expect(typeof node.id).toBe('string');
      expect(typeof node.text).toBe('string');
      expect(Array.isArray(node.options)).toBe(true);
      // FC-MU (MU-10): a node is askable by its options, or — for a non-enum
      // plan input — by its typed input kind (then it has no options).
      if (node.input) expect(node.options).toEqual([]);
      else expect(node.options.length).toBeGreaterThan(0);
      expect(typeof node.cluster).toBe('string');
      expect(Array.isArray(node.mapped_requirements)).toBe(true);
    }
  });

  // G-MUSTER-GO-2 DONE-WHEN 6: the guardrail extends over every new SPA
  // surface — rung-1 boundary inference + confirm processing, rung-3 archetype
  // prefill, and the M3 import-file parser are all pure (zero fetch).
  it('GO-2 surfaces (boundary inference, confirm processing, archetype prefill, import parse) never call fetch', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchSpy);

    const { DISCOVERY_RESULTS_FIXTURE } = await import('@/__fixtures__/discoveryResults');
    const { inferBoundaryDrafts } = await import('../boundaryInference');
    const { processBoundaryDecisions } = await import('@/features/discovery/boundaryConfirm');
    const { parseDiscoveryResultsFile } = await import('@/features/discovery/importResultsFile');
    const { ARCHETYPES_FIXTURE } = await import('@/__fixtures__/archetypes');
    const { applyArchetypeDefaults } = await import('@/features/assessment/archetypePrefill');
    const { QUESTION_GRAPH } = await import('../questionGraph');

    const drafts = inferBoundaryDrafts(DISCOVERY_RESULTS_FIXTURE);
    processBoundaryDecisions(drafts, { 'bnd-001': { kind: 'confirm' } }, 'Jane');
    parseDiscoveryResultsFile(JSON.stringify(DISCOVERY_RESULTS_FIXTURE));
    applyArchetypeDefaults(ARCHETYPES_FIXTURE[0], QUESTION_GRAPH, {});

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('scoring cascade only fetches /knowledge/* static assets — never API origins', async () => {
    // loadKnowledge() fetches two files from /knowledge/ — verify no API origin calls.
    // We mock fetch to capture URLs; all calls must start with /knowledge/.
    const calls: string[] = [];
    const fetchSpy = vi.fn((url: unknown) => {
      calls.push(String(url));
      return Promise.resolve({ ok: true, text: async () => 'ces:\n  artifact: test\n  version: "1.0.0"\n  generated_on: "2026-01-01"\npatterns: []\nplaybook: []\n' });
    });
    vi.stubGlobal('fetch', fetchSpy);

    // Import after stubbing so the cache is cold (reset it first)
    const { _resetKnowledgeCache, loadKnowledge } = await import('@/features/scoring/knowledgeLoader');
    _resetKnowledgeCache();
    await loadKnowledge();

    // Every fetch call must be a local /knowledge/ path — never an API origin
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) {
      expect(url.startsWith('/knowledge/')).toBe(true);
    }

    // Double-check: no http:// or https:// API calls
    const apiCalls = calls.filter((u) => u.startsWith('http://') || u.startsWith('https://'));
    expect(apiCalls).toHaveLength(0);

    _resetKnowledgeCache();
    vi.unstubAllGlobals();
  });
});
