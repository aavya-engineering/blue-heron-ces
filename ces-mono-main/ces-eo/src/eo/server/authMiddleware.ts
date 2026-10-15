// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EvidenceOps endpoint authentication — env-gated bearer token + optional tenant pin.
//
// G-ENG-4: this now delegates to the shared CES bearer-auth middleware
// (ces-shared/http), which enforces the "loopback trusted, network requires a token" model:
//   • CES_EO_AUTH_TOKEN set   → every /api/* request needs `Authorization: Bearer <token>`.
//   • CES_EO_AUTH_TOKEN unset → /api/* allowed from LOOPBACK only; network requests are rejected
//     401 (previously they were a silent no-op — the finding this closes). Local dev stays
//     zero-friction (loopback needs no token).
// CES_EO_TENANT still pins the allowed tenant. Non-/api paths (GUI, static) remain open.

import { createBearerAuthMiddleware } from 'ces-shared/http';

export interface EoAuthOptions {
  /** Required bearer token. Empty/undefined ⇒ dev mode (loopback-only). */
  token?: string;
  /** Optional: only allow requests whose tenant matches this slug. */
  tenant?: string;
}

/** Read auth options from the environment (CES_EO_AUTH_TOKEN / CES_EO_TENANT). */
export function readEoAuthOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): EoAuthOptions {
  return { token: env.CES_EO_AUTH_TOKEN, tenant: env.CES_EO_TENANT };
}

/** Express middleware: shared bearer-auth with EO's service name + tenant pin. */
export function createEoAuthMiddleware(opts: EoAuthOptions) {
  return createBearerAuthMiddleware({ token: opts.token, tenant: opts.tenant, service: 'evidenceops' });
}
