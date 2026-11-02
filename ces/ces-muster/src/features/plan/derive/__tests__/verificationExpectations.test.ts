// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W3 (CONTRACT CHANGE, MG-27): TM verification rows carry the expected values Muster derived.
import { describe, test, expect } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import type { SITAnswer } from '@/features/plan/engine/types/siBaseline';
import {
  annotateVerificationRows,
  CONTROL_EXPECTATIONS,
  controlExpectations,
  EXPECTATION_OBJECTIVES,
  type ExpectationInputs,
} from '../verificationExpectations';
import { referencePractice } from '../objectiveSpecs';
import {
  buildPolicyInputsProfile,
  resolveDefaultedPolicyValues,
  type ResolvedPolicyValue,
} from '@/features/plan/policy/policyInputsProfile';
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
    source: 'synthetic-interview:w3-test',
    recorded_at: '2026-10-28T00:00:00.000Z',
  }) as InterviewFact;

const pv = (value: number | string, provenance: ResolvedPolicyValue['provenance']): ResolvedPolicyValue => ({
  value,
  provenance,
  source: 'test',
});

const sit = (id: string, raw: string): SITAnswer =>
  ({ question_id: id, answer_type: 'enum', raw_answer: raw, captured_at: '', provenance_class: 'client_assertion' }) as SITAnswer;

const NONE: ExpectationInputs = { policyValues: {}, sitAnswers: {} };

describe('W3 expected values: the rules', () => {
  test('ODP: answered -> answered, bank default -> bank, discovered -> odp; minutes scaled to seconds where the property is seconds', () => {
    const e = controlExpectations('AC.L2-3.1.8', {
      ...NONE,
      policyValues: { 'PI.ODP.001': pv(5, 'answered'), 'PI.ODP.002': pv(30, 'defaulted') },
    });
    expect(e).toEqual([
      { path: "$.values[?(@.name=='LockoutThreshold')].value", op: 'lte', value: 5, source: 'answered' },
      { path: "$.values[?(@.name=='LockoutDurationInSeconds')].value", op: 'gte', value: 1800, source: 'bank' },
    ]);
    expect(controlExpectations('AC.L2-3.1.10', { ...NONE, policyValues: { 'PI.ODP.003': pv(10, 'discovered') } })).toEqual([
      { path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10, source: 'odp' },
    ]);
    expect(controlExpectations('AC.L2-3.1.10', NONE)).toEqual([]);
  });

  test('operator values: asked -> answered, discovered/derived -> tcp, defaulted/archetype or empty -> none', () => {
    const ti = (value: string, prov: string) => ({ wifiSsid: value, operator_value_provenance: { values: { wifiSsid: prov } } });
    const at = (value: string, prov: string) => controlExpectations('AC.L2-3.1.16', { ...NONE, tenantIdentity: ti(value, prov) });
    expect(at('CUI-WIFI', 'asked')).toEqual([{ path: '$.ssid', op: 'equals', value: 'CUI-WIFI', source: 'answered' }]);
    expect(at('CUI-WIFI', 'discovered')[0].source).toBe('tcp');
    expect(at('CUI-WIFI', 'derived')[0].source).toBe('tcp');
    expect(at('MUSTER-DEFAULT-SSID', 'defaulted')).toEqual([]);
    expect(at('CUI-WIFI', 'archetype')).toEqual([]);
    expect(at('  ', 'asked')).toEqual([]);
    expect(controlExpectations('AC.L2-3.1.16', { ...NONE, tenantIdentity: { wifiSsid: 'CUI-WIFI' } })).toEqual([]);
  });

  test('SI posture: removable media blocked (answered S-27) -> storageBlockRemovableStorage true; otherwise none', () => {
    expect(controlExpectations('AC.L2-3.1.21', { ...NONE, sitAnswers: { 'S-27': sit('S-27', 'blocked') } })).toEqual([
      { path: '$.storageBlockRemovableStorage', op: 'equals', value: true, source: 'si' },
    ]);
    expect(controlExpectations('AC.L2-3.1.21', { ...NONE, sitAnswers: { 'S-27': sit('S-27', 'allowed_encrypted') } })).toEqual([]);
    expect(controlExpectations('AC.L2-3.1.21', NONE)).toEqual([]);
    const prior = { ...sit('S-27', 'blocked'), provenance_class: 'assumption' } as SITAnswer;
    expect(controlExpectations('AC.L2-3.1.21', { ...NONE, sitAnswers: { 'S-27': prior } })).toEqual([]);
  });
});

