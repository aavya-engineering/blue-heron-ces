// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node
// W5c2 (SC-5 questions Q1-Q6 and the SI governance side finding,
// LOG-W5c2-muster.md): the six Muster-only questions are bank nodes with
// register rows; an answers file carrying them imports; the profile carries
// personnel role_id authorizing_official / privacy_officer /
// network_administrator and the ssp_inputs block; the SI Baseline governance
// owners are derived from the personnel answers.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { describe, test, expect } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { buildQuestionRegister } from '@/features/interview/questionRegister';
import { parseInterviewAnswers, mergeInterviewAnswers } from '@/features/plan/headless/answersImport';
import { buildSiBaselineFromAnswers, siGovernanceFromFacts } from '@/features/plan/siBaselineAdapter';
import {
  buildPolicyInputsProfile,
  interconnectionAgreements,
  MUSTER_PERSONNEL_ROLES,
  SSP_INPUT_QUESTIONS,
} from '../policyInputsProfile';

const KNOWLEDGE = path.resolve(process.cwd(), 'public', 'knowledge');
const readBank = (name: string) => load(fs.readFileSync(path.join(KNOWLEDGE, name), 'utf8')) as unknown;
const POLICY_BANK = readBank('primed Policy Inputs Question Bank.yaml');
const bankIds = (bank: unknown): string[] =>
  (((bank as { sections?: Array<{ questions?: Array<{ id: string }> }> }).sections ??
    (bank as Array<{ questions?: Array<{ id: string }> }>)) as Array<{ questions?: Array<{ id: string }> }>).flatMap((s) =>
    (s.questions ?? []).map((q) => q.id)
  );

const NEW_IDS = ['PI.PER.009', 'PI.PER.010', 'PI.PER.011', 'PI.SYS.001', 'CUI.LC.VOL.001', 'CUI.INT.004'];
const SLUG = 'w5c2-test';
const at = '2026-10-01T00:00:00.000Z';
const fact = (question_id: string, answer: string, provenance = 'operator_interview'): InterviewFact => ({
  question_id,
  question_text: question_id,
  answer,
  provenance,
  confidence: 'high',
  recorded_at: at,
  source: `synthetic-interview:${SLUG}`,
});

/** The S1 answer shapes (fictional names on an example domain). */
const ANSWERS: InterviewFact[] = [
  fact('PI.PER.001', 'Fixture Isso | Information Systems Security Officer (ISSO) | isso@w5c2.example'),
  fact('PI.PER.002', 'Fixture Owner | President / Owner | owner@w5c2.example'),
  fact('PI.PER.003', 'Fixture Issm | Information Security Manager (ISSM) | issm@w5c2.example'),
  fact('PI.PER.008', 'Fixture Legal | Contracts and CUI Manager | legal@w5c2.example'),
  fact('PI.PER.009', 'Fixture Owner | President / Owner | owner@w5c2.example'),
  fact('PI.PER.010', 'Fixture Legal | Contracts and CUI Manager (Privacy Officer role holder) | legal@w5c2.example'),
  fact('PI.PER.011', 'role held by Information Systems Security Officer (ISSO)'),
  fact('PI.SYS.001', 'FIX-CUI-ENC-01'),
  fact('CUI.LC.VOL.001', 'About 9,500 files (about 38 GB) held; about 220 files (about 1.5 GB) a month'),
  fact(
    'CUI.INT.004',
    'Prime portal | ISA FIX-ISA-0001 | HTTPS browser upload and download | CUI: Controlled Technical Information; File sync account | MOU FIX-MOU-0002 | Service-account file sync | CUI: Controlled Technical Information'
  ),
];

