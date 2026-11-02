// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// verificationExpectations.ts — W3 (synthetic customers), CONTRACT CHANGE
// (MG-27): the values Muster derived, written onto the Tenant Manifest's
// normative_controls[].verification[] rows as `expected_value` (ces-shared
// 2.9.0 CheckSchema), so Stamper's config_export postcheck can compare state
// instead of counting evidence files.
//
// Rules:
//   - (W3 to W8) Rows were annotated, never added or removed. DEPTH-7 rebuilds
//     them per objective (below).
//   - Only machine-checked rows (method other than `manual`) carry an
//     expectation; a machine row without one gets `presence_only: true`.
//     Manual rows carry neither.
//   - A placeholder is not an expectation: an operator value with provenance
//     `defaulted` or `archetype` gives none.
//   - `path` is a JSONPath into the Microsoft object (Graph or Exchange shape)
//     the control's configuration returns. Muster does not read Stamper's
//     registry (tool boundary).
//   - `source`: `answered` = an interview answer (an ODP answer or an asked
//     operator value); `bank` = the Policy Inputs bank's recommended value;
//     `odp` = an ODP value with any other provenance (discovered); `tcp` = an
//     operator value the TCP derivation discovered or derived; `si` = an SI
//     Baseline posture the session answered or discovered (sitAnswers come only
//     from session facts, never a bank default; an archetype prior is skipped).
//
// DEPTH-7 (depth plan §4, CONTRACT CHANGE): the rows are no longer annotated in place. Each
// practice's verification[] is rebuilt as ONE row per assessment objective (ces-shared assessor
// approach KB, objectiveSpecs.ts): `objective_id`, the KB `assessment_methods`
// (examine/interview/test) and the determination text. `method` stays in Stamper's check enum: the
// control's former machine method (config_export, api_query, ...) when it had a machine row, else
// `manual`. Each expectation goes onto the objective EXPECTATION_OBJECTIVES names; a machine row
// without one gets `presence_only: true`. The three boilerplate rows, the [TCP Verification] rows
// and every row of a control id outside the 110 practices (phantom L2 twins such as AC.L2-3.1.1,
// FOUNDATION, scre.OPV.*, btc_gate_*, cui_*) are dropped: such a control keeps `verification: []`.
import type { SITAnswer } from '@/features/plan/engine/types/siBaseline';
import type { ResolvedPolicyValue } from '../policy/policyInputsProfile';
import { OPERATOR_PROVENANCE_KEY } from './operatorValues';
import { objectiveRowId, referencePractice, type AssessmentMethod } from './objectiveSpecs';

export type ExpectedValueOp = 'equals' | 'contains' | 'gte' | 'lte' | 'exists' | 'count-gte';
export type ExpectedValueSource = 'tcp' | 'si' | 'odp' | 'bank' | 'answered';

/** ces-shared 2.9.0 ExpectedValueSchema (typed locally: Muster reads ces-shared through its dist). */
export interface ExpectedValue {
  path: string;
  op: ExpectedValueOp;
  value?: unknown;
  source: ExpectedValueSource;
}

export interface ExpectationInputs {
  /** The TM's tenant_identity (operator values + operator_value_provenance), as built. */
  tenantIdentity?: Record<string, unknown>;
  /** resolveDefaultedPolicyValues over the session facts and the Policy Inputs bank. */
  policyValues: Record<string, ResolvedPolicyValue>;
  sitAnswers: Record<string, SITAnswer>;
}

type Rule = (i: ExpectationInputs) => ExpectedValue | null;

const odp =
  (qid: string, path: string, op: ExpectedValueOp, scale = 1): Rule =>
  (i) => {
    const r = i.policyValues[qid];
    if (!r || typeof r.value !== 'number') return null;
    const source: ExpectedValueSource = r.provenance === 'answered' ? 'answered' : r.provenance === 'defaulted' ? 'bank' : 'odp';
    return { path, op, value: r.value * scale, source };
  };

