// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GATE-RUN: DP-1, the plan-time opt-in of the cost gate (COST-GATE-SPEC.md §3.4), from the
 * command line: `stamper cost-ack --tenant <slug> --entry <id>`. It shows the entry's estimate a
 * month, its basis, the price date and the standard alternative, asks the operator to type the
 * entry id, and records the opt-in through CostGate's `recordCostAck` (cost-acks.json beside
 * variables.json, plus a cost-gate evidence record with `dp: 1`). Without a terminal it refuses.
 * The next translate keeps the entry; DP-2 is still asked at run time.
 */
import { Command } from 'commander';
import inquirer from 'inquirer';
import { tenantBaseDir } from '../core/EvidenceReadinessAnalyzer.js';
import { loadCostGateReference, recordCostAck, formatEstimate, CostGateError, type CostGateReference, type CostAck } from '../core/CostGate.js';

const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

/** What DP-1 shows the operator for one recurring entry. */
export interface Dp1Summary {
  entry_id: string;
  label: string;
  control_ids: string[];
  cost_key: string;
  estimate: string;
  estimate_month_low: number;
  estimate_month_high: number;
  estimate_basis: string;
  price_date: string;
  standard_alternative: string[];
  last_resort: boolean;
}

/** The DP-1 view of one entry, or a refusal text (unknown, free, or unpriced). */
export function dp1Summary(entryId: string, ref: CostGateReference): Dp1Summary | { refused: string } {
  const item = ref.byId.get(entryId);
  if (!item) return { refused: `DP-1 refused: ${entryId} has no cost record` };
  if (!item.cost_gate.recurring) return { refused: `DP-1 refused: ${entryId} is free; nothing to opt in to` };
  const key = item.cost_gate.cost_key ?? undefined;
  const price = key ? ref.estimates.prices[key] : undefined;
  if (!key || !price) return { refused: `DP-1 refused: ${entryId} has no price (cost_key ${key ?? 'none'})` };
  return {
    entry_id: entryId,
    label: item.label,
    control_ids: [...item.control_ids],
    cost_key: key,
    estimate: formatEstimate(price.estimate_month_low, price.estimate_month_high),
    estimate_month_low: price.estimate_month_low,
    estimate_month_high: price.estimate_month_high,
    estimate_basis: item.cost_gate.estimate_basis ?? price.basis,
    price_date: ref.estimates.price_date,
    standard_alternative: item.cost_gate.standard_alternative ?? [],
    last_resort: item.cost_gate.last_resort === true,
  };
}

export function dp1SummaryText(s: Dp1Summary): string {
  return [
    `RECURRING COST — DP-1 (plan-time opt-in)`,
    `  Entry:      ${s.entry_id} — ${s.label}`,
    `  Controls:   ${s.control_ids.join(', ') || '(none)'}`,
    `  Estimate:   about ${s.estimate} a month (${s.estimate_basis}; price date ${s.price_date})`,
    `  Standard alternative: ${s.standard_alternative.join(', ') || 'none'}`,
    ...(s.last_resort ? ['  Last resort: a no-other-means justification is required.'] : []),
    `  Off by default. Opting in keeps it in the next translated plan; DP-2 is still typed at run time.`,
  ].join('\n');
}

export interface Dp1Input {
  tenant: string;
  entryId: string;
  /** Must equal the entry id. */
  typed: string;
  operator: string;
  noOtherMeans?: string;
  ref?: CostGateReference;
  now?: Date;
}

/** DP-1 (shared by the CLI command and the GUI route): the typed entry id, then recordCostAck. */
export function giveDp1(input: Dp1Input): { ack: CostAck; evidencePath: string; summary: Dp1Summary } {
  if (!SLUG_RE.test(input.tenant)) throw new CostGateError(`DP-1 refused: tenant slug '${input.tenant}' is not valid`);
  const ref = input.ref ?? loadCostGateReference();
  const summary = dp1Summary(input.entryId, ref);
  if ('refused' in summary) throw new CostGateError(summary.refused);
  if (input.typed.trim() !== input.entryId) throw new CostGateError(`DP-1 refused: typed text does not match the entry id ${input.entryId}`);
  const { ack, evidencePath } = recordCostAck(
    tenantBaseDir(input.tenant),
    { entry_id: input.entryId, operator: input.operator, ...(input.noOtherMeans ? { no_other_means: input.noOtherMeans } : {}) },
    ref,
    input.now,
  );
  return { ack, evidencePath, summary };
}

/** `stamper cost-ack --tenant <slug> --entry <id> [--justification <text>]`. */
export function buildCostAckCommand(): Command {
  return new Command('cost-ack')
    .description('DP-1: opt in to one recurring-cost registry entry for a tenant (off by default; DP-2 is still typed at run time)')
    .requiredOption('--tenant <slug>', 'Tenant slug (cost-acks.json sits beside its variables.json)')
    .requiredOption('--entry <id>', 'Registry entry id')
    .option('--justification <text>', 'No-other-means justification, required for a last-resort entry')
    .action(async (options: { tenant: string; entry: string; justification?: string }) => {
      try {
        if (!process.stdin.isTTY) {
          console.error('DP-1 refused: cost-ack needs a terminal (the operator types the entry id).');
          process.exit(1);
        }
        const ref = loadCostGateReference();
        const summary = dp1Summary(options.entry, ref);
        if ('refused' in summary) {
          console.error(summary.refused);
          process.exit(1);
        }
        console.log(dp1SummaryText(summary));
        const answers = await inquirer.prompt([
          { type: 'input', name: 'operator', message: 'Your name/ID:' },
          { type: 'input', name: 'typed', message: `Type the entry id "${summary.entry_id}" to opt in (anything else refuses):` },
        ]);
        const noOtherMeans = options.justification;
        const { ack, evidencePath } = giveDp1({
          tenant: options.tenant,
          entryId: options.entry,
          typed: String(answers.typed ?? ''),
          operator: String(answers.operator ?? ''),
          ...(noOtherMeans ? { noOtherMeans } : {}),
          ref,
        });
        console.log(`DP-1 recorded for ${ack.entry_id}: about ${formatEstimate(ack.estimate_month_low, ack.estimate_month_high)} a month (price date ${ack.price_date}).`);
        console.log(`Evidence: ${evidencePath}`);
        console.log('Re-translate the plan to include it; DP-2 is typed at run time.');
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
