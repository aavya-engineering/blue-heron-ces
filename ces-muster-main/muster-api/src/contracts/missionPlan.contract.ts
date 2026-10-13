// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Mission-plan contract — MS-R1 (flow-through M3).
//
// Muster no longer carries its own schema. Every Zod schema here is the
// canonical ces-shared contract (`ces-shared/types/mission-plan`, via the
// `file:../../ces-shared` dependency) — the same schema Stamper validates
// with, so "passes Muster" means "Stamper takes it". This module only
// re-exports it and adapts safeParse into the route's error-list shape.
//
// Version gating is the shared contract's own: `ces.version` is
// z.enum(SUPPORTED_PLAN_VERSIONS), so an unknown version fails with a
// path-bearing `ces.version` issue. Never re-declare or loosen it here —
// a shared-contract gap goes to docs/requirements/REQ-ces-shared-*.md.
import {
  InfraManifestSchema,
  ManualMissionPlanSchema,
  TenantManifestSchema,
} from 'ces-shared/types/mission-plan';

export * from 'ces-shared/types/mission-plan';

export interface ContractValidationResult {
  ok: boolean;
  errors: string[];
}

// Structural (not zod's ZodError) so it is indifferent to which zod copy
// ces-shared resolves.
type SafeParseLike =
  | { success: true }
  | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } };

function toResult(r: SafeParseLike): ContractValidationResult {
  if (r.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}

export function validateMissionPlan(plan: unknown): ContractValidationResult {
  return toResult(ManualMissionPlanSchema.safeParse(plan));
}

export function validateTenantManifest(manifest: unknown): ContractValidationResult {
  return toResult(TenantManifestSchema.safeParse(manifest));
}

/** W4-MU1 (MS-R7): the Infrastructure Manifest, canonical ces-shared schema. */
export function validateInfraManifest(manifest: unknown): ContractValidationResult {
  return toResult(InfraManifestSchema.safeParse(manifest));
}
