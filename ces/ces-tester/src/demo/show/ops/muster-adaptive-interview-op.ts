// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 Slice 3.3 — `muster-adaptive-interview` (D.7): show the question
 * count DROP because discovery already answered them — the clearest value beat.
 *
 * Two branches, the exact comparison ces-muster's own `five-tabs.spec.ts` makes:
 * - the DISCOVERY branch is the visible pane (imported facts from 3.1 prune
 *   questions); starting the interview reads `progress-note` ("of N answered");
 * - the MANUAL branch is a throwaway HEADLESS session on the same :4173 with the
 *   same profile and NO import — its `progress-note` total is the unpruned
 *   baseline. The throwaway session preserves the visible pane's state and adds
 *   no port (TD1 unaffected). It is measurement, not stage.
 *
 * **Measured, not asserted.** With most observations at `unknown` confidence the
 * pruning may be small; if the totals tie, the op reports "no pruning" plainly
 * rather than narrating a drop that did not happen.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureScreenshot, openUiPage } from '../../ui-page.js';
import { HEADLESS_MODE } from '../../watch-mode.js';
import { driveBeginAndReadProgress, type MusterConnectParams } from '../../muster-ui-driver.js';
import {
  MUSTER_DEMO_OPERATOR_NAME,
  MUSTER_DEMO_OPERATOR_ROLE,
} from './muster-connect-tenant-op.js';
import { hudSurfaceOf } from '../app-pane.js';
import { formatElapsed, hudTicker, paneHud } from '../theatrical-page.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['muster-adaptive-interview'].steps;

/** The HUD title for this beat. */
export const ADAPTIVE_HUD_TITLE = 'Adaptive interview · pruning proof';

export const MUSTER_ADAPTIVE_FACTS = 'muster-adaptive.json';

export interface MusterAdaptiveFacts {
  readonly discoveryTotal: number | null;
  readonly manualTotal: number | null;
  readonly pruned: boolean;
}

export async function runMusterAdaptiveInterviewOp(ctx: OpDriveContext): Promise<void> {
  const baseUrl = ctx.armed.musterBaseUrl;
  if (!baseUrl) {
    throw new Error('the ces-muster preview is not armed — prep did not start it (see arm-muster.ts)');
  }

  // The manifest params both branches re-establish before Begin (the SPA clears
  // rm-* on nav, and D.8's export needs the manifest in the session).
  const params: MusterConnectParams = {
    mode: 'independent',
    authTier: 'cert-app-only',
    slug: ctx.armed.slug,
    tenantKind: 'sim',
    operatorName: MUSTER_DEMO_OPERATOR_NAME,
    operatorRole: MUSTER_DEMO_OPERATOR_ROLE,
  };

  // No goto — the visible pane carries the imported interview. Caption before
  // the verb. The corpus DESCRIBES the comparison and asserts no drop: the delta
  // is measured below, and a tie is reported plainly.
  await ctx.caption?.(CAP[0]);

  // Discovery branch — the visible pane (carries the imported facts).
  const discoveryTotal = (await driveBeginAndReadProgress(ctx.pane.page, params, 'demo (discovery branch)')) ?? null;
  const shot = await captureScreenshot(ctx.pane.page, ctx.armed.runDir, 'muster-adaptive-04-interview.png');
  if (shot) ctx.artifact?.(shot);
  await ctx.caption?.(CAP[1]);

  // Manual branch — a fresh headless session, same profile, NO import. The
  // visible pane holds the discovery-branch interview meanwhile, so the HUD says
  // what is being measured off-screen (GP-DEMO-6 theatre).
  const hud = hudSurfaceOf(ctx.pane);
  const ticker = hudTicker(
    hud,
    ADAPTIVE_HUD_TITLE,
    (ms) =>
      `discovery branch: ${discoveryTotal ?? '?'} question(s) · measuring the manual branch (no import) off-screen … ${formatElapsed(ms)}`,
  );
  let manualTotal: number | null = null;
  const session = await openUiPage(baseUrl, HEADLESS_MODE);
  try {
    manualTotal = (await driveBeginAndReadProgress(session.page, params, 'demo (manual branch)')) ?? null;
  } finally {
    ticker.stop();
    await session.close();
  }

  await ctx.caption?.(CAP[2]);
  const pruned =
    typeof discoveryTotal === 'number' && typeof manualTotal === 'number' && discoveryTotal < manualTotal;
  await ctx.caption?.(CAP[3]);
  if (hud) {
    await paneHud.show(
      hud,
      ADAPTIVE_HUD_TITLE,
      `discovery branch ${discoveryTotal ?? '?'} vs manual branch ${manualTotal ?? '?'} question(s) — ` +
        (pruned ? `${(manualTotal ?? 0) - (discoveryTotal ?? 0)} pruned by imported facts` : 'no pruning measured'),
    );
  }

  const facts: MusterAdaptiveFacts = { discoveryTotal, manualTotal, pruned };
  const factsPath = path.join(ctx.armed.runDir, MUSTER_ADAPTIVE_FACTS);
  fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2));
  ctx.artifact?.(factsPath);

  ctx.log(
    `  op muster-adaptive-interview: discovery branch ${discoveryTotal ?? '?'} question(s) vs manual branch ` +
      `${manualTotal ?? '?'} — ${pruned ? `PRUNED (${(manualTotal ?? 0) - (discoveryTotal ?? 0)} fewer)` : 'no pruning measured (reporting plainly, not a drop)'}`,
  );
}
