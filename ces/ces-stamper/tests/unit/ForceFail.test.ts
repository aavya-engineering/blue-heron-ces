// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// P3 test flag `--force-fail <entryId>`: the named entry fails after its GET without its SET,
// leaves a failure record, is refused off-simulator without the companion flag, and reaches
// the execution-results manifest as NOT_SAT / failed.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { StamperEngine } from '../../src/core/StamperEngine';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { ExecutionResultsCollector } from '../../src/core/ExecutionResultsCollector';
import { recordTaskStatuses } from '../../src/core/ExecutionResultsPublisher';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { decideForceFail } from '../../src/cli/cliExecutionContext';
import { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT = 'fx-unit-force-fail';
const GET_ANSWER = '{"id":"existing-1","displayName":"CMMC-Thing"}';

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
    inputs: [], outputs: [], controls: ['AC.L2-3.1.5'], idempotency: 'safe', rollback: { strategy: 'none' },
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

// get-then-set creation entry with an existing resource: without the flag this would be an
// idempotent skip (success), so the test also proves the forced failure comes before the skip.
const target: SubCommand = {
  id: 'FX.force.target', label: 'Forced target', engine: 'mgraph', sequence_hint: 1,
  set_command: "New-MgThing -DisplayName 'CMMC-Thing'",
  get_command: "Get-MgThing -Filter \"displayName eq 'CMMC-Thing'\" | ConvertTo-Json",
  idempotency: 'get-then-set', variables_required: [], variables_runtime: [],
  captures: [], on_failure: 'warn_continue', evidence_commands: [],
};

describe('P3 --force-fail: adapter', () => {
  it('fails the task with the reason after the GET, never sends the SET, and writes a failure record', async () => {
    const s = fakeSession((cmd) => (cmd.startsWith('Get-MgThing') ? GET_ANSWER : ''));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, new ExecutionContext(false), undefined, TENANT);
    adapter.setForcedFailures([target.id]);
    const result = await adapter.execute(makeTask('task-forced', [target]), {}, false);

    expect(result.success).toBe(false);
    expect(result.error).toBe(`forced failure (test flag): ${target.id}`);
    expect(s.received.some(c => c.startsWith('Get-MgThing'))).toBe(true);
    expect(s.received.some(c => c.includes('New-MgThing'))).toBe(false);
    expect(adapter.getFiredForcedFailures()).toEqual([{ entry_id: target.id, task_id: 'task-forced' }]);

    const evidFile = evidenceFileForEntry(target.id, target.label).replace(/\.txt$/, '.json');
    const rec = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(TENANT), 'task-forced', evidFile), 'utf-8'));
    expect(rec.outcome).toBe('failed_no_remediation');
    expect(rec.outcomeRationale).toContain(`forced failure (test flag): ${target.id}`);
    expect(rec.rawResponse).toContain(`--force-fail ${target.id}`);
    expect(rec.metadata.commandExecuted).toContain('SET not sent');
    expect(rec.metadata.preStateOutput).toBe(GET_ANSWER);
  });

  it('an entry not named by the flag runs as before (idempotent skip, success)', async () => {
    const s = fakeSession((cmd) => (cmd.startsWith('Get-MgThing') ? GET_ANSWER : ''));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, new ExecutionContext(false), undefined, TENANT);
    adapter.setForcedFailures(['FX.force.other']);
    const result = await adapter.execute(makeTask('task-normal', [target]), {}, false);
    expect(result.success).toBe(true);
    expect(adapter.getFiredForcedFailures()).toEqual([]);
  });
});

describe('P3 --force-fail: refusal', () => {
  it('is refused on a non-simulator tenant without --i-know-this-is-a-test', () => {
    const d = decideForceFail({ entryIds: ['FX.force.target'], acknowledged: false, tenantSlug: 'acme', tenantKind: 'live' });
    expect(d.allowed).toBe(false);
    expect(d.message).toMatch(/^Refused: --force-fail is a test flag/);
    expect(d.message).toContain('--i-know-this-is-a-test');
  });

  it('is refused when the tenant has no registry record (dev slug)', () => {
    const d = decideForceFail({ entryIds: ['FX.force.target'], acknowledged: false, tenantSlug: undefined, tenantKind: undefined });
    expect(d.allowed).toBe(false);
    expect(d.message).toContain('no record');
  });

  it('is allowed on a kind:sim tenant, or with the companion flag', () => {
    expect(decideForceFail({ entryIds: ['X'], acknowledged: false, tenantSlug: 'sim-m365-azure', tenantKind: 'sim' }).allowed).toBe(true);
    expect(decideForceFail({ entryIds: ['X'], acknowledged: true, tenantSlug: 'acme', tenantKind: 'live' }).allowed).toBe(true);
    expect(decideForceFail({ entryIds: [], acknowledged: false, tenantSlug: 'acme', tenantKind: 'live' }).allowed).toBe(true);
  });
});

describe('P3 --force-fail: report and manifest', () => {
  it('the failed task is counted, listed in forced_failures, and its control is NOT_SAT / failed in the manifest', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-force-fail-'));
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/synthetic-mission-plan.executable.json'), 'utf-8'));
    const task = makeTask('task-forced-report', [target]);
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ ...fixture, plan_id: 'p3-force-fail', execution_graph: [task] }));

    const s = fakeSession((cmd) => (cmd.startsWith('Get-MgThing') ? GET_ANSWER : ''));
    const engine = new StamperEngine(makeConfig());
    await engine.loadPlan(path.join(dir, 'plan.json'), TENANT, s.manager as any, new ExecutionContext(false));
    engine.setForcedFailures([target.id, 'FX.force.never-runs']);
    const { taskRunner, stateManager } = engine.getTuiDependencies() as any;
    // The config is dry-run (no cert file in a unit test), so drive the run's own adapter live.
    const result = await taskRunner.getAdapter('mgraph').execute(task, {}, false);
    stateManager.startTask(task.id);
    stateManager.failTask(task.id, result.error);

    const report = engine.generateReport(Date.now());
    expect(report.summary.failed).toBe(1);
    expect(report.failed_tasks[0].error).toBe(`forced failure (test flag): ${target.id}`);
    expect(report.forced_failures).toEqual([
      { entry_id: target.id, task_ids: ['task-forced-report'] },
      { entry_id: 'FX.force.never-runs', task_ids: [] },
    ]);
    expect(report.recommendations.some(r => r.includes('FX.force.never-runs did not fire'))).toBe(true);

    const collector = new ExecutionResultsCollector();
    recordTaskStatuses(collector, [task], (id) => stateManager.getTaskState(id)?.status);
    const manifest = collector.buildManifestForPlan('run-1', TENANT, { plan_id: 'p3-force-fail' });
    const entry = manifest.results.find(r => r.controlId === 'AC.L2-3.1.5');
    expect(entry?.verdict).toBe('not_sat');
    expect(entry?.outcome).toBe('failed');
  });
});
