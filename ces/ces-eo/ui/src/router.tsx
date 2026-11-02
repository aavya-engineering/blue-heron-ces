// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Routes under /app/ (EoServer's eo-ui-router serves index.html for each). Modelled on
// ces-stamper/ui/src/router.tsx. Every screen renders inside the kit AppShell.

import { Navigate, createBrowserRouter, createMemoryRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import App from './App';
import { SCREEN_ROUTES } from './screenRoutes';

export const SPA_BASENAME = '/app';

export function buildRoutes(): RouteObject[] {
  const children: RouteObject[] = [
    { index: true, element: <Navigate to="access" replace /> },
    ...SCREEN_ROUTES.map(({ path, Component }) => ({ path, element: <Component /> })),
    { path: '*', element: <Navigate to="access" replace /> },
  ];
  return [{ path: '/', element: <App />, children }];
}

export function createAppRouter() {
  return createBrowserRouter(buildRoutes(), { basename: SPA_BASENAME });
}

/** Test seam: the same routes in memory. */
export function createTestRouter(initialPath = '/') {
  return createMemoryRouter(buildRoutes(), { initialEntries: [initialPath] });
}

export { SCREEN_ROUTES } from './screenRoutes';
