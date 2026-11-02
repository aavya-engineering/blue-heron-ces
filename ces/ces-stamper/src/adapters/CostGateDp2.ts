// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GATE-RUN: DP-2, the run-time typed confirmation of the cost gate (COST-GATE-SPEC.md §3.5),
 * as PowerShellAdapter applies it directly after the FX-01 destructive gate, before a recurring
 * SET is sent.
 *
 * The operator types `<entry id> <monthly cost>` exactly as shown (for example
 * `SC.L2-3.13.10.key-vault $4.56`). The DP-1 / mode / terminal / harness refusals are CostGate's
 * `evaluateDp2`; this file adds the combined typed form, the prompt that shows the estimate, and
 * the evidence write. Fail-closed: with no runtime set for the run, DP-2 is refused (treated as
 * `--mode auto` with no terminal), so a recurring SET never runs on DP-1 alone.
 */
import inquirer from 'inquirer';
import {
  evaluateDp2,
  buildCostGateEvidence,
  currentAckFor,
  formatEstimate,
  writeCostGateEvidence,
  COST_GATED_OFF,
  type CostAck,
  type CostGateReference,
  type CostGateEvidenceRecord,
} from '../core/CostGate.js';

/** What the operator is shown at DP-2. */
export interface Dp2Prompt {
  entryId: string;
  label: string;
  controlIds: string[];
  costKey: string | null;
  /** The monthly figure shown, as formatEstimate gives it ("$4.56" or "$0-$27"). */
  estimate: string;
  estimateBasis: string;
  priceDate: string;
  standardAlternative: string[];
  /** The exact text the operator must type: `<entry id> <monthly cost>`. */
  expected: string;
}

export interface Dp2Answer {
  typed: string;
  operator?: string;
}

/** How a run gives DP-2: its mode, whether a person is at a terminal, and the prompt to use. */
export interface CostGateRuntime {
  mode: 'manual' | 'auto';
  /** Default: whether stdin is a terminal (as ManualGateAdapter decides headless). */
  interactive?: boolean;
  /** A harness run never gives DP-2. */
  harness?: boolean;
  operator?: string;
  promptDp2?: (prompt: Dp2Prompt) => Promise<Dp2Answer | undefined>;
}

let processRuntime: CostGateRuntime | undefined;

/** The process-wide runtime (set once by the CLI execute command); an adapter's own runtime wins. */
export function setProcessCostGateRuntime(runtime: CostGateRuntime | undefined): void {
  processRuntime = runtime;
}

export function getProcessCostGateRuntime(): CostGateRuntime | undefined {
  return processRuntime;
}

/** `<entry id> <monthly cost>`. */
export function expectedDp2Text(entryId: string, estimate: string): string {
  return `${entryId} ${estimate}`;
}

export function buildDp2Prompt(entryId: string, ref: CostGateReference): Dp2Prompt | undefined {
  const item = ref.byId.get(entryId);
  const key = item?.cost_gate.cost_key ?? undefined;
  const price = key ? ref.estimates.prices[key] : undefined;
  if (!item || !price) return undefined;
  const estimate = formatEstimate(price.estimate_month_low, price.estimate_month_high);
  return {
    entryId,
    label: item.label,
    controlIds: [...item.control_ids],
    costKey: key ?? null,
    estimate,
    estimateBasis: item.cost_gate.estimate_basis ?? price.basis,
    priceDate: ref.estimates.price_date,
    standardAlternative: item.cost_gate.standard_alternative ?? [],
    expected: expectedDp2Text(entryId, estimate),
  };
}

/** The prompt text: the entry, its estimate a month, the basis, the price date, the free alternative. */
export function dp2PromptText(p: Dp2Prompt): string {
  return [
    `RECURRING COST — DP-2 (run-time confirmation)`,
    `  Entry:      ${p.entryId} — ${p.label}`,
    `  Controls:   ${p.controlIds.join(', ') || '(none)'}`,
    `  Estimate:   about ${p.estimate} a month (${p.estimateBasis}; price date ${p.priceDate})`,
    `  Standard alternative: ${p.standardAlternative.join(', ') || 'none'}`,
    `  To start this cost, type exactly: ${p.expected}`,
  ].join('\n');
}

