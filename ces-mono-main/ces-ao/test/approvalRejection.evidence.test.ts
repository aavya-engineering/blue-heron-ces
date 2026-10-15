// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// A2: Approval-rejection evidence, persistence-failure resilience, and correlation round-trip.
//
// Three test blocks:
//  1. Rejection through recordApprovalDecision writes exactly one evidence row with
//     outcome 'approval_rejected', verdict ≠ SAT, mode 'live', dryRun false (F-4).
//  2. A failing repository does not throw — evidencePersisted:false + evidenceError returned.
//  3. correlationId flows from executeAoCommand opts to the persisted row and the result.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Mock the PowerShell boundary (same as E2E) ──
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() { return 'mgraph'; }
    async execute(task: any, _variables: Record<string, any>, dryRun: boolean) {
      return { success: true, stdout: JSON.stringify({ ok: true }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

import {
  createApprovalRequest,
  recordApprovalDecision,
} from '../src/execution/ApprovalStore.js';
import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand, verifiedApprover } from './fixtures.js';
import type { TenantConfig } from 'ces-shared/config';

let tmpRoot: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-reject-'));
  savedEnv.CES_PIPELINE_ROOT = process.env.CES_PIPELINE_ROOT;
  savedEnv.CES_CONFIG_PATH = process.env.CES_CONFIG_PATH;
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  delete process.env.CES_CONFIG_PATH;
});
afterEach(() => {
  closeAllCesRepositories();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeTenant(): TenantConfig {
  const certPath = path.join(tmpRoot, 'test.pfx');
  if (!fs.existsSync(certPath)) fs.writeFileSync(certPath, 'dummy');
  return {
    tenantSlug: 'reject-test',
    tenantId: 'reject-tenant-guid',
    appId: 'app-id',
    certPath,
    certThumbprint: 'AABB000000000000000000000000000000000000',
    domain: 'reject.onmicrosoft.us',
    cmmcMigrationExempt: true,
    endpoints: {
      graph: 'https://graph.microsoft.us',
      login: 'https://login.microsoftonline.us',
    },
    subscription: { subscription_id: 'sub-1', resource_group: 'rg-1', location: 'usgovvirginia' },
    subscriptionId: 'sub-1',
    resources: { operatorUPN: 'op@reject.onmicrosoft.us' },
    clientName: 'Reject Test',
  } as TenantConfig;
}

describe('Approval rejection evidence (A2)', () => {
  it('writes exactly one evidence row with outcome approval_rejected, live mode, verdict ≠ SAT', async () => {
    const cmd = makeAoCommand({
      id: 'T3-01',
      sodTier: 'Tier 3',
      cmmcPractices: ['AC.L2-3.1.5'],
    });

    const request = await createApprovalRequest({
      commandId: cmd.id,
      commandTitle: cmd.title,
      domain: cmd.domain,
      tenantId: 'reject-tenant-guid',
      sodTier: cmd.sodTier,
      requestorUPN: 'requestor@reject.onmicrosoft.us',
      inputs: { targetUPN: 'victim@reject.onmicrosoft.us' },
      controlIds: cmd.cmmcPractices,
    });

    await recordApprovalDecision(
      request.approvalId,
      verifiedApprover('approver@reject.onmicrosoft.us', 'reject-tenant-guid'),
      'reject',
      'Policy violation'
    );

    const all = getCesRepository().listAll<any>('adminops_evidence');
    const rows = all.filter((r: any) => r.data?.metadata?.commandId === 'T3-01');
    expect(rows.length, 'exactly one rejection evidence row').toBe(1);

    const row = rows[0].data;
    expect(row.evidence.outcome).toBe('approval_rejected');
    expect(row.evidence.complianceVerdict).toBe('NOT_APPLICABLE');
    expect(row.metadata.dryRun).toBe(false);
    expect(row.metadata.mode).toBe('live');
    expect(row.metadata.approverUPN).toBe('approver@reject.onmicrosoft.us');
    expect(row.metadata.approvalId).toBe(request.approvalId);
    expect(row.metadata.requestorUPN).toBe('requestor@reject.onmicrosoft.us');
    expect(row.metadata.controlIds.length).toBeGreaterThan(0);
    expect(row.evidence.complianceVerdict).not.toBe('SAT');
  });
});

describe('Persistence-failure resilience (A2)', () => {
  it('evidencePersisted:false + evidenceError when repository throws, no exception escapes', async () => {
    const cmd = makeAoCommand({ id: 'PF-01', cmmcPractices: ['AC.L1-3.1.1'] });
    const tenant = makeTenant();

    const origRepo = getCesRepository();
    const origPut = origRepo.put.bind(origRepo);
    let putCallCount = 0;
    vi.spyOn(origRepo, 'put').mockImplementation((...args: any[]) => {
      putCallCount++;
      if (args[0] === 'adminops_evidence') {
        throw new Error('Simulated persistence failure');
      }
      return origPut(...args);
    });

    const result = await executeAoCommand(cmd, tenant, {}, true, {
      requestorUPN: 'op@reject.onmicrosoft.us',
    });

    expect('status' in result).toBe(false);
    expect((result as any).evidencePersisted).toBe(false);
    expect((result as any).evidenceError).toMatch(/persistence failure/i);

    vi.restoreAllMocks();
  });
});

describe('Correlation round-trip (A2)', () => {
  it('correlationId flows from opts to the result and the persisted row', async () => {
    const cmd = makeAoCommand({ id: 'CORR-01', cmmcPractices: ['AC.L1-3.1.1'] });
    const tenant = makeTenant();
    const corrId = 'corr-e2e-12345';

    const result = await executeAoCommand(cmd, tenant, {}, true, {
      requestorUPN: 'op@reject.onmicrosoft.us',
      correlationId: corrId,
    });

    expect('status' in result).toBe(false);
    expect((result as any).correlationId).toBe(corrId);

    const all = getCesRepository().listAll<any>('adminops_evidence');
    const rows = all.filter((r: any) => r.data?.metadata?.commandId === 'CORR-01');
    expect(rows.length).toBe(1);
    expect(rows[0].data.metadata.correlationId).toBe(corrId);
  });
});
