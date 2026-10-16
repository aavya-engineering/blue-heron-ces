// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G4 — stack-provider seam: contract validation, registry, resolution, pluggability.
import { describe, it, expect } from 'vitest';
import {
  StackRegistry,
  validateStackCapabilities,
  StackCapabilityError,
  resolveStackId,
  DEFAULT_STACK_ID,
} from './StackProvider.js';
import {
  defaultStackRegistry,
  getStackProvider,
  getActiveStackProvider,
  microsoftGccHighProvider,
  exampleStubProvider,
  EXAMPLE_STUB_STACK_ID,
  GOOGLE_WORKSPACE_CLOUD_STACK_ID,
} from './index.js';

describe('stack capability validation (#3)', () => {
  it('accepts the Microsoft + stub capability sets', () => {
    expect(() => validateStackCapabilities(microsoftGccHighProvider.capabilities)).not.toThrow();
    expect(() => validateStackCapabilities(exampleStubProvider.capabilities)).not.toThrow();
  });

  it('rejects a capability set missing required fields, naming them', () => {
    expect(() => validateStackCapabilities({ id: 'x' })).toThrow(StackCapabilityError);
    try {
      validateStackCapabilities({ id: 'x', displayName: 'X' });
    } catch (e) {
      const msg = (e as StackCapabilityError).message;
      expect(msg).toContain('cloudEndpoints');
      expect(msg).toContain('evaluatorSetId');
      expect(msg).toContain('conventions');
    }
  });

  it('rejects incomplete cloudEndpoints / conventions', () => {
    const base = { ...microsoftGccHighProvider.capabilities };
    expect(() => validateStackCapabilities({ ...base, cloudEndpoints: { login: 'x' } })).toThrow(/cloudEndpoints\.graph/);
    expect(() =>
      validateStackCapabilities({ ...base, conventions: { cloudEnvironment: 'x', defaultLocation: 'y', identityModel: 'z' } }),
    ).toThrow(/infrastructureModels/);
  });
});

describe('stack registry + resolution (#1, #4)', () => {
  it('default registry has Microsoft (reference) + the example stub + Google Workspace', () => {
    expect(defaultStackRegistry.ids().sort()).toEqual(
      [DEFAULT_STACK_ID, EXAMPLE_STUB_STACK_ID, GOOGLE_WORKSPACE_CLOUD_STACK_ID].sort()
    );
    expect(getStackProvider(DEFAULT_STACK_ID).capabilities.displayName).toMatch(/Microsoft/);
  });

  it('resolveStackId reuses config and defaults to Microsoft', () => {
    expect(resolveStackId(undefined)).toBe(DEFAULT_STACK_ID);
    expect(resolveStackId({})).toBe(DEFAULT_STACK_ID);
    expect(resolveStackId({ stack: EXAMPLE_STUB_STACK_ID })).toBe(EXAMPLE_STUB_STACK_ID);
  });

  it('getActiveStackProvider selects by config stack id (Microsoft not special-cased) (#5)', () => {
    expect(getActiveStackProvider(undefined).capabilities.id).toBe(DEFAULT_STACK_ID);
    expect(getActiveStackProvider({ stack: EXAMPLE_STUB_STACK_ID }).capabilities.id).toBe(EXAMPLE_STUB_STACK_ID);
  });

  it('throws a clear error for an unregistered stack id', () => {
    expect(() => getStackProvider('does-not-exist')).toThrow(/no provider registered for stack "does-not-exist"/);
  });

  it('a brand-new stack can be registered through the same seam (pluggability)', () => {
    const reg = new StackRegistry();
    reg.register(microsoftGccHighProvider);
    reg.register({
      capabilities: {
        ...exampleStubProvider.capabilities,
        id: 'acme-cloud',
        displayName: 'Acme Cloud',
      },
    });
    expect(reg.has('acme-cloud')).toBe(true);
    expect(reg.get('acme-cloud').capabilities.displayName).toBe('Acme Cloud');
  });

  it('registering an invalid provider is rejected at registration time', () => {
    const reg = new StackRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => reg.register({ capabilities: { id: 'bad' } as any })).toThrow(StackCapabilityError);
  });
});
