// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The EO SPA shell, modelled on Stamper's (ces-stamper/ui/src/App.tsx): the kit AppShell with the
// header "CES Blue Heron Defense — EvidenceOps" (legacy header-company text), the kit TabNav as the
// page navigation (EO has no step rail: its pages are not a fixed sequence), and the kit
// TenantBanner, whose simulator flag comes from GET /api/ui/info.

import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppShell, TabNav, TenantBanner } from 'ces-ui-kit';
import { eoApi } from './api/eo';
import { useSession } from './store/session';
import { SCREEN_ROUTES } from './screenRoutes';

export const NO_TENANT_LABEL = 'No tenant selected';
export const PRODUCT_NAME = 'EvidenceOps';

export default function App() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tenant = useSession((s) => s.tenant);
  const serviceToken = useSession((s) => s.serviceToken);
  const info = useQuery({ queryKey: ['ui-info', serviceToken], queryFn: eoApi.uiInfo, retry: false });
  const health = useQuery({ queryKey: ['health', serviceToken], queryFn: eoApi.health, retry: false });
  const active = SCREEN_ROUTES.find((r) => pathname === `/${r.path}` || pathname.startsWith(`/${r.path}/`))?.path ?? 'access';

  return (
    <AppShell
      product={PRODUCT_NAME}
      version={health.data?.version ? `v${health.data.version}` : undefined}
      banner={<TenantBanner tenant={tenant ?? NO_TENANT_LABEL} simulator={info.data?.simulator.active ?? false} />}
    >
      <nav className="eo-nav" aria-label="EvidenceOps screens">
        <TabNav
          label="EvidenceOps screens"
          idPrefix="eo-tab-"
          tabs={SCREEN_ROUTES.map((r) => ({ id: r.path, label: r.label, controls: 'eo-screen-panel' }))}
          active={active}
          onChange={(id) => navigate(`/${id}`)}
        />
      </nav>
      <div id="eo-screen-panel" role="tabpanel" aria-labelledby={`eo-tab-${active}`}>
        <Outlet />
      </div>
    </AppShell>
  );
}
