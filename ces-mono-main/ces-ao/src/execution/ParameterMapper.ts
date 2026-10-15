// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 6: Parameter Mapper
// Maps AO parameters to variable dictionary for template substitution

import type { AoCommand } from '../types/AoCommand.js';
import type { TenantConfig } from 'ces-shared/config';
import type { CmmcAwareTenantConfig } from './CmmcScopeGate.js';
import {
  resolveSource,
  isResourceSource,
  describeUnboundSource,
  UnboundSourceError,
  resolveDottedPath,
} from './SourceBindings.js';

export { UnboundSourceError } from './SourceBindings.js';

/**
 * Map AO parameters to variables for template substitution.
 * Two sources:
 * 1. Config-sourced variables: Resolve parameter.source from tenantConfig (with dotted-path support)
 * 2. User-provided variables: Merge userInputs from form submission
 *
 * Dotted-path navigation:
 * - "tenantId" → tenantConfig.tenantId
 * - "endpoints.graph" → tenantConfig.endpoints.graph
 * - "subscription.subscription_id" → tenantConfig.subscription.subscription_id
 *
 * Implementation: Split on '.', walk object tree.
 *
 * Returns flattened key-value map:
 * { TENANT_ID: "abc-123", ENDPOINTS_GRAPH: "https://...", upn: "user@..." }
 *
 * G-AO-CMMC-BOUND-1 M3: resolved `resources.*` values are checked against
 * `tenantConfig.cuiBoundary` (allowlist or tag match) before substitution.
 * Fails closed (throws) with a named reason rather than a silent pass-through —
 * see checkCuiBoundary() below for the phase policy.
 */
export function mapAoParametersToVariables(
  aoCommand: AoCommand,
  tenantConfig: TenantConfig,
  userInputs: Record<string, any>
): Record<string, string> {
  const variables: Record<string, string> = {};
  const cmmcTenant = tenantConfig as CmmcAwareTenantConfig;

  // 1. Config-sourced variables — W4-AO2: resolved through the SourceBindings
  //    table (literal path, then the canonical tenant-object keys, then a
  //    platform constant where one exists), never guessed.
  const unresolved = new Map<string, { source: string; tried: string[]; required: boolean }>();
  for (const param of aoCommand.parameters) {
    if (param.source) {
      const resolved = resolveSource(tenantConfig, param.source);
      if (resolved.value !== undefined) {
        if (resolved.resourceBound) {
          checkCuiBoundary(cmmcTenant, resolved.from ?? param.source, resolved.value);
        }
        // Key by the parameter name so it matches the {paramName} / ${paramName}
        // placeholder in the command template (e.g. param.name "firewallName"
        // -> template ${firewallName}). The source path may be dotted
        // (e.g. "resources.firewallName"); the placeholder uses the short name.
        variables[param.name] = resolved.value;
      } else {
        unresolved.set(param.name, { source: param.source, tried: resolved.tried, required: !!param.required });
      }
    }
  }

  // 2. User-provided variables (merge userInputs).
  // FX-AO1: the CUI-boundary decision comes ONLY from the server-side tenant record.
  //  - A request value for a `source`d parameter never overrides the tenant-resolved
  //    value (ignored + logged) — otherwise a request could swap an in-boundary
  //    resource for an out-of-boundary one after the check above passed.
  //  - A request value for a `resources.*`-sourced parameter is itself checked
  //    against the tenant's cuiBoundary (fail-closed, same policy), whether or not
  //    the tenant value resolved — so an unresolvable source cannot be filled by the
  //    request to bypass the check.
  const sourcedParams = new Map<string, string>();
  for (const param of aoCommand.parameters) {
    if (param.source) sourcedParams.set(param.name, param.source);
  }
  for (const [key, value] of Object.entries(userInputs ?? {})) {
    const source = sourcedParams.get(key);
    if (source !== undefined) {
      if (isResourceSource(source)) {
        checkCuiBoundary(cmmcTenant, source, String(value));
      }
      if (Object.prototype.hasOwnProperty.call(variables, key)) {
        if (variables[key] !== String(value)) {
          console.warn(
            `[ParameterMapper] ignoring request override of tenant-sourced parameter "${key}" ` +
              `(source "${source}") for tenant "${tenantConfig.tenantSlug}" — the tenant record value wins.`
          );
        }
        continue;
      }
    }
    variables[key] = String(value);
  }

  // 3. W4-AO2: a REQUIRED tenant-sourced parameter that neither the tenant record
  //    nor the request supplied is genuinely unknown — fail with a named reason
  //    instead of sending a command with an unsubstituted placeholder.
  const unbound = [...unresolved.entries()]
    .filter(([name, u]) => {
      // An empty/whitespace request value is not a value: it must not satisfy a required
      // tenant-sourced parameter (fail closed — nothing is sent to the tenant).
      const v = variables[name];
      return u.required && (v === undefined || String(v).trim() === '');
    })
    .map(([name, u]) => ({ param: name, source: u.source, tried: u.tried }));
  if (unbound.length > 0) {
    throw new UnboundSourceError(
      unbound.map((u) => describeUnboundSource(u.param, u.source, tenantConfig.tenantSlug, u.tried)).join('; '),
      unbound,
    );
  }

  return variables;
}

