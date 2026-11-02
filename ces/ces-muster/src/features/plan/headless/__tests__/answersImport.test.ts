// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node

// W1 (synthetic customers) gates:
//  - MX_ANSWERS: the answers-file check, and the merge precedence (a decisive
//    discovery verdict wins; an answer fills 'unsure', a draft and the
//    unanswered; non-graph ids such as the ODPs survive);
//  - ODPs: an answered ODP replaces the bank default (answered, with its
//    source); unanswered ODPs stay defaulted;
//  - TM keys: the further Stamper values with their provenance in
//    tenant_identity.operator_value_provenance; tenant_id / primary_domain from
//    the discovered organisation read;
//  - plan mode: only 'yes' counts as in place;
//  - OPV fallbacks: answered operatorUPN / breakGlassUPN / breakGlassUserId
//    apply only when discovery gives no value (a discovered value wins).
import 'fake-indexeddb/auto';
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import type { InterviewFact } from '@/shared/types/engagement';
import {
  mergeInterviewAnswers,
  operatorValueFactsFromOrgContent,
  parseInterviewAnswers,
  partyFromOrgContent,
} from '../answersImport';
import { buildSuppliedOperatorValues, ENTRA_ROLE_TEMPLATE } from '@/features/plan/derive/operatorValues';
import { buildPolicyInputsProfile } from '@/features/plan/policy/policyInputsProfile';
import { derivePlanMode } from '@/features/plan/planModeDerivation';
import { loadCustomer } from '@/features/plan/__tests__/parityHarness';
import { freezeEntropy } from '@/features/plan/__tests__/fixtureInputs';
import { buildTenantConfigProfile, type TcpQuestionBank } from '@/features/plan/tcpAdapter';

const SLUG = 'w1-test';
const SRC = `synthetic-interview:${SLUG}`;

const fact = (
  question_id: string,
  answer: string,
  provenance = 'operator_interview',
  confidence: InterviewFact['confidence'] = 'high',
  source?: string
): InterviewFact => ({
  question_id,
  question_text: question_id,
  answer,
  provenance,
  confidence,
  recorded_at: '2026-10-01T00:00:00.000Z',
  ...(source ? { source } : {}),
});
const answer = (id: string, a: string) => fact(id, a, 'operator_interview', 'high', SRC);

describe('W1 MX_ANSWERS: the answers file', () => {
  test('a well-formed file parses', () => {
    const facts = parseInterviewAnswers(JSON.stringify([answer('G-02', 'cui_present'), answer('PI.ODP.003', '10')]), SLUG);
    expect(facts.map((f) => f.question_id)).toEqual(['G-02', 'PI.ODP.003']);
  });

  test('wrong provenance, wrong source, an unknown key, a duplicate id and a non-array are refused', () => {
    const ok = answer('G-02', 'cui_present');
    expect(() => parseInterviewAnswers(JSON.stringify([{ ...ok, provenance: 'defaulted' }]), SLUG)).toThrow(/provenance/);
    expect(() => parseInterviewAnswers(JSON.stringify([{ ...ok, source: 'synthetic-interview:other' }]), SLUG)).toThrow(/source/);
    expect(() => parseInterviewAnswers(JSON.stringify([{ ...ok, extra: 1 }]), SLUG)).toThrow(/unknown key/);
    expect(() => parseInterviewAnswers(JSON.stringify([ok, ok]), SLUG)).toThrow(/duplicate/);
    expect(() => parseInterviewAnswers('{}', SLUG)).toThrow(/not an array/);
  });
});

