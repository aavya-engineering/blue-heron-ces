// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import {
  answersForWizard,
  CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP,
  type MusterAnswerMapEntry,
} from './answer-map.js';
import {
  acceptRrtBulkReview,
  completeRrtPreamble,
  createCustomer,
  generateRRQuestionSet,
  launchWizardFromHub,
  saveWizardReview,
  triggerMissionPlanGeneration,
  walkWizardQuestions,
} from './wizard-navigation.js';
import { saveMissionPlanToStamper } from './save-to-stamper.js';

/**
 * PLAN.md M2 tasks 1-2: end-to-end Playwright drive of ces-planner's real
 * wizard SPA, hardcoded to the clean-tenant-mfa-baseline answer map
 * (architecture §6.2), producing the exported Manual Mission Plan + Tenant
 * Manifest JSON on disk for M2 task 3 (mid-pipeline assertion) and M2 task 4
 * (Stamper leg).
 *
 * Wizard order and hub-card titles/button labels below are grounded in
 * direct reads of LandingPage.tsx (Card titles: "Choose a Strategic Intent",
 * "Tenant Configuration Profile", "CUI Boundary Definition", "Boundary
 * Topology Confirmation", "Collect Policy Inputs", "Generate Readiness
 * Posture Questions", "Create Readiness Posture") and each wizard's Review
 * component's Save button text: BaselineReview.tsx "Save Baseline
 * (Immutable)", TCPReview.tsx "Save Profile", CUIReview.tsx "Save CUI
 * Boundary", BTCReview.tsx "Save BTC Confirmation", PolicyReview.tsx "Save
 * Policy Inputs", PostureReview.tsx "Save Readiness Posture".
 */

export interface DriveMusterOptions {
  baseUrl: string;
  customerName: string;
  answerMap?: MusterAnswerMapEntry[];
  /** Directory (relative to ces-planner's repo root, or absolute) that
   * `/api/save-to-stamper` should copy MP/TM artifacts into. */
  stamperTargetDir: string;
  headless?: boolean;
  /** GP-DEMO-3 M1: Playwright slow-motion delay (ms) between actions. 0 unless
   * the caller is in `--watch` mode (see src/demo/watch-mode.ts). */
  slowMo?: number;
}

export interface DriveMusterResult {
  missionPlanPath: string;
  manifestPath: string;
}

async function findLatestArtifact(plansDir: string, type: string): Promise<string> {
  const entries = await fs.readdir(plansDir);
  const matches = entries.filter((f) => f.startsWith(`${type}-`) && f.endsWith('.json'));
  if (matches.length === 0) {
    throw new Error(`findLatestArtifact: no "${type}-*.json" file found in ${plansDir}`);
  }
  matches.sort();
  return path.join(plansDir, matches[matches.length - 1]);
}

interface ListedArtifactPath {
  path: string;
  customerName: string;
}

async function missionPlanArtifactCount(page: Page, customerName: string): Promise<number> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.get(`${origin}/api/list-artifacts`);
  if (!res.ok()) return 0;
  const json = (await res.json()) as { artifacts?: ListedArtifactPath[] };
  return (json.artifacts ?? []).filter(
    (a) => a.customerName === customerName && a.path.includes('manual-mission-plan_'),
  ).length;
}

/** Polls `/api/list-artifacts` until the customer has at least `minCount`
 * manual-mission-plan artifacts (see driveMuster's call site doc comment for
 * why this replaces waiting on the broken "Save MP + TM to Stamper" button;
 * `minCount > 1` is the degenerate-plan regeneration path waiting for a NEW
 * artifact beyond the ones already present). */
async function waitForMissionPlanArtifact(
  page: Page,
  customerName: string,
  opts: { attempts?: number; intervalMs?: number; minCount?: number } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 30;
  const intervalMs = opts.intervalMs ?? 2000;
  const minCount = opts.minCount ?? 1;

  for (let i = 0; i < attempts; i++) {
    if ((await missionPlanArtifactCount(page, customerName)) >= minCount) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `waitForMissionPlanArtifact: fewer than ${minCount} manual-mission-plan artifact(s) for "${customerName}" after ${attempts} attempts`,
  );
}

