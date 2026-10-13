// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-2 M1 — a tiny registry of `demo:run --scenario <id>` dispatch
 * targets. `needle` is the existing GP-DEMO-1 seed->Muster->Stamper->EO
 * before/after spine (demo:run's unchanged default); `eval` is the GP-DEMO-2
 * evaluation-mode leg (`demo:eval --all`). Kept deliberately tiny — this is a
 * lookup table, not a plugin system.
 */

export type DemoScenarioId = 'needle' | 'eval' | 'e2e';

export interface DemoScenarioEntry {
  readonly id: DemoScenarioId;
  readonly description: string;
}

export const DEMO_SCENARIOS: readonly DemoScenarioEntry[] = [
  { id: 'needle', description: 'GP-DEMO-1 needle: seed -> Muster -> Stamper -> EO before/after SPRS' },
  { id: 'eval', description: 'GP-DEMO-2 evaluation-mode leg: mu discovery --sim against 5 ground-truth tenant configs' },
  { id: 'e2e', description: 'GP-DEMO-3 end-to-end: Beats 0-5, all four legs Playwright-driven, AO evidence auto-collected last' },
];

export const DEFAULT_DEMO_SCENARIO_ID: DemoScenarioId = 'needle';

/** Resolves a `--scenario` argument to a registry entry. Unknown/absent
 * values default to `needle` — demo:run's default behavior stays unchanged. */
export function resolveDemoScenario(id: string | undefined): DemoScenarioEntry {
  const found = DEMO_SCENARIOS.find((s) => s.id === id);
  return found ?? DEMO_SCENARIOS.find((s) => s.id === DEFAULT_DEMO_SCENARIO_ID)!;
}
