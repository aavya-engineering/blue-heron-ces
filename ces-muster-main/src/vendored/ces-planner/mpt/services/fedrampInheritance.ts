// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline } from '../../shared/types/artifacts';

export interface FedRAMPInheritanceEntry {
  control_id: string;
  domain: string;
  title: string;
  requires_fields: string[];
  tenant_variants: string[];
  rationale: string;
}

export interface FedRAMPInheritanceTable {
  metadata: { version: string; description: string };
  controls: FedRAMPInheritanceEntry[];
}

export interface InheritanceResult {
  control_id: string;
  inherited: true;
  rationale: string;
  fedramp_package_id: string;
  tenant_variant: string;
  requires_stamper_verification: boolean;
}

/**
 * Evaluate whether a control qualifies for FedRAMP inheritance.
 * 5-step pure function:
 *   1. deployment_posture must be 'cloud_only'
 *   2. fedramp_package_ids must be non-empty
 *   3. control_id must exist in table
 *   4. Per-control requires_fields check
 *   5. tenant_model_preference must be in entry's tenant_variants
 *
 * Returns InheritanceResult if eligible, null otherwise.
 */
export function evaluateInheritance(
  siBaseline: SIBaseline,
  controlId: string,
  table: FedRAMPInheritanceTable,
): InheritanceResult | null {
  const scope = siBaseline.si_baseline?.scope;
  const deps = siBaseline.si_baseline?.dependencies;

  // Step 1: deployment_posture must be cloud_only
  if (scope?.deployment_posture !== 'cloud_only') return null;

  // Step 2: fedramp_package_ids must be non-empty
  const packageIds = deps?.fedramp_package_ids;
  if (!packageIds || packageIds.length === 0) return null;

  // Step 3: control_id must exist in table
  const entry = table.controls.find((c) => c.control_id === controlId);
  if (!entry) return null;

  // Step 4: Per-control requires_fields check
  for (const field of entry.requires_fields) {
    if (field === 'physical_facility_count_zero') {
      if (deps?.physical_facility_count !== 0) return null;
    } else if (field === 'customer_equipment_count_zero') {
      if (deps?.customer_equipment_count !== 0) return null;
    }
  }

  // Step 5: tenant_model_preference must be in entry's tenant_variants
  const tenantModel = deps?.tenant_model_preference;
  if (!tenantModel || !entry.tenant_variants.includes(tenantModel)) return null;

  return {
    control_id: controlId,
    inherited: true,
    rationale: entry.rationale,
    fedramp_package_id: packageIds[0],
    tenant_variant: tenantModel,
    requires_stamper_verification: true,
  };
}

/**
 * Validate FedRAMP Package ID format.
 * Expected pattern: F followed by 10 digits (e.g., F1234567890).
 * Returns { valid, invalid } arrays.
 */
export function validatePackageIdFormat(ids: string[]): {
  valid: string[];
  invalid: string[];
} {
  const pattern = /^F\d{10}$/;
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const id of ids) {
    if (pattern.test(id)) {
      valid.push(id);
    } else {
      invalid.push(id);
    }
  }

  return { valid, invalid };
}
