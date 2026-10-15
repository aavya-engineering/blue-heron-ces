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
import * as os from 'node:os';

jest.mock('ces-shared/storage/node', () => ({
  getStamperTenantRoot: (slug: string) => {
    const root = process.env.CES_PIPELINE_ROOT || '/default';
    return path.join(root, 'Stamper', 'plan-data', slug);
  },
}));

import { StamperEvidenceLoader } from '../../../src/eo/evidence/StamperEvidenceLoader';

const TENANT_SLUG = 'sim-integration-test';

describe('StamperEvidenceLoader integration (MS-R8)', () => {
  let tmpRoot: string;
  let evidenceDir: string;
  const origPipelineRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-ms-r8-'));
    evidenceDir = path.join(tmpRoot, 'Stamper', 'plan-data', TENANT_SLUG, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    process.env.CES_PIPELINE_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (origPipelineRoot !== undefined) {
      process.env.CES_PIPELINE_ROOT = origPipelineRoot;
    } else {
      delete process.env.CES_PIPELINE_ROOT;
    }
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  });

  test('loads evidence written by Stamper writeAndUploadEvidence to CES_PIPELINE_ROOT', () => {
    const evidenceFile = {
      rawResponse: '{"value":[{"displayName":"TestPolicy"}]}',
      outcome: 'automated_success',
      outcomeRationale: 'Exit code 0, output validated',
      complianceVerdict: 'SAT',
      verdictRationale: 'Policy confirmed present',
      registryEntry: {
        entry_id: 'CM.L2-3.4.1.config-baselines',
        label: 'Configuration Baselines',
        control_ids: ['CM.L2-3.4.1'],
      },
      metadata: {
        controlIds: ['CM.L2-3.4.1'],
        timestamp: '2026-09-26T10:00:00.000Z',
        executorIdentity: 'cse-ao-service',
        commandExecuted: 'Get-MgDeviceManagementDeviceConfiguration',
        sha256Hash: 'a1b2c3d4e5f6',
        environment: 'GCC-High',
        mode: 'live' as const,
        dryRun: false,
      },
    };

    fs.writeFileSync(
      path.join(evidenceDir, 'cm.l2-3.4.1.config-baselines.json'),
      JSON.stringify(evidenceFile, null, 2),
    );

    const loader = new StamperEvidenceLoader(TENANT_SLUG);
    const evidence = loader.loadEvidenceForTenant();

    expect(evidence).toHaveLength(1);
    expect(evidence[0].controlIds).toEqual(['CM.L2-3.4.1']);
    expect(evidence[0].complianceVerdict).toBe('SAT');
    expect(evidence[0].entryId).toBe('CM.L2-3.4.1.config-baselines');
    expect(evidence[0].label).toBe('Configuration Baselines');

    const sourcesMap = loader.toAssessmentSources(evidence);
    const sources = sourcesMap.get('CM.L2-3.4.1');
    expect(sources).toBeDefined();
    expect(sources![0].type).toBe('evidence_import');
    expect(sources![0].result).toBe('imported');
  });

  test('returns empty when no evidence exists for tenant', () => {
    const loader = new StamperEvidenceLoader('nonexistent-tenant');
    const evidence = loader.loadEvidenceForTenant();
    expect(evidence).toEqual([]);
  });
});
