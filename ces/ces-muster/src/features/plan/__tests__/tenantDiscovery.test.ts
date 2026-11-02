// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node

// MG-13 / MG-14 gates:
//  - typed TCP nodes are a transcription of the bank (id, binding, answer type);
//  - fixture (a), discovery pre-fills in place of the derivable answers: the SI
//    Baseline equals Planner's golden (except the intended section-5 carries)
//    and the TCP equals Planner's golden; derived SI fields carry a
//    `derived:si:discovery:` provenance;
//  - every TCP field carries one provenance class; defaultedInputs lists only
//    fields with a register row or a provenance entry;
//  - the FX-11 operator values are emitted with provenance (placeholders only
//    for the two undiscoverable values).
import 'fake-indexeddb/auto';
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import { TCP_TYPED_NODE_SPECS, TCP_OPERATOR_NODE_SPECS, TCP_PLAN_INPUT_NODES } from '@/features/interview/tcpPlanInputNodes';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import registerJson from '@/features/interview/questionRegister.json';
import type { InterviewFact } from '@/shared/types/engagement';
import { SI_FIELD_LABELS } from '../siResidue';
import { deriveSitFacts } from '../siDerivation';
import {
  buildTenantConfigProfile,
  operatorValuesFor,
  type TcpQuestionBank,
} from '../tcpAdapter';
import { operatorTenantKeys, operatorStamperVariables } from '../derive/operatorValues';
import { diffArtifact, loadCustomer } from './parityHarness';
import { freezeEntropy } from './fixtureInputs';

const BANK = load(
  fs.readFileSync(path.resolve('public/knowledge', 'primed TCP Question Bank.yaml'), 'utf8')
) as TcpQuestionBank;
const BANK_Q = new Map(BANK.sections.flatMap((s) => s.questions).map((q) => [q.id, q]));

