// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Cost gate, Stamper side (COST-GATE-SPEC.md §3; founder rulings 2026-10-31).
 *
 * Two classes only: free or recurring. Any SET that starts a recurring cost (per-use billing
 * included, CQ-2) is off by default and needs the operator's double positive:
 *  - DP-1, the plan-time opt-in, recorded in the tenant's cost-acks.json beside variables.json;
 *  - DP-2, typed at run time (evaluateDp2), refused without a current DP-1, in auto mode, without
 *    a terminal, or in a harness run.
 * Both write a cost-gate evidence record. Translation drops an un-acked recurring entry from the
 * executable plan and records it as `cost_gated_off` (applyCostGate). Fail-closed: an entry with no
 * catalogue record whose SET matches the costly-cmdlet list counts as recurring.
 *
 * The cost data are ces-shared's price file (cost-estimates.reference.json) and the item catalogue
 * (cost-items.reference.json, built from the registries' cost_gate blocks by buildStamperCostItems).
 * No two-person step anywhere (founder ruling CQ-4): `two_person` is carried as data only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { resolveSharedDataPath } from './sharedData.js';

export const COST_ESTIMATES_FILE = 'cost-estimates.reference.json';
export const COST_ITEMS_FILE = 'cost-items.reference.json';
export const COST_ACKS_FILE = 'cost-acks.json';
export const COST_GATE_EVIDENCE_DIR = 'cost-gate-evidence';
export const COST_GATED_OFF = 'cost_gated_off';
/** Warning prefix for an entry translation left out for want of DP-1. */
export const COST_GATED_OFF_PREFIX = 'COST_GATED_OFF:';

export type FreeReason = 'no_meter' | 'free_source' | 'in_licence' | 'cost_reducing' | 'read_only';
export const FREE_REASONS: readonly FreeReason[] = ['no_meter', 'free_source', 'in_licence', 'cost_reducing', 'read_only'];

/** Mirrors ces-shared types/cost-gate.types.ts CostGateBlock. */
export interface CostGateBlock {
  recurring: boolean;
  cost_key?: string | null;
  estimate_basis?: string;
  two_person?: boolean;
  irreversible?: boolean;
  last_resort?: boolean;
  standard_alternative?: string[];
  free_reason?: FreeReason | null;
  licence_dependency?: { licence: string; cost_key: string } | null;
}

export interface PriceEntry {
  label: string;
  unit: string;
  estimate_month_low: number;
  estimate_month_high: number;
  basis: string;
  commercial_list: boolean;
}

export interface CostEstimates {
  schema_version: string;
  currency: 'USD';
  region: string;
  price_date: string;
  source: string;
  prices: Record<string, PriceEntry>;
}

export interface CostItem {
  item_id: string;
  kind: 'registry_entry' | 'ao_op';
  source: string;
  label: string;
  control_ids: string[];
  retired?: boolean;
  cost_gate: CostGateBlock;
}

export interface CostItemsCatalogue {
  schema_version: string;
  description?: string;
  items: CostItem[];
}

export interface CostAck {
  entry_id: string;
  cost_key: string;
  estimate_month_low: number;
  estimate_month_high: number;
  price_date: string;
  operator: string;
  acked_at: string;
  ackHash: string;
  no_other_means?: string;
}

export interface CostAcksFile {
  schema_version: 'cost-acks/1.0.0';
  acks: CostAck[];
}

export interface CostGateReference {
  estimates: CostEstimates;
  catalogue: CostItemsCatalogue;
  byId: Map<string, CostItem>;
}

/**
 * The costly-cmdlet list (COST-GATE-SPEC §3.8 item 1). `New-AzKeyVault` and `Add-AzKeyVaultKey`
 * are added: a vault or key is billed per use, and per-use billing is recurring (CQ-2).
 */
export const COSTLY_SET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'New-AzFirewall', re: /New-AzFirewall\b/ },
  { name: '.Allocate(', re: /\.Allocate\(/ },
  { name: 'New-AzBastion', re: /New-AzBastion\b/ },
  { name: 'New-AzVM', re: /New-AzVM\b/ },
  { name: 'New-AzNatGateway', re: /New-AzNatGateway\b/ },
  { name: 'New-AzPublicIpAddress', re: /New-AzPublicIpAddress\b/ },
  { name: 'New-AzPrivateEndpoint', re: /New-AzPrivateEndpoint\b/ },
  { name: 'New-AzPrivateDnsZone', re: /New-AzPrivateDnsZone\b/ },
  { name: "Set-AzSecurityPricing 'Standard'", re: /Set-AzSecurityPricing[^;|]*'Standard'/ },
  { name: '-Destination HSM', re: /-Destination\s+'?HSM/ },
  { name: "-Sku 'Premium'", re: /-Sku\s+'Premium'/ },
  { name: 'New-AzKeyVault', re: /New-AzKeyVault\b/ },
  { name: 'Add-AzKeyVaultKey', re: /Add-AzKeyVaultKey\b/ },
  { name: 'New-AzStorageAccount', re: /New-AzStorageAccount\b/ },
  { name: 'New-AzOperationalInsightsWorkspace', re: /New-AzOperationalInsightsWorkspace\b/ },
  { name: 'onboardingStates / Ueba', re: /onboardingStates|Ueba/ },
  { name: '-EnableTrafficAnalytics', re: /-EnableTrafficAnalytics/ },
  { name: 'New-/Set-AzNetworkWatcherFlowLog', re: /(New|Set)-AzNetworkWatcherFlowLog/ },
  { name: 'Set-/New-AzDiagnosticSetting', re: /(Set|New)-AzDiagnosticSetting/ },
  { name: 'RetentionInDays > 90', re: /RetentionInDays\s+(9[1-9]|[1-9]\d{2,})\b/ },
  { name: '--retention-time', re: /--retention-time/ },
  { name: 'ImmutabilityPolicy', re: /ImmutabilityPolicy/ },
  { name: 'New-AzResourceLock', re: /New-AzResourceLock\b/ },
  { name: 'New-AzAutomationAccount', re: /New-AzAutomationAccount\b/ },
  { name: 'New-AzActionGroup', re: /New-AzActionGroup\b/ },
  { name: 'az keyvault key rotate', re: /az keyvault key rotate/ },
  { name: 'MicrosoftMonitoringAgent', re: /MicrosoftMonitoringAgent/ },
  { name: 'lifecycleWorkflows', re: /lifecycleWorkflows/ },
];

/** Names of the costly patterns a SET matches (empty = none). */
export function costlyPatternsIn(setCommand: string | undefined | null): string[] {
  const s = setCommand ?? '';
  return COSTLY_SET_PATTERNS.filter(p => p.re.test(s)).map(p => p.name);
}

/** ces-shared's data folder: the built copy (dist/data) when it holds the file, else the source (src/data). */
export function sharedCostDataPath(file: string): string {
  const builtDir = path.dirname(resolveSharedDataPath('sprs-weights.json'));
  const built = path.join(builtDir, file);
  if (fs.existsSync(built)) return built;
  return path.join(builtDir, '..', '..', 'src', 'data', file);
}

export function loadCostGateReference(paths?: { estimates?: string; catalogue?: string }): CostGateReference {
  const estimates = JSON.parse(fs.readFileSync(paths?.estimates ?? sharedCostDataPath(COST_ESTIMATES_FILE), 'utf-8')) as CostEstimates;
  const catalogue = JSON.parse(fs.readFileSync(paths?.catalogue ?? sharedCostDataPath(COST_ITEMS_FILE), 'utf-8')) as CostItemsCatalogue;
  return { estimates, catalogue, byId: new Map(catalogue.items.map(i => [i.item_id, i])) };
}

/** "$4.56" or "$0-$27" a month. */
export function formatEstimate(low: number, high: number): string {
  const f = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return low === high ? f(low) : `${f(low)}-${f(high)}`;
}

/** DP-1 hash: SHA-256 of entry id + the estimate shown + the price date (as AO's paramsHash). */
export function computeAckHash(entryId: string, low: number, high: number, priceDate: string): string {
  return createHash('sha256').update(`${entryId}\n${formatEstimate(low, high)}\n${priceDate}`, 'utf8').digest('hex');
}

export interface CostClassification {
  recurring: boolean;
  /** catalogue = the entry's cost_gate block; fail_closed = no record but a costly SET; no_set = nothing to start. */
  basis: 'catalogue' | 'fail_closed' | 'no_set' | 'free';
  item?: CostItem;
  price?: PriceEntry;
  costlyPatterns: string[];
}

/** Free or recurring, fail-closed. An entry with no SET can start nothing. */
export function classifyEntry(entry: { entry_id: string; set_command?: string | null }, ref: CostGateReference): CostClassification {
  const costlyPatterns = costlyPatternsIn(entry.set_command);
  if (!entry.set_command || entry.set_command.trim() === '') return { recurring: false, basis: 'no_set', costlyPatterns };
  const item = ref.byId.get(entry.entry_id);
  if (item) {
    const key = item.cost_gate.cost_key ?? undefined;
    const price = key ? ref.estimates.prices[key] : undefined;
    return { recurring: item.cost_gate.recurring, basis: 'catalogue', item, ...(price ? { price } : {}), costlyPatterns };
  }
  if (costlyPatterns.length > 0) return { recurring: true, basis: 'fail_closed', costlyPatterns };
  return { recurring: false, basis: 'free', costlyPatterns };
}

// ---------- DP-1: cost-acks.json ----------

export function costAcksPath(tenantDir: string): string {
  return path.join(tenantDir, COST_ACKS_FILE);
}

/** The tenant's DP-1 records; none when the file is absent. */
export function readCostAcks(tenantDir: string | undefined): CostAck[] {
  if (!tenantDir) return [];
  const file = costAcksPath(tenantDir);
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as CostAcksFile;
  return Array.isArray(data?.acks) ? data.acks : [];
}

/** True when the ack's hash still matches the current price file (a price change voids DP-1). */
export function isAckCurrent(ack: CostAck, ref: CostGateReference): boolean {
  const cls = ref.byId.get(ack.entry_id);
  const key = cls?.cost_gate.cost_key ?? undefined;
  const price = key ? ref.estimates.prices[key] : undefined;
  if (!price || key !== ack.cost_key) return false;
  return ack.ackHash === computeAckHash(ack.entry_id, price.estimate_month_low, price.estimate_month_high, ref.estimates.price_date);
}

export function currentAckFor(entryId: string, acks: CostAck[], ref: CostGateReference): CostAck | undefined {
  return acks.filter(a => a.entry_id === entryId).reverse().find(a => isAckCurrent(a, ref));
}

export class CostGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostGateError';
  }
}

