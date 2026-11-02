// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { canonicalJsonStringify, canonicalSha256 } from './canonicalHash.js';
import { createHash } from 'node:crypto';

describe('canonicalJsonStringify', () => {
  it('sorts object keys (logically-equal objects serialize identically)', () => {
    expect(canonicalJsonStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJsonStringify({ a: 1, b: 2 })).toBe(canonicalJsonStringify({ b: 2, a: 1 }));
  });

  it('sorts nested object keys recursively', () => {
    expect(canonicalJsonStringify({ z: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"z":{"c":2,"d":1}}');
  });

  it('preserves array order (order is significant for arrays)', () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJsonStringify({ arr: [{ b: 1, a: 2 }] })).toBe('{"arr":[{"a":2,"b":1}]}');
  });

  it('is back-compatible with JSON.stringify for scalars and {}', () => {
    expect(canonicalJsonStringify({})).toBe('{}');
    expect(canonicalJsonStringify('x')).toBe('"x"');
    expect(canonicalJsonStringify(42)).toBe('42');
  });
});

describe('canonicalSha256', () => {
  it('is order-stable: reordered keys hash identically', () => {
    expect(canonicalSha256({ a: 1, b: 2 })).toBe(canonicalSha256({ b: 2, a: 1 }));
  });

  it('still distinguishes different content', () => {
    expect(canonicalSha256({ a: 1 })).not.toBe(canonicalSha256({ a: 2 }));
  });

  it('equals the plain sha256 of "{}" for an empty object (back-compat)', () => {
    const expected = createHash('sha256').update('{}').digest('hex');
    expect(canonicalSha256({})).toBe(expected);
  });

  it('returns 64-char lowercase hex', () => {
    expect(canonicalSha256({ any: 'thing' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
