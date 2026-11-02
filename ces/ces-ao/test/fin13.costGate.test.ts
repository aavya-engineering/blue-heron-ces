// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-13 (B-5): the AO cost gate can now be passed with the REAL shared price file
// (ces-shared/src/data/cost-estimates.reference.json, estimate_month_high), proven on the real
// registry op F-12 against a kind:'sim' tenant (the unit half of V113): the dry run shows the
// price; a live run is refused without DP-1 and on a mistyped DP-2; DP-1 + the typed DP-2 runs
// it; every outcome is a persisted row. Also: the two-person mode on the 428 apply-guard row and
// the approval-rejection row, and a positive-credit control on a real registry op.
// Real temp CES database; the only mock is the PowerShell boundary.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const holder = vi.hoisted(() => ({ root: '', executed: 0, stdout: '' }));

vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute() {
      holder.executed++;
      return { success: true, stdout: holder.stdout || JSON.stringify({ ok: true, n: holder.executed }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { isTwoPersonApprovalEnabled } from '../src/execution/SodGate.js';
import { recordApplyGuardRefusal } from '../src/execution/ApplyGuard.js';
import { twoPersonModeNow, withTwoPersonRecord } from '../src/execution/EvidenceEmitter.js';
import { buildAoCostItems, computeAckHash, expectedConfirmCost, loadCostEstimate, COST_ESTIMATES_PATH } from '../src/execution/CostGate.js';
import { STATE_BEGIN_MARKER, STATE_END_MARKER } from '../src/execution/GetThenSetExecutor.js';
import { getCommand, loadRegistry } from '../src/execution/invokeCommand.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceSchema } from 'ces-shared/types/adminops-evidence';
import { liveSatAdminOpsControls } from '../../ces-eo/src/eo/adminops/adminopsViews.js';
import type { TenantConfig } from 'ces-shared/config';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

const PRICES = JSON.parse(fs.readFileSync(COST_ESTIMATES_PATH, 'utf-8'));
const F12_MONTHLY: number = PRICES.prices['azure.firewall.premium'].estimate_month_high;
const PRICE_DATE: string = PRICES.price_date;
const REQUESTOR = 'operator@fin13.onmicrosoft.us';
const F12_INPUTS = { resourceGroup: 'rg-sim', firewallName: 'fw-sim', vnetName: 'vnet-sim', publicIpName: 'pip-sim' };
const KEYS = [
  'CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE',
  'CES_TWO_PERSON_APPROVAL', 'CES_COST_ESTIMATES_PATH',
] as const;
const saved: Record<string, string | undefined> = {};
let stacksim: StacksimEnvHandle;

function simTenant(): TenantConfig {
  return {
    tenantSlug: 'fin13-sim',
    tenantId: 'fin13-sim-tenant',
    appId: 'fin13-app',
    certPath: path.join(holder.root, 'fin13.pfx'),
    certThumbprint: 'F13F000000000000000000000000000000000000',
    domain: 'fin13.onmicrosoft.us',
    kind: 'sim',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'fin13-sub',
    resources: {},
  } as unknown as TenantConfig;
}

const rowsFor = (id: string) =>
  getCesRepository().listAll<any>('adminops_evidence').filter((r: any) => r.data?.metadata?.commandId === id);

const f12Ack = (monthly = F12_MONTHLY) => ({
  opId: 'F-12',
  ackHash: computeAckHash('F-12', monthly, PRICE_DATE),
  monthlyUsd: monthly,
  priceDate: PRICE_DATE,
  operator: REQUESTOR,
  noOtherMeans: 'fin13 test: the vendor endpoint cannot be expressed as a service tag',
});

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  holder.root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fin13-'));
  holder.executed = 0;
  holder.stdout = '';
  fs.writeFileSync(path.join(holder.root, 'fin13.pfx'), 'placeholder');
  process.env.CES_PIPELINE_ROOT = holder.root;
  // The REAL price file: no CES_COST_ESTIMATES_PATH override.
  for (const k of KEYS.slice(1)) delete process.env[k];
  stacksim = activateStacksimEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  closeAllCesRepositories();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  stacksim.restore();
  fs.rmSync(holder.root, { recursive: true, force: true });
});

describe('FIN-13 B-5: the real price file resolves every AO cost key (high figure)', () => {
  it('C-03, E-01, F-12, F-14 all price from cost-estimates.reference.json', () => {
    for (const id of ['C-03', 'E-01', 'F-12', 'F-14']) {
      const key = getCommand(id)!.cost_gate!.cost_key!;
      const est = loadCostEstimate(key);
      expect(est, `${id} ${key}`).toBeDefined();
      expect(est!.monthlyUsd).toBe(PRICES.prices[key].estimate_month_high);
      expect(est!.monthlyUsdLow).toBe(PRICES.prices[key].estimate_month_low);
      expect(est!.priceDate).toBe(PRICE_DATE);
    }
  });

  it('the legacy single-figure shape still works (monthly_usd)', () => {
    const p = path.join(holder.root, 'legacy.json');
    fs.writeFileSync(p, JSON.stringify({ price_date: '2026-10-31', estimates: { k: { monthly_usd: 4.5 } } }));
    expect(loadCostEstimate('k', p)).toEqual({ monthlyUsd: 4.5, priceDate: '2026-10-31' });
  });
});

describe('FIN-13 V113 (unit half): F-12 through DP-1 and DP-2 on a sim tenant, every outcome evidenced', () => {
  it('dry run shows the price (notice) and runs nothing costly', async () => {
    const res: any = await executeAoCommand(getCommand('F-12')!, simTenant(), F12_INPUTS, true, {});
    expect(res.evidence.outcome).toBe('dry_run');
    expect(res.evidence.metadata.costGate).toMatchObject({
      outcome: 'notice', costKey: 'azure.firewall.premium', monthlyUsd: F12_MONTHLY, priceDate: PRICE_DATE,
      ackHash: computeAckHash('F-12', F12_MONTHLY, PRICE_DATE), twoPerson: true, lastResort: true,
    });
    expect(rowsFor('F-12')).toHaveLength(1);
  });

  it('live without DP-1 is refused (dp1_missing) with a persisted row', async () => {
    const res: any = await executeAoCommand(getCommand('F-12')!, simTenant(), F12_INPUTS, false, { requestorUPN: REQUESTOR });
    expect(res.evidence.outcome).toBe('denied_cost_gate');
    expect(res.evidence.metadata.costGate.reason).toMatch(/^dp1_missing/);
    expect(holder.executed).toBe(0);
    const row = rowsFor('F-12')[0];
    expect(row.data.evidence.metadata.costGate.outcome).toBe('refused');
    expect(row.data.evidence.metadata.twoPersonApproval).toEqual({ mode: 'off', tierRequired: true });
  });

  it('live with DP-1 and a wrong typed DP-2 is refused (dp2_mismatch), the typed text recorded', async () => {
    const res: any = await executeAoCommand(getCommand('F-12')!, simTenant(), F12_INPUTS, false, {
      requestorUPN: REQUESTOR, costAck: f12Ack(), confirmCost: 'F-12 1277.50',
    });
    expect(res.evidence.metadata.costGate.reason).toMatch(/^dp2_mismatch/);
    expect(res.evidence.metadata.costGate.dp2.typed).toBe('F-12 1277.50');
    expect(holder.executed).toBe(0);
    expect(rowsFor('F-12')[0].data.evidence.metadata.costGate.dp2.typed).toBe('F-12 1277.50');
  });

  it('live with DP-1 + the correct DP-2 runs (sim tenant), records both positives, and is credited (positive control)', async () => {
    holder.stdout = `${STATE_BEGIN_MARKER}\n{"Name":"fw-sim","AllocationState":"Allocated"}\n${STATE_END_MARKER}\nSTAMPER_EXECUTION_SUCCESS\n`;
    const typed = expectedConfirmCost('F-12', F12_MONTHLY);
    expect(typed).toBe(`F-12 ${F12_MONTHLY.toFixed(2)}`);
    const res: any = await executeAoCommand(getCommand('F-12')!, simTenant(), F12_INPUTS, false, {
      requestorUPN: REQUESTOR, costAck: f12Ack(), confirmCost: typed,
    });
    expect(res.success, res.error).toBe(true);
    expect(holder.executed).toBeGreaterThan(0);
    const cg = res.evidence.metadata.costGate;
    expect(cg).toMatchObject({ outcome: 'enabled', monthlyUsd: F12_MONTHLY, dp2: { typed } });
    expect(cg.dp1).toMatchObject({ operator: REQUESTOR, noOtherMeans: expect.stringMatching(/service tag/) });
    const rows = rowsFor('F-12');
    expect(rows).toHaveLength(1);
    const parsed = AdminOpsEvidenceSchema.safeParse(rows[0].data.metadata);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data!.tenantKind).toBe('sim');
    expect(parsed.data!.outcome).toBe('executed');
    expect(parsed.data!.verdict).toBe('SAT');
    expect(parsed.data!.postStateOutput?.trim()).toBeTruthy();
    // Positive-credit control on a real registry op (W8 report §5): a live write with a
    // confirming read is credited by EO's production rule (AD-6 Tier 3).
    expect([...liveSatAdminOpsControls([parsed.data!])].sort()).toEqual([...getCommand('F-12')!.cmmcPractices].sort());
  });
});

