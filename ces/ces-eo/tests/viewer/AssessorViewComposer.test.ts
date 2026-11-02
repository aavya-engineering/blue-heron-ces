// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * AssessorViewComposer — unifies ledger + SSP + POA&M lifecycle + mission plan + personas + WORM refs.
 */
import { describe, test, expect } from '@jest/globals';
import { composeAssessorView, parseEvidenceRef } from '../../src/eo/viewer/AssessorViewComposer.js';
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import type { PoamLedger } from '../../src/eo/poam/PoamLifecycle.js';

function ledger(): DeterminationLedger {
  const o = (objectiveId: string, controlId: string, status: 'satisfied' | 'other_than_satisfied' | 'not_assessed', weight: number, source = 'digital-signal') =>
    ({ objectiveId, controlId, statement: `stmt ${objectiveId}`, methods: ['examine', 'interview'], status, source: source as never, rationale: 'r', weight, noPoam: weight >= 5 });
  const objectives = [
    o('AC.L2-3.1.7[a]', 'AC.L2-3.1.7', 'other_than_satisfied', 5),
    o('AC.L2-3.1.7[b]', 'AC.L2-3.1.7', 'satisfied', 5),
    o('AT.L2-3.2.1[a]', 'AT.L2-3.2.1', 'other_than_satisfied', 3, 'training'),
  ];
  return {
    tenantId: 't', generatedAt: 'T1', objectives,
    controls: [
      { controlId: 'AC.L2-3.1.7', status: 'not_met', weight: 5, noPoam: true, objectives: objectives.slice(0, 2) },
      { controlId: 'AT.L2-3.2.1', status: 'not_met', weight: 3, noPoam: false, objectives: [objectives[2]] },
    ],
    deficiencies: [], summary: {
      objectivesTotal: 3, objectivesSatisfied: 1, objectivesOther: 2, objectivesNotAssessed: 0,
      controlsMet: 0, controlsNotMet: 2, controlsPartial: 0, controlsNotAssessed: 0, deficiencies: 2, certificationBlockers: 1,
    },
  };
}

const poam: PoamLedger = {
  poamId: 'p', tenantId: 't', generatedAt: 'T2',
  items: [
    { key: 'AC.L2-3.1.7[a]', objectiveId: 'AC.L2-3.1.7[a]', controlId: 'AC.L2-3.1.7', statement: 's', weight: 5, noPoam: true, status: 'open', openedAt: 'T1', lastSeenAt: 'T2', source: 'digital-signal', history: [{ at: 'T1', event: 'opened' }] },
    { key: 'AU.L2-3.3.1[a]', objectiveId: 'AU.L2-3.3.1[a]', controlId: 'AU.L2-3.3.1', statement: 's', weight: 1, noPoam: false, status: 'closed', openedAt: 'T0', closedAt: 'T1', lastSeenAt: 'T0', source: 'digital-signal', history: [{ at: 'T0', event: 'opened' }, { at: 'T1', event: 'auto-closed' }] },
  ],
  summary: { open: 1, certificationBlockers: 1, closed: 1, newThisRun: 0, closedThisRun: 0, carriedForward: 1, reopenedThisRun: 0 },
};

describe('AssessorViewComposer', () => {
  test('composes objectives with provenance + joins POA&M lifecycle', () => {
    const view = composeAssessorView({ ledger: ledger(), poamLedger: poam });
    const a = view.objectives.find(o => o.objectiveId === 'AC.L2-3.1.7[a]')!;
    expect(a.family).toBe('AC');
    expect(a.certificationBlocker).toBe(true);
    expect(a.source).toBe('digital-signal');
    expect(a.poam?.status).toBe('open');
    const at = view.objectives.find(o => o.objectiveId === 'AT.L2-3.2.1[a]')!;
    expect(at.source).toBe('training');   // provenance preserved
  });

  test('joins SSP narrative + evidence refs + mission steps + personas onto controls', () => {
    const view = composeAssessorView({
      ledger: ledger(),
      ssp: { controlImplementations: [{ control_id: 'AC.L2-3.1.7', implementationNarrative: 'PIM enforced.', evidenceReferences: ['run-42/artifact-9', 'a plain note'] }] },
      missionPlan: { steps: [{ what_to_do: 'Convert standing GA to PIM', owner_role: 'ISSO', control_coverage: [{ control_id: 'AC.L2-3.1.7' }] }] },
      personas: [{ id: 'P6', title: 'Admin', description: '', cuiAccess: 'full', controls: ['AC.L2-3.1.7'] }],
    });
    const c = view.controls.find(c => c.controlId === 'AC.L2-3.1.7')!;
    expect(c.narrative).toBe('PIM enforced.');
    expect(c.evidence[0].wormVerifiable).toBe(true);
    expect(c.evidence[0].href).toContain('/api/evidence/artifacts/run-42/artifact-9');
    expect(c.evidence[1].wormVerifiable).toBe(false);   // unparseable -> shown honestly, no link
    expect(c.missionSteps[0].what).toMatch(/PIM/);
    expect(c.personas).toEqual(['P6']);
  });

  test('SPRS points-at-risk = summed weight of not-met (non-dispositioned) controls', () => {
    const view = composeAssessorView({ ledger: ledger() });
    // AC.L2-3.1.7 (5) + AT.L2-3.2.1 (3) not met = 8 at risk
    expect(view.sprs.pointsAtRisk).toBe(8);
    expect(view.sprs.score).toBe(110 - 8);
  });

  test('summary counts open + auto-closed POA&M items', () => {
    const view = composeAssessorView({ ledger: ledger(), poamLedger: poam });
    expect(view.summary.openPoamItems).toBe(1);
    expect(view.summary.autoClosedPoamItems).toBe(1);
  });

  test('parseEvidenceRef handles run/artifact and plain refs', () => {
    expect(parseEvidenceRef('run-1/art-2').wormVerifiable).toBe(true);
    expect(parseEvidenceRef('just a description').wormVerifiable).toBe(false);
  });

  test('FX-EO7: evidence links carry the view\'s tenant (the evidence routes require ?tenant=)', () => {
    const r = parseEvidenceRef('run-1/art-2', 'tenant a&b');
    expect(r.href).toBe('/api/evidence/artifacts/run-1/art-2?tenant=tenant%20a%26b');
    expect(r.verifyHref).toBe('/api/evidence/verify/run-1/art-2?tenant=tenant%20a%26b');
    const view = composeAssessorView({
      ledger: ledger(),
      ssp: { controlImplementations: [{ control_id: 'AC.L2-3.1.7', evidenceReferences: ['run-42/artifact-9'] }] },
      tenantSlug: 'acme-sim',
    });
    const ev = view.controls.find(c => c.controlId === 'AC.L2-3.1.7')!.evidence[0];
    expect(ev.href).toBe('/api/evidence/artifacts/run-42/artifact-9?tenant=acme-sim');
    expect(ev.verifyHref).toBe('/api/evidence/verify/run-42/artifact-9?tenant=acme-sim');
  });
});
