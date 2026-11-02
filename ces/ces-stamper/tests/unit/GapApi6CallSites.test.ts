// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Gap closure API-6: GET /api/execute and the CLI's `execute` and `resume` all call
// executeForTenant(), with equivalent arguments for equivalent inputs. executeForTenant is
// replaced by a recorder that stops each caller right after the call (the route answers an
// SSE error, the CLI exits 1, both stubbed), so nothing runs.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import http from 'http';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PLAN_SRC = path.join(ROOT, 'tests', 'fixtures', 'synthetic-mission-plan.executable.json');

const calls: any[] = [];
const STOP = 'API-6 test stop';
const mockExecuteForTenant = jest.fn(async (input: any) => {
  calls.push(input);
  throw new Error(STOP);
});
const mockModule = () => jest.unstable_mockModule('../../src/core/executeForTenant', () => ({
  executeForTenant: mockExecuteForTenant,
}));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-api6-'));
const planPath = path.join(tmp, 'plan.json');

/** The arguments that must agree between the two paths for the same plan, tenant and dry run. */
function projection(input: any) {
  return {
    planPath: input.planPath,
    tenantSlug: input.tenantSlug,
    hasExecutionContext: input.executionContext !== undefined,
    forceFail: input.forceFail ?? [],
    hasEngine: typeof input.engine?.loadPlan === 'function',
    hasSessionManager: input.session?.kind === 'persistent' && input.session.sessionManager !== undefined,
  };
}

async function runRoute(query: string): Promise<any> {
  const before = calls.length;
  jest.resetModules();
  mockModule();
  const { createExecuteRouter } = await import('../../src/server/routes/execute.routes');
  const app = express();
  app.use(createExecuteRouter(new Map(), () => false, () => undefined));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as { port: number }).port;
  const body = await new Promise<string>((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/api/execute?${query}`, (res) => {
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', (c: string) => { buf += c; });
      res.on('end', () => resolve(buf));
    }).on('error', reject);
  });
  await new Promise<void>((r) => server.close(() => r()));
  expect(body).toContain(STOP);
  expect(calls.length).toBe(before + 1);
  return calls[calls.length - 1];
}

async function runCli(args: string[]): Promise<any> {
  const before = calls.length;
  const savedArgv = process.argv;
  const savedDryRun = process.env.DRY_RUN;
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    process.argv = ['node', 'stamper', ...args];
    jest.resetModules();
    mockModule();
    await import('../../src/cli/index');
    for (let i = 0; i < 200 && exitSpy.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes(STOP))).toBe(true);
  } finally {
    process.argv = savedArgv;
    if (savedDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = savedDryRun;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
  expect(calls.length).toBe(before + 1);
  return calls[calls.length - 1];
}

beforeAll(() => {
  // No tenant in the plan, so a run without --tenant is "dev" on both paths.
  const plan = JSON.parse(fs.readFileSync(PLAN_SRC, 'utf-8'));
  delete plan.ces;
  if (plan.variables) delete plan.variables.tenant_slug;
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  delete process.env.TENANT_SLUG;
  delete process.env.CES_MUSTER_API_URL;
  delete process.env.CES_MUSTER_SECRETS_URL;
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('API-6: route and CLI call executeForTenant with equivalent arguments', () => {
  const cases: Array<{ name: string; tenant?: string }> = [
    { name: 'dry run, no tenant (dev)' },
    { name: 'dry run, tenant slug', tenant: 'api6-acme' },
  ];

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const tenantQuery = c.tenant ? `&tenant=${c.tenant}` : '';
    const tenantArgs = c.tenant ? ['--tenant', c.tenant] : [];
    const gui = await runRoute(`plan=${encodeURIComponent(planPath)}&dryRun=true${tenantQuery}`);
    const cliExecute = await runCli(['execute', planPath, '--dry-run', ...tenantArgs]);
    const cliResume = await runCli(['resume', planPath, '--dry-run', ...tenantArgs]);

    const expected = {
      planPath,
      tenantSlug: c.tenant,
      hasExecutionContext: false,
      forceFail: [],
      hasEngine: true,
      hasSessionManager: false,
    };
    expect(projection(gui)).toEqual(expected);
    expect(projection(cliExecute)).toEqual(expected);
    expect(projection(cliResume)).toEqual(expected);

    // The explicit per-path options.
    expect(gui).toMatchObject({ mode: 'gui', session: { kind: 'persistent' }, primeMusterSecrets: false, restoreTenantVariables: true });
    for (const cli of [cliExecute, cliResume]) {
      expect(cli).toMatchObject({ mode: 'cli', session: { kind: 'per-command' }, primeMusterSecrets: true, restoreTenantVariables: false });
      expect(cli.evidenceStorage).toBeUndefined();
      expect(cli.loadLog).toBeUndefined();
    }
  });

  it('CLI --force-fail reaches executeForTenant (on a simulator-acknowledged run)', async () => {
    const cli = await runCli(['execute', planPath, '--dry-run', '--force-fail', 'entry-x', '--i-know-this-is-a-test']);
    expect(cli.forceFail).toEqual(['entry-x']);
  });
});
