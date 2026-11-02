// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W1.2: a control lists every source whose verdict disagrees with its status
 * (`contraryEvidence[]` plus an "Evidence disagreement: ..." sentence, and a DOCX table).
 * W1.3: the DOCX status vocabulary; a not-assessed control never renders "Not Applicable".
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
import JSZip from 'jszip';
import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';
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
const CA_READ = 'No conditional access policies found for L1 access enforcement';
const NOW = '2026-10-27T13:00:22.756Z';

describe('W1.2 contrary evidence and W1.3 DOCX status vocabulary', () => {
  let ssp: SystemSecurityPlan;
  let plain: SystemSecurityPlan;
  let xml: string;

  beforeAll(async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const gen = (mixed: boolean) => {
      const assessment = buildGoldenAssessment(controlsRefPath);
      if (mixed) {
        const c = assessment.controls.find(x => x.control_id === CONTROL)!;
        c.status = 'met';
        c.sources = [
          { type: 'evidence_import', timestamp: NOW, detail: 'Authorized user access review', result: 'imported' },
          { type: 'discovery', timestamp: NOW, detail: CA_READ, result: 'missing' },
          { type: 'discovery', timestamp: NOW, detail: 'not read', result: 'no_query' },
          { type: 'ec_capture', timestamp: NOW, detail: 'manual_upload: acp.pdf (eci-1)', result: 'no_query' },
        ];
        c.signals = [{ signalId: 'conditionalAccess', source: 'graph', endpoint: '/identity/conditionalAccess/policies', timestamp: NOW, rawData: { value: [] }, status: 'success' }];
      }
      return new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
        assessment,
        tenantManifest: buildGoldenTenantManifest(),
        infraManifest: buildGoldenInfraManifest(),
        manifests: buildGoldenManifests(),
        variables: { organizationName: 'Golden Reference Defense Co.' },
      });
    };
    ssp = gen(true);
    plain = gen(false);
    const buf = await new SspDocxExporter().export(ssp);
    xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
  });

  const ci = (s: SystemSecurityPlan, id: string) => s.controlImplementations.find(c => c.control_id === id)! as any;

  test('AC.L1-3.1.1 (met) lists its Conditional Access read as contrary evidence', () => {
    const c = ci(ssp, CONTROL);
    expect(c.status).toBe('met');
    expect(c.contraryEvidence).toEqual([
      { sourceKind: 'discovery', id: 'conditionalAccess', verdict: 'other_than_satisfied', read: CA_READ },
    ]);
    expect(c.implementationNarrative).toContain(`Evidence disagreement: 1 source(s) disagree with the met status: discovery conditionalAccess (other_than_satisfied): ${CA_READ}.`);
  });

  test('the DOCX renders the disagreement table for the control', () => {
    expect(xml).toContain('Evidence disagreement:');
    expect(xml).toContain('Entry / signal');
    expect(xml).toContain(CA_READ);
  });

  test('no disagreement: no contraryEvidence key, and status is never changed', () => {
    for (const c of plain.controlImplementations) expect('contraryEvidence' in c).toBe(false);
    const pick = (s: SystemSecurityPlan) => s.controlImplementations.filter(c => c.control_id !== CONTROL).map(c => [c.control_id, c.status]);
    expect(pick(ssp)).toEqual(pick(plain));
  });

  test('W1.3: no not-assessed control renders Not Applicable; the four-term vocabulary is used', () => {
    const notAssessed = ssp.controlImplementations.filter(c => c.status === 'not_assessed' && !(c as any).sprsValue).length;
    expect(notAssessed).toBeGreaterThan(0);
    expect(xml).not.toContain('☒ Not Applicable');
    // The retired status term (a checkbox "Planned"); KB artifact names such as "Planned password parameters" are allowed.
    expect(xml).not.toMatch(/[☐☒] Planned/);
    expect((xml.match(/☒ Not Yet Assessed/g) ?? []).length).toBe(notAssessed);
    const notMet = ssp.controlImplementations.filter(c => c.status === 'not_met' && !(c as any).sprsValue).length;
    expect((xml.match(/☒ Not Implemented \(see POA&amp;M\)/g) ?? []).length).toBe(notMet);
    const partial = ssp.controlImplementations.filter(c => c.status === 'partial' && !(c as any).sprsValue).length;
    expect((xml.match(/☒ Partially Implemented/g) ?? []).length).toBe(partial);
  });
});
