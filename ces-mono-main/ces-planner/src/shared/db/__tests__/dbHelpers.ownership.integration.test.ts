// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G1 T3 — integration tests: ownership enforcement on real Dexie (IndexedDB) reads.
//
// fake-indexeddb/auto MUST be imported before schema.ts so the Dexie singleton binds to the
// in-memory store. These prove that a tuple-scoped read NEVER returns another customer's record,
// and characterize the still-leaky legacy (no-tuple) reads so a future migration changes them
// deliberately. See docs/adr/ADR-001-ces-identity-model.md.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, dbHelpers } from '../schema';
import { makeCesTuple } from '../../identity/cesTuple';

// Minimal record factories — only the fields ownership cares about; rest cast through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baselineRow = (customerId: number) => ({ customerId, artifactId: 'a', data: {}, createdAt: '2026-01-01', isImmutable: true } as any);
const postureRow = (customerId: number, baselineId: number) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ customerId, baselineId, questionSetId: 1, artifactId: 'a', data: {}, createdAt: '2026-01-01' } as any);

beforeEach(async () => {
  await Promise.all([db.si_baselines.clear(), db.readiness_postures.clear()]);
});

describe('SI baseline reads — getBaselineById ownership gate', () => {
  it('returns the baseline to its owner but hides another customer’s baseline as "not found"', async () => {
    const b1 = await dbHelpers.createSIBaseline(baselineRow(1)); // customer 1
    const b2 = await dbHelpers.createSIBaseline(baselineRow(2)); // customer 2

    // Owner read succeeds.
    expect(await dbHelpers.getBaselineById(b1, makeCesTuple(1, b1))).toBeDefined();
    // Cross-customer read returns undefined (no existence disclosure).
    expect(await dbHelpers.getBaselineById(b2, makeCesTuple(1, b2))).toBeUndefined();
  });

  it('LEAK (characterized): without a tuple, getBaselineById returns any customer’s baseline', async () => {
    const b2 = await dbHelpers.createSIBaseline(baselineRow(2));
    // Pinned current behavior — legacy callers still get the record. Flip in the caller-migration slice.
    expect(await dbHelpers.getBaselineById(b2)).toBeDefined();
  });
});

describe('SI baseline list reads — scoped vs unscoped', () => {
  it('getBaselinesForCustomer returns only that customer’s baselines', async () => {
    await dbHelpers.createSIBaseline(baselineRow(1));
    await dbHelpers.createSIBaseline(baselineRow(1));
    await dbHelpers.createSIBaseline(baselineRow(2));

    const c1 = await dbHelpers.getBaselinesForCustomer(1);
    expect(c1).toHaveLength(2);
    expect(c1.every((b) => b.customerId === 1)).toBe(true);

    expect(await dbHelpers.getBaselinesForCustomer(2)).toHaveLength(1);
  });

  it('LEAK (characterized): getAllBaselines returns every customer’s baselines', async () => {
    await dbHelpers.createSIBaseline(baselineRow(1));
    await dbHelpers.createSIBaseline(baselineRow(2));
    expect(await dbHelpers.getAllBaselines()).toHaveLength(2);
  });
});

describe('Downstream reads — getPostureById requires customer AND baseline to match', () => {
  it('returns to owner; blocks cross-customer and wrong-baseline reads', async () => {
    const p1 = await dbHelpers.createReadinessPosture(postureRow(1, 10)); // customer 1, baseline 10
    const p2 = await dbHelpers.createReadinessPosture(postureRow(2, 20)); // customer 2, baseline 20

    expect(await dbHelpers.getPostureById(p1, makeCesTuple(1, 10))).toBeDefined();
    expect(await dbHelpers.getPostureById(p2, makeCesTuple(1, 20))).toBeUndefined(); // wrong customer
    expect(await dbHelpers.getPostureById(p1, makeCesTuple(1, 999))).toBeUndefined(); // wrong baseline
  });

  it('LEAK (characterized): without a tuple, getPostureById returns any record', async () => {
    const p2 = await dbHelpers.createReadinessPosture(postureRow(2, 20));
    expect(await dbHelpers.getPostureById(p2)).toBeDefined();
  });
});
