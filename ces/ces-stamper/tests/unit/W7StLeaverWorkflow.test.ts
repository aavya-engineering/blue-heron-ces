// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W7-ST: PS.L2-3.9.2.leaver-workflow, a verify-only entry. It reads the lifecycle workflows with their
// tasks and emits one inventory object; SAT only when a leaver workflow is enabled, scheduled and
// carries a disable-account or delete-account task. Stamper never creates or changes a workflow.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { CommandRegistrySchema } from '../../src/registry/command-registry.types';
import { lookupGetCommand } from '../../src/registry/lookup';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const registry = CommandRegistry.load(REGISTRY_PATH);
const ID = 'PS.L2-3.9.2.leaver-workflow';
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const DISABLE = '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950';
const DELETE = '8d18588d-9ad3-4c0f-99d0-ec215f0e3dff';

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w7-st-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

// ---- the inventory the GET's PowerShell emits, mirrored here for the fixtures ----
type Task = { taskDefinitionId: string; displayName: string; isEnabled: boolean };
type Workflow = { id: string; displayName: string; category: string; isEnabled: boolean; isSchedulingEnabled: boolean; tasks: Task[] };
const removesAccount = (t: Task) => [DISABLE, DELETE].includes(t.taskDefinitionId) || /Disable user account|Delete user account/i.test(t.displayName);
function inventory(wfs: Workflow[]) {
  const workflows = wfs.map(w => ({ id: w.id, displayName: w.displayName, category: w.category, isEnabled: w.isEnabled, isSchedulingEnabled: w.isSchedulingEnabled, accountRemovalTask: w.tasks.some(removesAccount), tasks: w.tasks }));
  const q = workflows.filter(w => w.category === 'leaver' && w.isEnabled === true && w.isSchedulingEnabled === true && w.accountRemovalTask);
  return { displayName: 'CES lifecycle workflow inventory', workflowCount: workflows.length, qualifyingLeaverWorkflowCount: q.length, qualifyingLeaverWorkflowIds: q.map(w => w.id), workflows };
}

// ---- S1-shaped workflows (fictional; the simulator's s1-mach seed, LOG-W7-SIM) ----
const task = (taskDefinitionId: string, displayName: string): Task => ({ taskDefinitionId, displayName, isEnabled: true });
const S1 = (leaverScheduled: boolean): Workflow[] => [
  { id: '51510000-001f-4000-8000-000000000001', displayName: 'S1 Joiner - prepare new staff account', category: 'joiner', isEnabled: true, isSchedulingEnabled: true, tasks: [task('22046e01-3e0a-4102-a8b7-08a4b810bda5', 'Add user to groups')] },
  { id: '51510000-001f-4000-8000-000000000002', displayName: 'S1 Mover - review group access on department change', category: 'mover', isEnabled: true, isSchedulingEnabled: true, tasks: [task('1953a66c-751c-45e5-8bfe-01462c70da3c', 'Remove user from selected groups')] },
  { id: '51510000-001f-4000-8000-000000000003', displayName: 'S1 Leaver - disable account and remove access', category: 'leaver', isEnabled: true, isSchedulingEnabled: leaverScheduled,
    tasks: [task(DISABLE, 'Disable user account'), task('b3a31406-2a15-4c9a-b25b-a658fa5f07fc', 'Remove user from all groups')] },
];
// the generic tenant (gccHighG5 seed): lifecycleWorkflow-1, a scheduled leaver with the disable task
const GENERIC: Workflow[] = [
  { id: 'lifecycleWorkflow-1', displayName: 'Sim Offboard On Last Day', category: 'leaver', isEnabled: true, isSchedulingEnabled: true, tasks: [task(DISABLE, 'Disable User Account')] },
];

const engine = new OutputVerificationEngine();
const passes = (read: unknown) => engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(read, null, 4), exitCode: 0 }, byId(ID).verification).passed;

