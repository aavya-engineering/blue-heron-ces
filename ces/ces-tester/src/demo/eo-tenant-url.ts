// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FX-TE5 — every EvidenceOps HTTP read carries the active tenant.
 *
 * ces-eo FX-EO8 (a44f6b4) scopes every route to `?tenant=<slug>`: no tenant is
 * a 400 `tenant required`, an unknown tenant is a 404, and there is no default
 * fallback (REQ-ces-tester-eo-tenant-on-assessment-reads). ces-tester therefore
 * builds every EO read URL here, from the slug the scenario/act already armed or
 * assessed. There is deliberately NO default: a blank tenant throws, so a call
 * site that loses its slug fails loudly instead of silently reading nothing.
 */

/**
 * `${baseUrl}${route}?tenant=<slug>` (or `&tenant=` when the route already has
 * a query). `baseUrl` may be `''` for a page-relative request.
 */
export function eoTenantUrl(baseUrl: string, route: string, tenant: string): string {
  if (typeof tenant !== 'string' || tenant.trim() === '') {
    throw new Error(`EvidenceOps ${route} requires a tenant (ces-eo FX-EO8) — none was supplied`);
  }
  const sep = route.includes('?') ? '&' : '?';
  return `${baseUrl.replace(/\/+$/, '')}${route}${sep}tenant=${encodeURIComponent(tenant)}`;
}
