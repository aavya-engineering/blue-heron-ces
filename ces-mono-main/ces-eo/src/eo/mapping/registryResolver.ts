// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G13 — resolve the filesystem path for a named control-signal registry.
//
// Uses createRequire(import.meta.url) + require.resolve(...) — the SAME mechanism as
// SignalToControlMapper.ts:50-51 — to anchor paths from within ces-eo into ces-shared/data/.
// Unknown registry ids return undefined (graceful-degradation contract).

import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

const MICROSOFT_REGISTRY_ID = 'cmmc-l2-control-signal-registry';
const GOOGLE_REGISTRY_ID = 'google-workspace-control-signal-registry';

/**
 * Resolve the absolute file path for a named control-signal registry.
 * Returns undefined for any unknown registry id.
 */
export function resolveControlSignalRegistryPath(registryId: string): string | undefined {
  if (registryId === MICROSOFT_REGISTRY_ID) {
    return _require.resolve('ces-shared/data/control-signal-registry');
  }
  if (registryId === GOOGLE_REGISTRY_ID) {
    return _require.resolve('ces-shared/data/google-workspace-control-signal-registry');
  }
  return undefined;
}