/**
 * DP-1: record the operator's opt-in for one recurring entry in cost-acks.json and write its
 * evidence record. A last-resort entry needs a no-other-means justification.
 */
export function recordCostAck(
  tenantDir: string,
  input: { entry_id: string; operator: string; no_other_means?: string },
  ref: CostGateReference,
  now: Date = new Date(),
): { ack: CostAck; evidencePath: string } {
  const item = ref.byId.get(input.entry_id);
  if (!item) throw new CostGateError(`DP-1 refused: ${input.entry_id} has no cost record`);
  if (!item.cost_gate.recurring) throw new CostGateError(`DP-1 refused: ${input.entry_id} is free; nothing to opt in to`);
  const key = item.cost_gate.cost_key ?? undefined;
  const price = key ? ref.estimates.prices[key] : undefined;
  if (!key || !price) throw new CostGateError(`DP-1 refused: ${input.entry_id} has no price (cost_key ${key ?? 'none'})`);
  if (item.cost_gate.last_resort && !(input.no_other_means && input.no_other_means.trim())) {
    throw new CostGateError(`DP-1 refused: ${input.entry_id} is a last resort and needs a no-other-means justification`);
  }
  if (!input.operator.trim()) throw new CostGateError('DP-1 refused: no operator identity');
  const ack: CostAck = {
    entry_id: input.entry_id,
    cost_key: key,
    estimate_month_low: price.estimate_month_low,
    estimate_month_high: price.estimate_month_high,
    price_date: ref.estimates.price_date,
    operator: input.operator,
    acked_at: now.toISOString(),
    ackHash: computeAckHash(input.entry_id, price.estimate_month_low, price.estimate_month_high, ref.estimates.price_date),
    ...(input.no_other_means ? { no_other_means: input.no_other_means } : {}),
  };
  const file: CostAcksFile = { schema_version: 'cost-acks/1.0.0', acks: [...readCostAcks(tenantDir), ack] };
  writeJsonArtifact(costAcksPath(tenantDir), file);
  const evidence = buildCostGateEvidence({ dp: 1, outcome: 'accepted', item, price, priceDate: ref.estimates.price_date, ackHash: ack.ackHash, operator: ack.operator, at: now, ...(ack.no_other_means ? { noOtherMeans: ack.no_other_means } : {}) });
  return { ack, evidencePath: writeCostGateEvidence(tenantDir, evidence) };
}

