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
    const ac317 = ssp.controlImplementations.find(c => c.control_id === 'AC.L2-3.1.7')!;
    const objC = ac317.assessmentObjectives!.find(o => o.objectiveId === 'AC.L2-3.1.7[c]')!;
    const objA = ac317.assessmentObjectives!.find(o => o.objectiveId === 'AC.L2-3.1.7[a]')!;
    expect(objC.status).toBe('other_than_satisfied');    // overridden by evidence
    expect(objA.status).not.toBe('other_than_satisfied'); // untouched -> inherits control status
  });
});
