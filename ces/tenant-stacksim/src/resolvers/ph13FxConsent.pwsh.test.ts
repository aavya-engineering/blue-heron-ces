// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadScenario, applyScenario } from '../scenarios/ScenarioEngine.js';
import { startServe, type ServeHandle } from '../cli/commands/serve.js';
import { generateAllModules } from '../codegen/generatePsModule.js';
import { buildShadowedEnv, getPowerShellHostModulesPath, GRAPH_MODULE_IMPORTS, runProcess } from '../coverage/psHarness.js';

/**
 * PH-13 FX golden (2026-11-01): round R-F10 S1 failed IA.L1-3.5.1.app-consent-restrict in its SET with
 *   Exception setting "permissionGrantPoliciesAssigned": "The property 'permissionGrantPoliciesAssigned' cannot be found"
 * (C:\ces-nb\evidence\gc-rf10-s1-mach\logs\E6-execute.err line 4). AC.L1-3.1.2.default-user-permissions (layer 1,
 * sequence 3) had PATCHed defaultUserRolePermissions with three keys first, and the simulator's shallow merge
 * replaced the whole sub-object, so the read the old SET modified had no permissionGrantPoliciesAssigned member.
 * Windows PowerShell 5.1 against an in-process stacksim on a random port, on the s1-mach seed:
 *  (1) the round: the R-F10 stored shape + the OLD SET text reproduces the exception; the registry's SET then
 *      succeeds and its GET passes the entry's verification;
 *  (2) the order the round runs: AC.L1-3.1.2 then IA.L1-3.5.1 from the registry, both verified, and the
 *      default-user permissions neither entry names are kept.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAMPER_SRC = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src');
const MAIN = path.join(STAMPER_SRC, 'registry', 'cmmc-l2-commands.registry.json');
const HAVE_PS = process.platform === 'win32' && existsSync(MAIN);
const IA = 'IA.L1-3.5.1.app-consent-restrict';
const AC = 'AC.L1-3.1.2.default-user-permissions';

/** The SET that ran in R-F10 (registry text before PH-13 FX). */
const OLD_IA_SET = "$d = (Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/policies/authorizationPolicy').defaultUserRolePermissions; $d.allowedToCreateApps = $false; $d.permissionGrantPoliciesAssigned = @(); Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authorizationPolicy' -Body (@{defaultUserRolePermissions=$d} | ConvertTo-Json -Depth 5) -ContentType 'application/json'";
/** defaultUserRolePermissions as R-F10 S1 stored it after AC.L1-3.1.2 (ac.l1-3.1.2.default-user-permissions.json rawResponse). */
const RF10_DURP = { allowedToCreateSecurityGroups: false, allowedToCreateTenants: false, allowedToCreateApps: false };

interface Entry { entry_id: string; set_command: string; get_command: string; verification?: { evidence?: unknown } }
interface Run { id: string; out: string; exit: number; err: string }
type Verifier = { verify(...a: unknown[]): { passed: boolean; reason: string; details: { evidence_check: boolean | null } } };

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
function script(steps: Array<[string, string]>): string {
  const lines = [GRAPH_MODULE_IMPORTS];
  lines.push(`function Run-Stamper($__c) { $script:err = ''; try { $ErrorActionPreference = 'Stop'; $__o = (Invoke-Expression $__c | Out-String).Trim(); return @{ out = $__o; exit = 0 } } catch { $script:err = $_.Exception.Message; return @{ out = ''; exit = 1 } } finally { $ErrorActionPreference = 'Continue' } }`);
  for (const [id, cmd] of steps) {
    lines.push(`$r = Run-Stamper ${psq(cmd)}; Write-Output ('@@FX@@' + (@{ id = ${psq(id)}; out = [string]$r.out; exit = $r.exit; err = [string]$script:err } | ConvertTo-Json -Compress -Depth 4))`);
  }
  return lines.join('\n');
}

