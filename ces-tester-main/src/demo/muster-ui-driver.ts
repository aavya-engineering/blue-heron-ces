// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 — the ces-muster SPA driver (Readiness Evaluation, on stage), the
 * fourth GUI driver beside `ao-ui-driver.ts` / `eo-ui-driver.ts` /
 * `stamper-ui-driver.ts`.
 *
 * ## Selectors are the SPA's own `data-testid`s
 *
 * ces-muster ships 76 stable `data-testid` hooks and its own Playwright suite;
 * this driver copies those sequences rather than inventing selectors. Every id in
 * `MUSTER_SELECTORS` is verified against the current source (file:line noted).
 *
 * ## The one ordering rule, applied to a five-beat sequence
 *
 * Only the FIRST beat navigates (`goto`). Every later beat operates on the page
 * the previous beat left — the same lesson `eo-review` learned (a `goto` between
 * warm and live destroys the hydrated assessment). The connect beat here fills
 * the manifest and STOPS on the manifest view: it does NOT click Begin Interview,
 * because the judge reads the manifest DOM and clicking it navigates away.
 *
 * ## Honesty (A.5, load-bearing)
 *
 * The live acts compose the REAL CLI walk → `readiness-result/1.0.0` → the SPA's
 * file-import seam. This driver NEVER clicks the SPA's own "Run Discovery" button
 * (`discovery-run-btn`), which loads a zero-network fixture.
 */

import { waitForCondition, type UiPage } from './ui-page.js';

/** Verified `data-testid` selectors (file:line in ces-muster/src, current source). */
export const MUSTER_SELECTORS = {
  // connect-tenant (ShellNav.tsx:28, AssessmentPage.tsx)
  navSituation: '[data-testid="nav-tab-situation"]',
  navDiscovery: '[data-testid="nav-tab-discovery"]',
  tabProfile: '[data-testid="tab-profile"]',
  manifestCapture: '[data-testid="readiness-manifest-capture"]',
  rmMode: '[data-testid="rm-mode"]', // <select>
  rmAuthTier: '[data-testid="rm-auth-tier"]', // <select>
  rmTenantSlug: '[data-testid="rm-tenant-slug"]', // <input>
  rmTenantKind: '[data-testid="rm-tenant-kind"]', // <select>
  rmOperatorName: '[data-testid="rm-operator-name"]', // <input>
  rmOperatorRole: '[data-testid="rm-operator-role"]', // <input>
  // The Profile section also carries the LEGACY required fields (no testids) that
  // `beginInterview()` validates (AssessmentPage.tsx L345-350): an org name and
  // an on-prem/OT answer. Begin Interview errors without them, so the connect
  // beat fills them even though it does not click Begin.
  orgName: 'input[placeholder="Acme Defense LLC"]',
  onPremOtNo: 'input[type="radio"][name="on_prem_ot"][value="no"]',
  beginInterview: '[data-testid="begin-interview"]',
  // auto-analysis (DiscoveryOffer.tsx) — the HONEST import seam
  discoveryOffer: '[data-testid="discovery-offer"]',
  discoveryImportInput: '[data-testid="discovery-import-input"]', // <input type=file>
  discoveryImportError: '[data-testid="discovery-import-error"]',
  discoveryRunBtn: '[data-testid="discovery-run-btn"]', // ⚠ NEVER click — fixture button
  // consent-and-attest (BoundaryConfirmPanel.tsx)
  boundaryConfirmPanel: '[data-testid="boundary-confirm-panel"]',
  boundaryConfirmerName: '[data-testid="boundary-confirmer-name"]',
  boundaryContinueBtn: '[data-testid="boundary-continue-btn"]',
  // adaptive-interview (AssessmentPage.tsx:976)
  progressNote: '[data-testid="progress-note"]',
  // generate-sprs-mp (AssessmentPage.tsx:1011, ResultScreen.tsx)
  finishInterview: '[data-testid="finish-interview"]',
  conservativeScore: '[data-testid="conservative-score"]',
  exportReadinessResult: '[data-testid="export-readiness-result"]',
  exportEvidencePackage: '[data-testid="export-evidence-package"]',
  // muster-rollup (App.tsx MusterNav + features/rollup/StaticRollup.tsx). The
  // rollup nav renders ONLY for a `prime_and_subs` engagement (App.tsx:115,203,
  // gated on `state.engagementKind`, which is set at engagement creation — so the
  // radio alone does not surface it; Begin Interview must create the engagement).
  rollupEngagementKind: 'input[type="radio"][name="engagement_kind"][value="prime_and_subs"]',
  rollupNav: '[data-testid="rollup-nav"]',
  rosterSection: '[data-testid="roster-section"]',
  // The StatusPayload file input, RAG rows, badges and schema errors — all scoped
  // to the roster section so nothing else on the page (e.g. the discovery import
  // input) is caught.
  rollupFileInput: '[data-testid="roster-section"] input[type="file"]',
  rollupRow: '[data-testid="roster-section"] table.data-table tbody tr',
  rollupBadge: '[data-testid="roster-section"] table.data-table tbody .badge',
  rollupFormError: '[data-testid="roster-section"] ul.form-error li',
} as const;

