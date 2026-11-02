// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 3: a failed SET, GET or verification record keeps what the command
// returned (exit code, stdout / stderr tails, HTTP status and body for a Graph error) in
// failureDiagnostics, and its outcomeRationale names the cause. Run 46's AC.L2-3.1.4.pim-approval
// record said only "Command exited with non-zero code" although the session had a 400.
import * as fs from 'fs';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { secretSentinel } from '../../src/core/secretSentinel';
import {
  buildFailureDiagnostics, buildStructuredEvidence, DIAGNOSTIC_TAIL_CHARS, failureCause, parseHttpError,
} from '../../src/utils/structuredEvidence';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const TENANT = 'fx-unit-w5c3-diagnostics';
const SECRET = 'Real-Secret-Value!';

// The simulator shim's form: Invoke-RestMethod's message plus the resolver's detail (W5c2 sim log).
const SIM_400 = [
  'Update-MgPolicyRoleManagementPolicyRule : The remote server returned an error: (400) Bad Request. Update-MgPolicyRoleManagementPolicyRule: -UnifiedRoleManagementPolicyId is required (got no id)',
  'At line:1 char:412',
  '+ ... ; Update-MgPolicyRoleManagementPolicyRule -UnifiedRoleManagementPolicyId $pimPolicyId ...',
  '    + CategoryInfo          : NotSpecified: (:) [Write-Error], WriteErrorException',
].join('\n');
// Graph's own form: a raw HTTP status line and the JSON error body.
const GRAPH_400 = [
  'Invoke-MgGraphRequest : PATCH https://graph.microsoft.us/v1.0/policies/roleManagementPolicies//rules/Approval_EndUser_Assignment',
  'HTTP/1.1 400 Bad Request',
  'Content-Type: application/json',
  '{"error":{"code":"BadRequest","message":"policy id is required","innerError":{"request-id":"r-1"}}}',
].join('\n');

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
    inputs: [], outputs: [], controls: ['AC.L2-3.1.4'], idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

type Answer = { stdout: string; stderr: string; exitCode: number } | Error;
function fakeRunner(answer: (command: string) => Answer) {
  const received: string[] = [];
  return {
    received,
    manager: {
      execute: async (_t: string, command: string) => {
        received.push(command);
        const a = answer(command);
        if (a instanceof Error) throw a;
        return a;
      },
    },
  };
}

const sub = (id: string): SubCommand => ({
  id, label: `W5c3 ${id}`, engine: 'mgraph', sequence_hint: 1,
  set_command: "Update-MgThing -ThingId 'x' -BodyParameter @{a=1}",
  get_command: "Get-MgThing -ThingId 'x' | ConvertTo-Json",
  idempotency: 'get-then-set', variables_required: [], variables_runtime: [],
  captures: [], on_failure: 'warn_continue', evidence_commands: [],
});

const readRecord = (taskId: string, s: SubCommand) => {
  const evidFile = evidenceFileForEntry(s.id, s.label).replace(/\.txt$/, '.json');
  return JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(TENANT), taskId, evidFile), 'utf-8'));
};

const runOne = async (taskId: string, s: SubCommand, setAnswer: Answer, overlay?: Record<string, string>) => {
  const r = fakeRunner((cmd) => (cmd.startsWith('Get-MgThing') ? { stdout: '{"a":0}', stderr: '', exitCode: 0 } : setAnswer));
  const adapter = new PowerShellAdapter(makeConfig(), r.manager as any, new ExecutionContext(false), undefined, TENANT);
  if (overlay) adapter.setSecretOverlay(overlay);
  const result = await adapter.execute(makeTask(taskId, [s]), {}, false);
  return { result, record: readRecord(taskId, s), received: r.received };
};

describe('W5c3 failure diagnostics: parsing', () => {
  it('the simulator 400: status 400, body = the resolver detail', () => {
    const http = parseHttpError(SIM_400);
    expect(http.httpStatus).toBe(400);
    expect(http.message).toBe('Update-MgPolicyRoleManagementPolicyRule: -UnifiedRoleManagementPolicyId is required (got no id)');
    expect(http.responseBody).toContain('-UnifiedRoleManagementPolicyId is required (got no id)');
  });

  it('a Graph 400 with a JSON body: status 400, body = the JSON, message = code: message', () => {
    const http = parseHttpError(GRAPH_400);
    expect(http.httpStatus).toBe(400);
    expect(JSON.parse(http.responseBody!)).toEqual({ error: { code: 'BadRequest', message: 'policy id is required', innerError: { 'request-id': 'r-1' } } });
    expect(http.message).toBe('BadRequest: policy id is required');
  });

  it('the Graph SDK cmdlet form ("Status: 404 (NotFound)")', () => {
    const http = parseHttpError('Get-MgPolicyRoleManagementPolicyRule_Get: Rule not found\n\nStatus: 404 (NotFound)\nErrorCode: NotFound');
    expect(http.httpStatus).toBe(404);
  });

  it('plain stderr: no HTTP fields; the cause is the first stderr line', () => {
    expect(parseHttpError('Set-Thing : Something broke here\nAt line:1 char:1')).toEqual({});
    const d = buildFailureDiagnostics(1, 'Set-Thing : Something broke here\nAt line:1 char:1', 'partial');
    expect(d).toMatchObject({ exitCode: 1, stderrTail: 'Set-Thing : Something broke here\nAt line:1 char:1', stdoutTail: 'partial' });
    expect(d.httpStatus).toBeUndefined();
    expect(failureCause(d)).toBe('Set-Thing : Something broke here');
  });

  it('tails are bounded to the last 4 KB', () => {
    const long = 'x'.repeat(10000) + 'THE-END';
    const d = buildFailureDiagnostics(1, long, long);
    expect(DIAGNOSTIC_TAIL_CHARS).toBe(4096);
    expect(d.stderrTail).toHaveLength(4096);
    expect(d.stderrTail!.endsWith('THE-END')).toBe(true);
    expect(d.stdoutTail).toHaveLength(4096);
  });

  it('buildStructuredEvidence (every caller, incl. the routes): a failed outcome carries the diagnostics and the cause', () => {
    const task = makeTask('t-build', []);
    const ev = buildStructuredEvidence('', 1, GRAPH_400, null, sub('W5C3.build'), task, {});
    expect(ev.outcome.startsWith('failed_')).toBe(true);
    expect(ev.failureDiagnostics).toMatchObject({ exitCode: 1, httpStatus: 400, stdoutTail: '' });
    expect(ev.failureDiagnostics!.stderrTail).toContain('policy id is required');
    expect(ev.outcomeRationale).toContain('cause: HTTP 400: BadRequest: policy id is required');
  });
});