describe('DEPTH-7: one postcheck spec per objective', () => {
  test('rows are rebuilt per objective from the ces-shared KB; expectations go onto their named objective; the rest of a machine control is presence_only; manual controls carry neither', () => {
    const rows = (methods: string[]) => methods.map((method, i) => ({ id: `chk_${i}`, method }));
    const controls = [
      { control_id: 'IA.L2-3.5.7', verification: rows(['manual', 'config_export', 'config_export', 'config_export']) },
      { control_id: 'AC.L1-3.1.20', verification: rows(['config_export']) },
      { control_id: 'AC.L2-3.1.10', verification: rows(['manual']) },
    ];
    const counts = annotateVerificationRows(controls, {
      ...NONE,
      policyValues: { 'PI.ODP.003': pv(15, 'defaulted'), 'PI.ODP.004': pv(14, 'defaulted'), 'PI.ODP.006': pv(60, 'answered') },
    });
    const ia = controls[0].verification as Array<Record<string, unknown>>;
    expect(ia.map((r) => r.objective_id)).toEqual(['IA.L2-3.5.7[a]', 'IA.L2-3.5.7[b]', 'IA.L2-3.5.7[c]', 'IA.L2-3.5.7[d]']);
    expect(ia[0]).toMatchObject({ id: 'chk_IA.L2-3.5.7_a', method: 'config_export', presence_only: true, assessment_methods: ['examine', 'interview', 'test'] });
    expect(String(ia[0].description)).toMatch(/^IA\.L2-3\.5\.7\[a\]: password complexity requirements are defined/);
    // The minimum length goes onto [c] ("enforced"); W5c2: an answered PI.ODP.006 gives 3.5.7 no expectation.
    expect(ia[2].expected_value).toEqual({ path: '$.passwordMinimumLength', op: 'gte', value: 14, source: 'bank' });
    expect('presence_only' in ia[2]).toBe(false);
    expect(ia[3].presence_only).toBe(true);
    expect(controls[1].verification.map((r) => (r as Record<string, unknown>).objective_id)).toEqual(
      ['AC.L1-3.1.20[a]', 'AC.L1-3.1.20[b]', 'AC.L1-3.1.20[c]', 'AC.L1-3.1.20[d]', 'AC.L1-3.1.20[e]', 'AC.L1-3.1.20[f]']
    );
    // A control with only manual rows: every objective row is manual, no expectation, no presence_only.
    const ac10 = controls[2].verification as Array<Record<string, unknown>>;
    expect(ac10.map((r) => r.method)).toEqual(['manual', 'manual', 'manual']);
    expect(ac10.some((r) => 'expected_value' in r || 'presence_only' in r)).toBe(false);
    expect(counts).toEqual({
      rows: 13,
      manualRows: 3,
      machineRows: 10,
      withExpected: 1,
      presenceOnly: 9,
      bySource: { tcp: 0, si: 0, odp: 0, bank: 1, answered: 0 },
      // AC.L2-3.1.10 has only manual rows; SC.L2-3.13.9 (same ODP) is absent.
      unplaced: 2,
      droppedRows: 0,
      nonPracticeControls: [],
    });
  });

  test("a phantom L2 twin and a non-practice id keep no rows; the phantom's expectation is keyed to its L1 practice", () => {
    const ti = { cuiGroupName: 'CUI-Authorized-Users', operator_value_provenance: { values: { cuiGroupName: 'discovered' } } };
    const controls = [
      { control_id: 'AC.L2-3.1.1', verification: [{ id: 'x0', method: 'config_export' }, { id: 'x1', method: 'config_export' }] },
      { control_id: 'FOUNDATION', verification: [{ id: 'f0', method: 'manual' }] },
      { control_id: 'scre.OPV.adminUserName', verification: [{ id: 's0', method: 'config_export' }] },
      { control_id: 'AC.L1-3.1.1', verification: [{ id: 'y0', method: 'config_export' }] },
    ];
    const counts = annotateVerificationRows(controls, { ...NONE, tenantIdentity: ti });
    expect(controls.slice(0, 3).map((c) => c.verification.length)).toEqual([0, 0, 0]);
    expect(counts.nonPracticeControls).toEqual(['AC.L2-3.1.1', 'FOUNDATION', 'scre.OPV.adminUserName']);
    expect(counts.droppedRows).toBe(4);
    const ac = controls[3].verification as Array<Record<string, unknown>>;
    expect(ac).toHaveLength(6);
    expect(ac[0]).toMatchObject({ objective_id: 'AC.L1-3.1.1[a]', expected_value: { path: '$.displayName', op: 'equals', value: 'CUI-Authorized-Users', source: 'tcp' } });
    expect(controlExpectations('AC.L2-3.1.1', { ...NONE, tenantIdentity: ti })).toEqual([]);
  });

  test('every rule names one objective per rule, and each objective belongs to its control in the KB', () => {
    for (const [id, rules] of Object.entries(CONTROL_EXPECTATIONS)) {
      const targets = EXPECTATION_OBJECTIVES[id];
      expect(targets, id).toBeDefined();
      expect(targets.length, id).toBe(rules.length);
      const practice = referencePractice(id);
      expect(practice, id).not.toBeNull();
      for (const t of targets) expect(practice!.objectives.map((o) => o.id), `${id} ${t}`).toContain(t);
    }
  });
});

