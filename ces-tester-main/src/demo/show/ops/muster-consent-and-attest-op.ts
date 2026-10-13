// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 Slice 3.2 — `muster-consent-and-attest` (D.6): a NAMED human attests
 * to what the machine inferred, on the boundary confirm panel the import landed
 * on. Operates on the CURRENT page (no goto).
 *
 * The honesty this act is about: the machine can infer, it cannot attest. A
 * draft confirm is name-gated (disabled while the confirmer name is blank), and
 * nothing auto-drafted becomes an attested fact on its own. The confirmed fact
 * carries the operator name — observable in D.8's exported payload (the chain).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureScreenshot } from '../../ui-page.js';
import { driveMusterConsent } from '../../muster-ui-driver.js';
import { MUSTER_DEMO_OPERATOR_NAME } from './muster-connect-tenant-op.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['muster-consent-and-attest'].steps;

export const MUSTER_CONSENT_FACTS = 'muster-consent.json';

export async function runMusterConsentAttestOp(ctx: OpDriveContext): Promise<void> {
  const baseUrl = ctx.armed.musterBaseUrl;
  if (!baseUrl) {
    throw new Error('the ces-muster preview is not armed — prep did not start it (see arm-muster.ts)');
  }
  const page = ctx.pane.page;
  const raw = ctx.pane.session.raw;

  // Operates on the CURRENT page (no goto), so captions emit before each verb.
  await ctx.caption?.(CAP[0]);

  // Enumerate the draft-confirm testids from the raw page — the narrow UiPage
  // seam cannot list matching selectors. Exclude the panel's own testid.
  let firstQid = '';
  try {
    const loc = raw.locator('[data-testid^="boundary-confirm-"]');
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const t = await loc.nth(i).getAttribute('data-testid');
      if (t && t !== 'boundary-confirm-panel' && t.startsWith('boundary-confirm-')) {
        firstQid = t.replace('boundary-confirm-', '');
        break;
      }
    }
  } catch {
    /* leave firstQid empty — pruning-only */
  }

  ctx.log(
    `  op muster-consent-and-attest: attesting the boundary (confirmer '${MUSTER_DEMO_OPERATOR_NAME}', ` +
      `${firstQid ? `draft ${firstQid}` : 'pruning-only, no drafts'})`,
  );
  await ctx.caption?.(CAP[1]);
  const result = await driveMusterConsent(page, { confirmerName: MUSTER_DEMO_OPERATOR_NAME, firstQid });
  await ctx.caption?.(CAP[2]);

  const shot = await captureScreenshot(page, ctx.armed.runDir, 'muster-consent-03-attested.png');
  if (shot) ctx.artifact?.(shot);
  await ctx.caption?.(CAP[3]);

  const facts = { confirmerName: MUSTER_DEMO_OPERATOR_NAME, ...result };
  const factsPath = path.join(ctx.armed.runDir, MUSTER_CONSENT_FACTS);
  fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2));
  ctx.artifact?.(factsPath);

  ctx.log(
    `  op muster-consent-and-attest: boundary panel ${result.boundaryPanelVisible ? 'visible' : 'NOT visible'}; ` +
      `drafts ${result.hadDrafts ? 'present' : 'none'}; name-gating ${result.nameGatingObserved ? 'observed' : 'n/a'}; ` +
      `confirmed ${result.confirmedQid ?? '(none)'}; continued ${result.continueClicked}`,
  );
}
