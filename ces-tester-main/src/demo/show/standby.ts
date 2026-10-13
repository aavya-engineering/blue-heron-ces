// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — the synthetic standby cover ("slide 0").
 *
 * The demo used to open both operator windows on a bare authored slide 1 while
 * the CES tools armed behind them (up to ~1 min), and a narration-only slide 1
 * silently burned its dwell during arming. This module injects a synthetic
 * standby cover that HOLDS (no dwell burn) until prep + warm ops settle, then
 * reveals the real slide 1.
 *
 * RUNNER-ONLY. The standby slide is prepended in `show-run.ts` at run time and
 * NEVER authored in an xlsx: `deck-model.ts`, `deck-validate.ts`,
 * `xlsx-loader.ts` and `make-demo-xlsx.mjs` know nothing of it. `--check`
 * (`show-command.ts`, never calls `runShow`) and the golden fixture (an in-test
 * `DemoDeck` literal) therefore stay untouched.
 *
 * The op id is a CONTAINED `as DemoOpId` cast here. `DemoOpId` (deck-model.ts)
 * is a closed union feeding `Record<DemoOpId, …>` totality maps; adding the
 * standby id to that union would force it into the validator and every op map.
 * Casting locally keeps the union closed — a deck can never name `standby`.
 */

import type { DemoDeck, DemoOpId, DemoSlide } from './deck-model.js';

/**
 * The synthetic op id for the standby cover. A contained cast — see the module
 * header for why it is NOT a member of the `DemoOpId` union.
 */
export const STANDBY_OP_ID = 'standby' as DemoOpId;

/**
 * The standby cover slide's number. 0 is unreachable for an authored deck
 * (rows are 1-based), so `slideNumber === 0` plus `STANDBY_OP_ID` is a sentinel
 * a real deck cannot produce — which is what lets consumers (the report, the
 * renderer, `startOpFor`) filter it.
 */
export const STANDBY_SLIDE_NUMBER = 0;

/** Is this the synthetic standby cover slide? */
export function isStandbySlide(slide: DemoSlide): boolean {
  return slide.slideNumber === STANDBY_SLIDE_NUMBER && slide.op.opId === STANDBY_OP_ID;
}

/**
 * The synthetic standby slide. Its op is `mode:'live'` with a driving id, so
 * `slideDrivesOp` is true and the show HOLDS on it (`ops[0]='pending'` →
 * `dwellDeadline` null → no burn). `startOpFor` guards against actually running
 * it, so the op stays `pending` forever until a manual key or the end-of-prep
 * reveal advances off it. `mode:'live'` (not `'warm'`) also keeps the warm-op
 * prep loop from picking it up.
 */
function standbySlide(): DemoSlide {
  return {
    slideNumber: STANDBY_SLIDE_NUMBER,
    rows: [{ sheetRow: 0, slideNumber: STANDBY_SLIDE_NUMBER }],
    op: { opId: STANDBY_OP_ID, mode: 'live', tools: [], images: [] },
  };
}

/**
 * Prepend the standby cover to a deck. Returns a new deck; the input is
 * untouched. Called only by the operator run when `--standby` is on (the
 * default for every CLI `demo:show` run).
 */
export function withStandby(deck: DemoDeck): DemoDeck {
  return { ...deck, slides: [standbySlide(), ...deck.slides] };
}
