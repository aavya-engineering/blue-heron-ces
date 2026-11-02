// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// loeRatesProvider.ts — VENDOR SHIM (PLAN-2 M2 slice 3).
//
// Replaces ces-planner's Zustand `useLoeRateStore` (a persisted, UI-editable
// store) in the Muster port. Muster's plan-mode does not expose runtime
// LOE-rate configuration — the port uses Planner's own DEFAULT_LOE_RATES as a
// fixed constant. The two compiler call sites that read the store
// (taskCompiler.estimateEffortBreakdown, inlineCostBuilder — the latter not in
// the vendored compile chain) call getLoeRates() instead of
// useLoeRateStore.getState(). No zustand, no localStorage, pure.
import { DEFAULT_LOE_RATES, type LoeRateConfig } from '../types/loeRates';

export function getLoeRates(): LoeRateConfig {
  return DEFAULT_LOE_RATES;
}
