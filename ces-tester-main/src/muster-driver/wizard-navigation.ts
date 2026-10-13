// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import type { Page } from 'playwright';
import type { MusterAnswerMapEntry } from './answer-map.js';

/**
 * PLAN.md M2 task 1: Playwright helpers driving ces-planner's real wizard
 * SPA. Grounded in direct reads of the wizard components (SITWizard.tsx,
 * QuestionPage.tsx, AnswerInput.tsx, TCPSectionPage.tsx/TCPQuestionInput.tsx,
 * CUISectionPage.tsx/CUIQuestionInput.tsx, BTCQuestionPage.tsx,
 * PolicySectionPage.tsx/PolicyQuestionInput.tsx, RRQuestionPage.tsx,
 * LandingPage.tsx) plus an independent recon-agent pass over the same files.
 *
 * Key structural fact (both this pass and the recon agent confirmed it):
 * every one of the six wizards renders ONE question per page ("SectionPage"
 * in the component name refers only to a progress-label grouping, not
 * multi-question-per-page rendering) with a single `[data-question-id]`
 * element per page. All six wizards also pre-fill every question that has a
 * YAML `recommended` default via `buildRecommendations()` (confirmed wired
 * into SIT/TCP/CUI/BTC/Policy's mount effects; RRT has no `required` gate at
 * all and always defaults to a valid value) — so the driver's default action
 * for any question NOT in the scenario's answer map is simply to click
 * "Next", relying on the product's own pre-filled defaults to satisfy
 * required-field validation. Only questions explicitly present in the
 * answer map get their control interacted with.
 */

const NEXT_BUTTON_PATTERN = /^(Next|Review (Baseline|Confirmation|Boundary|Profile|Inputs|Posture)|Save & Next)$/;

/** Fills the "Create New Customer" form (CustomerForm.tsx) and submits it.
 * Per LandingPage.tsx:667-675, success is signaled by the form disappearing
 * and the Customer card showing the new name — there is no route change or
 * customer ID in the URL. */
export async function createCustomer(page: Page, customerName: string): Promise<void> {
  await page.getByRole('button', { name: 'Create New', exact: true }).click();
  await page.getByPlaceholder('Acme Corporation').fill(customerName);
  await page.getByRole('button', { name: 'Create Customer', exact: true }).click();
  // Wait for the form to disappear (success signal — LandingPage.tsx:664 showCustomerForm -> false)
  await page.getByRole('button', { name: 'Create Customer', exact: true }).waitFor({ state: 'detached' });
}

/** Clicks a wizard's "New" launch button from the landing page hub. Each
 * wizard's hub card has a distinctly-labeled New/Start button
 * (LandingPage.tsx): SIT/TCP/CUI/BTC/Policy = "New", RRT's posture card =
 * "Start". `cardTitle` disambiguates cards since several share the "New"
 * label. */
/**
 * Card.tsx's outer container is `<div className="border-[1.5px]
 * border-slate-200 overflow-hidden ...">`, with the title `<h3>` inside a
 * header row div whose OWN class also happens to contain the substring
 * "border-slate-200" (`border-b-[1.5px] border-slate-200 ...`).
 *
 * Deviation note (logged in IMPLEMENTATION_LOG.md): the first version of
 * this selector matched on `contains(@class,"border-slate-200")`, which is
 * true of BOTH the header row div and the outer Card div — `ancestor::...[1]`
 * (nearest match) resolved to the header row, not the Card root, so the
 * button lookup scoped to it found nothing and `launchWizardFromHub`'s
 * fallback (click the first page-wide match of the button name) silently
 * clicked the WRONG wizard's launch button (confirmed live: asking for
 * "Tenant Configuration Profile" landed back on `/sit`, not `/tcp`, because
 * "New" matched SIT's card first in DOM order). Fixed by matching
 * `overflow-hidden`, present only on the outer Card div.
 */
