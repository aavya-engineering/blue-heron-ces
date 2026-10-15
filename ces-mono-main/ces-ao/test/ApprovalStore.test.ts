// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { hashInputs } from '../src/execution/ApprovalStore.js';

// Characterization tests for the pure SHA-256 input hash.
// NOTE: file-I/O parts of ApprovalStore are intentionally NOT tested here.
describe('hashInputs', () => {
  it('returns a 64-char lowercase hex SHA-256 string', () => {
    expect(hashInputs({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical input', () => {
    expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ a: 1, b: 2 }));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashInputs({ a: 1 })).not.toBe(hashInputs({ a: 2 }));
  });

  it('hashes null/undefined the same as an empty object (?? {} fallback)', () => {
    // createHash('sha256').update(JSON.stringify({})) — captured constant.
    const emptyHash = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
    expect(hashInputs({})).toBe(emptyHash);
    expect(hashInputs(null as any)).toBe(emptyHash);
    expect(hashInputs(undefined as any)).toBe(emptyHash);
  });

  it('G8: hash is key-ORDER STABLE (canonicalized) — reordered keys bind to the same hash', () => {
    // Same logical object, different key insertion order -> SAME hash (fixes the SoD binding bug
    // where requestor/approver serializations could diverge). Canonical JSON sorts keys.
    expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ b: 2, a: 1 }));
    // nested objects too
    expect(hashInputs({ x: { p: 1, q: 2 } })).toBe(hashInputs({ x: { q: 2, p: 1 } }));
  });
});
