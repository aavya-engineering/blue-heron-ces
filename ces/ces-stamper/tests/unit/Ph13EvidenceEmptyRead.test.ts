// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 (P13-ST; founder Q3, 2026-11-01): an empty successful read is never evidence, on EVERY evidence-only
// read (PH-11 covered read-only prohibitions only). On both paths:
//   (1) the per-read record (assessOutcome / buildStructuredEvidence): partial_success, NOT_SAT, the plain reason;
//   (2) the CLI evidence-only route (PowerShellAdapter): the task completes, output.evidenceShown === false;
//   (3) the CLI manifest rows (recordTaskStatuses): NOT_SAT / 'evidence_not_shown', with its precedence;
//   (4) CLI = GUI: the GUI normal path records the same row from the same adapter output (isEvidenceNotShown);
//   (5) the task-level record (EvidenceCollector) is NOT_SAT with the reason;
//   (6) a read placed before a SET of its own task is read again after the SET;
//   (7) the translator orders a read after the task that creates what it reads (read_after);
//   (8) a registry range check (min..max) becomes an 'lte' expected value (LOG-PH13-REG STOP-2).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
  PowerShellAdapter, judgeEvidenceRead, evidenceReadRuleApplies, isEvidenceNotShown, EMPTY_READ_REASON, EVIDENCE_NOT_SHOWN_OUTCOME,
} from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { TaskRunner } from '../../src/core/TaskRunner';
import { ExecutionResultsCollector, ResultVerdict } from '../../src/core/ExecutionResultsCollector';
import { recordTaskStatuses } from '../../src/core/ExecutionResultsPublisher';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { assessOutcome, buildStructuredEvidence, isEmptyEvidenceRead } from '../../src/utils/structuredEvidence';
import { EvidenceCollector } from '../../src/evidence/EvidenceCollector';
import { orderByReadAfter } from '../../src/translators/captureDependencies';
import { applyRegistryExpectedValues } from '../../src/translators/objectiveCredit';
import type { ExecutablePlan, ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-ph13-'));
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

const read = (id: string, evidence: string[], idempotency: SubCommand['idempotency'] = 'evidence-only'): SubCommand => ({
  id, label: `Read ${id}`, set_command: '', get_command: '', engine: 'mgraph', sequence_hint: 0, idempotency,
  variables_required: [], variables_runtime: [], captures: [], on_failure: 'warn_continue', evidence_commands: evidence,
} as SubCommand);

const setSub = (id: string, set: string): SubCommand => ({
  id, label: `Set ${id}`, set_command: set, get_command: '', engine: 'mgraph', sequence_hint: 0, idempotency: 'unsafe',
  variables_required: [], variables_runtime: [], captures: [], on_failure: 'warn_continue', evidence_commands: [],
} as SubCommand);

function task(id: string, subs: SubCommand[], controls: string[], directive = 'validate', engine = 'mgraph'): ExeTask {
  return {
    id, type: 'validate', priority: 'p2', depends_on: [],
    action: { engine, command: 'x', args: { _directive: directive, _sub_commands: subs } },
    inputs: [], outputs: [], controls, idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

/** A session that answers each command from `answer(command)` (exit 0 unless the answer says otherwise). */
function session(answer: (command: string) => string | { stdout: string; exitCode: number }) {
  const received: string[] = [];
  return {
    received,
    manager: {
      execute: async (_t: string, command: string) => {
        received.push(command);
        const a = answer(command);
        return typeof a === 'string' ? { stdout: a, stderr: '', exitCode: 0 } : { stdout: a.stdout, stderr: a.exitCode === 0 ? '' : 'boom', exitCode: a.exitCode };
      },
    },
  };
}

function record(tenant: string, taskId: string, sub: SubCommand): any {
  const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
  return JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidFile), 'utf-8'));
}

const EMPTY_READS = ['', '  ', 'null', '[]', '{}', '{"value": []}', '{\r\n    "value":  [\r\n\r\n              ]\r\n}\r\n', '{"@odata.context":"x","value":[]}'];
const SHOWN_READS = ['{"count":0}', '{"count":0,"signIns":[]}', '{"displayName":"S1-Defender-AV"}', '[{"id":"1"}]', 'false'];

