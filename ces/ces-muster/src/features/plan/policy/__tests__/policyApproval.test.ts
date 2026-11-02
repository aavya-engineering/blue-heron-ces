// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node
// W5 cycle 1 (SC-6, SC-2 row 16): every rendered policy names its owner
// (default ISSM) and its approver with name and title; "Designated Official"
// and "Not specified" never show when the organisation knows the name; the
// policies are effective on the plan date unless an approval date is answered.
// The fictional organisation below is invented for these tests.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { describe, test, expect } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import type { PolicyTemplateContext } from '@/features/plan/engine/mpt/services/policyContextCompiler';
import type { RenderedPolicyDocument } from '@/features/plan/engine/mpt/services/policyRenderer';
import { buildPolicyInputsProfile } from '../policyInputsProfile';
import {
  documentApprover,
  documentOwner,
  resolvePolicySignatories,
  withApprovalBlock,
  withOrganisationNames,
} from '../policyDocuments';

const bank = load(fs.readFileSync(path.resolve(process.cwd(), 'public', 'knowledge', 'primed Policy Inputs Question Bank.yaml'), 'utf8'));

const ORG = {
  roles: {
    owner: { name: 'Ardel Fenwright', title: 'President', upn: 'ardel.fenwright@test-org.simtenant.onmicrosoft.us' },
    authorizing_official: { name: 'Ardel Fenwright', title: 'President', upn: 'ardel.fenwright@test-org.simtenant.onmicrosoft.us' },
    isso: { name: 'Brisa Kettlemoor', title: 'ISSO', upn: 'brisa.kettlemoor@test-org.simtenant.onmicrosoft.us' },
    issm: { name: 'Corran Wexfield', title: 'Information Security Manager (ISSM)', upn: 'corran.wexfield@test-org.simtenant.onmicrosoft.us' },
    fso: { name: 'Delra Oakhollow', title: 'Facility Security Officer', upn: 'delra.oakhollow@test-org.simtenant.onmicrosoft.us' },
    cui_manager: { name: 'Evrin Thistledown', title: 'CUI Manager', upn: 'evrin.thistledown@test-org.simtenant.onmicrosoft.us' },
  },
  approvers: { policy_approver: { name: 'Ardel Fenwright', title: 'President' } },
};

const person = (name: string, title: string, role_title: string) => ({ name, title, email: '', role_title });
/** A context with only the fields these helpers read (personnel, si governance owners). */
const ctx = (personnel: PolicyTemplateContext['personnel'], si: Partial<PolicyTemplateContext['si']> = {}): PolicyTemplateContext =>
  ({ personnel, si: { affirming_official: 'Not specified', change_control_owner: 'Not specified', ...si } }) as unknown as PolicyTemplateContext;
const doc = (markdown: string, template_id = 'access_control_policy'): RenderedPolicyDocument => ({
  template_id,
  title: 'T',
  markdown,
  completeness: 100,
  domain: 'AC',
  nist_controls: [],
});

describe('W5 SC-6: signatories', () => {
  test('the approver is the org-content policy approver, then its authorizing official, then the System Owner', () => {
    const c = ctx({ system_owner: person('Fallon Grieve', 'CEO', 'System Owner') });
    expect(resolvePolicySignatories(c, ORG).approver).toEqual({ name: 'Ardel Fenwright', title: 'President', source: 'org-content approvers.policy_approver' });
    expect(resolvePolicySignatories(c, { roles: ORG.roles }).approver?.source).toBe('org-content roles.authorizing_official');
    expect(resolvePolicySignatories(c, undefined).approver).toEqual({ name: 'Fallon Grieve', title: 'CEO', source: 'policy personnel system_owner' });
  });

  test('the default owner is the ISSM (org content), else the Compliance Officer; no name gives null, never a stand-in', () => {
    const c = ctx({ compliance_officer: person('Gessa Rowan', 'ISSM', 'Compliance Officer') });
    expect(resolvePolicySignatories(c, ORG).owner?.name).toBe('Corran Wexfield');
    expect(resolvePolicySignatories(c, undefined).owner?.name).toBe('Gessa Rowan');
    const blank = ctx({ system_owner: person('Designated Official', '', 'System Owner'), compliance_officer: person('', '', 'Compliance Officer') });
    expect(resolvePolicySignatories(blank, undefined)).toEqual({ owner: null, approver: null });
  });
});

