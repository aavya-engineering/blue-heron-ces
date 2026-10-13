// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M4 — Beat 5 (AO) driven through the AdminOps GUI, as a user.
 *
 * This file satisfies the `AoUiDriver` contract M3 landed in `ao-leg.ts`
 * (the driver is INJECTED into `runAoLeg`, never imported by it), so the leg
 * keeps judging artifacts — the `adminops_evidence` row and the stacksim
 * ledger — while this layer only performs the user's actions.
 *
 * **The ordering rule** (`ces-ao/public/index.html` `openCommandForm()`):
 * every form open resets `#liveExecToggle` to dry-run. Since ces-ao FX-AO7
 * (`e53e708`) the tenant is an explicit `#tenantSelect` choice filled from
 * `GET /api/tenants` — there is no default tenant any more, the old hidden
 * `#liveTenantInput` is gone, and with no tenant selected the UI blocks
 * client-side and never calls `/api/execute` (a wait on the response would
 * hang). The select is NOT reset by a form open. So:
 *
 *   open the form -> select the sim slug in `#tenantSelect` -> `#liveExecToggle`
 *   -> ASSERT the slug stuck -> EXECUTE
 *
 * Skipping the toggle silently dry-runs. Never reopen the form after arming it.
 *
 * FX-AO7 also sends a fresh `ao-ui-<uuid>` correlationId on every execute and
 * the route echoes it; the driver reports it (`correlationId`) so the demo's
 * EV2 check can trace this click's row into EvidenceOps
 * (REQ-AO-GUI-NO-CORRELATION-ID, closed).
 *
 * The DOM renders only four fields — `commandExecuted`, `evidencePath` and the
 * hashes are absent, and two panel fields misrender outright
 * (REQ-AO-GUI-EVIDENCE-PANEL-FIELD-MISMATCH: `#evidenceVerdict` reads
 * "No verdict available" even on `SAT`, `#resultOutput` reads
 * "No output available" on an empty-stdout PATCH). So this driver reports only
 * the two badges that genuinely render, plus the body of
 * `POST /api/execute/<id>` captured from the browser's own traffic.
 */

import type { AoUiDriveContext, AoUiDriveResult, AoUiDriver } from './ao-leg.js';
import { captureScreenshot, openUiPage, waitForCondition, type UiPage } from './ui-page.js';

/** Selector inventory — verified in the M0 spike and against `public/index.html`. */
export const AO_SELECTORS = {
  search: '#commandSearchInput',
  /** Left-tree command item — rendered from the same `GET /api/commands` load. */
  commandItem: '.command-item',
  /** Scoped: the bare `[onclick=...]` also matches the left-tree item (strict-mode clash). */
  searchResult: (commandId: string) => `#searchResults .search-result-item[onclick="openCommandForm('${commandId}')"]`,
  commandForm: '#commandForm',
  liveToggle: '#liveExecToggle',
  /** FX-AO7: explicit tenant choice, options from `GET /api/tenants` (no default). */
  tenantSelect: '#tenantSelect',
  tenantOption: (slug: string) => `#tenantSelect option[value="${slug}"]`,
  /** FX-AO7: `correlationId: ao-ui-<uuid>` for the last execute. */
  correlationLine: '#resultCorrelationId',
  execute: '#executeBtn',
  resultPanel: '#resultPanel',
  statusBadge: '#resultStatusBadge',
  evidenceSection: '#evidenceSection',
  outcomeBadge: '#evidenceOutcomeBadge',
} as const;

export interface AoUiDriverOptions {
  readonly screenshotDir?: string;
  readonly formTimeoutMs?: number;
  readonly executeTimeoutMs?: number;
}

const DEFAULTS = {
  formTimeoutMs: 60_000,
  executeTimeoutMs: 300_000,
} as const;

/**
 * The GUI flow, against the narrow `UiPage` seam so the ordering rule above is
 * unit-testable without a browser. Throws when the sim slug did not stick — a
 * beat that silently ran against `dev` would prove nothing and mutate nothing.
 */
