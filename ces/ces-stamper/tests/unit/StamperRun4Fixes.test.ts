// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// P1.3b (run 4 follow-up): captures read `$.Id` case-insensitively so a raw-Graph `id`
// reaches later sub-commands; a task stopped by unresolved variables leaves a per-task
// record naming the producers; the report's evidence_collected counts adapter writes.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { StamperEngine } from '../../src/core/StamperEngine';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT = 'fx-unit-run4';

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}

function makeTask(id: string, subs: SubCommand[]): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on: [],
    action: { engine: 'mgraph', command: 'placeholder', args: { _sub_commands: subs } },
    inputs: [], outputs: [], controls: ['AC.L1-3.1.1'], idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

function fakeSession(answer: (command: string) => string) {
  const received: string[] = [];
  return {
    received,
    manager: {
      execute: async (_t: string, command: string) => {
        received.push(command);
        return { stdout: answer(command), stderr: '', exitCode: 0 };
      },
    },
  };
}

const operatorDiscover: SubCommand = {
  id: 'AC.L2-3.1.1.operator-discover', label: 'Discover operator', engine: 'mgraph', sequence_hint: 0,
  set_command: '', get_command: `Get-MgUser -Filter "userPrincipalName eq '{operatorUPN}'" | ConvertTo-Json`,
  idempotency: 'evidence-only', variables_required: ['operatorUPN'], variables_runtime: [],
  captures: [{ variable: 'operatorUserId', from: 'json_field', json_path: '$.Id' }],
  on_failure: 'warn_continue', evidence_commands: [],
};
const memberAdd: SubCommand = {
  id: 'AC.L2-3.1.1.member-add', label: 'Add member', engine: 'mgraph', sequence_hint: 2,
  set_command: "New-MgGroupMemberByRef -GroupId {cuiGroupId} -BodyParameter @{'@odata.id'='https://graph.microsoft.us/v1.0/directoryObjects/{operatorUserId}'}",
  get_command: "Get-MgGroupMember -GroupId {cuiGroupId} | Where-Object { $_.Id -eq '{operatorUserId}' } | ConvertTo-Json -Depth 10",
  idempotency: 'get-then-set', variables_required: [], variables_runtime: ['cuiGroupId', 'operatorUserId'],
  captures: [], on_failure: 'abort_step', evidence_commands: [],
};

describe('P1.3b captures', () => {
  it('a raw-Graph camelCase "id" is captured by $.Id and reaches the next sub-command', async () => {
    const s = fakeSession((cmd) => (cmd.startsWith('Get-MgUser') ? '{"id":"user-1","userPrincipalName":"op@example.test"}' : ''));
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables({ operatorUPN: 'op@example.test', cuiGroupId: 'group-1' });
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, ctx, undefined, TENANT);
    await adapter.execute(makeTask('task-capture', [operatorDiscover, memberAdd]), {}, false);
    expect(ctx.getAllVariables().operatorUserId).toBe('user-1');
    expect(s.received.some(c => c.includes('directoryObjects/user-1'))).toBe(true);
  });
});

describe('P1.3b stopped-task record', () => {
  it('a task stopped by an unresolved runtime variable leaves a per-task record with the names and producers', async () => {
    const s = fakeSession(() => '');
    const ctx = new ExecutionContext(false);
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, ctx, undefined, TENANT);
    adapter.setCaptureProducers({ cuiGroupId: ['AC.L2-3.1.1.group-create (task-producer)'] });
    await expect(adapter.execute(makeTask('task-stopped', [memberAdd]), {}, false))
      .rejects.toThrow('Unresolved runtime variables: cuiGroupId, operatorUserId');
    expect(s.received.some(c => c.startsWith('New-MgGroupMemberByRef') || c.startsWith('Get-MgGroupMember'))).toBe(false);

    const evidFile = evidenceFileForEntry(memberAdd.id, memberAdd.label).replace(/\.txt$/, '.json');
    const rec = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(TENANT), 'task-stopped', evidFile), 'utf-8'));
    expect(rec.outcome).toBe('failed_no_remediation');
    expect(rec.outcomeRationale).toContain('stopped before execution');
    expect(rec.outcomeRationale).toContain('cuiGroupId <- AC.L2-3.1.1.group-create (task-producer)');
    expect(rec.outcomeRationale).toContain('operatorUserId <- no producing entry in this plan');
  });
});

describe('P1.3b report evidence counter', () => {
  it('evidence_collected counts the records the adapter wrote', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p13b-report-'));
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/synthetic-mission-plan.executable.json'), 'utf-8'));
    const task = makeTask('task-report', [operatorDiscover]);
    const sub: SubCommand = {
      id: 'FX.test.report', label: 'Report counter', engine: 'mgraph', sequence_hint: 1,
      set_command: 'Set-Thing -Enabled $true', get_command: '', idempotency: 'unsafe',
      variables_required: [], variables_runtime: [], on_failure: 'warn_continue', evidence_commands: [],
    };
    task.action.args._sub_commands = [sub];
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ ...fixture, plan_id: 'p13b-report', execution_graph: [task] }));

    const s = fakeSession((cmd) => (cmd.startsWith('Set-Thing') ? 'done' : ''));
    const engine = new StamperEngine(makeConfig());
    await engine.loadPlan(path.join(dir, 'plan.json'), TENANT, s.manager as any, new ExecutionContext(false));
    const { taskRunner } = engine.getTuiDependencies() as any;
    // The config is dry-run (no cert file in a unit test), so drive the run's own adapter live.
    const result = await taskRunner.getAdapter('mgraph').execute(task, {}, false);
    expect(result.success).toBe(true);
    expect(engine.generateReport(Date.now()).evidence_collected).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
