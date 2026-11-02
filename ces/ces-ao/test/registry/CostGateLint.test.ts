// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-13 / CG-3 (AO half): CG-lint (COST-GATE-SPEC §3.8 items 1-6) over the AO registry
// (src/registry/ao-commands.registry.json) and its templates (src/registry/TemplateRegistry.ts),
// judged against the REAL shared price file and item catalogue (ces-shared/src/data). It is the
// twin of ces-stamper/tests/registry/CostGateLint.test.ts and reuses Stamper's costly-cmdlet list.
//
// Regenerate the ao_op catalogue rows after a registry change:
//   UPDATE_COST_ITEMS=1 npx vitest run test/registry/CostGateLint.test.ts
// (registry_entry rows are Stamper's; they are kept as they are.)

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CostItemSchema, FreeReasonSchema } from 'ces-shared/types/cost-gate';
import { costlyPatternsIn } from '../../../ces-stamper/src/core/CostGate.js';
import { buildAoCostItems, loadCostEstimate, COST_ESTIMATES_PATH } from '../../src/execution/CostGate.js';
import { getCommandTemplates } from '../../src/registry/TemplateRegistry.js';
import type { AoCommand } from '../../src/types/AoCommand.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MONO = path.resolve(here, '..', '..', '..');
const SHARED_DATA = path.join(MONO, 'ces-shared', 'src', 'data');
const CATALOGUE = path.join(SHARED_DATA, 'cost-items.reference.json');
const PRICES = path.join(SHARED_DATA, 'cost-estimates.reference.json');
const STAMPER_REG = path.join(MONO, 'ces-stamper', 'src', 'registry');
const AO_REG = path.resolve(here, '..', '..', 'src', 'registry', 'ao-commands.registry.json');

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const registry = readJson(AO_REG) as AoCommand[];
const estimates = readJson(PRICES) as { price_date: string; prices: Record<string, { estimate_month_low: number; estimate_month_high: number }> };
const FREE = FreeReasonSchema.options as readonly string[];
const knownIds = new Set<string>([
  ...registry.map((c) => c.id),
  ...['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'].flatMap((f) =>
    (readJson(path.join(STAMPER_REG, f)).entries as Array<{ entry_id: string }>).map((e) => e.entry_id),
  ),
]);
const isNone = (a: string) => a.startsWith('none: ') && a.length > 'none: '.length;

/** The SET text CG-lint item 1 scans: the template's set_command (array templates joined). */
function setText(id: string): string {
  const t = getCommandTemplates(id) as { set_command?: string | string[] } | null;
  const s = t?.set_command;
  return Array.isArray(s) ? s.join('\n') : s ?? '';
}

function lint(cmds: AoCommand[]): string[] {
  const problems: string[] = [];
  for (const c of cmds) {
    const g = c.cost_gate;
    const costly = costlyPatternsIn(setText(c.id));
    // (1) costly-cmdlet list, fail-closed
    if (costly.length && !g) problems.push(`${c.id}: SET matches ${costly.join(', ')} but has no cost_gate`);
    if (!g) continue;
    const alts = Array.isArray(g.standard_alternative) ? g.standard_alternative : [];
    // (2) free needs a free_reason from the closed list (no per_call_only: per-use billing is recurring, CQ-2)
    if (!g.recurring && !(g.free_reason && FREE.includes(g.free_reason))) problems.push(`${c.id}: free without a free_reason from the closed list`);
    if (g.recurring) {
      // (3) recurring: a priced cost_key, a non-empty standard_alternative of known ids or "none: <reason>"
      if (!g.cost_key || !estimates.prices[g.cost_key]) problems.push(`${c.id}: recurring with cost_key ${g.cost_key ?? 'none'} not in the price file`);
      if (!Array.isArray(g.standard_alternative) || alts.length === 0) problems.push(`${c.id}: recurring without a standard_alternative array`);
      for (const a of alts) if (!isNone(a) && !knownIds.has(a)) problems.push(`${c.id}: standard_alternative ${a} is not a registry entry or AO op`);
    }
    // (4) last resort: two_person and at least one named alternative, every one existing
    if (g.last_resort) {
      if (!g.two_person) problems.push(`${c.id}: last_resort without two_person`);
      const named = alts.filter((a) => !a.startsWith('none'));
      if (!named.length) problems.push(`${c.id}: last_resort without a named standard alternative`);
      for (const a of named) if (!knownIds.has(a)) problems.push(`${c.id}: last_resort alternative ${a} does not exist`);
    }
    // (5) two_person AO ops are Tier 3
    if (g.two_person && c.sodTier !== 'Tier 3') problems.push(`${c.id}: two_person but ${c.sodTier}`);
    const dep = g.licence_dependency as { cost_key?: string } | null;
    if (dep && !(dep.cost_key && estimates.prices[dep.cost_key])) problems.push(`${c.id}: licence cost_key ${dep.cost_key ?? 'none'} not in the price file`);
  }
  return problems;
}