export async function runAoUiFlow(
  page: UiPage,
  ctx: AoUiDriveContext,
  opts: AoUiDriverOptions = {},
): Promise<AoUiDriveResult> {
  const shots: string[] = [];
  const shot = async (name: string): Promise<void> => {
    const file = await captureScreenshot(page, opts.screenshotDir, name);
    if (file) shots.push(file);
  };
  const formTimeoutMs = opts.formTimeoutMs ?? DEFAULTS.formTimeoutMs;

  // 1. Open the command form the way an operator does. The registry loads from
  //    GET /api/commands on DOMContentLoaded, so wait for the result to render.
  await page.waitForSelector(AO_SELECTORS.search, formTimeoutMs);
  // The registry loads from GET /api/commands on DOMContentLoaded and the
  // search renders on the input event only — typing before the registry lands
  // leaves #searchResults permanently empty. The left-tree items come from the
  // same load, so their presence proves the registry is in.
  await page.waitForSelector(AO_SELECTORS.commandItem, formTimeoutMs);
  await page.fill(AO_SELECTORS.search, ctx.commandId);
  await page.waitForSelector(AO_SELECTORS.searchResult(ctx.commandId), formTimeoutMs);
  await page.click(AO_SELECTORS.searchResult(ctx.commandId));
  await waitForCondition(`the ${ctx.commandId} command form to open`, () => page.isVisible(AO_SELECTORS.commandForm), formTimeoutMs);
  await shot('01-command-form.png');

  // 2. ARM — pick the sim tenant (the options load async from GET /api/tenants),
  //    then the live toggle, then prove the slug stuck. Never reopen the form.
  await page.waitForSelector(AO_SELECTORS.tenantOption(ctx.slug), formTimeoutMs);
  await page.selectOption(AO_SELECTORS.tenantSelect, ctx.slug);
  await page.check(AO_SELECTORS.liveToggle);
  const tenant = await page.inputValue(AO_SELECTORS.tenantSelect);
  if (tenant !== ctx.slug) {
    throw new Error(
      `#tenantSelect did not stick on "${ctx.slug}" (read "${tenant}") — AO has no default tenant and blocks ` +
        'execution without one; refusing to run a beat against an unselected or wrong tenant',
    );
  }
  await shot('02-live-armed.png');

  // 3. EXECUTE — arm the response wait before the click, and take the
  //    structured body from the browser's own traffic (the DOM does not carry it).
  const executeResponse = await page.waitForResponse(
    `/api/execute/${ctx.commandId}`,
    () => page.click(AO_SELECTORS.execute),
    opts.executeTimeoutMs ?? DEFAULTS.executeTimeoutMs,
  );

  // 4. Read only what genuinely renders. `#resultStatusBadge` has a third
  //    state — PENDING APPROVAL on a Tier-3 command — so record whatever it
  //    says rather than waiting for SUCCESS, which would hang.
  await waitForCondition('the AO result panel to render', () => page.isVisible(AO_SELECTORS.resultPanel), formTimeoutMs);
  const statusBadge = (await page.textContent(AO_SELECTORS.statusBadge))?.trim() ?? undefined;
  const outcomeBadge = (await page.isVisible(AO_SELECTORS.evidenceSection))
    ? ((await page.textContent(AO_SELECTORS.outcomeBadge))?.trim() ?? undefined)
    : undefined;
  await shot('03-execute-result.png');

  // FX-AO7: the route echoes the correlationId the UI generated; the panel
  // shows it as `correlationId: <id>`. Prefer the echo, fall back to the panel.
  const echoed = (executeResponse as { correlationId?: unknown } | undefined)?.correlationId;
  const shown = (await page.textContent(AO_SELECTORS.correlationLine))?.trim().replace(/^correlationId:\s*/, '');
  const correlationId = typeof echoed === 'string' && echoed ? echoed : shown || undefined;

  return { statusBadge, outcomeBadge, executeResponse, correlationId, screenshots: shots };
}

/**
 * An `AoUiDriver` for `runAoLeg`. `screenshotDir` is a factory option rather
 * than part of the contract, which `ao-leg.ts` fixes at
 * `{ baseUrl, slug, commandId, watch }`.
 */
export function createAoUiDriver(opts: AoUiDriverOptions = {}): AoUiDriver {
  return async (ctx: AoUiDriveContext): Promise<AoUiDriveResult> => {
    const session = await openUiPage(ctx.baseUrl, ctx.watch);
    try {
      return await runAoUiFlow(session.page, ctx, opts);
    } finally {
      await session.close();
    }
  };
}

/** Drive the AO GUI in a real browser. Headless unless `--watch`. */
export const driveAoUi: AoUiDriver = createAoUiDriver();
