// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SCOPE (narrowed at G-TENANT-M1): these helpers anchor PLAN/EVIDENCE
// ARTIFACT paths only — plan-data/<slug>/{plans,logs,state,evidence}/ and
// workspace plan artifacts — which stay outside ces-tenant's scope fence
// (design doc §3, "no evidence storage").
//
// TENANT-CONNECTION CONFIG RESOLUTION MUST NOT USE THIS FILE. Tenant records
// are owned by the ces-tenant registry — resolve them through
// src/tenant/stamperTenants.ts (resolveTenantRecordPath / the registry API)
// exclusively. The one sanctioned exception is stamperTenants'
// seedRegistryFromRepoPlanData(), the one-time forward migration of the
// legacy repo plan-data tenant JSONs into the registry.
//
// src/config/paths.ts -> dist/config/paths.js: two '..' reaches src/ or dist/,
// a third reaches repo root. Depth parity holds only while this file stays at
// src/config/ — see tsconfig.json rootDir/outDir invariant in PLAN.md.
export function getRepoRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export function getPlanDataRoot(): string {
  return path.join(getRepoRoot(), 'plan-data');
}

export function getTenantPlanDataDir(slug: string): string {
  return path.join(getPlanDataRoot(), slug);
}