// ---------- Translation: drop un-acked recurring entries ----------

export interface CostGateDecision {
  entry_id: string;
  control_ids: string[];
  state: 'off' | 'acked';
  /** 'cost_gated_off' when off. */
  reason?: typeof COST_GATED_OFF;
  cause?: 'no_dp1' | 'stale_dp1' | 'no_cost_record' | 'no_price';
  cost_key: string | null;
  estimate_month_low: number | null;
  estimate_month_high: number | null;
  price_date: string;
  standard_alternative: string[];
  last_resort: boolean;
  ackHash?: string;
}

/**
 * Keep free entries; keep a recurring entry only with a current DP-1; drop the rest and return a
 * `cost_gated_off` decision for each (so nothing is skipped silently).
 */
export function applyCostGate<T extends { entry_id: string; set_command?: string | null; control_ids: string[] }>(
  entries: T[],
  acks: CostAck[],
  ref: CostGateReference,
): { kept: T[]; decisions: CostGateDecision[] } {
  const kept: T[] = [];
  const decisions: CostGateDecision[] = [];
  for (const e of entries) {
    const cls = classifyEntry(e, ref);
    if (!cls.recurring) { kept.push(e); continue; }
    const gate = cls.item?.cost_gate;
    const base = {
      entry_id: e.entry_id,
      control_ids: [...e.control_ids],
      cost_key: gate?.cost_key ?? null,
      estimate_month_low: cls.price?.estimate_month_low ?? null,
      estimate_month_high: cls.price?.estimate_month_high ?? null,
      price_date: ref.estimates.price_date,
      standard_alternative: gate?.standard_alternative ?? [],
      last_resort: gate?.last_resort === true,
    };
    if (cls.basis === 'fail_closed') { decisions.push({ ...base, state: 'off', reason: COST_GATED_OFF, cause: 'no_cost_record' }); continue; }
    if (!cls.price) { decisions.push({ ...base, state: 'off', reason: COST_GATED_OFF, cause: 'no_price' }); continue; }
    const current = currentAckFor(e.entry_id, acks, ref);
    if (current) {
      kept.push(e);
      decisions.push({ ...base, state: 'acked', ackHash: current.ackHash });
      continue;
    }
    const stale = acks.some(a => a.entry_id === e.entry_id);
    decisions.push({ ...base, state: 'off', reason: COST_GATED_OFF, cause: stale ? 'stale_dp1' : 'no_dp1' });
  }
  return { kept, decisions };
}

