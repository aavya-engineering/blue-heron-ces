// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-26b (note 42, AC.L2-3.1.11): PI.ODP.017, the sign-in frequency bound in hours.
// The profile holds the answer as given, else the CES baseline "8" (defaulted). Only an
// ANSWERED value of 1..8 reaches the Tenant Manifest; an answer never relaxes the 8 h
// baseline (founder ruling 2, 2026-10-29).
import { describe, test, expect } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import {
  annotateVerificationRows,
  controlExpectations,
  SIGN_IN_FREQUENCY_MAX_HOURS,
  type ExpectationInputs,
} from '../verificationExpectations';
import { OPERATOR_PROVENANCE_KEY } from '../operatorValues';
import { buildPolicyInputsProfile, resolveDefaultedPolicyValues } from '@/features/plan/policy/policyInputsProfile';
import { buildPlanArtifacts } from '@/features/plan/tenantManifestAdapter';
import { loadBanks, sitAnswers } from '@/features/plan/__tests__/planTestSupport';

const BANKS = loadBanks();
const fact = (id: string, a: string, provenance = 'operator_interview'): InterviewFact =>
  ({
    question_id: id,
    question_text: id,
    answer: a,
    provenance,
    confidence: 'high',
    source: 'synthetic-interview:fin26b',
    recorded_at: '2026-10-31T00:00:00.000Z',
  }) as InterviewFact;

const BREAK_GLASS = {
  breakGlassUserId: '00000000-0000-4000-8000-00000000b001',
  [OPERATOR_PROVENANCE_KEY]: { values: { breakGlassUserId: 'asked' } },
};
const inputs = (answer: string | null, tenantIdentity: Record<string, unknown> | undefined = BREAK_GLASS): ExpectationInputs => ({
  tenantIdentity,
  policyValues: resolveDefaultedPolicyValues(answer === null ? [] : [fact('PI.ODP.017', answer)], BANKS.policyInputsBank),
  sitAnswers: {},
});
const SIF = (value: number) => ({ path: '$.sessionControls.signInFrequency.value', op: 'lte', value, source: 'answered' });
const BG = { path: '$.conditions.users.excludeUsers', op: 'contains', value: BREAK_GLASS.breakGlassUserId, source: 'answered' };

describe('FIN-26b: PI.ODP.017 profile half', () => {
  test('odps.sign_in_frequency_hours is the answer as given, else the CES baseline 8 (defaulted)', () => {
    const none = buildPolicyInputsProfile({ facts: [], party: { name: 'Org' }, missionPlan: null, bank: BANKS.policyInputsBank });
    expect(none.output.odps.sign_in_frequency_hours).toBe('8');
    expect(none.sources.find((s) => s.question_id === 'PI.ODP.017')).toMatchObject({
      provenance: 'defaulted',
      source: 'CES baseline (founder ruling 2)',
      value: '8',
    });
    // PI.ODP.016 keeps its own default source.
    expect(none.sources.find((s) => s.question_id === 'PI.ODP.016')).toMatchObject({ source: 'Muster default (Microsoft time service)' });
    const four = buildPolicyInputsProfile({ facts: [fact('PI.ODP.017', '4')], party: { name: 'Org' }, missionPlan: null, bank: BANKS.policyInputsBank });
    expect(four.output.odps.sign_in_frequency_hours).toBe('4');
    expect(four.sources.find((s) => s.question_id === 'PI.ODP.017')).toMatchObject({ provenance: 'answered', value: '4' });
    // A longer answer is kept in the profile (a reconciliation input), never in the TM.
    const twelve = buildPolicyInputsProfile({ facts: [fact('PI.ODP.017', '12')], party: { name: 'Org' }, missionPlan: null, bank: BANKS.policyInputsBank });
    expect(twelve.output.odps.sign_in_frequency_hours).toBe('12');
  });

  test('resolveDefaultedPolicyValues: defaulted 8 with the CES baseline source', () => {
    expect(resolveDefaultedPolicyValues([], BANKS.policyInputsBank)['PI.ODP.017']).toEqual({
      value: '8',
      provenance: 'defaulted',
      source: 'CES baseline (founder ruling 2)',
    });
  });
});

