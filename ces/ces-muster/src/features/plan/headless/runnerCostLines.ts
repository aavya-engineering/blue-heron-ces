// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// runnerCostLines.ts (Blue Heron Defense, CES team): the headless runner's cost-notice lines.
// FIN-17 / CG-8 (COST-GATE-SPEC.md §5.2, "Headless runner"): plan-from-discovery.ts appends
// `recurring_items=N recurring_est_month=$low-$high licence_deps=M` to its MX_SUMMARY line and
// prints one `MX_COST_NOTICE <item_id> <label> ~$x-$y/month` line per item before MX_RESULT.
// Kept in its own module so the line format is unit-tested (the runner runs main() on import).
// Muster only informs: these lines never block a compile.

export interface RunnerNotice {
  items: Array<{ item_id: string; label: string; estimate_month_low: number; estimate_month_high: number }>;
  licence_dependencies?: unknown[];
  total_estimate_low: number;
  total_estimate_high: number;
}

/** "$4.56" / "$32": whole numbers bare, others to the cent (the notice's own formatEstimate rule). */
export function dollars(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/** Always "$low-$high" (both ends, even when equal), so a reader can parse it with one pattern. */
export function range(low: number, high: number): string {
  return `${dollars(low)}-${dollars(high)}`;
}

/** The MX_SUMMARY fields (no leading space). A plan without a notice reports 0 items. */
export function noticeSummaryFields(notice: RunnerNotice | null | undefined): string {
  const n = notice ?? { items: [], licence_dependencies: [], total_estimate_low: 0, total_estimate_high: 0 };
  return `recurring_items=${n.items.length} recurring_est_month=${range(n.total_estimate_low, n.total_estimate_high)} licence_deps=${(n.licence_dependencies ?? []).length}`;
}

/** One MX_COST_NOTICE line per item, in notice order (each without a trailing newline). */
export function noticeLines(notice: RunnerNotice | null | undefined): string[] {
  return (notice?.items ?? []).map(
    (i) => `MX_COST_NOTICE ${i.item_id} ${i.label.replace(/\s+/g, ' ').trim()} ~${range(i.estimate_month_low, i.estimate_month_high)}/month`,
  );
}
