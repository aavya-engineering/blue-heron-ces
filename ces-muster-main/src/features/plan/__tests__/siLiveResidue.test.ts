// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-3 M1 follow-up (F8): the SIT plan-input residue is live in the
// question graph. This pins:
//   - parity: the static SI_PLAN_INPUT_NODES match the primed bank (ids/fields)
//     and the SI schema (options) — the drift guard for the transcription.
//   - score-leak on BOTH scoring paths: an answered plan-input fact resolves to
//     empty mapped_requirements in requirementStatuses AND in
//     mapFactsToRRTAnswers (the scoreFacts path), never the `scre.<id>` fallback.
//   - the capture loop: an answered residue fact -> SITAnswers -> the SI
//     baseline reflects it (interview answer reaches the generated plan).
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { SI_PLAN_INPUT_NODES } from '@/features/interview/siPlanInputNodes';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { requirementStatuses } from '@/features/export/readinessResultService';
import { computeSprs } from '@/features/scoring/sprsCalc';
import { mapFactsToRRTAnswers } from '@/features/scoring/scoringService';
import { sitAnswersFromFacts, buildSiBaselineFromAnswers } from '../siBaselineAdapter';
import type { InterviewFact } from '@/shared/types/engagement';

const bank = load(
  fs.readFileSync(path.resolve('public/knowledge', 'primed SI Question Bank.yaml'), 'utf8')
) as { ces: { question_bank: { questions: Array<{ id: string; sets_its_fields?: string[] }> } } };
const bankById = new Map(bank.ces.question_bank.questions.map((q) => [q.id, q]));

const siSchema = JSON.parse(
  fs.readFileSync(path.resolve('public/schemas/planner', 'CES SIT Strategic Intent Baseline.schema.json'), 'utf8')
);

type SchemaNode = { $ref?: string; enum?: string[]; properties?: Record<string, SchemaNode> };
function enumForField(field: string): string[] | undefined {
  const defs: Record<string, SchemaNode> = siSchema.$defs ?? {};
  const resolve = (n: SchemaNode | undefined): SchemaNode | undefined =>
    n && n.$ref ? defs[n.$ref.split('/').pop() as string] ?? {} : n;
  let node = resolve(siSchema.properties.si_baseline as SchemaNode);
  for (const seg of field.split('.').slice(1)) {
    node = resolve(node?.properties?.[seg]);
    if (!node) return undefined;
  }
  return node?.enum;
}

describe('F8 parity: static SIT nodes match the bank + schema', () => {
  test('every node maps to a real bank question and its sets_its_fields[0]', () => {
    for (const n of SI_PLAN_INPUT_NODES) {
      const q = bankById.get(n.id);
      expect(q, `node ${n.id} must exist in the bank`).toBeTruthy();
      expect(n.plan_input?.field).toBe(q!.sets_its_fields?.[0]);
      expect(n.mapped_requirements).toEqual([]); // score-leak safe
      expect(n.cluster).toBe('plan-input:si');
    }
  });

  test('node options match the SI schema enums for their field', () => {
    for (const n of SI_PLAN_INPUT_NODES) {
      const schemaEnum = enumForField(n.plan_input!.field);
      if (!schemaEnum) continue; // only enum-optioned fields are live nodes
      expect(n.options.map((o) => o.value)).toEqual(schemaEnum);
    }
  });

  // FC-MU (MU-10): the six operations postures (S-25..S-30) are enums in the
  // vendored SIBaseline type but absent from the stale SI schema (F5). Their
  // parity source is the vendored type (verbatim from ces-planner, drift-pinned):
  // the node's options must equal that field's string-literal union.
  test('S-25..S-30 are live enum nodes whose options equal the vendored SIBaseline type union', () => {
    const typeSrc = fs.readFileSync(path.resolve('src/vendored/ces-planner/types/siBaseline.ts'), 'utf8');
    const unionFor = (prop: string): string[] => {
      const m = new RegExp(`\\b${prop}\\?:([^;]+);`).exec(typeSrc);
      expect(m, `vendored type declares ${prop}`).not.toBeNull();
      return [...m![1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    };
    const ids = ['S-25', 'S-26', 'S-27', 'S-28', 'S-29', 'S-30'];
    for (const id of ids) {
      const n = SI_PLAN_INPUT_NODES.find((x) => x.id === id);
      expect(n, `${id} is a live SI plan-input node`).toBeTruthy();
      const field = n!.plan_input!.field;
      expect(enumForField(field), `${field} is absent from the stale schema`).toBeUndefined();
      expect(n!.options.map((o) => o.value)).toEqual(unionFor(field.split('.').pop()!));
    }
  });

  // FC-MU (MU-10) closed F9: a node is EITHER an enum node (options, no input
  // kind) OR a typed-input node (an input kind, no options) — never neither.
  test('every live node is askable: enum options xor a typed input kind', () => {
    for (const n of SI_PLAN_INPUT_NODES) {
      if (n.input) expect(n.options, n.id).toEqual([]);
      else expect(n.options.length, n.id).toBeGreaterThan(0);
    }
  });

  test('SI plan-input nodes are present in the real QUESTION_GRAPH', () => {
    const graphIds = new Set(QUESTION_GRAPH.map((n) => n.id));
    for (const n of SI_PLAN_INPUT_NODES) expect(graphIds.has(n.id)).toBe(true);
  });
});

describe('F8 score-leak: answered plan-input facts move no score, on either path', () => {
  const rrFacts: InterviewFact[] = [
    { question_id: 'iam-001', question_text: '', answer: 'no', provenance: 'operator_interview', confidence: 'high', recorded_at: '1970-01-01T00:00:00.000Z' },
  ];
  // An answered residue fact, as the live interview would record it.
  const planFacts: InterviewFact[] = [
    { question_id: 'G-07', question_text: '', answer: 'multiple_enclaves', provenance: 'operator_interview', confidence: 'high', recorded_at: '1970-01-01T00:00:00.000Z' },
    { question_id: 'G-02', question_text: '', answer: 'cui_present', provenance: 'operator_interview', confidence: 'high', recorded_at: '1970-01-01T00:00:00.000Z' },
  ];

  test('requirementStatuses/SPRS path: unchanged with plan facts present', () => {
    const without = computeSprs(requirementStatuses(rrFacts, QUESTION_GRAPH));
    const withPlan = computeSprs(requirementStatuses([...rrFacts, ...planFacts], QUESTION_GRAPH));
    expect(withPlan.sprs).toBe(without.sprs);
    expect(withPlan.assessed_count).toBe(without.assessed_count);
  });

  test('scoreFacts path: plan facts resolve to empty mapped_requirements (no scre.<id> leak)', () => {
    const mapped = mapFactsToRRTAnswers(planFacts, QUESTION_GRAPH);
    for (const f of planFacts) {
      expect(mapped[f.question_id].mapped_requirements).toEqual([]);
    }
  });
});

describe('F8 capture loop: an answered residue fact reaches the SI baseline', () => {
  test('interview-answered boundary strategy flows into the generated baseline', () => {
    const answers = sitAnswersFromFacts(
      [{ question_id: 'G-07', question_text: '', answer: 'multiple_enclaves', provenance: 'operator_interview', confidence: 'high', recorded_at: '1970-01-01T00:00:00.000Z' }],
      bank
    );
    const baseline = buildSiBaselineFromAnswers(answers, bank);
    expect(baseline.si_baseline.scope.boundary_strategy).toBe('multiple_enclaves');
  });
});
