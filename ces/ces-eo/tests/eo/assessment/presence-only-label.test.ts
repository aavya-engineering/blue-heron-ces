// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Founder decision 2026-10-27: verdicts from presence-only evaluators (docs/EVALUATOR-AUDIT.md:
 * met when the read returned any object) keep counting, but every such verdict is labelled
 * "presence only" in the discovery source, the control's statusRationale, the ledger and the SSP.
 * Proven on run 20's snapshot (offline replay of its stored reads and sources): the three
 * flagged controls carry the label; the W0.4-rewritten SI.L2-3.14.6 evaluator does not; counts
 * stay 80 / 6 / 0 / 24, SPRS 33. (EO-collection W2 part 2: RA.L2-3.11.3's evaluator now tests collected
 * vulnerability records that run 20 never read, so it moves not_met -> not_assessed: 80 / 5 / 0 / 25, SPRS 33.)
 * Synthetic-customer W5 cycle 1: 44 presence-only evaluators now test their condition (65 -> 21). On run 20
 * four more controls move: AC.L2-3.1.3 (no active CUI label) met -> not_met; IA.L2-3.5.7, IA.L2-3.5.10,
 * IA.L2-3.5.11 met -> not_assessed (their setting is not in the read the registry routes, and no Stamper
 * record backs them): 76 / 6 / 0 / 28, SPRS 25. The flagged controls
 * are now CM.L2-3.4.2 and SC.L2-3.13.2, whose evaluators are still presence only.
 * Synthetic-customer W5 cycle 2: IA.L2-3.5.10 not_assessed -> not_met at Tier 2: the cycle-1 conditional-access route on IA.L2-3.5.10 (ces-shared registry, run 44a item 2) lets certBasedAuthEvaluator read the CA policies, and none of run 20's 8 blocks legacy authentication for all users: 76 / 7 / 0 / 27, SPRS 25.
 * EO-2 rewrote asrRulesEvaluator (CM.L2-3.4.2) and the three firewall evaluators to test the settings-catalog
 * settings Stamper deploys (21 -> 17). Run 20 never read the settings catalog, so they are not assessed and the
 * Stamper Tier 3 SATs keep those four met; the deviceConfigurations example flagged here is now MP.L2-3.8.5.
 * W5 cycle 3 (assignment-aware credit): run 20's Intune objects carry no assignment information, so a live read of
 * them no longer credits (never presence-met). Four more movers, met -> not_assessed: AC.L2-3.1.17, MA.L2-3.7.4,
 * MP.L2-3.8.6, MP.L2-3.8.7 (no other source has an opinion): 72 / 7 / 0 / 31, SPRS 11. MP.L2-3.8.5 stays met on
 * run 20's stored Stamper source (the replay's stored sources do not pass through the loader), no longer presence
 * only; the deviceConfigurations example is replaced by MP.L2-3.8.1 (sensitivity labels, still presence only).
 * W5 cycle 7: timeSourceEvaluator (AU.L2-3.3.7) tests the NTP client policy in the settings catalog; run 20 never
 * read it, so AU.L2-3.3.7 moves not_met -> not_assessed: 72 / 6 / 0 / 32.
 */
import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({ uploadEvidenceBlob: jest.fn(), downloadBlob: jest.fn() }), { virtual: true });
jest.mock('ces-shared/storage', () => ({ getStamperPlanDataRoot: jest.fn(() => '/tmp/golden-plan-data') }), { virtual: true });

import type { AssessmentSnapshot, ControlAssessment } from 'ces-shared/types/controls';
import type { SignalResult } from 'ces-shared/types/signal';
import { evaluatorRegistry, PRESENCE_ONLY_EVALUATORS, selectEvaluatorRegistry, GOOGLE_EVALUATOR_SET_ID } from '../../../src/eo/mapping/evaluators/index.js';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper.js';
import { ControlAssessor, type EoControlAssessment } from '../../../src/eo/assessment/ControlAssessor.js';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger.js';
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator.js';
import { isPresenceOnlySource } from '../../../src/eo/mapping/StatusTranslator.js';
import type { DirectiveControlImplementation } from '../../../src/shared/types/ssp.types.js';
import { replayRun20Snapshot, run20Fixture, controlsRefPath, sprsWeightsPath } from '../../ssp/run20-replay.js';