describe('FIN-26b: PI.ODP.017 Tenant Manifest half (founder ruling 2: never relax 8 h)', () => {
  test('the baseline is 8 h', () => expect(SIGN_IN_FREQUENCY_MAX_HOURS).toBe(8));

  test('answered 1..8 -> a second expectation after the break-glass exclusion', () => {
    expect(controlExpectations('AC.L2-3.1.11', inputs('1'))).toEqual([BG, SIF(1)]);
    expect(controlExpectations('AC.L2-3.1.11', inputs('4'))).toEqual([BG, SIF(4)]);
    expect(controlExpectations('AC.L2-3.1.11', inputs(' 8 '))).toEqual([BG, SIF(8)]);
    expect(controlExpectations('AC.L2-3.1.11', inputs('2.5'))).toEqual([BG, SIF(2.5)]);
  });

  test('unanswered, out of range or not a number -> no sign-in row (the 8 h baseline stands)', () => {
    for (const a of [null, '0', '9', '12', '24', '-4', 'eight', '8 hours', '']) {
      expect(controlExpectations('AC.L2-3.1.11', inputs(a)), String(a)).toEqual([BG]);
    }
  });

  test('a discovered value is not an answer: no row', () => {
    const policyValues = resolveDefaultedPolicyValues([fact('PI.ODP.017', '4', 'auto_detected')], BANKS.policyInputsBank);
    expect(policyValues['PI.ODP.017'].provenance).toBe('discovered');
    expect(controlExpectations('AC.L2-3.1.11', { tenantIdentity: BREAK_GLASS, policyValues, sitAnswers: {} })).toEqual([BG]);
  });

  // DEPTH-7: rows are rebuilt one per objective (AC.L2-3.1.11 has [a] and [b]); break-glass goes to [a], the bound to [b].
  test('placement: the machine control gets two objective rows -> [a] break-glass, [b] the sign-in bound; nothing unplaced', () => {
    const nc = [
      {
        control_id: 'AC.L2-3.1.11',
        verification: [
          { method: 'config_export' },
          { method: 'config_export' },
          { method: 'config_export' },
          { method: 'manual' },
        ] as Array<Record<string, unknown>>,
      },
    ];
    const baseline = annotateVerificationRows(structuredClone(nc) as never, inputs(null));
    const counts = annotateVerificationRows(nc as never, inputs('4'));
    expect(nc[0].verification.map((r) => r.objective_id)).toEqual(['AC.L2-3.1.11[a]', 'AC.L2-3.1.11[b]']);
    expect(nc[0].verification[0].expected_value).toEqual(BG);
    expect(nc[0].verification[1].expected_value).toEqual(SIF(4));
    expect(nc[0].verification.every((r) => r.method === 'config_export')).toBe(true);
    // The new expectation is placed (other controls absent from this TM stay unplaced as before).
    expect(counts.unplaced).toBe(baseline.unplaced);
    expect(counts.withExpected).toBe(baseline.withExpected + 1);
  });

  test('the compiled TM: an answered 4 reaches an AC.L2-3.1.11 machine row; unanswered, none carries it', () => {
    const tmRows = (facts: InterviewFact[]) => {
      const tm = buildPlanArtifacts(
        {
          sitAnswers: sitAnswers({ deploymentPosture: 'cloud_only' }),
          requirementResults: [{ requirement_id: 'AC.L2-3.1.11', status: 'not_met' }],
          tenantConfig: null,
          facts,
        },
        BANKS
      ).tenantManifest as unknown as {
        tenant_manifest: { normative_controls: Array<{ control_id: string; verification: Array<Record<string, unknown>> }> };
      };
      return tm.tenant_manifest.normative_controls.find((c) => c.control_id === 'AC.L2-3.1.11')?.verification ?? [];
    };
    const answered = tmRows([fact('PI.ODP.017', '4')]);
    expect(answered.map((r) => r.expected_value)).toContainEqual(SIF(4));
    const none = tmRows([]);
    expect(none.some((r) => JSON.stringify(r.expected_value ?? '').includes('signInFrequency'))).toBe(false);
    const twelve = tmRows([fact('PI.ODP.017', '12')]);
    expect(twelve.some((r) => JSON.stringify(r.expected_value ?? '').includes('signInFrequency'))).toBe(false);
  });
});