const operator =
  (stamperVar: string, path: string, op: ExpectedValueOp): Rule =>
  (i) => {
    const ti = i.tenantIdentity;
    const value = ti?.[stamperVar];
    const prov = (ti?.[OPERATOR_PROVENANCE_KEY] as { values?: Record<string, string> } | undefined)?.values?.[stamperVar];
    if (typeof value !== 'string' || !value.trim() || !prov) return null;
    if (prov === 'asked') return { path, op, value, source: 'answered' };
    if (prov === 'discovered' || prov === 'derived') return { path, op, value, source: 'tcp' };
    return null; // defaulted / archetype: a placeholder, not an expectation
  };

const siPosture =
  (qid: string, answer: string, expected: ExpectedValue): Rule =>
  (i) => {
    const a = i.sitAnswers[qid];
    // An archetype prior (provenance class 'assumption') is a placeholder, not an expectation.
    return a && a.provenance_class !== 'assumption' && a.raw_answer === answer ? expected : null;
  };

/**
 * W5c7: a text ODP the organisation ANSWERED (a Muster-only ODP such as the
 * authoritative time source). Its Muster default is not an expectation: an
 * unanswered value gives no row (the row would assert Muster's guess).
 */
const answeredOdpText =
  (qid: string, path: string, op: ExpectedValueOp): Rule =>
  (i) => {
    const r = i.policyValues[qid];
    if (!r || r.provenance !== 'answered' || typeof r.value !== 'string' || !r.value.trim()) return null;
    return { path, op, value: r.value.trim(), source: 'answered' };
  };

/** FIN-26b: the CES sign-in frequency baseline in hours (founder ruling 2: an answer never relaxes it). */
export const SIGN_IN_FREQUENCY_MAX_HOURS = 8;

/**
 * FIN-26b (note 42, AC.L2-3.1.11): the sign-in frequency bound the organisation
 * ANSWERED (PI.ODP.017), as a number of hours. Only an answered finite value of
 * at least 1 and at most 8 gives a row; the defaulted "8" asserts nothing, and a
 * longer answer would relax the CES baseline, so it stays in the profile only.
 */
const answeredSignInHours: Rule = (i) => {
  const r = i.policyValues['PI.ODP.017'];
  if (!r || r.provenance !== 'answered') return null;
  const text = typeof r.value === 'number' ? String(r.value) : typeof r.value === 'string' ? r.value.trim() : '';
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours < 1 || hours > SIGN_IN_FREQUENCY_MAX_HOURS) return null;
  return { path: '$.sessionControls.signInFrequency.value', op: 'lte', value: hours, source: 'answered' };
};

const EXCLUDE_BREAK_GLASS = operator('breakGlassUserId', '$.conditions.users.excludeUsers', 'contains');
const SCREEN_LOCK = odp('PI.ODP.003', '$.passwordMinutesOfInactivityBeforeScreenTimeout', 'lte');

