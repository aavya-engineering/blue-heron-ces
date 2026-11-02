// FIN-29 (finishing plan PH-2 harness), the Stamper legs: src/flow/fin29-stamper.ts (E0, E8R, E8T, E8G) with fake
// children and temp folders; one opt-out test drives the real pseudo-console host (<PKG>/scripts/conpty-run.ps1) with a
// local node child (no server, no port). Nothing in the workspace is touched.
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  E8G_DEFAULT_SCENARIOS,
  E8T_DEFAULT_SCENARIOS,
  KEY_VAULT_ENTRY,
  REJECT_REASON,
  buildCommandLine,
  e0Step,
  e8gStep,
  e8rStep,
  e8tStep,
  envFileWithStorageRoot,
  lastTaskId,
  legScenarios,
  pickAnswer,
  pickGatePair,
  printedReportPath,
  privatePipelineRoot,
  readCostEvidence,
  readResultsManifest,
  runInPty,
  stamperTerminalRules,
  stripVt,
  subsetPlan,
  taskWithEntry,
  winQuote,
} from '../src/flow/fin29-stamper.js';
import type { Fin29StepCtx } from '../src/flow/fin29-common.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'fin29-st-'));

function plan() {
  return {
    plan_id: 'translated-P1',
    execution_graph: [
      { id: 'step_task_SC.L2-3.13.15_x', priority: 'p2', depends_on: [], controls: ['SC.L2-3.13.15'], action: { engine: 'exchange', args: { _sub_commands: [{ entry_id: 'SC.L2-3.13.15.anti-spam' }] } } },
      { id: 'manual-PE.L1-3.10.1', priority: 'p2', depends_on: [], controls: ['PE.L1-3.10.1'], action: { engine: 'manual_gate', args: {} } },
      { id: 'manual-PE.L1-3.10.3', priority: 'p2', depends_on: ['manual-PE.L1-3.10.1'], controls: ['PE.L1-3.10.3'], action: { engine: 'manual_gate', args: {} } },
      { id: 'step_task_SC.L2-3.13.10_y', priority: 'p2', depends_on: ['step_task_SC.L2-3.13.15_x'], controls: ['SC.L2-3.13.10'], action: { engine: 'az', args: { _sub_commands: [{ entry_id: 'SC.L2-3.13.10.key-escrow' }, { entry_id: KEY_VAULT_ENTRY }] } } },
    ],
    variables: { initialPassword: '<<CES_SECRET:initialPassword>>', _secret_references: [{ variable: 'initialPassword', form: 'one_time_operator_held', ref: 'secretref:one-time:x' }], keep: 1 },
    prechecks: [{ id: 'pre' }],
    postchecks: [{ control_id: 'PE.L1-3.10.1' }, { control_id: 'AC.L1-3.1.1' }],
    ces: { tenantSlug: 's2-eng' },
  };
}

function fakeCtx(root: string, slug = 's2-eng', over: Partial<Fin29StepCtx> = {}): Fin29StepCtx {
  const P = {
    ws: root, pkg: path.join(root, 'pkg'), ces: path.join(root, 'ces'), out: path.join(root, 'out'), logs: path.join(root, 'out', 'logs'), pl: path.join(root, 'pl'), tenants: path.join(root, 'tenants'),
    sim: path.join(root, 'ces', 'tenant-stacksim'), musterApi: '', muster: '', stamper: path.join(root, 'ces', 'ces-stamper'), stamperRegistry: '', tsx: '', exe: path.join(root, 'out', 'executable-plan.json'),
    st: '', stCwd: '', forced: path.join(root, 'out', 'runs', 'forced'), plansPushed: path.join(root, 'pl', 'Stamper', 'plan-data', slug, 'plans'), planDir: '', aoRoot: '', aoCli: '', eoRoot: '', registryRecord: '', mintToken: '',
  };
  fs.mkdirSync(P.logs, { recursive: true });
  return {
    slug, scenario: {}, P, urls: { sim: 'http://127.0.0.1:4390', api: '', ec: '', eo: '' }, node: process.execPath, log: () => undefined,
    rel: (p) => path.relative(root, p).split(path.sep).join('/'), nowIso: () => new Date().toISOString(),
    runCapture: async () => ({ rc: 0, stdout: '', stderr: '' }), runAoCli: async () => ({ rc: 0, stdout: '', stderr: '' }),
    startBg: () => { throw new Error('no'); }, stopTree: () => undefined, waitHttp: async () => false, portHeld: async () => false,
    eoAuthHeaders: () => ({}), simEnv: () => undefined, stamperEnv: () => undefined, aoEnv: () => undefined, simUp: () => false, eoUp: () => false, musterApiUp: () => false,
    musterToken: () => undefined, musterJwt: () => undefined, registerSecret: () => undefined,
    ...over,
  };
}

