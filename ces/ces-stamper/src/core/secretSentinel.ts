// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution): a safe, non-secret placeholder
 * for a variable whose real value comes from a `SecretReference` (ces-shared 2.8.0,
 * `secret_references[]` / `provisioning_inputs.initial_password_ref`).
 *
 * The resolved secret value must never be written to the executable plan file, tenant
 * variables.json, logs, evidence, or any SSE stream event. Those artifacts instead carry
 * this sentinel token for the variable — a plan/log containing `<<CES_SECRET:initialPassword>>`
 * is not a leak. Only `PowerShellAdapter`'s secret overlay (set at execution time, held only in
 * server memory) swaps the sentinel for the real value, immediately before the command reaches
 * the engine/spawn boundary (`executeViaSession`). See `src/core/SecretResolver.ts`.
 */

const SENTINEL_PREFIX = '<<CES_SECRET:';
const SENTINEL_SUFFIX = '>>';

/** Matches every `<<CES_SECRET:name>>` occurrence in a string. Global — always start a fresh scan. */
export const SECRET_SENTINEL_RE = /<<CES_SECRET:(\w+)>>/g;

/** Build the sentinel token for a given secret-bearing variable name. */
export function secretSentinel(variableName: string): string {
  return `${SENTINEL_PREFIX}${variableName}${SENTINEL_SUFFIX}`;
}

/** True if the value is exactly a secret sentinel token (not merely containing one). */
export function isSecretSentinel(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const re = new RegExp(`^${SENTINEL_PREFIX}(\\w+)${SENTINEL_SUFFIX}$`);
  return re.test(value);
}

/** True if the string contains one or more secret sentinel tokens anywhere within it. */
export function containsSecretSentinel(value: string): boolean {
  return value.includes(SENTINEL_PREFIX);
}