describe('PH-13 (1): the per-read record', () => {
  const sub = read('X.read', ['Get-X']);
  it('an evidence-only read that succeeded with nothing is partial_success, never automated_success', () => {
    for (const s of EMPTY_READS) expect([s, assessOutcome(0, '', s, false, sub)]).toEqual([s, 'partial_success']);
    for (const s of SHOWN_READS) expect([s, assessOutcome(0, '', s, false, sub)]).toEqual([s, 'automated_success']);
    expect(isEmptyEvidenceRead(0, '{"error":"ResourceNotFound"}')).toBe(true);
    expect(isEmptyEvidenceRead(1, '')).toBe(false); // a failed read is judged by the failure path
  });

  it('the record is NOT_SAT with the plain reason; Assess discovery (assessOnly) keeps its old rule', () => {
    const ev = buildStructuredEvidence('{"value": []}', 0, '', null, sub, task('t', [sub], ['C']), {});
    expect(ev).toMatchObject({ outcome: 'partial_success', complianceVerdict: 'NOT_SAT', verdictRationale: EMPTY_READ_REASON });
    expect(EMPTY_READ_REASON).toBe('read returned nothing: absence not shown');
    const assess = buildStructuredEvidence('', 0, '', null, sub, task('t', [sub], ['C']), {}, undefined, undefined, { assessOnly: true });
    expect(assess.outcome).toBe('automated_success');
    const counted = buildStructuredEvidence('{"count":0}', 0, '', null, sub, task('t', [sub], ['C']), {});
    expect(counted.complianceVerdict).toBe('SAT');
  });

  it('judgeEvidenceRead is the PH-11 rule (shown / empty / failed)', () => {
    expect(judgeEvidenceRead(0, '{"count":0}')).toEqual({ shown: true, reason: '' });
    expect(judgeEvidenceRead(0, '[]')).toEqual({ shown: false, reason: EMPTY_READ_REASON });
    expect(judgeEvidenceRead(2, '{"id":"x"}')).toEqual({ shown: false, reason: 'read failed (exit code 2)' });
  });
});

