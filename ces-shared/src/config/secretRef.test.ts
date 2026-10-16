// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G1 T6 — secret-reference resolution.
import { describe, it, expect } from 'vitest';
import {
  isSecretRef,
  secretRefName,
  resolveSecretRef,
  resolveSecretFields,
  assertNoInlineSecrets,
  SecretRefError,
} from './secretRef.js';

const env = { VFS_THUMB: 'ABC123', EMPTY: '' };

describe('secret ref detection', () => {
  it('recognizes both env:NAME and ${NAME} forms', () => {
    expect(secretRefName('env:VFS_THUMB')).toBe('VFS_THUMB');
    expect(secretRefName('${VFS_THUMB}')).toBe('VFS_THUMB');
    expect(isSecretRef('env:X')).toBe(true);
    expect(isSecretRef('${X}')).toBe(true);
  });

  it('treats literals (and malformed refs) as non-references', () => {
    expect(secretRefName('ABC123')).toBeNull();
    expect(isSecretRef('plain-thumbprint')).toBe(false);
    expect(isSecretRef('env:')).toBe(false); // no name
    expect(isSecretRef('${ bad name }')).toBe(false);
    expect(isSecretRef(42)).toBe(false);
  });
});

describe('resolveSecretRef', () => {
  it('passes literals through unchanged (wasRef=false)', () => {
    expect(resolveSecretRef('ABC123', env)).toEqual({ value: 'ABC123', wasRef: false });
  });

  it('resolves a reference from the environment (wasRef=true)', () => {
    expect(resolveSecretRef('env:VFS_THUMB', env)).toEqual({ value: 'ABC123', wasRef: true });
    expect(resolveSecretRef('${VFS_THUMB}', env)).toEqual({ value: 'ABC123', wasRef: true });
  });

  it('fails closed when a referenced env var is unset or empty', () => {
    expect(() => resolveSecretRef('env:MISSING', env)).toThrow(SecretRefError);
    expect(() => resolveSecretRef('env:EMPTY', env)).toThrow(/not set/);
  });
});

describe('resolveSecretFields', () => {
  it('resolves only the named string fields, leaving others untouched', () => {
    const out = resolveSecretFields(
      { thumb: 'env:VFS_THUMB', name: 'Acme', port: 443 },
      ['thumb', 'name'],
      env,
    );
    expect(out).toEqual({ thumb: 'ABC123', name: 'Acme', port: 443 });
  });
});

describe('assertNoInlineSecrets (strict mode)', () => {
  it('passes when all secret fields are references', () => {
    expect(() => assertNoInlineSecrets({ a: 'env:X', b: '${Y}' }, ['a', 'b'])).not.toThrow();
  });

  it('throws listing inline-literal secret fields', () => {
    expect(() => assertNoInlineSecrets({ a: 'literal', b: 'env:Y' }, ['a', 'b'])).toThrow(/inline secret/);
    try {
      assertNoInlineSecrets({ a: 'literal', b: 'also-literal' }, ['a', 'b']);
    } catch (e) {
      expect((e as SecretRefError).message).toContain('a, b');
    }
  });
});
