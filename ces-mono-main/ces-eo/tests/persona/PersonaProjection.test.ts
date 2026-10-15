// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PersonaProjection — the persona-facing view over the determination ledger.
 * Verifies scoping to the persona's controls + prioritized (cert-blocker-first) action backlog.
 */
import { describe, test, expect } from '@jest/globals';
import { projectPersona, loadPersonas } from '../../src/eo/persona/PersonaProjection.js';
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import type { Persona } from 'ces-shared/types/persona';

const persona: Persona = {
  id: 'PX', title: 'Test Admin', description: 'test', cuiAccess: 'full',
  controls: ['AC.L2-3.1.7', 'AU.L2-3.3.1'],   // owns these; NOT SC.L2-3.13.8
};

function ledger(): DeterminationLedger {
  const mk = (objectiveId: string, controlId: string, status: 'satisfied' | 'other_than_satisfied' | 'not_assessed', weight: number) =>
    ({ objectiveId, controlId, statement: `stmt ${objectiveId}`, methods: ['examine'], status, source: 'digital-signal' as const, rationale: '', weight, noPoam: weight >= 5 });
  const objectives = [
    mk('AC.L2-3.1.7[a]', 'AC.L2-3.1.7', 'other_than_satisfied', 5),   // cert-blocker deficiency
    mk('AC.L2-3.1.7[b]', 'AC.L2-3.1.7', 'satisfied', 5),
    mk('AU.L2-3.3.1[a]', 'AU.L2-3.3.1', 'not_assessed', 1),           // low-weight deficiency
    mk('SC.L2-3.13.8[a]', 'SC.L2-3.13.8', 'other_than_satisfied', 1), // NOT this persona's control
  ];
  const deficiencies = objectives.filter(o => o.status !== 'satisfied').map(o => ({
    key: o.objectiveId, objectiveId: o.objectiveId, controlId: o.controlId, statement: o.statement,
    status: o.status as 'other_than_satisfied' | 'not_assessed', source: o.source, weight: o.weight, noPoam: o.noPoam,
  }));
  return {
    tenantId: 't', generatedAt: 'T1', objectives,
    controls: [
      { controlId: 'AC.L2-3.1.7', status: 'not_met', weight: 5, noPoam: true, objectives: objectives.slice(0, 2) },
      { controlId: 'AU.L2-3.3.1', status: 'not_assessed', weight: 1, noPoam: false, objectives: [objectives[2]] },
      { controlId: 'SC.L2-3.13.8', status: 'not_met', weight: 1, noPoam: false, objectives: [objectives[3]] },
    ],
    deficiencies,
    summary: { objectivesTotal: 4, objectivesSatisfied: 1, objectivesOther: 2, objectivesNotAssessed: 1, controlsMet: 0, controlsNotMet: 2, controlsPartial: 0, controlsNotAssessed: 1, deficiencies: 3, certificationBlockers: 1 },
  };
}

describe('PersonaProjection', () => {
  test('scopes to only the persona\'s controls', () => {
    const p = projectPersona(persona, ledger());
    expect(p.controls.map(c => c.controlId).sort()).toEqual(['AC.L2-3.1.7', 'AU.L2-3.3.1']);
    expect(p.controls.some(c => c.controlId === 'SC.L2-3.13.8')).toBe(false);   // not theirs
  });

  test('action backlog lists only their deficiencies, cert-blockers first', () => {
    const p = projectPersona(persona, ledger());
    expect(p.actions.map(a => a.objectiveId)).toEqual(['AC.L2-3.1.7[a]', 'AU.L2-3.3.1[a]']);
    expect(p.actions[0].certificationBlocker).toBe(true);   // 5-point first
    expect(p.actions[0].priority).toBe(1);
    expect(p.actions.some(a => a.controlId === 'SC.L2-3.13.8')).toBe(false);
  });

  test('summary counts reflect only the persona scope', () => {
    const p = projectPersona(persona, ledger());
    expect(p.summary.controlsTotal).toBe(2);
    expect(p.summary.openDeficiencies).toBe(2);
    expect(p.summary.certificationBlockers).toBe(1);
  });

  test('the shipped persona catalog loads and covers P1..P8', () => {
    const personas = loadPersonas();
    expect(personas.map(p => p.id).sort()).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
    for (const p of personas) expect(p.controls.length).toBeGreaterThan(0);
  });
});
