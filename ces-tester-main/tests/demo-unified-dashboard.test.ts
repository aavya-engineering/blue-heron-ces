// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-1 P1-4: the unified before->after SPRS dashboard — the demo's
// payoff artifact. Offline/pure: renders the sample and asserts on content,
// no filesystem or network access.
import { describe, it, expect } from 'vitest';
import { renderUnifiedDashboard, SAMPLE_UNIFIED_RESULT } from '../src/results/unified-dashboard.js';

describe('renderUnifiedDashboard (SAMPLE_UNIFIED_RESULT)', () => {
  const html = renderUnifiedDashboard(SAMPLE_UNIFIED_RESULT);

  it('shows the SPRS before and after values and the delta', () => {
    expect(html).toContain(String(SAMPLE_UNIFIED_RESULT.sprs.before));
    expect(html).toContain(String(SAMPLE_UNIFIED_RESULT.sprs.after));
    const delta = SAMPLE_UNIFIED_RESULT.sprs.after - SAMPLE_UNIFIED_RESULT.sprs.before;
    expect(delta).toBeGreaterThan(0);
    // Delta is computed client-side from the inlined data; assert the raw
    // before/after numbers are both present in the embedded JSON payload.
    expect(html).toContain(`"before":${SAMPLE_UNIFIED_RESULT.sprs.before}`);
    expect(html).toContain(`"after":${SAMPLE_UNIFIED_RESULT.sprs.after}`);
  });

  it('is honest: after-score is a projection, not a perfect max score', () => {
    expect(SAMPLE_UNIFIED_RESULT.sprs.after).toBeLessThan(SAMPLE_UNIFIED_RESULT.sprs.max);
  });

  it('renders findings rows (before vs after status)', () => {
    expect(SAMPLE_UNIFIED_RESULT.findings.length).toBeGreaterThan(0);
    for (const f of SAMPLE_UNIFIED_RESULT.findings) {
      expect(html).toContain(f.control);
      expect(html).toContain(f.title);
    }
  });

  it('shows evidence with sha256 present for evidence items that have one', () => {
    const withHash = SAMPLE_UNIFIED_RESULT.evidence.filter((e) => e.sha256);
    expect(withHash.length).toBeGreaterThan(0);
    for (const e of withHash) {
      expect(html).toContain(e.sha256 as string);
    }
  });

  it('shows all 5 beat labels', () => {
    expect(SAMPLE_UNIFIED_RESULT.beats).toHaveLength(5);
    for (const b of SAMPLE_UNIFIED_RESULT.beats) {
      expect(html).toContain(b.label);
    }
  });

  it('is fully self-contained: no external URLs, no external script/style/font/image references', () => {
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/\/\/cdn/i);
    expect(html).not.toMatch(/src\s*=\s*["']/i);
    expect(html).not.toMatch(/@import/i);
  });
});
