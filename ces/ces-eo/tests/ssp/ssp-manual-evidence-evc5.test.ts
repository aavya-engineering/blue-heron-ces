// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EVC.5 — the SSP lists an EC upload's catalog ids (form_id, emx_ids) under a separate
 * "manual evidence (unverified)" listing for the control. It stays OUT of
 * `evidenceReferences`, so status, SPRS value, narrative and the quality scorecard are
 * identical with and without the upload (DEC-7).
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
import { EC_CONTRACT_VERSION, type EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { ecItemsToSources } from '../../src/eo/evidence/EcEvidenceReader.js';
import { SspQualityScorecard } from '../../src/eo/ssp/SspQualityScorecard.js';
import {
  buildGoldenAssessment,
  buildGoldenTenantManifest,
  buildGoldenInfraManifest,
  buildGoldenManifests,
} from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const CONTROL = 'AC.L1-3.1.1';

const item: EcEvidenceItem = {
  contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
  itemId: 'eci-ssp-1',
  tenantSlug: 'acme-sim',
  controlIds: [CONTROL],
  source: 'manual_upload',
  filename: 'acp.pdf',
  mediaType: 'application/pdf',
  sha256: 'e'.repeat(64),
  sizeBytes: 7,
  collectedAt: '2026-10-27T00:00:00.000Z',
  submittedByRole: 'compliance_officer',
  mode: 'sim',
  form_id: 'access_control_policy',
  emx_ids: ['EMX-IAM-004'],
  form_id_matched_by: 'form_id',
  catalog: 'validated',
};

describe('EVC.5 SSP manual evidence (unverified) listing', () => {
  let plain: SystemSecurityPlan;
  let tagged: SystemSecurityPlan;

  beforeAll(async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const gen = (withItem: boolean) => {
      const assessment = buildGoldenAssessment(controlsRefPath);
      if (withItem) {
        const src = ecItemsToSources([item]).get(CONTROL)!;
        assessment.controls.find(c => c.control_id === CONTROL)!.sources.push(...src);
      }
      return new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
        assessment,
        tenantManifest: buildGoldenTenantManifest(),
        infraManifest: buildGoldenInfraManifest(),
        manifests: buildGoldenManifests(),
        variables: { organizationName: 'Golden Reference Defense Co.' },
      });
    };
    plain = gen(false);
    tagged = gen(true);
  });

  const ci = (ssp: SystemSecurityPlan, id: string) => ssp.controlImplementations.find(c => c.control_id === id)! as any;

  test('the control lists the item with form_id and emx_ids, marked unverified', () => {
    expect(ci(tagged, CONTROL).manualEvidence).toEqual([
      { itemId: 'eci-ssp-1', filename: 'acp.pdf', form_id: 'access_control_policy', emx_ids: ['EMX-IAM-004'], catalog: 'validated', verification: 'unverified' },
    ]);
    const trace = tagged.appendices!.find(a => a.title === 'Assessor Evidence Traceability')!;
    expect(trace.summary).toContain('Manual evidence (unverified)');
    expect(trace.summary).toContain('access_control_policy');
  });

  test('no upload: no manualEvidence key and no listing (unchanged output)', () => {
    for (const c of plain.controlImplementations) expect('manualEvidence' in c).toBe(false);
    const trace = plain.appendices!.find(a => a.title === 'Assessor Evidence Traceability')!;
    expect(trace.summary).not.toContain('Manual evidence (unverified)');
  });

  test('status, SPRS value, narrative and evidenceReferences are identical for every control', () => {
    const pick = (c: any) => ({ id: c.control_id, status: c.status, sprsValue: c.sprsValue, evidenceReferences: c.evidenceReferences, narrative: c.implementationNarrative });
    expect(tagged.controlImplementations.map(pick)).toEqual(plain.controlImplementations.map(pick));
    expect(ci(tagged, CONTROL).evidenceReferences).not.toContain('eci-ssp-1');
  });

  test('quality scorecard scores are identical', () => {
    const scores = (ssp: SystemSecurityPlan) =>
      new SspQualityScorecard().validate(ssp, undefined, undefined, undefined).metrics.map((m: any) => ({ name: m.name, score: m.score, passed: m.passed }));
    expect(scores(tagged)).toEqual(scores(plain));
  });
});
