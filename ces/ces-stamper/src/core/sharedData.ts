// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { createRequire } from 'node:module';

/**
 * FX2-ST1: canonical reference data lives in ces-shared (`ces-shared/data/*`).
 * Stamper keeps no local copy — the same resolver pattern ces-eo uses
 * (`eo-router-utils.ts` resolveDataPath). A missing mapping throws.
 */
const _require = createRequire(import.meta.url);

const SHARED_DATA: Record<string, string> = {
  'sprs-weights.json': 'ces-shared/data/sprs-weights',
  'cmmc-l2-controls.reference.json': 'ces-shared/data/cmmc-l2-controls',
};

/** Absolute path of a canonical ces-shared data file. */
export function resolveSharedDataPath(filename: keyof typeof SHARED_DATA | string): string {
  const specifier = SHARED_DATA[filename];
  if (!specifier) throw new Error(`Unknown ces-shared data file: ${filename}`);
  return _require.resolve(specifier);
}