describe('pure helpers', () => {
  it('stripVt removes CSI, OSC and carriage returns', () => {
    expect(stripVt('\x1b[2K\x1b[1G? Proceed? \x1b[90m(Y/n)\x1b[39m\r\n\x1b]0;title\x07ok')).toBe('? Proceed? (Y/n)\nok');
  });
  it('winQuote follows CommandLineToArgvW', () => {
    expect(winQuote('plain')).toBe('plain');
    expect(winQuote('a b')).toBe('"a b"');
    expect(winQuote('say "hi"')).toBe('"say \\"hi\\""');
    expect(winQuote('C:\\dir with space\\')).toBe('"C:\\dir with space\\\\"');
    expect(buildCommandLine('C:\\node.exe', ['x.js', 'a b'])).toBe('C:\\node.exe x.js "a b"');
  });
  it('legScenarios defaults and env override', () => {
    expect(legScenarios('X_FIN29', ['s2-eng'], {})).toEqual(['s2-eng']);
    expect(legScenarios('X_FIN29', ['s2-eng'], { X_FIN29: 's1-mach, s3-def' })).toEqual(['s1-mach', 's3-def']);
    expect(E8T_DEFAULT_SCENARIOS).toEqual(['s2-eng']);
    expect(E8G_DEFAULT_SCENARIOS).toEqual(['s3-def']);
  });
  it('lastTaskId and printedReportPath', () => {
    expect(lastTaskId('Task ID: a\n...\nTask ID: b\nApprove')).toBe('b');
    expect(printedReportPath('Report saved:\n  JSON: C:\\x\\execution-report-1.json\n  Markdown: y.md')).toBe('C:\\x\\execution-report-1.json');
  });
});

describe('terminal prompt rules', () => {
  const rules = stamperTerminalRules({ approve: new Set(['manual-PE.L1-3.10.1']), dp2: 'wrong' });
  it('answers a prompt only at the tail of the output', () => {
    expect(pickAnswer('? Execute plan X in MANUAL mode? (Y/n) ', '', rules)?.answer).toBe('y');
    expect(pickAnswer('? Execute plan X? (Y/n) y\n? Execute plan X? Yes\nworking', '', rules)).toBeNull();
  });
  it('approves the listed gate, rejects the other, gives a reason', () => {
    const a = 'MANUAL TASK GATE\nTask ID: manual-PE.L1-3.10.1\nYour name/ID: x\nApprove this task? (yes/no): ';
    expect(pickAnswer('Approve this task? (yes/no): ', a, rules)?.answer).toBe('yes');
    const b = 'Task ID: manual-PE.L1-3.10.3\nApprove this task? (yes/no): ';
    expect(pickAnswer('Approve this task? (yes/no): ', b, rules)?.answer).toBe('no');
    expect(pickAnswer('Reason for rejection (optional): ', '', rules)?.answer).toBe(REJECT_REASON);
    expect(pickAnswer('Add notes? (yes/no): ', '', rules)?.answer).toBe('no');
    expect(pickAnswer('? Your name/ID: ', '', rules)?.answer).toMatch(/simulated/);
  });
  it('DP-2 typed wrong or as shown; DP-1 types the entry id', () => {
    const p = `? Type "${KEY_VAULT_ENTRY} $0-$0.50" to confirm (anything else refuses): `;
    expect(pickAnswer(p, '', rules)?.answer).toBe(`${KEY_VAULT_ENTRY} $999.99`);
    expect(pickAnswer(p, '', stamperTerminalRules({ approve: new Set(), dp2: 'correct' }))?.answer).toBe(`${KEY_VAULT_ENTRY} $0-$0.50`);
    expect(pickAnswer(`? Type the entry id "${KEY_VAULT_ENTRY}" to opt in (anything else refuses): `, '', rules)?.answer).toBe(KEY_VAULT_ENTRY);
  });
});

