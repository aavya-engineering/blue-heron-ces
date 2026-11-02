// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W9-C1: (1) two-person approval is OFF by default (founder ruling 2026-10-31) and
// CES_TWO_PERSON_APPROVAL=1 re-enables it; every row records the mode. (2) CG-5: the AO side
// of the cost gate: a live run of a recurring-cost op needs DP-1 (costAck) + a typed DP-2
// (confirmCost); A-21 is a licence dependency, recorded and never gated.
// Real temp CES database; the only mock is the PowerShell boundary.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const holder = vi.hoisted(() => ({ root: '', executed: 0 }));

vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute() {
      holder.executed++;
      return { success: true, stdout: JSON.stringify({ ok: true, n: holder.executed }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { isTwoPersonApprovalEnabled, requiresManualGate } from '../src/execution/SodGate.js';
import { listApprovals } from '../src/execution/ApprovalStore.js';
import { computeAckHash, expectedConfirmCost, isRecurringFor } from '../src/execution/CostGate.js';
import { getCommand, loadRegistry } from '../src/execution/invokeCommand.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import type { TenantConfig } from 'ces-shared/config';
import type { AoCommand } from '../src/types/AoCommand.js';
import { makeAoCommand } from './fixtures.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

const PRICE_FIXTURE = path.resolve(__dirname, 'fixtures', 'cost-estimates.fixture.json');
const FLOW_MONTHLY = 12.4;
const PRICE_DATE = '2026-10-31';
const REQUESTOR = 'operator@w9c1.onmicrosoft.us';
const KEYS = [
  'CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE',
  'CES_TWO_PERSON_APPROVAL', 'CES_COST_ESTIMATES_PATH',
] as const;
const saved: Record<string, string | undefined> = {};
let stacksim: StacksimEnvHandle;

const T3 = makeAoCommand({ id: 'W9C1-T3-01', trigger: 'EVIDENCE', sodTier: 'Tier 3', cmmcPractices: ['AC.L2-3.1.5'] });
const RECURRING = makeAoCommand({
  id: 'W9C1-CG-01',
  cost_gate: {
    recurring: true, cost_key: 'azure.network_watcher.flow_logs', estimate_basis: 'test',
    two_person: false, irreversible: false, last_resort: false, standard_alternative: 'none',
    free_reason: null, licence_dependency: null,
  },
});
const LAST_RESORT = makeAoCommand({
  id: 'W9C1-CG-02',
  cost_gate: {
    recurring: true, cost_key: 'azure.firewall.premium', estimate_basis: 'test',
    two_person: true, irreversible: false, last_resort: true, standard_alternative: ['F-13'],
    free_reason: null, licence_dependency: null,
  },
});

function simTenant(resources: Record<string, unknown> = {}): TenantConfig {
  return {
    tenantSlug: 'w9c1-sim',
    tenantId: 'w9c1-sim-tenant',
    appId: 'w9c1-app',
    certPath: path.join(holder.root, 'w9c1.pfx'),
    certThumbprint: 'C1C1000000000000000000000000000000000000',
    domain: 'w9c1.onmicrosoft.us',
    kind: 'sim',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'w9c1-sub',
    resources,
  } as unknown as TenantConfig;
}

const rowsFor = (id: string) =>
  getCesRepository()
    .listAll<any>('adminops_evidence')
    .filter((r: any) => r.data?.metadata?.commandId === id);

function ack(cmd: AoCommand, monthly = FLOW_MONTHLY, extra: Record<string, unknown> = {}) {
  return { opId: cmd.id, ackHash: computeAckHash(cmd.id, monthly, PRICE_DATE), monthlyUsd: monthly, priceDate: PRICE_DATE, ...extra };
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  holder.root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-w9c1-'));
  holder.executed = 0;
  fs.writeFileSync(path.join(holder.root, 'w9c1.pfx'), 'placeholder');
  process.env.CES_PIPELINE_ROOT = holder.root;
  for (const k of KEYS.slice(1)) delete process.env[k];
  process.env.CES_COST_ESTIMATES_PATH = PRICE_FIXTURE;
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

describe('W9-C1: two-person approval switch (default OFF)', () => {
  it('the switch is off unless CES_TWO_PERSON_APPROVAL is 1 or true', () => {
    expect(isTwoPersonApprovalEnabled()).toBe(false);
    process.env.CES_TWO_PERSON_APPROVAL = '0';
    expect(isTwoPersonApprovalEnabled()).toBe(false);
    process.env.CES_TWO_PERSON_APPROVAL = '1';
    expect(isTwoPersonApprovalEnabled()).toBe(true);
    process.env.CES_TWO_PERSON_APPROVAL = 'true';
    expect(isTwoPersonApprovalEnabled()).toBe(true);
  });

  it('off: a Tier 3 live run executes for the single operator, opens no approval, and records mode off', async () => {
    const res: any = await executeAoCommand(T3, simTenant(), {}, false, { requestorUPN: REQUESTOR });
    expect(res.status).toBeUndefined();
    expect(res.success, res.error).toBe(true);
    expect(holder.executed).toBeGreaterThan(0);
    expect(res.evidence.metadata.twoPersonApproval).toEqual({ mode: 'off', tierRequired: true });
    expect(await listApprovals()).toHaveLength(0);
  });

  it('off: a Tier 3 dry run is a plain preview (no pending approval) and needs no requestor', async () => {
    const res: any = await executeAoCommand(T3, simTenant(), {}, true, {});
    expect(res.status).toBeUndefined();
    expect(res.evidence.outcome).toBe('dry_run');
    expect(await listApprovals()).toHaveLength(0);
  });

  it('off: a Tier 3 unsafe_requires_gate command with a set_command takes the write path, as an approved one did', async () => {
    const a03 = getCommand('A-03')!;
    const res: any = await executeAoCommand(a03, simTenant(), { targetUPN: 'leaver@w9c1.onmicrosoft.us', reason: 'test' }, false, { requestorUPN: REQUESTOR });
    expect(res.status).toBeUndefined();
    expect(res.evidence.metadata.setApplied).toBeDefined();
    expect(res.evidence.metadata.twoPersonApproval.mode).toBe('off');
  });

  it('on: the same Tier 3 run stops at a pending approval and the row records mode on', async () => {
    process.env.CES_TWO_PERSON_APPROVAL = '1';
    const res: any = await executeAoCommand(T3, simTenant(), {}, false, { requestorUPN: REQUESTOR });
    expect(res.status).toBe('pending_approval');
    expect(holder.executed).toBe(0);
    const row = rowsFor(T3.id)[0];
    expect(row.data.metadata.outcome).toBe('blocked_pending_approval');
    const ev: any = await getCesRepository().listAll<any>('adminops_approvals');
    expect(ev).toHaveLength(1);
  });

  it('the tier rule itself is unchanged (Tier 3 and the M4 live-L2 floor still answer true)', () => {
    expect(requiresManualGate(T3)).toBe(true);
    const t2 = makeAoCommand({ id: 'W9C1-T2', sodTier: 'Tier 2' });
    expect(requiresManualGate(t2, { cmmcLevel: 'L2', kind: 'live', writeShaped: true })).toBe(true);
  });
});

describe('CG-5: AO cost gate (DP-1 costAck + typed DP-2 confirmCost)', () => {
  it('dry run of a recurring op runs and carries the cost notice with the monthly estimate', async () => {
    const res: any = await executeAoCommand(RECURRING, simTenant(), {}, true, {});
    expect(res.evidence.outcome).toBe('dry_run');
    const cg = res.evidence.metadata.costGate;
    expect(cg).toMatchObject({ gate: 'cost', classification: 'recurring', outcome: 'notice', monthlyUsd: FLOW_MONTHLY, priceDate: PRICE_DATE });
    expect(cg.ackHash).toBe(computeAckHash(RECURRING.id, FLOW_MONTHLY, PRICE_DATE));
  });

  it('live run without DP-1 is refused before anything runs, with enforcement evidence', async () => {
    const res: any = await executeAoCommand(RECURRING, simTenant(), {}, false, { requestorUPN: REQUESTOR });
    expect(res.success).toBe(false);
    expect(holder.executed).toBe(0);
    expect(res.evidence.outcome).toBe('denied_cost_gate');
    expect(res.evidence.complianceVerdict).toBe('NOT_APPLICABLE');
    expect(res.evidence.metadata.costGate).toMatchObject({ outcome: 'refused', monthlyUsd: FLOW_MONTHLY });
    expect(res.evidence.metadata.costGate.reason).toMatch(/^dp1_missing/);
    const row = rowsFor(RECURRING.id)[0];
    expect(row.data.metadata.outcome).toBe('failed');
    expect(row.data.evidence.metadata.costGate.outcome).toBe('refused');
  });

  it('a stale DP-1 (ackHash of another estimate) is refused', async () => {
    const res: any = await executeAoCommand(RECURRING, simTenant(), {}, false, {
      costAck: ack(RECURRING, 9.99), confirmCost: expectedConfirmCost(RECURRING.id, FLOW_MONTHLY),
    });
    expect(res.evidence.metadata.costGate.reason).toMatch(/^dp1_stale/);
    expect(holder.executed).toBe(0);
  });

  it('DP-1 without DP-2, or a mistyped DP-2, is refused', async () => {
    const r1: any = await executeAoCommand(RECURRING, simTenant(), {}, false, { costAck: ack(RECURRING) });
    expect(r1.evidence.metadata.costGate.reason).toMatch(/^dp2_missing/);
    const r2: any = await executeAoCommand(RECURRING, simTenant(), {}, false, { costAck: ack(RECURRING), confirmCost: `${RECURRING.id} 12` });
    expect(r2.evidence.metadata.costGate.reason).toMatch(/^dp2_mismatch/);
    expect(r2.evidence.metadata.costGate.dp2.typed).toBe(`${RECURRING.id} 12`);
    expect(holder.executed).toBe(0);
  });

  it('DP-1 + matching DP-2 runs the op and records both positives', async () => {
    const res: any = await executeAoCommand(RECURRING, simTenant(), {}, false, {
      requestorUPN: REQUESTOR, costAck: ack(RECURRING), confirmCost: `${RECURRING.id} $12.40`,
    });
    expect(res.success, res.error).toBe(true);
    expect(holder.executed).toBeGreaterThan(0);
    const cg = res.evidence.metadata.costGate;
    expect(cg.outcome).toBe('enabled');
    expect(cg.dp1).toMatchObject({ operator: REQUESTOR, ackHash: computeAckHash(RECURRING.id, FLOW_MONTHLY, PRICE_DATE) });
    expect(cg.dp2.typed).toBe(`${RECURRING.id} $12.40`);
  });

  it('a last-resort op also needs a written noOtherMeans', async () => {
    const monthly = 1277.5;
    const base = { confirmCost: expectedConfirmCost(LAST_RESORT.id, monthly) };
    const r1: any = await executeAoCommand(LAST_RESORT, simTenant(), {}, false, { ...base, costAck: ack(LAST_RESORT, monthly) });
    expect(r1.evidence.metadata.costGate.reason).toMatch(/^no_other_means_missing/);
    const r2: any = await executeAoCommand(LAST_RESORT, simTenant(), {}, false, {
      ...base, costAck: ack(LAST_RESORT, monthly, { noOtherMeans: 'service tags cannot express the vendor endpoint' }),
    });
    expect(r2.success, r2.error).toBe(true);
    expect(r2.evidence.metadata.costGate.dp1.noOtherMeans).toMatch(/service tags/);
  });

  it('no price file (or no key) is fail-closed: the live run is refused', async () => {
    process.env.CES_COST_ESTIMATES_PATH = path.join(holder.root, 'missing.json');
    const res: any = await executeAoCommand(RECURRING, simTenant(), {}, false, { costAck: ack(RECURRING), confirmCost: 'x' });
    expect(res.evidence.metadata.costGate.reason).toMatch(/^cost_estimate_unavailable/);
    expect(holder.executed).toBe(0);
  });

  it('E-01 is recurring only above 90 days of retention (unknown counts as recurring)', () => {
    const e01 = getCommand('E-01')!;
    expect(isRecurringFor(e01, {}, { auditLogRetentionDays: 90 })).toBe(false);
    expect(isRecurringFor(e01, {}, { auditLogRetentionDays: 365 })).toBe(true);
    expect(isRecurringFor(e01, {}, {})).toBe(true);
  });

  it('A-21 is a licence dependency: not gated, recorded on the row, runs as before', async () => {
    const a21 = getCommand('A-21')!;
    expect(a21.cost_gate?.recurring).toBe(false);
    expect(a21.cost_gate?.licence_dependency?.licence).toMatch(/Governance/);
    const res: any = await executeAoCommand(a21, simTenant({ leaver_workflow_id: 'wf-leaver-1' }), {}, false, { requestorUPN: REQUESTOR });
    expect(res.evidence.outcome).not.toBe('denied_cost_gate');
    expect(holder.executed).toBeGreaterThan(0);
    expect(res.evidence.metadata.costGate).toMatchObject({ classification: 'licence_dependency', outcome: 'licence_dependency' });
  });

  it('registry: F-12 is Tier 3 + last resort; every recurring op has a cost key; no harness op is recurring', () => {
    const reg = loadRegistry();
    const f12 = reg.find((c) => c.id === 'F-12')!;
    expect(f12.sodTier).toBe('Tier 3');
    expect(f12.cost_gate).toMatchObject({ recurring: true, two_person: true, last_resort: true });
    const recurring = reg.filter((c) => c.cost_gate?.recurring).map((c) => c.id).sort();
    expect(recurring).toEqual(['C-03', 'E-01', 'F-12', 'F-14']);
    for (const c of reg.filter((x) => x.cost_gate?.recurring)) {
      expect(c.cost_gate!.cost_key, c.id).toBeTruthy();
      expect(c.cost_gate!.standard_alternative, c.id).toBeTruthy();
    }
    for (const c of reg.filter((x) => x.cost_gate && !x.cost_gate.recurring && !x.cost_gate.licence_dependency)) {
      expect(c.cost_gate!.free_reason, c.id).toBeTruthy();
    }
    for (const id of ['A-02', 'A-09', 'A-10', 'A-11', 'A-19', 'A-21', 'B-03', 'B-09']) {
      expect(reg.find((c) => c.id === id)?.cost_gate?.recurring ?? false, id).toBe(false);
    }
  });
});
