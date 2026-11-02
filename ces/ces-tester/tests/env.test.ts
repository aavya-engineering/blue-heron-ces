// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { mergeSimLaunchEnv } from '../src/stamper-launcher/env.js';
import type { SimLaunchEnv } from 'ces-tenant';

const simLaunchEnv: SimLaunchEnv = {
  psModulePath: 'C:/tenant-stacksim/psmodules;C:/Windows/System32/WindowsPowerShell/v1.0/Modules',
  path: 'C:/tenant-stacksim/azshim;C:/existing/path',
  stacksimServerUrl: 'http://127.0.0.1:4390',
};

describe('mergeSimLaunchEnv', () => {
  it('sets PSModulePath/Path/STACKSIM_SERVER_URL from the launch-context bundle', () => {
    const env = mergeSimLaunchEnv({ simLaunchEnv, baseEnv: {} });
    expect(env.PSModulePath).toBe(simLaunchEnv.psModulePath);
    expect(env.Path).toBe(simLaunchEnv.path);
    expect(env.STACKSIM_SERVER_URL).toBe(simLaunchEnv.stacksimServerUrl);
  });

  it('preserves unrelated base env keys', () => {
    const env = mergeSimLaunchEnv({ simLaunchEnv, baseEnv: { HOME: '/home/user', FOO: 'bar' } });
    expect(env.HOME).toBe('/home/user');
    expect(env.FOO).toBe('bar');
  });

  it('overwrites a differently-cased existing PSModulePath/Path key (case-insensitive dedup)', () => {
    const env = mergeSimLaunchEnv({
      simLaunchEnv,
      baseEnv: { psmodulepath: 'C:/old/modules', PATH: 'C:/old/path' },
    });
    // Only the canonical-cased key should remain, set to the launch-context value.
    expect(env.PSModulePath).toBe(simLaunchEnv.psModulePath);
    expect(env.Path).toBe(simLaunchEnv.path);
    expect(env.psmodulepath).toBeUndefined();
    expect(env.PATH).toBeUndefined();
  });

  it('defaults to a copy of process.env when baseEnv is omitted (does not mutate process.env)', () => {
    const originalPath = process.env.PATH;
    const env = mergeSimLaunchEnv({ simLaunchEnv });
    expect(env).not.toBe(process.env);
    expect(process.env.PATH).toBe(originalPath);
  });
});
