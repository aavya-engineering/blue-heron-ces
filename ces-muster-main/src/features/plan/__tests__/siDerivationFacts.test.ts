// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU MU-10: derive the SIT fields the interview or the Tenant Config Profile
// already answers. Each derivation reads a session fact the operator gave for
// ANOTHER question (never the SIT question itself — that is an explicit answer
// and wins by precedence), carries a source pointer, and is conservative: an
// answer that does not determine the SIT value derives nothing.
import { describe, test, expect } from 'vitest';
import { deriveSitFacts, sitProvenanceOf } from '../siDerivation';
import type { InterviewFact } from '@/shared/types/engagement';

function fact(id: string, answer: string, confidence: InterviewFact['confidence'] = 'high'): InterviewFact {
  return { question_id: id, question_text: '', answer, provenance: 'operator_interview', confidence, recorded_at: '1970-01-01T00:00:00.000Z' };
}

const byId = (facts: InterviewFact[]) => Object.fromEntries(facts.map((f) => [f.question_id, f]));

describe('SIT derivations from interview and TCP facts', () => {
  test('bnd-001 yes, TCP cloud, TCP licence and TCP enrolment derive G-02, S-20, SIT-021, S-13', () => {
    const { facts, derivedIds } = deriveSitFacts({
      selectedStacks: [],
      facts: [fact('bnd-001', 'yes'), fact('TCP.TI.004', 'gcc_high'), fact('TCP.LIC.001', 'm365_g5'), fact('TCP.DM.001', 'enroll_only')],
    });
    expect(derivedIds).toEqual(expect.arrayContaining(['G-02', 'S-20', 'SIT-021', 'S-13']));
    const d = byId(facts);
    expect(d['G-02']).toMatchObject({ answer: 'cui_present', provenance: 'derived:si:interview:bnd-001' });
    expect(d['S-20']).toMatchObject({ answer: 'gcc_high', provenance: 'derived:si:tcp:cloud_environment' });
    expect(d['SIT-021']).toMatchObject({ answer: 'g5', provenance: 'derived:si:tcp:primary_sku' });
    expect(d['S-13']).toMatchObject({ answer: 'allowed_mdm', provenance: 'derived:si:tcp:enrollment_type' });
    for (const f of facts) {
      expect(f.provenance).toMatch(/^derived:si:[a-z]+:[a-z0-9_-]+$/);
      expect(sitProvenanceOf(f.provenance)).toBe(f.provenance.startsWith('derived:si:engine') ? 'system_observation' : 'client_assertion');
    }
  });

  test('the TCP cloud environment beats the stack tile for S-20; the TCP licence beats it for SIT-021', () => {
    const { facts } = deriveSitFacts({
      selectedStacks: ['m365_e3'],
      facts: [fact('TCP.TI.004', 'gcc'), fact('TCP.LIC.001', 'o365_g3')],
    });
    const d = byId(facts);
    expect(d['S-20'].answer).toBe('gcc');
    expect(d['SIT-021'].answer).toBe('g3');
  });

  test('answers that do not determine the value derive nothing (no invented answers)', () => {
    const { derivedIds } = deriveSitFacts({
      selectedStacks: [],
      facts: [
        fact('bnd-001', 'no'), // no CUI could be no_cui OR fci_only
        fact('TCP.TI.004', 'dod'), // DoD could be IL5 or IL6
        fact('TCP.LIC.001', 'm365_e5'), // E5 is not in the SI licence enum
        fact('TCP.DM.001', 'azure_ad_join'), // corporate join says nothing about BYOD
      ],
    });
    for (const id of ['G-02', 'S-20', 'SIT-021', 'S-13']) expect(derivedIds).not.toContain(id);
  });

  test('an "I\'m not sure" source fact derives nothing', () => {
    const { derivedIds } = deriveSitFacts({ selectedStacks: [], facts: [fact('bnd-001', 'yes', 'unknown')] });
    expect(derivedIds).not.toContain('G-02');
  });
});