describe('PH-13 (2): the CLI evidence-only route', () => {
  it('a validate task whose read is empty: completes, output.evidenceShown false with the reason; the record is NOT_SAT', async () => {
    const a = read('SI.L1-3.14.4.av-signatures', ['Get-AV']);
    const s = session(() => '');
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, 'ph13-empty');
    const r = await adapter.execute(task('t-empty', [a], ['SI.L1-3.14.4']), {}, false);
    expect(r.success).toBe(true);
    expect(r.output).toMatchObject({ evidenceShown: false, evidenceReason: `SI.L1-3.14.4.av-signatures: ${EMPTY_READ_REASON}` });
    expect(record('ph13-empty', 't-empty', a)).toMatchObject({ complianceVerdict: 'NOT_SAT', verdictRationale: EMPTY_READ_REASON, outcome: 'partial_success' });
  });

  it('every read shows content (including an explicit {"count":0}): output unchanged (a string), records SAT', async () => {
    const a = read('A.count', ['Get-Count']);
    const b = read('B.obj', ['Get-Obj']);
    const s = session(c => (c === 'Get-Count' ? '{"count":0,"items":[]}' : '{"id":"obj-1"}'));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, 'ph13-shown');
    const r = await adapter.execute(task('t-shown', [a, b], ['C.1']), {}, false);
    expect(typeof r.output).toBe('string');
    expect(record('ph13-shown', 't-shown', a).complianceVerdict).toBe('SAT');
    expect(record('ph13-shown', 't-shown', b).complianceVerdict).toBe('SAT');
  });

  it('strict: one empty read among shown reads is enough (it names only the empty one); a "safe"-tagged read is judged by route', async () => {
    const a = read('A.shown', ['Get-A']);
    const b = read('B.empty', ['Get-B'], 'safe');
    const s = session(c => (c === 'Get-A' ? '{"id":"1"}' : '{"value": []}'));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, 'ph13-mixed');
    const r = await adapter.execute(task('t-mixed', [a, b], ['C.2']), {}, false);
    expect(r.output).toMatchObject({ evidenceShown: false, evidenceReason: `B.empty: ${EMPTY_READ_REASON}` });
    expect(record('ph13-mixed', 't-mixed', b).complianceVerdict).toBe('NOT_SAT');
  });

  it('one sub-command, two reads: the first shows content, so the sub-command shows and its record is not overwritten', async () => {
    const a = read('A.two', ['Get-One', 'Get-Two']);
    const s = session(c => (c === 'Get-One' ? '{"id":"1"}' : ''));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, 'ph13-two');
    const r = await adapter.execute(task('t-two', [a], ['C.3']), {}, false);
    expect(typeof r.output).toBe('string');
    expect(record('ph13-two', 't-two', a)).toMatchObject({ complianceVerdict: 'SAT', rawResponse: '{"id":"1"}' });
  });

  it('a failed read is not shown ("read failed")', async () => {
    const a = read('A.fail', ['Get-Fail']);
    const s = session(() => ({ stdout: '', exitCode: 1 }));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, 'ph13-fail');
    const r = await adapter.execute(task('t-fail', [a], ['C.4']), {}, false);
    expect(r.output).toMatchObject({ evidenceShown: false, evidenceReason: 'A.fail: read failed (exit code 1)' });
  });

  it('exempt: a manual gate, the special directives, a read-only prohibition (PH-11 rule), and a dry run', async () => {
    const a = read('A.x', ['Get-X']);
    const s = session(() => '');
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, 'ph13-exempt');
    for (const directive of ['document-renderable', 'eo-tooled', 'inherit-fedramp', 'nonstack', 'document-absence', 'manual']) {
      const r = await adapter.execute(task(`t-${directive}`, [a], ['C.5'], directive), {}, false);
      expect({ directive, out: typeof r.output }).toEqual({ directive, out: 'string' });
    }
    expect(evidenceReadRuleApplies(task('g', [a], ['C'], 'implement', 'manual_gate'), [a])).toBe(false);
    expect(evidenceReadRuleApplies(task('p', [a], ['C'], 'document-prohibition'), [a])).toBe(false);
    expect(evidenceReadRuleApplies(task('p2', [a, setSub('S', 'New-S')], ['C'], 'document-prohibition'), [a, setSub('S', 'New-S')])).toBe(true);
    expect(evidenceReadRuleApplies(task('i', [a], ['C'], 'implement'), [a])).toBe(true);
    const prohib = await adapter.execute(task('t-prohib', [a], ['C.6'], 'document-prohibition'), {}, false);
    expect(prohib.output).toMatchObject({ prohibitionShown: false });
    expect(prohib.output).not.toHaveProperty('evidenceShown');
    const dry = await adapter.execute(task('t-dry', [a], ['C.7']), {}, true);
    expect(typeof dry.output).toBe('string');
  });
});

describe('PH-13 (2b): the output reaches the task state through TaskRunner (what the CLI predicate and the GUI read)', () => {
  it('a validate task with an empty read: TaskRunner returns success with output.evidenceShown false', async () => {
    const cfg = makeConfig();
    Object.defineProperty(cfg, 'dryRun', { get: () => false });
    const s = session(() => '{"value": []}');
    const runner = new TaskRunner(cfg, { collectTaskEvidence: async () => [], getPlanEvidence: () => [] } as any, undefined, undefined, s.manager as any, new ExecutionContext(false), 'ph13-runner');
    const { result } = await runner.executeTask(task('t-runner', [read('SC.L2-3.13.2.advisor', ['Get-Advisor'])], ['SC.L2-3.13.2']), 'plan-ph13', {});
    expect(result.success).toBe(true);
    expect(isEvidenceNotShown(result.output)).toBe(true);
    expect(result.output).toMatchObject({ evidenceShown: false, evidenceReason: `SC.L2-3.13.2.advisor: ${EMPTY_READ_REASON}` });
  });
});

