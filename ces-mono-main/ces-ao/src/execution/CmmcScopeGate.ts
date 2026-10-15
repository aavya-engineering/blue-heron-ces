// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G-AO-CMMC-BOUND-1 M2: CmmcScopeGate
// Evaluates whether an AoCommand may run against a tenant's CMMC posture.

import type { AoCommand } from '../types/AoCommand.js';
import type { TenantConfig } from 'ces-shared/config';

/**
 * M0 landed on ces-shared 0.3.0 (GP-SHARED-M0-1, 2026-07-25): `cmmcLevel` /
 * `assessmentScope` / `cuiBoundary` now live on `TenantConfig` itself, so the
 * M2-era carve-out collapsed onto the sibling type. What remains local:
 *  - `cmmcMigrationExempt` — deliberately NOT a schema field (informal
 *    registry-record convention, M0 memo addendum);
 *  - `kind` — the ces-tenant registry-record discriminator; absent on configs
 *    loaded from an explicit file path. UPDATE (2026-07-27): ces-tenant's M0
 *    mirror has now landed (ces-tenant 0.5.0 — `parseTenantRecord` maps
 *    `cmmc_level` / `assessment_scope` / `cui_boundary` / `cmmc_migration_exempt`
 *    and load-time-rejects the Case-B foot-gun). UPDATE (2026-07-27): the
 *    registry *data* has now migrated — audit coverage is 100% (6 exempt: dev +
 *    5 sim; 1 migrated: vfsgov-xtra L2), so Phase 2 (fail-closed) is now the
 *    default (see CMMC_STRICT_DEFAULT below). `cmmcMigrationExempt` records are
 *    the carve-out that keeps dev/sim commands running post-flip.
 */
export interface CmmcTenantFields {
  cmmcMigrationExempt?: boolean;
  kind?: 'live' | 'sim';
}
export type CmmcAwareTenantConfig = TenantConfig & CmmcTenantFields;

/**
 * Phase policy default. `true` activates Phase 2 (fail-closed): any non-exempt
 * tenant with no `cmmcLevel` blocks every command carrying `cmmcPractices`.
 * `cmmcMigrationExempt` records (dev placeholder, ephemeral `kind:'sim'` tenants)
 * are the carve-out — see evaluate() below.
 *
 * FLIPPED TO `true` (Phase 2) — 2026-07-27, GP-AO-BOUND-1 ("complete the spokes").
 * The migration policy's precondition — **100% of active tenant registry records
 * carry `cmmcLevel` (or are `cmmcMigrationExempt`)** — is now MET:
 * `npm run audit-cmmc-migration` reports **100.0%** (7 records: 6 exempt [dev +
 * 5 sim], 1 migrated [vfsgov-xtra L2]) after ces-tenant landed sim-default-exempt
 * (583a474) and the `~/.ces` data migrated. From here, an unmigrated NON-exempt
 * tenant fails closed by default (operators can opt back to Phase-1 fail-open per
 * call via `--no-strict` / strictCmmc:false, or per-tenant via cmmcMigrationExempt).
 */
export const CMMC_STRICT_DEFAULT = true;

export interface CmmcGateOptions {
  /** Explicit override (e.g. future CLI --strict-cmmc thread). If omitted, env var AO_CMMC_STRICT is consulted, then CMMC_STRICT_DEFAULT. */
  strictCmmc?: boolean;
}

export interface CmmcGateResult {
  allow: boolean;
  reason?: string;
  warning?: string;
}

function isStrictMode(opts?: CmmcGateOptions): boolean {
  if (opts?.strictCmmc !== undefined) return opts.strictCmmc;
  if (process.env.AO_CMMC_STRICT === '1') return true;
  return CMMC_STRICT_DEFAULT;
}

function commandRequiresL2(aoCommand: Pick<AoCommand, 'cmmcPractices'>): boolean {
  return (aoCommand.cmmcPractices || []).some((p) => p.includes('.L2-'));
}

/**
 * Evaluate whether aoCommand may run against tenantConfig's CMMC posture.
 * Phase 1 (cmmcLevel absent): allow with a structured warning (fail-open-with-warning),
 * unless strict mode is active (AO_CMMC_STRICT=1 or opts.strictCmmc), in which case absence
 * fails closed. When cmmcLevel is present: an L2-only command against an L1 tenant is denied
 * regardless of phase; otherwise allowed.
 */
export function evaluate(
  tenantConfig: CmmcAwareTenantConfig,
  aoCommand: Pick<AoCommand, 'id' | 'cmmcPractices'>,
  opts?: CmmcGateOptions,
): CmmcGateResult {
  const strict = isStrictMode(opts);
  const needsL2 = commandRequiresL2(aoCommand);

  if (tenantConfig.cmmcLevel === undefined) {
    // Migration-exempt records (dev placeholder, ephemeral `kind:'sim'` tenants —
    // ces-tenant defaults sim to exempt) are declared out-of-scope for CMMC
    // migration and are subtracted from the audit's coverage denominator. The
    // fail-closed default must honor that same declaration: an exempt record is
    // NOT an assessment target, so absence of `cmmcLevel` is expected, not a gap.
    // Clean allow (no warning) — matches the correctly-scoped clean-pass convention;
    // the exemption itself is the audited record, not a per-command warning. This
    // keeps real (non-exempt) unmigrated tenants failing closed, so Phase-2
    // coverage is not weakened.
    if (tenantConfig.cmmcMigrationExempt) {
      return { allow: true };
    }
    if (strict) {
      return {
        allow: false,
        reason: `Tenant "${tenantConfig.tenantSlug}" has no cmmcLevel set and strict CMMC enforcement is active (fail-closed).`,
      };
    }
    return {
      allow: true,
      warning: `Tenant "${tenantConfig.tenantSlug}" has no cmmcLevel set (Phase 1 migration window) — allowing command ${aoCommand.id} without CMMC-level enforcement.`,
    };
  }

  if (needsL2 && tenantConfig.cmmcLevel === 'L1') {
    return {
      allow: false,
      reason: `Command ${aoCommand.id} requires CMMC L2 practices but tenant "${tenantConfig.tenantSlug}" is scoped to L1.`,
    };
  }

  return { allow: true };
}