// EO-collection W2: auditReviewEvaluator (AU.L2-3.3.2) now tests that collected records name their actor,
// so it is no longer declared presence only (EVALUATOR-AUDIT.md row and PRESENCE_ONLY_EVALUATORS together).
const FLAGGED = ['MP.L2-3.8.1', 'SC.L2-3.13.2']; // W5 cycle 2: CM.L2-3.4.2 -> MP.L2-3.8.5 (EO-2); W5 cycle 3: -> MP.L2-3.8.1
const fx = run20Fixture();
const control = (snap: AssessmentSnapshot, id: string) => snap.controls.find(c => c.control_id === id) as EoControlAssessment;

describe('presence-only marker on the evaluator registry', () => {
  test('the 16 audit "presence only" evaluators are declared, each a registered entry', () => {
    // W2: auditEvents, auditReview, auditReduction and privilegedFunction evaluators now test collected records (70 → 66).
    // W2 part 2: vulnRemediationEvaluator now tests collected vulnerability records (66 → 65).
    // W5 cycle 1: 44 rewritten to test their condition (65 -> 21).
    // W5 cycle 2 (EO-2): asrRules, boundaryProtectionL1, publicNetworkL1, networkDenyByDefault test the settings catalog (21 -> 17).
    // W5 cycle 7: timeSourceEvaluator (AU.L2-3.3.7) tests the NTP client policy (17 -> 16).
    expect(PRESENCE_ONLY_EVALUATORS.size).toBe(16);
    for (const name of PRESENCE_ONLY_EVALUATORS) expect(evaluatorRegistry[name]?.presenceOnly).toBe(true);
    const declared = Object.entries(evaluatorRegistry).filter(([, fn]) => fn.presenceOnly).map(([n]) => n);
    expect(declared.sort()).toEqual([...PRESENCE_ONLY_EVALUATORS].sort());
  });

  test('evaluators that test a setting or are record-based are not declared', () => {
    for (const name of ['monitoringEvaluator', 'caEnforcementEvaluator', 'bitLockerEvaluator', 'securityBaselineEvaluator',
      'incidentCorrelationEvaluator', 'splitTunnelingEvaluator', 'alertsEvaluator', 'manualGateEvaluator',
      // W5 cycle 1 rewrites
      'leastPrivilegeEvaluator', 'dedicatedAdminEvaluator', 'mfaMethodsEvaluator', 'changeTrackingEvaluator', 'crossTenantEvaluator',
      // W5 cycle 2 (EO-2) rewrites
      'asrRulesEvaluator', 'boundaryProtectionL1Evaluator', 'publicNetworkL1Evaluator', 'networkDenyByDefaultEvaluator']) {
      expect(evaluatorRegistry[name]).toBeDefined();
      expect(evaluatorRegistry[name].presenceOnly).toBeUndefined();
    }
    for (const fn of Object.values(selectEvaluatorRegistry(GOOGLE_EVALUATOR_SET_ID))) expect(fn.presenceOnly).toBeUndefined();
  });
});

