// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-2 M1 — the tiny `demo:run --scenario <needle|eval>` registry.
import { describe, it, expect } from 'vitest';
import { resolveDemoScenario, DEMO_SCENARIOS, DEFAULT_DEMO_SCENARIO_ID } from '../src/demo/scenario-registry.js';

describe('resolveDemoScenario', () => {
  // GP-DEMO-3 M5 added 'e2e' — and `runDemoRunCommand` dispatches it, so a
  // registered-but-undispatched id can never become a quiet substitution.
  it('registers exactly needle, eval and e2e', () => {
    expect(DEMO_SCENARIOS.map((s) => s.id)).toEqual(['needle', 'eval', 'e2e']);
  });

  it('resolves "e2e" explicitly', () => {
    expect(resolveDemoScenario('e2e').id).toBe('e2e');
  });

  it('defaults to "needle" (demo:run default behavior stays unchanged)', () => {
    expect(DEFAULT_DEMO_SCENARIO_ID).toBe('needle');
    expect(resolveDemoScenario(undefined).id).toBe('needle');
  });

  it('resolves "eval" explicitly', () => {
    expect(resolveDemoScenario('eval').id).toBe('eval');
  });

  it('falls back to the default for an unknown scenario id', () => {
    expect(resolveDemoScenario('bogus').id).toBe('needle');
  });
});
