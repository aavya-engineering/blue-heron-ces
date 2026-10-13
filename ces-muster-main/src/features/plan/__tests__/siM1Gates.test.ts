// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-3 M1 gates (a), (d), and the score-leak defense.
//   (a) derivation coverage — N of 26 SIT questions derive for the reference
//       context, every derived answer carries a provenance class + source pointer.
//   (d) the interview residue is exactly the un-derived SIT questions (pruning).
//   score-leak — plan-input facts flowing through the same store contribute
//       ZERO to SPRS (brutal-critic "score leak" surface).
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { deriveSitFacts, residueIds, sitProvenanceOf } from '../siDerivation';
import { buildSiPlanInputNodes, residueSiNodes, type SiBankQuestion } from '../siResidue';
import { requirementStatuses } from '@/features/export/readinessResultService';
import { computeSprs } from '@/features/scoring/sprsCalc';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import type { InterviewFact } from '@/shared/types/engagement';

function bankQuestions(): SiBankQuestion[] {
  const d = load(
    fs.readFileSync(path.resolve('public/knowledge', 'primed SI Question Bank.yaml'), 'utf8')
  ) as { ces?: { question_bank?: { questions?: SiBankQuestion[] } } };
  return d.ces?.question_bank?.questions ?? [];
}

/** Extract si_baseline.* -> enum from the SI schema (for residue option rendering). */
function schemaEnums(): Record<string, string[]> {
  const s = JSON.parse(
    fs.readFileSync(path.resolve('public/schemas/planner', 'CES SIT Strategic Intent Baseline.schema.json'), 'utf8')
  );
  // Minimal: map by the enum def names the SI fields reference. The residue node
  // builder tolerates missing enums (free-text), so this need not be exhaustive.
  const out: Record<string, string[]> = {};
  const defs = s.$defs ?? {};
  const byName: Record<string, string> = {
    'si_baseline.scope.boundary_strategy': 'boundary_strategy',
    'si_baseline.scope.deployment_posture': 'deployment_posture',
    'si_baseline.target.cui_presence': 'cui_presence_enum',
    'si_baseline.operations.byod_posture': 'byod_posture',
    'si_baseline.operations.collaboration_mode': 'collaboration_mode',
  };
  for (const [field, defName] of Object.entries(byName)) {
    if (defs[defName]?.enum) out[field] = defs[defName].enum;
  }
  return out;
}

const VFS_CTX = { selectedStacks: ['m365_e5_gcc'] };
const BANK = bankQuestions();
const TOTAL = BANK.length; // computed denominator (F6: 26, not the goal's 31)

describe('M1 gate (a): SIT derivation coverage', () => {
  test('a computed number of the 26 SIT questions derive from the reference context', () => {
    const { facts, derivedIds } = deriveSitFacts(VFS_CTX);
    expect(TOTAL).toBe(26); // F6: the bank has 26 questions, not the goal's 31
    expect(derivedIds.length).toBeGreaterThan(0);
    expect(derivedIds.length).toBeLessThanOrEqual(TOTAL);
    // Every derived answer carries a provenance class + a source pointer.
    for (const f of facts) {
      expect(f.provenance).toMatch(/^derived:si:[a-z]+:[a-z0-9_-]+$/);
      expect(['system_observation', 'client_assertion']).toContain(sitProvenanceOf(f.provenance));
      expect(f.confidence).not.toBe('unknown'); // so it actually prunes
    }
  });
});

describe('M1 gate (d): interview residue is exactly the un-derived SIT questions', () => {
  test('residueSiNodes excludes derived questions and covers the rest', () => {
    const { facts, derivedIds } = deriveSitFacts(VFS_CTX);
    const allNodes = buildSiPlanInputNodes(BANK, schemaEnums());
    const residue = residueSiNodes(allNodes, facts);
    const residueNodeIds = residue.map((n) => n.id).sort();
    const expected = residueIds(BANK.map((q) => q.id), derivedIds).sort();
    expect(residueNodeIds).toEqual(expected);
    // No derived id survives into the residue.
    for (const id of derivedIds) expect(residueNodeIds).not.toContain(id);
  });

  test('every SIT plan-input node carries plan_input and empty mapped_requirements', () => {
    const allNodes = buildSiPlanInputNodes(BANK, schemaEnums());
    expect(allNodes.length).toBe(TOTAL);
    for (const n of allNodes) {
      expect(n.plan_input?.contract).toBe('si_baseline');
      expect(n.plan_input?.field).toBeTruthy();
      expect(n.mapped_requirements).toEqual([]);
    }
  });
});

describe('M1 score-leak: plan-input facts contribute ZERO to SPRS', () => {
  test('SPRS with derived SIT facts === SPRS without', () => {
    // A couple of real RR facts so SPRS is non-trivial.
    const rrFacts: InterviewFact[] = [
      { question_id: 'iam-001', question_text: '', answer: 'no', provenance: 'interview', confidence: 'high', recorded_at: '1970-01-01T00:00:00.000Z' },
      { question_id: 'iam-002', question_text: '', answer: 'yes', provenance: 'interview', confidence: 'high', recorded_at: '1970-01-01T00:00:00.000Z' },
    ];
    const { facts: planFacts } = deriveSitFacts(VFS_CTX);
    expect(planFacts.length).toBeGreaterThan(0); // the test is meaningful

    const without = computeSprs(requirementStatuses(rrFacts, QUESTION_GRAPH));
    const withPlan = computeSprs(requirementStatuses([...rrFacts, ...planFacts], QUESTION_GRAPH));
    expect(withPlan.sprs).toBe(without.sprs);
    expect(withPlan.assessed_count).toBe(without.assessed_count);
  });
});
