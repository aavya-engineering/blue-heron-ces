// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G1 T1/T3 — read-ownership tests for the canonical CES identity tuple.
//
// The headline guarantee: a read scoped to one (customer, SI-baseline) tuple must NEVER return
// another tuple's record. These exercise the pure ownership predicates the Dexie read helpers
// will call. See docs/adr/ADR-001-ces-identity-model.md.

import { describe, it, expect } from 'vitest';
import {
  makeCesTuple,
  tuplesEqual,
  tupleOf,
  downstreamMatchesTuple,
  baselineMatchesTuple,
  filterOwned,
  ownedOrUndefined,
  ownedBaselineOrUndefined,
  ownedByCustomerOrUndefined,
  customerMatchesTuple,
  assertOwned,
  OwnershipError,
} from '../cesTuple';

const A = makeCesTuple(1, 10); // customer 1, baseline 10
const B = makeCesTuple(2, 20); // customer 2, baseline 20

// Downstream record helper (e.g. a readiness posture / mission plan row)
const rec = (customerId: number, baselineId: number, id = 99) => ({ id, customerId, baselineId });
// SI baseline record helper (its own id is the baseline id)
const baseline = (id: number, customerId: number) => ({ id, customerId });

describe('CesTuple — equality & derivation', () => {
  it('compares tuples structurally', () => {
    expect(tuplesEqual(A, makeCesTuple(1, 10))).toBe(true);
    expect(tuplesEqual(A, B)).toBe(false);
    expect(tuplesEqual(A, makeCesTuple(1, 20))).toBe(false); // same customer, different baseline
    expect(tuplesEqual(A, makeCesTuple(2, 10))).toBe(false); // same baseline, different customer
  });

  it('derives the owning tuple from a downstream record', () => {
    expect(tupleOf(rec(1, 10))).toEqual(A);
  });
});

describe('downstream ownership — requires BOTH customer and baseline to match', () => {
  it('matches only the exact tuple', () => {
    expect(downstreamMatchesTuple(rec(1, 10), A)).toBe(true);
    expect(downstreamMatchesTuple(rec(2, 20), A)).toBe(false);
    expect(downstreamMatchesTuple(rec(1, 20), A)).toBe(false); // right customer, wrong baseline
    expect(downstreamMatchesTuple(rec(2, 10), A)).toBe(false); // wrong customer, right baseline
  });
});

describe('SI baseline ownership — matches on the baseline record’s own id', () => {
  it('matches same customer + id === siBaselineId', () => {
    expect(baselineMatchesTuple(baseline(10, 1), A)).toBe(true);
    expect(baselineMatchesTuple(baseline(10, 2), A)).toBe(false); // another customer's baseline
    expect(baselineMatchesTuple(baseline(20, 1), A)).toBe(false); // customer's other baseline
  });
});

describe('filterOwned — list reads never leak across tuples', () => {
  it('keeps only records owned by the tuple', () => {
    const mixed = [rec(1, 10, 1), rec(2, 20, 2), rec(1, 10, 3), rec(1, 20, 4), rec(2, 10, 5)];
    const owned = filterOwned(mixed, A);
    expect(owned.map((r) => r.id)).toEqual([1, 3]);
  });

  it('returns empty (not all rows) when nothing matches', () => {
    expect(filterOwned([rec(2, 20), rec(2, 30)], A)).toEqual([]);
  });
});

describe('ownedOrUndefined — read-by-id gate hides other tuples as "not found"', () => {
  it('returns the record when owned', () => {
    expect(ownedOrUndefined(rec(1, 10, 7), A)?.id).toBe(7);
  });

  it('returns undefined for another tuple’s record (no existence disclosure)', () => {
    expect(ownedOrUndefined(rec(2, 20, 7), A)).toBeUndefined();
    expect(ownedOrUndefined(rec(1, 20, 7), A)).toBeUndefined(); // same customer, other baseline
  });

  it('passes a genuinely-missing record through as undefined', () => {
    expect(ownedOrUndefined(undefined, A)).toBeUndefined();
  });
});

describe('ownedBaselineOrUndefined — same gate for SI baseline rows', () => {
  it('returns the baseline only to its owner', () => {
    expect(ownedBaselineOrUndefined(baseline(10, 1), A)?.id).toBe(10);
    expect(ownedBaselineOrUndefined(baseline(10, 2), A)).toBeUndefined();
    expect(ownedBaselineOrUndefined(undefined, A)).toBeUndefined();
  });
});

describe('customer-scoped ownership — matches on customerId only (e.g. Policy Inputs)', () => {
  const policy = (customerId: number, id = 5) => ({ id, customerId });

  it('matches any record of the tuple’s customer regardless of baseline', () => {
    expect(customerMatchesTuple(policy(1), A)).toBe(true);
    expect(customerMatchesTuple(policy(1), makeCesTuple(1, 999))).toBe(true); // baseline irrelevant
    expect(customerMatchesTuple(policy(2), A)).toBe(false);
  });

  it('ownedByCustomerOrUndefined gates by customer and hides others', () => {
    expect(ownedByCustomerOrUndefined(policy(1, 7), A)?.id).toBe(7);
    expect(ownedByCustomerOrUndefined(policy(2, 7), A)).toBeUndefined();
    expect(ownedByCustomerOrUndefined(undefined, A)).toBeUndefined();
  });
});

describe('assertOwned — strict gate for write/critical paths', () => {
  it('returns the record when owned', () => {
    expect(assertOwned(rec(1, 10, 5), A).id).toBe(5);
  });

  it('throws OwnershipError on mismatch (with both tuples in the message)', () => {
    expect(() => assertOwned(rec(2, 20), A)).toThrow(OwnershipError);
    try {
      assertOwned(rec(2, 20), A);
    } catch (e) {
      const err = e as OwnershipError;
      expect(err.expected).toEqual(A);
      expect(err.actual).toMatchObject({ customerId: 2, baselineId: 20 });
    }
  });
});
