// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node

// FIN-32b (LOG-FIN-32 S-B (c)): the pinned Policy Inputs bank's 15 organisation-defined
// parameters (PI.ODP.001-015) are optional question nodes, so the UI can type every answer
// an answers file carries. Pinned here:
//   - each node is the bank question verbatim (prompt, options, number input, binding);
//   - it never scores: an ODP fact maps to no requirement (before FIN-32b it had no node and
//     scoring gave it a synthetic `scre.PI.ODP.nnn` requirement);
//   - each has a justified register row;
//   - the profile still resolves answered over defaulted, and unanswered stays the bank value.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { describe, test, expect } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import { POLICY_INPUT_NODES } from '../policyInputNodes';
import { QUESTION_GRAPH } from '../questionGraph';
import { buildQuestionRegister } from '../questionRegister';
import { parsePlanInputAnswer } from '../siPlanInputNodes';
import { mapFactsToRRTAnswers } from '@/features/scoring/scoringService';
import { buildPolicyInputsProfile, resolveDefaultedPolicyValues } from '@/features/plan/policy/policyInputsProfile';

interface BankQ {
  id: string;
  prompt: string;
  answer_type: string;
  options?: string[];
  recommended?: number | string;
  bindings?: { policy_inputs?: string };
}
const bankRaw = load(
  fs.readFileSync(path.resolve('public/knowledge', 'primed Policy Inputs Question Bank.yaml'), 'utf8')
) as { sections: Array<{ questions: BankQ[] }> };
const BANK_ODPS = bankRaw.sections.flatMap((s) => s.questions).filter((q) => /^PI\.ODP\.0(0[1-9]|1[0-5])$/.test(q.id));
const byId = new Map(QUESTION_GRAPH.map((n) => [n.id, n]));

const fact = (id: string, answer: string): InterviewFact =>
  ({
    question_id: id,
    question_text: id,
    answer,
    provenance: 'operator_interview',
    confidence: 'high',
    source: 'synthetic-interview:fin32b',
    recorded_at: '2026-10-31T00:00:00.000Z',
  }) as InterviewFact;

describe('FIN-32b: the 15 bank ODPs are question nodes', () => {
  test('the bank has exactly PI.ODP.001-015', () => {
    expect(BANK_ODPS.map((q) => q.id)).toEqual(Array.from({ length: 15 }, (_, i) => `PI.ODP.${String(i + 1).padStart(3, '0')}`));
  });

  test.each(BANK_ODPS.map((q) => [q.id, q] as const))('%s is the bank question verbatim', (id, q) => {
    const n = byId.get(id);
    expect(n, `${id} is a graph node`).toBeDefined();
    expect(POLICY_INPUT_NODES.some((p) => p.id === id)).toBe(true);
    expect(n!.text).toBe(q.prompt);
    expect(n!.cluster).toBe('plan-input:policy');
    expect(n!.mapped_requirements).toEqual([]);
    expect(n!.plan_input).toEqual({ contract: 'policy_inputs', field: q.bindings?.policy_inputs });
    if (q.answer_type === 'number') {
      expect(n!.input).toBe('number');
      expect(n!.options).toEqual([]);
      expect(parsePlanInputAnswer('number', String(q.recommended)).ok).toBe(true);
    } else {
      expect(q.answer_type).toBe('single_select');
      expect(n!.input).toBeUndefined();
      expect(n!.options.map((o) => o.value)).toEqual(q.options);
      expect(q.options).toContain(q.recommended);
    }
  });

  test('an ODP fact maps to no requirement (no scre.PI.ODP.nnn synthetic requirement)', () => {
    const facts = BANK_ODPS.map((q) => fact(q.id, String(q.recommended)));
    const mapped = mapFactsToRRTAnswers(facts, QUESTION_GRAPH);
    for (const q of BANK_ODPS) expect(mapped[q.id].mapped_requirements).toEqual([]);
    expect(JSON.stringify(mapped)).not.toContain('scre.');
  });

  test('each has a justified, optional plan-input:policy register row', () => {
    const rows = new Map(buildQuestionRegister().rows.map((r) => [r.id, r]));
    for (const q of BANK_ODPS) {
      const r = rows.get(q.id);
      expect(r, q.id).toBeDefined();
      expect(r!.kind).toBe('plan-input:policy');
      expect(r!.status).toBe('justified');
      expect(r!.optional_for_finish).toBe(true);
      expect(r!.output_fields[0]).toBe(`policy_inputs.${q.bindings?.policy_inputs}`);
    }
  });

  test('the profile: an answer replaces the bank value; unanswered stays defaulted', () => {
    const bank = bankRaw as unknown;
    const none = resolveDefaultedPolicyValues([], bank);
    for (const q of BANK_ODPS) expect(none[q.id]).toMatchObject({ value: q.recommended, provenance: 'defaulted' });
    const typed = resolveDefaultedPolicyValues([fact('PI.ODP.003', '10'), fact('PI.ODP.008', 'Weekly')], bank);
    expect(typed['PI.ODP.003']).toMatchObject({ value: 10, provenance: 'answered' });
    expect(typed['PI.ODP.008']).toMatchObject({ value: 'Weekly', provenance: 'answered' });
    const profile = buildPolicyInputsProfile({ facts: [fact('PI.ODP.003', '10')], party: { name: 'Org' }, missionPlan: null, bank });
    expect(profile.output.odps.session_timeout_minutes).toBe(10);
    expect(profile.sources.find((s) => s.question_id === 'PI.ODP.003')).toMatchObject({ provenance: 'answered', value: '10' });
  });
});
