// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// CG-5 (COST-GATE-SPEC §3.4-§3.5, §3.9): the AO side of the cost gate.
// Any op that starts a recurring cost (any amount, per-use billing included) is off by default.
// A LIVE run needs the operator's double positive:
//   DP-1 `costAck` on the request: the op id, the monthly estimate shown, the price date, and
//        `ackHash` = SHA-256 of op id + estimate + price date (a price-file change voids it);
//        a `last_resort` op also needs a written `noOtherMeans`.
//   DP-2 `confirmCost` typed at execution: exactly "<op id> <monthly figure>", e.g. "F-12 912.50".
// Dry runs start no cost: they carry the cost notice (estimate shown) and need neither.
// A licence dependency (A-21) is not a cost start: it is recorded, never gated.

import * as path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { AoCommand, AoCostGate } from '../types/AoCommand.js';
import type { CostGateEvidence } from '../types/StamperTypes.js';
import { resolveSource } from './SourceBindings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same sibling-root rule as RegistryBridge's CMMC reference: ces-ao/src/execution -> ces/ces-shared/src/data.
// The price file is owned by the shared cost-gate slice (CG-2); AO only reads it.
export const COST_ESTIMATES_PATH = path.resolve(
  __dirname, '..', '..', '..', 'ces-shared', 'src', 'data', 'cost-estimates.reference.json',
);

/** Test / operator override for the price file location. */
export const COST_ESTIMATES_PATH_ENV = 'CES_COST_ESTIMATES_PATH';

/** DP-1 as sent on the request (web body `costAck`, CLI `--cost-ack`, MCP `costAck`). */
export interface CostAck {
  opId: string;
  monthlyUsd?: number;
  priceDate?: string;
  ackHash: string;
  operator?: string;
  at?: string;
  /** Required for a `last_resort` op (COST-GATE-SPEC §4.7). */
  noOtherMeans?: string;
}

export interface CostEstimate {
  /** The figure the gate shows, hashes and asks to be typed: the price file's `estimate_month_high` (FIN-13). */
  monthlyUsd: number;
  priceDate: string;
  /** The price file's `estimate_month_low`, when the row has one (shown beside the high figure). */
  monthlyUsdLow?: number;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

// FIN-13 (B-5): the shared price file (CG-2) gives each key as `estimate_month_low` /
// `estimate_month_high`. The gate uses the HIGH figure (the operator acknowledges and types the
// worst case). The older single-figure fields stay accepted for hand-made price files.
function pickEstimate(row: any, fileDate: unknown): CostEstimate | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const high = num(row.estimate_month_high);
  const monthly = high ?? num(row.monthly_usd ?? row.monthlyUsd ?? row.usd_per_month ?? row.monthly);
  const date = row.price_date ?? row.priceDate ?? fileDate;
  if (monthly === undefined || monthly < 0 || typeof date !== 'string' || !date.trim()) return undefined;
  const low = high !== undefined ? num(row.estimate_month_low) : undefined;
  return { monthlyUsd: monthly, priceDate: date, ...(low !== undefined ? { monthlyUsdLow: low } : {}) };
}

/**
 * The monthly estimate for `costKey` from the shared price file, or undefined (file missing,
 * key missing, or no usable figure/date). Undefined is fail-closed: a live run is refused.
 */
export function loadCostEstimate(costKey: string, filePath?: string): CostEstimate | undefined {
  const p = filePath ?? process.env[COST_ESTIMATES_PATH_ENV] ?? COST_ESTIMATES_PATH;
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return undefined;
  }
  const fileDate = parsed?.price_date ?? parsed?.priceDate;
  const coll = parsed?.estimates ?? parsed?.items ?? parsed?.prices ?? parsed;
  if (Array.isArray(coll)) {
    return pickEstimate(coll.find((r: any) => r?.cost_key === costKey || r?.key === costKey), fileDate);
  }
  return pickEstimate(coll?.[costKey], fileDate);
}

export function computeAckHash(opId: string, monthlyUsd: number, priceDate: string): string {
  return createHash('sha256').update(`${opId}|${monthlyUsd.toFixed(2)}|${priceDate}`).digest('hex');
}

/** The DP-2 text the operator must type. */
export function expectedConfirmCost(opId: string, monthlyUsd: number): string {
  return `${opId} ${monthlyUsd.toFixed(2)}`;
}

function normTyped(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/ \$/, ' ');
}