function stubKnowledgeFetch(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const file = path.resolve(process.cwd(), 'public', decodeURI(String(url)).replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '', json: async () => null } as unknown as Response;
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

async function compileFixture(key: string) {
  const { musterSession, goldens } = loadCustomer(key);
  const { db } = await import('@/shared/db/schema');
  const restore = stubKnowledgeFetch();
  const entropy = freezeEntropy();
  try {
    await db.engagements.put(musterSession.engagement);
    await db.assessed_parties.put(musterSession.party);
    await db.interview_sessions.put(musterSession.session);
    const { compilePlanForSession } = await import('../planCompileService');
    const result = await compilePlanForSession(musterSession.session.id);
    return { result, goldens, musterSession };
  } finally {
    entropy.restore();
    restore();
  }
}

function fact(question_id: string, answer: string, provenance = 'operator_interview', source?: string): InterviewFact {
  return {
    question_id,
    question_text: question_id,
    answer,
    provenance,
    confidence: 'high',
    recorded_at: '1970-01-01T00:00:00.000Z',
    ...(source ? { source } : {}),
  };
}

describe('MG-14 typed TCP nodes ↔ primed TCP bank', () => {
  test('every typed node is a bank question with the same binding and answer type', () => {
    for (const s of TCP_TYPED_NODE_SPECS) {
      const q = BANK_Q.get(s.id);
      expect(q, s.id).toBeDefined();
      expect(q!.bindings.tenant_config).toBe(s.field);
      expect(q!.answer_type).toBe(s.bankType);
    }
  });

  test('operator nodes are not bank questions, ride the graph and carry no requirements', () => {
    for (const s of TCP_OPERATOR_NODE_SPECS) expect(BANK_Q.has(s.id)).toBe(false);
    for (const n of TCP_PLAN_INPUT_NODES) {
      expect(QUESTION_GRAPH).toContain(n);
      expect(n.mapped_requirements).toEqual([]);
    }
  });
});

describe('MG-13 SI derivations', () => {
  test('no CUI declared targets L1; the commercial tile is the SI enum commercial_only', () => {
    const r = deriveSitFacts({ selectedStacks: ['m365_e3'], facts: [fact('G-02', 'no_cui')] });
    const by = new Map(r.facts.map((f) => [f.question_id, f]));
    expect(by.get('G-01')?.answer).toBe('L1');
    expect(by.get('S-20')?.answer).toBe('commercial_only');
  });

  test('a gcc_g5 preamble derives the SI tier g5, E3 derives nothing', () => {
    const g5 = deriveSitFacts({ selectedStacks: [], preamble: { license_tier: 'gcc_g5' } });
    expect(g5.facts.find((f) => f.question_id === 'SIT-021')?.answer).toBe('g5');
    const e3 = deriveSitFacts({ selectedStacks: ['m365_e3'] });
    expect(e3.facts.find((f) => f.question_id === 'SIT-021')).toBeUndefined();
  });

  test('a discovered TCP fact gives a discovery provenance; an asked one a tcp provenance', () => {
    const disc = deriveSitFacts({ selectedStacks: [], facts: [fact('TCP.LIC.002', '40', 'auto_detected', 'graph:subscribedSkus')] });
    expect(disc.facts.find((f) => f.question_id === 'SIT-022')?.provenance).toBe('derived:si:discovery:graph:subscribedSkus');
    const asked = deriveSitFacts({ selectedStacks: [], facts: [fact('TCP.LIC.002', '40')] });
    expect(asked.facts.find((f) => f.question_id === 'SIT-022')?.provenance).toBe('derived:si:tcp:license_count');
  });

  test('mobile presence follows the platforms in scope and the enrollment type', () => {
    const mob = (platforms: string, dm?: string) =>
      deriveSitFacts({
        selectedStacks: [],
        facts: [fact('TCP.DM.004', platforms), ...(dm ? [fact('TCP.DM.001', dm)] : [])],
      }).facts.find((f) => f.question_id === 'S-25')?.answer;
    expect(mob('Windows')).toBe('no_mobile_devices');
    expect(mob('Windows, iOS/iPadOS', 'azure_ad_join')).toBe('company_managed_only');
    expect(mob('Android', 'enroll_only')).toBe('byod_and_company');
  });
});

describe('MG-13 / MG-14 fixture (a): discovery reproduces Planner', () => {
  test('SI Baseline equals the golden (only the intended section-5 dependency carries and W5c2 governance owners differ)', async () => {
    const { result, goldens } = await compileFixture('a');
    const diffs = diffArtifact('si-baseline', goldens['si-baseline'], result.artifacts.siBaseline);
    expect(diffs.map((d) => `${d.kind} ${d.path}`).sort()).toEqual([
      // W5c2: derived from the fixture's PI.PER.001-003 answers (siGovernanceFromFacts); Planner writes "Not specified".
      'changed si_baseline/governance/affirming_official',
      'changed si_baseline/governance/audit_interface_owner',
      'changed si_baseline/governance/change_control_owner',
      'changed si_baseline/risk_acceptance/risk_acceptance_authority',
      'extra si_baseline/dependencies/infrastructure_model',
      'extra si_baseline/dependencies/license_tier',
      'extra si_baseline/dependencies/user_count',
    ]);
  });

  test('derived SI fields carry discovery provenance; the session no longer answers them', async () => {
    const { result, musterSession } = await compileFixture('a');
    const asked = new Set((musterSession.session.facts as InterviewFact[]).map((f) => f.question_id));
    for (const id of ['S-20', 'SIT-021', 'SIT-022', 'S-11', 'S-25']) {
      expect(asked.has(id), id).toBe(false);
      const s = result.siFieldSources[id];
      expect(s.source, id).toBe('derived');
      expect((s as { provenance: string }).provenance, id).toMatch(/^derived:si:discovery:graph:/);
    }
  });

  test('TCP equals the golden and validates against Planner’s TCP JSON schema', async () => {
    const { result, goldens } = await compileFixture('a');
    expect(diffArtifact('tenant-config-profile', goldens['tenant-config-profile'], result.artifacts.tenantConfig)).toEqual([]);
    const schema = JSON.parse(
      fs.readFileSync(path.resolve('public/schemas/planner/CES TCP Tenant Config Profile.schema.json'), 'utf8')
    );
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
    expect(validate(result.artifacts.tenantConfig), JSON.stringify(validate.errors)).toBe(true);
  });

  test('defaultedInputs lists only fields with a register row or a TCP provenance entry', async () => {
    const { result } = await compileFixture('a');
    const registerIds = new Set((registerJson as { rows: Array<{ id: string }> }).rows.map((r) => r.id));
    const siIdByLabel = new Map(Object.entries(SI_FIELD_LABELS).map(([id, label]) => [label, id]));
    for (const d of result.defaultedInputs) {
      const tcp = /^TCP (TCP\.[A-Z]+\.\d+):/.exec(d);
      if (tcp) {
        expect(BANK_Q.has(tcp[1]), d).toBe(true);
        continue;
      }
      if (d.startsWith('Operator value ')) continue; // operatorValues entries carry provenance 'defaulted'
      const si = siIdByLabel.get(d) ?? d;
      if (registerIds.has(si) || !SI_FIELD_LABELS[si]) continue;
      throw new Error(`defaulted input without a register row: ${d}`);
    }
  });

  test('FX-11 operator values: discovered / asked, keyed for the TM and for Stamper', async () => {
    const { result } = await compileFixture('a');
    const v = operatorValuesFor(result.artifacts.tenantConfig)!;
    expect(v).not.toBeNull();
    expect(v.operator_upn).toMatchObject({ value: 'admin@simtenant-a.onmicrosoft.us', provenance: 'discovered' });
    expect(v.breakglass_upn).toMatchObject({ value: 'breakglass1@simtenant-a.onmicrosoft.us', provenance: 'discovered' });
    expect(v.break_glass_user_id).toMatchObject({ value: '00000000-0000-4002-8000-00000000000a', provenance: 'discovered' });
    expect(v.cui_group_name).toMatchObject({ value: 'CUI-Authorized-Users', provenance: 'discovered' });
    expect(v.wifi_ssid.provenance).toBe('asked');
    expect(v.security_email.provenance).toBe('asked');
    // W5c6: cisoEmail mirrors securityEmail (value and provenance).
    expect(v.ciso_email).toMatchObject({ value: v.security_email.value, provenance: v.security_email.provenance, stamperVar: 'cisoEmail' });
    expect(Object.keys(operatorTenantKeys(v)).sort()).toEqual(
      ['break_glass_user_id', 'breakglass_upn', 'ciso_email', 'cui_group_name', 'operator_upn', 'security_email', 'wifi_ssid']
    );
    expect(operatorStamperVariables(v).breakGlassUPN).toBe('breakglass1@simtenant-a.onmicrosoft.us');
    expect(result.artifacts.tenantConfig!.tenant_config.identity_architecture.break_glass_accounts).toHaveLength(2);
  });
});

describe('MG-14 TCP provenance', () => {
  test('every bank question carries exactly one provenance class', () => {
    const { musterSession } = loadCustomer('a');
    const r = buildTenantConfigProfile(musterSession.session.facts as InterviewFact[], BANK, null, {
      orgName: musterSession.party.name,
      tenantSlug: 'simtenant-a',
    });
    expect(Object.keys(r.provenance).sort()).toEqual([...BANK_Q.keys()].sort());
    for (const p of Object.values(r.provenance)) expect(['discovered', 'asked', 'derived', 'archetype', 'defaulted']).toContain(p);
    expect(r.provenance['TCP.TI.001']).toBe('discovered');
    expect(r.provenance['TCP.IA.001']).toBe('discovered');
    expect(r.provenance['TCP.MON.003']).toBe('asked'); // Sentinel: ARM, not Graph
    expect(r.provenance['TCP.DM.002']).toBe('defaulted'); // a naming convention
  });

  test('an archetype prior fills only what the session and SI leave empty', () => {
    const r = buildTenantConfigProfile([fact('TCP.CA.003', '3')], BANK, null, {
      orgName: 'Prior Co',
      archetypePriors: { 'TCP.CA.003': 9, 'TCP.PA.005': 'SG-Prior-Exclusion' },
    });
    expect(r.provenance['TCP.CA.003']).toBe('asked');
    expect(r.provenance['TCP.PA.005']).toBe('archetype');
    expect(r.tenantConfig.tenant_config.privileged_access.break_glass_exclusion_group).toBe('SG-Prior-Exclusion');
  });

  test('with nothing held, the undiscoverable operator values are visible placeholders, the rest absent', () => {
    const r = buildTenantConfigProfile([], BANK, null, { orgName: 'Empty Co' });
    expect(r.operatorValues.wifi_ssid).toMatchObject({ value: 'MUSTER-DEFAULT-SSID', provenance: 'defaulted' });
    expect(r.operatorValues.security_email.provenance).toBe('defaulted');
    expect(r.operatorValues.operator_upn.value).toBeNull();
    expect(r.defaulted.some((d) => d.startsWith('Operator value wifi_ssid'))).toBe(true);
  });
});