/**
 * Degenerate-plan guard (gp-m1 finding, live-diagnosed from the gate-1
 * run-all): ces-planner's `useMissionPlanGenerator` loads its 9 JSON data
 * banks via async hooks that RESET to null on every landing-page remount, and
 * `generate()` silently substitutes empty fallbacks (`cmmcRequirements ||
 * {requirements: []}`, `evidenceMatrix || {}`, ...) for any bank still
 * in-flight. The driver clicks "Create Mission Plan" seconds after the final
 * wizard save remounts the landing page — on a loaded machine (exactly the
 * run-all case) the click wins the race, gap compilation sees no data, and
 * every ordinary control falls through gapCompiler's no-gap branch to
 * `Non-Stack` -> directive "manual": a plan that translates to ZERO
 * set_commands and makes the whole scenario vacuously unexecutable
 * (observed: 100/110 directives manual, set_sub_count 0). A healthy plan for
 * these sim scenarios (clean tenant, nothing pre-met) always carries
 * `implement` directives, so zero-implement IS the race signature — detected
 * here so the driver re-clicks the (idempotent, regenerating) button once the
 * banks have finished loading, rather than handing Stamper a vacuous plan.
 * Product bug filed as a requirement doc against ces-planner (read-only
 * sibling — hard boundary).
 */
export function countImplementDirectives(missionPlan: unknown): { total: number; implement: number } {
  const dirs =
    (missionPlan as { outputs?: { human_readable_mission_plan?: { control_directives?: Array<{ directive?: string }> } } })
      ?.outputs?.human_readable_mission_plan?.control_directives ?? [];
  return { total: dirs.length, implement: dirs.filter((d) => d.directive === 'implement').length };
}

