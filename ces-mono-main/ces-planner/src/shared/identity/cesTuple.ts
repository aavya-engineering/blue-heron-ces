// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * CES identity tuple — the canonical, authoritative key for ownership.
 *
 * See docs/adr/ADR-001-ces-identity-model.md. The explicit numeric tuple
 * { customerId, siBaselineId } decides ownership; `cesId` is a derived label only
 * and must never be used to authorize a read.
 *
 * This module is intentionally pure (no Dexie / IndexedDB / React). It is the single
 * place the persistence read helpers will call to enforce ownership (G1 T2/T3).
 */

/** The authoritative ownership key: a (customer, SI-baseline) pair. */
export interface CesTuple {
  customerId: number;
  /** The SI Baseline's own record id (the `baselineId` foreign key on downstream records). */
  siBaselineId: number;
}

/** A downstream artifact record keyed to a customer + SI baseline. */
export interface BaselineScopedRecord {
  customerId: number;
  baselineId: number;
}

/** An SI Baseline record — it *is* the baseline, so its own `id` is the siBaselineId. */
export interface BaselineRecord {
  id?: number;
  customerId: number;
}

/** A record scoped to a customer only (no SI-baseline linkage), e.g. Policy Inputs. */
export interface CustomerScopedRecord {
  customerId: number;
}

/** Thrown by assertOwned* on a write/critical path when a record is not owned by the tuple. */
export class OwnershipError extends Error {
  constructor(
    public readonly expected: CesTuple,
    public readonly actual: { customerId?: number; baselineId?: number; id?: number },
  ) {
    super(
      `CES ownership violation: record (customerId=${actual.customerId}, ` +
        `baselineId=${actual.baselineId ?? actual.id}) does not match tuple ` +
        `(customerId=${expected.customerId}, siBaselineId=${expected.siBaselineId})`,
    );
    this.name = 'OwnershipError';
  }
}

export function makeCesTuple(customerId: number, siBaselineId: number): CesTuple {
  return { customerId, siBaselineId };
}

/** Structural equality of two tuples. */
export function tuplesEqual(a: CesTuple, b: CesTuple): boolean {
  return a.customerId === b.customerId && a.siBaselineId === b.siBaselineId;
}

/** The tuple a downstream record belongs to. */
export function tupleOf(record: BaselineScopedRecord): CesTuple {
  return { customerId: record.customerId, siBaselineId: record.baselineId };
}

/** True iff a downstream record is owned by the tuple (both customer AND baseline match). */
export function downstreamMatchesTuple(record: BaselineScopedRecord, tuple: CesTuple): boolean {
  return record.customerId === tuple.customerId && record.baselineId === tuple.siBaselineId;
}

/**
 * True iff an SI Baseline record is the baseline named by the tuple: same customer AND the
 * baseline's own id equals siBaselineId.
 */
export function baselineMatchesTuple(record: BaselineRecord, tuple: CesTuple): boolean {
  return record.customerId === tuple.customerId && record.id === tuple.siBaselineId;
}

/** True iff a customer-scoped record (no baseline linkage) belongs to the tuple's customer. */
export function customerMatchesTuple(record: CustomerScopedRecord, tuple: CesTuple): boolean {
  return record.customerId === tuple.customerId;
}

/** Keep only the downstream records owned by the tuple. */
export function filterOwned<T extends BaselineScopedRecord>(records: T[], tuple: CesTuple): T[] {
  return records.filter((r) => downstreamMatchesTuple(r, tuple));
}

/**
 * Read-by-id ownership gate for downstream records: returns the record only if it is owned by the
 * tuple, otherwise `undefined` — a non-owner gets "not found", never confirmation of existence.
 * `undefined` in (genuinely missing) passes straight through as `undefined`.
 */
export function ownedOrUndefined<T extends BaselineScopedRecord>(
  record: T | undefined,
  tuple: CesTuple,
): T | undefined {
  if (record === undefined) return undefined;
  return downstreamMatchesTuple(record, tuple) ? record : undefined;
}

/** Same gate for an SI Baseline record (matches on the baseline's own id). */
export function ownedBaselineOrUndefined<T extends BaselineRecord>(
  record: T | undefined,
  tuple: CesTuple,
): T | undefined {
  if (record === undefined) return undefined;
  return baselineMatchesTuple(record, tuple) ? record : undefined;
}

/** Read-by-id gate for customer-scoped records (matches on customerId only). */
export function ownedByCustomerOrUndefined<T extends CustomerScopedRecord>(
  record: T | undefined,
  tuple: CesTuple,
): T | undefined {
  if (record === undefined) return undefined;
  return customerMatchesTuple(record, tuple) ? record : undefined;
}

/** Strict gate for write/critical paths: returns the record or throws OwnershipError. */
export function assertOwned<T extends BaselineScopedRecord>(record: T, tuple: CesTuple): T {
  if (!downstreamMatchesTuple(record, tuple)) {
    throw new OwnershipError(tuple, { customerId: record.customerId, baselineId: record.baselineId });
  }
  return record;
}