describe('PH-13 (6): a read placed before a SET of its own task is read again after that SET', () => {
  it('empty before the SET, shown after: the task shows evidence and the record is the second read (SAT)', async () => {
    const nsg = read('SC.L1-3.13.1.nsg-boundary-rules', ['Get-NSG']);
    const create = setSub('AZ-NSG-001', 'New-NSG -Name boundary');
    let created = false;
    const s = session(c => {
      if (c.startsWith('New-NSG')) { created = true; return '{"Name":"boundary"}'; }
      if (c === 'Get-NSG') return created ? '[{"NSGName":"boundary"}]' : '';
      return '';
    });
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, 'ph13-reread');
    const r = await adapter.execute(task('t-reread', [nsg, create], ['SC.L1-3.13.1'], 'implement'), {}, false);
    expect(r.success).toBe(true);
    expect(s.received.filter(c => c === 'Get-NSG')).toHaveLength(2);
    expect(typeof r.output).toBe('string');
    expect(record('ph13-reread', 't-reread', nsg)).toMatchObject({ complianceVerdict: 'SAT', rawResponse: '[{"NSGName":"boundary"}]' });
  });

  it('still empty after the SET: not shown; a read with no SET after it is not read again', async () => {
    const before = read('R.before', ['Get-Before']);
    const create = setSub('S.create', 'New-Thing -Name a');
    const after = read('R.after', ['Get-After']);
    const s = session(c => (c.startsWith('New-Thing') ? '{"Name":"a"}' : ''));
    const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, 'ph13-reread2');
    const r = await adapter.execute(task('t-reread2', [before, create, after], ['C.8'], 'implement'), {}, false);
    expect(s.received.filter(c => c === 'Get-Before')).toHaveLength(2);
    expect(s.received.filter(c => c === 'Get-After')).toHaveLength(1);
    expect(r.output).toMatchObject({ evidenceShown: false, evidenceReason: `R.before: ${EMPTY_READ_REASON}; R.after: ${EMPTY_READ_REASON}` });
  });
});

describe('PH-13 (3): CLI manifest rows', () => {
  const rows = (c: ExecutionResultsCollector) => Object.fromEntries(c.buildManifest('r', 't', 'p').results.map(r => [r.controlId, [r.verdict, r.outcome]]));
  it('a completed task whose evidence showed nothing records NOT_SAT / evidence_not_shown; others unchanged', () => {
    const c = new ExecutionResultsCollector();
    recordTaskStatuses(c, [{ id: 'a', controls: ['C.A'] }, { id: 'b', controls: ['C.B'] }], () => 'completed', {}, () => false, () => false, id => id === 'a');
    expect(rows(c)).toEqual({ 'C.A': ['not_sat', EVIDENCE_NOT_SHOWN_OUTCOME], 'C.B': ['sat', 'completed'] });
    expect(EVIDENCE_NOT_SHOWN_OUTCOME).toBe('evidence_not_shown');
  });

  it('precedence: failed, prohibition not shown, pending gate, then evidence not shown, then SAT (a control in two tasks)', () => {
    const c = new ExecutionResultsCollector();
    const tasks = [
      { id: 'f', controls: ['C.F'] }, { id: 'e1', controls: ['C.F', 'C.P', 'C.G', 'C.S'] },
      { id: 'p', controls: ['C.P'] }, { id: 'g', controls: ['C.G'] }, { id: 's', controls: ['C.S'] },
    ];
    recordTaskStatuses(c, tasks, id => (id === 'f' ? 'failed' : 'completed'), {}, id => id === 'g', id => id === 'p', id => id === 'e1');
    expect(rows(c)).toEqual({
      'C.F': ['not_sat', 'failed'],
      'C.P': ['not_sat', 'document-prohibition'],
      'C.G': ['provisional', 'manual_gate_pending'],
      'C.S': ['not_sat', EVIDENCE_NOT_SHOWN_OUTCOME],
    });
  });

  it('default (no predicate): unchanged behaviour', () => {
    const c = new ExecutionResultsCollector();
    recordTaskStatuses(c, [{ id: 'a', controls: ['C.A'] }], () => 'completed');
    expect(rows(c)).toEqual({ 'C.A': ['sat', 'completed'] });
  });
});

