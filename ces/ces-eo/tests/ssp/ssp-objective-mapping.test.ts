// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * G-EUT-5 Phase 3 — the SSP maps to the REAL 320 NIST SP 800-171A determination
 * statements, not a synthetic one-Examine-objective-per-control stub.
 *
 * This is the "SSP mapped to 320 objectives, not 110 practices" deliverable (the #1
 * documented C3PAO failure trigger). It is a PARALLEL validation of the objective
 * mapping — the golden-reference test (ssp-golden-reference.test.ts) independently
 * guards that no existing SSP field regressed. Together they satisfy HIGH-2: the
 * objective fidelity is upgraded AND the reference output is proven not to drop.
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });
jest.mock('ces-shared/storage', () => ({
  getStamperPlanDataRoot: jest.fn(() => '/tmp/golden-plan-data'),
}), { virtual: true });

import { createRequire } from 'node:module';
import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import type { DirectiveControlImplementation, EoObjectiveStatus, EoSystemSecurityPlan } from '../../src/shared/types/ssp.types.js';
import { replayRun20Snapshot, run20Fixture } from './run20-replay.js';
import {
  buildGoldenAssessment,
  buildGoldenTenantManifest,
  buildGoldenInfraManifest,
  buildGoldenManifests,
} from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

describe('SSP objective mapping — real 320 800-171A determinations (G-EUT-5 Phase 3)', () => {
  let ssp: SystemSecurityPlan;

  beforeAll(async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const generator = new SspGenerator(controlsRefPath, sprsWeightsPath);
    ssp = generator.generate({
      assessment: buildGoldenAssessment(controlsRefPath),
      tenantManifest: buildGoldenTenantManifest(),
      infraManifest: buildGoldenInfraManifest(),
      manifests: buildGoldenManifests(),
      variables: { organizationName: 'Golden Reference Defense Co.' },
    });
  });

  test('SSP carries the full set of 320 distinct determination objectives', () => {
    const ids = new Set<string>();
    for (const ci of ssp.controlImplementations) {
      for (const obj of ci.assessmentObjectives ?? []) ids.add(obj.objectiveId);
    }
    // 320 real determination statements across the 110 practices.
    expect(ids.size).toBe(320);
  });

  test('objective ids are real determination statements ([a][b][c]...), not synthetic stubs', () => {
    let sawLetterId = false;
    for (const ci of ssp.controlImplementations) {
      for (const obj of ci.assessmentObjectives ?? []) {
        // Real determination id looks like "AC.L2-3.1.7[c]" — never the old "AO-...-EXAM" stub.
        expect(obj.objectiveId).not.toMatch(/-EXAM$/);
        if (/\[[a-z]\]$/.test(obj.objectiveId)) sawLetterId = true;
      }
    }
    expect(sawLetterId).toBe(true);
  });

  test('a multi-objective control decomposes into all its determinations', () => {
    // AC.L2-3.1.7 (privileged functions) has determinations [a][b][c][d] in 800-171A.
    const ac317 = ssp.controlImplementations.find(c => c.control_id === 'AC.L2-3.1.7');
    expect(ac317).toBeDefined();
    const objIds = (ac317!.assessmentObjectives ?? []).map(o => o.objectiveId).sort();
    expect(objIds).toEqual([
      'AC.L2-3.1.7[a]', 'AC.L2-3.1.7[b]', 'AC.L2-3.1.7[c]', 'AC.L2-3.1.7[d]',
    ]);
  });

  test('objectives requiring Interview/Test are surfaced (not Examine-only)', () => {
    // Honest method-completion: many determinations require more than config Examine.
    let sawNonExamineOnly = false;
    for (const ci of ssp.controlImplementations) {
      for (const obj of ci.assessmentObjectives ?? []) {
        const methods = obj.methods ?? [];
        for (const m of methods) expect(['examine', 'interview', 'test']).toContain(m);
        if (methods.some(m => m === 'interview' || m === 'test')) sawNonExamineOnly = true;
      }
    }
    expect(sawNonExamineOnly).toBe(true);
  });

  test('every one of the 110 practices carries at least one determination', () => {
    let covered = 0;
    for (const ci of ssp.controlImplementations) {
      expect((ci.assessmentObjectives ?? []).length).toBeGreaterThan(0);
      covered++;
    }
    expect(covered).toBe(110);
  });
});

