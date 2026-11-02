// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 1C — `eo-show-change-captured` (D.16): re-assess after
 * remediation and walk to the control that changed — the proof the loop closes.
 *
 * ## The honesty this act is about
 *
 * A demo that narrates a flip that did not happen is the worst failure in the
 * catalog. So this op never renders the flip narrative unconditionally. It
 * captures a **before** assessment (as an artifact, not from memory), re-assesses
 * to produce an **after** assessment, and reports EXACTLY what changed:
 *
 * - the named control flipped → it says so and names the direction;
 * - the named control did NOT change → it says so plainly (`EO_CHANGE_NO_FLIP`);
 * - no reliable before was captured → it refuses to narrate a delta
 *   (`EO_CHANGE_NO_RELIABLE_BEFORE`).
 *
 * **The control's status and the SPRS delta are independent facts.** A-18 (the
 * remediator this act follows) mutates the tenant `authorizationPolicy`, which
 * can move the overall SPRS score without flipping the specific MFA control
 * (`IA.L2-3.5.3`) — that flip belongs to Stamper's conditional-access enforcement
 * in the full arc. So the op records both and never infers one from the other.
 *
 * ## Before/after are artifacts, sourced from the server's own API
 *
 * `<runDir>/eo-before.json` is written by the harness `SLIDE_PROBES` entry
 * straight after the warm assess (before the remediator runs), while it is
 * provably still true; this op registers it. `<runDir>/eo-after.json` is written
 * here after the re-assess. `/api/assessment` returns the STORED snapshot
 * (`loadLatest`), which changes only when an assess runs — so the "after" is real
 * only because this op re-assesses, and `generatedAt` proves the snapshot is
 * fresh.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEMO_MFA_CONTROL_ID } from '../../needle-run.js';
import { eoTenantUrl } from '../../eo-tenant-url.js';
import { captureScreenshot, waitForText } from '../../ui-page.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';
import {
  assessInPane,
  readEoNumbers,
  EO_REVIEW_SELECTORS,
  EO_REVIEW_FAMILY,
} from './eo-review-op.js';

const CAP = CAPTIONS['eo-show-change-captured'].steps;

/** The control the demo turns on, unless the deck overrides it. */
export { DEMO_MFA_CONTROL_ID };

/** Verbatim honesty lines. Exported so the judge (EC5) matches constants, not prose. */
export const EO_CHANGE_NO_FLIP =
  'the named control did not change between the before and after assessments — reporting no change, NOT a flip';
export const EO_CHANGE_NO_RELIABLE_BEFORE =
  'no reliable before-assessment was captured — refusing to narrate a delta';
/** The flip line format. `FLIP:` is the marker the judge keys on for "a flip was narrated". */
export function eoChangeFlipLine(control: string, from: string, to: string): string {
  return `FLIP: ${control} changed ${from} -> ${to} between the before and after assessments`;
}

const BROWSE_TIMEOUT_MS = 20_000;

/** One assessment artifact as this op reads it back. */
export interface EoAssessmentArtifact {
  readonly assessment?: {
    readonly controls?: ReadonlyArray<{ control_id?: string; status?: string }>;
    readonly generatedAt?: string;
  };
  readonly sprs?: unknown;
}

export interface EoChangeComparison {
  readonly controlId: string;
  readonly beforeStatus: string;
  readonly afterStatus: string;
  readonly flipped: boolean;
  readonly beforeSprs?: number;
  readonly afterSprs?: number;
  readonly sprsDelta?: number;
  readonly beforeGeneratedAt?: string;
  readonly afterGeneratedAt?: string;
}

function controlStatus(a: EoAssessmentArtifact | undefined, controlId: string): string {
  const found = a?.assessment?.controls?.find((c) => c.control_id === controlId);
  return found?.status ?? '(absent)';
}

/**
 * Pure before/after compare. The named control's status and the SPRS delta are
 * INDEPENDENT — the caller must never infer one from the other. Exported so the
 * delta logic is unit-tested against fixtures with no browser and no sibling.
 */
export function compareEoChange(
  before: EoAssessmentArtifact | undefined,
  after: EoAssessmentArtifact | undefined,
  controlId: string,
): EoChangeComparison {
  const beforeStatus = controlStatus(before, controlId);
  const afterStatus = controlStatus(after, controlId);
  const beforeSprs = readEoNumbers(before?.assessment, before?.sprs).sprsScore;
  const afterSprs = readEoNumbers(after?.assessment, after?.sprs).sprsScore;
  const sprsDelta =
    typeof beforeSprs === 'number' && typeof afterSprs === 'number'
      ? afterSprs - beforeSprs
      : undefined;
  return {
    controlId,
    beforeStatus,
    afterStatus,
    // A flip requires two real, different statuses — an `(absent)` on either side
    // is never a flip.
    flipped:
      beforeStatus !== '(absent)' && afterStatus !== '(absent)' && beforeStatus !== afterStatus,
    beforeSprs,
    afterSprs,
    sprsDelta,
    beforeGeneratedAt: before?.assessment?.generatedAt,
    afterGeneratedAt: after?.assessment?.generatedAt,
  };
}

