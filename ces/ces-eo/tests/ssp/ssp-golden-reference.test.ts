// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * STEP 1 — Golden reference (no-drop guard) for SspGenerator.generate().
 *
 * This is the STRUCTURAL contract test ("known-good reference SSP"). It uses
 * EXPLICIT field-presence assertions (NOT toMatchSnapshot exact-equality) so
 * that later ADDITIVE fields (Steps 2-4) cannot accidentally drop or regress
 * any existing SSP output. If a field listed here disappears, this test fails.
 *
 * SspGenerator's transitive graph imports two ESM-only shared runtime modules
 * (ces-shared/blob, ces-shared/storage) that jest's CommonJS runtime
 * cannot evaluate. They are not exercised by generate() when `variables` is
 * supplied, so we stub them virtually. This is additive (test-local) and does
 * not touch the global jest config or other suites.
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
  buildGoldenMissionPlan,
  buildGoldenManifests,
} from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const SSP_TOP_LEVEL_FIELDS = [
  'systemName',
  'organizationName',
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
  'poamSummary',
  'appendices',
] as const;

describe('SSP golden reference (Step 1 — no-drop structural guard)', () => {
  let ssp: SystemSecurityPlan;

  beforeAll(async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const generator = new SspGenerator(controlsRefPath, sprsWeightsPath);
    ssp = generator.generate({
      assessment: buildGoldenAssessment(controlsRefPath),
      tenantManifest: buildGoldenTenantManifest(),
      infraManifest: buildGoldenInfraManifest(),
      missionPlan: buildGoldenMissionPlan(),
      manifests: buildGoldenManifests(),
      // Supplying variables (even minimal) avoids the on-disk VariableStore path.
      variables: { organizationName: 'Golden Reference Defense Co.' },
    });
  });

  test('produces exactly 110 control implementations', () => {
    expect(ssp.controlImplementations).toHaveLength(110);
  });

  test('every control implementation has the required structural fields', () => {
    for (const ci of ssp.controlImplementations) {
      expect(typeof ci.control_id).toBe('string');
      expect(ci.control_id.length).toBeGreaterThan(0);

      expect(typeof ci.nist_ref).toBe('string');
      expect(ci.nist_ref.length).toBeGreaterThan(0);

      expect(typeof ci.family).toBe('string');
      expect(ci.family.length).toBeGreaterThan(0);

      expect(['met', 'not_met', 'partial', 'not_assessed']).toContain(ci.status);

      expect(typeof ci.implementationNarrative).toBe('string');
      expect(ci.implementationNarrative.trim().length).toBeGreaterThan(0);

      expect(['automated', 'manual', 'nonstack']).toContain(ci.classification);
    }
  });

  test('all required top-level SSP sections/fields are present', () => {
    for (const field of SSP_TOP_LEVEL_FIELDS) {
      // poamSummary is intentionally optional (only present when a POA&M is
      // supplied). All OTHER listed fields must be defined.
      if (field === 'poamSummary') {
        expect(field in ssp).toBe(true);
        continue;
      }
      expect(ssp[field as keyof SystemSecurityPlan]).toBeDefined();
    }
  });

  test('odpValues are present on every control implementation (per-control array)', () => {
    // The plan lists odpValues as part of the contract. It is a per-control
    // array (aggregated into SSP Section 9), not a top-level field.
    for (const ci of ssp.controlImplementations) {
      expect(Array.isArray(ci.odpValues)).toBe(true);
    }
  });

  test('assessmentObjectives are present on every control implementation', () => {
    for (const ci of ssp.controlImplementations) {
      expect(Array.isArray(ci.assessmentObjectives)).toBe(true);
    }
  });

  test('sharedResponsibilityMatrix covers all 110 controls', () => {
    expect(ssp.sharedResponsibilityMatrix).toBeDefined();
    const srm = ssp.sharedResponsibilityMatrix!;
    expect(srm.totalControls).toBe(110);
    expect(srm.inherited + srm.shared + srm.customer).toBe(110);
    expect(Array.isArray(srm.byFamily)).toBe(true);
    expect(srm.byFamily.length).toBeGreaterThan(0);
  });

  test('appendices include the network / data-flow / boundary diagram entries', () => {
    expect(ssp.appendices).toBeDefined();
    const titles = ssp.appendices!.map(a => a.title.toLowerCase());
    expect(titles.some(t => t.includes('network'))).toBe(true);
    expect(titles.some(t => t.includes('data flow'))).toBe(true);
    expect(titles.some(t => t.includes('boundary'))).toBe(true);
  });

  test('authorizationBoundary and networkTopology sections are well-formed', () => {
    expect(typeof ssp.authorizationBoundary.description).toBe('string');
    expect(Array.isArray(ssp.authorizationBoundary.zones)).toBe(true);
    expect(typeof ssp.networkTopology.description).toBe('string');
    expect(Array.isArray(ssp.networkTopology.topology)).toBe(true);
  });

  test('responsibleParties and cuiCategorization tables are populated', () => {
    expect(Array.isArray(ssp.responsibleParties)).toBe(true);
    expect(ssp.responsibleParties!.length).toBeGreaterThan(0);
    expect(Array.isArray(ssp.cuiCategorization)).toBe(true);
    expect(ssp.cuiCategorization!.length).toBeGreaterThan(0);
  });
});