/** control id -> its expectations, in row order. */
// DEPTH-7: AC.L1-3.1.1 and SI.L1-3.14.2 were keyed to their phantom L2 twins (AC.L2-3.1.1,
// SI.L2-3.14.2), which no Stamper entry carries, so their postchecks were never assessed.
export const CONTROL_EXPECTATIONS: Record<string, Rule[]> = {
  'AC.L1-3.1.1': [operator('cuiGroupName', '$.displayName', 'equals')],
  'AC.L2-3.1.8': [
    odp('PI.ODP.001', "$.values[?(@.name=='LockoutThreshold')].value", 'lte'),
    odp('PI.ODP.002', "$.values[?(@.name=='LockoutDurationInSeconds')].value", 'gte', 60),
  ],
  'AC.L2-3.1.10': [SCREEN_LOCK],
  'SC.L2-3.13.9': [SCREEN_LOCK],
  // FIN-26b: the second machine row (chk_1) carries the answered sign-in frequency bound (PI.ODP.017, 1..8 h).
  'AC.L2-3.1.11': [EXCLUDE_BREAK_GLASS, answeredSignInHours],
  'AC.L2-3.1.14': [EXCLUDE_BREAK_GLASS],
  'AC.L2-3.1.15': [EXCLUDE_BREAK_GLASS],
  'AC.L2-3.1.18': [EXCLUDE_BREAK_GLASS],
  'MA.L2-3.7.5': [EXCLUDE_BREAK_GLASS],
  'AC.L2-3.1.12': [operator('approvedIpRange', '$.ipRanges[*].cidrAddress', 'contains')],
  'AC.L2-3.1.16': [operator('wifiSsid', '$.ssid', 'equals')],
  'AC.L2-3.1.21': [
    siPosture('S-27', 'blocked', { path: '$.storageBlockRemovableStorage', op: 'equals', value: true, source: 'si' }),
  ],
  // W5c2: PI.ODP.006 (maximum password age) is not an SP 800-171A objective of
  // 3.5.7 (complexity, change of characters) and is not attached to any control;
  // the answered value still reaches the policy ODP through the profile.
  'IA.L2-3.5.7': [odp('PI.ODP.004', '$.passwordMinimumLength', 'gte')],
  'IA.L2-3.5.8': [odp('PI.ODP.005', '$.passwordPreviousPasswordBlockCount', 'gte')],
  'SI.L1-3.14.2': [operator('securityEmail', '$.InternalSenderAdminAddress', 'equals')],
  // W5c7: the answered authoritative time source (PI.ODP.016); Stamper's time-sync entry binds it, EO reads it.
  'AU.L2-3.3.7': [answeredOdpText('PI.ODP.016', '$.timeServer', 'equals')],
};

/**
 * DEPTH-7: the objective each CONTROL_EXPECTATIONS rule verifies, in rule order (same length as
 * the control's rule list). Chosen from the objective's determination text: the "implemented /
 * enforced" objective where the value is a configured setting.
 */
export const EXPECTATION_OBJECTIVES: Record<string, string[]> = {
  'AC.L1-3.1.1': ['AC.L1-3.1.1[a]'],
  'AC.L2-3.1.8': ['AC.L2-3.1.8[b]', 'AC.L2-3.1.8[a]'],
  'AC.L2-3.1.10': ['AC.L2-3.1.10[b]'],
  'SC.L2-3.13.9': ['SC.L2-3.13.9[b]'],
  'AC.L2-3.1.11': ['AC.L2-3.1.11[a]', 'AC.L2-3.1.11[b]'],
  'AC.L2-3.1.14': ['AC.L2-3.1.14[b]'],
  'AC.L2-3.1.15': ['AC.L2-3.1.15[c]'],
  'AC.L2-3.1.18': ['AC.L2-3.1.18[b]'],
  'MA.L2-3.7.5': ['MA.L2-3.7.5[a]'],
  'AC.L2-3.1.12': ['AC.L2-3.1.12[c]'],
  'AC.L2-3.1.16': ['AC.L2-3.1.16[a]'],
  'AC.L2-3.1.21': ['AC.L2-3.1.21[b]'],
  'IA.L2-3.5.7': ['IA.L2-3.5.7[c]'],
  'IA.L2-3.5.8': ['IA.L2-3.5.8[b]'],
  'SI.L1-3.14.2': ['SI.L1-3.14.2[b]'],
  'AU.L2-3.3.7': ['AU.L2-3.3.7[b]'],
};

/** The expectations Muster derived for one control (unresolved rules dropped). */
export function controlExpectations(controlId: string, inputs: ExpectationInputs): ExpectedValue[] {
  return (CONTROL_EXPECTATIONS[controlId] ?? []).map((r) => r(inputs)).filter((e): e is ExpectedValue => e !== null);
}