/** The CLI prompt (inquirer, as the TUI's manual-mode prompts). */
export async function terminalDp2Prompt(p: Dp2Prompt): Promise<Dp2Answer | undefined> {
  console.log('');
  console.log(dp2PromptText(p));
  const answers = await inquirer.prompt([
    { type: 'input', name: 'operator', message: 'Your name/ID:' },
    { type: 'input', name: 'typed', message: `Type "${p.expected}" to confirm (anything else refuses):` },
  ]);
  return { typed: String(answers.typed ?? ''), operator: String(answers.operator ?? '') };
}

export interface Dp2Outcome {
  allowed: boolean;
  reason?: string;
  prompt?: Dp2Prompt;
  evidence: CostGateEvidenceRecord;
  evidencePath?: string;
  estimate_month_low: number | null;
  estimate_month_high: number | null;
}

function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * DP-2 for one recurring sub-command. CostGate's evaluateDp2 decides the DP-1, harness, mode and
 * terminal refusals; then the operator is prompted and must type `<entry id> <monthly cost>`.
 * Every outcome writes a cost-gate evidence record (`metadata.gate: 'cost'`, `dp: 2`) under
 * `<tenantDir>/cost-gate-evidence/` when a tenant folder is given.
 */
export async function runDp2(input: {
  entryId: string;
  ref: CostGateReference;
  acks: CostAck[];
  runtime?: CostGateRuntime;
  tenantDir?: string;
  now?: Date;
}): Promise<Dp2Outcome> {
  const runtime: CostGateRuntime = input.runtime ?? { mode: 'auto', interactive: false };
  const interactive = runtime.interactive ?? Boolean(process.stdin.isTTY);
  const now = input.now ?? new Date();
  const item = input.ref.byId.get(input.entryId);
  const key = item?.cost_gate.cost_key ?? undefined;
  const price = key ? input.ref.estimates.prices[key] : undefined;
  const ack = currentAckFor(input.entryId, input.acks, input.ref);
  const prompt = buildDp2Prompt(input.entryId, input.ref);
  let operator = runtime.operator ?? 'unknown-operator';

  // The non-typing refusals (no / stale DP-1, harness, auto mode, no terminal, no price): the
  // typed check is satisfied here on purpose so evaluateDp2 reports only those.
  const pre = evaluateDp2({
    entry_id: input.entryId, typed: input.entryId, acks: input.acks, ref: input.ref,
    mode: runtime.mode, interactive, harness: runtime.harness === true, operator, now,
  });

  let typed = '';
  // No runtime for this run (e.g. a GUI run before its DP-2 dialog is wired): say so, not "--mode manual".
  let reason = pre.reason && !input.runtime && ack
    ? `${COST_GATED_OFF}: no DP-2 confirmation channel for this run`
    : pre.reason;
  if (!reason) {
    const ask = runtime.promptDp2 ?? terminalDp2Prompt;
    let answer: Dp2Answer | undefined;
    try {
      answer = await ask(prompt!);
    } catch {
      answer = undefined;
    }
    typed = answer?.typed ?? '';
    if (answer?.operator && answer.operator.trim()) operator = answer.operator.trim();
    if (normalise(typed) !== prompt!.expected) {
      reason = `${COST_GATED_OFF}: typed text does not match "${prompt!.expected}"`;
    }
  }

  const evidence = buildCostGateEvidence({
    dp: 2,
    outcome: reason ? 'refused' : 'accepted',
    item,
    price,
    priceDate: input.ref.estimates.price_date,
    ...(ack ? { ackHash: ack.ackHash } : {}),
    operator,
    at: now,
    typed,
    entryId: input.entryId,
    ...(reason ? { reason } : {}),
    ...(ack?.no_other_means ? { noOtherMeans: ack.no_other_means } : {}),
  });
  const evidencePath = input.tenantDir ? writeCostGateEvidence(input.tenantDir, evidence) : undefined;
  return {
    allowed: !reason,
    ...(reason ? { reason } : {}),
    ...(prompt ? { prompt } : {}),
    evidence,
    ...(evidencePath ? { evidencePath } : {}),
    estimate_month_low: price?.estimate_month_low ?? null,
    estimate_month_high: price?.estimate_month_high ?? null,
  };
}
