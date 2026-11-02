// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Cost gate, Stamper side: classification (fail-closed), DP-1 (cost-acks.json), translation
// (un-acked recurring entries left out as cost_gated_off), DP-2 (typed, refused in auto / harness /
// without a terminal / on a stale DP-1), and the evidence records.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyCostGate, classifyEntry, computeAckHash, evaluateDp2, formatEstimate, loadCostGateReference,
  readCostAcks, recordCostAck, recurringCostRunReportLine, CostGateError, COST_GATE_EVIDENCE_DIR,
  type CostGateReference,
} from '../../src/core/CostGate.js';
import { PlanTranslator } from '../../src/translators/PlanTranslator.js';
import { CommandRegistry } from '../../src/registry/CommandRegistry.js';

const ref = loadCostGateReference();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
const KV = { entry_id: 'SC.L2-3.13.10.key-vault', control_ids: ['SC.L2-3.13.10'], set_command: "New-AzKeyVault -Sku 'Standard'" };
const ESCROW = { entry_id: 'SC.L2-3.13.10.key-escrow', control_ids: ['SC.L2-3.13.10'], set_command: '' };

describe('classification', () => {
  it('the key vault is recurring from the catalogue; the escrow read is free', () => {
    expect(classifyEntry(KV, ref)).toMatchObject({ recurring: true, basis: 'catalogue' });
    expect(classifyEntry(ESCROW, ref)).toMatchObject({ recurring: false, basis: 'no_set' });
  });

  it('fail-closed: an unknown entry with a costly SET is recurring', () => {
    expect(classifyEntry({ entry_id: 'X.unknown', set_command: "New-AzFirewall -Name fw" }, ref)).toMatchObject({ recurring: true, basis: 'fail_closed' });
    expect(classifyEntry({ entry_id: 'X.unknown', set_command: 'Set-MgPolicy -x 1' }, ref)).toMatchObject({ recurring: false, basis: 'free' });
  });
});

describe('DP-1 and translation', () => {
  it('no DP-1: the recurring entry is dropped as cost_gated_off; free entries stay', () => {
    const { kept, decisions } = applyCostGate([KV, ESCROW], [], ref);
    expect(kept.map(e => e.entry_id)).toEqual(['SC.L2-3.13.10.key-escrow']);
    expect(decisions).toEqual([expect.objectContaining({ entry_id: KV.entry_id, state: 'off', reason: 'cost_gated_off', cause: 'no_dp1', cost_key: 'azure.keyvault.operations', standard_alternative: ['SC.L2-3.13.10.key-escrow'] })]);
  });

  it('DP-1 recorded in cost-acks.json keeps the entry; a price change makes it stale', () => {
    const dir = tmp();
    const { ack, evidencePath } = recordCostAck(dir, { entry_id: KV.entry_id, operator: 'op@example.test' }, ref, new Date('2026-10-31T10:00:00Z'));
    expect(readCostAcks(dir)).toEqual([ack]);
    expect(JSON.parse(fs.readFileSync(evidencePath, 'utf-8')).metadata).toMatchObject({ gate: 'cost', dp: 1, entryId: KV.entry_id, ackHash: ack.ackHash });
    expect(evidencePath).toContain(COST_GATE_EVIDENCE_DIR);
    expect(applyCostGate([KV], readCostAcks(dir), ref).decisions[0]).toMatchObject({ state: 'acked', ackHash: ack.ackHash });

    const changed: CostGateReference = { ...ref, estimates: { ...ref.estimates, price_date: '2026-12-01' } };
    expect(applyCostGate([KV], readCostAcks(dir), changed)).toMatchObject({ kept: [], decisions: [{ state: 'off', cause: 'stale_dp1' }] });
  });

  it('DP-1 is refused for a free entry and for a last resort without a justification', () => {
    const dir = tmp();
    expect(() => recordCostAck(dir, { entry_id: 'AZ-FW-003', operator: 'op' }, ref)).toThrow(CostGateError);
    expect(() => recordCostAck(dir, { entry_id: 'AZ-FW-002', operator: 'op' }, ref)).toThrow(/last resort/);
    expect(recordCostAck(dir, { entry_id: 'AZ-FW-002', operator: 'op', no_other_means: 'contract requires network IDPS; Basic considered first' }, ref).ack.no_other_means).toBeDefined();
  });

  it('the translator leaves the vault out of the plan and records it; the escrow read runs instead', () => {
    const registry = CommandRegistry.load();
    const t = new PlanTranslator(registry);
    const entries = (t as any).costGated(registry.allEntries.filter((e: any) => e.control_ids.includes('SC.L2-3.13.10')));
    // costGated only works inside translate(); the reference is set there.
    expect(entries.map((e: any) => e.entry_id)).toContain('SC.L2-3.13.10.key-vault');
    (t as any).costGateRef = ref;
    const gated = (t as any).costGated(registry.allEntries.filter((e: any) => e.control_ids.includes('SC.L2-3.13.10')));
    expect(gated.map((e: any) => e.entry_id)).toEqual(['SC.L2-3.13.10.key-escrow']);
  });
});

describe('DP-2', () => {
  const dir = tmp();
  const { ack } = recordCostAck(dir, { entry_id: KV.entry_id, operator: 'op' }, ref);
  const shown = formatEstimate(ack.estimate_month_low, ack.estimate_month_high);
  const base = { entry_id: KV.entry_id, acks: [ack], ref, mode: 'manual' as const, interactive: true, operator: 'op' };

  it('typed entry id or the figure shown is accepted, with a DP-2 record', () => {
    expect(evaluateDp2({ ...base, typed: KV.entry_id })).toMatchObject({ allowed: true, evidence: { outcome: 'accepted', metadata: { dp: 2, typed: KV.entry_id, ackHash: ack.ackHash } } });
    expect(evaluateDp2({ ...base, typed: shown }).allowed).toBe(true);
  });

  it('refused: wrong text, auto mode, no terminal, harness, no DP-1; refusals are recorded', () => {
    expect(evaluateDp2({ ...base, typed: 'yes' })).toMatchObject({ allowed: false, evidence: { outcome: 'refused' } });
    expect(evaluateDp2({ ...base, typed: KV.entry_id, mode: 'auto' }).reason).toMatch(/cost_gated_off.*manual/);
    expect(evaluateDp2({ ...base, typed: KV.entry_id, interactive: false }).reason).toMatch(/terminal/);
    expect(evaluateDp2({ ...base, typed: KV.entry_id, harness: true }).reason).toMatch(/harness/);
    expect(evaluateDp2({ ...base, typed: KV.entry_id, acks: [] }).reason).toMatch(/no DP-1/);
  });
});

describe('hash and report line', () => {
  it('ackHash covers id, estimate and price date', () => {
    expect(computeAckHash('a', 1, 2, 'd')).not.toBe(computeAckHash('a', 1, 3, 'd'));
    expect(computeAckHash('a', 1, 2, 'd')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('run-report line', () => {
    expect(recurringCostRunReportLine([], '2026-10-31')).toBe('Recurring cost enabled by this run: none');
    expect(recurringCostRunReportLine([{ estimate_month_low: 4.56, estimate_month_high: 4.56 }], '2026-10-31')).toBe('Recurring cost enabled by this run: 1 item, about $4.56 a month (price date 2026-10-31)');
  });
});