describe('W5c3 failure diagnostics: the adapter record (fake runner)', () => {
  it('SET exit 1 + stderr: exitCode, both tails and the first stderr line in the rationale; the secret is redacted', async () => {
    const s = sub('W5C3.exit1');
    const { result, record } = await runOne('task-w5c3-exit1', s,
      { stdout: 'partial output', stderr: `Set-Thing : Something broke here (password ${SECRET})\nAt line:1 char:1`, exitCode: 1 },
      { initialPassword: SECRET });
    expect(result.success).toBe(false);
    expect(record.outcome).toBe('failed_no_remediation');
    expect(record.failureDiagnostics).toMatchObject({ exitCode: 1, stdoutTail: 'partial output' });
    expect(record.failureDiagnostics.stderrTail).toContain('Something broke here');
    expect(record.failureDiagnostics.stderrTail).toContain(secretSentinel('initialPassword'));
    expect(JSON.stringify(record)).not.toContain(SECRET);
    expect(record.failureDiagnostics.httpStatus).toBeUndefined();
    expect(record.outcomeRationale).toMatch(/^SET\/verification failed: /);
    expect(record.outcomeRationale).toContain(`cause: Set-Thing : Something broke here (password ${secretSentinel('initialPassword')})`);
    expect(result.error).toContain('cause: Set-Thing : Something broke here');
  });

  it('SET exit 1 with the simulator 400 (run 46 pim-approval shape): HTTP 400 and the detail name the cause', async () => {
    const s = sub('W5C3.sim400');
    const { record } = await runOne('task-w5c3-sim400', s, { stdout: '', stderr: SIM_400, exitCode: 1 });
    expect(record.failureDiagnostics).toMatchObject({ exitCode: 1, httpStatus: 400, stdoutTail: '' });
    expect(record.failureDiagnostics.responseBody).toContain('-UnifiedRoleManagementPolicyId is required (got no id)');
    expect(record.failureDiagnostics.stderrTail).toBe(SIM_400);
    expect(record.outcomeRationale).toContain('cause: HTTP 400: Update-MgPolicyRoleManagementPolicyRule: -UnifiedRoleManagementPolicyId is required (got no id)');
  });

  it('SET exit 1 with a Graph 400 JSON body: status 400 and the body on the record', async () => {
    const s = sub('W5C3.graph400');
    const { record } = await runOne('task-w5c3-graph400', s, { stdout: '', stderr: GRAPH_400, exitCode: 1 });
    expect(record.failureDiagnostics.httpStatus).toBe(400);
    expect(JSON.parse(record.failureDiagnostics.responseBody).error.message).toBe('policy id is required');
    expect(record.outcomeRationale).toContain('cause: HTTP 400: BadRequest: policy id is required');
  });

  it('SET exit 0 but the post-SET GET fails: the diagnostics are the GET\'s', async () => {
    const s: SubCommand = { ...sub('W5C3.getfail'), verification: { evidence: { jsonpath: '$.a', equals: '1' } } };
    let gets = 0;
    const r = fakeRunner((cmd) => {
      if (!cmd.startsWith('Get-MgThing')) return { stdout: 'ok', stderr: '', exitCode: 0 };
      gets += 1;
      return gets === 1
        ? { stdout: '{"a":0}', stderr: '', exitCode: 0 }
        : { stdout: '{"a":0}', stderr: 'Get-MgThing : The remote server returned an error: (403) Forbidden. Authorization_RequestDenied', exitCode: 1 };
    });
    const adapter = new PowerShellAdapter(makeConfig(), r.manager as any, new ExecutionContext(false), undefined, TENANT);
    await adapter.execute(makeTask('task-w5c3-getfail', [s]), {}, false);
    const record = readRecord('task-w5c3-getfail', s);
    expect(record.failureDiagnostics).toMatchObject({ exitCode: 1, httpStatus: 403 });
    expect(record.outcomeRationale).toContain('cause: HTTP 403: Authorization_RequestDenied');
  }, 20000); // the failed read is retried once after 5 s

  it('a SET that throws leaves a failure record with the error text', async () => {
    const s = sub('W5C3.threw');
    const { record } = await runOne('task-w5c3-threw', s, new Error('Session host crashed: pipe closed'));
    expect(record.outcome).toBe('failed_no_remediation');
    expect(record.failureDiagnostics.stderrTail).toBe('Session host crashed: pipe closed');
    expect(record.outcomeRationale).toContain('Session host crashed: pipe closed');
  });
});
