// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { assertCaPolicyEnabled, assertCaPolicyHasMfaGrantControl, extractCollection } from '../src/cli/assertion.js';

describe('extractCollection', () => {
  it('returns a bare array unchanged', () => {
    const data = [{ id: 'caPolicy-1' }];
    expect(extractCollection(data)).toEqual(data);
  });

  it('unwraps a Graph-style {value: [...]} envelope', () => {
    const data = { value: [{ id: 'caPolicy-1' }] };
    expect(extractCollection(data)).toEqual([{ id: 'caPolicy-1' }]);
  });

  it('returns [] for null/undefined/unrecognized shapes', () => {
    expect(extractCollection(null)).toEqual([]);
    expect(extractCollection(undefined)).toEqual([]);
    expect(extractCollection({ foo: 'bar' })).toEqual([]);
  });
});

describe('assertCaPolicyEnabled', () => {
  it('PASSes when the policy exists with state enabled', () => {
    const result = assertCaPolicyEnabled([{ id: 'caPolicy-1', state: 'enabled' }], 'caPolicy-1');
    expect(result.pass).toBe(true);
  });

  it('FAILs (not throws) when the policy exists but is disabled', () => {
    const result = assertCaPolicyEnabled([{ id: 'caPolicy-1', state: 'disabled' }], 'caPolicy-1');
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('disabled');
  });

  it('FAILs (not throws) when the policy id is absent entirely', () => {
    const result = assertCaPolicyEnabled([{ id: 'caPolicy-2', state: 'enabled' }], 'caPolicy-1');
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('no policy');
  });
});

describe('assertCaPolicyHasMfaGrantControl', () => {
  it('PASSes when enabled with an mfa grant control', () => {
    const result = assertCaPolicyHasMfaGrantControl(
      [{ id: 'caPolicy-1', state: 'enabled', grantControls: { operator: 'OR', builtInControls: ['mfa'] } }],
      'caPolicy-1',
    );
    expect(result.pass).toBe(true);
  });

  it('FAILs (not throws) on a default-seeded policy with no grantControls at all', () => {
    // tenant-stacksim's default seed (src/seed/generators/caPolicies.ts) seeds
    // every CA policy as state:'enabled' with NO grantControls field — this
    // is exactly the clean-tenant starting state the M2 scenario must NOT
    // trivially satisfy.
    const result = assertCaPolicyHasMfaGrantControl([{ id: 'caPolicy-1', state: 'enabled' }], 'caPolicy-1');
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('no MFA grant control');
  });

  it('FAILs (not throws) when grantControls exists but does not include mfa', () => {
    const result = assertCaPolicyHasMfaGrantControl(
      [{ id: 'caPolicy-1', state: 'enabled', grantControls: { operator: 'OR', builtInControls: ['compliantDevice'] } }],
      'caPolicy-1',
    );
    expect(result.pass).toBe(false);
  });

  it('FAILs (not throws) when the policy is disabled even with an mfa grant control', () => {
    const result = assertCaPolicyHasMfaGrantControl(
      [{ id: 'caPolicy-1', state: 'disabled', grantControls: { builtInControls: ['mfa'] } }],
      'caPolicy-1',
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('disabled');
  });

  it('FAILs (not throws) when the policy id is absent entirely', () => {
    const result = assertCaPolicyHasMfaGrantControl([], 'caPolicy-1');
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('no policy');
  });
});
