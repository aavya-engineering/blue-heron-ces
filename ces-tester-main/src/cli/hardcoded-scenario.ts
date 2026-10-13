// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import type { StacksimSeedBlock } from '../stacksim-client/types.js';

/**
 * PLAN.md M1 task 5: "hardcodes one scenario's stacksim_seed block (no
 * scenario file parsing yet)". Mirrors tenant-stacksim's own
 * scenarios/muster-configured.json (M0 item 6's live-tested pattern): PATCH
 * seeded caPolicy-1 to state 'enabled' with an mfa grant control.
 */
export const HARDCODED_SCENARIO_ID = 'ces-tester-m1-ca-mfa-enabled';
export const HARDCODED_CA_POLICY_ID = 'caPolicy-1';

export const HARDCODED_SEED_PASS: StacksimSeedBlock = {
  stance: 'm365_azure',
  steps: [
    {
      kind: 'uri',
      method: 'PATCH',
      uri: `/v1.0/identity/conditionalAccess/policies/${HARDCODED_CA_POLICY_ID}`,
      body: {
        state: 'enabled',
        grantControls: { operator: 'OR', builtInControls: ['mfa'] },
      },
      note: 'Enable MFA grant on seeded CA policy caPolicy-1 (mirrors scenarios/muster-configured.json)',
    },
  ],
};

/**
 * Variant used by the acceptance gate's FAIL run (PLAN.md M1 Acceptance
 * Gate: "a console FAIL (not a crash) when the seed is altered to make the
 * assertion false"). Mirrors scenarios/muster-mfa-disabled.json.
 */
export const HARDCODED_SEED_FAIL: StacksimSeedBlock = {
  stance: 'm365_azure',
  steps: [
    {
      kind: 'uri',
      method: 'PATCH',
      uri: `/v1.0/identity/conditionalAccess/policies/${HARDCODED_CA_POLICY_ID}`,
      body: {
        state: 'disabled',
        grantControls: { operator: 'OR', builtInControls: ['mfa'] },
      },
      note: 'MFA grant present but policy disabled (mirrors scenarios/muster-mfa-disabled.json)',
    },
  ],
};
