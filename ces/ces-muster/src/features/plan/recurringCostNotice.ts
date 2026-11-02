// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * CG-8 (COST-GATE-SPEC.md §5; founder ruling FR-3, 2026-10-31): Muster's plan-time notice of
 * every recurring-cost item that is part of the plan, with its monthly estimate. Muster lists; it
 * does not decide: the operator's opt-in (DP-1) is taken in Stamper on the actual registry
 * entries. The notice is written into the Mission Plan (`recurring_cost_notice`), shown on the
 * Plan tab at compile and again above "Send to Stamper", and never blocks.
 *
 * Inputs: the Infrastructure Manifest's resources (their `registry_entry_ids`) and the Mission
 * Plan's directives (licence dependencies only), looked up in ces-shared's item catalogue and
 * priced from its price file. Muster never reads Stamper's or AO's registries.
 * The shapes mirror ces-shared types/cost-gate.types.ts (RecurringCostNotice).
 */
import costItemsData from 'ces-shared/data/cost-items';
import costEstimatesData from 'ces-shared/data/cost-estimates';
import { canonicalSha256 } from './artifactRefs';

export interface CostGateBlock {
  recurring: boolean;
  cost_key?: string | null;
  two_person?: boolean;
  last_resort?: boolean;
  standard_alternative?: string[];
  free_reason?: string | null;
  licence_dependency?: { licence: string; cost_key: string } | null;
}
export interface CostItem { item_id: string; kind: 'registry_entry' | 'ao_op'; source: string; label: string; control_ids: string[]; retired?: boolean; cost_gate: CostGateBlock }
export interface PriceEntry { label: string; unit: string; estimate_month_low: number; estimate_month_high: number; basis: string; commercial_list: boolean }
export interface CostReference { price_date: string; prices: Record<string, PriceEntry>; items: CostItem[] }

export interface RecurringCostNoticeItem {
  item_id: string;
  kind: 'registry_entry' | 'ao_op' | 'infra_resource';
  label: string;
  cost_key: string;
  estimate_month_low: number;
  estimate_month_high: number;
  basis: string;
  two_person: boolean;
  last_resort: boolean;
  standard_alternative: string[];
  why_in_plan: string;
}
export interface LicenceDependencyNotice { item_id: string; licence: string; cost_key: string; estimate_per_user_month: number; note: string }
export interface RecurringCostNotice {
  price_date: string;
  items: RecurringCostNoticeItem[];
  licence_dependencies: LicenceDependencyNotice[];
  total_estimate_low: number;
  total_estimate_high: number;
  items_hash: string;
  note: string;
}

export const COST_RECURRING_PREFIX = 'COST_RECURRING:';
export const NOTICE_NOTE = 'Muster lists these items; it does not turn them on. Each one is off until you opt in for it in Stamper (DP-1) and confirm it again when it runs (DP-2).';

export const DEFAULT_COST_REFERENCE: CostReference = {
  price_date: (costEstimatesData as { price_date: string }).price_date,
  prices: (costEstimatesData as { prices: Record<string, PriceEntry> }).prices,
  items: (costItemsData as { items: CostItem[] }).items,
};

/** "$4.56" or "$0-$27". */
export function formatEstimate(low: number, high: number): string {
  const f = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return low === high ? f(low) : `${f(low)}-${f(high)}`;
}

interface ManifestResource { resource_id?: string; resource_type?: string; registry_entry_ids?: string[] }

/** Every resource in the emitted manifest's sections (`infrastructure` or the generator's `infrastructure_manifest`). */
function manifestResources(infra: unknown): ManifestResource[] {
  const m = infra as { infrastructure?: Record<string, unknown>; infrastructure_manifest?: Record<string, unknown> } | null | undefined;
  const body = m?.infrastructure ?? m?.infrastructure_manifest;
  if (!body) return [];
  const out: ManifestResource[] = [];
  for (const value of Object.values(body)) {
    if (!Array.isArray(value)) continue;
    for (const r of value) if (r && typeof r === 'object' && Array.isArray((r as ManifestResource).registry_entry_ids)) out.push(r as ManifestResource);
  }
  return out;
}

function directiveControls(missionPlan: unknown): Set<string> {
  const d = (missionPlan as { outputs?: { human_readable_mission_plan?: { control_directives?: Array<{ control_id: string; directive: string }> } } })
    ?.outputs?.human_readable_mission_plan?.control_directives ?? [];
  return new Set(d.filter(x => x.directive !== 'skip').map(x => x.control_id));
}

export async function buildRecurringCostNotice(
  artifacts: { infrastructureManifest: unknown; missionPlan: unknown },
  ref: CostReference = DEFAULT_COST_REFERENCE,
): Promise<RecurringCostNotice> {
  const byId = new Map(ref.items.map(i => [i.item_id, i]));
  const model = (artifacts.infrastructureManifest as { infrastructure?: { infrastructure_model?: string } } | null)?.infrastructure?.infrastructure_model;
  const items: RecurringCostNoticeItem[] = [];
  const seen = new Set<string>();
  for (const r of manifestResources(artifacts.infrastructureManifest)) {
    for (const id of r.registry_entry_ids ?? []) {
      const item = byId.get(id);
      const g = item?.cost_gate;
      if (!item || !g?.recurring || seen.has(id)) continue;
      const price = g.cost_key ? ref.prices[g.cost_key] : undefined;
      if (!g.cost_key || !price) continue;
      seen.add(id);
      items.push({
        item_id: id,
        kind: 'registry_entry',
        label: item.label,
        cost_key: g.cost_key,
        estimate_month_low: price.estimate_month_low,
        estimate_month_high: price.estimate_month_high,
        basis: price.basis,
        two_person: g.two_person === true,
        last_resort: g.last_resort === true,
        standard_alternative: g.standard_alternative ?? [],
        why_in_plan: `Infrastructure Manifest resource ${r.resource_id ?? r.resource_type ?? 'unknown'}${model ? ` (infrastructure model ${model})` : ''}`,
      });
    }
  }
  const controls = directiveControls(artifacts.missionPlan);
  const licence_dependencies: LicenceDependencyNotice[] = [];
  for (const item of ref.items) {
    const dep = item.cost_gate.licence_dependency;
    if (!dep || !item.control_ids.some(c => controls.has(c))) continue;
    const price = ref.prices[dep.cost_key];
    licence_dependencies.push({
      item_id: item.item_id,
      licence: dep.licence,
      cost_key: dep.cost_key,
      estimate_per_user_month: price?.estimate_month_high ?? 0,
      note: 'Licence needed, not bought by CES. Recorded as licence_gated when the licence is missing.',
    });
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    price_date: ref.price_date,
    items,
    licence_dependencies,
    total_estimate_low: round(items.reduce((s, i) => s + i.estimate_month_low, 0)),
    total_estimate_high: round(items.reduce((s, i) => s + i.estimate_month_high, 0)),
    items_hash: await canonicalSha256(items),
    note: NOTICE_NOTE,
  };
}

/** One warning line per item, for the mission-plan and infra-manifest docs. */
export function noticeWarnings(notice: RecurringCostNotice): string[] {
  return notice.items.map(i => `${COST_RECURRING_PREFIX} ${i.item_id} ${i.label} ~${formatEstimate(i.estimate_month_low, i.estimate_month_high)}/month (price date ${notice.price_date}); needs your opt-in in Stamper`);
}

/** The summary line (push response, run summary). */
export function noticeSummary(notice: RecurringCostNotice): string {
  return `${COST_RECURRING_PREFIX} ${notice.items.length} items, ~${formatEstimate(notice.total_estimate_low, notice.total_estimate_high)}/month`;
}
