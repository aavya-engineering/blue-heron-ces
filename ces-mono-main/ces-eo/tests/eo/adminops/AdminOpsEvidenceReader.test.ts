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
import { makeRealShapeRow } from './helpers/makeRealShapeRow';

const TENANT_ID = 'test-tenant-001';
const OTHER_TENANT_ID = 'other-tenant-999';
const COLLECTION = 'adminops_evidence';

describe('AdminOpsEvidenceReader', () => {
  let tmpDir: string;
  let dbPath: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-reader-test-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    dbPath = path.join(tmpDir, 'ces.db');
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  it('(a) live SAT → produces assessment source with result=imported', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      controlIds: ['SC.L2-3.13.1', 'SC.L2-3.13.2'],
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.stats.live).toBe(1);
    expect(result.stats.dryRun).toBe(0);
    expect(result.sources.get('SC.L2-3.13.1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'adminops_execution',
          result: 'imported',
          detail: expect.stringContaining('F-13'),
        }),
      ]),
    );
    expect(result.sources.get('SC.L2-3.13.2')).toBeDefined();
  });

  it('(b) dry-run SAT → excluded, does not produce any source (SPRS unchanged)', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-14',
      mode: 'dry_run',
      dryRun: true,
      outcome: 'dry_run',
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.stats.dryRun).toBe(1);
    expect(result.stats.live).toBe(0);
    expect(result.sources.size).toBe(0);
  });

  it('(c) other tenant rows are excluded by scope', () => {
    const otherRow = makeRealShapeRow({
      tenantId: OTHER_TENANT_ID,
      commandId: 'F-13',
      id: 'F-13:other-exec',
    });
    getCesRepository(dbPath).put(COLLECTION, otherRow);

    const myRow = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-14',
      id: 'F-14:my-exec',
    });
    getCesRepository(dbPath).put(COLLECTION, myRow);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.stats.total).toBe(1);
    expect(result.stats.live).toBe(1);
  });

  it('(d) denial rows do NOT produce sources (EXIT-7: denials never credit)', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      outcome: 'denied_cmmc',
      verdict: 'NOT_APPLICABLE',
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.stats.denied).toBe(1);
    expect(result.sources.size).toBe(0);
    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0].outcome).toBe('denied_cmmc');
  });

  it('(e) legacy row without mode/contractVersion → excluded as legacy', () => {
    getCesRepository(dbPath).put(COLLECTION, {
      id: 'legacy-row',
      ces: { tenantId: TENANT_ID },
      data: {
        evidence: {
          metadata: {
            timestamp: '2026-08-01T10:00:00Z',
            controlIds: ['AC.L2-3.1.1'],
            sha256Hash: 'legacy123',
          },
          outcome: 'automated_success',
          complianceVerdict: 'SAT',
        },
        metadata: {
          commandId: 'F-01',
          tenantId: TENANT_ID,
        },
      },
    });

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.stats.legacy).toBe(1);
    expect(result.stats.live).toBe(0);
    expect(result.sources.size).toBe(0);
    expect(result.parsed).toHaveLength(0);
  });
});
