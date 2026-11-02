// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 Slice 3.4 — `muster-generate-sprs-mp` (D.8): land the number the
 * customer reports (SPRS), read from the EXPORTED payload — never the DOM.
 *
 * The honest-number rule (A.5 #3): the DOM `conservative-score` is what the
 * audience sees; the judged number is the SPRS integer in the exported
 * `readiness-result/1.0.0` payload (`derived.sprs_now.sprs`). The DOM text, if
 * checked, matches `/^-?\d+% compliant/` — NOT a bare integer (that regex was
 * refuted; the DOM is a percentage string).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureScreenshot } from '../../ui-page.js';
import { driveMusterExport } from '../../muster-ui-driver.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['muster-generate-sprs-mp'].steps;

export const MUSTER_SPRS_FACTS = 'muster-sprs.json';

export interface MusterSprsFacts {
  readonly exportedArtifact: string;
  readonly schemaVersion: string;
  readonly payloadSprs: number | null;
  readonly domScoreText: string;
  readonly domScorePercent: number | null;
}

export async function runMusterGenerateSprsMpOp(ctx: OpDriveContext): Promise<void> {
  const baseUrl = ctx.armed.musterBaseUrl;
  if (!baseUrl) {
    throw new Error('the ces-muster preview is not armed — prep did not start it (see arm-muster.ts)');
  }
  const page = ctx.pane.page;

  // No goto — the interview result is on the pane. Caption before each verb.
  await ctx.caption?.(CAP[0]);
  await ctx.caption?.(CAP[1]);
  const { scoreText, savedPath } = await driveMusterExport(page, ctx.armed.runDir);
  ctx.artifact?.(savedPath);
  const shot = await captureScreenshot(page, ctx.armed.runDir, 'muster-sprs-05-result.png');
  if (shot) ctx.artifact?.(shot);
  await ctx.caption?.(CAP[2]);

  // The judged number comes from the exported payload, not the DOM.
  const payload = JSON.parse(fs.readFileSync(savedPath, 'utf8')) as {
    schema_version?: string;
    derived?: { sprs_now?: { sprs?: unknown } };
  };
  const sprs = payload.derived?.sprs_now?.sprs;
  const payloadSprs = typeof sprs === 'number' ? sprs : null;
  const domMatch = /(-?\d+)% compliant/.exec(scoreText);
  const domScorePercent = domMatch ? Number(domMatch[1]) : null;

  const facts: MusterSprsFacts = {
    exportedArtifact: path.basename(savedPath),
    schemaVersion: payload.schema_version ?? '(none)',
    payloadSprs,
    domScoreText: scoreText,
    domScorePercent,
  };
  const factsPath = path.join(ctx.armed.runDir, MUSTER_SPRS_FACTS);
  fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2));
  ctx.artifact?.(factsPath);
  await ctx.caption?.(CAP[3]);
  await ctx.caption?.(CAP[4]);

  ctx.log(
    `  op muster-generate-sprs-mp: exported ${facts.exportedArtifact} (schema ${facts.schemaVersion}); ` +
      `SPRS ${payloadSprs ?? '?'} read from the payload; on screen "${scoreText.trim()}" ` +
      `(${domScorePercent ?? '?'}% compliant)`,
  );
}