describe('plans and records', () => {
  it('subsetPlan keeps tasks, inner deps, matching postchecks; drops prechecks and the secret references', () => {
    const s = subsetPlan(plan(), ['manual-PE.L1-3.10.1', 'manual-PE.L1-3.10.3'], { planIdSuffix: 'e8t-a', dropSecretRefs: true });
    expect(s.plan_id).toBe('translated-P1-e8t-a');
    expect(s.execution_graph.map((t) => t.id)).toEqual(['manual-PE.L1-3.10.1', 'manual-PE.L1-3.10.3']);
    expect(s.execution_graph[1]!.depends_on).toEqual(['manual-PE.L1-3.10.1']);
    expect(s.prechecks).toEqual([]);
    expect(s.postchecks).toEqual([{ control_id: 'PE.L1-3.10.1' }]);
    expect(s.variables).toEqual({ keep: 1 });
    const c = subsetPlan(plan(), ['step_task_SC.L2-3.13.15_x', 'step_task_SC.L2-3.13.10_y'], { planIdSuffix: 'e8r', critical: ['step_task_SC.L2-3.13.15_x'] });
    expect(c.execution_graph[0]!.priority).toBe('p1');
    expect(c.execution_graph[1]!.depends_on).toEqual(['step_task_SC.L2-3.13.15_x']);
  });
  it('taskWithEntry and pickGatePair', () => {
    expect(taskWithEntry(plan(), KEY_VAULT_ENTRY)?.id).toBe('step_task_SC.L2-3.13.10_y');
    expect(taskWithEntry(plan(), 'SC.L2-3.13.10.key')).toBeUndefined();
    expect(pickGatePair(plan())?.map((t) => t.id)).toEqual(['manual-PE.L1-3.10.1', 'manual-PE.L1-3.10.3']);
  });
  it('readCostEvidence, readResultsManifest, envFileWithStorageRoot, privatePipelineRoot', () => {
    const d = tmp();
    const ev = path.join(d, 't', 'cost-gate-evidence');
    fs.mkdirSync(ev, { recursive: true });
    fs.writeFileSync(path.join(ev, '1-kv-dp2.json'), JSON.stringify({ outcome: 'refused', metadata: { dp: 2, entryId: KEY_VAULT_ENTRY, reason: 'cost_gated_off: typed text does not match' } }));
    fs.writeFileSync(path.join(ev, '0-kv-dp1.json'), JSON.stringify({ outcome: 'accepted', metadata: { dp: 1, entryId: KEY_VAULT_ENTRY } }));
    expect(readCostEvidence(path.join(d, 't')).map((r) => `${r.dp}:${r.outcome}`)).toEqual(['1:accepted', '2:refused']);
    const st = path.join(d, 'pl', 'Stamper', 'plan-data', 's2-eng', 'state');
    fs.mkdirSync(st, { recursive: true });
    fs.writeFileSync(path.join(st, 'execution-results-P-a.json'), JSON.stringify({ results: [{ controlId: 'PE.L1-3.10.3', verdict: 'not_sat' }] }));
    expect(readResultsManifest(path.join(d, 'pl'), 's2-eng', 'P-a')?.verdicts).toEqual({ 'PE.L1-3.10.3': 'not_sat' });
    fs.writeFileSync(path.join(d, 'src.env'), 'A=1\r\nSTORAGE_ROOT=C:/old\r\n');
    envFileWithStorageRoot(path.join(d, 'src.env'), path.join(d, 'x', 'new.env'), 'C:\\new\\st');
    expect(fs.readFileSync(path.join(d, 'x', 'new.env'), 'utf8')).toBe('A=1\nSTORAGE_ROOT=C:/new/st\n');
    const tdir = path.join(d, 'runpl', 'Stamper', 'plan-data', 's2-eng');
    for (const sub of ['plans', 'evidence', 'state']) fs.mkdirSync(path.join(tdir, sub), { recursive: true });
    fs.writeFileSync(path.join(tdir, 'variables.json'), '{}');
    fs.writeFileSync(path.join(d, 'runpl', 'ces.db'), 'db');
    const priv = privatePipelineRoot(path.join(d, 'runpl'), 's2-eng', path.join(d, 'priv'), { withDb: true });
    expect(fs.readdirSync(path.join(priv, 'Stamper', 'plan-data', 's2-eng')).sort()).toEqual(['plans', 'state', 'variables.json']);
    expect(fs.existsSync(path.join(priv, 'ces.db'))).toBe(true);
  });
});

