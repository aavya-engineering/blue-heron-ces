// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FX-EO6: the "latest SSP" is per tenant. The old single `ssp/latest.json` meant the evidence
 * package and assessor view of tenant B could embed tenant A's SSP.
 */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function sspLatestPath(storageRoot: string, tenantSlug: string): string | null {
  if (!SLUG_RE.test(tenantSlug)) return null;
  return path.join(storageRoot, 'ssp', `latest-${tenantSlug}.json`);
}

export function loadLatestSsp<T = unknown>(storageRoot: string, tenantSlug: string): T | null {
  const p = sspLatestPath(storageRoot, tenantSlug);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}
