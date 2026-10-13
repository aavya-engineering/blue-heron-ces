// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * PLAN.md M1 task 5/6: one hardcoded assertion — a Conditional Access policy
 * exists with state 'enabled'. Pure logic (no HTTP/spawn), unit-tested per
 * PLAN.md's Testing Strategy ("pure logic, no browser/PowerShell spawned").
 */

export interface CaPolicyLike {
  id?: string;
  state?: string;
  grantControls?: { operator?: string; builtInControls?: string[] };
  [key: string]: unknown;
}

export interface AssertionResult {
  name: string;
  pass: boolean;
  detail: string;
}

/** Extracts the `value` array from a stacksim /resolve GET-collection response, or []. */
export function extractCollection(data: unknown): CaPolicyLike[] {
  if (Array.isArray(data)) return data as CaPolicyLike[];
  if (data && typeof data === 'object' && Array.isArray((data as { value?: unknown }).value)) {
    return (data as { value: CaPolicyLike[] }).value;
  }
  return [];
}

/**
 * Asserts that a CA policy with the given id exists and has state 'enabled'.
 * Mirrors the muster-configured.json / muster-mfa-disabled.json scenario
 * pair (tenant-stacksim/scenarios/): PATCHing caPolicy-1 to state 'enabled'
 * makes this pass; PATCHing it to 'disabled' makes it fail without a crash.
 */
export function assertCaPolicyEnabled(policies: CaPolicyLike[], policyId: string): AssertionResult {
  const policy = policies.find((p) => p.id === policyId);
  const name = `Conditional Access policy "${policyId}" exists with state 'enabled'`;

  if (!policy) {
    return { name, pass: false, detail: `no policy with id "${policyId}" found` };
  }
  if (policy.state !== 'enabled') {
    return { name, pass: false, detail: `policy "${policyId}" found but state is "${String(policy.state)}"` };
  }
  return { name, pass: true, detail: `policy "${policyId}" state is "enabled"` };
}

/**
 * PLAN.md M2 clean-tenant-mfa-baseline: stricter than assertCaPolicyEnabled
 * above. tenant-stacksim's default `caPolicies` seed generator
 * (`src/seed/generators/caPolicies.ts:7-27`) already seeds every CA policy
 * with `state: 'enabled'` and NO `grantControls` field at all — so on a
 * genuinely clean tenant (M2's scenario, no pre-configured `steps`),
 * `assertCaPolicyEnabled` alone would trivially pass with zero Stamper
 * involvement, defeating the point of the scenario. This function also
 * requires `grantControls.builtInControls` to include `'mfa'`, which only a
 * real mutation (Stamper's execution, or a scenario `steps` PATCH) can add.
 */
export function assertCaPolicyHasMfaGrantControl(
  policies: CaPolicyLike[],
  policyId: string,
): AssertionResult {
  const policy = policies.find((p) => p.id === policyId);
  const name = `Conditional Access policy "${policyId}" exists with state 'enabled' and MFA grant control`;

  if (!policy) {
    return { name, pass: false, detail: `no policy with id "${policyId}" found` };
  }
  if (policy.state !== 'enabled') {
    return { name, pass: false, detail: `policy "${policyId}" found but state is "${String(policy.state)}"` };
  }
  const hasMfa = policy.grantControls?.builtInControls?.includes('mfa') ?? false;
  if (!hasMfa) {
    return {
      name,
      pass: false,
      detail: `policy "${policyId}" is enabled but has no MFA grant control (grantControls=${JSON.stringify(policy.grantControls)})`,
    };
  }
  return { name, pass: true, detail: `policy "${policyId}" is enabled with MFA grant control` };
}
