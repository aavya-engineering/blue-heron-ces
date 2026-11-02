// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import type { Page } from 'playwright';

/**
 * PLAN.md M2 task 2: trigger the Mission Plan export to Stamper.
 *
 * Deviation note (logged in IMPLEMENTATION_LOG.md): this originally drove
 * `GeneratedArtifactsPanel.tsx`'s own "Save MP + TM to Stamper" UI button.
 * Live-tested, that button never renders for a fully-completed customer
 * whose SI Baseline has a `cesId` (every SIT-saved baseline gets one via
 * `generateCesId`, per `BaselineReview.tsx`) — a real product-side bug,
 * confirmed by direct read of `ces-planner/vite.config.ts:222-227`
 * (`/api/save-artifact` handler): filenames are built as `${cesId}_${base}`
 * whenever `data.ces.cesId` is present, but `/api/list-artifacts`
 * (`vite.config.ts:78`) derives each artifact's `type` field with a naive
 * `filename.replace(/_.+$/, '')` (everything up to the FIRST underscore) —
 * for a cesId-prefixed file this yields `type: "ces-<hash>"` instead of the
 * real `"manual-mission-plan"`/`"tenant-manifest"`, so
 * `GeneratedArtifactsPanel`'s `getStamperBundle()` (which filters by exact
 * `type` match) never finds them and `bundle.isComplete` stays false — the
 * button and its "Stamper dir" input never render at all (confirmed via a
 * live Playwright query: 0 matches for both, on a customer whose MP/TM
 * genuinely exist on disk per a direct `/api/list-artifacts` fetch).
 *
 * This is a real bug in ces-planner, out of bounds to fix here (hard
 * boundary: never modify ces-planner's source). Per PLAN.md's own stated
 * fallback ("drive Muster's download/export UI ... if unavailable") and
 * PHASE0_FINDINGS.md item 3's note that the endpoint's contract is
 * `{artifacts:[{type,path}],targetDir}` with `path` values that "ces-tester
 * never needs to guess" — this function now calls `/api/list-artifacts`
 * itself (via `page.request`, same-origin, avoiding a CORS-relevant fetch()
 * from Node) and matches artifacts by their PATH substring
 * (`manual-mission-plan`/`tenant-manifest`) rather than the broken `type`
 * field, then POSTs directly to `/api/save-to-stamper` with the correct
 * `type` values the endpoint itself expects — the same documented API
 * contract the UI button would have called, just without depending on the
 * UI's buggy artifact-type derivation.
 */

export interface SaveToStamperOptions {
  customerName: string;
  /** Absolute or relative-to-planner-repo-root target dir for the exported
   * artifacts. Per PHASE0_FINDINGS.md item 3, this is resolved by the Vite
   * middleware relative to the PLANNER repo root and must not point inside
   * `customers/`. */
  targetDir: string;
}

interface ListedArtifact {
  type: string;
  path: string;
  customerName: string;
}

export async function saveMissionPlanToStamper(page: Page, opts: SaveToStamperOptions): Promise<void> {
  // page.request has no implicit base URL — build one from the page's
  // current origin (playwright/apiRequestContext.get requires an absolute
  // URL or a baseURL configured at context-creation time, neither of which
  // this driver's plain chromium.launch()+newPage() sets up).
  const origin = new URL(page.url()).origin;
  const listResponse = await page.request.get(`${origin}/api/list-artifacts`);
  if (!listResponse.ok()) {
    throw new Error(`GET /api/list-artifacts failed: ${listResponse.status()}`);
  }
  const listJson = (await listResponse.json()) as { artifacts?: ListedArtifact[] };
  const allArtifacts = listJson.artifacts ?? [];

  const mine = allArtifacts.filter((a) => a.customerName === opts.customerName);

  const mp = mine
    .filter((a) => a.path.includes('manual-mission-plan_'))
    .sort((a, b) => a.path.localeCompare(b.path))
    .pop();
  const tm = mine
    .filter((a) => a.path.includes('tenant-manifest_'))
    .sort((a, b) => a.path.localeCompare(b.path))
    .pop();
  const im = mine
    .filter((a) => a.path.includes('infrastructure-manifest_'))
    .sort((a, b) => a.path.localeCompare(b.path))
    .pop();

  if (!mp || !tm) {
    throw new Error(
      `saveMissionPlanToStamper: could not find manual-mission-plan/tenant-manifest artifacts for customer "${opts.customerName}" ` +
        `(found ${mine.length} total artifacts for this customer)`,
    );
  }

  const artifactList: Array<{ type: string; path: string }> = [
    { type: 'manual-mission-plan', path: mp.path },
    { type: 'tenant-manifest', path: tm.path },
  ];
  if (im) {
    artifactList.push({ type: 'infrastructure-manifest', path: im.path });
  }

  const saveResponse = await page.request.post(`${origin}/api/save-to-stamper`, {
    data: { artifacts: artifactList, targetDir: opts.targetDir },
  });
  if (!saveResponse.ok()) {
    const body = await saveResponse.text();
    throw new Error(`POST /api/save-to-stamper failed: ${saveResponse.status()}: ${body}`);
  }
}