/** One warning line per gated-off entry. */
export function costGatedOffWarning(d: CostGateDecision): string {
  const est = d.estimate_month_low !== null && d.estimate_month_high !== null ? `~${formatEstimate(d.estimate_month_low, d.estimate_month_high)}/month` : 'estimate unknown';
  const alt = d.standard_alternative.length > 0 ? `; standard alternative: ${d.standard_alternative.join(', ')}` : '';
  return `${COST_GATED_OFF_PREFIX} ${d.entry_id} (${d.control_ids.join(', ')}) left out: recurring cost ${est} (price date ${d.price_date}), ${d.cause === 'stale_dp1' ? 'DP-1 is stale (the price file changed)' : d.cause === 'no_cost_record' ? 'no cost record and a costly SET (fail-closed)' : d.cause === 'no_price' ? 'no price for its cost_key' : 'no DP-1 opt-in'}${alt}`;
}

// ---------- DP-2: the typed confirmation at run time ----------

export interface Dp2Input {
  entry_id: string;
  /** What the operator typed: the entry id or the monthly figure shown (formatEstimate). */
  typed?: string;
  acks: CostAck[];
  ref: CostGateReference;
  mode: 'manual' | 'auto';
  interactive: boolean;
  harness?: boolean;
  operator: string;
  now?: Date;
}

