// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The SPA shell: kit AppShell (legacy header ids, theme toggle), the six-step rail from the
// workflow store (locked steps cannot be selected), and the tenant banner, whose simulator
// flag comes from /health (`simulator.active`, the GUI's launch environment). The dev quick
// run sits outside the cards on the console screens, as legacy's #devQuickRunWrap sits after
// card 5 outside every card (index.html L4625-4631); the variables and registry screens stand
// for legacy's separate pages, which have none.

import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppShell, StepRail, TenantBanner } from 'ces-ui-kit';
import { stamperApi } from './api';
import { isUnlocked, toRailSteps, useWorkflowStore } from './store';
import type { StepId } from './store';
import { DevQuickRun } from './screens/translate';

export const NO_TENANT_LABEL = 'No tenant selected';

/** Screens that stand for legacy's separate pages (unified-variables.html, registry-editor.html). */
const SEPARATE_PAGE_SCREENS = ['/variables', '/registry'];

export default function App() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const consoleScreen = !SEPARATE_PAGE_SCREENS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const steps = useWorkflowStore((s) => s.steps);
  const tenant = useWorkflowStore((s) => s.tenant);
  const health = useQuery({ queryKey: ['health'], queryFn: stamperApi.health });

  const onSelect = (id: string) => {
    if (isUnlocked(steps, id as StepId)) navigate(`/${id}`);
  };

  return (
    <AppShell
      product="Stamper"
      rail={<StepRail steps={toRailSteps(steps)} onSelect={onSelect} />}
      banner={<TenantBanner tenant={tenant ?? NO_TENANT_LABEL} simulator={health.data?.simulator.active ?? false} />}
    >
      <Outlet />
      {consoleScreen ? <DevQuickRun /> : null}
    </AppShell>
  );
}