describe('PH-13 (4): CLI = GUI', () => {
  it('the GUI normal path records NOT_SAT / evidence_not_shown from the adapter output, with the shared predicate', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/server/routes/execute.routes.ts'), 'utf-8');
    expect(src).toContain('const evidenceEmpty = isEvidenceNotShown(result.output);');
    expect(src).toContain('resultsCollector.recordControlResult(cid, cidDirective, ResultVerdict.NOT_SAT, EVIDENCE_NOT_SHOWN_OUTCOME)');
    const cli = fs.readFileSync(path.resolve(__dirname, '../../src/cli/index.ts'), 'utf-8');
    expect(cli).toContain('?.evidenceShown === false,');
  });

  it('on every read shape, the CLI row equals the row the GUI branch records from the same adapter output', async () => {
    for (const [i, answer] of [...EMPTY_READS, ...SHOWN_READS].entries()) {
      const a = read('X.shape', ['Get-Shape']);
      const s = session(() => answer);
      const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, `ph13-shape-${i}`);
      const r = await adapter.execute(task(`t-shape-${i}`, [a], ['C.X']), {}, false);
      const cliRows = new ExecutionResultsCollector();
      recordTaskStatuses(cliRows, [{ id: 't', controls: ['C.X'] }], () => 'completed', {}, () => false, () => false, () => (r.output as any)?.evidenceShown === false);
      const guiRows = new ExecutionResultsCollector();
      const evidenceEmpty = isEvidenceNotShown(r.output);
      guiRows.recordControlResult('C.X', 'automated', evidenceEmpty ? ResultVerdict.NOT_SAT : ResultVerdict.SAT, evidenceEmpty ? EVIDENCE_NOT_SHOWN_OUTCOME : 'completed');
      const cli = cliRows.buildManifest('r', 't', 'p').results[0];
      const gui = guiRows.buildManifest('r', 't', 'p').results[0];
      expect({ answer, cli: [cli.verdict, cli.outcome] }).toEqual({ answer, cli: [gui.verdict, gui.outcome] });
      expect({ answer, empty: evidenceEmpty }).toEqual({ answer, empty: EMPTY_READS.includes(answer) });
    }
  });
});

describe('PH-13 (5): the task-level record', () => {
  it('EvidenceCollector writes NOT_SAT with the reason when output.evidenceShown is false', async () => {
    const stored: string[] = [];
    const store = { storeArtifact: async (...a: unknown[]) => { stored.push(a[7] as string); return { artifact_id: 'x' }; } } as any;
    const collector = new EvidenceCollector(makeConfig(), store);
    const t = { ...task('t-ec', [read('A', ['Get-A'])], ['C.9']), evidence_emit: [{ artifact_id: 'ev', artifact_type: 'config_export', description: 'd', retention_days: 1, collector: 'stamper' }] } as any;
    await collector.collectTaskEvidence('plan', t, { success: true, stdout: '[manual] A', output: { evidenceShown: false, evidenceReason: `A: ${EMPTY_READ_REASON}`, text: '' } } as any);
    await collector.collectTaskEvidence('plan', t, { success: true, stdout: '[manual] A', output: '[manual] A' } as any);
    expect(JSON.parse(stored[0])).toMatchObject({ complianceVerdict: 'NOT_SAT', verdictRationale: `Evidence not shown: A: ${EMPTY_READ_REASON}` });
    expect(JSON.parse(stored[1]).complianceVerdict).not.toBe('NOT_SAT');
  });
});

