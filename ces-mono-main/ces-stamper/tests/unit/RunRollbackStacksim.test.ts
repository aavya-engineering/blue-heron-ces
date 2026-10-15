// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-ST3 — run-level rollback against stacksim.
//
// A real (non-dry-run) StamperEngine execution runs verbatim registry sub-commands
// through the production PowerShellAdapter, shadowed onto an in-process tenant-stacksim
// server. A deterministic fault on the TemporaryAccessPass URI makes a critical (p0)
// task fail mid-run. engine.rollback() then reverses the recorded SETs newest first,
// and the sim tenant returns to its pre-run state for every covered op (Graph PATCH with
// a JSON GET). The one uncovered op (SharePoint sharing: its GET returns a scalar, so no
// restore body can be derived) and the faulted TAP SET are reported as manual guidance,
// never silently skipped.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-st3-rb-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

import { StamperEngine } from '../../src/core/StamperEngine';
import { StamperConfig } from '../../src/config/StamperConfig';
import { startStacksim, applyEnv, type StacksimHarness } from '../helpers/stacksimHarness';

const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'registry', 'cmmc-l2-commands.registry.json'), 'utf-8'));
const entry = (id: string) => {
  const e = REGISTRY.entries.find((x: any) => x.entry_id === id);
  if (!e) throw new Error(`registry entry missing: ${id}`);
  return e;
};
/** Same mapping PlanTranslator uses to build _sub_commands from registry entries. */
const sub = (id: string) => {
  const e = entry(id);
  return {
    id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command,
    engine: e.engine, sequence_hint: e.sequence_hint, idempotency: e.idempotency,
    variables_required: e.variables_required, variables_runtime: e.variables_runtime,
    captures: e.captures, on_failure: e.on_failure, evidence_commands: e.evidence_commands,
    verification: e.verification,
  };
};
const task = (id: string, priority: string, subIds: string[], dependsOn: string[] = []) => ({
  id, type: 'configuration', priority, depends_on: dependsOn,
  action: { engine: 'mgraph', command: subIds.join(' + '), args: { _sub_commands: subIds.map(sub) } },
  inputs: [], outputs: [],
  controls: [...new Set(subIds.flatMap((s) => entry(s).control_ids as string[]))],
  idempotency: 'best_effort', rollback: { strategy: 'reverse_task' },
});

const AMC = '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations';
const COVERED = ['Fido2', 'MicrosoftAuthenticator', 'x509Certificate'];