describe('W5 SC-6: organisation names fill empty roles and "Not specified" owners', () => {
  test('an empty personnel role takes the matching org-content role; a named role is never replaced', () => {
    const c = withOrganisationNames(ctx({ isso: person('Hale Named', 'ISSO', 'ISSO') }), ORG);
    expect(c.personnel.isso.name).toBe('Hale Named');
    expect(c.personnel.system_owner).toMatchObject({ name: 'Ardel Fenwright', title: 'President' });
    expect(c.personnel.compliance_officer).toMatchObject({ name: 'Corran Wexfield', email: 'corran.wexfield@test-org.simtenant.onmicrosoft.us' });
    expect(c.personnel.facilities_manager.name).toBe('Delra Oakhollow');
    expect(c.personnel.legal_representative.name).toBe('Evrin Thistledown');
    expect(c.personnel.it_director).toBeUndefined();
  });

  test('affirming official = the approver, change control owner = the ISSM; a named value is kept; no org content changes nothing', () => {
    const c = withOrganisationNames(ctx({}), ORG);
    expect(c.si.affirming_official).toBe('Ardel Fenwright');
    expect(c.si.change_control_owner).toBe('Corran Wexfield');
    expect(withOrganisationNames(ctx({}, { affirming_official: 'Ivo Set', change_control_owner: 'Jun Set' }), ORG).si).toMatchObject({
      affirming_official: 'Ivo Set',
      change_control_owner: 'Jun Set',
    });
    expect(withOrganisationNames(ctx({}), undefined).si.affirming_official).toBe('Not specified');
  });
});

describe('W5 SC-6: the approval block', () => {
  const sig = resolvePolicySignatories(withOrganisationNames(ctx({}), ORG), ORG);

  test('a document with an owner and no approver gains a named approver with title, signature and date', () => {
    const out = withApprovalBlock(doc('# T\n\nBody.\n\n---\n\n**Effective Date:** 2026-10-28\n**Policy Owner:** Brisa Kettlemoor\n'), sig).markdown;
    expect(out.endsWith('## Approval\n\n**Approved By:** Ardel Fenwright, President (Authorizing Official)\n**Signature:** ___________________________\n**Date:** ___________________________\n')).toBe(true);
    expect(documentApprover(out)).toBe('Ardel Fenwright, President (Authorizing Official)');
    expect(documentOwner(out)).toBe('Brisa Kettlemoor');
    expect(out.includes('Document Owner')).toBe(false);
  });

  test('a document with neither (the POA&M, the SSP) gains the ISSM as Document Owner and the approver', () => {
    const out = withApprovalBlock(doc('# POA&M\r\n\r\nBody.\r\n', 'poam'), sig).markdown;
    expect(documentOwner(out)).toBe('Corran Wexfield, Information Security Manager (ISSM)');
    expect(documentApprover(out)).toMatch(/^Ardel Fenwright, President/);
    expect(out.includes('\r\n## Approval\r\n')).toBe(true);
    expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  test('a document already naming both (Attestation block, Approved By cell) is the same object', () => {
    const attested = doc('# T\n\n## Attestation\n\n**Name:** Ardel Fenwright\n**Title:** President\n\n**Policy Owner:** Brisa Kettlemoor\n');
    expect(withApprovalBlock(attested, sig)).toBe(attested);
    const cell = doc('# T\n\n| **Approved By** | Ardel Fenwright |\n\n**Plan Owner:** Brisa Kettlemoor\n');
    expect(withApprovalBlock(cell, sig)).toBe(cell);
  });

  test('a blank approver ("Designated Official", [Name], empty) is replaced by a named one; no signatory adds nothing', () => {
    const blank = doc('# T\n\n## Attestation\n\n**Name:** Designated Official\n\n**Policy Owner:** Brisa Kettlemoor\n');
    // The scorecard reads an Approved By line before the Attestation block, as documentApprover does.
    expect(documentApprover(withApprovalBlock(blank, sig).markdown)).toBe('Ardel Fenwright, President (Authorizing Official)');
    const none = doc('# T\n\nBody.\n');
    expect(withApprovalBlock(none, { owner: null, approver: null })).toBe(none);
  });
});

describe('W5 SC-2 row 16: effective on approval = the plan date', () => {
  const party = { name: 'Test Org (FICTIONAL)' };
  const mp = { outputs: { human_readable_mission_plan: { milestones: [{ id: 'MS-1', target_date: '2027-04-18' }] } } };
  const fact = (question_id: string, answer: string): InterviewFact => ({
    question_id,
    question_text: question_id,
    answer,
    provenance: 'operator_interview',
    confidence: 'high',
    recorded_at: '2026-10-01T00:00:00.000Z',
    source: 'synthetic-interview:test',
  });
  const gov = (facts: InterviewFact[], planDate?: string) => {
    const p = buildPolicyInputsProfile({ facts, party, missionPlan: mp, bank, planDate });
    return { date: p.output.governance.policy_effective_date, src: p.sources.find((s) => s.question_id === 'PI.GOV.001')! };
  };

  test('no approval date: the plan date, derived, never the future milestone', () => {
    const g = gov([], '2026-10-28');
    expect(g.date).toBe('2026-10-28');
    expect(g.src).toMatchObject({ provenance: 'derived', source: 'plan date (policies effective on approval)', value: '2026-10-28' });
  });

  test('an answered approval date wins, with its source; a non-date answer falls back to the plan date', () => {
    expect(gov([fact('PI.GOV.001', '2026-10-20')], '2026-10-28').src).toMatchObject({ provenance: 'answered', source: 'synthetic-interview:test', value: '2026-10-20' });
    expect(gov([fact('PI.GOV.001', 'on approval')], '2026-10-28').date).toBe('2026-10-28');
  });

  test('without a plan date the profile uses today (UTC)', () => {
    expect(gov([]).date).toBe(new Date().toISOString().slice(0, 10));
  });
});