export interface AnnotationCounts {
  /** Rows written (one per objective of every practice in the TM). */
  rows: number;
  manualRows: number;
  machineRows: number;
  withExpected: number;
  presenceOnly: number;
  bySource: Record<ExpectedValueSource, number>;
  /** Derived expectations that found no machine row (the control is absent or has only manual rows). */
  unplaced: number;
  /** DEPTH-7: rows the TM carried before the rebuild that were dropped (boilerplate, TCP, non-practice). */
  droppedRows: number;
  /** DEPTH-7: control ids outside the 110 practices whose rows were all dropped. */
  nonPracticeControls: string[];
}

interface Row {
  id?: string;
  description?: string;
  method?: unknown;
  expected?: string;
  on_fail?: string;
  objective_id?: string;
  assessment_methods?: AssessmentMethod[];
  determination?: string;
  expected_value?: ExpectedValue;
  presence_only?: boolean;
}

/**
 * DEPTH-7: rebuild the TM body's verification rows in place, one per objective (see the file
 * header); returns the counts.
 */
export function annotateVerificationRows(
  normativeControls: Array<{ control_id: string; verification: Row[] }>,
  inputs: ExpectationInputs
): AnnotationCounts {
  const counts: AnnotationCounts = {
    rows: 0,
    manualRows: 0,
    machineRows: 0,
    withExpected: 0,
    presenceOnly: 0,
    bySource: { tcp: 0, si: 0, odp: 0, bank: 0, answered: 0 },
    unplaced: 0,
    droppedRows: 0,
    nonPracticeControls: [],
  };
  const placed = new Set<string>();
  for (const nc of normativeControls) {
    const before = Array.isArray(nc.verification) ? nc.verification : [];
    const practice = referencePractice(nc.control_id);
    if (!practice) {
      counts.droppedRows += before.length;
      counts.nonPracticeControls.push(nc.control_id);
      nc.verification = [];
      continue;
    }
    const machine = before.find((r) => r.method !== undefined && r.method !== 'manual');
    const method = machine ? machine.method : 'manual';
    const rows: Row[] = practice.objectives.map((o) => ({
      id: objectiveRowId(o.id),
      description: `${o.id}: ${o.determination}`,
      method,
      expected: `${o.id}: ${o.determination}`,
      on_fail: `Flag ${o.id} (${nc.control_id}) for remediation and re-assessment`,
      objective_id: o.id,
      assessment_methods: [...o.methods],
      determination: o.determination,
    }));
    counts.droppedRows += Math.max(0, before.length - rows.length);
    const expectations = controlExpectations(nc.control_id, inputs);
    if (expectations.length > 0) placed.add(nc.control_id);
    if (method === 'manual') {
      counts.unplaced += expectations.length;
    } else {
      const targets = EXPECTATION_OBJECTIVES[nc.control_id] ?? [];
      const ruleTargets = (CONTROL_EXPECTATIONS[nc.control_id] ?? []).map((r, i) => ({ r, target: targets[i] }));
      for (const { r, target } of ruleTargets) {
        const e = r(inputs);
        if (!e) continue;
        const row = rows.find((x) => x.objective_id === target && !x.expected_value) ?? rows.find((x) => !x.expected_value);
        if (!row) {
          counts.unplaced++;
          continue;
        }
        row.expected_value = e;
        counts.withExpected++;
        counts.bySource[e.source]++;
      }
      for (const row of rows) {
        if (!row.expected_value) {
          row.presence_only = true;
          counts.presenceOnly++;
        }
      }
    }
    for (const row of rows) {
      counts.rows++;
      if (row.method === 'manual') counts.manualRows++;
      else counts.machineRows++;
    }
    nc.verification = rows;
  }
  for (const id of Object.keys(CONTROL_EXPECTATIONS)) {
    if (!placed.has(id)) counts.unplaced += controlExpectations(id, inputs).length;
  }
  return counts;
}
