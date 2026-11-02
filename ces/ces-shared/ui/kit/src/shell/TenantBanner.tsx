// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface TenantBannerProps {
  /** Tenant display name or slug. */
  tenant: string;
  /** Tenant kind, e.g. "GCC High" or "Fixture". */
  kind?: string;
  /** True when the GUI was launched against the stack simulator. */
  simulator?: boolean;
  /** Simulator customer profile, e.g. "s1-mach". */
  simulatorProfile?: string;
  id?: string;
}

/** Status-bar row (legacy `#statusBar` position) naming the tenant and whether it is simulated. */
export function TenantBanner({ tenant, kind, simulator = false, simulatorProfile, id = 'tenantBanner' }: TenantBannerProps) {
  return (
    <section
      id={id}
      className={simulator ? 'ck-banner ck-banner-sim' : 'ck-banner ck-banner-live'}
      aria-label="Tenant"
      data-simulator={simulator ? 'true' : 'false'}
    >
      <span className="ck-banner-tenant">{tenant}</span>
      {kind ? <span className="ck-banner-kind">{kind}</span> : null}
      <span className="ck-banner-mode">
        {simulator
          ? `Simulator${simulatorProfile ? ` (${simulatorProfile})` : ''}: commands run against a simulated tenant, not a live one.`
          : 'Live tenant'}
      </span>
    </section>
  );
}