describe('W5c2: the six Muster-only questions are bank nodes', () => {
  test('each is a policy plan-input node with a justified register row, and collides with no pinned bank id', () => {
    const reg = buildQuestionRegister();
    const pinned = new Set([...bankIds(POLICY_BANK), ...bankIds(readBank('primed CUI Boundary Question Bank.yaml'))]);
    for (const id of NEW_IDS) {
      const node = QUESTION_GRAPH.find((n) => n.id === id);
      expect(node, id).toBeDefined();
      expect(node!.cluster, id).toBe('plan-input:policy');
      expect(node!.mapped_requirements, id).toEqual([]);
      expect(node!.plan_input?.contract, id).toBe('policy_inputs');
      expect(node!.input, id).toBe('text');
      const row = reg.rows.find((r) => r.id === id);
      expect(row, id).toMatchObject({ kind: 'plan-input:policy', status: 'justified', optional_for_finish: true });
      expect(pinned.has(id), id).toBe(false);
    }
    // The bank's numbering: PI.PER.001-008 then 009-011; CUI.INT.001-003 then 004.
    expect(bankIds(POLICY_BANK).filter((x) => x.startsWith('PI.PER.')).slice(-1)).toEqual(['PI.PER.008']);
    expect(QUESTION_GRAPH.find((n) => n.id === 'CUI.INT.001')).toBeDefined();
    // The committed register is current (the register test asserts the same for every row).
    const committed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/features/interview/questionRegister.json'), 'utf8')
    ) as { rows: Array<{ id: string }> };
    for (const id of NEW_IDS) expect(committed.rows.some((r) => r.id === id), id).toBe(true);
  });
});

describe('W5c2: an answers file carrying the new questions imports', () => {
  test('parsed and merged onto the staged facts (added, none dropped)', () => {
    const parsed = parseInterviewAnswers(JSON.stringify(ANSWERS), SLUG);
    expect(parsed.map((f) => f.question_id)).toEqual(ANSWERS.map((f) => f.question_id));
    const merged = mergeInterviewAnswers([], parsed);
    for (const id of NEW_IDS) expect(merged.added, id).toContain(id);
    expect(merged.facts).toHaveLength(ANSWERS.length);
  });
});

describe('W5c2: profile personnel and ssp_inputs', () => {
  const profile = buildPolicyInputsProfile({ facts: ANSWERS, party: { name: 'Fixture Org' }, missionPlan: null, bank: POLICY_BANK });

  test('the role_id vocabulary', () => {
    expect(MUSTER_PERSONNEL_ROLES.map((r) => [r.id, r.role_id])).toEqual([
      ['PI.PER.009', 'authorizing_official'],
      ['PI.PER.010', 'privacy_officer'],
      ['PI.PER.011', 'network_administrator'],
    ]);
    expect(SSP_INPUT_QUESTIONS).toEqual({
      system_identifier: 'PI.SYS.001',
      cui_volume: 'CUI.LC.VOL.001',
      interconnection_agreements: 'CUI.INT.004',
    });
  });

  test('personnel[] carries the three entries; "role held by" names the holder of that role', () => {
    const by = Object.fromEntries(profile.output.personnel.map((p) => [p.role_id, p]));
    expect(by.authorizing_official).toEqual({
      role_id: 'authorizing_official',
      role_title: 'Authorizing Official',
      name: 'Fixture Owner',
      title: 'President / Owner',
      email: 'owner@w5c2.example',
    });
    expect(by.privacy_officer).toMatchObject({ name: 'Fixture Legal', title: 'Contracts and CUI Manager (Privacy Officer role holder)' });
    expect(by.network_administrator).toEqual({
      role_id: 'network_administrator',
      role_title: 'Network Administrator',
      name: 'Fixture Isso',
      title: 'Information Systems Security Officer (ISSO) (Network Administrator role holder)',
      email: 'isso@w5c2.example',
    });
    const src = Object.fromEntries(profile.sources.map((s) => [s.question_id, s]));
    for (const id of NEW_IDS) expect(src[id], id).toMatchObject({ provenance: 'answered', source: `synthetic-interview:${SLUG}` });
  });

  test('ssp_inputs: system identifier, CUI volume, one agreement per interconnection', () => {
    expect(profile.output.ssp_inputs).toEqual({
      system_identifier: 'FIX-CUI-ENC-01',
      cui_volume: 'About 9,500 files (about 38 GB) held; about 220 files (about 1.5 GB) a month',
      interconnection_agreements: [
        {
          system: 'Prime portal',
          agreement_reference: 'ISA FIX-ISA-0001',
          connection_type: 'HTTPS browser upload and download',
          data_classification: 'CUI: Controlled Technical Information',
        },
        {
          system: 'File sync account',
          agreement_reference: 'MOU FIX-MOU-0002',
          connection_type: 'Service-account file sync',
          data_classification: 'CUI: Controlled Technical Information',
        },
      ],
    });
    expect(interconnectionAgreements('Portal\n Other | ISA 1')).toEqual([{ system: 'Portal' }, { system: 'Other', agreement_reference: 'ISA 1' }]);
  });

  test('unanswered (or an unmatched "role held by"): no entry, no ssp_inputs key, a missing source', () => {
    const none = buildPolicyInputsProfile({
      facts: [fact('PI.PER.010', 'role held by Chief Privacy Wizard')],
      party: { name: 'Fixture Org' },
      missionPlan: null,
      bank: POLICY_BANK,
    });
    expect(none.output.personnel).toEqual([]);
    expect('ssp_inputs' in none.output).toBe(false);
    const missing = none.sources.filter((s) => s.provenance === 'missing').map((s) => s.question_id);
    for (const id of NEW_IDS) expect(missing, id).toContain(id);
  });
});