/** Is this op a recurring-cost start for these inputs? Unknown condition values count as recurring. */
export function isRecurringFor(aoCommand: AoCommand, inputs: Record<string, any>, tenantConfig: unknown): boolean {
  const cg = aoCommand.cost_gate;
  if (!cg?.recurring) return false;
  const cond = cg.recurring_when;
  if (!cond) return true;
  let raw: unknown = inputs?.[cond.param];
  const param = aoCommand.parameters.find((p) => p.name === cond.param);
  if (param?.source) {
    const resolved = resolveSource(tenantConfig, param.source);
    if (resolved.value !== undefined) raw = resolved.value;
  }
  const v = num(raw);
  return v === undefined ? true : v > cond.gt;
}

export type CostGateDecision =
  | { applies: false }
  | { applies: true; allowed: boolean; reason?: string; evidence: CostGateEvidence };

function baseRecord(aoCommand: AoCommand, cg: AoCostGate, est?: CostEstimate): CostGateEvidence {
  return {
    gate: 'cost',
    classification: 'recurring',
    opId: aoCommand.id,
    costKey: cg.cost_key,
    monthlyUsd: est?.monthlyUsd ?? null,
    priceDate: est?.priceDate ?? null,
    ackHash: est ? computeAckHash(aoCommand.id, est.monthlyUsd, est.priceDate) : null,
    twoPerson: cg.two_person,
    lastResort: cg.last_resort,
    outcome: 'notice',
  };
}

/**
 * Evaluate the cost gate for one AO execution. `applies: false` = the op touches no cost meter
 * (nothing is recorded). A licence-dependency op is always allowed and recorded.
 */
export function evaluateCostGate(input: {
  aoCommand: AoCommand;
  inputs: Record<string, any>;
  tenantConfig: unknown;
  dryRun: boolean;
  costAck?: CostAck;
  confirmCost?: string;
  requestorUPN?: string;
  priceFilePath?: string;
  now?: () => Date;
}): CostGateDecision {
  const { aoCommand } = input;
  const cg = aoCommand.cost_gate;
  if (!cg) return { applies: false };

  if (!cg.recurring && cg.licence_dependency) {
    return {
      applies: true,
      allowed: true,
      evidence: {
        gate: 'cost',
        classification: 'licence_dependency',
        opId: aoCommand.id,
        licence: cg.licence_dependency,
        outcome: 'licence_dependency',
      },
    };
  }
  if (!isRecurringFor(aoCommand, input.inputs, input.tenantConfig)) return { applies: false };

  const est = cg.cost_key ? loadCostEstimate(cg.cost_key, input.priceFilePath) : undefined;
  const rec = baseRecord(aoCommand, cg, est);
  const refuse = (reason: string, extra: Partial<CostGateEvidence> = {}): CostGateDecision => ({
    applies: true,
    allowed: false,
    reason: `Cost gate refused live run of ${aoCommand.id}: ${reason}`,
    evidence: { ...rec, ...extra, outcome: 'refused', reason },
  });
  const at = () => (input.now ?? (() => new Date()))().toISOString();

  // A dry run starts no cost: it shows the notice (the estimate) and needs no DP.
  if (input.dryRun) return { applies: true, allowed: true, evidence: rec };

  if (!est) {
    return refuse(
      `cost_estimate_unavailable: no monthly estimate for cost key "${cg.cost_key ?? '(none)'}" in the price file, ` +
        `so the cost cannot be shown (fail-closed)`,
    );
  }
  const ack = input.costAck;
  if (!ack || typeof ack !== 'object' || typeof ack.ackHash !== 'string') {
    return refuse(
      `dp1_missing: a recurring cost (about $${est.monthlyUsd.toFixed(2)} a month, price date ${est.priceDate}) needs ` +
        `costAck (DP-1) on the request with ackHash ${rec.ackHash}`,
    );
  }
  if (ack.opId !== aoCommand.id) return refuse(`dp1_wrong_op: costAck is for ${ack.opId}, not ${aoCommand.id}`);
  if (ack.ackHash !== rec.ackHash) {
    return refuse(`dp1_stale: costAck ackHash does not match the current estimate ($${est.monthlyUsd.toFixed(2)} a month, price date ${est.priceDate}); acknowledge again`);
  }
  const noOtherMeans = typeof ack.noOtherMeans === 'string' ? ack.noOtherMeans.trim() : '';
  if (cg.last_resort && !noOtherMeans) {
    return refuse('no_other_means_missing: a last-resort op needs a written noOtherMeans justification in costAck');
  }
  const dp1 = {
    operator: ack.operator ?? input.requestorUPN,
    at: ack.at,
    ackHash: ack.ackHash,
    ...(noOtherMeans ? { noOtherMeans } : {}),
  };
  const expected = expectedConfirmCost(aoCommand.id, est.monthlyUsd);
  const typed = typeof input.confirmCost === 'string' ? input.confirmCost : '';
  if (!typed.trim()) {
    return refuse(`dp2_missing: type confirmCost "${expected}" (DP-2) to start this recurring cost`, { dp1 });
  }
  if (normTyped(typed) !== expected) {
    return refuse(`dp2_mismatch: confirmCost must be exactly "${expected}"`, { dp1, dp2: { typed, at: at() } });
  }
  return { applies: true, allowed: true, evidence: { ...rec, dp1, dp2: { typed, at: at() }, outcome: 'enabled' } };
}

