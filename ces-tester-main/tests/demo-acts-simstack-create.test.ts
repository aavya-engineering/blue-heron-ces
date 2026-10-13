// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 2A — the `simstack-create` judge (D.1) against injected seams.
 *
 * The three facts are read from the tool's own surfaces: a throwaway sim server
 * answering the two endpoints, and a real registry record on disk (the record
 * file IS the artifact SC2 judges).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runActGroup, type ActRunArgs, type ActRunDeps } from '../src/demo/acts/act-run.js';
import { actGroup } from '../src/demo/acts/act-roster.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { ArmedSim } from '../src/demo/show/arm-sim.js';
import type { UiPage, UiSession } from '../src/demo/ui-page.js';
import {
  SIMSTACK_GAP_STATE,
  simstackRegistryRoot,
} from '../src/demo/show/ops/simstack-create-op.js';
import { simRecordPath } from '../src/demo/sim-tenant-record.js';

const testerRoot = path.resolve(__dirname, '..');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acts-sc-'));
}
function fakePane(): AppPane {
  const page = new Proxy({} as UiPage, { get: () => async () => undefined });
  const session = new Proxy({} as UiSession, { get: () => async () => undefined });
  return { page, session, goto: async () => undefined, close: async () => undefined };
}
function argsFor(runDir: string): ActRunArgs {
  return {
    testerRoot,
    stacksimRoot: path.join(testerRoot, '..', 'tenant-stacksim'),
    aoRoot: path.join(testerRoot, '..', 'ces-ao'),
    eoRoot: path.join(testerRoot, '..', 'ces-eo'),
    stamperRoot: path.join(testerRoot, '..', 'ces-stamper'),
    musterRoot: path.join(testerRoot, '..', 'ces-muster'),
    runId: path.basename(runDir),
  };
}
function fakeArm(runDir: string, simUrl: string): ActRunDeps['arm'] {
  return async (): Promise<ArmedSim> => ({
    slug: 'demo-dib-small',
    simUrl,
    runDir,
    stop: async () => undefined,
  });
}

/** A throwaway sim answering the two endpoints simstack-create reads. */
async function fakeSim(gapState: string | null): Promise<{ url: string; close: () => Promise<void> }> {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    if (req.url?.includes('/policies/authorizationPolicy')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'authorizationPolicy' }));
      return;
    }
    if (req.url?.includes('/conditionalAccess/policies/caPolicy-1')) {
      if (gapState === null) {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'caPolicy-1', state: gapState }));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function writeRecord(runDir: string, slug: string, opts: { placeholder?: boolean; relative?: boolean } = {}): void {
  const recordPath = simRecordPath(simstackRegistryRoot(runDir), slug);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(
    recordPath,
    JSON.stringify({
      tenant: { tenant_id: `sim-tenant-${slug}` },
      auth: {
        app_id: `sim-app-${slug}`,
        cert_thumbprint: opts.placeholder ? 'SIMTHUMBPRINT000000000000000000000000' : 'ABC123DEF456',
        cert_path: opts.relative ? `sim/${slug}.pfx` : path.join(runDir, `${slug}.pfx`),
      },
    }),
  );
}

function depsFor(runDir: string, simUrl: string): ActRunDeps {
  return {
    openPane: async () => fakePane(),
    arm: fakeArm(runDir, simUrl),
    probe: async () => 'free',
    fileExists: (p) => fs.existsSync(p),
  };
}

describe('runActGroup — simstack-create (D.1)', () => {
  it('passes SC1/SC2/SC3 when the sim answers, the record is valid, and the gap is report-only', async () => {
    const runDir = tempDir();
    writeRecord(runDir, 'demo-dib-small');
    const sim = await fakeSim(SIMSTACK_GAP_STATE);
    const report = await runActGroup(actGroup('simstack-create')!, argsFor(runDir), () => undefined, depsFor(runDir, sim.url));
    await sim.close();
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    for (const id of ['SC1', 'SC2', 'SC3', 'ARM1', 'TD1']) {
      expect(byId[id]?.status, `${id}: ${byId[id]?.detail}`).toBe('pass');
    }
    expect(byId.SC3.evidence).toMatchObject({ policy: 'caPolicy-1', state: SIMSTACK_GAP_STATE });
    expect(report.status).toBe('pass');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('SC3 reds when the gap policy is NOT report-only (the gap is missing)', async () => {
    const runDir = tempDir();
    writeRecord(runDir, 'demo-dib-small');
    const sim = await fakeSim('enabled'); // enforced, not report-only
    const report = await runActGroup(actGroup('simstack-create')!, argsFor(runDir), () => undefined, depsFor(runDir, sim.url));
    await sim.close();
    expect(report.checks.find((c) => c.id === 'SC3')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('SC2 reds when the record still carries the SIMTHUMBPRINT placeholder', async () => {
    const runDir = tempDir();
    writeRecord(runDir, 'demo-dib-small', { placeholder: true });
    const sim = await fakeSim(SIMSTACK_GAP_STATE);
    const report = await runActGroup(actGroup('simstack-create')!, argsFor(runDir), () => undefined, depsFor(runDir, sim.url));
    await sim.close();
    expect(report.checks.find((c) => c.id === 'SC2')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('SC2 reds when cert_path is relative, not absolute', async () => {
    const runDir = tempDir();
    writeRecord(runDir, 'demo-dib-small', { relative: true });
    const sim = await fakeSim(SIMSTACK_GAP_STATE);
    const report = await runActGroup(actGroup('simstack-create')!, argsFor(runDir), () => undefined, depsFor(runDir, sim.url));
    await sim.close();
    expect(report.checks.find((c) => c.id === 'SC2')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
