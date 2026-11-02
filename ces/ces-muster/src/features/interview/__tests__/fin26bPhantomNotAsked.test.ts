// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-26b (NS-audit F-10): the RR activities keyed only to a phantom L2 twin (an L2 label for an
// L1 practice the ces-shared reference lacks, e.g. AC.L2-3.1.20) are never asked; the L1 twin is
// the practice. AR5 proof: the posture (and so Muster's SPRS and the plan inputs) is identical
// with and without the phantom nodes in the asked graph, on fixtures a-d, with and without a
// recorded answer for one of them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PHANTOM_RR_ACTIVITY_IDS, QUESTION_GRAPH, expandLegacyReadinessFacts } from '../questionGraph';
import { isRrActivityNode, loadQuestionGraph, readinessResidueIds, stackFilteredGraph } from '../questionGraphService';
import { pruneByCoverage } from '../factCoveragePruner';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import { mapToPreamble } from '@/features/scoring/preambleMapper';
import { routeFacts } from '@/features/scoring/factRouter';
import { scoreFacts } from '@/features/scoring/scoringService';
import { _resetKnowledgeCache } from '@/features/scoring/knowledgeLoader';
import { cascadeScope, residueActivities, scenarioSiBaseline, selectActivities } from '@/features/scoring/readinessScope';
import type { InterviewFact } from '@/shared/types/engagement';

const CUSTOMERS = path.resolve(process.cwd(), 'src/features/plan/__fixtures__/customers');
const KNOWLEDGE = path.resolve(process.cwd(), 'public/knowledge');
const session = (x: string) => JSON.parse(fs.readFileSync(path.join(CUSTOMERS, x, 'muster-session.json'), 'utf8')).session;

/** The seven phantom activities the residue rule selected on fixtures a, c and d before FIN-26b (LOG-FIN-26 STOP 1). */
const ASKED_BEFORE = [
  'RR-ACT-AC_L2_3_1_20',
  'RR-ACT-AC_L2_3_1_22',
  'RR-ACT-IA_L2_3_5_1',
  'RR-ACT-IA_L2_3_5_2',
  'RR-ACT-SC_L2_3_13_5',
  'RR-ACT-SI_L2_3_14_4',
  'RR-ACT-SI_L2_3_14_5',
];

let realFetch: typeof fetch;
beforeAll(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const file = path.join(KNOWLEDGE, decodeURI(String(url)).replace(/^\/knowledge\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text } as unknown as Response;
  }) as typeof fetch;
  _resetKnowledgeCache();
});
afterAll(() => {
  globalThis.fetch = realFetch;
  _resetKnowledgeCache();
});

/** The pre-FIN-26b residue (no phantom filter). */
async function unfilteredResidue(stacks: string[], facts: InterviewFact[]): Promise<Set<string>> {
  const scorable = scorableFacts(expandLegacyReadinessFacts(facts));
  const si = scenarioSiBaseline(scorable, stacks);
  const { selected } = await selectActivities(si);
  return residueActivities(selected, cascadeScope(mapToPreamble(stacks, scorable), si));
}

describe('FIN-26b: phantom L2-twin RR activities are never asked', () => {
  it('the phantom set is the 17 register rows, each with an L1 twin node in the graph', () => {
    expect(PHANTOM_RR_ACTIVITY_IDS.size).toBe(17);
    const ids = new Set(QUESTION_GRAPH.map((n) => n.id));
    for (const id of PHANTOM_RR_ACTIVITY_IDS) {
      expect(ids.has(id), id).toBe(true); // the node stays (facts still map through it)
      expect(ids.has(id.replace('_L2_', '_L1_')), `${id} L1 twin`).toBe(true);
    }
  });

  for (const x of ['a', 'b', 'c', 'd']) {
    it(`fixture ${x}: no phantom is asked; only phantoms left the asked set`, async () => {
      const s = session(x);
      const stacks: string[] = s.selected_stacks ?? [];
      const before = await unfilteredResidue(stacks, s.facts);
      const after = await readinessResidueIds(stacks, expandLegacyReadinessFacts(s.facts));
      const removed = [...before].filter((id) => !after.has(id)).sort();
      expect(removed.every((id) => PHANTOM_RR_ACTIVITY_IDS.has(id))).toBe(true);
      expect([...after].filter((id) => !before.has(id))).toEqual([]);
      // The pre-FIN-26b asked graph (loadQuestionGraph without the filter): its phantoms are LOG-FIN-26's seven.
      const all = expandLegacyReadinessFacts(s.facts);
      const askedBefore = pruneByCoverage(
        stackFilteredGraph(stacks).filter((n) => !n.alias_of && (!isRrActivityNode(n) || before.has(n.id))),
        all
      );
      const phantomsBefore = askedBefore.filter((n) => PHANTOM_RR_ACTIVITY_IDS.has(n.id)).map((n) => n.id).sort();
      expect(phantomsBefore).toEqual(x === 'b' ? [] : ASKED_BEFORE);
      const asked = await loadQuestionGraph(stacks, s.facts);
      expect(asked.filter((n) => PHANTOM_RR_ACTIVITY_IDS.has(n.id))).toEqual([]);
      // Nothing else in the asked graph changed.
      expect(asked.map((n) => n.id)).toEqual(askedBefore.filter((n) => !PHANTOM_RR_ACTIVITY_IDS.has(n.id)).map((n) => n.id));
    });

    it(`fixture ${x}: AR5 - the posture is identical with or without the phantom nodes in the asked graph`, async () => {
      const s = session(x);
      const stacks: string[] = s.selected_stacks ?? [];
      const askedNow = await loadQuestionGraph(stacks);
      const askedBefore = [...askedNow, ...QUESTION_GRAPH.filter((n) => PHANTOM_RR_ACTIVITY_IDS.has(n.id))];
      // A recorded answer for a phantom (e.g. an imported session) still scores the same either way.
      const extra: InterviewFact = {
        question_id: 'RR-ACT-AC_L2_3_1_20',
        question_text: 'phantom',
        answer: 'yes',
        provenance: 'operator_interview',
        confidence: 'high',
        source: 'synthetic-interview:fin26b',
        recorded_at: '2026-10-31T00:00:00.000Z',
      } as InterviewFact;
      for (const facts of [s.facts as InterviewFact[], [...(s.facts as InterviewFact[]), extra]]) {
        const routed = routeFacts(scorableFacts(facts));
        const a = await scoreFacts(routed, askedNow, stacks, { preamble: s.preamble ?? null });
        const b = await scoreFacts(routed, askedBefore, stacks, { preamble: s.preamble ?? null });
        expect(a.posture.ces.requirement_results).toEqual(b.posture.ces.requirement_results);
        expect(a.posture.ces.control_status_summary).toEqual(b.posture.ces.control_status_summary);
        expect(a.conservativeScore).toBe(b.conservativeScore);
      }
    });
  }
});