async function cardScopedButton(page: Page, cardTitle: string, buttonName: string) {
  const heading = page.getByRole('heading', { name: cardTitle, exact: true });
  await heading.waitFor({ state: 'visible' });
  const container = heading.locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
  return container.getByRole('button', { name: buttonName, exact: true }).first();
}

export async function launchWizardFromHub(
  page: Page,
  cardTitle: string,
  buttonName: string,
): Promise<void> {
  const button = await cardScopedButton(page, cardTitle, buttonName);
  if (await button.count()) {
    await button.click();
  } else {
    // Fallback: card-scoped lookup failed (markup drift) — click the first
    // matching button on the page as a last resort, logged by the caller.
    await page.getByRole('button', { name: buttonName, exact: true }).first().click();
  }
}

/**
 * Sets the value of a question's answer control, dispatching on answerType.
 * Scoped to the `[data-question-id]` container so option-label collisions
 * with other page chrome (e.g. multiple "L2" strings) cannot occur.
 *
 * Deviation note (logged in IMPLEMENTATION_LOG.md): live-tested, SIT's
 * `QuestionPage.tsx` renders a SECOND `<select>` inside the same
 * `data-question-id` container for "Provenance (Source of Information)"
 * (lines 172-183, unconditional on every question, separate from the
 * answer control under "Your Answer") — an unscoped `scope.locator('select')`
 * throws Playwright's strict-mode "resolved to 2 elements" error. `.first()`
 * on `enum`/`single_select`'s selects and radio groups is not enough on its
 * own; each control lookup below explicitly targets the FIRST matching
 * element within the question scope, relying on the answer control always
 * rendering before the Provenance select in DOM order
 * (QuestionPage.tsx:163-183: "Your Answer" block precedes "Provenance").
 */
async function setAnswerValue(
  page: Page,
  questionId: string,
  answerType: MusterAnswerMapEntry['answerType'],
  value: string | number | boolean | string[],
): Promise<void> {
  const scope = page.locator(`[data-question-id="${questionId}"]`);
  await scope.waitFor({ state: 'visible' });

  switch (answerType) {
    case 'boolean': {
      const label = value === true ? 'Yes' : 'No';
      await scope.getByRole('radio', { name: label }).check();
      return;
    }
    case 'enum': {
      // AnswerInput.tsx (SIT): native <select>, options rendered as the raw
      // value string. .first() — the Provenance <select> is the 2nd select
      // in the same scope (see this function's doc comment).
      await scope.locator('select').first().selectOption(String(value));
      return;
    }
    case 'single_select': {
      // TCPQuestionInput.tsx / CUIQuestionInput.tsx / PolicyQuestionInput.tsx:
      // radio buttons labeled with the raw option string.
      await scope.getByRole('radio', { name: String(value), exact: true }).check();
      return;
    }
    case 'multi_select': {
      const values = Array.isArray(value) ? value : [String(value)];
      for (const v of values) {
        await scope.getByRole('checkbox', { name: v, exact: true }).check();
      }
      return;
    }
    case 'number': {
      await scope.locator('input[type="number"]').fill(String(value));
      return;
    }
    case 'text':
    case 'string': {
      const textInput = scope.locator('textarea, input[type="text"]').first();
      await textInput.fill(String(value));
      return;
    }
    case 'list': {
      await scope.locator('textarea').fill(Array.isArray(value) ? value.join('\n') : String(value));
      return;
    }
    default:
      throw new Error(`setAnswerValue: unsupported answerType "${answerType}" for question "${questionId}"`);
  }
}

