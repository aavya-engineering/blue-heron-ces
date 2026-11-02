// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// Synthetic-customer W1: the per-run initialPassword and the conditional E6 overrides gate. No server, no sim.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TENANT_IDENTITY_KEYS,
  OVERRIDES_NOT_NEEDED_LINE,
  INITIAL_PASSWORD_ENV,
  PASSWORD_ALPHABET,
  decideOverrides,
  isPresent,
  missingTenantIdentityKeys,
  mintInitialPassword,
  runOverridesGate,
  withInitialPassword,
} from '../src/flow/overrides-gate.js';
import { runMusterE2e } from '../src/flow/muster-e2e-run.js';
import { loadMusterE2eForSlug } from '../src/scenarios/musterE2eFile.js';

const OLD_PLACEHOLDER = 'SimOnly-Placeholder-Not-A-Secret-01';
const fullIdentity = (): Record<string, unknown> => Object.fromEntries(TENANT_IDENTITY_KEYS.map((k) => [k, `v-${k}`]));

function scratch(ti: Record<string, unknown>, overrides?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-gate-'));
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs);
  const planPath = path.join(dir, 'executable-plan.json');
  fs.writeFileSync(planPath, JSON.stringify({ plan_id: 'p', variables: { ...ti } }, null, 2));
  const tmPath = path.join(dir, 'tenant-manifest-x.json');
  fs.writeFileSync(tmPath, JSON.stringify({ ces: {}, tenant_manifest: { tenant_identity: ti } }));
  const overridesPath = path.join(dir, 'sim-overrides.json');
  if (overrides !== undefined) fs.writeFileSync(overridesPath, overrides);
  return { dir, logs, planPath, tmPath, overridesPath };
}

describe('initialPassword minting (PLAN §2.3: the one harness-generated key)', () => {
  it('is 24 characters from the safe alphabet with every class, and differs per call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pw = mintInitialPassword();
      expect(pw).toHaveLength(24);
      expect([...pw].every((c) => PASSWORD_ALPHABET.includes(c))).toBe(true);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[-_.]/);
      expect(pw).not.toMatch(/['"{}`;|&$<>\s]/);
      expect(pw).not.toBe(OLD_PLACEHOLDER);
      seen.add(pw);
    }
    expect(seen.size).toBe(200);
  });

  it('reaches only the Stamper child env, without mutating the sim env', () => {
    const sim = { STACKSIM_SERVER_URL: 'http://127.0.0.1:4390' };
    const env = withInitialPassword(sim, 'Abc-123');
    expect(env[INITIAL_PASSWORD_ENV]).toBe('Abc-123');
    expect(env.STACKSIM_SERVER_URL).toBe(sim.STACKSIM_SERVER_URL);
    expect(INITIAL_PASSWORD_ENV in sim).toBe(false);
  });
});

