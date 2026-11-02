// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W1: the command line resolves an unresolved `initialPassword` from STAMPER_INITIAL_PASSWORD.
// The value reaches the engine boundary (the fake session) and nothing Stamper writes: evidence,
// state, report, results manifest, logs. Without the variable the task still stops with
// "Unresolved manifest variables: initialPassword".
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { SECRET_VARIABLE_NAMES } from 'ces-shared/types/mission-plan';
import { StamperConfig } from '../../src/config/StamperConfig';
import { StamperEngine } from '../../src/core/StamperEngine';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { ExecutionResultsCollector } from '../../src/core/ExecutionResultsCollector';
import { recordTaskStatuses } from '../../src/core/ExecutionResultsPublisher';
import { ExecutionReporter } from '../../src/reporting/ExecutionReporter';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { ENV_SECRET_VARIABLES, resolveEnvSecrets, applyCliEnvSecrets, loadPlanVariablesIntoContext } from '../../src/cli/cliExecutionContext';
import { secretSentinel } from '../../src/core/secretSentinel';
import { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-env-pw-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

const TEST_PW = `UnitTest-Pw-${Math.random().toString(36).slice(2, 10)}-Zq9`;
const SENTINEL = secretSentinel('initialPassword');

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}

// The registry's admin-account entry, as translation emits it.
const adminAccount: SubCommand = {
  id: 'AC.L2-3.1.6.admin-account', label: 'Create Dedicated Admin Account', engine: 'mgraph', sequence_hint: 2,
  set_command: "New-MgUser -DisplayName \"Admin-{adminUserName}\" -UserPrincipalName \"admin-{adminUserName}@{tenantName}\" -PasswordProfile @{Password='{initialPassword}';ForceChangePasswordNextSignIn=$true} -AccountEnabled:$true",
  get_command: "Get-MgUser -Filter \"startsWith(displayName, 'Admin-')\" | Select-Object -First 1 | ConvertTo-Json",
  idempotency: 'get-then-set', variables_required: ['adminUserName', 'tenantName', 'initialPassword'], variables_runtime: [],
  captures: [], on_failure: 'abort_step',
  evidence_commands: ["Get-MgUser -Filter \"startsWith(displayName, 'Admin-')\" | Select-Object -First 1 | Select-Object Id,DisplayName | ConvertTo-Json -Depth 10"],
};

function makeTask(id: string): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on: [],
    action: { engine: 'mgraph', command: 'placeholder', args: { _sub_commands: [adminAccount] } },
    inputs: [], outputs: [], controls: ['AC.L2-3.1.6'], idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

