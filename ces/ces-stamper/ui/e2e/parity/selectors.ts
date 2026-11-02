// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Stable selectors for the parity specs (AD-4: the SPA keeps the demo driver's ids).
// STAMPER_SELECTORS mirrors ces-tester/src/demo/stamper-ui-driver.ts `STAMPER_SELECTORS`
// verbatim (keys, order, values). W8-UIT1's contract test asserts the two stay equal; change
// both together. Pure data: no Playwright import, so unit tests can load this file.

export const STAMPER_SELECTORS = {
  tenantSelect: '#tenantSelect',
  tenantOption: (slug: string) => `#tenantSelect option[value="${slug}"]`,
  connectionGate: '#connectionGateWrap',
  gateAllow: '#gateAllowBtn',
  card: (n: number) => `#workflowCard${n}`,
  connectErrorRows: '#taskList .connection-log-row .log-icon.error',
  missionPlanPath: '#configMissionPlanPath',
  manifestPath: '#configManifestPath',
  assess: '#btnAssess',
  cardStatus2: '#cardStatus2',
  translate: 'button[onclick="doTranslate()"]',
  cardStatus3: '#cardStatus3',
  execMode: '#execModeSelect',
  execTarget: '#execTargetSelect',
  execute: '#btnExecuteMatrix',
  executeHalt: '#btnHalt',
  cardStatus4: '#cardStatus4',
  reportLinks: '#resultsContent .report-links a',
} as const;

export type ParityProject = 'legacy' | 'react';

/** Shell selectors shared by both consoles (legacy markup and the kit's AppShell/StepRail). */
export const SHELL_SELECTORS = {
  header: '#header',
  themeToggle: '#ces-theme-toggle',
  railNode: (index: number) => `#railNode${index}`,
  /** SPA only: the kit's TenantBanner. */
  tenantBanner: '#tenantBanner',
} as const;

export type RailState = 'locked' | 'ready' | 'running' | 'done' | 'failed';

/**
 * A rail node in a given state. Legacy sets `class="rail-node rail-<state>"`;
 * the kit sets `data-state="<state>"` (and class `ck-rail-<state>`).
 */
export function railNodeInState(project: ParityProject, index: number, state: RailState): string {
  return project === 'legacy'
    ? `#railNode${index}.rail-${state}`
    : `#railNode${index}[data-state="${state}"]`;
}

/** SPA screen routes under /app/ (router.tsx SCREEN_ROUTES; unit test keeps them equal). */
export const SPA_SCREEN_PATHS = [
  'tenant',
  'configure',
  'assess',
  'translate',
  'execute',
  'console',
  'evidence',
  'variables',
  'registry',
  'popout',
] as const;

/** Each placeholder (and later, real) screen root. */
export const spaScreen = (id: string) => `[data-screen="${id}"]`;
