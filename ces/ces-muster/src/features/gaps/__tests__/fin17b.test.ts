// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-17b (LOG-FIN-17 STOP items 1 and 2): CG-1's gapCompiler default (unanswered SIT-020 = m365_only), the
// mapping of Muster's own gap classes onto ces-shared's GapClassificationEnum, and Gap.evidence_minimum.
import { describe, it, expect } from 'vitest';
import { GapClassificationEnum, ManualMissionPlanSchema } from 'ces-shared/types/mission-plan';
import { toContractGapClassifications } from '../gapCompiler';
import { FIXTURE_RESULTS, FIXTURE_SIT_ANSWERS, freezeEntropy } from '../../plan/__tests__/fixtureInputs';
import { loadBanks } from '../../plan/__tests__/planTestSupport';
import { buildPlanArtifacts } from '../../plan/tenantManifestAdapter';
import type { SITAnswer } from '@/features/plan/engine/types/siBaseline';

const BANKS = loadBanks();
const CONTRACT = new Set<string>(GapClassificationEnum.options);

/** The nine controls m365Alternatives.ts gives an M365-only alternative (gapCompiler INFRA_GAP_CONTROL_IDS). */
const INFRA_ALTERNATIVE_CONTROLS = [
  'AU.L2-3.3.3', 'AU.L2-3.3.4', 'IR.L2-3.6.2', 'SC.L1-3.13.1', 'SC.L1-3.13.5',
  'SC.L2-3.13.2', 'SC.L2-3.13.6', 'SC.L2-3.13.10', 'SI.L2-3.14.7',
];

function sit020(value: string): Record<string, SITAnswer> {
  return {
    'SIT-020': {
      question_id: 'SIT-020',
      answer_type: 'enum',
      raw_answer: value,
      captured_at: '1970-01-01T00:00:00.000Z',
      provenance_class: 'client_assertion',
    } as SITAnswer,
  };
}

function build(sit: Record<string, SITAnswer>) {
  const entropy = freezeEntropy();
  try {
    return buildPlanArtifacts({ sitAnswers: sit, requirementResults: FIXTURE_RESULTS, tenantConfig: null }, BANKS);
  } finally {
    entropy.restore();
  }
}

type Ctl = { requirement_id: string; stamper_action: string; gap_classifications: string[] };
type Step = { id: string; gap_classifications?: string[] };
const controlsOf = (mp: unknown): Ctl[] => (mp as { outputs: { human_readable_mission_plan: { controls: Ctl[] } } }).outputs.human_readable_mission_plan.controls;
const stepsOf = (mp: unknown): Step[] => (mp as { outputs: { human_readable_mission_plan: { steps: Step[] } } }).outputs.human_readable_mission_plan.steps;

const unanswered = build(FIXTURE_SIT_ANSWERS);
const explicitOnly = build({ ...FIXTURE_SIT_ANSWERS, ...sit020('m365_only') });
const explicitAzure = build({ ...FIXTURE_SIT_ANSWERS, ...sit020('m365_azure') });

describe('FIN-17b: gap classes on the shared contract', () => {
  it('maps manual_alternative and control_not_available to manual, drops scoped_out, keeps order without duplicates', () => {
    expect(toContractGapClassifications(['configure', 'manual_alternative'])).toEqual(['configure', 'manual']);
    expect(toContractGapClassifications(['manual', 'control_not_available', 'manual_alternative'])).toEqual(['manual']);
    expect(toContractGapClassifications(['scoped_out'])).toEqual([]);
    expect(toContractGapClassifications(['customize', 'auto_generate'])).toEqual(['customize', 'auto_generate']);
    for (const c of toContractGapClassifications(['configure', 'customize', 'manual', 'auto_generate', 'manual_alternative', 'control_not_available', 'scoped_out'])) {
      expect(CONTRACT.has(c), c).toBe(true);
    }
  });

  it('an explicit m365_only plan (the latent bug) now parses under ManualMissionPlanSchema', () => {
    for (const s of stepsOf(explicitOnly.missionPlan)) {
      for (const c of s.gap_classifications ?? []) expect(CONTRACT.has(c), `${s.id} ${c}`).toBe(true);
    }
    expect(ManualMissionPlanSchema.safeParse(explicitOnly.missionPlan).success).toBe(true);
  });

  it('CG-1: an unanswered SIT-020 compiles exactly as an explicit m365_only, and the plan parses', () => {
    expect(unanswered.gapSet.gaps.map((g) => [g.requirement_id, g.gap_classifications]))
      .toEqual(explicitOnly.gapSet.gaps.map((g) => [g.requirement_id, g.gap_classifications]));
    expect(ManualMissionPlanSchema.safeParse(unanswered.missionPlan).success).toBe(true);
  });

  it('AR5: against m365_azure, the nine alternative controls gain `manual`, and no disposition moves', () => {
    const azure = new Map(controlsOf(explicitAzure.missionPlan).map((c) => [c.requirement_id, c]));
    const gained: string[] = [];
    for (const c of controlsOf(unanswered.missionPlan)) {
      const a = azure.get(c.requirement_id);
      expect(a, c.requirement_id).toBeDefined();
      expect(c.stamper_action, c.requirement_id).toBe(a!.stamper_action);
      if (JSON.stringify(c.gap_classifications) !== JSON.stringify(a!.gap_classifications)) {
        expect(c.gap_classifications).toEqual([...a!.gap_classifications, 'manual']);
        gained.push(c.requirement_id);
      }
    }
    expect(gained.sort()).toEqual([...INFRA_ALTERNATIVE_CONTROLS].sort());
  });
});

describe('FIN-17b: Gap.evidence_minimum (KB-4 remainder)', () => {
  it('every gap carries the reference row evidence minimum when the reference has one', () => {
    const gaps = unanswered.gapSet.gaps;
    expect(gaps.length).toBeGreaterThan(0);
    const withMin = gaps.filter((g) => g.evidence_minimum);
    expect(withMin.length).toBeGreaterThan(0);
    for (const g of withMin) {
      expect(Array.isArray(g.evidence_minimum!.must_have), g.requirement_id).toBe(true);
      expect(Array.isArray(g.evidence_minimum!.nice_to_have), g.requirement_id).toBe(true);
    }
  });
});