/**
 * Deviation note (logged in IMPLEMENTATION_LOG.md): PLAN.md's driver design
 * assumed every required question either has a YAML `recommended` default
 * (pre-filled by the product's own `buildRecommendations()`) or is covered
 * by the scenario's `muster.answer_map`. Live-tested against the real SI
 * bank: this is false in general — e.g. G-04 ("other regulated/sensitive
 * data constraints", `multi_select`, `required: true`, NO `recommended`
 * field) blocks with "Next" disabled and is not, and should not need to be,
 * in clean-tenant-mfa-baseline's answer map (that scenario's answer map only
 * lists the questions load-bearing to the MFA-CA-policy outcome; adding
 * every incidentally-required question with no product default would make
 * the answer map balloon to dozens of entries per wizard with no scenario
 * relevance). This function provides a generic, minimal-footprint fallback:
 * when "Next" is disabled and the question has no answer-map entry, pick
 * the first available option from whatever control is actually rendered
 * (first radio/checkbox/select option, or a placeholder string/0 for
 * free-text/number) — enough to satisfy `required`, not a scenario-relevant
 * value. This is answer-map resolution's fallback tier, not a replacement
 * for it.
 */
/**
 * SIT's `QuestionPage.tsx` (only SIT — verified TCP/CUI/Policy/BTC hardcode
 * `provenance_class: 'client_assertion'` in JS with no rendered control)
 * renders a SECOND, unrelated `<select>` for "Provenance (Source of
 * Information)" inside the same `data-question-id` container, after the
 * "Your Answer" block. `answerControlScope` narrows to the DOM subtree
 * between the "Your Answer" label and the end of the question card so a
 * generic fallback never mistakes the Provenance select (or misses a
 * `structured_object`'s number inputs behind it) for the real answer
 * control. Falls back to the full question scope on wizards with no "Your
 * Answer" label (TCP/CUI/Policy/BTC/RRT render the answer control directly,
 * no such split).
 */
function answerControlScope(page: Page, questionId: string) {
  const scope = page.locator(`[data-question-id="${questionId}"]`);
  const yourAnswerLabel = scope.getByText('Your Answer', { exact: true });
  return {
    async narrowedOrFull() {
      if ((await yourAnswerLabel.count()) > 0) {
        // The answer control div is the "Your Answer" label's next sibling.
        return yourAnswerLabel.locator('xpath=following-sibling::*[1]');
      }
      return scope;
    },
  };
}

async function fillFirstAvailableOption(page: Page, questionId: string): Promise<void> {
  const scope = await answerControlScope(page, questionId).narrowedOrFull();

  const radios = scope.getByRole('radio');
  if ((await radios.count()) > 0) {
    await radios.first().check();
    return;
  }
  const checkboxes = scope.getByRole('checkbox');
  if ((await checkboxes.count()) > 0) {
    await checkboxes.first().check();
    return;
  }
  // number/text checked before select: a structured_object's per-field
  // number/text inputs must win over a select that happens to render
  // elsewhere in a not-fully-narrowed scope (defensive — narrowedOrFull()
  // already excludes the Provenance select in the common SIT case).
  const numberInputs = scope.locator('input[type="number"]');
  const numberCount = await numberInputs.count();
  for (let i = 0; i < numberCount; i++) {
    await numberInputs.nth(i).fill('1');
  }
  const textInputs = scope.locator('textarea, input[type="text"]');
  const textCount = await textInputs.count();
  for (let i = 0; i < textCount; i++) {
    const input = textInputs.nth(i);
    // Deviation note (logged in IMPLEMENTATION_LOG.md): TCP's `guid` and
    // `upn_list` answer_types render as a plain `input[type="text"]`/
    // `textarea` (TCPQuestionInput.tsx) with NO distinguishing DOM
    // attribute other than a format-hinting `placeholder` — but
    // `answerValidation.ts`'s `validateGuid`/`validateUpnList` reject a
    // generic placeholder string (live-tested: TCP.TI.001, "Microsoft Entra
    // tenant ID (GUID)", stayed blocked with the generic placeholder text).
    // Detect the expected format from the placeholder text itself (GUID
    // inputs' placeholder is a literal all-zeros GUID; UPN inputs' help/
    // placeholder text contains "@") rather than guessing blindly.
    const placeholder = (await input.getAttribute('placeholder')) ?? '';
    if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(placeholder)) {
      await input.fill('00000000-0000-0000-0000-000000000000');
    } else if (placeholder.includes('@')) {
      await input.fill('ces-tester-placeholder@example.com');
    } else {
      await input.fill('ces-tester driver placeholder answer');
    }
  }
  if (numberCount > 0 || textCount > 0) {
    return;
  }
  const selects = scope.locator('select');
  if ((await selects.count()) > 0) {
    const select = selects.first();
    const optionValues = await select.locator('option').evaluateAll((opts) =>
      (opts as Array<{ value: string }>).map((o) => o.value).filter((v) => v !== ''),
    );
    if (optionValues.length > 0) {
      await select.selectOption(optionValues[0]);
    }
    return;
  }
}