describe('PH-13 (7): read_after orders a read after the task that creates what it reads', () => {
  const sub = (id: string, extra: Partial<SubCommand> = {}) => ({ ...read(id, ['Get']), ...extra }) as SubCommand;
  const plan = (graph: ExeTask[]): ExecutablePlan => ({ plan_id: 'p', execution_graph: graph, variables: {} } as unknown as ExecutablePlan);

  it('SI.L1-3.14.4 runs after SI.L1-3.14.5 (LOG-PH13-REG STOP-3); the order is otherwise kept', () => {
    const t4 = task('t-3.14.4', [sub('SI.L1-3.14.4.av-signatures', { read_after: ['SI.L1-3.14.5.scan-schedule-evidence'] } as any)], ['SI.L1-3.14.4']);
    const tx = task('t-other', [sub('X.other')], ['X']);
    const t5 = task('t-3.14.5', [sub('SI.L1-3.14.5.scan-schedule-evidence')], ['SI.L1-3.14.5']);
    const p = plan([t4, tx, t5]);
    const warnings = orderByReadAfter(p);
    expect(t4.depends_on).toEqual(['t-3.14.5']);
    const order = p.execution_graph.map(t => t.id);
    expect(order.indexOf('t-3.14.5')).toBeLessThan(order.indexOf('t-3.14.4'));
    expect(warnings).toEqual(['READ_AFTER: t-3.14.4 now depends on t-3.14.5: SI.L1-3.14.4.av-signatures reads what SI.L1-3.14.5.scan-schedule-evidence creates']);
  });

  it('a creator not in the plan, the same task, or a cycle adds no edge', () => {
    const a = task('a', [sub('A.read', { read_after: ['Missing.entry', 'A.make'] } as any), sub('A.make')], ['A']);
    const b = task('b', [sub('B.read', { read_after: ['C.make'] } as any)], ['B']);
    const c = task('c', [sub('C.make')], ['C']);
    c.depends_on.push('b');
    const p = plan([a, b, c]);
    const warnings = orderByReadAfter(p);
    expect(a.depends_on).toEqual([]);
    expect(b.depends_on).toEqual([]);
    expect(warnings[0]).toMatch(/^CAPTURE_DEPENDENCY_CYCLE: b reads after C.make/);
  });

  it('the registry: av-signatures and malware-protection-evidence read after scan-schedule-evidence', () => {
    const reg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'), 'utf-8')).entries as any[];
    for (const id of ['SI.L1-3.14.4.av-signatures', 'SI.L1-3.14.2.malware-protection-evidence']) {
      expect({ id, after: reg.find(e => e.entry_id === id).read_after }).toEqual({ id, after: ['SI.L1-3.14.5.scan-schedule-evidence'] });
    }
    expect(reg.some(e => e.entry_id === 'SI.L1-3.14.5.scan-schedule-evidence')).toBe(true);
  });
});

describe('PH-13 (8): a registry range check becomes an lte expected value (LOG-PH13-REG STOP-2)', () => {
  it('min..max -> lte max; equals still wins; a {variable} equals and no value stay without one', () => {
    const entries = new Map<string, any>([
      ['R.range', { entry_id: 'R.range', verification: { evidence: { jsonpath: '$.minutes', min: 1, max: 15 } } }],
      ['R.eq', { entry_id: 'R.eq', verification: { evidence: { jsonpath: '$.state', equals: 'enabled' } } }],
      ['R.var', { entry_id: 'R.var', verification: { evidence: { jsonpath: '$.id', equals: '{groupId}' } } }],
    ]);
    const pcs: any[] = [{ objective_id: 'O[a]', method: 'manual' }, { objective_id: 'O[b]' }, { objective_id: 'O[c]', method: 'manual' }];
    const cov: any[] = [
      { objective_id: 'O[a]', type: 'configure', entry_ids: ['R.range'] },
      { objective_id: 'O[b]', type: 'configure', entry_ids: ['R.eq'] },
      { objective_id: 'O[c]', type: 'configure', entry_ids: ['R.var'] },
    ];
    expect(applyRegistryExpectedValues(pcs, cov, entries)).toBe(2);
    expect(pcs[0]).toMatchObject({ method: 'config_export', expected_value: { path: '$.minutes', op: 'lte', value: 15, source: 'registry' } });
    expect(pcs[1].expected_value).toEqual({ path: '$.state', op: 'equals', value: 'enabled', source: 'registry' });
    expect(pcs[2]).toEqual({ objective_id: 'O[c]', method: 'manual' });
  });

  it('the registry: AC.L2-3.1.10.screen-lock carries min 1, max 15 (no regex)', () => {
    const reg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'), 'utf-8')).entries as any[];
    const ev = reg.find(e => e.entry_id === 'AC.L2-3.1.10.screen-lock').verification.evidence;
    expect(ev).toMatchObject({ jsonpath: '$.passwordMinutesOfInactivityBeforeScreenTimeout', min: 1, max: 15 });
    expect(ev.regex).toBeUndefined();
  });
});
