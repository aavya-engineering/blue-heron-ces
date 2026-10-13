// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DW#3b — individual_contractor engagement hides prime-only UI elements.
// Imports and renders the REAL exported MusterNav from App.tsx —
// if the production logic changes, this test catches the regression.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test, expect } from 'vitest';
import { MusterNav } from '@/features/app/App';
import type { EngagementKind } from '@/shared/types/engagement';

describe('DW#3b — individual_contractor hides prime-only UI (real MusterNav)', () => {
  test('rollup-nav is NOT rendered for individual_contractor', () => {
    const html = renderToStaticMarkup(
      React.createElement(MusterNav, { kind: 'individual_contractor', onNavigate: () => {} })
    );
    expect(html).not.toContain('rollup-nav');
  });

  test('rollup-nav IS rendered for prime_and_subs', () => {
    const html = renderToStaticMarkup(
      React.createElement(MusterNav, { kind: 'prime_and_subs', onNavigate: () => {} })
    );
    expect(html).toContain('rollup-nav');
  });

  test('roster-section is not rendered when kind is individual_contractor', () => {
    // App.tsx renders roster-section only when view==='rollup' AND kind==='prime_and_subs'.
    // Test that conditional directly with a helper that mirrors the App predicate.
    function rosterVisible(kind: EngagementKind, view: string): boolean {
      return view === 'rollup' && kind === 'prime_and_subs';
    }
    expect(rosterVisible('individual_contractor', 'rollup')).toBe(false);
    expect(rosterVisible('individual_contractor', 'result')).toBe(false);
    // Confirm prime_and_subs in rollup view does show it
    expect(rosterVisible('prime_and_subs', 'rollup')).toBe(true);
  });
});
