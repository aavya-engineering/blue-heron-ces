// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-11 (founder Q3, 2026-11-01): a successful read with empty output is not honest evidence that a
// prohibited capability is absent. Read-only document-prohibition tasks, on both paths:
//   (1) the shared judgement (judgeProhibitionRead);
//   (2) the CLI evidence-only route (PowerShellAdapter) -> task output, evidence record;
//   (3) the CLI manifest rows (recordTaskStatuses), which equal the GUI branch's row;
//   (4) CLI = GUI: the GUI judges the discovery read with the same helper, so both agree on each read shape.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PowerShellAdapter, judgeProhibitionRead, prohibitionTakesTaskPath, PROHIBITION_EMPTY_READ_REASON,
} from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionResultsCollector, ResultVerdict } from '../../src/core/ExecutionResultsCollector';
import { recordTaskStatuses } from '../../src/core/ExecutionResultsPublisher';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { PostcheckRunner } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues } from '../../src/translators/objectiveCredit';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-ph11-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}

// The shape PlanTranslator.buildProvisionalTask gives a read-only prohibition sub-command (MP.L2-3.8.5.media-access).
const mediaRead: SubCommand = {
  id: 'MP.L2-3.8.5.media-access', label: 'Prohibition: CUI Media Access Control',
  set_command: '', get_command: "(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations').value",
  engine: 'mgraph', sequence_hint: 0, idempotency: 'safe', variables_required: [], variables_runtime: [],
  captures: [], on_failure: 'warn_continue',
  evidence_commands: ["Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations' | ConvertTo-Json -Depth 5"],
} as SubCommand;

function prohibitionTask(id: string, subs: SubCommand[], controls: string[]): ExeTask {
  return {
    id, type: 'evidence_collection', priority: 'p3', depends_on: [],
    action: { engine: 'mgraph', command: subs[0].get_command, args: { _directive: 'document-prohibition', _sub_commands: subs } },
    inputs: [], outputs: [], controls, idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

/** A session that answers every command with `answer` (exit code `exitCode`). */
function session(answer: string, exitCode = 0) {
  const received: string[] = [];
  return { received, manager: { execute: async (_t: string, command: string) => { received.push(command); return { stdout: answer, stderr: '', exitCode }; } } };
}

function record(tenant: string, taskId: string, sub: SubCommand): any {
  const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
  return JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidFile), 'utf-8'));
}

const EMPTY_READS = ['', '  ', 'null', '[]', '{}', '{"value": []}', '{\r\n    "value":  [\r\n\r\n              ]\r\n}\r\n', '{"@odata.context":"x","value":[]}'];
const SHOWN_READS = ['false', '"disabled"', '{"state":"disabled"}', '{"value":[{"displayName":"CMMC-Removable-Media-Policy","removableStorageBlocked":true}]}'];

describe('PH-11 (1): judgeProhibitionRead', () => {
  it('an empty successful read is not shown, with the plain reason', () => {
    for (const s of EMPTY_READS) expect([s, judgeProhibitionRead(0, s)]).toEqual([s, { shown: false, reason: PROHIBITION_EMPTY_READ_REASON }]);
    expect(PROHIBITION_EMPTY_READ_REASON).toBe('read returned nothing: absence not shown');
    expect(judgeProhibitionRead(0, '{"error":"ResourceNotFound"}').shown).toBe(false);
    expect(judgeProhibitionRead(0, '\nSTAMPER_EXECUTION_SUCCESS').shown).toBe(false);
  });

  it('an explicit read that shows the capability off stays shown (SAT)', () => {
    for (const s of SHOWN_READS) expect([s, judgeProhibitionRead(0, s)]).toEqual([s, { shown: true, reason: '' }]);
  });

  it('a failed read is not shown and says so (not the empty-read reason)', () => {
    expect(judgeProhibitionRead(1, '{"id":"x"}')).toEqual({ shown: false, reason: 'read failed (exit code 1)' });
    expect(judgeProhibitionRead(-1, '')).toEqual({ shown: false, reason: 'read failed (exit code -1)' });
  });

  it('the PH-8 task-path helper is unchanged after the move', () => {
    expect(prohibitionTakesTaskPath([mediaRead])).toBe(false);
    expect(prohibitionTakesTaskPath([{ ...mediaRead, set_command: 'New-X' }])).toBe(true);
  });
});

