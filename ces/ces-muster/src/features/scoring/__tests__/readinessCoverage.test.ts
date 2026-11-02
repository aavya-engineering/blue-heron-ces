// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-07 Done-when (decision D5), against the MG-04 fixture customers:
//   1. for each fixture, the selected and excluded RR activity sets (with the
//      exclusion reasons) equal Planner's golden question set, across all 165;
//   2. the RR Question Set artifact Muster builds carries Planner's questions;
//   3. the posture comes from the full set: with Planner's preamble, the bulk
//      cascade over the scenario SI reproduces Planner's requirement results;
//   4. every RR activity the interview still asks has a justified register row.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { expandLegacyReadinessFacts } from '@/features/interview/questionGraph';
import { loadQuestionGraph, isRrActivityNode } from '@/features/interview/questionGraphService';
import { scorableFacts } from '../draftSemantics';
import { scoreFacts } from '../scoringService';
import { _resetKnowledgeCache } from '../knowledgeLoader';
import { buildRRQuestionSet, scenarioSiBaseline, selectActivities, READINESS_INDEX } from '../readinessScope';
import register from '@/features/interview/questionRegister.json';

const CUSTOMERS = path.resolve(process.cwd(), 'src/features/plan/__fixtures__/customers');
const KNOWLEDGE = path.resolve(process.cwd(), 'public/knowledge');
const FIXTURES = ['a', 'b', 'c', 'd'];

const json = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const golden = (x: string, name: string) => json(path.join(CUSTOMERS, x, 'planner-golden', `${name}.json`));
const session = (x: string) => json(path.join(CUSTOMERS, x, 'muster-session.json')).session;

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

describe('MG-07 readiness coverage — all 165 RR activities, per scenario', () => {
  it('the readiness index holds every RR activity once', () => {
    const ids = READINESS_INDEX.activities.map((a) => a.id);
    expect(new Set(ids).size).toBe(165);
  });

  for (const x of FIXTURES) {
    it(`fixture ${x}: selected and excluded activities (with reasons) equal Planner's`, async () => {
      const s = session(x);
      const si = scenarioSiBaseline(expandLegacyReadinessFacts(scorableFacts(s.facts)), s.selected_stacks ?? []);
      const ours = await selectActivities(si);
      const theirs = golden(x, 'rr-question-set').ces.selection;
      expect([...ours.selected].sort()).toEqual([...theirs.selected_activity_ids].sort());
      const reasons = (e: Array<{ activity_id: string; reason: string }>) => e.map((r) => `${r.activity_id} :: ${r.reason}`).sort();
      expect(reasons(ours.excluded)).toEqual(reasons(theirs.excluded_activity_ids));
      expect(ours.selected.length + ours.excluded.length).toBe(165);
    });

    it(`fixture ${x}: the RR Question Set artifact carries Planner's questions and coverage`, async () => {
      const s = session(x);
      const si = scenarioSiBaseline(expandLegacyReadinessFacts(scorableFacts(s.facts)), s.selected_stacks ?? []);
      const yaml = (f: string) => load(fs.readFileSync(path.join(KNOWLEDGE, f), 'utf8'));
      const qs = await buildRRQuestionSet(si, yaml('primed RR Question Bank.yaml'), {
        cmmcRequirements: yaml('domain CES CMMC Fundamental Requirements Store.yaml'),
        assessorKB: yaml('domain Assessor Approach Knowledge Base.yaml'),
      });
      const g = golden(x, 'rr-question-set').ces;
      const byId = (qq: Array<{ question_id: string; mapped_requirements: string[]; answer_type: string }>) =>
        qq.map((q) => `${q.question_id}|${q.mapped_requirements.join(',')}|${q.answer_type}`).sort();
      expect(byId(qs.ces.questions)).toEqual(byId(g.questions));
      expect([...qs.ces.coverage.requirements_covered].sort()).toEqual([...g.coverage.requirements_covered].sort());
      expect(qs.ces.scenario.tags).toEqual(g.scenario.tags);
    });

    it(`fixture ${x}: with Planner's preamble the full-set posture equals Planner's requirement results`, async () => {
      const s = session(x);
      const facts = expandLegacyReadinessFacts(scorableFacts(s.facts));
      const si = scenarioSiBaseline(facts, s.selected_stacks ?? []);
      const { posture } = await scoreFacts([], [], s.selected_stacks ?? [], { preamble: s.preamble, siBaseline: si });
      const key = (r: { requirement_id: string; status: string }) => `${r.requirement_id}=${r.status}`;
      const g = golden(x, 'readiness-posture').ces;
      expect(posture.ces.requirement_results.map(key).sort()).toEqual(g.requirement_results.map(key).sort());
      expect(posture.ces.control_status_summary).toEqual(g.control_status_summary);
    });

    it(`fixture ${x}: every RR activity still asked has a justified register row`, async () => {
      const s = session(x);
      const asked = (await loadQuestionGraph(s.selected_stacks ?? [], s.facts)).filter(isRrActivityNode);
      const rows = new Map(register.rows.map((r) => [r.id, r]));
      for (const n of asked) {
        expect(rows.get(n.id)?.status, n.id).toBe('justified');
      }
    });
  }
});
