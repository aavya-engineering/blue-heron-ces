// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// tenantKeysService.ts — resolve per-tenant Graph/auth keys via ces-tenant's HTTP surface.
//
// G-TENANT-M3 cutover (2026-07-11): this module is now a thin wrapper around the
// ces-tenant package's `TenantHttpKeyProvider` surface (`PlanDataTenantHttpKeyProvider`,
// design §2.4 point 2). muster-api no longer constructs
// `{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/<slug>.json` paths itself — tenant
// resolution goes through ces-tenant exclusively (design §5, M3 gate; §6 per-consumer
// requirement). The public contract (`resolveTenantKeys`, `TenantKeys`,
// `TenantKeysError`) is unchanged for existing callers (harvest routes).
//
// CES auth is CERTIFICATE-based (appId + thumbprint; tokens minted via PowerShell
// Connect-MgGraph in ces-eo SessionManager). muster-api does NOT mint cert-assertion
// tokens in this slice — unchanged by the M3 cutover (design §6: that delegation is a
// separate founder decision). /harvest/run still takes an access_token, and the
// client_secret auth-code exchange remains the env-fallback path only.
// [validate with BHD: token acquisition strategy — cert assertion in Node vs delegating to EO sessions]

import { PlanDataTenantHttpKeyProvider } from 'ces-tenant';
import type { ConsumerIdentity, TenantKeys } from 'ces-tenant';

// Public contract re-exported unchanged: callers keep importing from this module and
// `instanceof TenantKeysError` keeps working (single class identity via ces-tenant).
export type { TenantKeys, TenantKeysErrorCode } from 'ces-tenant';
export { TenantKeysError } from 'ces-tenant';

/**
 * Caller identity, ratified 2026-07-10 amendment (ces-tenant `consumer.ts`):
 * every token request carries `consumer: { module, purpose }`. Bound once at
 * surface construction for every request this module makes.
 */
const CONSUMER: ConsumerIdentity = {
  module: 'ces-muster',
  purpose: 'resolve tenant Graph/auth keys (harvest + consent flows)',
};

/**
 * Resolve tenant keys either from tenant config (slug given) or env-var fallback (no slug).
 *
 * Behavior contract preserved from the pre-M3 implementation (recorded in ces-tenant's
 * `http-surface.ts` doc comments):
 *
 * slug given:
 *   Resolved from the tenant config for that slug (secret refs resolved, honors
 *   CES_STRICT_SECRETS); returns tenantId/appId/certThumbprint + endpoints with
 *   per-field endpoint fallback when the tenant config omits endpoints.
 *   Missing tenant config → TenantKeysError('tenant_not_found').
 *   SecretRef errors propagate (fail closed).
 *
 * no slug:
 *   Reads GRAPH_TENANT_ID / GRAPH_CLIENT_ID from env; endpoints from GRAPH_BASE_URL or
 *   the default stack. Missing env → TenantKeysError('degraded').
 */
export async function resolveTenantKeys(slug: string | undefined): Promise<TenantKeys> {
  // Constructed per call (cheap, no I/O) so environment changes — CES_PIPELINE_ROOT,
  // GRAPH_* — are honored per request, matching the pre-M3 behavior.
  //
  // ASYNC since ces-tenant 0.4.0 (ratified amendment, founder 2026-07-11):
  // the ratified `TenantHttpKeyProvider.resolveTenantKeys` returns a Promise
  // so the M6 service transport implements the same signature. Callers
  // (harvest routes) were updated to await in the same coordinated change.
  const provider = new PlanDataTenantHttpKeyProvider({ consumer: CONSUMER });
  return provider.resolveTenantKeys(slug);
}
