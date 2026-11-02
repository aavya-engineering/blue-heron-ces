// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-01 / FX-04 / FX-05 (stamper fix directions 2026-10-24): leftover placeholders are never
// sent, a destructive preview that would disable everyone (or > 50%) is refused, verification
// `equals` values are resolved, and failure evidence is kept per task with what verification saw.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { findUnresolvedTokens, evaluateDestructivePreview } from '../../src/core/CommandGuards';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { ExeTask, SubCommand } from '../../src/types/schema.types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const TENANT = 'fx-unit-guards';

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant',
    appId: 'test-app',
    certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert',
    targetTenantDomain: 'test.onmicrosoft.us',
    clientName: 'Test Client',
  });
}

function makeTask(id: string, subs: SubCommand[], controls: string[] = []): ExeTask {
  return {
    id,
    type: 'configuration',
    priority: 'p1',
    depends_on: [],
    action: { engine: 'powershell', command: 'placeholder', args: { _sub_commands: subs } },
    inputs: [],
    outputs: [],
    controls,
    idempotency: 'safe',
    rollback: { strategy: 'none' },
  } as ExeTask;
}

/** Fake session: records every command it receives and answers by a matcher list. */
function fakeSession(answer: (command: string) => { stdout: string; stderr?: string; exitCode?: number }) {
  const received: string[] = [];
  return {
    received,
    manager: {
      execute: async (_sessionType: string, command: string) => {
        received.push(command);
        const a = answer(command);
        return { stdout: a.stdout, stderr: a.stderr ?? '', exitCode: a.exitCode ?? 0 };
      },
    },
  };
}

function registrySub(entryId: string): SubCommand {
  const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  const e = reg.entries.find((x: any) => x.entry_id === entryId);
  return {
    id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command,
    engine: e.engine, sequence_hint: e.sequence_hint, idempotency: e.idempotency,
    variables_required: e.variables_required, variables_runtime: e.variables_runtime,
    captures: e.captures, on_failure: e.on_failure, evidence_commands: e.evidence_commands,
    verification: e.verification, destructive: e.destructive, destructive_guard: e.destructive_guard,
  };
}

describe('FX-01 leftover-token check', () => {
  it('finds unfilled {name} tokens but leaves script blocks, hashtables and format strings alone', () => {
    expect(findUnresolvedTokens("Where-Object { $_.UserPrincipalName -ne '{operatorUPN}' }")).toEqual(['operatorUPN']);
    expect(findUnresolvedTokens("@{displayName='x'} | Where-Object { $_.Id } ; '{0}' -f 1; @{n='a';e={$_.b}}")).toEqual([]);
  });

  it('a SET that still carries {operatorUPN} is never sent to the session', async () => {
    const s = fakeSession(() => ({ stdout: '' }));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, TENANT);
    const sub: SubCommand = {
      id: 'FX.test.leftover', label: 'Leftover token', engine: 'mgraph', sequence_hint: 1,
      set_command: "Get-MgUser -All | Where-Object { $_.UserPrincipalName -ne '{operatorUPN}' } | ForEach-Object { Update-MgUser -UserId $_.Id -AccountEnabled:$false }",
      get_command: '', idempotency: 'unsafe', variables_required: [], variables_runtime: [],
      on_failure: 'abort_step', evidence_commands: [],
    };
    const result = await adapter.execute(makeTask('task-leftover', [sub]), {}, false);

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked: unresolved variable operatorUPN');
    expect(s.received.some(c => c.includes('Update-MgUser'))).toBe(false);
    expect(s.received.some(c => c.includes('{operatorUPN}'))).toBe(false);
  });

  it('executeViaSession refuses any command with a leftover token (GET and evidence commands too)', async () => {
    const s = fakeSession(() => ({ stdout: 'x' }));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any);
    await expect((adapter as any).executeViaSession('mgraph', 'Get-MgGroupMember -GroupId {cuiGroupId}', false))
      .rejects.toThrow('blocked: unresolved variable cuiGroupId');
    expect(s.received).toHaveLength(0);
  });
});

