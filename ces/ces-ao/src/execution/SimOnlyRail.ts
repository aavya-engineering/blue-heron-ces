// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// A5: Sim-only safety rail.
//
// Two independent checks:
//  1. isStacksimModeActive(env) — "where will cmdlets go?" True when the process
//     inherits a stacksim environment (STACKSIM_SERVER_URL is loopback AND PSModulePath
//     starts with a stacksim psmodules dir). Both the --stacksim flag path and
//     ces-tester's injected-env path satisfy the same predicate.
//  2. checkSimOnlyRail — "which records may run?" Sim-only is ON by default (FX-AO2):
//     a non-sim record runs only with CES_AO_ALLOW_LIVE=1 AND kind 'live';
//     CES_AO_SIM_ONLY=1 refuses every non-sim record regardless. Both checks are needed.

import * as fs from 'node:fs';
import * as path from 'node:path';

const LOOPBACK_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;
const STACKSIM_SHIM_MODULE = 'Microsoft.Graph.Authentication';

function getEnvCaseInsensitive(env: Record<string, string | undefined>, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === lower) return env[k];
  }
  return undefined;
}

export function isStacksimModeActive(env: Record<string, string | undefined> = process.env): boolean {
  const serverUrl = env.STACKSIM_SERVER_URL;
  if (!serverUrl || !LOOPBACK_PATTERN.test(serverUrl)) return false;

  const psModulePath = getEnvCaseInsensitive(env, 'PSModulePath');
  if (!psModulePath) return false;

  const firstSegment = psModulePath.split(path.delimiter)[0];
  if (!firstSegment) return false;

  try {
    const entries = fs.readdirSync(firstSegment);
    return entries.some(e => e === STACKSIM_SHIM_MODULE);
  } catch {
    return false;
  }
}

export interface SimRailResult {
  allowed: boolean;
  reason?: string;
}

/** FX-AO2: env var that opts a process in to live (non-sim) execution. Off by default. */
export const ALLOW_LIVE_ENV = 'CES_AO_ALLOW_LIVE';

/**
 * FX-AO2 (2026-09-27): sim-only is ON by default.
 *
 * Decision order (first match wins):
 *  1. `kind: 'sim'` record -> allowed only if every http(s) endpoint is loopback
 *     (stacksim endpoints are always allowed).
 *  2. `CES_AO_SIM_ONLY=1` -> any non-sim record refused (lockdown beats opt-in).
 *  3. No `CES_AO_ALLOW_LIVE=1` opt-in -> any non-sim record refused (the default).
 *  4. Opt-in set but the record is not explicitly `kind: 'live'` -> refused.
 *  5. Opt-in + `kind: 'live'` -> allowed.
 * Applies to dry-runs too: a non-sim record never reaches the executor without the opt-in.
 */
export function checkSimOnlyRail(
  tenantKind: string | undefined,
  tenantEndpoints: Record<string, string | undefined> | undefined,
  env: Record<string, string | undefined> = process.env,
): SimRailResult {
  if (tenantKind === 'sim') {
    for (const [key, url] of Object.entries(tenantEndpoints ?? {})) {
      if (!url || typeof url !== 'string') continue;
      if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
      if (!LOOPBACK_PATTERN.test(url)) {
        return {
          allowed: false,
          reason: `Sim tenant has non-loopback endpoint ${key}=${url}`,
        };
      }
    }
    return { allowed: true };
  }

  if (env.CES_AO_SIM_ONLY === '1') {
    return {
      allowed: false,
      reason: `CES_AO_SIM_ONLY=1 refuses non-sim tenant (kind: '${tenantKind ?? 'undefined'}')`,
    };
  }

  if (env[ALLOW_LIVE_ENV] !== '1') {
    return {
      allowed: false,
      reason:
        `Sim-only by default: refusing non-sim tenant (kind: '${tenantKind ?? 'undefined'}'); ` +
        `live execution requires ${ALLOW_LIVE_ENV}=1 and a tenant record marked kind 'live'`,
    };
  }

  if (tenantKind !== 'live') {
    return {
      allowed: false,
      reason:
        `${ALLOW_LIVE_ENV}=1 is set but the tenant record is not marked live ` +
        `(kind: '${tenantKind ?? 'undefined'}'); refusing`,
    };
  }

  return { allowed: true };
}