describe('SSP per-objective evidence from the tenant suite (G-EUT-5 Phase 3)', () => {
  test('buildObjectiveEvidence aggregates probe verdicts per objective', async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const probeMap = [
      { case: 'UC-E', test: 'A', objectives: ['AC.L2-3.1.7[a]'] },   // PASS -> satisfied
      { case: 'UC-E', test: 'B', objectives: ['AC.L2-3.1.7[b]'] },   // FAIL -> other_than_satisfied
      { case: 'UC-E', test: 'C', objectives: ['AC.L2-3.1.7[c]'] },   // INCONCLUSIVE -> not_assessed
      { case: 'UC-E', test: 'D', objectives: ['AC.L2-3.1.7[d]'] },   // no run row -> absent
    ];
    const runResults = [
      { CaseId: 'UC-E', Test: 'A', Verdict: 'PASS' },
      { CaseId: 'UC-E', Test: 'B', Verdict: 'FAIL' },
      { CaseId: 'UC-E', Test: 'C', Verdict: 'INCONCLUSIVE' },
    ];
    const ev = SspGenerator.buildObjectiveEvidence(probeMap, runResults);
    expect(ev['AC.L2-3.1.7[a]']).toBe('satisfied');
    expect(ev['AC.L2-3.1.7[b]']).toBe('other_than_satisfied');
    expect(ev['AC.L2-3.1.7[c]']).toBe('not_assessed');
    expect(ev['AC.L2-3.1.7[d]']).toBeUndefined();   // no evidence -> SSP inherits control status
  });

  test('any FAIL beats a PASS for the same objective (worst-wins)', async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const ev = SspGenerator.buildObjectiveEvidence(
      [
        { case: 'UC-A', test: 'X', objectives: ['IA.L1-3.5.1[a]'] },
        { case: 'UC-B', test: 'Y', objectives: ['IA.L1-3.5.1[a]'] },
      ],
      [
        { CaseId: 'UC-A', Test: 'X', Verdict: 'PASS' },
        { CaseId: 'UC-B', Test: 'Y', Verdict: 'FAIL' },
      ]
    );
    expect(ev['IA.L1-3.5.1[a]']).toBe('other_than_satisfied');
  });

  test('objectiveEvidence param overrides control-status inheritance for that objective only', async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const generator = new SspGenerator(controlsRefPath, sprsWeightsPath);
    const ssp = generator.generate({
      assessment: buildGoldenAssessment(controlsRefPath),
      tenantManifest: buildGoldenTenantManifest(),
      infraManifest: buildGoldenInfraManifest(),
      manifests: buildGoldenManifests(),
      variables: { organizationName: 'Golden Reference Defense Co.' },
      // Force one objective to other_than_satisfied regardless of its control's status.
      objectiveEvidence: { 'AC.L2-3.1.7[c]': 'other_than_satisfied' },
    });
    const ac317 = ssp.controlImplementations.find(c => c.control_id === 'AC.L2-3.1.7')! as DirectiveControlImplementation;
    const objC = ac317.assessmentObjectives.find(o => o.objectiveId === 'AC.L2-3.1.7[c]')!;
    const objA = ac317.assessmentObjectives.find(o => o.objectiveId === 'AC.L2-3.1.7[a]')!;
    // W3.2 amendment (B7 (d)): AC.L2-3.1.7 is not 'not_met' in the golden assessment, so an
    // other-than-satisfied objective would contradict the control status. The objective keeps the
    // control-inherited status; the evidence's own status is kept in `ledgerStatus` and named.
    expect(ac317.status).not.toBe('not_met');
    expect(objC.status).toBe(objA.status);
    expect(objC.ledgerStatus).toBe('other_than_satisfied');
    expect(objC.rationale).toMatch(/source reports other than satisfied, and the control status .* decides under B7 \(d\)/);
    expect(objA.status).not.toBe('other_than_satisfied'); // untouched -> inherits control status
  });

  test('objectiveEvidence that agrees with the control status overrides that objective only', async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const assessment = buildGoldenAssessment(controlsRefPath);
    const generator = new SspGenerator(controlsRefPath, sprsWeightsPath);
    const plain = generator.generate({ assessment, variables: {} });
    // A not-met control with several objectives: one satisfied objective does not contradict it.
    const target = plain.controlImplementations.find(c => c.status === 'not_met' && (c.assessmentObjectives ?? []).length >= 2)!;
    const [first, second] = target.assessmentObjectives!;
    const ssp = generator.generate({ assessment, variables: {}, objectiveEvidence: { [first.objectiveId]: 'satisfied' } });
    const objs = ssp.controlImplementations.find(c => c.control_id === target.control_id)!.assessmentObjectives as EoObjectiveStatus[];
    expect(objs.find(o => o.objectiveId === first.objectiveId)!.status).toBe('satisfied');
    expect(objs.find(o => o.objectiveId === second.objectiveId)!.status).toBe('other_than_satisfied');
    expect(objs.every(o => o.ledgerStatus === undefined && o.source === undefined)).toBe(true);
  });
});

/**
 * W3.2: objectives carry the determination ledger's `source` and `rationale` (and one statement
 * sentence) when the ledger is passed to generate(), and never contradict the control status
 * (B7 (d)). Proven on run 20's snapshot (offline replay) and the ledger built from it.
 */