describe('PH-11 (2): the CLI evidence-only route', () => {
  it('an empty read: the task completes, output.prohibitionShown is false with the reason, the record is NOT_SAT', async () => {
    const t = session('{\r\n    "value":  [\r\n\r\n              ]\r\n}\r\n');
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, undefined, undefined, 'ph11-empty');
    const r = await adapter.execute(prohibitionTask('prohibition-MP.L2-3.8.5', [mediaRead], ['MP.L2-3.8.5']), {}, false);
    expect(r.success).toBe(true);
    expect(r.output).toMatchObject({ prohibitionShown: false, prohibitionReason: `MP.L2-3.8.5.media-access: ${PROHIBITION_EMPTY_READ_REASON}` });
    const rec = record('ph11-empty', 'prohibition-MP.L2-3.8.5', mediaRead);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.verdictRationale).toBe(PROHIBITION_EMPTY_READ_REASON);
  });

  it('a stdout-empty read: not shown either', async () => {
    const t = session('');
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, undefined, undefined, 'ph11-blank');
    const r = await adapter.execute(prohibitionTask('prohibition-MP.L2-3.8.5', [mediaRead], ['MP.L2-3.8.5']), {}, false);
    expect(r.success).toBe(true);
    expect(r.output).toMatchObject({ prohibitionShown: false });
    expect(record('ph11-blank', 'prohibition-MP.L2-3.8.5', mediaRead).complianceVerdict).toBe('NOT_SAT');
  });

  it('a read that shows the capability off: shown, the record keeps its verdict', async () => {
    const t = session('{"value":[{"displayName":"CMMC-Removable-Media-Policy","removableStorageBlocked":true}]}');
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, undefined, undefined, 'ph11-shown');
    const r = await adapter.execute(prohibitionTask('prohibition-MP.L2-3.8.5', [mediaRead], ['MP.L2-3.8.5']), {}, false);
    expect(r.success).toBe(true);
    expect(r.output).toMatchObject({ prohibitionShown: true, prohibitionReason: '' });
    expect(record('ph11-shown', 'prohibition-MP.L2-3.8.5', mediaRead).complianceVerdict).toBe('SAT');
  });

  it('two reads, one with content: shown (the GUI branch is also "any read shows")', async () => {
    const other = { ...mediaRead, id: 'MP.L2-3.8.5.second', evidence_commands: ['Get-Second'] } as SubCommand;
    const manager = { execute: async (_t: string, c: string) => ({ stdout: c === 'Get-Second' ? '{"id":"policy-1"}' : '{"value": []}', stderr: '', exitCode: 0 }) };
    const adapter = new PowerShellAdapter(makeConfig(), manager as any, undefined, undefined, 'ph11-two');
    const r = await adapter.execute(prohibitionTask('prohibition-two', [mediaRead, other], ['MP.L2-3.8.5']), {}, false);
    expect(r.output).toMatchObject({ prohibitionShown: true });
  });

  it('not a prohibition task: no prohibition fields (PH-13: its empty read is judged by the evidence rule instead)', async () => {
    const t = session('{"value": []}');
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, undefined, undefined, 'ph11-other');
    const plain = prohibitionTask('evidence-x', [mediaRead], ['MP.L2-3.8.5']);
    plain.action.args._directive = 'validate';
    const r = await adapter.execute(plain, {}, false);
    expect(r.output).not.toHaveProperty('prohibitionShown');
    // PH-13 (Ph13EvidenceEmptyRead.test.ts): a validate task whose evidence read is empty is "evidence not shown".
    expect(r.output).toMatchObject({ evidenceShown: false });
  });

  it('a dry run never judges (no reads ran)', async () => {
    const t = session('');
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, undefined, undefined, 'ph11-dry');
    const r = await adapter.execute(prohibitionTask('prohibition-dry', [mediaRead], ['MP.L2-3.8.5']), {}, true);
    expect(typeof r.output).toBe('string');
  });
});

describe('PH-11 (3): CLI manifest rows', () => {
  const tasks = [
    { id: 'prohibition-MP.L2-3.8.5', controls: ['MP.L2-3.8.5'] },
    { id: 'prohibition-AC.L2-3.1.6', controls: ['AC.L2-3.1.6'] },
    { id: 'prohibition-MP.L2-3.8.6', controls: ['MP.L2-3.8.6'] },
  ];
  const directives = { 'MP.L2-3.8.5': 'document-prohibition', 'AC.L2-3.1.6': 'document-prohibition', 'MP.L2-3.8.6': 'document-prohibition' };

  it('a completed task whose reads showed nothing records NOT MET / document-prohibition (the GUI row); others unchanged', () => {
    const c = new ExecutionResultsCollector();
    recordTaskStatuses(c, tasks, (id) => (id === 'prohibition-MP.L2-3.8.6' ? 'failed' : 'completed'), directives, () => false,
      (id) => id === 'prohibition-MP.L2-3.8.5' || id === 'prohibition-MP.L2-3.8.6');
    const rows = Object.fromEntries(c.buildManifest('r', 't', 'p').results.map(r => [r.controlId, [r.verdict, r.outcome]]));
    expect(rows['MP.L2-3.8.5']).toEqual(['not_sat', 'document-prohibition']);
    expect(rows['AC.L2-3.1.6']).toEqual(['sat', 'completed']);
    // A failed task still wins.
    expect(rows['MP.L2-3.8.6']).toEqual(['not_sat', 'failed']);
  });

  it('the CLI row equals the GUI branch row for an unverified prohibition (NOT MET / document-prohibition)', () => {
    const cli = new ExecutionResultsCollector();
    recordTaskStatuses(cli, [tasks[0]], () => 'completed', directives, () => false, () => true);
    const gui = new ExecutionResultsCollector();
    gui.recordControlResult('MP.L2-3.8.5', 'document-prohibition', ResultVerdict.NOT_MET, 'document-prohibition');
    const strip = (c: ExecutionResultsCollector) => c.buildManifest('r', 't', 'p').results.map(({ timestampUtc: _t, ...rest }) => rest);
    expect(strip(cli)).toEqual(strip(gui));
  });

  it('default (no predicate): unchanged behaviour', () => {
    const c = new ExecutionResultsCollector();
    recordTaskStatuses(c, [tasks[0]], () => 'completed', directives);
    expect(c.buildManifest('r', 't', 'p').results[0].verdict).toBe('sat');
  });
});