describe('FIN-13: the two-person mode on the 428 and rejection rows', () => {
  it('a 428 apply-guard row records mode and tierRequired (Tier 3 F-12 vs Tier 2 A-11)', async () => {
    const f12 = await recordApplyGuardRefusal(getCommand('F-12')!, simTenant(), F12_INPUTS, 'test refusal', { requestorUPN: REQUESTOR });
    expect(f12.evidence.metadata.twoPersonApproval).toEqual({ mode: 'off', tierRequired: true });
    expect(rowsFor('F-12')[0].data.evidence.metadata.twoPersonApproval).toEqual({ mode: 'off', tierRequired: true });
    process.env.CES_TWO_PERSON_APPROVAL = '1';
    const a11 = await recordApplyGuardRefusal(getCommand('A-11')!, simTenant(), {}, 'test refusal', {});
    expect(a11.evidence.metadata.twoPersonApproval).toEqual({ mode: 'on', tierRequired: false });
  });

  it('a rejection row without the record gets the current mode; a present record is kept', () => {
    const rej: any = { outcome: 'approval_rejected', rawResponse: '', metadata: { controlIds: [], timestamp: 't' } };
    expect(withTwoPersonRecord(rej).metadata.twoPersonApproval).toEqual({ mode: 'off', tierRequired: true });
    process.env.CES_TWO_PERSON_APPROVAL = 'TRUE';
    expect(withTwoPersonRecord(rej).metadata.twoPersonApproval).toEqual({ mode: 'on', tierRequired: true });
    expect(rej.metadata.twoPersonApproval).toBeUndefined();
    const kept: any = { ...rej, metadata: { ...rej.metadata, twoPersonApproval: { mode: 'off', tierRequired: true } } };
    expect(withTwoPersonRecord(kept)).toBe(kept);
    const other: any = { outcome: 'executed', metadata: {} };
    expect(withTwoPersonRecord(other)).toBe(other);
  });

  it('twoPersonModeNow mirrors SodGate.isTwoPersonApprovalEnabled', () => {
    for (const v of [undefined, '', '0', 'false', '1', 'true', ' TRUE ', 'yes']) {
      if (v === undefined) delete process.env.CES_TWO_PERSON_APPROVAL;
      else process.env.CES_TWO_PERSON_APPROVAL = v;
      expect(twoPersonModeNow(), String(v)).toBe(isTwoPersonApprovalEnabled() ? 'on' : 'off');
    }
  });
});

describe('FIN-13: hygiene', () => {
  it('F-11 and F-12 declare idempotencyClass get-then-set', () => {
    expect(getCommand('F-11')!.idempotencyClass).toBe('get-then-set');
    expect(getCommand('F-12')!.idempotencyClass).toBe('get-then-set');
  });

  it('the ao_op catalogue rows leave out the pure licence dependency A-21', () => {
    const ids = buildAoCostItems(loadRegistry()).map((i) => i.item_id);
    expect(ids).not.toContain('A-21');
    expect(ids.length).toBeGreaterThanOrEqual(4);
  });

  it('live-smoke-e02 imports the shared package by its real name', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'live-smoke-e02.mts'), 'utf-8');
    expect(src).not.toContain('@bhd-edc/');
    expect(src).toContain("from 'ces-shared/config'");
  });
});