describe('run 20 snapshot, replayed through the real mapper and merge', () => {
  let snap: AssessmentSnapshot;

  beforeAll(() => {
    jest.useFakeTimers({ now: new Date(fx.generatedAt), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    snap = replayRun20Snapshot();
  });
  afterAll(() => { jest.useRealTimers(); });

  // W2 part 2: RA.L2-3.11.3 is the only mover (not_met -> not_assessed; see the header).
  // W5 cycle 1: four more movers (header). W5 cycle 2: IA.L2-3.5.10 now moves to not_met (header).
  // W5 cycle 3: four unassigned-information Intune movers (header).
  // FIN-27 (FD-4): the replay passes no EO assessment / POA&M records, so CA.L2-3.12.1 and 3.12.3 (met on the
  // presence-only Compliance Manager read in run 20) move met -> not_assessed (72 -> 70 met, SPRS 11 -> 1) and
  // CA.L2-3.12.2 (not_met on its Compliance Manager POA&M read) moves not_met -> not_assessed (same SPRS).
  test('counts 70 / 5 / 0 / 35, SPRS 1; RA.L2-3.11.3, the four W5 cycle 1, the four W5 cycle 3 controls, AU.L2-3.3.7 (W5 cycle 7) and CA.L2-3.12.1/2/3 (FIN-27) move', () => {
    expect([snap.controls_met, snap.controls_not_met, snap.controls_partial, snap.controls_not_assessed]).toEqual([70, 5, 0, 35]);
    expect(new SprsCalculator(sprsWeightsPath).calculate(snap.controls).score).toBe(1);
    const moved = snap.controls.filter(c => fx.stored.status_by_control[c.control_id] !== c.status).map(c => c.control_id);
    expect([...moved].sort()).toEqual(['AC.L2-3.1.17', 'AC.L2-3.1.3', 'AU.L2-3.3.7', 'CA.L2-3.12.1', 'CA.L2-3.12.2', 'CA.L2-3.12.3', 'IA.L2-3.5.10', 'IA.L2-3.5.11', 'IA.L2-3.5.7', 'MA.L2-3.7.4', 'MP.L2-3.8.6', 'MP.L2-3.8.7', 'RA.L2-3.11.3']);
    for (const id of ['AC.L2-3.1.17', 'MA.L2-3.7.4', 'MP.L2-3.8.6', 'MP.L2-3.8.7']) {
      expect(control(snap, id).status).toBe('not_assessed');
      expect(control(snap, id).sources.find(s => s.type === 'discovery')!.detail).toContain('carries no assignment information');
    }
    expect(control(snap, 'RA.L2-3.11.3').status).toBe('not_assessed');
    // W5 cycle 2: the conditional-access route on IA.L2-3.5.10 (cycle 1) decides it at Tier 2.
    expect(control(snap, 'IA.L2-3.5.10').status).toBe('not_met');
    expect(control(snap, 'IA.L2-3.5.10').statusRationale).toContain('Tier 2 (live read) decides: discovery/missing: Cryptographically protected passwords: 8 policy(ies) read; none blocks legacy authentication for all users');
    // W5 cycle 2 (EO-2): CM.L2-3.4.2 is no longer presence only; run 20 has no settings-catalog read, so Stamper's SAT decides.
    expect(control(snap, 'CM.L2-3.4.2').status).toBe('met');
    expect(control(snap, 'CM.L2-3.4.2').presenceOnly).toBeUndefined();
    expect(control(snap, 'CM.L2-3.4.2').statusRationale).toMatch(/^Tier 3 \(state-verified execution verdict\) decides/);
  });

  test.each(FLAGGED)('%s is met and labelled presence only, with what was read', (id) => {
    const c = control(snap, id);
    expect(c.status).toBe('met');
    expect(c.presenceOnly).toBe(true);
    expect(c.statusRationale).toMatch(/^Tier 2 \(live read\) decides met \(presence only: '.+' was read \(.+\) and returned \d+ objects?/);
    expect(c.statusRationale).toContain(c.presenceRead!);
    expect(c.sources.filter(isPresenceOnlySource)).toHaveLength(1);
  });

  test('the reads named are the ones each evaluator rests on', () => {
    expect(control(snap, 'MP.L2-3.8.1').presenceRead).toMatch(/'dlpLabels' was read \(\/informationProtection\/policy\/labels\)/); // W5 cycle 3
    expect(control(snap, 'SC.L2-3.13.2').presenceRead).toMatch(/'secureScores' was read \(\/security\/secureScores\) and returned 1 object$/);
  });

  test('SI.L2-3.14.6 (W0.4 rewritten evaluator) carries no label', () => {
    const c = control(snap, 'SI.L2-3.14.6');
    expect(c.status).toBe('met');
    expect(c.presenceOnly).toBeUndefined();
    expect(c.statusRationale).not.toContain('presence only');
    expect(c.sources.some(isPresenceOnlySource)).toBe(false);
  });

  test('every presence-only control is met at Tier 2, and the narrative (evaluator evidence) is unchanged', () => {
    const labelled = snap.controls.filter(c => (c as EoControlAssessment).presenceOnly);
    expect(labelled.length).toBeGreaterThanOrEqual(FLAGGED.length);
    for (const c of labelled) {
      expect(c.status).toBe('met');
      expect((c as EoControlAssessment).statusRationale.startsWith('Tier 2 (live read) decides met (presence only: ')).toBe(true);
      expect(c.implementation_narrative).not.toContain('presence only');
    }
  });

  test('the ledger carries the label on the inherited objectives', () => {
    const ledger = buildDeterminationLedger({ tenantId: snap.tenantId, generatedAt: fx.generatedAt, snapshot: snap });
    for (const id of FLAGGED) {
      const objs = ledger.objectives.filter(o => o.controlId === id);
      expect(objs.length).toBeGreaterThan(0);
      for (const o of objs) {
        expect(o.source).toBe('digital-signal');
        expect(o.presenceOnly).toBe(true);
        // W5 (SC-2 row 8): the objective's own rationale keeps the presence-only reads.
        expect(o.rationale.startsWith(`${o.objectiveId} (`)).toBe(true);
        expect(o.rationale).toContain(` is satisfied: ${id} is met at Tier 2 (live read) (presence only: `);
      }
    }
    for (const o of ledger.objectives.filter(x => x.controlId === 'SI.L2-3.14.6')) {
      expect(o.presenceOnly).toBeUndefined();
      expect(o.rationale).toMatch(/^SI\.L2-3\.14\.6\[[a-z]\] \(.*\) is satisfied: SI\.L2-3\.14\.6 is met at Tier \d/); // W5
      expect(o.rationale).not.toContain('presence only');
    }
    // W2 part 2: RA.L2-3.11.3 not_met -> not_assessed; W5 cycle 1: four more movers; W5 cycle 2: IA.L2-3.5.10 (header).
    // W5 cycle 3: four assignment movers; W5 cycle 7: AU.L2-3.3.7 not_met -> not_assessed (header).
    expect([ledger.summary.controlsMet, ledger.summary.controlsNotMet, ledger.summary.controlsPartial, ledger.summary.controlsNotAssessed]).toEqual([70, 5, 0, 35]); // FIN-27: CA.L2-3.12.1/2/3
  });

  test('the SSP control carries presenceOnly and a "Presence only:" sentence; SI.L2-3.14.6 does not', async () => {
    const { SspGenerator } = await import('../../../src/eo/ssp/SspGenerator.js');
    const ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: snap, variables: {} });
    const ci = (id: string) => ssp.controlImplementations.find(c => c.control_id === id) as DirectiveControlImplementation;
    for (const id of FLAGGED) {
      expect(ci(id).presenceOnly).toBe(true);
      expect(ci(id).implementationNarrative).toContain(`Presence only: this met status rests on a live read that confirms only that ${control(snap, id).presenceRead}`);
    }
    expect(ci('SI.L2-3.14.6').presenceOnly).toBeUndefined();
    expect(ci('SI.L2-3.14.6').implementationNarrative).not.toContain('Presence only:');
    expect(ssp.controlImplementations.filter(c => c.status === 'met')).toHaveLength(70); // W5 cycle 1; W5 cycle 3; FIN-27 (CA.L2-3.12.1/3)
  });
});

describe('a rewritten evaluator that tests the condition is never labelled', () => {
  test('SI.L2-3.14.6 met on all three feeds: unlabelled source and rationale', () => {
    jest.useFakeTimers({ now: new Date(fx.generatedAt), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    try {
      const signals: SignalResult[] = fx.signals.map(s => s.signalId === 'riskDetections'
        ? { ...s, status: 'success', error: undefined, rawData: { value: [{ id: 'rd-1', riskLevel: 'low', riskState: 'remediated' }] } } as SignalResult
        : s);
      const assessments = new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry);
      const si = assessments.find(a => a.control_id === 'SI.L2-3.14.6')!;
      expect(si.status).toBe('met');
      expect(si.sources.some(isPresenceOnlySource)).toBe(false);
      const merged = new ControlAssessor(controlsRefPath).merge(fx.tenantId, [], [], [], [], undefined,
        new Map<string, ControlAssessment>([['SI.L2-3.14.6', si]]));
      const c = control(merged, 'SI.L2-3.14.6');
      expect(c.status).toBe('met');
      expect(c.statusRationale).toMatch(/^Tier 2 \(live read\) decides: discovery\/exists/);
      expect(c.presenceOnly).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