describe('step factories', () => {
  it('E0 skips with a reason when the clean-g5 profile is not built', () => {
    const s = e0Step(fakeCtx(tmp()));
    expect(s.id).toBe('E0');
    expect(s.fatal).toBe(false);
    expect(s.skip).toMatch(/slice not landed: FIN-21 clean-g5 profile not built/);
    expect(s.commands.join(' ')).toMatch(/bootstrap .*--environment gcchigh .*--slug clean-g5-e0/);
    expect(s.commands.join(' ')).not.toMatch(/password|token/i);
  });
  it('E8T and E8G run only on their scenarios', () => {
    const r = tmp();
    expect(e8tStep(fakeCtx(r, 's1-mach')).skip).toMatch(/^not this scenario/);
    expect(e8gStep(fakeCtx(r, 's1-mach')).skip).toMatch(/^not this scenario/);
    expect(e8gStep(fakeCtx(r, 's3-def')).skip).toBeUndefined();
    expect(e8tStep(fakeCtx(r, 's2-eng')).skip).toMatch(/no pseudo-console host/);
  });
  it('E8R refuses without its inputs and records why', async () => {
    const r = tmp();
    const s = e8rStep(fakeCtx(r), { forceFailEntry: 'SC.L2-3.13.15.anti-spam' });
    const out = await s.run();
    expect(out.rc).toBe(1);
    const rec = JSON.parse(fs.readFileSync(path.join(r, 'out', 'e8r-lifecycle.json'), 'utf8'));
    expect(rec.schema).toBe('ces-tester/e8r-lifecycle@1');
    expect(rec.note).toMatch(/needs the sim/);
  });
  it('E8G refuses without the sim', async () => {
    const r = tmp();
    const out = await e8gStep(fakeCtx(r, 's3-def')).run();
    expect(out.rc).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(r, 'out', 'stamper-gui-cost.json'), 'utf8')).note).toMatch(/needs the sim/);
  });
});

describe('runInPty with a fake host', () => {
  it('answers each prompt once, at the tail, then Enter', async () => {
    const d = tmp();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, pid: undefined }) as unknown as ChildProcess;
    const typed: string[] = [];
    stdin.on('data', (b) => typed.push(String(b)));
    let env: NodeJS.ProcessEnv = {};
    const p = runInPty({
      conptyScript: 'x.ps1', exe: 'node', args: ['a b'], cwd: d, env: {}, idleMs: 30,
      rules: stamperTerminalRules({ approve: new Set(['manual-A']), dp2: 'correct' }), transcriptFile: path.join(d, 't.txt'),
      spawnImpl: (_c, _a, o) => { env = o.env; return child; },
    });
    stdout.write('\x1b[1G? Execute plan P? (Y/n) ');
    await new Promise((r) => setTimeout(r, 300));
    stdout.write('y\x1b[1G? Execute plan P? Yes\nMANUAL TASK GATE\nTask ID: manual-A\nYour name/ID: ');
    await new Promise((r) => setTimeout(r, 300));
    stdout.write('op\nApprove this task? (yes/no): ');
    await new Promise((r) => setTimeout(r, 300));
    child.emit('close', 0);
    const res = await p;
    expect(env.CES_CONPTY_CMDLINE).toBe('node "a b"');
    expect(res.answers.map((a) => `${a.rule}=${a.answer}`)).toEqual(['confirm=y', 'operator=harness-operator (simulated)', 'gate-decision=yes']);
    expect(res.answers[2]!.task_id).toBe('manual-A');
    expect(typed.join('')).toContain('y\r');
    expect(fs.readFileSync(path.join(d, 't.txt'), 'utf8')).toContain('Task ID: manual-A');
  });
});

const conpty = path.resolve(__dirname, '..', '..', '..', 'pkg', 'ces-muster-run', 'scripts', 'conpty-run.ps1');
describe.skipIf(process.platform !== 'win32' || process.env.CES_FIN29_PTY_TEST === '0' || !fs.existsSync(conpty))('the real pseudo-console host', () => {
  it('gives the child a TTY and relays prompts and answers', async () => {
    const d = tmp();
    const child = path.join(d, 'child.cjs');
    fs.writeFileSync(child, [
      "const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });",
      "console.log('TTY=' + process.stdin.isTTY);",
      "rl.question('Approve this task? (yes/no): ', (a) => { console.log('GOT=' + a.trim()); rl.close(); });",
    ].join('\n'));
    const res = await runInPty({
      conptyScript: conpty, exe: process.execPath, args: [child], cwd: d, env: { ...process.env },
      rules: stamperTerminalRules({ approve: new Set(), dp2: 'wrong' }), transcriptFile: path.join(d, 't.txt'), stallMs: 30000, totalMs: 60000,
    });
    const t = fs.readFileSync(path.join(d, 't.txt'), 'utf8');
    expect(res.rc).toBe(0);
    expect(res.is_tty).toBe(true);
    expect(t).toContain('GOT=no');
  }, 90000);
});
