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
import type { AdminOpsEvidence } from 'ces-shared/types/adminops-evidence';
import { makeRealShapeRow } from './helpers/makeRealShapeRow';
import { toExplorerItem, toExecutionView, packageAdminOpsRow } from '../../../src/eo/adminops/adminopsViews';

const TENANT_ID = 'explorer-test-tenant';
const COLLECTION = 'adminops_evidence';

describe('AE-R5: AdminOps in Explorer index and executions route', () => {
  let tmpDir: string;
  let dbPath: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-r5-test-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    dbPath = path.join(tmpDir, 'ces.db');

    const repo = getCesRepository(dbPath);
    repo.put(COLLECTION, makeRealShapeRow({ tenantId: TENANT_ID, commandId: 'F-13', id: 'F-13:exec1', correlationId: 'corr-001' }));
    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-14', id: 'F-14:exec1',
      mode: 'dry_run', dryRun: true, outcome: 'dry_run',
    }));
    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-15', id: 'F-15:exec1',
      outcome: 'denied_cmmc', verdict: 'NOT_APPLICABLE',
    }));
    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-16', id: 'F-16:exec1',
      mode: 'dry_run', dryRun: true,
      outcome: 'blocked_pending_approval', verdict: 'NOT_APPLICABLE',
    }));
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  it('reader returns all 4 seeded rows as parsed entries', () => {
    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.parsed).toHaveLength(4);
    expect(result.stats.total).toBe(4);

    const commandIds = result.parsed.map(r => r.commandId);
    expect(commandIds).toContain('F-13');
    expect(commandIds).toContain('F-14');
    expect(commandIds).toContain('F-15');
    expect(commandIds).toContain('F-16');
  });

  // FX-EO5: the production mappers the Explorer index/item and executions routes use
  // (route-level behaviour is covered in tests/eo/server/tenant-scoping.route.test.ts).
  it('explorer items format (production toExplorerItem): dry_run rows labeled as preview', () => {
    const items = new AdminOpsEvidenceReader(TENANT_ID, dbPath).read().entries.map(toExplorerItem);

    const dryItem = items.find(i => i.id === 'adminops:F-14:exec1');
    expect(dryItem?.title).toContain('(preview)');
    expect(dryItem?.path).toBe('adminops/F-14:exec1');

    const liveItem = items.find(i => i.id === 'adminops:F-13:exec1');
    expect(liveItem?.title).not.toContain('(preview)');
    expect(liveItem?.title).toContain('executed');

    expect(items.find(i => i.id === 'adminops:F-15:exec1')?.title).toContain('denied_cmmc');
    expect(items.find(i => i.id === 'adminops:F-16:exec1')?.title).toContain('blocked_pending_approval');
  });

  it('executions format (production toExecutionView): each row has rowId, mode, outcome, label, correlationId', () => {
    const executions = new AdminOpsEvidenceReader(TENANT_ID, dbPath).read().entries.map(toExecutionView);

    const dry = executions.find(e => e.commandId === 'F-14');
    expect(dry?.label).toBe('preview');
    expect(dry?.mode).toBe('dry_run');

    const live = executions.find(e => e.commandId === 'F-13');
    expect(live?.rowId).toBe('F-13:exec1');
    expect(live?.label).toBe('executed');
    expect(live?.mode).toBe('live');
    expect(live?.correlationId).toBe('corr-001');

    expect(executions.find(e => e.commandId === 'F-15')?.label).toBe('denied_cmmc');
  });
});

describe('AE-R5: AdminOps rows in evidence package (production packageAdminOpsRow)', () => {
  it('golden-shaped live and dry-run rows are packaged with label + stable file name', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-r5-pkg-'));
    try {
      const dbPath = path.join(tmp, 'ces.db');
      const repo = getCesRepository(dbPath);
      repo.put(COLLECTION, makeRealShapeRow({ tenantId: 'pkg-test', commandId: 'F-13', id: 'p1', timestamp: '2026-09-26T12:00:00Z' }));
      repo.put(COLLECTION, makeRealShapeRow({
        tenantId: 'pkg-test', commandId: 'F-14', id: 'p2', timestamp: '2026-09-26T12:01:00Z',
        mode: 'dry_run', dryRun: true, outcome: 'dry_run',
      }));
      const rows: AdminOpsEvidence[] = new AdminOpsEvidenceReader('pkg-test', dbPath).read().parsed;
      const byCmd = new Map(rows.map(ev => [ev.commandId, packageAdminOpsRow(ev)]));

      expect(byCmd.get('F-13')?.label).toBe('executed');
      expect(byCmd.get('F-13')?.fileName).toBe('F-13-2026-09-26T12-00-00Z.json');
      expect(JSON.parse(byCmd.get('F-13')!.json).label).toBe('executed');

      expect(byCmd.get('F-14')?.label).toBe('preview');
      expect(byCmd.get('F-14')?.fileName).toBe('F-14-2026-09-26T12-01-00Z.json');
    } finally {
      closeAllCesRepositories();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
