// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { calculateMissionPlanCost } from '../proposalGenerator';

/**
 * CHARACTERIZATION tests for the MPT static cost model.
 * Pure arithmetic over LICENSE_TIER_COSTS + INFRA_MODEL_COSTS.
 * monthly = license.monthly_per_user * users + infra.monthly_fixed; annual = monthly * 12.
 */
describe('calculateMissionPlanCost', () => {
  it('g5 + m365_azure, 50 users', () => {
    // 52*50 + 1167 = 3767; *12 = 45204
    expect(calculateMissionPlanCost('m365_azure', 'g5', 50)).toEqual({ monthly: 3767, annual: 45204 });
  });

  it('business_premium + m365_only, 25 users', () => {
    // 60*25 + 0 = 1500; *12 = 18000
    expect(calculateMissionPlanCost('m365_only', 'business_premium', 25)).toEqual({
      monthly: 1500,
      annual: 18000,
    });
  });

  it('g3 + m365_sentinel, 100 users', () => {
    // 56*100 + 500 = 6100; *12 = 73200
    expect(calculateMissionPlanCost('m365_sentinel', 'g3', 100)).toEqual({
      monthly: 6100,
      annual: 73200,
    });
  });

  it('unknown tier + unknown infra falls back to g5 + m365_azure defaults', () => {
    // defaults: 52*10 + 1167 = 1687; *12 = 20244
    expect(calculateMissionPlanCost('bogus', 'bogus', 10)).toEqual({ monthly: 1687, annual: 20244 });
  });

  it('zero users yields only the fixed infra cost', () => {
    // 0 + 500 = 500; *12 = 6000
    expect(calculateMissionPlanCost('m365_sentinel', 'g5', 0)).toEqual({ monthly: 500, annual: 6000 });
  });
});
