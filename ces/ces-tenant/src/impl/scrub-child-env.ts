// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

// FIN-42 / SP-4 (SECRETS-PLAN.md section 3): the child-environment scrub for the persistent
// PowerShell session host. ces-tenant does not depend on ces-shared, so this is an inlined copy of
// ces-shared/src/secrets/scrubEnv.ts, which stays the source of truth: keep the two name lists equal
// (src/__tests__/scrub-child-env.test.ts compares them when the ces-shared source is present).

/** Exact CES module-secret names (SP-4 list). */
export const CHILD_ENV_SECRET_NAMES: readonly string[] = Object.freeze([
  'EVIDENCE_OPS_SECRET',
  'JWT_SECRET',
  'CES_MUSTER_SECRETS_TOKEN',
  'CES_EO_OPERATOR_SECRET',
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
]);

/** Pattern names: CES_<MOD>_AUTH_TOKEN and CES_<MOD>_PRINCIPAL_SECRET. */
export const CHILD_ENV_SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /^CES_[A-Z0-9_]+_AUTH_TOKEN$/,
  /^CES_[A-Z0-9_]+_PRINCIPAL_SECRET$/,
]);

/** True when `name` is a CES module secret (case-insensitive, as Windows env names are). */
export function isChildEnvSecretName(name: string): boolean {
  const upper = name.toUpperCase();
  return CHILD_ENV_SECRET_NAMES.includes(upper) || CHILD_ENV_SECRET_PATTERNS.some((re) => re.test(upper));
}

/** A copy of `env` without any CES module secret. Never mutates the input. */
export function scrubChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (!isChildEnvSecretName(k)) out[k] = v;
  }
  return out;
}
