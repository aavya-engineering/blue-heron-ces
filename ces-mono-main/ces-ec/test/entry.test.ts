// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The recorded start command for M4b's launcher: `npx tsx src/index.ts` with cwd = ces-ec.
// Spawns the real entrypoint against a sandbox (free port, temp pipeline + registry roots,
// temp home dir) and checks /api/health answers 2xx and the startup index pass ran.

import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeSandbox, registerTenant, seedStamper, type Sandbox } from './helpers.js';

const EC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const until = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v !== undefined) return v;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out: ${String(lastErr)}`);
}

let sb: Sandbox;
let child: ChildProcess | undefined;

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(async () => {
  if (child && child.exitCode === null) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  sb.restore();
});

describe('entrypoint: npx tsx src/index.ts', () => {
  it('starts, answers /api/health on EC_PORT, and runs the startup index pass', async () => {
    registerTenant(sb, 'ec-sim-a', 'sim');
    seedStamper(sb, 'ec-sim-a', { 'evidence/access_control/ac.l1-3.1.1.json': 'evidence-ac.json' });
    const port = await freePort();
    const env = {
      ...process.env,
      EC_PORT: String(port),
      CES_PIPELINE_ROOT: sb.pipelineRoot,
      CES_TENANT_ROOT: sb.registryRoot,
      HOME: sb.homeDir,
      USERPROFILE: sb.homeDir,
    };
    child = spawn('npx', ['tsx', 'src/index.ts'], { cwd: EC_ROOT, env, shell: true, stdio: 'pipe' });
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));

    const health = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      return r.ok ? r.json() : undefined;
    }, 30_000);
    expect(health).toMatchObject({ status: 'ok', mode: 'sim' });

    const runs = await waitFor(async () => {
      const r = await (await fetch(`http://127.0.0.1:${port}/api/runs?tenant=ec-sim-a`)).json();
      return Array.isArray(r) && r.length > 0 ? r : undefined;
    }, 15_000);
    expect(runs[0]).toMatchObject({ runType: 'index', status: 'success', artifactsWritten: 1 });
    expect(out).toContain(`listening on http://127.0.0.1:${port}`);
  }, 60_000);
});
