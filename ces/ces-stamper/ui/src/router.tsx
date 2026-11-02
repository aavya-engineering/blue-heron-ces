// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Routes under /app/ (AD-3; GuiServer's history fallback serves index.html for each).
// The six rail steps share their ids with the screen paths. The pop-out renders without
// the shell (it opens in its own window, as the legacy evidence-popout.html does).

import type { ComponentType } from 'react';
import { Navigate, createBrowserRouter, createMemoryRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import App from './App';
import TenantScreen from './screens/tenant';
import ConfigureScreen from './screens/configure';
import AssessScreen from './screens/assess';
import TranslateScreen from './screens/translate';
import ExecuteScreen from './screens/execute';
import ConsoleScreen from './screens/console';
import EvidenceScreen from './screens/evidence';
import VariablesScreen from './screens/variables';
import RegistryScreen from './screens/registry';
import PopoutScreen from './screens/popout';

export const SPA_BASENAME = '/app';

export interface ScreenRoute {
  path: string;
  Component: ComponentType;
  /** False for the pop-out, which renders outside the AppShell. */
  inShell: boolean;
}

export const SCREEN_ROUTES: readonly ScreenRoute[] = [
  { path: 'tenant', Component: TenantScreen, inShell: true },
  { path: 'configure', Component: ConfigureScreen, inShell: true },
  { path: 'assess', Component: AssessScreen, inShell: true },
  { path: 'translate', Component: TranslateScreen, inShell: true },
  { path: 'execute', Component: ExecuteScreen, inShell: true },
  { path: 'console', Component: ConsoleScreen, inShell: true },
  { path: 'evidence', Component: EvidenceScreen, inShell: true },
  { path: 'variables', Component: VariablesScreen, inShell: true },
  { path: 'registry', Component: RegistryScreen, inShell: true },
  { path: 'popout', Component: PopoutScreen, inShell: false },
];

export function buildRoutes(): RouteObject[] {
  const shellChildren: RouteObject[] = [
    { index: true, element: <Navigate to="tenant" replace /> },
    ...SCREEN_ROUTES.filter((r) => r.inShell).map(({ path, Component }) => ({ path, element: <Component /> })),
    { path: '*', element: <Navigate to="tenant" replace /> },
  ];
  const standalone: RouteObject[] = SCREEN_ROUTES.filter((r) => !r.inShell).map(({ path, Component }) => ({
    path: `/${path}`,
    element: <Component />,
  }));
  return [...standalone, { path: '/', element: <App />, children: shellChildren }];
}

export function createAppRouter() {
  return createBrowserRouter(buildRoutes(), { basename: SPA_BASENAME });
}

/** Test seam: the same routes in memory. */
export function createTestRouter(initialPath = '/') {
  return createMemoryRouter(buildRoutes(), { initialEntries: [initialPath] });
}