describe('W1 MX_ANSWERS: merge precedence', () => {
  const staged = [
    fact('RR-ACT-A', 'no', 'auto_detected', 'high', 'graph:conditionalAccess'), // decisive discovery
    fact('RR-ACT-B', 'unsure', 'auto_detected', 'unknown'), // unknown verdict
    fact('bnd-001', 'yes', 'discovery-inferred', 'medium'), // an unconfirmed boundary draft
    fact('S-12', 'teams_first', 'auto_detected', 'high'),
  ];
  const answers = [
    answer('RR-ACT-A', 'yes'),
    answer('RR-ACT-B', 'yes'),
    answer('bnd-001', 'yes'),
    answer('G-02', 'cui_present'),
    answer('PI.ODP.003', '10'),
  ];
  const m = mergeInterviewAnswers(staged, answers);
  const last = (id: string) => [...m.facts].reverse().find((f) => f.question_id === id);

  test('an answer never overrides a decisive discovery verdict', () => {
    expect(last('RR-ACT-A')).toMatchObject({ answer: 'no', provenance: 'auto_detected' });
    expect(m.facts.filter((f) => f.question_id === 'RR-ACT-A')).toHaveLength(1);
    expect(m.keptDiscovery).toEqual(['RR-ACT-A']);
  });

  test("an answer replaces 'unsure' and an unconfirmed draft; the staged fact is dropped", () => {
    expect(m.facts.filter((f) => f.question_id === 'RR-ACT-B')).toEqual([answers[1]]);
    expect(m.facts.filter((f) => f.question_id === 'bnd-001')).toEqual([answers[2]]);
    expect(m.replaced).toEqual(['RR-ACT-B', 'bnd-001']);
  });

  test('unanswered questions are filled; non-graph ids (ODPs) survive; untouched facts stay', () => {
    expect(last('G-02')).toEqual(answers[3]);
    expect(last('PI.ODP.003')).toEqual(answers[4]);
    expect(m.added).toEqual(['G-02', 'PI.ODP.003']);
    expect(last('S-12')).toMatchObject({ provenance: 'auto_detected' });
    expect(m.facts).toHaveLength(staged.length + answers.length - 1 - 2);
  });

  test('org-content operator values become answered OPV facts (notes skipped)', () => {
    const f = operatorValueFactsFromOrgContent(
      { operator_values_without_register_row: { _note: 'x', adminUserName: 'adm@x.example', approvedIpRange: '198.51.100.0/24', empty: '' } },
      SLUG,
      '2026-10-01T00:00:00.000Z'
    );
    expect(f.map((x) => [x.question_id, x.provenance, x.source])).toEqual([
      ['OPV.adminUserName', 'operator_interview', `synthetic-org-content:${SLUG}`],
      ['OPV.approvedIpRange', 'operator_interview', `synthetic-org-content:${SLUG}`],
    ]);
    expect(operatorValueFactsFromOrgContent({}, SLUG, 'now')).toEqual([]);
  });
});

describe('W1 ODPs: answers replace the bank defaults', () => {
  const bank = load(
    fs.readFileSync(path.resolve('public/knowledge', 'primed Policy Inputs Question Bank.yaml'), 'utf8')
  ) as unknown;
  const party = { name: 'Sim Co (FICTIONAL)' };

  test('answered ODPs are answered with their source and value; the rest stay defaulted', () => {
    const p = buildPolicyInputsProfile({
      facts: [answer('PI.ODP.003', '10'), answer('PI.ODP.008', 'Weekly')],
      party,
      missionPlan: null,
      bank,
    });
    const odp = p.sources.filter((s) => s.question_id.startsWith('PI.ODP.'));
    // W5c7 / FIN-26b: the bank's 15 ODPs plus the Muster-only PI.ODP.016 (time source) and PI.ODP.017 (sign-in frequency).
    expect(odp).toHaveLength(17);
    const by = new Map(odp.map((s) => [s.question_id, s]));
    expect(by.get('PI.ODP.003')).toMatchObject({ provenance: 'answered', source: SRC, value: '10' });
    expect(by.get('PI.ODP.008')).toMatchObject({ provenance: 'answered', source: SRC, value: 'Weekly' });
    expect(odp.filter((s) => s.provenance === 'defaulted')).toHaveLength(15);
    const odps = (p.output as unknown as { odps: Record<string, unknown> }).odps;
    expect(odps.session_timeout_minutes).toBe(10); // a number, as the bank default is
    expect(odps.vuln_scan_frequency).toBe('Weekly');
    expect(odps.audit_log_retention_days).toBe(365); // unanswered: the bank default
  });

  test('with no ODP answers all 17 are defaulted (15 bank + PI.ODP.016 + PI.ODP.017)', () => {
    const p = buildPolicyInputsProfile({ facts: [], party, missionPlan: null, bank });
    expect(p.sources.filter((s) => s.question_id.startsWith('PI.ODP.') && s.provenance === 'defaulted')).toHaveLength(17);
  });
});

