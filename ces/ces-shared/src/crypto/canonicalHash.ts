// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G8 — deterministic (canonical) JSON hashing.
//
// Raw JSON.stringify is key-ORDER sensitive: two logically-equal objects whose keys were inserted
// in different orders serialize differently and therefore hash differently. That breaks any
// integrity/equality check that hashes an object (e.g. SoD param binding, evidence integrity).
// canonicalJsonStringify sorts object keys recursively so the serialization — and the hash — is
// stable for logically-equal objects. Arrays keep their order (order is significant for arrays).

import { createHash } from 'node:crypto';

/** Recursively sort object keys so logically-equal objects serialize identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic JSON serialization: object keys sorted recursively. For a value with no objects
 * (string/number/array-of-scalars) this equals JSON.stringify, so it is back-compatible for those.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 (lowercase hex) of the canonical JSON form of `value` — order-stable object hashing. */
export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value), 'utf-8').digest('hex');
}
