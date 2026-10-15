// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { StamperEvidenceLoader } from '../../../src/eo/evidence/StamperEvidenceLoader';

// Mock fs module
jest.mock('node:fs');
// Mock getStamperTenantRoot to return a predictable path
jest.mock('ces-shared/storage/node', () => ({
  getStamperTenantRoot: (slug: string) => `/fake/stamper/plan-data/${slug}`,
}));

const mockFs = fs as jest.Mocked<typeof fs>;

const TENANT_SLUG = 'test-tenant';

function makeSatEvidence(controlIds: string[], entryId: string, label: string) {
  return JSON.stringify({
    complianceVerdict: 'SAT',
    registryEntry: { entry_id: entryId, label, control_ids: controlIds },
    metadata: {
      controlIds,
      timestamp: '2026-04-01T01:00:00.000Z',
      sha256Hash: 'abc123',
      environment: 'GCC-High',
    },
  });
}

function makeNotSatEvidence(controlIds: string[], entryId: string, label: string) {
  return JSON.stringify({
    complianceVerdict: 'NOT_SAT',
    registryEntry: { entry_id: entryId, label, control_ids: controlIds },
    metadata: {
      controlIds,
      timestamp: '2026-04-01T02:00:00.000Z',
      sha256Hash: 'def456',
      environment: 'GCC-High',
    },
  });
}

describe('StamperEvidenceLoader', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('loads SAT evidence and creates AssessmentSource with result=imported', () => {
    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readdirSync as jest.Mock).mockReturnValue(['physical_protection/pe.l2-3.10.2.json']);
    mockFs.readFileSync.mockReturnValue(
      makeSatEvidence(['PE.L2-3.10.2'], 'PE.L2-3.10.2.physical-monitor', 'Physical Monitoring')
    );

    const loader = new StamperEvidenceLoader(TENANT_SLUG);
    const evidence = loader.loadEvidenceForTenant();
    const sourcesMap = loader.toAssessmentSources(evidence);

    expect(evidence).toHaveLength(1);
    expect(evidence[0].complianceVerdict).toBe('SAT');

    const sources = sourcesMap.get('PE.L2-3.10.2');
    expect(sources).toBeDefined();
    expect(sources![0].type).toBe('evidence_import');
    expect(sources![0].result).toBe('imported');
    expect(sources![0].detail).toBe('Physical Monitoring');
  });

  test('loads NOT_SAT evidence and creates AssessmentSource with result=missing', () => {
    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readdirSync as jest.Mock).mockReturnValue(['other/not-sat-control.json']);
    mockFs.readFileSync.mockReturnValue(
      makeNotSatEvidence(['AC.L2-3.1.1'], 'manual-AC.L2-3.1.1', 'Access Control')
    );

    const loader = new StamperEvidenceLoader(TENANT_SLUG);
    const evidence = loader.loadEvidenceForTenant();
    const sourcesMap = loader.toAssessmentSources(evidence);

    expect(evidence).toHaveLength(1);
    expect(evidence[0].complianceVerdict).toBe('NOT_SAT');

    const sources = sourcesMap.get('AC.L2-3.1.1');
    expect(sources).toBeDefined();
    expect(sources![0].result).toBe('missing');
  });

  test('returns empty array if evidence directory does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);

    const loader = new StamperEvidenceLoader(TENANT_SLUG);
    const evidence = loader.loadEvidenceForTenant();

    expect(evidence).toEqual([]);
  });

  test('handles multiple controls in metadata.controlIds array', () => {
    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readdirSync as jest.Mock).mockReturnValue(['training/at.l2-3.2.1.json']);
    mockFs.readFileSync.mockReturnValue(
      makeSatEvidence(['AT.L2-3.2.1', 'AT.L2-3.2.2'], 'AT.L2-3.2.1.training', 'Training Evidence')
    );

    const loader = new StamperEvidenceLoader(TENANT_SLUG);
    const evidence = loader.loadEvidenceForTenant();
    const sourcesMap = loader.toAssessmentSources(evidence);

    expect(evidence).toHaveLength(1);
    expect(evidence[0].controlIds).toEqual(['AT.L2-3.2.1', 'AT.L2-3.2.2']);

    expect(sourcesMap.get('AT.L2-3.2.1')).toBeDefined();
    expect(sourcesMap.get('AT.L2-3.2.2')).toBeDefined();
    expect(sourcesMap.get('AT.L2-3.2.1')![0].result).toBe('imported');
    expect(sourcesMap.get('AT.L2-3.2.2')![0].result).toBe('imported');
  });

  test('gracefully skips malformed JSON files', () => {
    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readdirSync as jest.Mock).mockReturnValue([
      'good.json',
      'bad.json',
    ]);
    mockFs.readFileSync.mockImplementation((filePath: any) => {
      if (String(filePath).includes('bad.json')) {
        return 'not valid json {{{';
      }
      return makeSatEvidence(['PE.L2-3.10.1'], 'PE.L2-3.10.1.access', 'Physical Access');
    });

    const loader = new StamperEvidenceLoader(TENANT_SLUG);
    const evidence = loader.loadEvidenceForTenant();

    expect(evidence).toHaveLength(1);
    expect(evidence[0].entryId).toBe('PE.L2-3.10.1.access');
  });
});