describe('FX-01 destructive preview', () => {
  it('evaluateDestructivePreview refuses all, more than the share, and unreadable output', () => {
    expect(evaluateDestructivePreview('{"populationCount":5,"targets":[1,2,3,4,5]}', 0.5).refused).toBe(true);
    expect(evaluateDestructivePreview('{"populationCount":5,"targets":[1,2,3]}', 0.5).refused).toBe(true);
    expect(evaluateDestructivePreview('not json', 0.5).refused).toBe(true);
    const ok = evaluateDestructivePreview('{"populationCount":5,"targets":{"UserPrincipalName":"a"}}', 0.5);
    expect(ok.refused).toBe(false);
    expect(ok.targets).toHaveLength(1);
  });

  const vars = { operatorUPN: 'operator@example.test', breakGlassUPN: 'breakglass@example.test' };
  const fiveTargets = JSON.stringify({
    populationCount: 5,
    targets: [1, 2, 3, 4, 5].map(i => ({ Id: `id-${i}`, UserPrincipalName: `user${i}@example.test` })),
  });

  function sessionFor(preview: string, exclusionStdout = '{"Id":"x","UserPrincipalName":"u","AccountEnabled":true}') {
    return fakeSession((cmd) => {
      if (cmd.startsWith('Get-Module')) return { stdout: '' };
      if (cmd.startsWith('Get-MgUser -UserId')) return { stdout: exclusionStdout };
      if (cmd.includes('populationCount')) return { stdout: preview };
      if (cmd.includes('staleNonExcludedEnabledCount')) {
        return { stdout: '{"enabledCount":5,"staleNonExcludedEnabledCount":0,"exclusionsEnabled":true}' };
      }
      return { stdout: '' };
    });
  }

  it('the registry entry is refused when the preview would disable every enabled user — no Update-MgUser is sent', async () => {
    const s = sessionFor(fiveTargets);
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables(vars);
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, ctx, undefined, TENANT);
    const sub = registrySub('IA.L2-3.5.5.disable-inactive');
    const result = await adapter.execute(makeTask('task-disable-all', [sub], ['IA.L2-3.5.6']), vars, false);

    expect(result.success).toBe(false);
    expect(result.error).toContain('would change all 5');
    expect(s.received.some(c => c.includes('Update-MgUser'))).toBe(false);

    // FX-05: refusal is recorded per task, with the preview, under the tenant folder.
    const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
    const perTask = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(TENANT), 'task-disable-all', evidFile), 'utf-8'));
    expect(perTask.outcome).toBe('failed_no_remediation');
    expect(perTask.destructivePreview.refused).toBe(true);
    expect(perTask.destructivePreview.targets).toHaveLength(5);
    expect(fs.existsSync(path.join(evidenceDirForTenant(TENANT), evidFile))).toBe(true);
  });

  it('is refused when the preview would disable more than half of the enabled users', async () => {
    const s = sessionFor(JSON.stringify({ populationCount: 5, targets: [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }] }));
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables(vars);
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, ctx, undefined, TENANT);
    const result = await adapter.execute(makeTask('task-disable-most', [registrySub('IA.L2-3.5.5.disable-inactive')]), vars, false);
    expect(result.success).toBe(false);
    expect(result.error).toContain('more than 50%');
    expect(s.received.some(c => c.includes('Update-MgUser'))).toBe(false);
  });

  it('is refused when an exclusion does not resolve to an existing account', async () => {
    const s = sessionFor(JSON.stringify({ populationCount: 5, targets: [] }), '');
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables(vars);
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, ctx, undefined, TENANT);
    const result = await adapter.execute(makeTask('task-disable-noexcl', [registrySub('IA.L2-3.5.5.disable-inactive')]), vars, false);
    expect(result.success).toBe(false);
    expect(result.error).toContain('exclusion does not resolve');
    expect(s.received.some(c => c.includes('Update-MgUser'))).toBe(false);
  });

  it('runs the SET when the preview is within bounds, and verification passes on the JSON summary', async () => {
    const s = sessionFor(JSON.stringify({ populationCount: 5, targets: [{ Id: 'a', UserPrincipalName: 'stale@example.test' }] }));
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables(vars);
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, ctx, undefined, TENANT);
    const result = await adapter.execute(makeTask('task-disable-ok', [registrySub('IA.L2-3.5.5.disable-inactive')]), vars, false);
    expect(s.received.filter(c => c.includes('Update-MgUser'))).toHaveLength(1);
    expect(s.received.find(c => c.includes('Update-MgUser'))).toContain("'operator@example.test'");
    expect(result.success).toBe(true);
  });
});