/** A licence-dependency failure that looks like a missing licence (recorded as licence_gated, DD-h). */
export function looksLicenceMissing(text: string | undefined): boolean {
  return /licen[cs]e|not licensed|Governance|AadPremium|premium license|requires .*P2/i.test(String(text ?? ''));
}

// ---------- Catalogue rows (cost-items.reference.json, kind 'ao_op') ----------
// FIN-13 (COST-GATE-SPEC §3.3, §3.8 item 6): Muster reads ces-shared's item catalogue, never AO's
// registry, so every AO op with a cost decision gets an `ao_op` row there, translated to the shared
// CostGateBlock shape (ces-shared/src/types/cost-gate.types.ts). The rows are generated from the
// registry and test/registry/CostGateLint.test.ts fails on drift (UPDATE_COST_ITEMS=1 rewrites them).

export const AO_COST_ITEM_SOURCE = 'ces-ao:ao-commands.registry.json';

/** One `ao_op` row of the shared catalogue (the shared CostItem shape). */
export interface AoCostItem {
  item_id: string;
  kind: 'ao_op';
  source: string;
  label: string;
  control_ids: string[];
  cost_gate: Record<string, unknown>;
}

/** The op's cost_gate block in the shared shape: nulls dropped, AO's `recurring_when` kept (AO-only). */
export function toSharedCostGateBlock(cg: AoCostGate): Record<string, unknown> {
  const b: Record<string, unknown> = { recurring: cg.recurring };
  if (cg.cost_key) b.cost_key = cg.cost_key;
  if (cg.estimate_basis) b.estimate_basis = cg.estimate_basis;
  b.two_person = cg.two_person === true;
  b.irreversible = cg.irreversible === true;
  b.last_resort = cg.last_resort === true;
  if (Array.isArray(cg.standard_alternative)) b.standard_alternative = [...cg.standard_alternative];
  else if (typeof cg.standard_alternative === 'string') b.standard_alternative = [cg.standard_alternative];
  if (cg.free_reason) b.free_reason = cg.free_reason;
  const dep = cg.licence_dependency as { licence?: string; cost_key?: string } | null;
  if (dep?.licence && dep.cost_key) b.licence_dependency = { licence: dep.licence, cost_key: dep.cost_key };
  if (cg.recurring_when) b.recurring_when = { param: cg.recurring_when.param, gt: cg.recurring_when.gt };
  return b;
}

/**
 * The `ao_op` catalogue rows, in registry order: every op with a cost_gate block EXCEPT a pure
 * licence dependency (A-21). A licence dependency is not a cost start (spec §3.1), and the
 * Stamper check PS.L2-3.9.2.leaver-workflow already carries the same Entra ID Governance
 * dependency for the same control; a second row would list the licence twice in Muster's notice
 * (FIN-13 log, open item).
 */
export function buildAoCostItems(registry: AoCommand[]): AoCostItem[] {
  const items: AoCostItem[] = [];
  for (const c of registry) {
    const cg = c.cost_gate;
    if (!cg) continue;
    if (!cg.recurring && cg.licence_dependency) continue;
    items.push({
      item_id: c.id,
      kind: 'ao_op',
      source: AO_COST_ITEM_SOURCE,
      label: c.title,
      control_ids: [...(c.cmmcPractices ?? [])],
      cost_gate: toSharedCostGateBlock(cg),
    });
  }
  return items;
}