describe('W1 TM keys: the further Stamper values with provenance', () => {
  test('approver (TCP.MU.001), org-content values, the discovered template and the derived role ids', () => {
    const s = buildSuppliedOperatorValues([
      answer('TCP.MU.001', 'approver@x.example'),
      fact('OPV.adminUserName', 'adm@x.example', 'operator_interview', 'high', 'synthetic-org-content:x'),
      fact('OPV.baselineTemplateId', 'tmpl-1', 'auto_detected', 'high', 'graph:deviceManagementTemplates'),
    ]);
    const by = new Map(s.values.map((v) => [v.stamperVar, v]));
    expect(by.get('approverUPN')).toMatchObject({ value: 'approver@x.example', provenance: 'asked' });
    expect(by.get('adminUserName')).toMatchObject({ value: 'adm@x.example', provenance: 'asked' });
    expect(by.get('baselineTemplateId')).toMatchObject({ value: 'tmpl-1', provenance: 'discovered' });
    expect(by.get('complianceRoleId')).toMatchObject({ value: ENTRA_ROLE_TEMPLATE.complianceAdministrator, provenance: 'derived' });
    expect(by.get('roleDefId')).toMatchObject({ value: ENTRA_ROLE_TEMPLATE.globalAdministrator, provenance: 'derived' });
    expect(s.unresolved).toEqual(['approvedIpRange', 'touFileName', 'touFileBase64', 'subscriptionId']);
  });

  test('fixture (a) compiled with W1 facts: tenant_identity carries the keys, their provenance, and the discovered tenant id and domain', async () => {
    const { musterSession } = loadCustomer('a');
    const session = structuredClone(musterSession.session) as typeof musterSession.session & { facts: InterviewFact[] };
    session.facts = [
      ...(session.facts as InterviewFact[]),
      answer('TCP.MU.001', 'approver@simtenant-a.onmicrosoft.us'),
      fact('OPV.approvedIpRange', '198.51.100.0/24', 'operator_interview', 'high', 'synthetic-org-content:a'),
      fact('OPV.baselineTemplateId', 'tmpl-1', 'auto_detected', 'high', 'graph:deviceManagementTemplates'),
    ];
    const { db } = await import('@/shared/db/schema');
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const file = path.resolve(process.cwd(), 'public', decodeURI(String(url)).replace(/^\//, ''));
      if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '', json: async () => null } as unknown as Response;
      const text = fs.readFileSync(file, 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
    }) as typeof fetch;
    const entropy = freezeEntropy();
    try {
      await db.engagements.put(musterSession.engagement);
      await db.assessed_parties.put(musterSession.party);
      await db.interview_sessions.put({ ...session, id: `${session.id}-w1` });
      const { compilePlanForSession } = await import('@/features/plan/planCompileService');
      const r = await compilePlanForSession(`${session.id}-w1`);
      const ti = (r.artifacts.tenantManifest as unknown as { tenant_manifest: { tenant_identity: Record<string, unknown> } })
        .tenant_manifest.tenant_identity;
      expect(ti.approverUPN).toBe('approver@simtenant-a.onmicrosoft.us');
      expect(ti.approvedIpRange).toBe('198.51.100.0/24');
      expect(ti.baselineTemplateId).toBe('tmpl-1');
      expect(ti.complianceRoleId).toBe(ENTRA_ROLE_TEMPLATE.complianceAdministrator);
      expect(ti.roleDefId).toBe(ENTRA_ROLE_TEMPLATE.globalAdministrator);
      expect('subscriptionId' in ti).toBe(false);
      expect((ti.operator_value_provenance as { values: Record<string, string> }).values).toMatchObject({
        approverUPN: 'asked',
        approvedIpRange: 'asked',
        baselineTemplateId: 'discovered',
        complianceRoleId: 'derived',
        roleDefId: 'derived',
      });
      // snake_case tenant keys from the discovered organisation read (TCP.TI.001 / TI.002).
      expect(ti.tenant_id).toBe('00000000-0000-4000-8000-00000000000a');
      expect(ti.primary_domain).toBe('simtenant-a.onmicrosoft.us');
      expect(r.defaultedInputs).toContain('Operator value subscriptionId: unresolved');
      expect(r.defaultedInputs).not.toContain('Operator value approverUPN: unresolved');
    } finally {
      entropy.restore();
      globalThis.fetch = real;
    }
  });
});