describe('FX-04 verification placeholders are resolved', () => {
  it('equals: "{operatorUserId}" is compared to the resolved id', async () => {
    const s = fakeSession((cmd) => {
      if (cmd.startsWith('Get-Module')) return { stdout: '' };
      if (cmd.startsWith('Get-MgGroupMember')) return { stdout: '{"Id":"user-guid-1"}' };
      return { stdout: '' };
    });
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables({ operatorUserId: 'user-guid-1', cuiGroupId: 'group-guid-1' });
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, ctx, undefined, TENANT);
    const sub: SubCommand = {
      id: 'FX.test.member-add', label: 'Member add', engine: 'mgraph', sequence_hint: 1,
      set_command: "New-MgGroupMember -GroupId {cuiGroupId} -DirectoryObjectId '{operatorUserId}'",
      get_command: "Get-MgGroupMember -GroupId {cuiGroupId} | ConvertTo-Json -Depth 10",
      idempotency: 'unsafe', variables_required: ['operatorUserId', 'cuiGroupId'], variables_runtime: [],
      on_failure: 'warn_continue', evidence_commands: [],
      verification: { evidence: { jsonpath: '$.Id', equals: '{operatorUserId}' } },
    };
    const result = await adapter.execute(makeTask('task-member-add', [sub]), {}, false);
    expect(result.success).toBe(true);
  });

  it('an unresolvable verification value blocks the sub-command before the SET is sent', async () => {
    const s = fakeSession(() => ({ stdout: '' }));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, TENANT);
    const sub: SubCommand = {
      id: 'FX.test.verify-token', label: 'Verify token', engine: 'mgraph', sequence_hint: 1,
      set_command: "New-MgGroupMember -GroupId 'g' -DirectoryObjectId 'u'",
      get_command: '', idempotency: 'unsafe', variables_required: [], variables_runtime: [],
      on_failure: 'warn_continue', evidence_commands: [],
      verification: { evidence: { jsonpath: '$.Id', equals: '{operatorUserId}' } },
    };
    const result = await adapter.execute(makeTask('task-verify-token', [sub]), {}, false);
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked: unresolved variable operatorUserId');
    expect(s.received.some(c => c.startsWith('New-MgGroupMember'))).toBe(false);
  });
});

describe('FX-05 failure records', () => {
  it('store the SET output, the post-SET GET output, the verification and the reason, per task', async () => {
    const s = fakeSession((cmd) => {
      if (cmd.startsWith('Get-Module')) return { stdout: '' };
      if (cmd.startsWith('Set-Thing')) return { stdout: 'set-ran' };
      if (cmd.startsWith('Get-Thing')) return { stdout: '{"Enabled":false}' };
      return { stdout: '' };
    });
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, TENANT);
    const sub: SubCommand = {
      id: 'FX.test.fail-record', label: 'Fail record', engine: 'exchange', sequence_hint: 1,
      set_command: 'Set-Thing -Enabled $true', get_command: 'Get-Thing | ConvertTo-Json -Depth 10',
      idempotency: 'get-then-set', variables_required: [], variables_runtime: [],
      on_failure: 'warn_continue', evidence_commands: [],
      verification: { evidence: { jsonpath: '$.Enabled', equals: 'True' } },
    };
    const result = await adapter.execute(makeTask('task-fail-record', [sub]), {}, false);
    expect(result.success).toBe(false);

    const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
    const rec = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(TENANT), 'task-fail-record', evidFile), 'utf-8'));
    expect(rec.rawResponse).toBe('set-ran');
    expect(rec.metadata.postStateOutput).toBe('{"Enabled":false}');
    expect(rec.verificationResult.passed).toBe(false);
    expect(rec.outcomeRationale).toContain('verification failed');
  });
});