describe('W3.2 per-objective provenance from the ledger (run 20)', () => {
  const fx = run20Fixture();
  let snap: AssessmentSnapshot;
  let ledger: DeterminationLedger;
  let ssp: EoSystemSecurityPlan;
  const objectivesOf = (s: EoSystemSecurityPlan) =>
    s.controlImplementations.flatMap(c => ((c as DirectiveControlImplementation).assessmentObjectives ?? []).map(o => ({ control: c, o })));

  beforeAll(async () => {
    jest.useFakeTimers({ now: new Date(fx.generatedAt), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    snap = replayRun20Snapshot();
    jest.useRealTimers();
    const { buildDeterminationLedger } = await import('../../src/eo/assessment/DeterminationLedger.js');
    ledger = buildDeterminationLedger({ tenantId: snap.tenantId, generatedAt: fx.generatedAt, snapshot: snap });
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: snap, ledger, variables: {} });
  });

  test('320 objectives, each with the ledger source, rationale and a statement', () => {
    const all = objectivesOf(ssp);
    expect(all).toHaveLength(320);
    const ledgerById = new Map(ledger.objectives.map(o => [o.objectiveId, o]));
    for (const { o } of all) {
      const l = ledgerById.get(o.objectiveId)!;
      expect(l).toBeDefined();
      expect(o.source).toBe(l.source);
      expect(o.rationale!.startsWith(l.rationale)).toBe(true);
      expect(o.statement).toBe(`${o.objectiveId} is ${o.status.replace(/_/g, ' ')} (${o.source}: ${o.rationale}).`);
    }
    expect(new Set(all.map(({ o }) => o.source))).toEqual(new Set(['digital-signal']));
  });

  test('no objective contradicts its control status (B7 (d)); run 20 has no ledger disagreement', () => {
    for (const c of ssp.controlImplementations) {
      const st = (c.assessmentObjectives ?? []).map(o => o.status);
      if (c.status === 'met') expect(st.every(s => s === 'satisfied')).toBe(true);
      if (c.status === 'not_met') expect(st).toContain('other_than_satisfied');
      if (c.status === 'not_assessed') expect(st.every(s => s === 'not_assessed')).toBe(true);
    }
    expect(objectivesOf(ssp).filter(({ o }) => o.ledgerStatus !== undefined)).toHaveLength(0);
  });

  test('a presence-only control\'s objectives carry the label in their rationale', () => {
    // W5 cycle 1: CM.L2-3.4.3's evaluator now tests change records. W5 cycle 2 (EO-2): CM.L2-3.4.2's now tests the
    // settings catalog (run 20 never read it, so Stamper's Tier 3 SAT decides). W5 cycle 3: run 20's device
    // configurations carry no assignment information, so MP.L2-3.8.5's read no longer credits (Stamper decides);
    // MP.L2-3.8.1 (sensitivity labels) is still presence only.
    const cm = objectivesOf(ssp).filter(({ control }) => control.control_id === 'MP.L2-3.8.1');
    expect(cm.length).toBeGreaterThan(0);
    // W5 (SC-2 row 8): the objective's own rationale, with the presence-only reads.
    for (const { o } of cm) expect(o.rationale).toMatch(/^MP\.L2-3\.8\.1\[[a-z]\] \(.*\) is satisfied: MP\.L2-3\.8\.1 is met at Tier 2 \(live read\) \(presence only: 'dlpLabels' was read/);
  });

  test('a ledger objective that disagrees keeps the control-consistent status and is named', async () => {
    const metControl = ssp.controlImplementations.find(c => c.status === 'met' && (c.assessmentObjectives ?? []).length >= 2)!;
    const victim = metControl.assessmentObjectives![0].objectiveId;
    const crafted: DeterminationLedger = {
      ...ledger,
      objectives: ledger.objectives.map(o => o.objectiveId === victim
        ? { ...o, status: 'other_than_satisfied' as const, source: 'tenant-suite' as const, rationale: 'examined by a tenant test-suite probe' }
        : o),
    };
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const s2 = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: snap, ledger: crafted, variables: {} });
    const o = (s2.controlImplementations.find(c => c.control_id === metControl.control_id) as DirectiveControlImplementation)
      .assessmentObjectives.find(x => x.objectiveId === victim)!;
    expect(o.status).toBe('satisfied');
    expect(o.ledgerStatus).toBe('other_than_satisfied');
    expect(o.source).toBe('tenant-suite');
    expect(o.rationale).toBe('examined by a tenant test-suite probe; its source reports other than satisfied, and the control status (met) decides under B7 (d)');
    expect(o.statement!.startsWith(`${victim} is satisfied (tenant-suite: `)).toBe(true);
  });

  test('without a ledger, objectives keep the pre-W3.2 shape (no provenance keys)', async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const s3 = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: snap, variables: {} });
    for (const { o } of objectivesOf(s3)) expect(Object.keys(o).sort()).toEqual(['description', 'methods', 'objectiveId', 'status']);
  });
});
