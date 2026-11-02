// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { buildShadowedEnv } from './psHarness.js';

/**
 * G-STACKSIM-2 iteration 4 - unit coverage for buildShadowedEnv's PATH
 * prepend (azShimDir). Pure-function test, no process spawning - the
 * spawning-heavy adversarial probe lives in
 * tests/protocol/azshim.spike.test.ts (mirrors M2's spike-test split of
 * "cheap logic unit test" vs "expensive real-process proof").
 */
describe('buildShadowedEnv (G-STACKSIM-2 iteration 4: az CLI PATH prepend)', () => {
  it('prepends azShimDir onto PATH when supplied, leaving the rest of PATH intact', () => {
    const base = { Path: 'C:\\Windows;C:\\Windows\\System32' };
    const env = buildShadowedEnv(base, 'C:\\sim\\psmodules', 'C:\\PSHome\\Modules', 'C:\\sim\\azshim');
    expect(env.Path).toBe('C:\\sim\\azshim;C:\\Windows;C:\\Windows\\System32');
  });

  it('is a no-op on PATH when azShimDir is omitted (M2-iteration-3 call sites unaffected)', () => {
    const base = { Path: 'C:\\Windows' };
    const env = buildShadowedEnv(base, 'C:\\sim\\psmodules', 'C:\\PSHome\\Modules');
    expect(env.Path).toBe('C:\\Windows');
  });

  it('dedupes a case-variant PATH key (e.g. uppercase "PATH") before prepending, same discipline as the PSModulePath fix', () => {
    const base = { PATH: 'C:\\Windows', Path: undefined };
    const env = buildShadowedEnv(base, 'C:\\sim\\psmodules', 'C:\\PSHome\\Modules', 'C:\\sim\\azshim');
    const pathKeys = Object.keys(env).filter((k) => k.toLowerCase() === 'path');
    expect(pathKeys).toEqual(['Path']);
    expect(env.Path).toBe('C:\\sim\\azshim;C:\\Windows');
  });

  it('still applies the PSModulePath shadow exactly as before, independent of the PATH prepend', () => {
    const base = { PSModulePath: 'C:\\real\\modules', Path: 'C:\\Windows' };
    const env = buildShadowedEnv(base, 'C:\\sim\\psmodules', 'C:\\PSHome\\Modules', 'C:\\sim\\azshim');
    expect(env.PSModulePath).toBe('C:\\sim\\psmodules;C:\\PSHome\\Modules');
  });
});
