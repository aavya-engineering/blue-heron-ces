// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO3 (2026-09-27): AO's wiring of the ces-shared authenticated request
// principal (W4-SH1, `ces-shared/http/principal`).
//
// Two-person approval decisions REQUIRE a verified principal: the persisted
// approver is the principal's UPN, never a body field. Posture comes from env:
//   CES_AO_PRINCIPAL_SECRET     HS256 secret (>= 16 chars) for x-ces-principal tokens
//   CES_AO_PRINCIPAL_ISSUER     optional required `iss`
//   CES_AO_PRINCIPAL_AUDIENCE   optional required `aud`
//   CES_AO_DEV_PRINCIPAL_UPN    EXPLICIT local-dev principal (loopback only, marked
//                               verified:false by ces-shared) — never in a deployment
//   CES_AO_DEV_PRINCIPAL_TENANT FC-AO-3 step 2: the tenant the dev principal may decide on.
//                               ces-shared's dev principal carries no tenant claim, so AO
//                               attaches this env value itself (withDevApproverTenant, below)
//                               before the decision reaches ApprovalStore's tenant check.
//                               UPN set with no tenant configured => fail closed (refused).
// Nothing set => every decision request is refused with 401 (fail closed).
// FC-AO-3 step 1 (founder decision 10): only an `ao-approver`-role principal may decide, so
// the dev principal is constructed with that role — see ApprovalStore.assertApproverRole.
//
// The execute route attaches a principal OPTIONALLY: when a principal token is
// sent it must verify (else 401), and the requestor becomes that principal's
// UPN (a differing body requestorUPN is ignored). Without a token the request
// proceeds with the body requestorUPN as before, so SoD compares an
// authenticated approver against the recorded requestor.

import {
  requirePrincipal,
  createHs256PrincipalVerifier,
  DEFAULT_PRINCIPAL_HEADER,
  type RequirePrincipalOptions,
  type RequirePrincipalMiddleware,
} from 'ces-shared/http/principal';
import { REQUIRED_APPROVER_ROLE } from '../execution/ApprovalStore.js';

export function aoPrincipalOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): RequirePrincipalOptions {
  const secret = env.CES_AO_PRINCIPAL_SECRET;
  const devUpn = env.CES_AO_DEV_PRINCIPAL_UPN;
  return {
    service: 'adminops',
    ...(secret
      ? {
          verifier: createHs256PrincipalVerifier({
            secret,
            ...(env.CES_AO_PRINCIPAL_ISSUER ? { issuer: env.CES_AO_PRINCIPAL_ISSUER } : {}),
            ...(env.CES_AO_PRINCIPAL_AUDIENCE ? { audience: env.CES_AO_PRINCIPAL_AUDIENCE } : {}),
          }),
        }
      : {}),
    ...(devUpn
      ? {
          devPrincipal: {
            subjectId: `dev:${devUpn}`,
            upn: devUpn,
            displayName: 'AO local dev principal',
            // FC-AO-3 step 1: the dev principal must carry the required role too, so it is
            // checked by the same single function every other surface goes through.
            roles: [REQUIRED_APPROVER_ROLE],
          },
        }
      : {}),
  };
}

/**
 * FC-AO-3 step 2: ces-shared's dev loopback principal carries no tenant claim (its
 * `DevPrincipalConfig` has no such field). AO binds it to a tenant itself: when the principal
 * is the dev-unverified one, attach `CES_AO_DEV_PRINCIPAL_TENANT` as its `tenantId` so
 * ApprovalStore.assertApproverTenant applies the SAME fail-closed tenant check it applies to a
 * token principal (no tenant configured => refused, not silently allowed on every tenant).
 * A verified token principal is returned unchanged.
 */
export function withDevApproverTenant<T extends { source: string; tenantId?: string }>(
  principal: T,
  env: NodeJS.ProcessEnv = process.env
): T {
  if (principal.source !== 'dev-unverified') return principal;
  const tenantId = env.CES_AO_DEV_PRINCIPAL_TENANT;
  return tenantId && tenantId.trim() ? { ...principal, tenantId } : principal;
}

/** Guard for a router-relative route: every request it sees must carry a principal. */
export function requireAoPrincipal(opts: RequirePrincipalOptions): RequirePrincipalMiddleware {
  // Routers are mounted at /api, so req.path is router-relative ('/approvals/...').
  return requirePrincipal({ ...opts, apiPrefix: '/' });
}

/** Verify a principal only when the request carries a principal token; otherwise pass through. */
export function optionalAoPrincipal(opts: RequirePrincipalOptions): RequirePrincipalMiddleware {
  const guard = requireAoPrincipal({ ...opts, devPrincipal: undefined });
  const header = (opts.header ?? DEFAULT_PRINCIPAL_HEADER).toLowerCase();
  return (req, res, next) => {
    const raw = req.headers?.[header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && String(value).trim()) return guard(req, res, next);
    return next();
  };
}
