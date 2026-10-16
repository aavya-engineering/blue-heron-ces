// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * StacksimEnvironment -- acceptance gate 3: enableStacksimMode()'s SUCCESS
 * path (env mutation) runs against an injected queryPsHomeModules seam, no
 * live powershell.exe. Also covers the launch-context data surface and its
 * live-tenant refusal (launch-context.ts contract).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StacksimEnvironment, DEFAULT_STACKSIM_SERVER_URL } from '../impl/stacksim.js';
import { InProcessTenantStatus } from '../impl/status.js';
import type { TenantRegistryLifecycle, TenantRegistryRecord } from '../registry.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** Temp stacksim root with the module-tree marker `resolveStacksimDirs()` checks. */
function makeStacksimRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-tenant-sim-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, 'psmodules', 'Microsoft.Graph.Authentication'), { recursive: true });
  fs.mkdirSync(path.join(root, 'azshim'), { recursive: true });
  return root;
}

const FAKE_PSHOME_MODULES = path.join('C:', 'FakePS', 'Modules');
const okFetch = (() => Promise.resolve({ ok: true } as Response)) as typeof fetch;
const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

function makeEnvController(env: NodeJS.ProcessEnv, overrides: Partial<ConstructorParameters<typeof StacksimEnvironment>[0]> = {}) {
  const stacksimRoot = makeStacksimRoot();
  const queryPsHomeModules = vi.fn(() => Promise.resolve(FAKE_PSHOME_MODULES));
  const controller = new StacksimEnvironment({
    stacksimRoot,
    env,
    queryPsHomeModules,
    fetchFn: okFetch,
    logger: quietLogger,
    ...overrides,
  });
  return { controller, stacksimRoot, queryPsHomeModules };
}

describe('StacksimEnvironment.enableStacksimMode -- mocked success path (gate 3)', () => {
  it('mutates the env exactly as StacksimMode.ts:118-125 does, via the injected $PSHOME seam', async () => {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows;C:\\Tools' };
    const { controller, stacksimRoot, queryPsHomeModules } = makeEnvController(env);

    await controller.enableStacksimMode();

    expect(queryPsHomeModules).toHaveBeenCalledTimes(1);
    expect(env.PSModulePath).toBe(`${path.join(stacksimRoot, 'psmodules')};${FAKE_PSHOME_MODULES}`);
    expect(env.Path).toBe(`${path.join(stacksimRoot, 'azshim')};C:\\Windows;C:\\Tools`);
    expect(env.STACKSIM_SERVER_URL).toBe(DEFAULT_STACKSIM_SERVER_URL);
  });

  it('dedups inconsistently-cased PATH/PSModulePath keys (the buildShadowedEnv parity behavior)', async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: 'C:\\OldPath',
      PSMODULEPATH: 'C:\\OldModules',
    };
    const { controller, stacksimRoot } = makeEnvController(env);

    await controller.enableStacksimMode();

    // Old-cased keys are deleted; the canonical keys carry the new values.
    expect(env.PATH).toBeUndefined();
    expect(env.PSMODULEPATH).toBeUndefined();
    expect(env.Path).toBe(`${path.join(stacksimRoot, 'azshim')};C:\\OldPath`);
    expect(env.PSModulePath).toBe(`${path.join(stacksimRoot, 'psmodules')};${FAKE_PSHOME_MODULES}`);
  });

  it('honors the serverUrl precedence: explicit arg, then env, then default', async () => {
    const env1: NodeJS.ProcessEnv = {};
    const c1 = makeEnvController(env1);
    await c1.controller.enableStacksimMode('http://127.0.0.1:9999');
    expect(env1.STACKSIM_SERVER_URL).toBe('http://127.0.0.1:9999');

    const env2: NodeJS.ProcessEnv = { STACKSIM_SERVER_URL: 'http://127.0.0.1:8888' };
    const c2 = makeEnvController(env2);
    await c2.controller.enableStacksimMode();
    expect(env2.STACKSIM_SERVER_URL).toBe('http://127.0.0.1:8888');
  });

  it('throws the module-tree guard error when the fake module tree is missing', async () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-tenant-empty-'));
    tempDirs.push(emptyRoot);
    const controller = new StacksimEnvironment({
      stacksimRoot: emptyRoot,
      env: {},
      queryPsHomeModules: () => Promise.resolve(FAKE_PSHOME_MODULES),
      fetchFn: okFetch,
      logger: quietLogger,
    });
    await expect(controller.enableStacksimMode()).rejects.toThrow(/fake module tree not found/);
  });

  it('warns but does not fail when the sim server is unreachable (warnIfSimUnreachable parity)', async () => {
    const env: NodeJS.ProcessEnv = {};
    const warn = vi.fn();
    const { controller } = makeEnvController(env, {
      fetchFn: (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch,
      logger: { log: () => {}, warn, error: () => {} },
    });
    await expect(controller.enableStacksimMode()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no sim server responding'));
  });
});

