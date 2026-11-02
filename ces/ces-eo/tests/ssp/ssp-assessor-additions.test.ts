// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * STEP 4 — Assessor-grade additions (ADDITIVE).
 *
 * Verifies the two additive assessor enhancements:
 *   1. NIST SP 800-171A assessment methods surfaced inline per-control
 *      (ObjectiveStatus.methods populated from the assessment-objectives data).
 *   2. A new "Assessor Evidence Traceability" appendix mapping each control to
 *      its evidence references.
 *
 * These are NEW fields/appendix only — existing fields must remain intact (the
 * golden reference test enforces no-drop separately).
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

describe('SSP assessor-grade additions (Step 4)', () => {
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

  test('assessment objectives carry NIST SP 800-171A methods inline', () => {
    // Every control has objectives in the reference data; at least one method each.
    let controlsWithMethods = 0;
    for (const ci of ssp.controlImplementations) {
      expect(ci.assessmentObjectives.length).toBeGreaterThan(0);
      for (const obj of ci.assessmentObjectives) {
        expect(Array.isArray(obj.methods)).toBe(true);
        expect(obj.methods!.length).toBeGreaterThan(0);
        for (const m of obj.methods!) {
          expect(['examine', 'interview', 'test']).toContain(m);
        }
      }
      controlsWithMethods++;
    }
    expect(controlsWithMethods).toBe(110);
  });

  test('Assessor Evidence Traceability appendix is present and well-formed', () => {
    const trace = ssp.appendices!.find(a => a.title === 'Assessor Evidence Traceability');
    expect(trace).toBeDefined();
    expect(trace!.documentId).toBe('AUTO-GENERATED');
    // Markdown table header columns.
    expect(trace!.summary).toContain('| Control ID | Family | Status | Objectives | Evidence References |');
    // One data row per control (110) + 2 header lines.
    const lines = trace!.summary.split('\n');
    expect(lines.length).toBe(112);
    // Spot-check a known control appears with its evidence reference.
    expect(trace!.summary).toContain('AC.L1-3.1.1');
    expect(trace!.summary).toContain('EV-AC.L1-3.1.1-001');
  });

  test('addition does not collide with rendered-artifact appendix IDs', () => {
    const ids = ssp.appendices!.map(a => a.id);
    // Appendix P is the traceability appendix; no duplicate IDs.
    expect(ids.filter(id => id === 'P')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
