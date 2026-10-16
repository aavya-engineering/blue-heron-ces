// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-ST3 — rollback safety + inverse derivation (production code, no PowerShell).
//  - Sim-only guard: without a loopback STACKSIM_SERVER_URL the run-level rollback
//    refuses and executes nothing, even with reversible ops recorded.
//  - Inverse derivation from real registry SET commands and pre/post GET output.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-st3-guard-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;
process.env.DRY_RUN = 'true';

import { StateManager } from '../../src/state/StateManager';
import { StamperConfig } from '../../src/config/StamperConfig';
import { RollbackHandler } from '../../src/rollback/RollbackHandler';
import { deriveInverseOp, graphPatchUri, parseStateJson, simRollbackTarget } from '../../src/rollback/InverseOps';

const FIDO2_SET = "Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2' -Body (@{state='enabled'} | ConvertTo-Json) -ContentType 'application/json'";

afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ces.db handle on Windows */ }
});

describe('simRollbackTarget (sim-only guard)', () => {
  it.each([
    [{}, false],
    [{ STACKSIM_SERVER_URL: 'http://127.0.0.1:4390' }, true],
    [{ STACKSIM_SERVER_URL: 'http://localhost:4390' }, true],
    [{ STACKSIM_SERVER_URL: 'https://graph.microsoft.us' }, false],
    [{ STACKSIM_SERVER_URL: 'http://10.0.0.5:4390' }, false],
    [{ STACKSIM_SERVER_URL: 'not a url' }, false],
  ])('%j -> allowed=%s', (env, allowed) => {
    expect(simRollbackTarget(env as NodeJS.ProcessEnv).allowed).toBe(allowed);
  });
});

describe('RollbackHandler.rollbackAppliedOps', () => {
  const seed = (planId: string) => {
    const config = new StamperConfig();
    const sm = new StateManager(config, planId);
    sm.recordAppliedOps('t1', [deriveInverseOp({
      sub_command_id: 'IA.L2-3.5.3.fido2-enable', engine: 'mgraph', applied_command: FIDO2_SET,
      pre_state: '{"id":"Fido2","state":"disabled"}', post_state: '{"id":"Fido2","state":"enabled"}',
    })]);
    sm.recordAppliedOps('t2', [
      deriveInverseOp({ sub_command_id: 'x509', engine: 'mgraph', applied_command: FIDO2_SET.replace('Fido2', 'x509Certificate'),
        pre_state: '{"state":"disabled"}', post_state: '{"state":"enabled"}' }),
      deriveInverseOp({ sub_command_id: 'new-group', engine: 'mgraph', applied_command: 'New-MgGroup -DisplayName x' }),
    ]);
    return { sm, handler: new RollbackHandler(config, sm) };
  };

  it('refuses without a loopback stacksim target and executes nothing', async () => {
    const { sm, handler } = seed('guard-plan');
    const calls: string[] = [];
    const report = await handler.rollbackAppliedOps(async (_e, c) => { calls.push(c); return { stdout: '', stderr: '', exitCode: 0 }; }, {});
    expect(report.executed).toBe(false);
    expect(report.target).toMatch(/sim-only/);
    expect(calls).toEqual([]);
    expect(sm.getAppliedOps().every((o) => !o.reversed_at)).toBe(true);
    expect(report.manual.map((o) => o.sub_command_id)).toEqual(['new-group']);
  });

  it('on the sim target reverses newest first, records failures, and never re-reverses', async () => {
    const { sm, handler } = seed('order-plan');
    const calls: string[] = [];
    const env = { STACKSIM_SERVER_URL: 'http://127.0.0.1:4390' };
    const report = await handler.rollbackAppliedOps(async (_e, c) => {
      calls.push(c);
      return c.includes('x509Certificate') ? { stdout: '', stderr: 'boom', exitCode: 1 } : { stdout: '', stderr: '', exitCode: 0 };
    }, env);
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('x509Certificate');
    expect(calls[1]).toContain('Fido2');
    expect(calls[1]).toContain(`-Body '{"state":"disabled"}'`);
    expect(report.reversed.map((o) => o.sub_command_id)).toEqual(['IA.L2-3.5.3.fido2-enable']);
    expect(report.failed.map((o) => [o.sub_command_id, o.reverse_error])).toEqual([['x509', 'boom']]);
    expect(sm.getState().rollback).toMatchObject({ reversed: 1, failed: 1, manual: 1 });

    // Second pass retries only the failed op.
    const calls2: string[] = [];
    await handler.rollbackAppliedOps(async (_e, c) => { calls2.push(c); return { stdout: '', stderr: '', exitCode: 0 }; }, env);
    expect(calls2.length).toBe(1);
    expect(calls2[0]).toContain('x509Certificate');
  });
});

describe('deriveInverseOp', () => {
  it('graph PATCH with JSON GETs -> PATCH back the changed properties only', () => {
    const op = deriveInverseOp({
      sub_command_id: 's', engine: 'mgraph', applied_command: FIDO2_SET,
      pre_state: 'WARNING: x\n{"@odata.context":"c","id":"Fido2","state":"disabled","isSelfServiceRegistrationAllowed":true}\nSTAMPER_EXECUTION_SUCCESS',
      post_state: '{"@odata.context":"c","id":"Fido2","state":"enabled","isSelfServiceRegistrationAllowed":true}',
    });
    expect(op.kind).toBe('graph-patch');
    expect(op.restore_values).toEqual({ state: 'disabled' });
    expect(op.inverse_command).toBe(
      "Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2' -Body '{\"state\":\"disabled\"}' -ContentType 'application/json'",
    );
  });

  it('escapes single quotes in the restore body for PowerShell', () => {
    const op = deriveInverseOp({ sub_command_id: 's', engine: 'mgraph', applied_command: FIDO2_SET,
      pre_state: `{"displayName":"O'Brien"}`, post_state: '{"displayName":"x"}' });
    expect(op.inverse_command).toContain(`-Body '{"displayName":"O''Brien"}'`);
  });

  it('no state change -> noop; scalar GET -> uncovered; non-PATCH -> uncovered', () => {
    expect(deriveInverseOp({ sub_command_id: 's', engine: 'mgraph', applied_command: FIDO2_SET,
      pre_state: '{"state":"enabled"}', post_state: '{"state":"enabled"}' }).kind).toBe('noop');
    const scalar = deriveInverseOp({ sub_command_id: 's', engine: 'mgraph', applied_command: FIDO2_SET, pre_state: 'externalUserSharingOnly', post_state: 'disabled' });
    expect(scalar.kind).toBe('uncovered');
    expect(scalar.reason).toMatch(/not captured as JSON/);
    expect(deriveInverseOp({ sub_command_id: 's', engine: 'exchange', applied_command: 'Set-OrganizationConfig -AuditDisabled $false' }).kind).toBe('uncovered');
  });

  it('parses helpers', () => {
    expect(graphPatchUri(FIDO2_SET)).toMatch(/Fido2$/);
    expect(graphPatchUri("Invoke-MgGraphRequest -Uri 'https://x/y'")).toBeUndefined();
    expect(parseStateJson('[1,2]')).toBeUndefined();
    expect(parseStateJson(undefined)).toBeUndefined();
  });
});