function readArtifact(absPath: string): EoAssessmentArtifact | undefined {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8')) as EoAssessmentArtifact;
  } catch {
    return undefined;
  }
}

/** Walk to the SPRS hero and read the on-screen score (or undefined). */
async function walkToSprs(ctx: OpDriveContext): Promise<string | undefined> {
  const page = ctx.pane.page;
  try {
    await page.click(EO_REVIEW_SELECTORS.tab('sprs'));
    const score = await waitForText(page, EO_REVIEW_SELECTORS.sprsScore, /^-?\d+$/, {
      timeoutMs: BROWSE_TIMEOUT_MS,
      what: 'the SPRS score (#sprsDetailScore)',
    });
    const file = await captureScreenshot(page, ctx.armed.runDir, 'eo-show-change-01-sprs');
    if (file) ctx.artifact?.(file);
    return score;
  } catch {
    return undefined;
  }
}

/**
 * `eo-show-change-captured` — re-assess after remediation, compare, narrate only
 * what actually changed. `live` re-assesses; the "before" was captured between
 * slides (see `SLIDE_PROBES`).
 */
export async function runEoShowChangeCapturedOp(ctx: OpDriveContext): Promise<void> {
  const baseUrl = ctx.armed.eoBaseUrl;
  if (!baseUrl) {
    throw new Error(
      'the EO server is not armed — prep did not start it (see arm-eo.ts / arm-sim.ts)',
    );
  }
  const control = String(ctx.slide.op.params?.control ?? DEMO_MFA_CONTROL_ID);
  const family = String(ctx.slide.op.params?.family ?? EO_REVIEW_FAMILY);
  const beforePath = path.join(ctx.armed.runDir, 'eo-before.json');
  const afterPath = path.join(ctx.armed.runDir, 'eo-after.json');

  ctx.log(
    `  op eo-show-change-captured (live): re-assessing '${ctx.armed.slug}' at ${baseUrl} ` +
      `to capture the AFTER of control ${control} (family ${family})`,
  );

  // The AFTER: re-assess so the stored snapshot reflects the remediated tenant.
  // `assessInPane` emits the opening caption after its goto.
  await assessInPane(ctx, baseUrl, 'eo-show-change-after', CAP[0]);
  const [assessment, sprs] = await Promise.all([
    ctx.pane.page.getJson(eoTenantUrl(baseUrl, '/api/assessment', ctx.armed.slug)).catch(() => undefined),
    ctx.pane.page.getJson(eoTenantUrl(baseUrl, '/api/sprs', ctx.armed.slug)).catch(() => undefined),
  ]);
  const after: EoAssessmentArtifact = { assessment, sprs } as EoAssessmentArtifact;
  fs.writeFileSync(afterPath, JSON.stringify({ ...after, capturedAt: new Date().toISOString() }, null, 2));
  ctx.artifact?.(afterPath);

  // The BEFORE: written by the SLIDE_PROBE while it was still true. Register it.
  await ctx.caption?.(CAP[1]);
  const before = readArtifact(beforePath);
  if (before) ctx.artifact?.(beforePath);

  // Walk to the SPRS hero (the visible beat) and read the on-screen number.
  await ctx.caption?.(CAP[2]);
  const onScreenSprs = await walkToSprs(ctx);
  // Whether it flipped or not, we say so plainly — this frames both branches.
  await ctx.caption?.(CAP[3]);

  if (!before) {
    ctx.log(`  op eo-show-change-captured: ${EO_CHANGE_NO_RELIABLE_BEFORE}`);
    return;
  }

  const cmp = compareEoChange(before, after, control);
  if (cmp.flipped) {
    ctx.log(`  op eo-show-change-captured: ${eoChangeFlipLine(control, cmp.beforeStatus, cmp.afterStatus)}`);
  } else {
    ctx.log(`  op eo-show-change-captured: ${EO_CHANGE_NO_FLIP} (${control} stayed ${cmp.beforeStatus})`);
  }
  ctx.log(
    `  op eo-show-change-captured: SPRS ${cmp.beforeSprs ?? '?'} -> ${cmp.afterSprs ?? '?'} ` +
      `(delta ${cmp.sprsDelta ?? '?'}); on screen ${onScreenSprs ?? '(not read)'}`,
  );
}