export async function driveMuster(opts: DriveMusterOptions): Promise<DriveMusterResult> {
  const answerMap = opts.answerMap ?? CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP;
  const browser: Browser = await chromium.launch({
    headless: opts.headless ?? true,
    slowMo: opts.slowMo ?? 0,
  });

  try {
    const page: Page = await browser.newPage();
    await page.goto(opts.baseUrl);

    // 1. Create customer (LandingPage.tsx "Create New" -> CustomerForm)
    await createCustomer(page, opts.customerName);

    // 2. SIT wizard
    await launchWizardFromHub(page, 'Choose a Strategic Intent', 'New');
    await walkWizardQuestions(page, answersForWizard(answerMap, 'sit'));
    await saveWizardReview(page, /^Save Baseline \(Immutable\)$/);

    // 3. TCP wizard (Tenant Configuration Profile)
    await launchWizardFromHub(page, 'Tenant Configuration Profile', 'New');
    await walkWizardQuestions(page, answersForWizard(answerMap, 'tcp'));
    await saveWizardReview(page, /^Save Profile$/);

    // 4. CUI wizard (CUI Boundary Definition)
    await launchWizardFromHub(page, 'CUI Boundary Definition', 'New');
    await walkWizardQuestions(page, answersForWizard(answerMap, 'cui'));
    await saveWizardReview(page, /^Save CUI Boundary$/);

    // 5. BTC wizard (Boundary Topology Confirmation) — requires CUI boundary to exist
    await launchWizardFromHub(page, 'Boundary Topology Confirmation', 'New');
    await walkWizardQuestions(page, answersForWizard(answerMap, 'btc'));
    await saveWizardReview(page, /^Save BTC Confirmation$/);

    // 6. Policy Inputs wizard
    await launchWizardFromHub(page, 'Collect Policy Inputs', 'New');
    await walkWizardQuestions(page, answersForWizard(answerMap, 'policy-inputs'));
    await saveWizardReview(page, /^Save Policy Inputs$/);

    // 7. Generate RR question set (prerequisite for RRT wizard)
    await generateRRQuestionSet(page);

    // 8. RRT wizard (Create Readiness Posture) — opens into RRTPreamble.tsx
    //    first (a 5-question intake screen), then a BulkReviewTable.tsx
    //    dashboard summary (NOT the per-question RRQuestionPage.tsx flow
    //    the other five wizards use) — live-tested discovery, not
    //    anticipated by the plan's uniform six-wizard framing. See
    //    completeRrtPreamble/acceptRrtBulkReview's doc comments.
    //    clean-tenant-mfa-baseline's answer map has no 'rrt' entries
    //    (answersForWizard(answerMap, 'rrt') is always empty for this
    //    scenario), consistent with there being no per-question flow to
    //    steer here.
    await launchWizardFromHub(page, 'Create Readiness Posture', 'Start');
    await completeRrtPreamble(page);
    await acceptRrtBulkReview(page);
    await saveWizardReview(page, /^Save Readiness Posture$/);

    // 9. Generate Mission Plan (requires hasPosture true, per useMissionPlanGenerator)
    await triggerMissionPlanGeneration(page);
    // Mission Plan generation is async client-side work. Deviation note
    // (logged in IMPLEMENTATION_LOG.md): originally waited for the "Save
    // MP + TM to Stamper" button as the completion signal, but that button
    // never renders at all for a cesId-bearing customer (see
    // save-to-stamper.ts's doc comment for the confirmed root cause in
    // ces-planner's own code) — polls `/api/list-artifacts` directly for the
    // manual-mission-plan artifact's appearance instead, which is what the
    // button's own visibility was originally meant to signal.
    await waitForMissionPlanArtifact(page, opts.customerName);

    // 10. Export MP + TM (+ IM) to ces-tester's run workspace, guarded by the
    // degenerate-plan check (see countImplementDirectives's doc comment) with
    // a bounded regeneration retry — the "Create Mission Plan" card stays on
    // the landing page and regenerates in place on re-click.
    const plansDir = path.join(opts.stamperTargetDir, 'plans');
    const maxGenerationAttempts = 3;
    let missionPlanPath: string;
    let manifestPath: string;
    for (let attempt = 1; ; attempt++) {
      // Caller is expected to pass an absolute path (or one already resolved
      // relative to ces-planner's repo root, matching the Vite middleware's
      // own resolution — PHASE0_FINDINGS.md item 3).
      await saveMissionPlanToStamper(page, { customerName: opts.customerName, targetDir: opts.stamperTargetDir });
      missionPlanPath = await findLatestArtifact(plansDir, 'manual-mission-plan');
      manifestPath = await findLatestArtifact(plansDir, 'tenant-manifest');

      const missionPlan = JSON.parse(await fs.readFile(missionPlanPath, 'utf8'));
      const { total, implement } = countImplementDirectives(missionPlan);
      if (total === 0 || implement > 0) break; // healthy (or unexpected shape — mid-pipeline assertions judge that)
      if (attempt >= maxGenerationAttempts) {
        throw new Error(
          `driveMuster: mission plan still degenerate (0 "implement" among ${total} directives — ` +
            `ces-planner data-bank race, see countImplementDirectives) after ${maxGenerationAttempts} generation attempts`,
        );
      }
      console.warn(
        `driveMuster: degenerate mission plan (0 "implement" among ${total} directives) — ` +
          `regenerating (attempt ${attempt + 1}/${maxGenerationAttempts})`,
      );
      const before = await missionPlanArtifactCount(page, opts.customerName);
      await triggerMissionPlanGeneration(page);
      await waitForMissionPlanArtifact(page, opts.customerName, { minCount: before + 1 });
    }

    return { missionPlanPath, manifestPath };
  } finally {
    await browser.close();
  }
}
