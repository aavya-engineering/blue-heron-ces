// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU MU-10 (F9 closed): the numeric / text / list / time-goal SIT residue is
// askable in the interview and reaches the generated SI Baseline typed.
//
// Before: these eight questions had no interview node (radioRow is enum-only),
// a bare string for G-06 collapsed to goal_type 'unknown', list answers became
// one-element arrays, and the vendored generator dropped dependencies.user_count.
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { SI_PLAN_INPUT_NODES, parsePlanInputAnswer } from '@/features/interview/siPlanInputNodes';
import { sitAnswersFromFacts, buildSiBaselineFromAnswers } from '../siBaselineAdapter';
import type { InterviewFact } from '@/shared/types/engagement';

const bank = load(
  fs.readFileSync(path.resolve('public/knowledge', 'primed SI Question Bank.yaml'), 'utf8')
) as { ces: { question_bank: { questions: Array<{ id: string; sets_its_fields?: string[] }> } } };

const TYPED: Record<string, 'number' | 'text' | 'list' | 'time_goal'> = {
  'G-03': 'list',
  'G-04': 'text',
  'G-06': 'time_goal',
  'S-11': 'number',
  'SIT-022': 'number',
  'SIT-023': 'list',
  'SIT-024': 'number',
  'SIT-025': 'number',
};

function fact(id: string, answer: string): InterviewFact {
  return { question_id: id, question_text: '', answer, provenance: 'operator_interview', confidence: 'high', recorded_at: '1970-01-01T00:00:00.000Z' };
}

describe('typed SIT residue nodes', () => {
  test('the eight non-enum SIT questions are interview nodes with an input kind', () => {
    const graphIds = new Set(QUESTION_GRAPH.map((n) => n.id));
    for (const [id, kind] of Object.entries(TYPED)) {
      const n = SI_PLAN_INPUT_NODES.find((x) => x.id === id);
      expect(n, `${id} node`).toBeTruthy();
      expect(n!.input, `${id} input kind`).toBe(kind);
      expect(n!.options).toEqual([]);
      expect(n!.mapped_requirements).toEqual([]); // score-leak safe
      expect(n!.plan_input?.field).toBe(bank.ces.question_bank.questions.find((q) => q.id === id)?.sets_its_fields?.[0]);
      expect(graphIds.has(id)).toBe(true);
    }
    // Every SI bank question is now an interview node (26 of 26).
    expect(SI_PLAN_INPUT_NODES.map((n) => n.id).sort()).toEqual(bank.ces.question_bank.questions.map((q) => q.id).sort());
  });

  test('parsePlanInputAnswer validates each kind', () => {
    expect(parsePlanInputAnswer('number', '40')).toEqual({ ok: true, value: 40 });
    expect(parsePlanInputAnswer('number', '-1').ok).toBe(false);
    expect(parsePlanInputAnswer('number', 'abc').ok).toBe(false);
    expect(parsePlanInputAnswer('list', 'CTI, Export Controlled ,')).toEqual({ ok: true, value: ['CTI', 'Export Controlled'] });
    expect(parsePlanInputAnswer('list', ' , ').ok).toBe(false);
    expect(parsePlanInputAnswer('text', '  ITAR  ')).toEqual({ ok: true, value: 'ITAR' });
    expect(parsePlanInputAnswer('text', '   ').ok).toBe(false);
    expect(parsePlanInputAnswer('time_goal', 'ASAP')).toEqual({ ok: true, value: { goal_type: 'asap' } });
    expect(parsePlanInputAnswer('time_goal', '2027-06-30; contract award')).toEqual({
      ok: true,
      value: { goal_type: 'by_date', by_date: '2027-06-30', driver: 'contract award' },
    });
    expect(parsePlanInputAnswer('time_goal', '180 days')).toEqual({ ok: true, value: { goal_type: 'within_days', within_days: 180 } });
    expect(parsePlanInputAnswer('time_goal', 'soon-ish').ok).toBe(false);
  });

  test('typed answers reach the generated SI Baseline with their types', () => {
    const answers = sitAnswersFromFacts(
      [
        fact('G-03', 'CTI, Export Controlled'),
        fact('G-04', 'ITAR technical data'),
        fact('G-06', '2027-06-30; DoD contract award'),
        fact('S-11', '40'),
        fact('SIT-022', '35'),
        fact('SIT-023', 'FR1234567890, FR0987654321'),
        fact('SIT-024', '2'),
        fact('SIT-025', '0'),
      ],
      bank
    );
    expect(answers['SIT-022'].answer_type).toBe('number');
    expect(answers['G-06'].answer_type).toBe('structured_object');
    const si = buildSiBaselineFromAnswers(answers, bank).si_baseline;
    expect(si.target.cui_types).toEqual(['CTI', 'Export Controlled']);
    expect(si.target.regulated_data_notes).toBe('ITAR technical data');
    expect(si.assessment.certification_timing_goal).toEqual({
      goal_type: 'by_date',
      by_date: '2027-06-30',
      driver: 'DoD contract award',
    });
    expect(si.scope.in_scope_users_estimate).toBe(40);
    // The bank maps S-11 to BOTH estimates (sets_its_fields has two paths).
    expect(si.scope.in_scope_endpoints_estimate).toBe(40);
    expect(si.dependencies.user_count).toBe(35);
    expect(si.dependencies.fedramp_package_ids).toEqual(['FR1234567890', 'FR0987654321']);
    expect(si.dependencies.physical_facility_count).toBe(2);
    expect(si.dependencies.customer_equipment_count).toBe(0);
  });
});