describe('W3 expected values: the ODP rule is the profile rule', () => {
  test('bank defaults, an answer replacing one, and a non-numeric answer keeping the default', () => {
    const facts = [fact('PI.ODP.003', '10'), fact('PI.ODP.001', 'three')];
    const v = resolveDefaultedPolicyValues(facts, BANKS.policyInputsBank);
    // The pinned bank's 15 ODPs plus the Muster-only PI.ODP.016 (W5c7) and PI.ODP.017 (FIN-26b).
    expect(Object.keys(v).filter((k) => k.startsWith('PI.ODP.'))).toHaveLength(17);
    expect(v['PI.ODP.003']).toEqual({ value: 10, provenance: 'answered', source: 'synthetic-interview:w3-test' });
    expect(v['PI.ODP.001']).toEqual({ value: 3, provenance: 'defaulted', source: 'Policy Inputs bank recommended value' });
    expect(v['PI.GOV.002'].provenance).toBe('defaulted');
    const profile = buildPolicyInputsProfile({ facts, party: { name: 'Org' }, missionPlan: null, bank: BANKS.policyInputsBank });
    for (const [id, r] of Object.entries(v)) {
      const s = profile.sources.find((x) => x.question_id === id);
      expect(s, id).toMatchObject({ provenance: r.provenance, source: r.source, value: String(r.value) });
    }
  });
});

describe('W5c2: PI.ODP.006 (maximum password age) verifies no control', () => {
  test('no control expects $.passwordExpirationDays; the answered value still reaches the profile ODP', () => {
    const answered = { ...NONE, policyValues: { 'PI.ODP.004': pv(14, 'answered'), 'PI.ODP.006': pv(60, 'answered') } };
    for (const id of Object.keys(CONTROL_EXPECTATIONS)) {
      expect(controlExpectations(id, answered).map((e) => e.path), id).not.toContain('$.passwordExpirationDays');
    }
    expect(controlExpectations('IA.L2-3.5.7', answered)).toEqual([{ path: '$.passwordMinimumLength', op: 'gte', value: 14, source: 'answered' }]);
    const profile = buildPolicyInputsProfile({ facts: [fact('PI.ODP.006', '60')], party: { name: 'Org' }, missionPlan: null, bank: BANKS.policyInputsBank });
    expect(profile.output.odps.max_password_age_days).toBe(60);
  });
});

describe('W3 expected values: the Tenant Manifest', () => {
  const compile = (policyInputsBank: unknown) =>
    buildPlanArtifacts(
      {
        sitAnswers: sitAnswers({ deploymentPosture: 'cloud_only' }),
        requirementResults: [
          { requirement_id: 'AC.L2-3.1.10', status: 'not_met' },
          { requirement_id: 'IA.L2-3.5.7', status: 'not_met' },
        ],
        tenantConfig: null,
      },
      { ...BANKS, policyInputsBank }
    ).tenantManifest as unknown as {
      tenant_manifest: { normative_controls: Array<{ control_id: string; verification: Array<Record<string, unknown>> }> };
    };

  test('DEPTH-7: one row per objective, keyed by objective id; every machine row carries exactly one of expected_value / presence_only, manual rows neither; no boilerplate', () => {
    const withBank = compile(BANKS.policyInputsBank).tenant_manifest.normative_controls;
    const without = compile(undefined).tenant_manifest.normative_controls;
    expect(withBank.map((c) => [c.control_id, c.verification.length])).toEqual(without.map((c) => [c.control_id, c.verification.length]));
    let expected = 0;
    for (const c of withBank) {
      const practice = referencePractice(c.control_id);
      expect(c.verification.map((r) => r.objective_id), c.control_id).toEqual(practice ? practice.objectives.map((o) => o.id) : []);
      for (const r of c.verification) {
        if (r.method === 'manual') {
          expect('expected_value' in r || 'presence_only' in r, `${c.control_id} ${r.id}`).toBe(false);
        } else {
          expect(('expected_value' in r) !== ('presence_only' in r), `${c.control_id} ${r.id}`).toBe(true);
          if (r.expected_value) expected++;
        }
        expect(typeof r.expected).toBe('string');
        expect(String(r.description)).not.toMatch(/^(Examine documentation and configuration exports|Interview responsible personnel|Test control effectiveness|\[TCP Verification\])/);
      }
    }
    expect(expected).toBeGreaterThan(0);
    const all = withBank.flatMap((c) => c.verification.map((r) => r.expected_value)).filter(Boolean) as Array<{ source: string }>;
    expect(new Set(all.map((e) => e.source))).toEqual(new Set(['bank']));
    // No Policy Inputs bank: no ODP expectations, so every machine row is presence-only.
    expect(without.flatMap((c) => c.verification).some((r) => 'expected_value' in r)).toBe(false);
  });
});

