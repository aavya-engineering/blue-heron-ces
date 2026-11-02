// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 Slice 3.0 — `muster-connect-tenant` (D.4): point Muster at a tenant
 * and declare HOW it is being assessed — the honest opening beat.
 *
 * Drives the ces-muster SPA (Vite preview :4173) to the Situation → Profile view
 * and fills the readiness session manifest (session kind, auth tier, tenant,
 * operator). It STOPS on the manifest view — Begin Interview is left unclicked so
 * the manifest DOM the judge (MU-C1) reads is still on screen. Later muster-gui
 * acts advance the workflow.
 *
 * **The manifest is what makes a readiness result provenance, not opinion.** The
 * export's real persistence gate is `operator_name` + `tenant_slug`; the SPA
 * defaults `operator_role` to `'assessor'` (AssessmentPage.tsx), so this act
 * drives the role for completeness but the export does not fail without it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureScreenshot } from '../../ui-page.js';
import { driveMusterConnect, readMusterManifest } from '../../muster-ui-driver.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['muster-connect-tenant'].steps;

/** The facts artifact MU-C1 reads — the manifest DOM captured while it was fresh. */
export const MUSTER_CONNECT_FACTS = 'muster-connect.json';

/** A generic on-stage operator identity — never a real person. */
export const MUSTER_DEMO_OPERATOR_NAME = 'Demo Operator';
/** The SPA's own default role; driven for completeness (not a persistence gate). */
export const MUSTER_DEMO_OPERATOR_ROLE = 'assessor';

export async function runMusterConnectTenantOp(ctx: OpDriveContext): Promise<void> {
  const baseUrl = ctx.armed.musterBaseUrl;
  if (!baseUrl) {
    throw new Error(
      'the ces-muster preview is not armed — prep did not start it (see arm-muster.ts / arm-sim.ts)',
    );
  }
  const mode = String(ctx.slide.op.params?.mode ?? 'independent');
  const authTier = String(ctx.slide.op.params?.authTier ?? 'cert-app-only');
  const slug = String(ctx.slide.op.params?.slug ?? ctx.armed.slug);

  ctx.log(
    `  op muster-connect-tenant: declaring the readiness manifest at ${baseUrl} ` +
      `(mode ${mode}, authTier ${authTier}, tenant ${slug})`,
  );
  await driveMusterConnect(ctx.pane.page, baseUrl, {
    mode,
    authTier,
    slug,
    tenantKind: 'sim',
    operatorName: MUSTER_DEMO_OPERATOR_NAME,
    operatorRole: MUSTER_DEMO_OPERATOR_ROLE,
  });
  // `driveMusterConnect` navigates, so the caption is emitted AFTER it — the
  // manifest is on screen and these lines narrate it.
  await ctx.caption?.(CAP[0]);

  const manifest = await readMusterManifest(ctx.pane.page);
  await ctx.caption?.(CAP[1]);
  // Capture the manifest DOM into a facts artifact NOW, while the Profile view is
  // still on screen. Later muster-gui acts navigate away, so MU-C1 reads this
  // artifact rather than a DOM that is gone by judge time.
  const factsPath = path.join(ctx.armed.runDir, MUSTER_CONNECT_FACTS);
  fs.writeFileSync(factsPath, JSON.stringify(manifest, null, 2));
  ctx.artifact?.(factsPath);
  const shot = await captureScreenshot(ctx.pane.page, ctx.armed.runDir, 'muster-connect-01-manifest.png');
  if (shot) ctx.artifact?.(shot);
  await ctx.caption?.(CAP[2]);

  ctx.log(
    `  op muster-connect-tenant: manifest captured — mode ${manifest.mode}, authTier ${manifest.authTier}, ` +
      `tenant '${manifest.slug}', operator '${manifest.operatorName}' (${manifest.operatorRole}); ` +
      `begin-interview ${manifest.beginInterviewReachable ? 'reachable (unclicked)' : 'NOT reachable'}`,
  );
}
