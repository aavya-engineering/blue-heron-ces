// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-SH step 4 (REQ-ces-shared-ec-launcher, ces-ec plan M4b, 2026-09-28).
// Ground rule 1 (sim only): every test injects spawnFn/healthCheckFn/sleepFn — nothing here ever
// spawns a real process or reaches the network, except the two backward-compat smoke tests, which
// hit an unused localhost port (fails fast, ECONNREFUSED, no external reach).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureEcRunning, type SpawnFn } from './EcLauncher.js';

function fakeChild() {
  return { unref: vi.fn() } as any;
}

describe('ensureEcRunning — command/cwd defaults (REQ ask 1)', () => {
  it('default command is npx tsx src/index.ts', async () => {
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(fakeChild());
    const healthCheckFn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await ensureEcRunning({
      env: { CES_EC_AUTOSTART: '1' }, spawnFn, healthCheckFn, sleepFn, maxRetries: 2,
    });
    expect(spawnFn).toHaveBeenCalledWith('npx', ['tsx', 'src/index.ts'], expect.objectContaining({ cwd: expect.any(String) }));
  });

  it('cwd precedence: opts.cwd wins over env.CES_EC_CWD wins over the ../ces-ec default', async () => {
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(fakeChild());
    const healthCheckFn = vi.fn().mockResolvedValue(false);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await ensureEcRunning({ cwd: '/explicit/ec', env: { CES_EC_AUTOSTART: '1', CES_EC_CWD: '/env/ec' }, spawnFn, healthCheckFn, sleepFn, maxRetries: 1 });
    expect(spawnFn).toHaveBeenLastCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: '/explicit/ec' }));

    await ensureEcRunning({ env: { CES_EC_AUTOSTART: '1', CES_EC_CWD: '/env/ec' }, spawnFn, healthCheckFn, sleepFn, maxRetries: 1 });
    expect(spawnFn).toHaveBeenLastCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: '/env/ec' }));

    await ensureEcRunning({ env: { CES_EC_AUTOSTART: '1' }, spawnFn, healthCheckFn, sleepFn, maxRetries: 1 });
    expect(spawnFn).toHaveBeenLastCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: expect.stringMatching(/[\\/]\.\.[\\/]ces-ec$/) }));
  });

  it('command and args are overridable', async () => {
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(fakeChild());
    const healthCheckFn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await ensureEcRunning({
      command: 'node', args: ['dist/index.js'], env: { CES_EC_AUTOSTART: '1' }, spawnFn, healthCheckFn, sleepFn, maxRetries: 2,
    });
    expect(spawnFn).toHaveBeenCalledWith('node', ['dist/index.js'], expect.anything());
  });
});

describe('ensureEcRunning — health / spawn lifecycle', () => {
  it('healthy: returns already_running, never spawns', async () => {
    const spawnFn = vi.fn<SpawnFn>();
    const healthCheckFn = vi.fn().mockResolvedValue(true);
    const result = await ensureEcRunning({ env: { CES_EC_AUTOSTART: '1' }, spawnFn, healthCheckFn, sleepFn: vi.fn() });
    expect(result).toBe('already_running');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('unhealthy then healthy after spawn: returns started', async () => {
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(fakeChild());
    const healthCheckFn = vi.fn()
      .mockResolvedValueOnce(false) // initial check
      .mockResolvedValueOnce(false) // retry 1
      .mockResolvedValueOnce(true); // retry 2
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await ensureEcRunning({ env: { CES_EC_AUTOSTART: '1' }, spawnFn, healthCheckFn, sleepFn, maxRetries: 5 });
    expect(result).toBe('started');
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('never becomes healthy: returns failed after maxRetries, still spawned once', async () => {
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(fakeChild());
    const healthCheckFn = vi.fn().mockResolvedValue(false);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await ensureEcRunning({ env: { CES_EC_AUTOSTART: '1' }, spawnFn, healthCheckFn, sleepFn, maxRetries: 3 });
    expect(result).toBe('failed');
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledTimes(3);
  });

  it('autostart disabled (CES_EC_AUTOSTART unset): unhealthy EC is left alone, spawn never called', async () => {
    const spawnFn = vi.fn<SpawnFn>();
    const healthCheckFn = vi.fn().mockResolvedValue(false);
    const result = await ensureEcRunning({ env: {}, spawnFn, healthCheckFn, sleepFn: vi.fn() });
    expect(result).toBe('autostart_disabled');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('autostart disabled when CES_EC_AUTOSTART is any value other than the string "1"', async () => {
    const spawnFn = vi.fn<SpawnFn>();
    const healthCheckFn = vi.fn().mockResolvedValue(false);
    const result = await ensureEcRunning({ env: { CES_EC_AUTOSTART: 'true' }, spawnFn, healthCheckFn, sleepFn: vi.fn() });
    expect(result).toBe('autostart_disabled');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('spawn env merges the caller-supplied env onto process.env (does not replace it — PATH survives)', async () => {
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(fakeChild());
    const healthCheckFn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const previousPath = process.env.PATH;
    process.env.PATH = '/inherited/bin';
    try {
      await ensureEcRunning({
        env: { CES_EC_AUTOSTART: '1' }, spawnFn, healthCheckFn, sleepFn: vi.fn().mockResolvedValue(undefined), maxRetries: 2,
      });
      const spawnedEnv = spawnFn.mock.calls[0]![2].env as Record<string, string | undefined>;
      expect(spawnedEnv.CES_EC_AUTOSTART).toBe('1');
      expect(spawnedEnv.PATH).toBe('/inherited/bin');
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('the spawned child is detached and unref()d so it outlives the caller', async () => {
    const child = fakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const healthCheckFn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await ensureEcRunning({ env: { CES_EC_AUTOSTART: '1' }, spawnFn, healthCheckFn, sleepFn: vi.fn().mockResolvedValue(undefined), maxRetries: 2 });
    expect(spawnFn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ detached: true, stdio: 'ignore' }));
    expect(child.unref).toHaveBeenCalled();
  });
});

describe('ensureEcRunning — backward compatibility (legacy positional signature)', () => {
  // Ground rule 1 (sim only): force CES_EC_AUTOSTART off for these two, regardless of the
  // developer's real shell environment — the legacy positional signature has no way to inject
  // spawnFn, so if autostart were left on and EC were not already running, this would actually
  // spawn `npx tsx src/index.ts` in ../ces-ec.
  const previousAutostart = process.env.CES_EC_AUTOSTART;
  beforeEach(() => { delete process.env.CES_EC_AUTOSTART; });
  afterEach(() => {
    if (previousAutostart === undefined) delete process.env.CES_EC_AUTOSTART;
    else process.env.CES_EC_AUTOSTART = previousAutostart;
  });

  it('ensureEcRunning(ecUrl, ecCwd) still resolves without throwing (autostart forced off)', async () => {
    const result = await ensureEcRunning('http://127.0.0.1:59999', '/some/cwd');
    expect(['autostart_disabled', 'already_running']).toContain(result);
  });

  it('ensureEcRunning() with no arguments still resolves (autostart forced off)', async () => {
    const result = await ensureEcRunning();
    expect(['autostart_disabled', 'already_running']).toContain(result);
  });
});