/**
 * Walks a single wizard's question pages until a "Next"/"Review ..."/
 * "Save & Next" button is no longer present on the page (i.e. a Review
 * screen has been reached). For each page, if the current question's
 * `data-question-id` matches an entry in `answerMapForWizard`, sets that
 * control's value; otherwise leaves the product's own recommended-default
 * pre-fill untouched and clicks straight through — falling back to
 * `fillFirstAvailableOption` only if "Next" is still disabled after that
 * (see its doc comment for why this fallback tier exists).
 *
 * `maxQuestions` is a hard bound (not a PLAN.md requirement) guarding against
 * an infinite loop if a wizard's Next button never disappears (e.g. a
 * markup/text mismatch) — throws instead of hanging forever.
 */
export async function walkWizardQuestions(
  page: Page,
  answerMapForWizard: MusterAnswerMapEntry[],
  maxQuestions = 100,
): Promise<void> {
  for (let i = 0; i < maxQuestions; i++) {
    const nextButton = page.getByRole('button', { name: NEXT_BUTTON_PATTERN });
    // Deviation note (logged in IMPLEMENTATION_LOG.md): live-tested,
    // `nextButton.count()` queries the DOM immediately with no auto-wait,
    // which races the page's post-click React re-render — right after
    // clicking "Next", the button transiently disappears and reappears for
    // the next question, and an immediate `.count()` check on the very next
    // loop iteration can observe the transient absence and incorrectly
    // conclude the wizard reached its Review screen (confirmed: a debug run
    // exited the loop after only the first question, leaving the wizard
    // still mid-flow). `waitFor` with a bounded timeout gives the re-render
    // a chance to settle before treating absence as terminal.
    const hasNext = await nextButton
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!hasNext) {
      return; // landed on a Review screen (no more question pages)
    }

    const questionEl = page.locator('[data-question-id]').first();
    const questionId = await questionEl.getAttribute('data-question-id');

    if (questionId) {
      const entry = answerMapForWizard.find((e) => e.questionId === questionId);
      if (entry) {
        await setAnswerValue(page, questionId, entry.answerType, entry.value);
      }
      // React state updates (and the "Next" button's disabled attribute)
      // settle asynchronously after a control interaction — a short wait
      // here avoids reading `isDisabled()` against stale DOM (live-tested:
      // checking immediately after setAnswerValue/no-op could still see the
      // pre-answer disabled state on some questions).
      await page.waitForTimeout(150);
      if (await nextButton.first().isDisabled()) {
        await fillFirstAvailableOption(page, questionId);
        await page.waitForTimeout(150);
      }
    }

    await nextButton.first().click();
  }

  throw new Error(`walkWizardQuestions: exceeded maxQuestions=${maxQuestions} without reaching a Review screen`);
}

/** Clicks a wizard's final "Save ..." button on its Review screen, which
 * (per BaselineReview.tsx/CUIReview.tsx/BTCReview.tsx/PostureReview.tsx, all
 * read directly) persists the artifact and navigates back to `/dashboard`. */
export async function saveWizardReview(page: Page, saveButtonNamePattern: RegExp): Promise<void> {
  const saveButton = page.getByRole('button', { name: saveButtonNamePattern });
  await saveButton.click();
  await page.waitForURL(/\/dashboard$/);
}