describe("W1 plan mode: only 'yes' counts as in place", () => {
  test("'unsure', a typed value and 'no' are not counted", () => {
    const d = derivePlanMode({
      facts: [
        fact('RR-ACT-A', 'yes', 'auto_detected'),
        fact('RR-ACT-B', 'unsure', 'auto_detected', 'unknown'),
        fact('TCP.TI.001', '00000000-0000-4000-8000-00000000000a', 'auto_detected'),
        fact('RR-ACT-C', 'no', 'auto_detected'),
      ],
      hasTenantManifest: true,
    });
    expect(d.planMode).toBe('harden_existing');
    expect(d.reason).toBe('established target tenant (1 of 4 discovery reads found controls in place)');
  });
});

describe('W1 OPV fallbacks: operatorUPN / breakGlassUPN / breakGlassUserId', () => {
  const TCP_BANK = load(
    fs.readFileSync(path.resolve('public/knowledge', 'primed TCP Question Bank.yaml'), 'utf8')
  ) as TcpQuestionBank;
  const ORG = 'synthetic-org-content:w1-test';
  const opv = (v: string, a: string) => fact(`OPV.${v}`, a, 'operator_interview', 'high', ORG);
  const OPV_FACTS = [
    opv('operatorUPN', 'op@x.example'),
    opv('breakGlassUPN', 'bg@x.example'),
    opv('breakGlassUserId', 'user-5'),
  ];
  // A discovered primary domain, so the bank's breakglass1@{domain} placeholder resolves (defaulted).
  const DOMAIN = fact('TCP.TI.002', 'w1.example', 'auto_detected', 'high', 'graph:organization');
  const build = (facts: InterviewFact[]) =>
    buildTenantConfigProfile([DOMAIN, ...facts], TCP_BANK, null, { orgName: 'W1 Co', tenantSlug: 'w1-test' });
  const opDefaulted = (r: ReturnType<typeof build>) =>
    r.defaulted.filter((d) => /Operator value (operator_upn|breakglass_upn|break_glass_user_id)/.test(d));

  test('no discovery: the answered values apply (over the bank placeholder), provenance asked, none defaulted', () => {
    const r = build(OPV_FACTS);
    expect(r.operatorValues.operator_upn).toMatchObject({ value: 'op@x.example', provenance: 'asked' });
    expect(r.operatorValues.breakglass_upn).toMatchObject({ value: 'bg@x.example', provenance: 'asked' });
    expect(r.operatorValues.break_glass_user_id).toMatchObject({ value: 'user-5', provenance: 'asked' });
    expect(r.operatorValues.breakglass_upn.from).toBe(`OPV.breakGlassUPN (${ORG}); answered fallback (discovery gave no value)`);
    expect(opDefaulted(r)).toEqual([]);
  });

  test('without answered values the bank placeholder and the unresolved id stay defaulted (unchanged)', () => {
    const r = build([]);
    expect(r.operatorValues.breakglass_upn).toMatchObject({ value: 'breakglass1@w1.example', provenance: 'defaulted' });
    expect(r.operatorValues.break_glass_user_id).toMatchObject({ value: null, provenance: 'defaulted' });
    expect(r.operatorValues.operator_upn).toMatchObject({ value: null, provenance: 'defaulted' });
  });

  test('a discovered value always wins, and its source names the answered value it beat', () => {
    const r = build([
      ...OPV_FACTS,
      fact('TCP.MU.004', 'me@x.example', 'auto_detected', 'high', 'graph:me'),
      fact('TCP.IA.001', 'disc-bg@x.example', 'auto_detected', 'high', 'graph:conditionalAccess'),
      fact('TCP.MU.005', 'user-9', 'auto_detected', 'high', 'graph:conditionalAccess'),
    ]);
    expect(r.operatorValues.operator_upn).toMatchObject({ value: 'me@x.example', provenance: 'discovered' });
    expect(r.operatorValues.breakglass_upn).toMatchObject({ value: 'disc-bg@x.example', provenance: 'discovered' });
    expect(r.operatorValues.break_glass_user_id).toMatchObject({ value: 'user-9', provenance: 'discovered' });
    expect(r.operatorValues.break_glass_user_id.from).toBe(
      `TCP.MU.005; answered OPV.breakGlassUserId (${ORG}) not used (discovered value wins)`
    );
    expect(r.operatorValues.breakglass_upn.from).toContain('TCP.IA.001[0]; answered OPV.breakGlassUPN');
  });

  test('discovery that found no break-glass account (an empty TCP.IA.001) leaves the answered value in place', () => {
    const r = build([...OPV_FACTS, fact('TCP.IA.001', '', 'auto_detected', 'high', 'graph:conditionalAccess')]);
    expect(r.operatorValues.breakglass_upn).toMatchObject({ value: 'bg@x.example', provenance: 'asked' });
  });

  test('the register answer for the key is kept over the OPV value; other OPV keys are not fallbacks', () => {
    const r = build([
      ...OPV_FACTS,
      answer('TCP.MU.005', 'user-7'),
      opv('cuiGroupName', 'Not-A-Fallback'),
      fact('OPV.operatorUPN', 'later@x.example', 'operator_interview', 'unknown', ORG),
    ]);
    expect(r.operatorValues.break_glass_user_id).toMatchObject({ value: 'user-7', provenance: 'asked' });
    expect(r.operatorValues.break_glass_user_id.from).toContain('not used (asked value wins)');
    expect(r.operatorValues.cui_group_name.value).not.toBe('Not-A-Fallback');
    expect(r.operatorValues.operator_upn.value).toBe('op@x.example'); // an unknown-confidence fact is not an answer
  });

  test('fixture (a) without its discovered operator facts: the TM carries all three answered keys, none defaulted', async () => {
    const { musterSession } = loadCustomer('a');
    const session = structuredClone(musterSession.session) as typeof musterSession.session & { facts: InterviewFact[] };
    const dropped = new Set(['TCP.IA.001', 'TCP.MU.004', 'TCP.MU.005']);
    session.facts = [...(session.facts as InterviewFact[]).filter((f) => !dropped.has(f.question_id)), ...OPV_FACTS];
    const { db } = await import('@/shared/db/schema');
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const file = path.resolve(process.cwd(), 'public', decodeURI(String(url)).replace(/^\//, ''));
      if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '', json: async () => null } as unknown as Response;
      const text = fs.readFileSync(file, 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
    }) as typeof fetch;
    const entropy = freezeEntropy();
    try {
      await db.engagements.put(musterSession.engagement);
      await db.assessed_parties.put(musterSession.party);
      await db.interview_sessions.put({ ...session, id: `${session.id}-w1-opv` });
      const { compilePlanForSession } = await import('@/features/plan/planCompileService');
      const r = await compilePlanForSession(`${session.id}-w1-opv`);
      const ti = (r.artifacts.tenantManifest as unknown as { tenant_manifest: { tenant_identity: Record<string, unknown> } })
        .tenant_manifest.tenant_identity;
      expect(ti).toMatchObject({ operatorUPN: 'op@x.example', breakGlassUPN: 'bg@x.example', breakGlassUserId: 'user-5' });
      expect((ti.operator_value_provenance as { values: Record<string, string> }).values).toMatchObject({
        operatorUPN: 'asked',
        breakGlassUPN: 'asked',
        breakGlassUserId: 'asked',
      });
      expect(
        r.validation.operatorValues.defaulted.filter((d) => /^(operatorUPN|breakGlassUPN|breakGlassUserId):/.test(d))
      ).toEqual([]);
    } finally {
      entropy.restore();
      globalThis.fetch = real;
    }
  });
});