describe('W5c2: SI Baseline governance owners from the personnel answers', () => {
  const SI_BANK = readBank('primed SI Question Bank.yaml') as Parameters<typeof buildSiBaselineFromAnswers>[1];

  test('precedence: AO else System Owner; change control = Compliance Officer; audit interface = ISSO else Compliance Officer', () => {
    expect(siGovernanceFromFacts(ANSWERS)).toEqual({
      affirming_official: { name: 'Fixture Owner', question_id: 'PI.PER.009' },
      risk_acceptance_authority: { name: 'Fixture Owner', question_id: 'PI.PER.009' },
      change_control_owner: { name: 'Fixture Issm', question_id: 'PI.PER.003' },
      audit_interface_owner: { name: 'Fixture Isso', question_id: 'PI.PER.001' },
    });
    const noAo = siGovernanceFromFacts([
      fact('PI.PER.002', 'Fixture Sysowner, CTO, so@w5c2.example'),
      fact('PI.PER.003', 'Fixture Issm | ISSM | issm@w5c2.example'),
      fact('PI.PER.009', 'role held by System Owner'),
    ]);
    expect(noAo.affirming_official).toEqual({ name: 'Fixture Sysowner', question_id: 'PI.PER.002' });
    expect(noAo.audit_interface_owner).toEqual({ name: 'Fixture Issm', question_id: 'PI.PER.003' });
    // A draft never counts.
    expect(siGovernanceFromFacts([fact('PI.PER.009', 'Draft Person | X | d@w5c2.example', 'archetype-default')])).toEqual({});
  });

  test('the SI Baseline takes them where the generator wrote "Not specified"; without them it is unchanged', () => {
    const si = buildSiBaselineFromAnswers({}, SI_BANK, 'w5c2', siGovernanceFromFacts(ANSWERS)).si_baseline;
    expect(si.governance).toMatchObject({
      affirming_official: 'Fixture Owner',
      change_control_owner: 'Fixture Issm',
      audit_interface_owner: 'Fixture Isso',
    });
    expect(si.risk_acceptance.risk_acceptance_authority).toBe('Fixture Owner');
    const bare = buildSiBaselineFromAnswers({}, SI_BANK, 'w5c2').si_baseline;
    expect(bare.governance.affirming_official).toBe('Not specified');
    expect(bare.risk_acceptance.risk_acceptance_authority).toBe('Not specified');
  });
});