describe('PH-11 (5, V97): a manual postcheck given a registry expected value runs as config_export (a state read)', () => {
  const entry = (jsonpath: string, equals: unknown) => ({ entry_id: 'X.e', verification: { evidence: { jsonpath, equals } } });
  const cover = [{ objective_id: 'AC.L2-3.1.9[b]', type: 'configure', entry_ids: ['X.e'] }];

  it('manual -> config_export, with the expected value; a config_export row keeps its method', () => {
    const pcs: any[] = [
      { id: 'post-chk_AC.L2-3.1.9_b', method: 'manual', control_id: 'AC.L2-3.1.9', objective_id: 'AC.L2-3.1.9[b]' },
      { id: 'post-chk_AC.L2-3.1.9_b2', method: 'config_export', control_id: 'AC.L2-3.1.9', objective_id: 'AC.L2-3.1.9[b]' },
    ];
    expect(applyRegistryExpectedValues(pcs, cover as never, new Map([['X.e', entry('$.isEnabled', 'true')]]) as never)).toBe(2);
    expect(pcs[0]).toMatchObject({ method: 'config_export', expected_value: { path: '$.isEnabled', op: 'equals', value: 'true', source: 'registry' } });
    expect(pcs[1].method).toBe('config_export');
  });

  it('a manual row that gets no expected value stays manual (still a human review)', () => {
    const pcs: any[] = [{ id: 'p', method: 'manual', control_id: 'AC.L2-3.1.9', objective_id: 'AC.L2-3.1.9[b]' }];
    expect(applyRegistryExpectedValues(pcs, cover as never, new Map([['X.e', entry('$.name', '{adminUserName}')]]) as never)).toBe(0);
    expect(pcs[0].method).toBe('manual');
    expect(pcs[0].expected_value).toBeUndefined();
  });

  it('the converted row is read: PostcheckRunner records an observed value (no manual not_assessed row)', async () => {
    const pcs: any[] = [{ id: 'post-chk_AC.L2-3.1.9_b', description: 'x', method: 'manual', control_id: 'AC.L2-3.1.9', objective_id: 'AC.L2-3.1.9[b]', on_fail: 'warn' }];
    applyRegistryExpectedValues(pcs, cover as never, new Map([['X.e', entry('$.isEnabled', 'true')]]) as never);
    const records = [{ entryId: 'X.e', controlIds: ['AC.L2-3.1.9'], stateOutput: '{"isEnabled": true}', postcheckMode: 'state', statePassed: true }];
    const runner = new PostcheckRunner({} as any, { getPlanEvidence: () => [] } as any, undefined, () => records as any);
    const res = await runner.runCheck(pcs[0], 'ph11-plan', false);
    expect(res).toMatchObject({ passed: true, mode: 'state', outcome: 'pass', read_entry_id: 'X.e' });
    expect(res.observed_value).toBeDefined();
  });
});

describe('PH-11 (4): CLI = GUI on every read shape', () => {
  it.each([...EMPTY_READS, ...SHOWN_READS])('read %j: the CLI task verdict equals the GUI judgement of the discovery read', async (answer) => {
    const t = session(answer);
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, undefined, undefined, 'ph11-parity');
    // GUI: execute.routes.ts read-only branch -> taskRunner.discoverSubCommandState -> adapter.discoverSubCommand, then the helper.
    const discovery = await adapter.discoverSubCommand(mediaRead.engine, mediaRead.get_command, [], {}, false);
    const gui = judgeProhibitionRead(discovery.exitCode, discovery.rawOutput).shown;
    // CLI: the evidence-only route.
    const r = await adapter.execute(prohibitionTask('prohibition-parity', [mediaRead], ['MP.L2-3.8.5']), {}, false);
    expect((r.output as { prohibitionShown: boolean }).prohibitionShown).toBe(gui);
  });
});