describe('W5c2: the engagement profile from org-content', () => {
  test('profile.org_name / cage / uei become the party; absent org_name -> null; blanks dropped', () => {
    expect(partyFromOrgContent({ profile: { org_name: ' Example Org (FICTIONAL) ', cage: '0ABC1', uei: 'SIMX00000000' } })).toEqual({
      name: 'Example Org (FICTIONAL)',
      cage: '0ABC1',
      uei: 'SIMX00000000',
    });
    expect(partyFromOrgContent({ profile: { org_name: 'Example Org', cage: ' ' } })).toEqual({ name: 'Example Org' });
    expect(partyFromOrgContent({ profile: { cage: '0ABC1' } })).toBeNull();
    expect(partyFromOrgContent(undefined)).toBeNull();
  });

  test('the party fills the policy inputs profile organization (PI.ORG.001 / 006 / 007)', () => {
    const party = partyFromOrgContent({ profile: { org_name: 'Example Org (FICTIONAL)', cage: '0ABC1', uei: 'SIMX00000000' } })!;
    const BANK = load(fs.readFileSync(path.resolve('public/knowledge', 'primed Policy Inputs Question Bank.yaml'), 'utf8')) as unknown;
    const org = buildPolicyInputsProfile({ facts: [], party, missionPlan: null, bank: BANK }).output.organization;
    expect(org).toMatchObject({ legal_name: 'Example Org (FICTIONAL)', cage_code: '0ABC1', duns_number: 'SIMX00000000' });
  });
});