describe('FIN-13 CG-lint: the AO registry against the shared cost data', () => {
  it('items 1-5: every AO op is clean (costly SETs carry cost_gate; free/recurring/last-resort/Tier 3 rules)', () => {
    expect(lint(registry)).toEqual([]);
  });

  it('the lint fails closed on bad blocks (a self-check of the rules above)', () => {
    const base = registry.find((c) => c.id === 'F-12')!;
    const bad = (id: string, cost_gate: any, extra: Partial<AoCommand> = {}) => ({ ...base, id, cost_gate, ...extra }) as AoCommand;
    const out = lint([
      bad('X-1', { ...base.cost_gate, cost_key: 'azure.network.flowlogs_traffic_analytics' }),
      bad('X-2', { ...base.cost_gate, standard_alternative: 'none' }),
      bad('X-3', { ...base.cost_gate, standard_alternative: ['AZ-NOPE-999'] }),
      bad('X-4', { ...base.cost_gate, two_person: true }, { sodTier: 'Tier 2' }),
      bad('X-5', { recurring: false, free_reason: 'per_call_only' }),
    ]);
    expect(out.join('\n')).toMatch(/X-1: recurring with cost_key azure\.network\.flowlogs_traffic_analytics not in the price file/);
    expect(out.join('\n')).toMatch(/X-2: recurring without a standard_alternative array/);
    expect(out.join('\n')).toMatch(/X-3: last_resort alternative AZ-NOPE-999 does not exist/);
    expect(out.join('\n')).toMatch(/X-4: two_person but Tier 2/);
    expect(out.join('\n')).toMatch(/X-5: free without a free_reason/);
  });

  it('B-5: every AO cost key resolves in the REAL price file, at estimate_month_high', () => {
    const recurring = registry.filter((c) => c.cost_gate?.recurring);
    expect(recurring.map((c) => c.id).sort()).toEqual(['C-03', 'E-01', 'F-12', 'F-14']);
    for (const c of recurring) {
      const est = loadCostEstimate(c.cost_gate!.cost_key!, COST_ESTIMATES_PATH);
      const p = estimates.prices[c.cost_gate!.cost_key!];
      expect({ id: c.id, est }).toEqual({
        id: c.id,
        est: { monthlyUsd: p.estimate_month_high, monthlyUsdLow: p.estimate_month_low, priceDate: estimates.price_date },
      });
    }
  });

  it('item 3: the price file is dated and no more than 180 days old', () => {
    const age = (Date.now() - Date.parse(`${estimates.price_date}T00:00:00Z`)) / 86_400_000;
    expect(age).toBeLessThanOrEqual(180);
  });

  it('item 6: the ao_op rows of cost-items.reference.json equal what the AO registry builds (no drift)', () => {
    const built = buildAoCostItems(registry);
    const catalogue = readJson(CATALOGUE) as { items: Array<{ kind: string }> };
    if (process.env.UPDATE_COST_ITEMS === '1') {
      catalogue.items = [...catalogue.items.filter((i) => i.kind !== 'ao_op'), ...built];
      fs.writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 2) + '\n');
    }
    const after = readJson(CATALOGUE) as { items: Array<{ kind: string }> };
    expect(after.items.filter((i) => i.kind === 'ao_op')).toEqual(built);
    // V105 counts ao_op rows: the four recurring ops plus the two free firewall/subnet ops.
    expect(built.map((i) => i.item_id)).toEqual(['C-03', 'E-01', 'F-11', 'F-12', 'F-13', 'F-14']);
    // Every row is a valid shared CostItem (the schema Muster and ces-shared's own test parse with).
    for (const row of built) expect(CostItemSchema.safeParse(row).success, row.item_id).toBe(true);
  });
});
