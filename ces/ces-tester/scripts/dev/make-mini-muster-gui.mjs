// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Generates `demos/mini-muster-gui.xlsx` — the five Muster GUI acts, live, in
 * deck order, with the app in the right pane. A fast-loop deck for proving the
 * GUI acts are visibly driven (GP-DEMO-6 theatre); reuses the shipped writer.
 *
 *   node scripts/dev/make-mini-muster-gui.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS, buildXlsx, sheetRowsFor } from '../make-demo-xlsx.mjs';

const ROWS = [
  {
    slide: 1,
    talk: 'Five beats of Readiness Evaluation, back to back, the real app driven live in the right pane: point it at the tenant, walk the tenant for real, confirm the boundary, start the adaptive interview, and export the score.',
    feature: 'Muster, operated live',
    fn: 'The Readiness Evaluation workflow, driven end to end in the real app',
    benefit: 'You watch the tool being operated, not a slide of it',
    diff: '',
    tools: 'muster, stacksim',
    mode: 'staged',
    op: '',
    duration: 8,
    rightThird: 'absent',
  },
  {
    slide: 2,
    talk: 'First the manifest: what is being assessed, by whom, and how. Session kind, auth tier, tenant, operator — typed in, on stage.',
    feature: 'Point Muster at the tenant',
    fn: 'Declare the readiness session manifest for the sim tenant',
    benefit: 'Every result carries provenance — who assessed what, under which tier',
    diff: '',
    tools: 'muster',
    mode: 'live',
    op: 'muster-connect-tenant',
    duration: 8,
    rightThird: 'app',
  },
  {
    slide: 3,
    talk: 'Now the real discovery walk runs against the tenant — read-only — and this run’s result is imported into the app. Never the fixture button.',
    feature: 'Walk the tenant for real',
    fn: 'Run DISCOVERY-1 against the sim and import the artifact through the app’s own seam',
    benefit: 'What the room sees is this tenant, this run — not canned data',
    diff: '',
    tools: 'muster, stacksim',
    mode: 'live',
    op: 'muster-auto-analysis',
    duration: 10,
    rightThird: 'app',
  },
  {
    slide: 4,
    talk: 'Discovery drafts the CUI boundary; a named human confirms it. Drafts never count until someone signs.',
    feature: 'Confirm the boundary',
    fn: 'A named confirmer attests one drafted boundary answer and continues',
    benefit: 'Human accountability on every scored fact',
    diff: '',
    tools: 'muster',
    mode: 'live',
    op: 'muster-consent-and-attest',
    duration: 8,
    rightThird: 'app',
  },
  {
    slide: 5,
    talk: 'The interview adapts: facts discovery already established prune the questions a human has to answer.',
    feature: 'Start the adaptive interview',
    fn: 'Begin the interview on the discovery branch and measure the pruning against a manual branch',
    benefit: 'Fewer questions, same rigor',
    diff: '',
    tools: 'muster',
    mode: 'live',
    op: 'muster-adaptive-interview',
    duration: 8,
    rightThird: 'app',
  },
  {
    slide: 6,
    talk: 'Finish and export: the conservative SPRS estimate and the readiness result, from the app’s own export.',
    feature: 'Export the score',
    fn: 'Finish the interview, read the conservative score, export the readiness result',
    benefit: 'A number you can hand to a prime, with the evidence behind it',
    diff: '',
    tools: 'muster',
    mode: 'live',
    op: 'muster-generate-sprs-mp',
    duration: 12,
    rightThird: 'app',
  },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', '..', 'demos', 'mini-muster-gui.xlsx');
fs.writeFileSync(out, buildXlsx(COLUMNS, sheetRowsFor(ROWS), 'mini-muster-gui'));
console.log(`wrote ${out} (${ROWS.length} slides)`);