/** Short by intent: a live SPA failure on stage must be loud in seconds. */
export const MUSTER_TIMEOUT_MS = 15_000;

export interface MusterConnectParams {
  readonly mode: string;
  readonly authTier: string;
  readonly slug: string;
  readonly tenantKind: string;
  readonly operatorName: string;
  readonly operatorRole: string;
}

/**
 * connect-tenant (D.4): navigate to the Situation → Profile view and fill the
 * readiness session manifest. STOPS on the manifest view — does NOT click Begin
 * Interview (the judge reads this DOM; clicking navigates away). This is the ONLY
 * beat that navigates.
 */
export async function driveMusterConnect(
  page: UiPage,
  baseUrl: string,
  params: MusterConnectParams,
): Promise<void> {
  await page.goto(baseUrl);
  await page.click(MUSTER_SELECTORS.navSituation);
  await page.waitForSelector(MUSTER_SELECTORS.tabProfile, MUSTER_TIMEOUT_MS);
  await page.click(MUSTER_SELECTORS.tabProfile);
  await page.waitForSelector(MUSTER_SELECTORS.manifestCapture, MUSTER_TIMEOUT_MS);

  // rm-mode / rm-auth-tier / rm-tenant-kind are <select>; the rest are <input>.
  await page.selectOption(MUSTER_SELECTORS.rmMode, params.mode);
  await page.selectOption(MUSTER_SELECTORS.rmAuthTier, params.authTier);
  await page.fill(MUSTER_SELECTORS.rmTenantSlug, params.slug);
  await page.selectOption(MUSTER_SELECTORS.rmTenantKind, params.tenantKind);
  await page.fill(MUSTER_SELECTORS.rmOperatorName, params.operatorName);
  await page.fill(MUSTER_SELECTORS.rmOperatorRole, params.operatorRole);

  // The legacy required fields — so a later beat's Begin Interview click does not
  // error on "Organization name is required" / "On-premises / OT answer required".
  await page.fill(MUSTER_SELECTORS.orgName, `${params.slug} (demo)`);
  await page.check(MUSTER_SELECTORS.onPremOtNo);

  // Ensure Begin Interview is reachable — but leave it UNCLICKED.
  await page.waitForSelector(MUSTER_SELECTORS.beginInterview, MUSTER_TIMEOUT_MS);
}

/**
 * DISCOVERY_RESULTS_FIXTURE's observation count (`src/__fixtures__/discoveryResults.ts`,
 * verified 2026-09-06): 14 bare rows. The real CLI walk produces hundreds, so the
 * fixture's signature is "exactly 14, no readiness-result wrapper" — the negative
 * assertion the honest import path must NOT match.
 */
