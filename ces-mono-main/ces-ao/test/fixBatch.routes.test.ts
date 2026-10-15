// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// 2026-09-27 fix batch, route level (through the real Express routers):
//
//  FX-AO3 — lost evidence is surfaced: with a repository whose evidence writes fail, the
//           execute API response (and the approval decision/list views) flag the loss,
//           and an error-level log entry is written.
//  FX-AO4 — approver identity comes from the approval record: a request that tries to
//           set a different approver on execute → the persisted row carries the approval
//           record's approver.
//
// Routers mounted on a throwaway express app on 127.0.0.1:0 (loopback only). Mocks: the
// PowerShell boundary; the tenant loader (returns a kind:'sim' loopback tenant); and the
// repository's `put` for the adminops_evidence collection only, when failure is switched
// on (approvals keep persisting normally). No real tenant or network.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute() {
      return { success: true, stdout: JSON.stringify({ ok: true }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

const holder = vi.hoisted(() => ({ root: '', failEvidenceWrites: false }));

vi.mock('ces-shared/persistence/node', async (importOriginal) => {
  const orig = await importOriginal<Record<string, any>>();
  return {
    ...orig,
    getCesRepository: (...args: unknown[]) => {
      const repo = orig.getCesRepository(...args);
      return new Proxy(repo, {
        get(target, prop) {
          if (prop === 'put') {
            return (collection: string, record: unknown) => {
              if (holder.failEvidenceWrites && collection === 'adminops_evidence') {
                throw new Error('simulated evidence store failure (disk full)');
              }
              return target.put(collection, record);
            };
          }
          const v = (target as any)[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
});

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async (slug: string) => ({
    tenantSlug: slug,
    tenantId: 'fix-sim-tenant',
    appId: 'fix-app-id',
    certPath: `${holder.root}/fix.pfx`,
    certThumbprint: 'F1F1000000000000000000000000000000000000',
    domain: 'fix.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'fix-sub',
    resources: {},
  }),
}));

import express from 'express';
import { createApprovalsRouter } from '../src/server/routes/approvals.routes.js';
import { createHs256PrincipalVerifier, signPrincipalToken } from 'ces-shared/http/principal';
import { createExecuteRouter } from '../src/server/routes/execute.routes.js';
import { createApprovalRequest } from '../src/execution/ApprovalStore.js';
import { EVIDENCE_LOST_LOG_PREFIX } from '../src/execution/EvidenceEmitter.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand } from './fixtures.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

let tmpRoot: string;
let server: Server;
let base: string;
let stacksim: StacksimEnvHandle;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;

const READ_CMD = makeAoCommand({ id: 'FIX-READ-01', trigger: 'EVIDENCE', cmmcPractices: ['AC.L1-3.1.1'] });
const T3_CMD = makeAoCommand({ id: 'FIX-T3-01', trigger: 'EVIDENCE', sodTier: 'Tier 3', cmmcPractices: ['AC.L2-3.1.5'] });

const REQUESTOR = 'requestor@fix.onmicrosoft.us';
const APPROVER = 'approver@fix.onmicrosoft.us';
const IMPOSTOR = 'impostor@fix.onmicrosoft.us';

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fixbatch-'));
  holder.root = tmpRoot;
  holder.failEvidenceWrites = false;
  fs.writeFileSync(path.join(tmpRoot, 'fix.pfx'), 'dummy');
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  // AO-20 (2026-09-27): the tenant here is kind:'sim' (loopback) — route this process
  // to stacksim so the executor's isStacksimModeActive() check doesn't refuse it.
  stacksim = activateStacksimEnv();

  const app = express();
  app.use(express.json());
  // W4-AO3: decisions require an authenticated principal; the test approver signs in with a token.
  app.use('/api', createApprovalsRouter({ principal: { verifier: createHs256PrincipalVerifier({ secret: PRINCIPAL_SECRET }) } }));
  app.use('/api', createExecuteRouter([READ_CMD, T3_CMD]));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  holder.failEvidenceWrites = false;
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeAllCesRepositories();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  stacksim.restore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const PRINCIPAL_SECRET = 'ao-route-test-principal-secret';
/** W4-AO3: a decision body's approverUPN is the UPN the caller authenticates as (x-ces-principal token). */
const post = (url: string, body: any) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (url.endsWith('/decision') && body?.approverUPN) {
    headers['x-ces-principal'] = signPrincipalToken(
      // FC-AO-2: approver tokens are tenant-bound; this file's tenant is 'fix-sim-tenant'.
      // FC-AO-3 step 1: approver tokens need the ao-approver role too.
      { sub: `sub:${body.approverUPN}`, upn: body.approverUPN, roles: ['ao-approver'], tid: 'fix-sim-tenant' },
      { secret: PRINCIPAL_SECRET },
    );
  }
  return fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
};

const evidenceRows = (commandId: string) =>
  getCesRepository()
    .listAll<any>('adminops_evidence')
    .filter((r: any) => r.data?.metadata?.commandId === commandId);

describe('FX-AO3: lost evidence is surfaced, never silent', () => {
  it('execute: failing evidence store → response flags the loss and an error-level log is written', async () => {
    holder.failEvidenceWrites = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post(`/api/execute/${READ_CMD.id}`, {
      tenant: 'fix-sim',
      inputs: {},
      dryRun: false,
      confirmApply: READ_CMD.id, // W4-AO5 web apply guard
      requestorUPN: REQUESTOR,
    });
    const body: any = await res.json();

    expect(body.evidencePersisted).toBe(false);
    expect(body.evidenceLost).toBe(true);
    expect(body.evidenceError).toMatch(/simulated evidence store failure/);
    expect(body.evidenceWarning).toMatch(/EVIDENCE NOT PERSISTED/);
    expect(
      errorSpy.mock.calls.some((c) => String(c[0]).startsWith(EVIDENCE_LOST_LOG_PREFIX)),
    ).toBe(true);
    expect(evidenceRows(READ_CMD.id)).toHaveLength(0);
  });

  it('execute: healthy store → evidencePersisted true, no loss flag', async () => {
    const res = await post(`/api/execute/${READ_CMD.id}`, {
      tenant: 'fix-sim',
      inputs: {},
      dryRun: false,
      confirmApply: READ_CMD.id,
      requestorUPN: REQUESTOR,
    });
    const body: any = await res.json();
    expect(res.status).toBe(200);
    expect(body.evidencePersisted).toBe(true);
    expect(body.evidenceLost).toBeUndefined();
    expect(evidenceRows(READ_CMD.id)).toHaveLength(1);
  });

  it('pending approval (202): failing evidence store → the 202 response flags the loss', async () => {
    holder.failEvidenceWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(`/api/execute/${T3_CMD.id}`, {
      tenant: 'fix-sim',
      inputs: {},
      dryRun: false,
      confirmApply: T3_CMD.id,
      requestorUPN: REQUESTOR,
    });
    expect(res.status).toBe(202);
    const body: any = await res.json();
    expect(body.status).toBe('pending_approval');
    expect(body.evidenceLost).toBe(true);
    expect(body.evidenceWarning).toMatch(/EVIDENCE NOT PERSISTED/);
  });

  it('approval rejection: failing evidence store → decision response and approval views flag the loss', async () => {
    const request = await createApprovalRequest({
      commandId: 'FIX-T3-REJ',
      commandTitle: 'Fix Tier 3',
      domain: 'A',
      tenantId: 'fix-sim-tenant',
      sodTier: 'Tier 3',
      requestorUPN: REQUESTOR,
      inputs: {},
      controlIds: ['AC.L2-3.1.5'],
    });
    holder.failEvidenceWrites = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post(`/api/approvals/${request.approvalId}/decision`, {
      approverUPN: APPROVER,
      decision: 'reject',
      reason: 'fix-batch rejection',
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.evidencePersisted).toBe(false);
    expect(body.evidenceLost).toBe(true);
    expect(body.evidenceWarning).toMatch(/EVIDENCE NOT PERSISTED/);
    expect(errorSpy.mock.calls.some((c) => String(c[0]).startsWith(EVIDENCE_LOST_LOG_PREFIX))).toBe(true);

    const detail: any = await (await fetch(`${base}/api/approvals/${request.approvalId}`)).json();
    expect(detail.approval.evidenceLost).toBe(true);
    const list: any = await (await fetch(`${base}/api/approvals`)).json();
    expect(list.approvals.find((a: any) => a.approvalId === request.approvalId).evidenceLost).toBe(true);
  });
});

describe('FX-AO4: approver identity comes from the approval record', () => {
  it('execute with a request-supplied approverUPN → persisted row carries the approval record approver', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 1. Request (no approvalId) → pending.
    const pendingRes = await post(`/api/execute/${T3_CMD.id}`, {
      tenant: 'fix-sim',
      inputs: {},
      dryRun: false,
      confirmApply: T3_CMD.id,
      requestorUPN: REQUESTOR,
    });
    expect(pendingRes.status).toBe(202);
    const { approvalId } = (await pendingRes.json()) as any;

    // 2. Second person approves (this sets the approval record's approver).
    const decision = await post(`/api/approvals/${approvalId}/decision`, { approverUPN: APPROVER, decision: 'approve' });
    expect(decision.status).toBe(200);

    // 3. Execute with the approvalId AND a forged approver in the request body.
    const execRes = await post(`/api/execute/${T3_CMD.id}`, {
      tenant: 'fix-sim',
      inputs: {},
      dryRun: false,
      confirmApply: T3_CMD.id,
      requestorUPN: REQUESTOR,
      approvalId,
      approverUPN: IMPOSTOR,
    });
    expect(execRes.status).toBe(200);

    const executed = evidenceRows(T3_CMD.id).filter((r: any) => r.data.metadata.outcome === 'executed');
    expect(executed).toHaveLength(1);
    expect(executed[0].data.metadata.approverUPN).toBe(APPROVER);
    expect(executed[0].data.metadata.approvalId).toBe(approvalId);
    expect(JSON.stringify(executed[0].data)).not.toContain(IMPOSTOR);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('ignoring request-supplied approverUPN'))).toBe(true);
  });
});
