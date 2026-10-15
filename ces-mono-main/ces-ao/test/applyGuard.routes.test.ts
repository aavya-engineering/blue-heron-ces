// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO5 item 3 (P1): the web execute route carries the same live-apply guard as the CLI
// (`--apply`) and MCP (`AO_MCP_ALLOW_APPLY=1` + dryRun:false) paths.
//
// A live apply (dryRun:false) through POST /api/execute/:commandId must also carry
// `confirmApply` equal to the command id. Without it the route refuses (428), never calls
// the executor, and persists a refusal evidence row; with it, the executor runs.
//
// Real Express router on 127.0.0.1:0 (loopback) with a real temp evidence DB. Mocks: the
// executor (so nothing executes), and the tenant loader (a kind:'sim' loopback tenant).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const exec = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock('../src/execution/CommandExecutor.js', () => ({
  executeAoCommand: async (...args: any[]) => {
    exec.calls.push(args);
    return { success: true, stdout: '{"ok":true}', stderr: '', exit_code: 0, evidencePersisted: true };
  },
}));

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async (slug: string) => ({
    tenantSlug: slug,
    tenantId: 'guard-sim-tenant',
    appId: 'guard-app-id',
    certPath: 'unused.pfx',
    certThumbprint: 'A5A5000000000000000000000000000000000000',
    domain: 'guard.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'guard-sub',
    resources: {},
  }),
}));

import express from 'express';
import { createExecuteRouter } from '../src/server/routes/execute.routes.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceSchema } from 'ces-shared/types/adminops-evidence';
import { makeAoCommand } from './fixtures.js';
import { loadUi } from './uiHarness.js';

const CMD = makeAoCommand({ id: 'GUARD-01', trigger: 'CONFIG', cmmcPractices: ['AC.L2-3.1.5'] });
const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'CES_AO_ALLOW_LIVE'] as const;
const saved: Record<string, string | undefined> = {};
let root: string;
let server: Server;
let base: string;

beforeEach(async () => {
  exec.calls = [];
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-apply-guard-'));
  process.env.CES_PIPELINE_ROOT = root;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.CES_AO_ALLOW_LIVE;
  const app = express();
  app.use(express.json());
  app.use('/api', createExecuteRouter([CMD]));
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeAllCesRepositories();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const post = (body: any) =>
  fetch(`${base}/api/execute/${CMD.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const rows = () =>
  getCesRepository().listAll<any>('adminops_evidence').filter((r: any) => r.data?.metadata?.commandId === CMD.id);

describe('W4-AO5: web apply guard on POST /api/execute/:commandId', () => {
  for (const [label, extra] of [
    ['no confirmApply', {}],
    ['confirmApply: true (must name the command)', { confirmApply: true }],
    ['confirmApply naming another command', { confirmApply: 'OTHER-01' }],
  ] as const) {
    it(`live apply with ${label} → 428, executor never called, refusal evidence persisted`, async () => {
      const res = await post({
        tenant: 'guard-sim', inputs: {}, dryRun: false,
        requestorUPN: 'op@guard.onmicrosoft.us', correlationId: 'guard-corr-1', ...extra,
      });
      const body: any = await res.json();
      expect(res.status).toBe(428);
      expect(body.success).toBe(false);
      expect(body.applyGuard).toBe('refused');
      expect(body.error).toMatch(/apply guard/i);
      expect(body.evidencePersisted).toBe(true);
      expect(exec.calls).toHaveLength(0);

      const persisted = rows();
      expect(persisted).toHaveLength(1);
      const m = AdminOpsEvidenceSchema.parse(persisted[0].data.metadata);
      expect(m.mode).toBe('live');
      expect(m.dryRun).toBe(false);
      expect(m.outcome).toBe('failed');
      expect(m.verdict).toBe('NOT_APPLICABLE');
      expect(m.correlationId).toBe('guard-corr-1');
      expect(m.requestorUPN).toBe('op@guard.onmicrosoft.us');
      expect(persisted[0].data.evidence.outcome).toBe('denied_apply_guard');
      expect(persisted[0].data.evidence.outcomeRationale).toMatch(/apply guard/i);
      expect(body.evidence?.outcome).toBe('denied_apply_guard');
    });
  }

  it('live apply with confirmApply = command id → executor runs live', async () => {
    const res = await post({ tenant: 'guard-sim', inputs: {}, dryRun: false, confirmApply: CMD.id });
    expect(res.status).toBe(200);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0][3]).toBe(false); // dryRun
    expect(rows()).toHaveLength(0); // no refusal row
  });

  it('dry run needs no confirmation', async () => {
    const res = await post({ tenant: 'guard-sim', inputs: {}, dryRun: true });
    expect(res.status).toBe(200);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0][3]).toBe(true);
  });

  it('omitted dryRun defaults to a dry run (no confirmation needed)', async () => {
    const res = await post({ tenant: 'guard-sim', inputs: {} });
    expect(res.status).toBe(200);
    expect(exec.calls[0][3]).toBe(true);
  });
});

describe('W4-AO5: the served UI sends the apply confirmation only from the Live Execution toggle', () => {
  const bridgedFetch = (url: string, init?: any) => fetch(`${base}${url}`, init) as any;

  for (const live of [true, false]) {
    it(`live toggle ${live ? 'on → confirmApply = command id, executor runs live' : 'off → dry run, no confirmApply'}`, async () => {
      const ui = loadUi(bridgedFetch);
      ui.run(`registry = [${JSON.stringify(CMD)}]`);
      ui.el('tenantSelect').value = 'guard-sim';
      ui.el('liveExecToggle').checked = live;
      await ui.run('executeCommand(registry[0])');

      const [call] = ui.calls.filter((c) => c.url.startsWith('/api/execute/'));
      expect(call.body.dryRun).toBe(!live);
      expect(call.body.confirmApply).toBe(live ? CMD.id : undefined);
      expect(exec.calls).toHaveLength(1);
      expect(exec.calls[0][3]).toBe(!live);
      expect(rows()).toHaveLength(0); // never refused
    });
  }
});