export const MUSTER_DISCOVERY_FIXTURE_COUNT = 14;

/** The `discovery-summary` element renders ONLY on the fixture-run branch. */
export const MUSTER_DISCOVERY_SUMMARY = '[data-testid="discovery-summary"]';

export interface MusterImportResult {
  readonly boundaryPanelVisible: boolean;
  readonly discoverySummaryVisible: boolean;
}

/**
 * auto-analysis (D.5): from the manifest view, navigate to Discovery and IMPORT
 * the CLI artifact via the file input — the HONEST seam. NEVER clicks
 * `discovery-run-btn` (the zero-network fixture button). A valid
 * readiness-result import lands on `boundary-confirm-panel`, NOT the fixture
 * branch's `discovery-summary`.
 */
export async function driveMusterImportDiscovery(
  page: UiPage,
  artifactAbsPath: string,
): Promise<MusterImportResult> {
  await page.click(MUSTER_SELECTORS.navDiscovery);
  await page.waitForSelector(MUSTER_SELECTORS.discoveryImportInput, MUSTER_TIMEOUT_MS);
  // The honest seam: read the CLI artifact through the file input (FileReader,
  // zero network). The fixture button is never touched.
  await page.setInputFiles(MUSTER_SELECTORS.discoveryImportInput, artifactAbsPath);
  await page.waitForSelector(MUSTER_SELECTORS.boundaryConfirmPanel, MUSTER_TIMEOUT_MS);
  return {
    boundaryPanelVisible: await page.isVisible(MUSTER_SELECTORS.boundaryConfirmPanel),
    discoverySummaryVisible: await page.isVisible(MUSTER_DISCOVERY_SUMMARY),
  };
}

/**
 * Fill the full readiness manifest on the Situation/Profile view (rm-* + legacy)
 * WITHOUT navigating — the page must already be on the SPA. Exported (GP-DEMO-6)
 * so `muster-readiness` can perform the manifest beat on stage while its CLI
 * walk runs, without the `goto` that `driveMusterConnect` owns.
 */
export async function driveMusterFillManifest(page: UiPage, params: MusterConnectParams, orgName: string): Promise<void> {
  await page.click(MUSTER_SELECTORS.navSituation);
  await page.waitForSelector(MUSTER_SELECTORS.tabProfile, MUSTER_TIMEOUT_MS);
  await page.click(MUSTER_SELECTORS.tabProfile);
  await page.waitForSelector(MUSTER_SELECTORS.manifestCapture, MUSTER_TIMEOUT_MS);
  await page.selectOption(MUSTER_SELECTORS.rmMode, params.mode);
  await page.selectOption(MUSTER_SELECTORS.rmAuthTier, params.authTier);
  await page.fill(MUSTER_SELECTORS.rmTenantSlug, params.slug);
  await page.selectOption(MUSTER_SELECTORS.rmTenantKind, params.tenantKind);
  await page.fill(MUSTER_SELECTORS.rmOperatorName, params.operatorName);
  await page.fill(MUSTER_SELECTORS.rmOperatorRole, params.operatorRole);
  await page.fill(MUSTER_SELECTORS.orgName, orgName);
  await page.check(MUSTER_SELECTORS.onPremOtNo);
}

/**
 * adaptive-interview (D.7): re-fill the FULL manifest (so the session captures it
 * for D.8's readiness export — the SPA re-mounts the Profile view on nav and
 * clears rm-*), start the interview, and read the `progress-note` total ("of N
 * answered"). Used for BOTH branches — the discovery branch (imported facts prune
 * questions) and a fresh manual branch (no import).
 */
export async function driveBeginAndReadProgress(
  page: UiPage,
  params: MusterConnectParams,
  orgName: string,
): Promise<number | undefined> {
  await driveMusterFillManifest(page, params, orgName);
  await page.click(MUSTER_SELECTORS.beginInterview);
  await page.waitForSelector(MUSTER_SELECTORS.progressNote, MUSTER_TIMEOUT_MS);
  const text = await page.textContent(MUSTER_SELECTORS.progressNote);
  const m = /of (\d+) answered/.exec(text ?? '');
  return m ? Number(m[1]) : undefined;
}