describe('W7-ST: registry entry', () => {
  it('the registry validates and keeps unique ids', () => {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    expect(CommandRegistrySchema.safeParse(raw).success).toBe(true);
    const ids = raw.entries.map((e: any) => e.entry_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(ID);
  });

  it('verify-only: credits PS.L2-3.9.2 only, never creates, asserts state', () => {
    const e = byId(ID);
    expect(e.control_ids).toEqual(['PS.L2-3.9.2']);
    expect(e.verify_only).toBe(true);
    expect(e.idempotency).toBe('safe');
    expect(e.set_command).toBe('');
    expect(e.engine).toBe('mgraph');
    expect(e.variables_required).toEqual([]);
    expect(e.variables_runtime).toEqual([]);
    expect(e.verification?.postcheck_mode).toBe('state');
    expect(e.verification?.evidence?.checks).toEqual([{ jsonpath: '$.qualifyingLeaverWorkflowCount', min: 1 }]);
    // no registry entry creates or changes a lifecycle workflow
    expect(registry.allEntries.filter(x => /lifecycleWorkflows/.test(x.set_command)).map(x => x.entry_id)).toEqual([]);
  });

  it('get_command is the GET generated from the lookup block; it reads the workflows with their tasks', () => {
    const e = byId(ID);
    expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
    expect(e.lookup!.source).toContain("Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks'");
    expect(e.lookup!.source).toContain(`@('${DISABLE}','${DELETE}') -contains $_.taskDefinitionId`);
    expect(e.lookup!.source).toContain("-match 'Disable user account|Delete user account'");
    expect(e.lookup!.source).toContain("$_.category -eq 'leaver' -and $_.isEnabled -eq $true -and $_.isSchedulingEnabled -eq $true -and $_.accountRemovalTask");
    expect(e.lookup!.by_name).toEqual({ path: '$.displayName', equals: 'CES lifecycle workflow inventory' });
    expect(e.lookup!.source).toContain("displayName = 'CES lifecycle workflow inventory'");
    expect(e.get_command).not.toMatch(/\{\w+\}/);
  });
});

describe('W7-ST: postcheck state', () => {
  it('S1/S2 before A-21 (leaver on demand): not met', () => {
    expect(inventory(S1(false)).qualifyingLeaverWorkflowCount).toBe(0);
    expect(passes(inventory(S1(false)))).toBe(false);
  });
  it('S1/S2 after A-21 (leaver scheduled): met', () => {
    expect(inventory(S1(true)).qualifyingLeaverWorkflowIds).toEqual(['51510000-001f-4000-8000-000000000003']);
    expect(passes(inventory(S1(true)))).toBe(true);
  });
  it('S3 (no workflows): not met', () => {
    expect(passes(inventory([]))).toBe(false);
  });
  it('a scheduled leaver without a disable/delete task, or a disabled one: not met', () => {
    const noTask = S1(true).map(w => w.category === 'leaver' ? { ...w, tasks: [task('b3a31406-2a15-4c9a-b25b-a658fa5f07fc', 'Remove user from all groups')] } : w);
    expect(passes(inventory(noTask))).toBe(false);
    const off = S1(true).map(w => w.category === 'leaver' ? { ...w, isEnabled: false } : w);
    expect(passes(inventory(off))).toBe(false);
  });
  it('a delete-account task by id, or by display name: met', () => {
    expect(passes(inventory([{ ...GENERIC[0], tasks: [task(DELETE, 'Delete user')] }]))).toBe(true);
    expect(passes(inventory([{ ...GENERIC[0], tasks: [task('00000000-0000-0000-0000-000000000000', 'Delete user account')] }]))).toBe(true);
  });
  it('the generic tenant (lifecycleWorkflow-1): met', () => {
    expect(passes(inventory(GENERIC))).toBe(true);
  });
});

// ---- the adapter's verify-only path ----
const config = () => StamperConfig.fromTenantConfig({
  tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
  certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
});
const asSub = (): SubCommand => {
  const e = byId(ID);
  return {
    id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine,
    sequence_hint: e.sequence_hint, idempotency: e.idempotency, variables_required: e.variables_required,
    variables_runtime: e.variables_runtime, captures: e.captures, on_failure: e.on_failure,
    evidence_commands: e.evidence_commands, verification: e.verification, lookup: e.lookup, verify_only: true,
  } as SubCommand;
};
const taskOf = (id: string, s: SubCommand): ExeTask => ({
  id, type: 'configuration', priority: 'p1', depends_on: [],
  action: { engine: s.engine, command: 'placeholder', args: { _sub_commands: [s] } },
  inputs: [], outputs: [], controls: ['PS.L2-3.9.2'], idempotency: 'safe', rollback: { strategy: 'none' },
} as ExeTask);
function fakeTenant(sub: SubCommand, read: unknown) {
  const sent: string[] = [];
  return {
    sent,
    manager: {
      execute: async (_t: string, command: string) => {
        sent.push(command);
        if (command.includes(sub.get_command)) return { stdout: JSON.stringify(read, null, 4), stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}
const recordOf = (tenant: string, taskId: string, sub: SubCommand) =>
  JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json')), 'utf-8'));

describe('W7-ST: execute (verify-only)', () => {
  it('leaver on demand: NOT_SAT, state mode, no SET, the found workflows in the record', async () => {
    const sub = asSub();
    const fake = fakeTenant(sub, inventory(S1(false)));
    const adapter = new PowerShellAdapter(config(), fake.manager as any, new ExecutionContext(false), undefined, 'w7-st-before');
    const r = await adapter.execute(taskOf('t-ps-1', sub), {}, false);
    expect(r.success).toBe(false);
    expect(fake.sent.every(x => !/-Method (PATCH|POST)/.test(x))).toBe(true);
    const rec = recordOf('w7-st-before', 't-ps-1', sub);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
    expect(rec.metadata.commandExecuted).toBe('[verify-only: SET not sent]');
    expect(rec.metadata.preStateOutput).toContain('51510000-001f-4000-8000-000000000003');
    expect(rec.metadata.preStateOutput).toContain('"isSchedulingEnabled": false');
  });

  it('leaver scheduled (after A-21): SAT, state mode, no SET', async () => {
    const sub = asSub();
    const fake = fakeTenant(sub, inventory(S1(true)));
    const adapter = new PowerShellAdapter(config(), fake.manager as any, new ExecutionContext(false), undefined, 'w7-st-after');
    const r = await adapter.execute(taskOf('t-ps-2', sub), {}, false);
    expect(r.success).toBe(true);
    expect(fake.sent.every(x => !/-Method (PATCH|POST)/.test(x))).toBe(true);
    const rec = recordOf('w7-st-after', 't-ps-2', sub);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
    expect(rec.metadata.lookupMatch).toEqual({ basis: 'name', object: 'CES lifecycle workflow inventory' });
  });

  it('no workflows (S3): NOT_SAT with the empty inventory', async () => {
    const sub = asSub();
    const adapter = new PowerShellAdapter(config(), fakeTenant(sub, inventory([])).manager as any, new ExecutionContext(false), undefined, 'w7-st-none');
    expect((await adapter.execute(taskOf('t-ps-3', sub), {}, false)).success).toBe(false);
    const rec = recordOf('w7-st-none', 't-ps-3', sub);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.metadata.preStateOutput).toContain('"workflowCount": 0');
  });
});