describe('StacksimEnvironment.getSimLaunchEnv -- launch-context data surface', () => {
  it('returns the bundle as data WITHOUT mutating the source env', async () => {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows', STACKSIM_SERVER_URL: 'http://127.0.0.1:7777' };
    const before = { ...env };
    const { controller, stacksimRoot } = makeEnvController(env);

    const bundle = await controller.getSimLaunchEnv('eph1', 'sim');

    expect(bundle.psModulePath).toBe(`${path.join(stacksimRoot, 'psmodules')};${FAKE_PSHOME_MODULES}`);
    expect(bundle.path).toBe(`${path.join(stacksimRoot, 'azshim')};C:\\Windows`);
    expect(bundle.stacksimServerUrl).toBe('http://127.0.0.1:7777');
    expect(env).toEqual(before); // data, not mutation
  });

  it('refuses a kind: live request outright', async () => {
    const { controller } = makeEnvController({});
    await expect(controller.getSimLaunchEnv('prod', 'live')).rejects.toThrow(/not "sim"/);
  });

  it('verifies against the registry when one is provided', async () => {
    const records: Record<string, TenantRegistryRecord | undefined> = {
      simslug: { tenantSlug: 'simslug', kind: 'sim' } as TenantRegistryRecord,
      liveslug: { tenantSlug: 'liveslug', kind: 'live' } as TenantRegistryRecord,
    };
    const registry: TenantRegistryLifecycle = {
      get: async (slug) => records[slug],
      listByKind: async () => [],
      createEphemeralSimTenant: async () => records.simslug!,
      teardownEphemeralSimTenant: async () => {},
    };
    const { controller } = makeEnvController({}, { registry });

    await expect(controller.getSimLaunchEnv('simslug', 'sim')).resolves.toBeDefined();
    await expect(controller.getSimLaunchEnv('liveslug', 'sim')).rejects.toThrow(/kind "live"/);
    await expect(controller.getSimLaunchEnv('missing', 'sim')).rejects.toThrow(/not found/);
  });
});

describe('StacksimEnvironment.getSimLaunchEnv -- caller identity + activity (ratified amendment 2026-07-10)', () => {
  it('records a per-request activity entry attributed to the consumer module', async () => {
    const status = new InProcessTenantStatus();
    const { controller } = makeEnvController({}, { activity: status, consumer: { module: 'ces-tester', purpose: 'stamper launch' } });

    await controller.getSimLaunchEnv('sim1', 'sim');

    const entries = await status.getActivity({ module: 'ces-tester' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      operation: 'getSimLaunchEnv',
      tenantSlug: 'sim1',
      outcome: 'ok',
      consumer: { module: 'ces-tester', purpose: 'stamper launch' },
    });
  });

  it('a request without any consumer is LOGGED in library mode and recorded with consumer: null; a refusal records outcome: error', async () => {
    const status = new InProcessTenantStatus();
    const warn = vi.fn();
    const { controller } = makeEnvController({}, { activity: status, logger: { log: () => {}, warn, error: () => {} } });

    await controller.getSimLaunchEnv('sim1', 'sim');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without consumer identity'));

    await expect(
      controller.getSimLaunchEnv('prod', 'live', { module: 'ces-tester', purpose: 'must be refused' }),
    ).rejects.toThrow(/not "sim"/);

    const entries = await status.getActivity();
    expect(entries).toHaveLength(2);
    expect(entries[0].consumer).toBeNull();
    expect(entries[0].outcome).toBe('ok');
    expect(entries[1].consumer).toEqual({ module: 'ces-tester', purpose: 'must be refused' });
    expect(entries[1].outcome).toBe('error');
    expect(entries[1].detail).toContain('not "sim"');
  });
});