export interface MusterExportResult {
  readonly scoreText: string;
  readonly savedPath: string;
}

/**
 * generate-sprs-mp (D.8): finish the interview → the result view, read the
 * `conservative-score` DOM text, and EXPORT the readiness-result payload through
 * the download seam. The judged number comes from the exported payload, never
 * the DOM (A.5 #3).
 */
export async function driveMusterExport(page: UiPage, saveDir: string): Promise<MusterExportResult> {
  await page.click(MUSTER_SELECTORS.finishInterview);
  await page.waitForSelector(MUSTER_SELECTORS.conservativeScore, MUSTER_TIMEOUT_MS);
  const scoreText = (await page.textContent(MUSTER_SELECTORS.conservativeScore)) ?? '';
  const savedPath = await page.waitForDownload(
    () => page.click(MUSTER_SELECTORS.exportReadinessResult),
    saveDir,
  );
  return { scoreText, savedPath };
}

export interface MusterConsentResult {
  readonly boundaryPanelVisible: boolean;
  readonly hadDrafts: boolean;
  /** True when a draft confirm was disabled while the name was blank and enabled after. */
  readonly nameGatingObserved: boolean;
  readonly confirmedQid: string | null;
  readonly continueClicked: boolean;
}

/**
 * consent-and-attest (D.6): the boundary panel is already up (from the import).
 * Observe that a draft confirm is name-gated (disabled while the confirmer name
 * is blank), then a named human confirms one draft and continues. For the
 * pruning-only case (no drafts) it fills the name and continues.
 *
 * `firstQid` is enumerated by the op from the raw page (the narrow seam cannot
 * list matching testids); an empty string means no drafts were present.
 */
export async function driveMusterConsent(
  page: UiPage,
  params: { confirmerName: string; firstQid: string },
): Promise<MusterConsentResult> {
  await page.waitForSelector(MUSTER_SELECTORS.boundaryConfirmPanel, MUSTER_TIMEOUT_MS);
  const boundaryPanelVisible = await page.isVisible(MUSTER_SELECTORS.boundaryConfirmPanel);
  const hadDrafts = params.firstQid !== '';
  const confirmSel = hadDrafts ? `[data-testid="boundary-confirm-${params.firstQid}"]` : '';

  let nameGatingObserved = false;
  let confirmedQid: string | null = null;
  if (hadDrafts) {
    // Disabled while the name is blank (`disabled` attribute present).
    const disabledBlank = (await page.getAttribute(confirmSel, 'disabled')) !== null;
    await page.fill(MUSTER_SELECTORS.boundaryConfirmerName, params.confirmerName);
    const enabledAfter = (await page.getAttribute(confirmSel, 'disabled')) === null;
    nameGatingObserved = disabledBlank && enabledAfter;
    await page.click(confirmSel);
    confirmedQid = params.firstQid;
  } else {
    await page.fill(MUSTER_SELECTORS.boundaryConfirmerName, params.confirmerName);
  }

  await page.click(MUSTER_SELECTORS.boundaryContinueBtn);
  return { boundaryPanelVisible, hadDrafts, nameGatingObserved, confirmedQid, continueClicked: true };
}

/** Read back the manifest fields the connect beat filled (for the judge, MU-C1). */
export interface MusterManifestReadback {
  readonly mode: string;
  readonly authTier: string;
  readonly slug: string;
  readonly operatorName: string;
  readonly operatorRole: string;
  readonly beginInterviewReachable: boolean;
  readonly profileVisible: boolean;
}

