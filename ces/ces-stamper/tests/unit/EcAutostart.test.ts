// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-ST-3 step 1 (EC milestone M4b, ST-16; REQ-ces-stamper-ec-autostart /
// REQ-ces-stamper-ec-launcher-adoption): checkEcAutostart() with spawn/health-check/sleep all
// faked — no real process spawn, no real HTTP call, no live tenant or non-localhost endpoint.
// One test per EnsureEcRunningResult state.
import { jest } from '@jest/globals';
import { checkEcAutostart } from '../../src/server/ecAutostart';

describe('checkEcAutostart (GuiServer\'s EC auto-start check, extracted for testing)', () => {
  it('already_running: health check succeeds immediately — never spawns', async () => {
    const spawnFn = jest.fn();
    const healthCheckFn = jest.fn(async () => true);
    const result = await checkEcAutostart({
      env: { CES_EC_AUTOSTART: '1' },
      spawnFn: spawnFn as any,
      healthCheckFn,
      sleepFn: async () => {},
    });
    expect(result).toBe('already_running');
    expect(spawnFn).not.toHaveBeenCalled();
    expect(healthCheckFn).toHaveBeenCalledTimes(1);
  });

  it('autostart_disabled: unhealthy and CES_EC_AUTOSTART is not set — never spawns', async () => {
    const spawnFn = jest.fn();
    const result = await checkEcAutostart({
      env: {},
      spawnFn: spawnFn as any,
      healthCheckFn: async () => false,
      sleepFn: async () => {},
    });
    expect(result).toBe('autostart_disabled');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('started: unhealthy, CES_EC_AUTOSTART=1 — spawns and becomes healthy on a later check', async () => {
    const spawnCalls: { command: string; args: string[]; options: any }[] = [];
    const fakeChild = { unref: () => {} };
    const spawnFn = jest.fn((command: string, args: string[], options: any) => {
      spawnCalls.push({ command, args, options });
      return fakeChild as any;
    });
    let healthCheckCalls = 0;
    const healthCheckFn = jest.fn(async () => {
      healthCheckCalls++;
      return healthCheckCalls >= 2; // unhealthy first (pre-spawn), healthy on first post-spawn poll
    });
    const result = await checkEcAutostart({
      env: { CES_EC_AUTOSTART: '1' },
      spawnFn: spawnFn as any,
      healthCheckFn,
      sleepFn: async () => {},
    });
    expect(result).toBe('started');
    expect(spawnFn).toHaveBeenCalledTimes(1);
    // Real ces-ec entry point (REQ-ces-stamper-ec-launcher-adoption) — not the never-existed
    // src/ec/index.ts, and not run from the wrong `../eo` cwd.
    expect(spawnCalls[0].command).toBe('npx');
    expect(spawnCalls[0].args).toEqual(['tsx', 'src/index.ts']);
    expect(spawnCalls[0].options.cwd).not.toContain('/eo');
    expect(spawnCalls[0].options.cwd).not.toMatch(/[\\/]eo$/);
  });

  it('failed: unhealthy, CES_EC_AUTOSTART=1, spawns but never becomes healthy — never throws, returns failed', async () => {
    const spawnFn = jest.fn(() => ({ unref: () => {} } as any));
    const result = await checkEcAutostart({
      env: { CES_EC_AUTOSTART: '1' },
      spawnFn: spawnFn as any,
      healthCheckFn: async () => false,
      sleepFn: async () => {},
    });
    expect(result).toBe('failed');
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('honors CES_EC_CWD when set, instead of the default ../ces-ec', async () => {
    const spawnCalls: any[] = [];
    const spawnFn = jest.fn((command: string, args: string[], options: any) => {
      spawnCalls.push(options);
      return { unref: () => {} } as any;
    });
    let calls = 0;
    await checkEcAutostart({
      env: { CES_EC_AUTOSTART: '1', CES_EC_CWD: '/custom/ec/root' },
      spawnFn: spawnFn as any,
      healthCheckFn: async () => { calls++; return calls >= 2; },
      sleepFn: async () => {},
    });
    expect(spawnCalls[0].cwd).toBe('/custom/ec/root');
  });
});