/** A simulator double: no admin user yet; the SET echoes its command (as an error would) on stdout and stderr. */
function fakeSession(setExitCode: number) {
  const received: string[] = [];
  let created = false;
  return {
    received,
    manager: {
      execute: async (_t: string, command: string, onStdout?: (c: string) => void) => {
        received.push(command);
        if (command.startsWith('New-MgUser')) {
          created = setExitCode === 0;
          onStdout?.(`echo: ${command}`);
          return { stdout: `echo: ${command}`, stderr: setExitCode === 0 ? '' : `New-MgUser : failed for ${command}`, exitCode: setExitCode };
        }
        if (command.startsWith('Get-MgUser')) {
          return { stdout: created ? '{"Id":"admin-1","DisplayName":"Admin-ops"}' : '', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

function filesContaining(root: string, needle: string): string[] {
  const bytes = Buffer.from(needle, 'utf8');
  return walk(root).filter(f => fs.readFileSync(f).includes(bytes));
}

async function runAdminAccount(opts: { tenant: string; planId: string; env: Record<string, string | undefined>; setExitCode?: number }) {
  const dir = path.join(tmpRoot, opts.planId);
  fs.mkdirSync(dir, { recursive: true });
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/synthetic-mission-plan.executable.json'), 'utf-8'));
  const task = makeTask(`task-${opts.planId}`);
  const variables = { ...fixture.variables, adminUserName: 'ops', tenantName: 'simtenant.onmicrosoft.us' };
  delete variables.initialPassword;
  const planPath = path.join(dir, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify({ ...fixture, plan_id: opts.planId, variables, execution_graph: [task] }));

  const logged: string[] = [];
  const methods = ['log', 'warn', 'error', 'info'] as const;
  const original = methods.map(m => console[m]);
  for (const m of methods) console[m] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    const s = fakeSession(opts.setExitCode ?? 0);
    const ctx = new ExecutionContext(false);
    const engine = new StamperEngine(makeConfig());
    await engine.loadPlan(planPath, opts.tenant, s.manager as any, ctx);
    const plan = engine.getPlan()!;
    loadPlanVariablesIntoContext(ctx, plan.variables);
    const supplied = applyCliEnvSecrets(engine, ctx, plan.variables, opts.env);

    const { taskRunner, stateManager } = engine.getTuiDependencies() as any;
    // The adapter throws on an unresolved manifest variable; TaskRunner turns that into the task's error.
    const result = await taskRunner.getAdapter('mgraph').execute(task, plan.variables, false)
      .catch((err: Error) => ({ success: false, error: err.message }));
    stateManager.startTask(task.id);
    if (result.success) stateManager.completeTask(task.id, result.outputs ?? {});
    else stateManager.failTask(task.id, result.error);

    const report = engine.generateReport(Date.now());
    new ExecutionReporter(makeConfig()).saveReport(report, path.join(dir, 'reports'));
    const collector = new ExecutionResultsCollector();
    recordTaskStatuses(collector, [task], (id) => stateManager.getTaskState(id)?.status);
    const manifest = collector.buildManifestForPlan('run-1', opts.tenant, { plan_id: opts.planId });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));

    const evidFile = evidenceFileForEntry(adminAccount.id, adminAccount.label).replace(/\.txt$/, '.json');
    const recPath = taskEvidencePath(evidenceDirForTenant(opts.tenant), task.id, evidFile);
    const record = fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, 'utf-8')) : undefined;
    return { result, report, record, supplied, received: s.received, logged, ctx };
  } finally {
    methods.forEach((m, i) => { console[m] = original[i]; });
  }
}

describe('W1 env secrets: resolution rule', () => {
  it('the allow-list is initialPassword -> STAMPER_INITIAL_PASSWORD, inside ces-shared SECRET_VARIABLE_NAMES', () => {
    expect(ENV_SECRET_VARIABLES).toEqual({ initialPassword: 'STAMPER_INITIAL_PASSWORD' });
    for (const name of Object.keys(ENV_SECRET_VARIABLES)) {
      expect((SECRET_VARIABLE_NAMES as readonly string[]).includes(name)).toBe(true);
    }
  });

  it('unresolved (absent, empty or a sentinel) + env set: sentinel for the context, value for the overlay', () => {
    for (const planVars of [{}, { initialPassword: '' }, { initialPassword: SENTINEL }]) {
      const r = resolveEnvSecrets(planVars, { STAMPER_INITIAL_PASSWORD: TEST_PW });
      expect(r.contextVars).toEqual({ initialPassword: SENTINEL });
      expect(r.overlay).toEqual({ initialPassword: TEST_PW });
    }
  });

  it('a plan value wins; no or empty env gives nothing (no default); other names are never read', () => {
    expect(resolveEnvSecrets({ initialPassword: 'from-plan' }, { STAMPER_INITIAL_PASSWORD: TEST_PW }).overlay).toEqual({});
    expect(resolveEnvSecrets({}, {}).overlay).toEqual({});
    expect(resolveEnvSecrets({}, { STAMPER_INITIAL_PASSWORD: '' }).overlay).toEqual({});
    const other = resolveEnvSecrets({}, { STAMPER_APPROVERUPN: 'x', approverUPN: 'x', STAMPER_INITIAL_PASSWORD: undefined });
    expect(other).toEqual({ contextVars: {}, overlay: {} });
  });
});

describe('W1 env secrets: execute against the simulator double', () => {
  it('resolves initialPassword from the env; the value reaches the engine boundary and no artifact', async () => {
    const r = await runAdminAccount({ tenant: 'w1-env-pw-ok', planId: 'w1-env-pw-ok', env: { STAMPER_INITIAL_PASSWORD: TEST_PW } });
    expect(r.supplied).toEqual(['initialPassword']);
    expect(r.result.success).toBe(true);
    // The real value is sent at the boundary, and only there.
    const set = r.received.find(c => c.startsWith('New-MgUser'));
    expect(set).toContain(`Password='${TEST_PW}'`);
    // The evidence record: sentinel where the echo was, provenance and no value.
    expect(r.record).toBeDefined();
    expect(r.record.metadata.secretProvenance).toEqual({ initialPassword: 'environment' });
    expect(JSON.stringify(r.record)).not.toContain(TEST_PW);
    // Every file Stamper wrote under the pipeline root, the report, and the console.
    expect(filesContaining(tmpRoot, TEST_PW)).toEqual([]);
    // The sweep is not vacuous: evidence and the state database live under the swept root.
    expect(path.resolve(evidenceDirForTenant('w1-env-pw-ok')).startsWith(path.resolve(tmpRoot))).toBe(true);
    expect(walk(evidenceDirForTenant('w1-env-pw-ok')).length).toBeGreaterThan(0);
    expect(walk(tmpRoot).some(f => path.basename(f) === 'ces.db')).toBe(true);
    expect(JSON.stringify(r.report)).not.toContain(TEST_PW);
    expect(JSON.stringify(r.result)).not.toContain(TEST_PW);
    expect(r.logged.join('\n')).not.toContain(TEST_PW);
    expect(r.ctx.resolve('{initialPassword}', ['initialPassword'], [])).toBe(SENTINEL);
  });

  it('a failing SET that echoes the command into stderr leaves no value in the failure record', async () => {
    const r = await runAdminAccount({ tenant: 'w1-env-pw-fail', planId: 'w1-env-pw-fail', env: { STAMPER_INITIAL_PASSWORD: TEST_PW }, setExitCode: 1 });
    expect(r.result.success).toBe(false);
    expect(r.received.some(c => c.includes(TEST_PW))).toBe(true);
    expect(r.record).toBeDefined();
    expect(r.record.metadata.secretProvenance).toEqual({ initialPassword: 'environment' });
    expect(JSON.stringify(r.record)).toContain(SENTINEL);
    expect(filesContaining(tmpRoot, TEST_PW)).toEqual([]);
    expect(JSON.stringify(r.report)).not.toContain(TEST_PW);
    expect(JSON.stringify(r.result)).not.toContain(TEST_PW);
    expect(r.logged.join('\n')).not.toContain(TEST_PW);
  });

  it('without STAMPER_INITIAL_PASSWORD the task still stops with "Unresolved manifest variables: initialPassword"', async () => {
    const r = await runAdminAccount({ tenant: 'w1-env-pw-none', planId: 'w1-env-pw-none', env: {} });
    expect(r.supplied).toEqual([]);
    expect(r.result.success).toBe(false);
    expect(String(r.result.error)).toContain('Unresolved manifest variables: initialPassword');
    expect(r.received.some(c => c.startsWith('New-MgUser'))).toBe(false);
  });
});

afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ces.db handle on Windows */ }
});