export async function readMusterManifest(page: UiPage): Promise<MusterManifestReadback> {
  return {
    mode: await page.inputValue(MUSTER_SELECTORS.rmMode),
    authTier: await page.inputValue(MUSTER_SELECTORS.rmAuthTier),
    slug: await page.inputValue(MUSTER_SELECTORS.rmTenantSlug),
    operatorName: await page.inputValue(MUSTER_SELECTORS.rmOperatorName),
    operatorRole: await page.inputValue(MUSTER_SELECTORS.rmOperatorRole),
    beginInterviewReachable: await page.isVisible(MUSTER_SELECTORS.beginInterview),
    profileVisible: await page.isVisible(MUSTER_SELECTORS.manifestCapture),
  };
}

export interface MusterRollupResult {
  /** RAG rows the board rendered — one per imported StatusPayload. */
  readonly rowCount: number;
  /** The RAG badge text per row (GREEN|AMBER|RED), for the HUD tally. */
  readonly badges: readonly string[];
  /** Any `ul.form-error` entry — a schema-rejected payload. Empty on success. */
  readonly formErrors: readonly string[];
}

/**
 * muster-rollup (D.17): drive the prime's SUBCONTRACTOR ROLLUP surface. This
 * beat is the ONLY one that opens a `prime_and_subs` engagement — the rollup nav
 * renders only for that engagement kind, and the kind is set when Begin Interview
 * creates the engagement (the radio alone does not surface it). So the sequence
 * is: Profile → declare prime_and_subs → the legacy required fields → Begin
 * Interview → the rollup nav → the board.
 *
 * Then IMPORT one StatusPayload file per sub through the SPA's own file seam (the
 * same honest FileReader seam `driveMusterImportDiscovery` uses — never a fixture
 * button). `UiPage.setInputFiles` sets a single file and `handleFiles` appends a
 * row per change while resetting the input, so N calls build an N-row board.
 *
 * Returns the row count, the RAG badges, and any schema `form-error` — the caller
 * fails the beat loudly on a non-empty error rather than showing a short board.
 * This is the ONLY navigating beat here (like `driveMusterConnect`): the caller
 * put the SPA on stage; this owns the walk to the rollup.
 */
export async function driveMusterRollup(
  page: UiPage,
  payloadPaths: readonly string[],
): Promise<MusterRollupResult> {
  await page.click(MUSTER_SELECTORS.navSituation);
  await page.waitForSelector(MUSTER_SELECTORS.tabProfile, MUSTER_TIMEOUT_MS);
  await page.click(MUSTER_SELECTORS.tabProfile);
  await page.waitForSelector(MUSTER_SELECTORS.manifestCapture, MUSTER_TIMEOUT_MS);

  // Declaring a prime_and_subs engagement is what makes the rollup reachable.
  await page.check(MUSTER_SELECTORS.rollupEngagementKind);
  await page.fill(MUSTER_SELECTORS.orgName, 'Prime Integrator (demo)');
  await page.check(MUSTER_SELECTORS.onPremOtNo);
  await page.click(MUSTER_SELECTORS.beginInterview);

  await page.waitForSelector(MUSTER_SELECTORS.rollupNav, MUSTER_TIMEOUT_MS);
  await page.click(MUSTER_SELECTORS.rollupNav);
  await page.waitForSelector(MUSTER_SELECTORS.rosterSection, MUSTER_TIMEOUT_MS);

  // One file per change event — the board accumulates rows.
  for (const filePath of payloadPaths) {
    await page.setInputFiles(MUSTER_SELECTORS.rollupFileInput, filePath);
  }
  await waitForCondition(
    `the rollup board to render ${payloadPaths.length} row(s)`,
    async () => (await page.count(MUSTER_SELECTORS.rollupRow)) >= payloadPaths.length,
    MUSTER_TIMEOUT_MS,
  );

  return {
    rowCount: await page.count(MUSTER_SELECTORS.rollupRow),
    badges: await page.texts(MUSTER_SELECTORS.rollupBadge),
    formErrors: await page.texts(MUSTER_SELECTORS.rollupFormError),
  };
}
