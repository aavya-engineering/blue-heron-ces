// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G1/T2 (identity propagation) — AdminOps hop.
//
// Verifies AO's two persistent outputs carry the CES identity block: the evidence-store
// metadata sidecar and the separation-of-duties approval record. Identity is resolved from the
// CES config by tenantId. See docs/adr/ADR-001-ces-identity-model.md.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createApprovalRequest } from '../src/execution/ApprovalStore.js';
import { persistEvidenceArtifact } from '../src/execution/EvidenceEmitter.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';

let root: string;
const env0 = { ...process.env };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-ces-'));
  process.env.CES_PIPELINE_ROOT = root;
  delete process.env.CES_CONFIG_PATH;
});
afterEach(() => {
  closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
  for (const k of ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH'] as const) {
    if (env0[k] === undefined) delete process.env[k];
    else process.env[k] = env0[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function writeConfig(bindings: unknown[]): void {
  const p = path.join(root, 'ces.config.json');
  fs.writeFileSync(p, JSON.stringify({ version: '1.0.0', customers: bindings }));
  process.env.CES_CONFIG_PATH = p;
}

const minimalEvidence = () =>
  ({
    rawResponse: '{}',
    outcome: 'automated_success',
    outcomeRationale: 'ok',
    complianceVerdict: 'SAT',
    metadata: {
      controlIds: ['AC.L1-3.1.1'],
      timestamp: '2026-01-02T03:04:05.678Z',
      executorIdentity: 'cse-ao-service',
      commandExecuted: 'Get-Thing',
      sha256Hash: 'abc123',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe('AO approval record carries CES identity', () => {
  it('echoes tenantId when no config binding exists', async () => {
    const req = await createApprovalRequest({
      commandId: 'A-07',
      commandTitle: 'Destructive thing',
      domain: 'A',
      tenantId: 'guid-1',
      sodTier: 'Tier 3',
      requestorUPN: 'alice@x.com',
      inputs: { foo: 'bar' },
    });
    expect(req.ces).toEqual({ tenantId: 'guid-1' });
    // persisted to the unified repository (control collection, looked up by capability id)
    const stored = getCesRepository().findById<typeof req>('adminops_approvals', req.approvalId);
    expect(stored?.data.ces).toEqual({ tenantId: 'guid-1' });
  });

  it('resolves customer lineage from a mapped config', async () => {
    writeConfig([{ customerName: 'Acme Corp', customerId: 7, tenantSlug: 'acme', tenantId: 'guid-1' }]);
    const req = await createApprovalRequest({
      commandId: 'A-07',
      commandTitle: 'Destructive thing',
      domain: 'A',
      tenantId: 'guid-1',
      sodTier: 'Tier 3',
      requestorUPN: 'alice@x.com',
      inputs: {},
    });
    expect(req.ces).toMatchObject({ customerName: 'Acme Corp', customerId: 7, tenantSlug: 'acme', tenantId: 'guid-1' });
  });
});

describe('AO evidence record carries CES identity (tenant-isolated)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readEvidence = (id: string, tenantId: string): any =>
    getCesRepository().get('adminops_evidence', id, { tenantId })?.data;

  it('persists ces into the evidence record (data.ces, sibling of the contract-row metadata)', async () => {
    await persistEvidenceArtifact(minimalEvidence(), {
      commandId: 'A-09', tenantId: 'guid-1', executionId: 'exec-1', domain: 'A',
    });
    expect(readEvidence('A-09:exec-1', 'guid-1').ces).toEqual({ tenantId: 'guid-1' });
  });

  it('includes customer lineage when the tenant is mapped', async () => {
    writeConfig([{ customerName: 'Globex', customerId: 9, tenantSlug: 'globex', tenantId: 'guid-2' }]);
    await persistEvidenceArtifact(minimalEvidence(), {
      commandId: 'A-09', tenantId: 'guid-2', executionId: 'exec-2', domain: 'A',
    });
    expect(readEvidence('A-09:exec-2', 'guid-2').ces).toMatchObject({
      customerName: 'Globex', customerId: 9, tenantSlug: 'globex', tenantId: 'guid-2',
    });
  });

  it('is idempotent on (commandId, tenantId, executionId) and tenant-isolated', async () => {
    const opts = { commandId: 'A-09', tenantId: 'guid-1', executionId: 'exec-x', domain: 'A' };
    const first = await persistEvidenceArtifact(minimalEvidence(), opts);
    const second = await persistEvidenceArtifact(minimalEvidence(), opts);
    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    // another tenant cannot read this record
    expect(getCesRepository().get('adminops_evidence', 'A-09:exec-x', { tenantId: 'other' })).toBeUndefined();
  });
});