describe('W5c7: PI.ODP.016, the authoritative time source (AU.L2-3.3.7)', () => {
  test('a Muster-only ODP node in the graph: plan-input:policy, score-leak safe', async () => {
    const { QUESTION_GRAPH } = await import('@/features/interview/questionGraph');
    const n = QUESTION_GRAPH.find((x) => x.id === 'PI.ODP.016');
    expect(n?.text).toBe('What authoritative time source do in-scope systems synchronise to? (NTP server)');
    expect(n?.cluster).toBe('plan-input:policy');
    expect(n?.mapped_requirements).toEqual([]);
  });
  test('profile: odps.authoritative_time_source is the answer, else Muster\'s default (defaulted)', () => {
    const answered = buildPolicyInputsProfile({ facts: [fact('PI.ODP.016', 'time.windows.com')], party: { name: 'Org' }, missionPlan: null, bank: BANKS.policyInputsBank });
    expect(answered.output.odps.authoritative_time_source).toBe('time.windows.com');
    expect(answered.sources.find((s) => s.question_id === 'PI.ODP.016')).toMatchObject({ provenance: 'answered', value: 'time.windows.com' });
    const other = buildPolicyInputsProfile({ facts: [fact('PI.ODP.016', 'ntp.example.invalid')], party: { name: 'Org' }, missionPlan: null, bank: BANKS.policyInputsBank });
    expect(other.output.odps.authoritative_time_source).toBe('ntp.example.invalid');
    const none = buildPolicyInputsProfile({ facts: [], party: { name: 'Org' }, missionPlan: null, bank: BANKS.policyInputsBank });
    expect(none.output.odps.authoritative_time_source).toBe('time.windows.com');
    expect(none.sources.find((s) => s.question_id === 'PI.ODP.016')).toMatchObject({ provenance: 'defaulted', value: 'time.windows.com' });
  });
  test('TM rule: answered -> { $.timeServer equals <answer>, answered }; the Muster default gives no row', () => {
    const answered = resolveDefaultedPolicyValues([fact('PI.ODP.016', 'time.windows.com')], BANKS.policyInputsBank);
    expect(answered['PI.ODP.016']).toMatchObject({ value: 'time.windows.com', provenance: 'answered' });
    expect(controlExpectations('AU.L2-3.3.7', { ...NONE, policyValues: answered })).toEqual([
      { path: '$.timeServer', op: 'equals', value: 'time.windows.com', source: 'answered' },
    ]);
    const defaulted = resolveDefaultedPolicyValues([], BANKS.policyInputsBank);
    expect(defaulted['PI.ODP.016'].provenance).toBe('defaulted');
    expect(controlExpectations('AU.L2-3.3.7', { ...NONE, policyValues: defaulted })).toEqual([]);
  });
  test('the compiled TM carries the row on AU.L2-3.3.7[b] (DEPTH-7: the authoritative-source objective)', () => {
    const tm = buildPlanArtifacts(
      {
        sitAnswers: sitAnswers({ deploymentPosture: 'cloud_only' }),
        requirementResults: [{ requirement_id: 'AU.L2-3.3.7', status: 'not_met' }],
        tenantConfig: null,
        facts: [fact('PI.ODP.016', 'time.windows.com')],
      },
      BANKS
    ).tenantManifest as unknown as { tenant_manifest: { normative_controls: Array<{ control_id: string; verification: Array<Record<string, unknown>> }> } };
    const rows = tm.tenant_manifest.normative_controls.find((c) => c.control_id === 'AU.L2-3.3.7')?.verification ?? [];
    const first = rows.find((r) => r.objective_id === 'AU.L2-3.3.7[b]');
    expect(first?.method).not.toBe('manual');
    expect(first?.expected_value).toEqual({ path: '$.timeServer', op: 'equals', value: 'time.windows.com', source: 'answered' });
  });
});