/** Clicks the "New" question-set generation action on the landing page
 * (LandingPage.tsx:1243/1247, "Generate Readiness Posture Questions" card) —
 * a prerequisite step before RRT can be walked, distinct from the other five
 * wizards' plain "New" launch. */
export async function generateRRQuestionSet(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Generate Readiness Posture Questions', exact: true });
  await heading.waitFor({ state: 'visible' });
  const container = heading.locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
  const button = container.getByRole('button', { name: /^(New|Generating\.\.\.)$/ }).first();
  await button.click();
  // Wait for the button to return to its idle "New" label (generation complete).
  await container.getByRole('button', { name: 'New', exact: true }).waitFor({ state: 'visible' });
}

/** Clicks the Mission Planner action card's generate button
 * (LandingPage.tsx:1397-1418). Card-scoped, and matching BOTH labels: once a
 * plan exists, ActionCard.tsx:59 relabels the button from "Create Mission
 * Plan" to "Create New" — which ALSO collides with the customer-creation
 * "Create New" button elsewhere on the landing page, so an unscoped lookup is
 * wrong in exactly the regeneration case (the degenerate-plan guard's retry —
 * observed live in gp-m2-gate-3: unscoped "Create Mission Plan" lookup timed
 * out because the card had flipped to its completed label). */
export async function triggerMissionPlanGeneration(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Mission Planner', exact: true });
  await heading.waitFor({ state: 'visible' });
  const container = heading.locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
  await container.getByRole('button', { name: /^(Create Mission Plan|Create New)$/ }).first().click();
}

/**
 * PLAN.md M2 task 1 (RRT-specific discovery, not anticipated by the plan's
 * six-wizard framing): live-tested, RRT does NOT open directly into its
 * per-question flow like the other five wizards — it first shows
 * `RRTPreamble.tsx`, a distinct 5-question intake screen ("Readiness Recon
 * — Intake") gating entry into the real posture questions. That screen
 * offers a `"New Tenant — Fill Defaults"` button
 * (`RRTPreamble.tsx:228-233`) which sets `NEW_TENANT_DEFAULTS`
 * (`license_tier: 'unknown'`, `security_archetype: 'greenfield'`,
 * `endpoint_management: 'unmanaged'`, `monitoring_siem: 'none'`,
 * `policy_doc_state: 'nothing_written'`) and calls `onComplete` directly,
 * bypassing the 5-question form entirely — an exact match for
 * clean-tenant-mfa-baseline's "clean tenant" premise, so the driver clicks
 * this rather than answering the 5 preamble questions individually.
 */
export async function completeRrtPreamble(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New Tenant — Fill Defaults', exact: true }).click();
}

/**
 * PLAN.md M2 task 1 (RRT-specific discovery, continued from
 * completeRrtPreamble): after the preamble, RRT does NOT show a per-question
 * `RRQuestionPage.tsx` flow at all when reached via "New Tenant — Fill
 * Defaults" — `RRTWizard.tsx`'s `wizardPhase` goes straight to a dashboard
 * summary (`BulkReviewTable.tsx`: category cards with pre-derived action
 * counts, e.g. "Identity Access Management(43 actions)9%"), not individual
 * questions. `walkWizardQuestions` (built for the other five wizards'
 * one-question-per-page pattern) never finds a matching `[data-question-id]`
 * flow here because there isn't one. `BulkReviewTable.tsx`'s
 * `"Accept & Generate Posture"` button (lines 472-477) is always enabled —
 * no per-item interaction required — and calls `onAcceptAll` ->
 * `handleAcceptReview` (`RRTWizard.tsx:196-217`), which generates the
 * posture and sets `wizardPhase` directly to `'posture_review'`
 * (PostureReview.tsx, "Save Readiness Posture" — same as the other five
 * wizards' Review screens). This function replaces a `walkWizardQuestions`
 * call for RRT specifically.
 */
export async function acceptRrtBulkReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Accept & Generate Posture', exact: true }).click();
}