describe.skipIf(!HAVE_PS)('PH-13 FX: IA.L1-3.5.1.app-consent-restrict and AC.L1-3.1.2.default-user-permissions on the s1-mach simulator (Windows PowerShell 5.1)', () => {
  const registry = HAVE_PS ? (JSON.parse(readFileSync(MAIN, 'utf8')) as { entries: Entry[] }).entries : [];
  const entry = (id: string) => registry.find((e) => e.entry_id === id)!;
  let Engine: new () => Verifier;
  let dir: string;
  let handle: ServeHandle;
  let env: NodeJS.ProcessEnv;

  const run = async (name: string, steps: Array<[string, string]>): Promise<Map<string, Run>> => {
    const file = path.join(dir, `${name}.ps1`);
    await fs.writeFile(file, script(steps), 'utf8');
    const raw = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], env);
    const m = new Map<string, Run>();
    for (const line of raw.stdout.split(/\r?\n/)) if (line.startsWith('@@FX@@')) { const o = JSON.parse(line.slice(6)) as Run; m.set(o.id, o); }
    if (m.size !== steps.length) throw new Error(`ran ${m.size} of ${steps.length}\n${raw.stdout}\n${raw.stderr}`);
    return m;
  };
  const verified = (id: string, read: string) =>
    new Engine().verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: read, exitCode: 0 }, entry(id).verification as never, { stateChanged: true });
  const durp = async () => ((await handle.store.read('authorizationPolicy', 'authorizationPolicy')) as Record<string, any>).defaultUserRolePermissions as Record<string, unknown>;

  beforeAll(async () => {
    Engine = (await import(pathToFileURL(path.join(STAMPER_SRC, 'core', 'OutputVerificationEngine.ts')).href)).OutputVerificationEngine;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ph13fx-'));
    const tenantRoot = path.join(dir, 'tenant');
    const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', 's1-mach.json'));
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    handle = await startServe({ stance: 'm365_azure', slug: 's1-mach', port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    const psmodules = path.join(dir, 'psmodules');
    await generateAllModules(psmodules);
    env = buildShadowedEnv(process.env, psmodules, await getPowerShellHostModulesPath());
    env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
  }, 240_000);

  afterAll(async () => {
    await handle?.stop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }, 60_000);

  it('the seed carries the v1.0 shape (consent in defaultUserRolePermissions.permissionGrantPoliciesAssigned)', async () => {
    const p = (await handle.store.read('authorizationPolicy', 'authorizationPolicy')) as Record<string, any>;
    expect(p.permissionGrantPolicyIdsAssignedToDefaultUserRole).toBeUndefined();
    expect(p.allowedToUseSSPR).toBe(true);
    expect(p.defaultUserRolePermissions.allowedToUseSSPR).toBeUndefined();
    expect(p.defaultUserRolePermissions.permissionGrantPoliciesAssigned).toEqual(['ManagePermissionGrantsForSelf.microsoft-user-default-legacy']);
  });

  it('(1) R-F10 shape: the old SET reproduces the round failure; the registry SET then succeeds and verifies', async () => {
    await handle.store.update('authorizationPolicy', 'authorizationPolicy', { defaultUserRolePermissions: { ...RF10_DURP } });
    const r = await run('rf10', [['old-set', OLD_IA_SET], ['new-set', entry(IA).set_command], ['get', entry(IA).get_command]]);
    expect(r.get('old-set')!.exit).toBe(1);
    expect(r.get('old-set')!.err).toMatch(/The property 'permissionGrantPoliciesAssigned' cannot be found/);
    expect(r.get('new-set')!).toMatchObject({ exit: 0, err: '' });
    expect(r.get('get')!.exit).toBe(0);
    const v = verified(IA, r.get('get')!.out);
    expect({ passed: v.passed, evidence: v.details.evidence_check, read: r.get('get')!.out }).toMatchObject({ passed: true, evidence: true });
    expect(await durp()).toEqual({ ...RF10_DURP, permissionGrantPoliciesAssigned: [] });
  }, 120_000);

  it('(2) the round order on the seed: AC.L1-3.1.2 then IA.L1-3.5.1, both verified, other permissions kept', async () => {
    await handle.store.update('authorizationPolicy', 'authorizationPolicy', {
      defaultUserRolePermissions: { allowedToCreateApps: true, allowedToCreateSecurityGroups: true, allowedToCreateTenants: false, allowedToReadBitlockerKeysForOwnedDevice: true, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy'] },
    });
    const r = await run('order', [
      ['ac-get0', entry(AC).get_command], ['ac-set', entry(AC).set_command], ['ac-get1', entry(AC).get_command],
      ['ia-get0', entry(IA).get_command], ['ia-set', entry(IA).set_command], ['ia-get1', entry(IA).get_command],
    ]);
    for (const k of r.keys()) expect({ k, exit: r.get(k)!.exit, err: r.get(k)!.err }).toEqual({ k, exit: 0, err: '' });
    // AC's consent check now reads the v1.0 property: true before its SET, false after.
    expect(JSON.parse(r.get('ac-get0')!.out).userConsentAllowed).toBe(true);
    expect(verified(AC, r.get('ac-get0')!.out).passed).toBe(false);
    expect(verified(AC, r.get('ac-get1')!.out).passed).toBe(true);
    expect(JSON.parse(r.get('ia-get0')!.out).userConsentPolicies).toBe(0);
    expect(verified(IA, r.get('ia-get1')!.out).passed).toBe(true);
    expect(await durp()).toEqual({ allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowedToCreateTenants: false, allowedToReadBitlockerKeysForOwnedDevice: true, allowedToReadOtherUsers: true, permissionGrantPoliciesAssigned: [] });
  }, 120_000);
});