describe('W4-ST3 run-level rollback on stacksim', () => {
  let sim: StacksimHarness;
  let restoreEnv: () => void;
  let planPath: string;

  const graphGet = async (uri: string) => {
    const res = await fetch(`${sim.url}${uri}`);
    expect(res.ok).toBe(true);
    return res.json() as Promise<Record<string, any>>;
  };

  beforeAll(async () => {
    sim = await startStacksim('w4-rollback');
    restoreEnv = applyEnv({ ...sim.shadowEnv, DRY_RUN: 'false' });
    const certPath = path.join(tmpRoot, 'sim-cert.pfx');
    fs.writeFileSync(certPath, 'sim');
    process.env.TENANT_ID = 'sim-tenant-w4-rollback';
    process.env.APP_ID = 'sim-app-w4';
    process.env.CERT_THUMBPRINT = 'SIMTHUMBPRINT0000000000000000000000000';
    process.env.CERT_PATH = certPath;

    const plan = {
      plan_id: 'w4-st3-rollback-plan',
      target_level: 'L2',
      tech_stack_id: 1,
      variables: {},
      prechecks: [],
      postchecks: [],
      execution_graph: [
        task('t1-fido2', 'p2', ['IA.L2-3.5.3.fido2-enable']),
        task('t2-authenticator-sharing', 'p2', ['IA.L2-3.5.3.mfa-authenticator', 'AC.L2-3.1.20.spo-sharing'], ['t1-fido2']),
        task('t3-cert-tap', 'p0', ['IA.L2-3.5.10.cert-auth', 'IA.L2-3.5.9.tap-config'], ['t2-authenticator-sharing']),
        task('t4-never-runs', 'p2', ['IA.L2-3.5.3.fido2-enable'], ['t3-cert-tap']),
      ],
    };
    planPath = path.join(tmpRoot, 'plan.json');
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  }, 60_000);

  afterAll(async () => {
    restoreEnv?.();
    for (const k of ['TENANT_ID', 'APP_ID', 'CERT_THUMBPRINT', 'CERT_PATH']) delete process.env[k];
    await sim?.stop();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ces.db handle on Windows */ }
  });

  it('a failed run is rolled back and the covered resources return to their pre-run state', async () => {
    // Pre-run snapshot, read through the sim's Graph facade.
    const before: Record<string, any> = {};
    for (const r of COVERED) before[r] = await graphGet(`${AMC}/${r}`);
    const sharingBefore = (await graphGet('/beta/admin/sharepoint/settings')).sharingCapability;
    for (const r of COVERED) expect(before[r].state).not.toBe('enabled');

    // Deterministic failure on the TAP sub-command (GET and SET both fault).
    await sim.setFaults([{ target: `${AMC}/TemporaryAccessPass`, kind: 'transient', times: 'always' }]);

    const engine = new StamperEngine(new StamperConfig());
    await engine.loadPlan(planPath);
    await expect(engine.execute()).rejects.toThrow(/Critical task t3-cert-tap failed/);

    const state = engine.getState();
    expect(state.status).toBe('failed');
    expect(state.tasks['t1-fido2'].status).toBe('completed');
    expect(state.tasks['t2-authenticator-sharing'].status).toBe('completed');
    expect(state.tasks['t3-cert-tap'].status).toBe('failed');
    expect(state.tasks['t4-never-runs']).toBeUndefined();

    // The run really changed the tenant (including the failed task's first sub-command).
    for (const r of COVERED) expect((await graphGet(`${AMC}/${r}`)).state).toBe('enabled');
    expect((await graphGet('/beta/admin/sharepoint/settings')).sharingCapability).toBe('disabled');

    // Applied ops recorded in apply order, with inverses for the covered ones.
    const ops = state.applied_ops as any[];
    const bySub = Object.fromEntries(ops.map((o) => [o.sub_command_id, o]));
    expect(bySub['IA.L2-3.5.3.fido2-enable'].kind).toBe('graph-patch');
    expect(bySub['IA.L2-3.5.3.mfa-authenticator'].kind).toBe('graph-patch');
    expect(bySub['IA.L2-3.5.10.cert-auth'].kind).toBe('graph-patch');
    expect(bySub['IA.L2-3.5.10.cert-auth'].task_id).toBe('t3-cert-tap');
    expect(bySub['AC.L2-3.1.20.spo-sharing'].kind).toBe('uncovered');
    expect(ops.map((o) => o.seq)).toEqual([...ops.map((o) => o.seq)].sort((a, b) => a - b));

    // Roll back.
    await sim.setFaults([]);
    const result = await engine.rollback();
    expect(result.executed).toBe(true);
    expect(result.failed).toEqual([]);
    // Newest first: t3's cert-auth before t2's authenticator before t1's fido2.
    expect(result.reversed.map((o) => o.sub_command_id)).toEqual([
      'IA.L2-3.5.10.cert-auth', 'IA.L2-3.5.3.mfa-authenticator', 'IA.L2-3.5.3.fido2-enable',
    ]);
    // Manual guidance, newest first: the faulted TAP SET (attempted; its effect cannot be
    // derived from a scalar GET) and the SharePoint sharing SET (scalar GET).
    expect(result.manual.map((o) => o.sub_command_id)).toEqual(['IA.L2-3.5.9.tap-config', 'AC.L2-3.1.20.spo-sharing']);

    // Covered resources are back to their pre-run state, property for property. OData
    // annotations are not configuration (a PATCH body's '@odata.type' is echoed onto the
    // sim object and cannot be un-set by PATCH), so they are excluded from the comparison.
    const config = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('@odata')));
    for (const r of COVERED) expect(config(await graphGet(`${AMC}/${r}`))).toEqual(config(before[r]));
    // Uncovered op honestly left as-is (manual guidance), not faked.
    expect((await graphGet('/beta/admin/sharepoint/settings')).sharingCapability).toBe('disabled');
    expect(sharingBefore).not.toBe('disabled');

    // Persisted: reversals marked, outcome recorded; a second rollback is a no-op.
    const after = engine.getState();
    expect(after.rollback).toMatchObject({ reversed: 3, failed: 0, manual: 2 });
    expect((after.applied_ops as any[]).filter((o) => o.kind === 'graph-patch').every((o) => o.reversed_at)).toBe(true);
    const again = await engine.rollback();
    expect(again.reversed).toEqual([]);
  }, 240_000);
});
