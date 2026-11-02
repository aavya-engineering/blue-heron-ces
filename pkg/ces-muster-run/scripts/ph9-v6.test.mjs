// PH-9 P9-PK: V6's directive accounting (judgeV6Accounting in verify-gap.mjs). Fixture plans, plus one read-only probe of
// the real R-F6 S1 evidence (skipped when the folder is absent). Fictional values only; nothing is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV6Accounting } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ctrl = (i) => `AC.L2-3.1.${i}`;
const directives = (n) => Array.from({ length: n }, (_, i) => ({ control_id: ctrl(i + 1), directive: 'implement', step_ids: [`task_${ctrl(i + 1)}_x`] }));
const task = (c, credits) => ({ id: `step_task_${c}_x`, controls: [c], ...(credits ? { credits } : {}) });
const report = (n) => ({ summary: { total_tasks: n, completed: n - 1, failed: 1 } });

test('every directive planned (no folds): pass', () => {
  const plan = { execution_graph: directives(10).map((d) => task(d.control_id)) };
  const r = judgeV6Accounting({ directives: directives(10), plan, report: report(10) });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /10 tasks for 10 directives; 0 folded/);
});

test('two directives folded into a host task by objective credit: pass, the folds are named', () => {
  const plan = { execution_graph: directives(8).map((d, i) => task(d.control_id, i === 0 ? [
    { objective_id: `${ctrl(9)}[a]`, entry_id: 'e9' }, { objective_id: `${ctrl(10)}[b]`, entry_id: 'e10' },
  ] : undefined)) };
  const r = judgeV6Accounting({ directives: directives(10), plan, report: report(8) });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /8 tasks for 10 directives; 2 folded by objective credit: AC\.L2-3\.1\.9, AC\.L2-3\.1\.10/);
});

test('a directive with no task and no credit is dropped: fail, named', () => {
  const plan = { execution_graph: directives(8).map((d, i) => task(d.control_id, i === 0 ? [{ objective_id: `${ctrl(9)}[a]` }] : undefined)) };
  const r = judgeV6Accounting({ directives: directives(10), plan, report: report(8) });
  assert.equal(r.pass, false);
  assert.match(r.detail, /1 directive\(s\) with no task and no objective credit \(dropped\): AC\.L2-3\.1\.10/);
});

test('a control named only by the task id (no controls[]) counts as planned', () => {
  const plan = { execution_graph: [{ id: `prohibition-${ctrl(1)}`, controls: [] }] };
  const r = judgeV6Accounting({ directives: directives(1), plan, report: report(1) });
  assert.equal(r.pass, true, r.detail);
});

test('report total differs from the plan task count: fail', () => {
  const plan = { execution_graph: directives(3).map((d) => task(d.control_id)) };
  const r = judgeV6Accounting({ directives: directives(3), plan, report: report(2) });
  assert.equal(r.pass, false);
  assert.match(r.detail, /report has 2 tasks, executable plan has 3/);
});

test('no executable plan: fail', () => {
  const r = judgeV6Accounting({ directives: directives(3), plan: null, report: report(3) });
  assert.equal(r.pass, false);
  assert.match(r.detail, /no executable plan/);
});

test('verify.mjs wires V6 through judgeV6Accounting and keeps the baseline band (LF only)', () => {
  const v = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.ok(!v.includes('\r\n'));
  const i = v.indexOf("check('V6',");
  assert.ok(i > 0);
  const body = v.slice(i, v.indexOf("check('V7',", i));
  assert.match(body, /judgeV6Accounting\(\{ directives, plan: v6Plan, report \}\)/);
  assert.match(body, /s\.completed >= b\.completed - TOL && s\.failed <= b\.failed \+ TOL/);
  assert.ok(!body.includes('s.total_tasks !== directives.length'));
});

const EV = 'C:\\ces-nb\\evidence\\gc-rf6-s1-mach';
test('R-F6 S1 evidence: 101 tasks for 110 directives, 9 folded, none dropped', { skip: !fs.existsSync(EV) }, () => {
  const rj = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  const runs = path.join(EV, 'ws', 'out', 'runs');
  const run = fs.readdirSync(runs).filter((d) => d.startsWith('run-')).sort().pop();
  const pushed = path.join(runs, run, 'evidence', 'shared', '01-plans', 'pushed');
  const mpFile = fs.readdirSync(pushed).filter((f) => f.startsWith('manual-mission-plan-') && f.endsWith('.json')).sort().pop();
  const mp = rj(path.join(pushed, mpFile));
  const r = judgeV6Accounting({
    directives: mp.outputs.human_readable_mission_plan.control_directives,
    plan: rj(path.join(EV, 'executable-plan.json')),
    report: rj(path.join(EV, 'execution-report.json')),
  });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /^101 tasks for 110 directives; 9 folded by objective credit: /);
});