export interface Dp2Result {
  allowed: boolean;
  reason?: string;
  evidence: CostGateEvidenceRecord;
}

/**
 * DP-2 (wired at the PowerShellAdapter FX-01 site, after the destructive gate and before the SET is
 * sent). Refused without a current DP-1, in auto mode, without a terminal, in a harness run, or when
 * the typed text is neither the entry id nor the monthly figure shown. Sim tenants get no exception.
 */
export function evaluateDp2(input: Dp2Input): Dp2Result {
  const item = input.ref.byId.get(input.entry_id);
  const key = item?.cost_gate.cost_key ?? undefined;
  const price = key ? input.ref.estimates.prices[key] : undefined;
  const ack = currentAckFor(input.entry_id, input.acks, input.ref);
  const shown = price ? formatEstimate(price.estimate_month_low, price.estimate_month_high) : undefined;
  let reason: string | undefined;
  if (!item || !price) reason = `${COST_GATED_OFF}: no cost record or price for ${input.entry_id}`;
  else if (!ack) reason = `${COST_GATED_OFF}: ${input.acks.some(a => a.entry_id === input.entry_id) ? 'DP-1 is stale' : 'no DP-1'}`;
  else if (input.harness) reason = `${COST_GATED_OFF}: DP-2 is never given in a harness run`;
  else if (input.mode === 'auto') reason = `${COST_GATED_OFF}: DP-2 needs --mode manual`;
  else if (!input.interactive) reason = `${COST_GATED_OFF}: DP-2 needs a terminal`;
  else {
    const typed = (input.typed ?? '').trim();
    if (typed !== input.entry_id && typed !== shown) reason = `${COST_GATED_OFF}: typed text does not match the entry id or ${shown}`;
  }
  const evidence = buildCostGateEvidence({
    dp: 2,
    outcome: reason ? 'refused' : 'accepted',
    item,
    price,
    priceDate: input.ref.estimates.price_date,
    ...(ack ? { ackHash: ack.ackHash } : {}),
    operator: input.operator,
    at: input.now ?? new Date(),
    typed: input.typed ?? '',
    entryId: input.entry_id,
    ...(reason ? { reason } : {}),
    ...(ack?.no_other_means ? { noOtherMeans: ack.no_other_means } : {}),
  });
  return { allowed: !reason, ...(reason ? { reason } : {}), evidence };
}

// ---------- Evidence ----------

/** A DP-1 or DP-2 record (COST-GATE-SPEC §3.9). Kept out of the control-evidence folder: it never scores. */
export interface CostGateEvidenceRecord {
  rawResponse: string;
  outcome: 'accepted' | 'refused';
  metadata: {
    gate: 'cost';
    dp: 1 | 2;
    entryId: string;
    controlIds: string[];
    costKey: string | null;
    estimateShown: string | null;
    priceDate: string;
    ackHash: string | null;
    operator: string;
    timestamp: string;
    typed?: string;
    noOtherMeans?: string;
    reason?: string;
    sha256Hash: string;
  };
}

