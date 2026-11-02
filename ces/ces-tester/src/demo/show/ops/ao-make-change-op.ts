// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 1B — `ao-make-change`: the REMEDIATING governed change on
 * stage (D.12, the "fix it" beat).
 *
 * **This is `ao-registry`'s flow under a distinct id.** The implementation
 * already existed (`runAoUiFlow`); the only thing that kept `ao-make-change`
 * PROPOSED was that it was not a registered op id, so no deck cell could name
 * it. This slice registers the id and delegates — it does NOT fork the flow, add
 * alias resolution (that is GP-DEMO-5 T3), or branch on op mode (like
 * `ao-registry`, it does not branch: `warm` simply completes early and its
 * result sits on the pane).
 *
 * The difference from `ao-registry` is narrative, not mechanical: this act's
 * `command` defaults to the REMEDIATION command `A-18`, which mutates the tenant
 * `authorizationPolicy` (the MFA object). A deck names `ao-registry` to browse
 * and run a command, and `ao-make-change` to submit the fix — two beats, one
 * governed path, so the story never drops to a command prompt.
 */

import { runAoUiFlow } from '../../ao-ui-driver.js';
import { AO_DEMO_COMMAND_ID } from '../../ao-leg.js';
import { HEADLESS_MODE } from '../../watch-mode.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['ao-make-change'].steps;

/**
 * Submit the remediating command in the AO GUI, in the app pane, against the
 * armed sim tenant. Identical drive to `ao-registry`; the default command is the
 * remediation one.
 */
export async function runAoMakeChangeOp(ctx: OpDriveContext): Promise<void> {
  const baseUrl = ctx.armed.aoBaseUrl;
  if (!baseUrl) {
    throw new Error('the AO GUI is not armed — prep did not bring up `ao gui` (see arm-sim.ts)');
  }

  // Declared in the deck's `params` cell (`command=A-18`); the catalog fills the
  // default, so a deck that sets no params runs the remediation command.
  const commandId = String(ctx.slide.op.params?.command ?? AO_DEMO_COMMAND_ID);

  ctx.log(`  op ao-make-change: remediating '${ctx.armed.slug}' at ${baseUrl} (command ${commandId})`);
  await ctx.pane.goto(baseUrl);
  // After the goto (a load wipes the band); before the governed submit.
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

  // The change is captured in the evidence trail; this stands over the capture.
  await ctx.caption?.(CAP[2]);
  for (const shot of result.screenshots ?? []) ctx.artifact?.(shot);

  ctx.log(
    `  op ao-make-change: status "${result.statusBadge ?? '?'}"` +
      (result.outcomeBadge ? `, evidence "${result.outcomeBadge}"` : '') +
      (result.correlationId ? `, correlationId ${result.correlationId}` : '') +
      ` (${result.screenshots?.length ?? 0} screenshot(s) in ${ctx.armed.runDir})`,
  );
}
