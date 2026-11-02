// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as path from 'path';
import { getTenantPlanDataDir } from '../config/paths.js';

/**
 * Check if a tenant has at least one prior execution run completed.
 * Looks for execution-results-*.json files in the tenant's state directory.
 * Fail-safe: returns false on any error (no retry logic).
 */
export function checkPriorRunCompleted(tenantSlug: string): boolean {
  try {
    const stateDir = path.join(getTenantPlanDataDir(tenantSlug), 'state');
    if (!fs.existsSync(stateDir)) return false;
    const files = fs.readdirSync(stateDir);
    return files.some(f => f.startsWith('execution-results-') && f.endsWith('.json'));
  } catch {
    // Fail-safe: return false on any error
    return false;
  }
}
