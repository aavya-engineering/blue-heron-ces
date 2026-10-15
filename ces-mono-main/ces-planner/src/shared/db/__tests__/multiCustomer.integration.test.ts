// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G1 T5 — multi-customer end-to-end isolation.
//
// Seeds TWO customers, each with a full artifact chain, then proves zero cross-talk: every
// ownership-aware by-id read and every scoped list read returns only the active customer's data,
// and a tuple from customer A never yields customer B's records (and vice-versa).
// Real Dexie via fake-indexeddb. See docs/adr/ADR-001-ces-identity-model.md and docs/G1-plan.md.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, dbHelpers } from '../schema';
import { makeCesTuple, type CesTuple } from '../../identity/cesTuple';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (o: Record<string, unknown>) => ({ artifactId: 'a', data: {}, createdAt: '2026-01-01', ...o } as any);

interface CustomerChain {
  customerId: number;
  tuple: CesTuple;
  baselineId: number;
  questionSetId: number;
  postureId: number;
  missionPlanId: number;
  cuiId: number;
  btcId: number;
  tenantConfigId: number;
  policyId: number;
}

async function seedCustomer(customerId: number): Promise<CustomerChain> {
  const baselineId = await dbHelpers.createSIBaseline(row({ customerId, isImmutable: true }));
  const base = { customerId, baselineId };
  return {
    customerId,
    baselineId,
    tuple: makeCesTuple(customerId, baselineId),
    questionSetId: await dbHelpers.createRRQuestionSet(row(base)),
    postureId: await dbHelpers.createReadinessPosture(row({ ...base, questionSetId: 1 })),
    missionPlanId: await dbHelpers.createMissionPlan(row({ ...base, postureId: 1 })),
    cuiId: await dbHelpers.createCUIBoundary(row(base)),
    btcId: await dbHelpers.createBTC(row({ ...base, cuiBoundaryId: 1 })),
    tenantConfigId: await dbHelpers.createTenantConfigProfile(row(base)),
    policyId: await dbHelpers.createPolicyInputs(row({ customerId })),
  };
}

let A: CustomerChain;
let B: CustomerChain;

beforeAll(async () => {
  await Promise.all([
    db.si_baselines.clear(), db.rr_question_sets.clear(), db.readiness_postures.clear(),
    db.mission_plans.clear(), db.cui_boundaries.clear(), db.btc_confirmations.clear(),
    db.tenant_config_profiles.clear(), db.policy_inputs.clear(),
  ]);
  A = await seedCustomer(1);
  B = await seedCustomer(2);
});

describe('by-id reads: a customer never sees another customer’s records', () => {
  it('SI baseline gate', async () => {
    expect(await dbHelpers.getBaselineById(A.baselineId, A.tuple)).toBeDefined();
    expect(await dbHelpers.getBaselineById(B.baselineId, A.tuple)).toBeUndefined();
    expect(await dbHelpers.getBaselineById(A.baselineId, B.tuple)).toBeUndefined();
  });

  it('downstream gates (question set, posture, mission plan, CUI, BTC, tenant config)', async () => {
    const checks: Array<[(id: number, t?: CesTuple) => Promise<unknown>, number, number]> = [
      [dbHelpers.getQuestionSetById, A.questionSetId, B.questionSetId],
      [dbHelpers.getPostureById, A.postureId, B.postureId],
      [dbHelpers.getMissionPlanById, A.missionPlanId, B.missionPlanId],
      [dbHelpers.getCUIBoundaryById, A.cuiId, B.cuiId],
      [dbHelpers.getBTCById, A.btcId, B.btcId],
      [dbHelpers.getTenantConfigById, A.tenantConfigId, B.tenantConfigId],
    ];
    for (const [read, aId, bId] of checks) {
      expect(await read(aId, A.tuple)).toBeDefined(); // owner sees own
      expect(await read(bId, A.tuple)).toBeUndefined(); // A's tuple can't read B's record
      expect(await read(aId, B.tuple)).toBeUndefined(); // B's tuple can't read A's record
    }
  });

  it('customer-scoped policy inputs gate', async () => {
    expect(await dbHelpers.getPolicyInputsById(A.policyId, A.tuple)).toBeDefined();
    expect(await dbHelpers.getPolicyInputsById(B.policyId, A.tuple)).toBeUndefined();
  });
});

describe('list reads are scoped to the active customer', () => {
  it('baselines list never leaks across customers', async () => {
    const a = await dbHelpers.getBaselinesForCustomer(1);
    expect(a).toHaveLength(1);
    expect(a[0].customerId).toBe(1);
    expect(await dbHelpers.getBaselinesForCustomer(2)).toHaveLength(1);
  });

  it('downstream compound-keyed lists are isolated by (customer, baseline)', async () => {
    expect(await dbHelpers.getPosturesByCustomerAndBaseline(1, A.baselineId)).toHaveLength(1);
    // A's customer id with B's baseline id → nothing
    expect(await dbHelpers.getPosturesByCustomerAndBaseline(1, B.baselineId)).toHaveLength(0);
    expect(await dbHelpers.getMissionPlansByCustomerAndBaseline(2, B.baselineId)).toHaveLength(1);
    expect(await dbHelpers.getMissionPlansByCustomerAndBaseline(2, A.baselineId)).toHaveLength(0);
  });
});
