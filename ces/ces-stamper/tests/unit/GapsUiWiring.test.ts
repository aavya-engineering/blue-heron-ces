// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ST-11: GapAnalyzer + GET /api/compute-gaps are real production code (see GapsRoute.test.ts),
 * but VERIFY-stamper.md found nothing in the operator GUI ever calls the endpoint
 * (`grep -rn "compute-gaps" public/index.html` had no hits). This test asserts the UI actually
 * wires a caller to the real handler and renders its response, closing the "no UI caller" gap.
 *
 * It reads the real public/index.html from disk (no jsdom/browser execution available in this
 * project's Jest config — testEnvironment: 'node', no jsdom preset installed), so it can only
 * prove the wiring exists syntactically. GapsRoute.test.ts proves the handler it calls is real,
 * end-to-end, against production code.
 */
describe('Stamper GUI calls GET /api/compute-gaps (ST-11)', () => {
  const indexPath = path.resolve(__dirname, '..', '..', 'public', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf-8');

  it('has a button that invokes a compute-gaps handler', () => {
    expect(html).toMatch(/onclick=["']doComputeGaps\(\)["']/);
  });

  it('defines doComputeGaps() and it fetches the real /api/compute-gaps endpoint', () => {
    const fnMatch = html.match(/function doComputeGaps\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toContain('/api/compute-gaps');
    expect(fnBody).toContain('tenant');
  });

  it('renders the returned plan.gap_controls (not just fetches and discards it)', () => {
    expect(html).toMatch(/function renderGapPlan\s*\(/);
    const renderMatch = html.match(/function renderGapPlan\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    expect(renderMatch).not.toBeNull();
    expect(renderMatch![0]).toContain('gap_controls');
  });

  it('the compute-gaps panel lives in the GUI (has a container element to render into)', () => {
    expect(html).toMatch(/id=["']gapPlanSection["']/);
  });
});
