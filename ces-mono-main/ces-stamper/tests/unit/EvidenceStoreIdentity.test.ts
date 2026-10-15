// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EvidenceStore } from '../../src/evidence/EvidenceStore';
import { StamperConfig } from '../../src/config/StamperConfig';
import { CesIdentity } from '../../src/types/schema.types';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';

// G1/T2: identity propagation onto collected EvidenceMetadata.
describe('EvidenceStore CES identity propagation', () => {
  let tmpDir: string;
  let config: StamperConfig;

  const ces: CesIdentity = {
    cesId: 'ces-xyz',
    customerId: 99,
    siBaselineId: 3,
    customerName: 'Globex',
    tenantSlug: 'globex',
  };

  const makeConfig = () =>
    StamperConfig.fromTenantConfig({
      dryRun: true,
      storageRoot: tmpDir,
      stateDir: path.join(tmpDir, 'state'),
      evidenceDir: path.join(tmpDir, 'evidence'),
      logDir: path.join(tmpDir, 'logs'),
    });

  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-es-ces-'));
    process.env.CES_PIPELINE_ROOT = tmpDir; // unified DB lands at {tmpDir}/ces.db
    config = makeConfig();
  });

  afterEach(() => {
    closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  it('tags metadata with `ces` when a planCes is provided', async () => {
    const store = new EvidenceStore(config, ces);
    const metadata = await store.storeArtifact(
      'plan-1',
      'task-1',
      'artifact-1',
      'config_export',
      ['AC.L1-3.1.1'],
      'test-collector',
      365,
      'sample evidence content',
      'text/plain'
    );

    expect(metadata.ces).toEqual(ces);
  });

  it('leaves metadata.ces undefined when no planCes is provided', async () => {
    const store = new EvidenceStore(config);
    const metadata = await store.storeArtifact(
      'plan-2',
      'task-2',
      'artifact-2',
      'config_export',
      ['AC.L1-3.1.1'],
      'test-collector',
      365,
      'sample evidence content',
      'text/plain'
    );

    expect(metadata.ces).toBeUndefined();
  });
});