export function buildCostGateEvidence(input: {
  dp: 1 | 2;
  outcome: 'accepted' | 'refused';
  item?: CostItem;
  price?: PriceEntry;
  priceDate: string;
  ackHash?: string;
  operator: string;
  at: Date;
  typed?: string;
  entryId?: string;
  reason?: string;
  noOtherMeans?: string;
}): CostGateEvidenceRecord {
  const entryId = input.item?.item_id ?? input.entryId ?? 'unknown';
  const estimateShown = input.price ? formatEstimate(input.price.estimate_month_low, input.price.estimate_month_high) : null;
  const raw = JSON.stringify({ gate: 'cost', dp: input.dp, entry_id: entryId, outcome: input.outcome, estimate: estimateShown, price_date: input.priceDate, ackHash: input.ackHash ?? null, operator: input.operator, reason: input.reason ?? null });
  return {
    rawResponse: raw,
    outcome: input.outcome,
    metadata: {
      gate: 'cost',
      dp: input.dp,
      entryId,
      controlIds: input.item?.control_ids ?? [],
      costKey: input.item?.cost_gate.cost_key ?? null,
      estimateShown,
      priceDate: input.priceDate,
      ackHash: input.ackHash ?? null,
      operator: input.operator,
      timestamp: input.at.toISOString(),
      ...(input.dp === 2 ? { typed: input.typed ?? '' } : {}),
      ...(input.noOtherMeans ? { noOtherMeans: input.noOtherMeans } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      sha256Hash: createHash('sha256').update(raw, 'utf8').digest('hex'),
    },
  };
}

/** <tenantDir>/cost-gate-evidence/<timestamp>-<entry>-dp<n>.json */
export function writeCostGateEvidence(tenantDir: string, record: CostGateEvidenceRecord): string {
  const stamp = record.metadata.timestamp.replace(/[:.]/g, '-');
  const safeId = record.metadata.entryId.replace(/[^A-Za-z0-9.-]/g, '_');
  const target = path.join(tenantDir, COST_GATE_EVIDENCE_DIR, `${stamp}-${safeId}-dp${record.metadata.dp}.json`);
  writeJsonArtifact(target, record);
  return target;
}

/** The run-report line (§3.9). */
export function recurringCostRunReportLine(enabled: Array<{ estimate_month_low: number; estimate_month_high: number }>, priceDate: string): string {
  if (enabled.length === 0) return 'Recurring cost enabled by this run: none';
  const low = enabled.reduce((s, e) => s + e.estimate_month_low, 0);
  const high = enabled.reduce((s, e) => s + e.estimate_month_high, 0);
  return `Recurring cost enabled by this run: ${enabled.length} item${enabled.length === 1 ? '' : 's'}, about ${formatEstimate(Math.round(low * 100) / 100, Math.round(high * 100) / 100)} a month (price date ${priceDate})`;
}

// ---------- Catalogue (cost-items.reference.json) ----------

interface RawRegistryEntry {
  entry_id: string;
  label: string;
  control_ids: string[];
  retired?: boolean;
  cost_gate?: CostGateBlock;
}

/** The Stamper rows of the catalogue: every registry entry that carries a cost_gate block, in registry order. */
export function buildStamperCostItems(registries: Array<{ source: string; entries: RawRegistryEntry[] }>): CostItem[] {
  const items: CostItem[] = [];
  for (const reg of registries) {
    for (const e of reg.entries) {
      if (!e.cost_gate) continue;
      items.push({
        item_id: e.entry_id,
        kind: 'registry_entry',
        source: reg.source,
        label: e.label,
        control_ids: [...e.control_ids],
        ...(e.retired ? { retired: true } : {}),
        cost_gate: e.cost_gate,
      });
    }
  }
  return items;
}
