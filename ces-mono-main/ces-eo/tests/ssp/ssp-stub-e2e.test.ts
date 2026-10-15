// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * G4 #5 — Proof-stub end-to-end test for the stack-provider seam.
 *
 * Runs the FULL SspGenerator.generate() path under the 'example-stub' stack provider (which declares
 * NO authored content — sspNarrativeSourceId / controlSignalRegistryId / evaluatorSetId all
 * 'stub-empty') and asserts it completes and yields a VALID minimal SSP:
 *   - 110 control implementations
 *   - all required top-level sections present
 *   - no throw
 *
 * This proves the seam is genuinely pluggable: the Microsoft path is just another registered
 * provider, not special-cased. We reuse the same golden fixtures the Microsoft golden test uses, so
 * the ONLY difference exercised is the active stack provider. No non-Microsoft content is authored —
 * the stub falls back to the practice-statement narrative for every control.
 *
 * Like the golden test, SspGenerator's transitive graph imports two ESM-only shared runtime modules
 * (ces-shared/blob, ces-shared/storage) that jest's CommonJS runtime cannot evaluate; they
 * are not exercised when `variables` is supplied, so we stub them virtually (test-local, additive).
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });
jest.mock('ces-shared/storage', () => ({
  getStamperPlanDataRoot: jest.fn(() => '/tmp/stub-plan-data'),
}), { virtual: true });

import { createRequire } from 'node:module';
import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import { getStackProvider, EXAMPLE_STUB_STACK_ID } from 'ces-shared/stack';
import {
  buildGoldenAssessment,
  buildGoldenTenantManifest,
  buildGoldenInfraManifest,
  buildGoldenMissionPlan,
  buildGoldenManifests,
} from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const SSP_TOP_LEVEL_FIELDS = [
  'systemName',
  'cuiCategorization',
  'responsibleParties',
  'authorizationBoundary',
  'cuiDataFlows',
  'sharedResponsibilityMatrix',
  'systemComponents',
  'networkTopology',
  'hostingModel',
  'rolesAndResponsibilities',
  'controlImplementations',
  'riskAssessment',
  'continuousMonitoring',
  'incidentResponse',
  'appendices',
] as const;

describe('SSP stub end-to-end (Step 5 — proof the stack seam is pluggable)', () => {
  let ssp: SystemSecurityPlan;
  let didThrow = false;

  beforeAll(async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const generator = new SspGenerator(controlsRefPath, sprsWeightsPath);
    // Resolve the proof-stub provider through the SAME seam EO uses (not special-cased).
    const stubStack = getStackProvider(EXAMPLE_STUB_STACK_ID).capabilities;
    try {
      ssp = generator.generate({
        assessment: buildGoldenAssessment(controlsRefPath),
        tenantManifest: buildGoldenTenantManifest(),
        infraManifest: buildGoldenInfraManifest(),
        missionPlan: buildGoldenMissionPlan(),
        manifests: buildGoldenManifests(),
        variables: { organizationName: 'Stub Proof Co.' },
        stack: stubStack,
      });
    } catch {
      didThrow = true;
    }
  });

  test('generate() completes without throwing under the example-stub stack', () => {
    expect(didThrow).toBe(false);
    expect(ssp).toBeDefined();
  });

  test('produces exactly 110 control implementations (valid minimal SSP)', () => {
    expect(ssp.controlImplementations).toHaveLength(110);
  });

  test('every control implementation is structurally valid with a non-empty narrative', () => {
    for (const ci of ssp.controlImplementations) {
      expect(typeof ci.control_id).toBe('string');
      expect(ci.control_id.length).toBeGreaterThan(0);
      expect(typeof ci.implementationNarrative).toBe('string');
      expect(ci.implementationNarrative.trim().length).toBeGreaterThan(0);
      expect(['met', 'not_met', 'partial', 'not_assessed']).toContain(ci.status);
    }
  });

  test('all required top-level SSP sections are present', () => {
    for (const field of SSP_TOP_LEVEL_FIELDS) {
      expect(ssp[field as keyof SystemSecurityPlan]).toBeDefined();
    }
  });

  test('sharedResponsibilityMatrix still covers all 110 controls', () => {
    const srm = ssp.sharedResponsibilityMatrix!;
    expect(srm.totalControls).toBe(110);
    expect(srm.inherited + srm.shared + srm.customer).toBe(110);
  });
});
