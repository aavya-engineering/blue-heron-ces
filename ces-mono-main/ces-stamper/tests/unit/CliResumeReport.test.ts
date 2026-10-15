// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-ST3 — CLI `resume` and `report` (were stubs that exited 1).
//
// resume: execution state for the plan is seeded through the production StateManager
// (three tasks completed, the fourth failed, run status failed). The real CLI
// (`tsx src/cli/index.ts resume <plan> --dry-run`) must continue from there: the
// completed tasks are not re-run (their recorded completion is untouched) and every
// remaining task runs, ending with the plan completed.
// report: prints the summary of the execution-results manifest the resumed run wrote.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-st3-resume-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;
process.env.DRY_RUN = 'true';
delete process.env.TENANT_ID;

import { StateManager } from '../../src/state/StateManager';
import { StamperConfig } from '../../src/config/StamperConfig';

const PLAN_SRC = path.join(ROOT, 'tests', 'fixtures', 'synthetic-mission-plan.executable.json');
const TENANT = 'w4-resume';

function runCli(args: string[]) {
  return spawnSync(`npx tsx src/cli/index.ts ${args.join(' ')}`, {
    cwd: ROOT,
    env: { ...process.env, CES_PIPELINE_ROOT: tmpRoot, DRY_RUN: 'true', TENANT_ID: '', CES_MUSTER_API_URL: '' },
    input: '',
    encoding: 'utf-8',
    shell: true,
    timeout: 180_000,
  });
}

describe('W4-ST3 CLI resume + report', () => {
  const planPath = path.join(tmpRoot, 'plan.json');
  const plan = JSON.parse(fs.readFileSync(PLAN_SRC, 'utf-8'));
  const ids: string[] = plan.execution_graph.map((t: any) => t.id);
  const done = ids.slice(0, 3);
  const failedId = ids[3];
  const priorCompletion: Record<string, string | undefined> = {};

  beforeAll(() => {
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    const sm = new StateManager(new StamperConfig(), plan.plan_id);
    sm.updatePlanStatus('running');
    for (const id of done) {
      sm.startTask(id);
      sm.completeTask(id, { seeded: true });
    }
    sm.startTask(failedId);
    sm.failTask(failedId, 'seeded failure');
    sm.updatePlanStatus('failed');
    for (const id of done) priorCompletion[id] = sm.getTaskState(id)?.completed_at;
  });

  afterAll(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ces.db handle on Windows */ }
  });

  it('resume continues from the last completed task: done tasks are not re-run, the rest run to completion', () => {
    const r = runCli(['resume', `"${planPath}"`, '--dry-run', '--tenant', TENANT]);
    expect(r.stderr).not.toMatch(/Error:/);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Resuming ${plan.plan_id} (prior status: failed) - 3/${ids.length} task(s) already done, last executed: ${failedId}`);
    expect((r.stdout.match(/Resume: already completed - not re-run/g) ?? []).length).toBe(3);

    const sm = new StateManager(new StamperConfig(), plan.plan_id);
    const state = sm.getState();
    expect(state.status).toBe('completed');
    for (const id of done) {
      expect(state.tasks[id].status).toBe('completed');
      expect(state.tasks[id].completed_at).toBe(priorCompletion[id]);
      expect(state.tasks[id].outputs).toEqual({ seeded: true });
    }
    for (const id of ids.slice(3)) expect(state.tasks[id]?.status).toBe('completed');
  }, 200_000);

  it('report prints the execution-results manifest summary', () => {
    const manifestPath = path.join(tmpRoot, 'Stamper', 'plan-data', TENANT, 'state', `execution-results-${plan.plan_id}.json`);
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const text = runCli(['report', plan.plan_id, '--tenant', TENANT]);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('Stamper - Execution Results Manifest');
    expect(text.stdout).toContain(`Tenant:          ${TENANT}`);
    expect(text.stdout).toContain(`Total controls:  ${manifest.totalControls}`);
    expect(text.stdout).toContain(`Contract:        ${manifest.contractVersion}`);

    const json = runCli(['report', plan.plan_id, '--tenant', TENANT, '--format', 'json']);
    expect(json.status).toBe(0);
    const summary = JSON.parse(json.stdout.slice(json.stdout.indexOf('{')));
    expect(summary.planId).toBe(manifest.planId);
    expect(summary.runId).toBe(manifest.runId);
    expect(summary.totalControls).toBe(manifest.totalControls);
    const verdicts: Record<string, number> = {};
    for (const res of manifest.results) verdicts[res.verdict] = (verdicts[res.verdict] ?? 0) + 1;
    expect(summary.byVerdict).toEqual(verdicts);
    expect(Object.values(summary.byDirective).reduce((a: number, b: any) => a + b, 0)).toBe(manifest.results.length);
  }, 200_000);

  it('report fails clearly for a plan with no manifest; resume refuses a plan with no state', () => {
    const missing = runCli(['report', 'no-such-plan', '--tenant', TENANT]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('No execution-results manifest for plan no-such-plan');

    const other = path.join(tmpRoot, 'other-plan.json');
    fs.writeFileSync(other, JSON.stringify({ ...plan, plan_id: 'never-executed-plan' }));
    const r = runCli(['resume', `"${other}"`, '--dry-run']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Nothing to resume: no execution state recorded for plan never-executed-plan');
  }, 200_000);
});
