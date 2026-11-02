// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SP-4 (SECRETS-PLAN.md §3): strip CES module secrets from the environment a child process
// inherits. A PowerShell child (tenant session, Stamper adapter, prerequisite checks, the DPAPI
// helper itself) never needs CES's own bearer tokens or signing secrets, so it must not get them.

/** Exact secret names (SECRETS-PLAN.md SP-4 list). */
export const MODULE_SECRET_NAMES: readonly string[] = Object.freeze([
  'EVIDENCE_OPS_SECRET',
  'JWT_SECRET',
  'CES_MUSTER_SECRETS_TOKEN',
  'CES_EO_OPERATOR_SECRET',
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
]);

/** Pattern secret names: CES_<MOD>_AUTH_TOKEN and CES_<MOD>_PRINCIPAL_SECRET. */
export const MODULE_SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /^CES_[A-Z0-9_]+_AUTH_TOKEN$/,
  /^CES_[A-Z0-9_]+_PRINCIPAL_SECRET$/,
]);

/** True when `name` is a CES module secret (case-insensitive, as Windows env names are). */
export function isModuleSecretName(name: string): boolean {
  const upper = name.toUpperCase();
  return MODULE_SECRET_NAMES.includes(upper) || MODULE_SECRET_PATTERNS.some((re) => re.test(upper));
}

/**
 * A copy of `env` without any module secret. Never mutates the input. Pass the result as a
 * child's `env` option (spawn / execFile / spawnSync).
 */
export function scrubEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (!isModuleSecretName(k)) out[k] = v;
  }
  return out;
}