/**
 * GP-AO-BOUND-1 M3 (evidence check): CUI-boundary denials throw a TYPED error so
 * CommandExecutor can distinguish a boundary decision from an ordinary failure
 * and emit it as enforcement evidence. Same throw semantics as before (callers
 * that only catch `Error` are unaffected — this is a subclass).
 */
export class CuiBoundaryDenialError extends Error {
  constructor(message: string, public readonly boundaryCase: 'out-of-boundary' | 'case-a-strict' | 'case-b-footgun') {
    super(message);
    this.name = 'CuiBoundaryDenialError';
  }
}

function isStrictMode(): boolean {
  return process.env.AO_CMMC_STRICT === '1';
}

/**
 * Check a resolved `resources.*` value against tenantConfig.cuiBoundary before
 * substitution. Fail-closed: throws a named-reason Error on any denial — never a
 * silent pass-through.
 *
 * - cuiBoundary present: allow on resourceAllowlist match OR tagKey/tagValue match;
 *   deny otherwise (both phases).
 * - cuiBoundary absent, cmmcLevel also absent (Case A — pre-migration tenant):
 *   Phase 1 → warn + allow; Phase 2/strict → deny.
 * - cuiBoundary absent, cmmcLevel present (Case B — foot-gun record): always deny,
 *   both phases, with the distinct reason "cuiBoundary missing on cmmcLevel-scoped tenant".
 */
function checkCuiBoundary(tenantConfig: CmmcAwareTenantConfig, source: string, value: string): void {
  // Migration-exempt records (dev placeholder, ephemeral sim tenants) are not CMMC
  // assessment targets — CmmcScopeGate lets them through, so the CUI-boundary check
  // must not fail them closed either (keeps gate + parameter-mapper consistent, incl.
  // under AO_CMMC_STRICT=1). Real non-exempt tenants are unaffected.
  if (tenantConfig.cmmcMigrationExempt) {
    return;
  }

  const cuiBoundary = tenantConfig.cuiBoundary;

  if (cuiBoundary === undefined) {
    if (tenantConfig.cmmcLevel !== undefined) {
      // Case B — foot-gun record: cmmcLevel scoped but no boundary defined.
      throw new CuiBoundaryDenialError(
        `cuiBoundary missing on cmmcLevel-scoped tenant "${tenantConfig.tenantSlug}" ` +
          `(param source "${source}").`,
        'case-b-footgun'
      );
    }
    // Case A — pre-migration tenant (cmmcLevel also absent).
    if (isStrictMode()) {
      throw new CuiBoundaryDenialError(
        `Tenant "${tenantConfig.tenantSlug}" has no cuiBoundary set and AO_CMMC_STRICT is active ` +
          `(fail-closed) — denying resource param source "${source}".`,
        'case-a-strict'
      );
    }
    console.warn(
      `[CmmcScopeGate] Tenant "${tenantConfig.tenantSlug}" has no cuiBoundary set (Phase 1 migration ` +
        `window) — allowing resource param source "${source}" without CUI-boundary enforcement.`
    );
    return;
  }

  const { resourceAllowlist, tagKey, tagValue } = cuiBoundary;

  if (resourceAllowlist && resourceAllowlist.includes(value)) {
    return;
  }
  if (tagKey && tagValue && resolveDottedPath(tenantConfig, tagKey) === tagValue) {
    return;
  }

  throw new CuiBoundaryDenialError(
    `Resource param source "${source}" (value "${value}") is outside tenant ` +
      `"${tenantConfig.tenantSlug}"'s cuiBoundary (no resourceAllowlist or tag match).`,
    'out-of-boundary'
  );
}
