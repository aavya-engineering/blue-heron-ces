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
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceReader } from '../../../src/eo/adminops/AdminOpsEvidenceReader';
import { liveSatAdminOpsControls, adminOpsCrmCreditedControls } from '../../../src/eo/adminops/adminopsViews';
import { makeRealShapeRow } from './helpers/makeRealShapeRow';

const TENANT_ID = 'crm-gate-test';
const COLLECTION = 'adminops_evidence';

describe('AE-R7: CRM gating — YAML without live AO row is NOT credited', () => {
  let tmpDir: string;
  let dbPath: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-gate-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    dbPath = path.join(tmpDir, 'ces.db');
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  it('control with no AO rows → sources.keys() does NOT contain it', () => {
    getCesRepository(dbPath);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.sources.has('SC.L2-3.13.1')).toBe(false);
    expect(result.stats.total).toBe(0);
  });

  it('control with only dry-run AO row → sources.keys() does NOT contain it', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      mode: 'dry_run',
      dryRun: true,
      outcome: 'dry_run',
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.sources.has('SC.L2-3.13.1')).toBe(false);
  });

  it('control with live SAT AO row → sources.keys() contains it', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.sources.has('SC.L2-3.13.1')).toBe(true);
  });

  it('E2: control with only failed AO row → NOT credited in CRM', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      outcome: 'failed_no_remediation',
      verdict: 'NOT_APPLICABLE',
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.sources.has('SC.L2-3.13.1')).toBe(false);
    expect(result.stats.failed).toBe(1);

    // FX-EO5: the PRODUCTION CRM credit functions SspGenerator uses (no local copy).
    const liveSatControls = liveSatAdminOpsControls(result.parsed);
    expect(liveSatControls.has('SC.L2-3.13.1')).toBe(false);
    expect(adminOpsCrmCreditedControls(['SC.L2-3.13.1'], liveSatControls, () => true).size).toBe(0);
  });

  it('E2: control with only denied AO row → NOT credited in CRM', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      outcome: 'denied_cmmc',
      verdict: 'NOT_APPLICABLE',
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.sources.has('SC.L2-3.13.1')).toBe(false);
    expect(result.stats.denied).toBe(1);

    // FX-EO5: the PRODUCTION CRM credit functions SspGenerator uses (no local copy).
    const liveSatControls = liveSatAdminOpsControls(result.parsed);
    expect(liveSatControls.has('SC.L2-3.13.1')).toBe(false);
    expect(adminOpsCrmCreditedControls(['SC.L2-3.13.1'], liveSatControls, () => true).size).toBe(0);
  });

  it('FX-EO5: live SAT row + AdminOps knowledge bank → CRM credit; without the KB → no credit', () => {
    getCesRepository(dbPath).put(COLLECTION, makeRealShapeRow({ tenantId: TENANT_ID, commandId: 'F-13' }));
    const live = liveSatAdminOpsControls(new AdminOpsEvidenceReader(TENANT_ID, dbPath).read().parsed);
    expect([...adminOpsCrmCreditedControls(['SC.L2-3.13.1', 'AC.L2-3.1.1'], live, () => true)]).toEqual(['SC.L2-3.13.1']);
    expect(adminOpsCrmCreditedControls(['SC.L2-3.13.1'], live, () => false).size).toBe(0);
  });
});
