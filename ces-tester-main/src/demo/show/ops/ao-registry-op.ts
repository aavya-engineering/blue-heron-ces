// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S5 — the first REAL live op (A7): drive the AdminOps GUI in the
 * app pane, as an operator does.
 *
 * Two decisions worth reading before changing anything here.
 *
 * **1. It drives the pane's EXISTING page.** `createAoUiDriver` / `runAoLeg`
 * open their own browser; calling either would pop a third window beside the
 * slides window and the app pane, and the audience would watch the demo happen
 * somewhere else. So this op calls the exported `runAoUiFlow` directly against
 * the pane's `UiPage` — the same seam, the same ordering rules, one window.
 *
 * **2. It runs LIVE against the ephemeral sim slug, not a dry run.** The plan
 * asked for a "Tier-1 dryRun exec", but `ao-ui-driver.ts`'s M0-verified header
 * records that the GUI hardcodes tenant `'dev'` whenever the live toggle is off
 * (`ces-ao/public/index.html:1193`) — a GUI dry-run against the sim is
 * structurally impossible, and a dry-run that silently targeted `dev` would be
 * the exact substitution the honesty rules forbid. The proven path is the live
 * one against our own throwaway sim tenant, which mutates nothing real.
 *
 * `runAoUiFlow` itself enforces the ordering rule that actually bites:
 * `openCommandForm()` resets the tenant box on every open, so the toggle must
 * be checked BEFORE the slug is filled, and the form must never be reopened
 * after arming.
 */

import { runAoUiFlow } from '../../ao-ui-driver.js';
import { AO_DEMO_COMMAND_ID } from '../../ao-leg.js';
import { HEADLESS_MODE } from '../../watch-mode.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['ao-registry'].steps;

/**
 * Browse the command registry and execute a command in the AO GUI, in the app
 * pane, against the armed sim tenant.
 */
export async function runAoRegistryOp(ctx: OpDriveContext): Promise<void> {
  const baseUrl = ctx.armed.aoBaseUrl;
  if (!baseUrl) {
    throw new Error('the AO GUI is not armed — prep did not bring up `ao gui` (see arm-sim.ts)');
  }

  // Declared in the deck's `params` cell (`command=A-18`); the catalog fills the
  // default, so no-params behaviour is byte-identical to before params existed.
  const commandId = String(ctx.slide.op.params?.command ?? AO_DEMO_COMMAND_ID);

  ctx.log(`  op ao-registry: driving ${baseUrl} against '${ctx.armed.slug}' (command ${commandId})`);
  await ctx.pane.goto(baseUrl);
  // After the goto (a load wipes the band); before each verb (it paints during
  // the ~450 ms glide `runAoUiFlow` performs).
  await ctx.caption?.(CAP[0]);
  await ctx.caption?.(CAP[1]);

  const result = await runAoUiFlow(
    ctx.pane.page,
    {
      baseUrl,
      slug: ctx.armed.slug,
      commandId,
      // `watch` is part of the driver contract but unused by the flow itself —
      // this window's visibility is set by the pane's own launch, not here.
      watch: HEADLESS_MODE,
    },
    { screenshotDir: ctx.armed.runDir },
  );

  // The governed run left its evidence record; this caption stands over the
  // screenshot capture and the result log.
  await ctx.caption?.(CAP[2]);
  for (const shot of result.screenshots ?? []) ctx.artifact?.(shot);

  ctx.log(
    `  op ao-registry: status "${result.statusBadge ?? '?'}"` +
      (result.outcomeBadge ? `, evidence "${result.outcomeBadge}"` : '') +
      (result.correlationId ? `, correlationId ${result.correlationId}` : '') +
      ` (${result.screenshots?.length ?? 0} screenshot(s) in ${ctx.armed.runDir})`,
  );
}