describe('E6 overrides gate (conditional merge)', () => {
  it('presence rule: empty, blank, null and {token} are missing; numbers and booleans are present', () => {
    for (const v of ['', '  ', null, undefined, '{operatorUPN}', [], {}]) expect(isPresent(v)).toBe(false);
    for (const v of ['x', 0, false]) expect(isPresent(v)).toBe(true);
    expect(TENANT_IDENTITY_KEYS).toHaveLength(12);
    expect(TENANT_IDENTITY_KEYS).not.toContain('initialPassword');
  });

  it('decides: all present -> not-needed; missing -> refused, or transition with MX_ALLOW_OVERRIDES', () => {
    expect(decideOverrides(fullIdentity(), false)).toEqual({ mode: 'not-needed', missing: [] });
    expect(decideOverrides(fullIdentity(), true)).toEqual({ mode: 'not-needed', missing: [] });
    const ti = { ...fullIdentity(), touFileName: '', approverUPN: '{approverUPN}' };
    expect(decideOverrides(ti, false)).toEqual({ mode: 'refused', missing: ['approverUPN', 'touFileName'] });
    expect(decideOverrides(ti, true).mode).toBe('transition');
    expect(missingTenantIdentityKeys(undefined)).toEqual([...TENANT_IDENTITY_KEYS].sort());
  });

  it('not needed: the overrides file is never read (unparsable here) and the plan is untouched', () => {
    const s = scratch(fullIdentity(), '{ not json');
    const before = fs.readFileSync(s.planPath, 'utf8');
    const r = runOverridesGate({ planPath: s.planPath, tmPath: s.tmPath, overridesPath: s.overridesPath, logsDir: s.logs, allowOverrides: false });
    expect(r.rc).toBe(0);
    expect(r.line).toBe(OVERRIDES_NOT_NEEDED_LINE);
    expect(fs.readFileSync(path.join(s.logs, 'E6-overrides.out'), 'utf8').trim()).toBe(OVERRIDES_NOT_NEEDED_LINE);
    const log = JSON.parse(fs.readFileSync(path.join(s.logs, 'E6-overrides.json'), 'utf8'));
    expect(log).toMatchObject({ mode: 'not-needed', missing: [], applied: [], overrides_consulted: false, overrides_file: null });
    expect(fs.readFileSync(s.planPath, 'utf8')).toBe(before);
  });

  it('missing keys without MX_ALLOW_OVERRIDES: fails the run with the sorted list and leaves the plan alone', () => {
    const ti = fullIdentity();
    delete ti.subscriptionId;
    delete ti.breakGlassUserId;
    const s = scratch(ti, JSON.stringify({ _scope: 'simulator only; never load against a live tenant', variables: { subscriptionId: 'x' } }));
    const before = fs.readFileSync(s.planPath, 'utf8');
    const r = runOverridesGate({ planPath: s.planPath, tmPath: s.tmPath, overridesPath: s.overridesPath, logsDir: s.logs, allowOverrides: false });
    expect(r.rc).toBe(4);
    expect(r.line).toContain('REFUSED');
    expect(r.line).toContain('breakGlassUserId, subscriptionId');
    expect(r.log).toMatchObject({ mode: 'refused', missing: ['breakGlassUserId', 'subscriptionId'], overrides_consulted: false });
    expect(fs.readFileSync(s.planPath, 'utf8')).toBe(before);
  });

  it('transition (MX_ALLOW_OVERRIDES=1): merges only the missing keys, never initialPassword, and logs no values', () => {
    const ti = fullIdentity();
    delete ti.approvedIpRange;
    delete ti.touFileName;
    const ov = { _scope: 'simulator only; never load against a live tenant', variables: { approvedIpRange: '198.51.100.0/24', touFileName: 'sim-terms-of-use.pdf', operatorUPN: 'other', initialPassword: OLD_PLACEHOLDER } };
    const s = scratch(ti, JSON.stringify(ov));
    const r = runOverridesGate({ planPath: s.planPath, tmPath: s.tmPath, overridesPath: s.overridesPath, logsDir: s.logs, allowOverrides: true });
    expect(r.rc).toBe(0);
    expect(r.log).toMatchObject({ mode: 'transition', applied: ['approvedIpRange', 'touFileName'], overrides_consulted: true, overrides_file: 'sim-overrides.json' });
    const plan = JSON.parse(fs.readFileSync(s.planPath, 'utf8'));
    expect(plan.variables.approvedIpRange).toBe('198.51.100.0/24');
    expect(plan.variables.operatorUPN).toBe('v-operatorUPN');
    expect(plan.variables.initialPassword).toBeUndefined();
    const logText = fs.readFileSync(path.join(s.logs, 'E6-overrides.json'), 'utf8') + fs.readFileSync(path.join(s.logs, 'E6-overrides.out'), 'utf8');
    expect(logText).not.toContain('198.51.100.0/24');
    expect(logText).not.toContain(OLD_PLACEHOLDER);
  });

  it('transition refuses an overrides file that is not marked simulator-only', () => {
    const ti = fullIdentity();
    delete ti.roleDefId;
    const s = scratch(ti, JSON.stringify({ variables: { roleDefId: 'x' } }));
    const r = runOverridesGate({ planPath: s.planPath, tmPath: s.tmPath, overridesPath: s.overridesPath, logsDir: s.logs, allowOverrides: true });
    expect(r.rc).toBe(3);
    expect(JSON.parse(fs.readFileSync(s.planPath, 'utf8')).variables.roleDefId).toBeUndefined();
  });

  it('the dry-run record names the gate and the muster-api secret resolution, never a password value', async () => {
    const { file, scenario } = await loadMusterE2eForSlug('muster-partial');
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-dry-w1-'));
    const rec = await runMusterE2e({ scenario, scenarioPath: file, wsRoot: ws, packageRoot: path.join(ws, 'pkg'), dryRun: true, skipForcedRun: true, log: () => {} });
    const cmd = (id: string) => rec.steps.find((s) => s.id === id)!.commands.join(' ');
    expect(cmd('E6')).toContain('overrides gate');
    expect(cmd('E6')).not.toContain('apply-overrides');
    // Gap closure FLOW-5 (a): no harness-minted password; Stamper resolves muster-api's reference (E6, E8F).
    for (const id of ['E5', 'E6', 'E8F']) expect(cmd(id)).not.toContain(INITIAL_PASSWORD_ENV);
    expect(cmd('E6')).toContain('CES_MUSTER_SECRETS_URL=');
    expect(cmd('E3')).toContain('plan-compile.mjs');
    expect(JSON.stringify(rec)).not.toContain(OLD_PLACEHOLDER);
    expect(fs.readdirSync(ws)).toEqual([]);
  });

  // The package's overrides-gate.mjs (mx harness, verify.mjs V54) must agree with this mirror.
  const pkgGate = path.resolve('..', '..', 'pkg', 'ces-muster-run', 'scripts', 'overrides-gate.mjs');
  it.skipIf(!fs.existsSync(pkgGate))('matches the run package gate: keys, presence rule, decisions', async () => {
    const m = await import(pathToFileURL(pkgGate).href);
    expect(m.TENANT_IDENTITY_KEYS).toEqual([...TENANT_IDENTITY_KEYS]);
    expect(m.OVERRIDES_NOT_NEEDED_LINE).toBe(OVERRIDES_NOT_NEEDED_LINE);
    const cases: Array<Record<string, unknown>> = [fullIdentity(), {}, { ...fullIdentity(), roleDefId: '{roleDefId}' }, { ...fullIdentity(), adminUserName: 0 }];
    for (const ti of cases) for (const allow of [false, true]) expect(m.decideOverrides(ti, allow)).toEqual(decideOverrides(ti, allow));
  });
});
