// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// CG-2 / CG-8 (COST-GATE-SPEC.md §3.3, §5): the cost-gate block on a registry entry or AO op, the
// price file (data/cost-estimates.reference.json), the generated item catalogue
// (data/cost-items.reference.json), the operator's DP-1 cost ack, and Muster's recurring-cost notice.
// Two classes only: free or recurring (founder ruling, 2026-10-31). Per-use billing is recurring (CQ-2).
import { z } from 'zod';

/** Why an item is free (closed list). `per_call_only` is gone: per-use billing is recurring (CQ-2). */
export const FreeReasonSchema = z.enum(['no_meter', 'free_source', 'in_licence', 'cost_reducing', 'read_only']);
export type FreeReason = z.infer<typeof FreeReasonSchema>;

export const LicenceDependencySchema = z.object({
  licence: z.string().min(1),
  /** A key in the price file (per user per month). */
  cost_key: z.string().min(1),
});
export type LicenceDependency = z.infer<typeof LicenceDependencySchema>;

export const CostGateBlockSchema = z.object({
  recurring: z.boolean(),
  /** Required when recurring: a key in cost-estimates.reference.json. */
  cost_key: z.string().min(1).nullable().optional(),
  estimate_basis: z.string().optional(),
  /** Recorded as data only: no two-person authorization anywhere for now (founder ruling CQ-4, 2026-10-31). */
  two_person: z.boolean().optional(),
  irreversible: z.boolean().optional(),
  /** DP-1 also needs a written no-other-means justification (§4.7). */
  last_resort: z.boolean().optional(),
  /** Entry or op ids that meet the same practice at no recurring cost, or ['none']. */
  standard_alternative: z.array(z.string().min(1)).optional(),
  /** Required when not recurring. */
  free_reason: FreeReasonSchema.nullable().optional(),
  /** A licence the op needs and does not buy: not a cost start; recorded licence_gated when missing (CQ-1). */
  licence_dependency: LicenceDependencySchema.nullable().optional(),
});
export type CostGateBlock = z.infer<typeof CostGateBlockSchema>;

export const PriceEntrySchema = z.object({
  label: z.string().min(1),
  unit: z.string().min(1),
  estimate_month_low: z.number().min(0),
  estimate_month_high: z.number().min(0),
  basis: z.string().min(1),
  commercial_list: z.boolean(),
});
export type PriceEntry = z.infer<typeof PriceEntrySchema>;

export const CostEstimatesSchema = z.object({
  schema_version: z.string(),
  description: z.string().optional(),
  currency: z.literal('USD'),
  region: z.string(),
  price_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string(),
  prices: z.record(PriceEntrySchema),
});
export type CostEstimates = z.infer<typeof CostEstimatesSchema>;

/** One catalogue row: a registry entry (Stamper) or op (AO) with its cost_gate block. */
export const CostItemSchema = z.object({
  item_id: z.string().min(1),
  kind: z.enum(['registry_entry', 'ao_op']),
  source: z.string().min(1),
  label: z.string().min(1),
  control_ids: z.array(z.string()),
  retired: z.boolean().optional(),
  cost_gate: CostGateBlockSchema,
});
export type CostItem = z.infer<typeof CostItemSchema>;

export const CostItemsCatalogueSchema = z.object({
  schema_version: z.string(),
  description: z.string().optional(),
  items: z.array(CostItemSchema),
});
export type CostItemsCatalogue = z.infer<typeof CostItemsCatalogueSchema>;

/** DP-1: the operator's plan-time opt-in for one recurring entry (cost-acks.json). */
export const CostAckSchema = z.object({
  entry_id: z.string().min(1),
  cost_key: z.string().min(1),
  estimate_month_low: z.number(),
  estimate_month_high: z.number(),
  price_date: z.string(),
  operator: z.string().min(1),
  acked_at: z.string(),
  /** SHA-256 of entry id + estimate shown + price date (same idea as AO's paramsHash). */
  ackHash: z.string().regex(/^[0-9a-f]{64}$/),
  no_other_means: z.string().min(1).optional(),
});
export type CostAck = z.infer<typeof CostAckSchema>;

export const CostAcksFileSchema = z.object({
  schema_version: z.literal('cost-acks/1.0.0'),
  acks: z.array(CostAckSchema),
});
export type CostAcksFile = z.infer<typeof CostAcksFileSchema>;

/** Muster's plan-time notice item (§5.1). */
export const RecurringCostNoticeItemSchema = z.object({
  item_id: z.string(),
  kind: z.enum(['registry_entry', 'ao_op', 'infra_resource']),
  label: z.string(),
  cost_key: z.string(),
  estimate_month_low: z.number(),
  estimate_month_high: z.number(),
  basis: z.string(),
  two_person: z.boolean(),
  last_resort: z.boolean(),
  standard_alternative: z.array(z.string()),
  why_in_plan: z.string(),
});
export type RecurringCostNoticeItem = z.infer<typeof RecurringCostNoticeItemSchema>;

export const LicenceDependencyNoticeSchema = z.object({
  item_id: z.string(),
  licence: z.string(),
  cost_key: z.string(),
  estimate_per_user_month: z.number(),
  note: z.string(),
});
export type LicenceDependencyNotice = z.infer<typeof LicenceDependencyNoticeSchema>;

/** CONTRACT CHANGE (additive, optional): Mission Plan `recurring_cost_notice`. */
export const RecurringCostNoticeSchema = z.object({
  price_date: z.string(),
  items: z.array(RecurringCostNoticeItemSchema),
  licence_dependencies: z.array(LicenceDependencyNoticeSchema),
  total_estimate_low: z.number(),
  total_estimate_high: z.number(),
  items_hash: z.string(),
  note: z.string(),
});
export type RecurringCostNotice = z.infer<typeof RecurringCostNoticeSchema>;
