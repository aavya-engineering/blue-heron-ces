// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W2.4 — PoamGenerator reads the real mission plan (role from the step's `owner_role`; date from
 * the milestone whose `phase_tasks` lists the step) and computes `scoreThresholdMet` from the
 * assessed SPRS (was hard-coded true). MP shape = the pushed MP (`outputs.human_readable_mission_plan`).
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { PoamGenerator, CONDITIONAL_SPRS_THRESHOLD } from '../../src/eo/poam/PoamGenerator';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const weights: { controls: Array<{ nist_ref: string; control_id: string; weight: number; poam_allowed: boolean }>; poam_prohibited: string[] } =
  JSON.parse(fs.readFileSync(sprsWeightsPath, 'utf-8'));

/** A snapshot where every control is met except `notMet` (by control id). */
function snapshot(notMet: string[], notAssessed: string[] = []): any {
  return {
    snapshotId: 'w24-snap', tenantId: '00000000-0000-4000-8000-0000000024aa', generatedAt: '2026-10-27T00:00:00Z',
    controls: weights.controls.map(w => ({
      control_id: w.control_id, nist_ref: w.nist_ref, sources: [],
      status: notMet.includes(w.control_id) ? 'not_met' : notAssessed.includes(w.control_id) ? 'not_assessed' : 'met',
    })),
  };
}

const onePointEligible = weights.controls
  .filter(w => w.weight === 1 && w.poam_allowed && !weights.poam_prohibited.includes(w.nist_ref))
  .map(w => w.control_id);

const gen = () => new PoamGenerator(controlsRefPath, sprsWeightsPath, []);

describe('W2.4: buildMpLookup reads the real MP steps', () => {
  const [C1, C2, C3, C4] = onePointEligible;
  const mp = {
    ces: {},
    outputs: {
      human_readable_mission_plan: {
        milestones: [
          // phase_tasks carry `task_…` ids; step ids are `step_task_…`
          { id: 'MS-1', target_date: '2026-12-29', phase_tasks: [`task_${C1}_x`, `step_task_${C2}_y`] },
          // a milestone with no phase_tasks (the run-20 MS-2 shape)
          { id: 'MS-2', target_date: '2027-01-25' },
        ],
        steps: [
          { id: `step_task_${C1}_x`, control_coverage: [{ control_id: C1 }], owner_role: 'compliance_engineer',
            what_to_do: ['  → M365: line one', '  → Portal: line two'] },
          { id: `step_task_${C2}_y`, control_coverage: [{ control_id: C2 }], owner_role: 'security_admin', what_to_do: 'Do the thing' },
          // not in any milestone: falls back to the step's own target_date
          { id: `step_task_${C3}_z`, control_coverage: [{ control_id: C3 }], owner_role: 'it_admin', what_to_do: 'x', target_date: '2027-03-01' },
        ],
      },
    },
  };

  it('role from owner_role; date from the milestone listing the step (with or without the step_ prefix)', () => {
    const poam = gen().generate({ assessment: snapshot([C1, C2, C3, C4]), missionPlan: mp });
    const byId = new Map(poam.items.map(i => [i.control_id, i]));
    expect(byId.get(C1)!.responsibleParty).toBe('compliance_engineer');
    expect(byId.get(C1)!.estimatedCompletionDate).toBe('2026-12-29');
    expect(byId.get(C2)!.responsibleParty).toBe('security_admin');
    expect(byId.get(C2)!.estimatedCompletionDate).toBe('2026-12-29');
    expect(byId.get(C3)!.estimatedCompletionDate).toBe('2027-03-01');
    // no MP step for C4: unchanged defaults
    expect(byId.get(C4)!.responsibleParty).toBe('TBD');
    expect(byId.get(C4)!.estimatedCompletionDate).toBe('');
  });

  it('an array what_to_do becomes newline-joined text, never "[object]" or a raw array', () => {
    const poam = gen().generate({ assessment: snapshot([C1]), missionPlan: mp });
    const item = poam.items.find(i => i.control_id === C1)!;
    expect(typeof item.plannedCorrectiveAction).toBe('string');
    expect(item.plannedCorrectiveAction).toBe('  → M365: line one\n  → Portal: line two');
  });

  it('the legacy flat `steps` shape still works', () => {
    const legacy = { steps: [{ id: 's1', control_coverage: [{ control_id: C1 }], owner_role: 'legacy_role', target_date: '2026-11-01', what_to_do: 'legacy' }] };
    const item = gen().generate({ assessment: snapshot([C1]), missionPlan: legacy }).items.find(i => i.control_id === C1)!;
    expect(item.responsibleParty).toBe('legacy_role');
    expect(item.estimatedCompletionDate).toBe('2026-11-01');
    expect(item.plannedCorrectiveAction).toBe('legacy');
  });
});

describe('W2.4: scoreThresholdMet is computed from the assessed SPRS', () => {
  it('threshold is 88 (the EligibilityChecker boundary)', () => {
    expect(CONDITIONAL_SPRS_THRESHOLD).toBe(88);
  });

  it('true at 110', () => {
    const poam = gen().generate({ assessment: snapshot([]) });
    expect(poam.sprsScore).toBe(110);
    expect(poam.eligibility.scoreThresholdMet).toBe(true);
  });

  it('true at exactly 88, false at 87', () => {
    const at88 = gen().generate({ assessment: snapshot(onePointEligible.slice(0, 22)) });
    expect(at88.sprsScore).toBe(88);
    expect(at88.eligibility.scoreThresholdMet).toBe(true);
    const at87 = gen().generate({ assessment: snapshot(onePointEligible.slice(0, 23)) });
    expect(at87.sprsScore).toBe(87);
    expect(at87.eligibility.scoreThresholdMet).toBe(false);
  });

  it('false at a run-20-like score (SPRS 33)', () => {
    // 77 points off 110: every 1-point eligible control plus enough 5-pointers.
    const fives = weights.controls.filter(w => w.weight === 5).map(w => w.control_id);
    let notMet = [...onePointEligible];
    let k = 0;
    const score = () => gen().generate({ assessment: snapshot(notMet) }).sprsScore;
    while (score() > 33 && k < fives.length) notMet = [...notMet, fives[k++]];
    const poam = gen().generate({ assessment: snapshot(notMet) });
    expect(poam.sprsScore).toBeLessThanOrEqual(33);
    expect(poam.eligibility.scoreThresholdMet).toBe(false);
  });
});
