// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import { CESScopeExclusion, EnrichedScopeExclusion } from '../types/ces-artifacts.types.js';
import { resolveSharedDataPath } from './sharedData.js';

// ---- Constants ----

/**
 * Controls that can NEVER be excluded from scope (spec section 7.1).
 * These are fundamental security requirements that apply regardless of
 * Strategic Intent decisions.
 */

export const NEVER_EXCLUDABLE_NIST_REFS: ReadonlySet<string> = new Set([
  '3.1.1',
  '3.1.2',
  '3.1.3',
  '3.1.5',
  '3.1.20',
  '3.1.22',
  '3.5.1',
  '3.5.2',
  '3.3.1',
  '3.3.2',
  '3.12.4',
  '3.10.3',
  '3.10.4',
  '3.10.5',
]);

/**
 * Valid SI field/value pairs and their allowed NIST control exclusions (spec section 7.2).
 */
export const SCOPE_EXCLUSION_RULES: ReadonlyArray<{
  si_field: string;
  si_value: string;
  allowed_nist_refs: string[];
  description: string;
}> = [
  {
    si_field: 'mobile_device_presence',
    si_value: 'no_mobile_devices',
    allowed_nist_refs: ['3.1.18', '3.1.19'],
    description: 'No mobile devices in CUI enclave',
  },
  {
    si_field: 'wireless_posture',
    si_value: 'no_wireless',
    allowed_nist_refs: ['3.1.14', '3.1.16'],
    description: 'No wireless networks in CUI boundary',
  },
  {
    si_field: 'removable_media_posture',
    si_value: 'blocked',
    allowed_nist_refs: ['3.8.5', '3.8.6'],
    description: 'Removable media blocked organization-wide',
  },
  {
    si_field: 'remote_access_posture',
    si_value: 'no_remote',
    allowed_nist_refs: ['3.1.12', '3.10.6'],
    description: 'No remote access to CUI systems',
  },
  {
    si_field: 'maintenance_posture',
    si_value: 'no_nonlocal',
    allowed_nist_refs: ['3.7.4'],
    description: 'No nonlocal maintenance of CUI systems',
  },
];

// ---- Types ----

export interface ScopeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---- Functions ----

/**
 * Validate scope exclusions against known SI rules and control constraints.
 * Five validation rules:
 *   1. Non-excludable check (NEVER_EXCLUDABLE_NIST_REFS)
 *   2. Known SI pair check (SCOPE_EXCLUSION_RULES)
 *   3. Allowed control mapping (nist_ref in rule's allowed_nist_refs)
 *   4. 5-point weight warning (weight === 5)
 *   5. Unknown nist_ref check (must exist in sprsWeights)
 * If strictMode=true, warnings are appended to errors.
 */
export function validateScopeExclusions(
  exclusions: CESScopeExclusion[],
  sprsWeights: Map<string, { weight: number; poam_allowed: boolean }>,
  strictMode: boolean
): ScopeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const exclusion of exclusions) {
    const nistRef = exclusion.requirement_id.split('-').slice(1).join('-');

    // Rule 5: Unknown nist_ref check
    if (!sprsWeights.has(nistRef)) {
      errors.push(`Unknown NIST ref "${nistRef}" derived from requirement_id "${exclusion.requirement_id}"`);
      continue;
    }

    // Rule 1: Non-excludable check
    if (NEVER_EXCLUDABLE_NIST_REFS.has(nistRef)) {
      errors.push(`Control ${nistRef} (${exclusion.requirement_id}) is a fundamental control and cannot be excluded`);
      continue;
    }

    // Rule 2: Known SI pair check
    const matchingRule = SCOPE_EXCLUSION_RULES.find(
      r => r.si_field === exclusion.si_field && r.si_value === exclusion.si_value
    );
    if (!matchingRule) {
      errors.push(`Unknown SI pair: si_field="${exclusion.si_field}", si_value="${exclusion.si_value}" for ${exclusion.requirement_id}`);
      continue;
    }

    // Rule 3: Allowed control mapping
    if (!matchingRule.allowed_nist_refs.includes(nistRef)) {
      errors.push(`Control ${nistRef} (${exclusion.requirement_id}) is not allowed under SI rule "${matchingRule.si_field}=${matchingRule.si_value}". Allowed: ${matchingRule.allowed_nist_refs.join(', ')}`);
      continue;
    }

    // Rule 4: 5-point weight warning
    const weightInfo = sprsWeights.get(nistRef)!;
    if (weightInfo.weight === 5) {
      warnings.push(`Control ${nistRef} (${exclusion.requirement_id}) has SPRS weight 5 — high-impact exclusion`);
    }
  }

  if (strictMode) {
    errors.push(...warnings);
    warnings.length = 0;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Enrich scope exclusions with derived nist_ref and sprs_weight.
 * Throws if nist_ref not found in sprsWeights (fail-fast on corrupt data).
 */
export function enrichScopeExclusions(
  exclusions: CESScopeExclusion[],
  sprsWeights: Map<string, { weight: number; poam_allowed: boolean }>
): EnrichedScopeExclusion[] {
  return exclusions.map(exclusion => {
    const nistRef = exclusion.requirement_id.split('-').slice(1).join('-');
    const weightInfo = sprsWeights.get(nistRef);
    if (!weightInfo) {
      throw new Error(`SPRS weight not found for nist_ref "${nistRef}" (requirement_id: ${exclusion.requirement_id})`);
    }
    return {
      requirement_id: exclusion.requirement_id,
      justification: exclusion.justification,
      si_field: exclusion.si_field,
      si_value: exclusion.si_value,
      nist_ref: nistRef,
      sprs_weight: weightInfo.weight as 1 | 3 | 5,
    };
  });
}

/**
 * Load SPRS weights from the canonical ces-shared table
 * (`ces-shared/data/sprs-weights`, schema `sprs-weights/2.x`). FX2-ST1: Stamper keeps
 * no local copy. `filePath` overrides the source (tests / tooling only).
 * Throws if file missing or malformed (fail-fast).
 */
export function loadSprsWeights(
  filePath?: string
): Map<string, { weight: 1 | 3 | 5; poam_allowed: boolean }> {
  const resolvedPath = filePath ?? resolveSharedDataPath('sprs-weights.json');

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`SPRS weights file not found: ${resolvedPath}`);
  }

  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse SPRS weights file: ${resolvedPath}`);
  }

  if (filePath === undefined && !String(data.schema_version ?? '').startsWith('sprs-weights/2.')) {
    throw new Error(`Unsupported SPRS weights schema "${data.schema_version}" in ${resolvedPath} (expected sprs-weights/2.x)`);
  }

  if (!data.controls || !Array.isArray(data.controls)) {
    throw new Error(`Malformed SPRS weights file: expected "controls" array in ${resolvedPath}`);
  }

  const map = new Map<string, { weight: 1 | 3 | 5; poam_allowed: boolean }>();
  for (const entry of data.controls) {
    if (!entry.nist_ref || entry.weight == null || typeof entry.poam_allowed !== 'boolean') {
      throw new Error(`Malformed SPRS weights entry: ${JSON.stringify(entry)}`);
    }
    map.set(entry.nist_ref, {
      weight: entry.weight as 1 | 3 | 5,
      poam_allowed: entry.poam_allowed,
    });
  }

  return map;
}
