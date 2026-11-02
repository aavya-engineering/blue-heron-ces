// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { generateAllModules } from '../../src/codegen/generatePsModule.js';
import { buildShadowedEnv, runProcess } from '../../src/coverage/psHarness.js';
import {
  CLEAN_G5_BREAK_GLASS_UPNS,
  CLEAN_G5_OPERATOR_UPN,
  CLEAN_G5_SUBSCRIPTION_ID,
  CLEAN_G5_TENANT_ID,
} from '../../src/profiles/clean-g5.js';

/**
 * FIN-21 (2026-10-31): the REAL ces-stamper/scripts/New-TenantBootstrap.ps1,
 * under PowerShell 7 with -Simulator, against an in-process stacksim server
 * on a random port (never :4390) serving the clean-g5 tenant. Proves the
 * bootstrap leg of V117: app registration, a non-exportable certificate
 * attached by thumbprint, the Graph + Exchange.ManageAsApp grants (SharePoint
 * held), the subscription roles, Security Defaults off at the scripted
 * (simulator-only) answer, break-glass verified, licence check and
 * assignment, and the result file the tenant record is built from.
 *
 * The certificate is a real CurrentUser\My certificate (that is what makes
 * "non-exportable" provable); afterAll removes it by thumbprint. Skipped when
 * pwsh is not installed.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'scripts', 'New-TenantBootstrap.ps1');
const PWSH = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output $PSHOME'], { encoding: 'utf8' });
const HAVE_PWSH = PWSH.status === 0 && existsSync(SCRIPT);
type Row = Record<string, any>;

describe.skipIf(!HAVE_PWSH)('FIN-21: New-TenantBootstrap.ps1 -Simulator on clean-g5 (pwsh 7)', () => {
  let dir: string;
  let handle: ServeHandle;
  let env: NodeJS.ProcessEnv;
  let result: Row;
  let run: { exitCode: number | null; stdout: string; stderr: string };

  const pwsh = (args: string[], e: NodeJS.ProcessEnv = env) =>
    runProcess('pwsh', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], e);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-fin21-pwsh-'));
    const tenantRoot = path.join(dir, 'tenant');
    const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', 'clean-g5.json'));
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    handle = await startServe({ stance: 'm365_azure', slug: 'clean-g5', port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    const psmodules = path.join(dir, 'psmodules');
    await generateAllModules(psmodules);
    env = buildShadowedEnv(process.env, psmodules, path.join(PWSH.stdout.trim(), 'Modules'));
    env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
    delete env.CES_HELD_STANDING_GRANTS_ENABLED;

    run = await pwsh([
      '-File', SCRIPT,
      '-TenantId', CLEAN_G5_TENANT_ID,
      '-DisplayName', 'CES-Fin21-Sim',
      '-Environment', 'GCCHigh',
      '-Simulator',
      '-SecurityDefaultsAnswer', 'yes',
      '-SubscriptionId', CLEAN_G5_SUBSCRIPTION_ID,
      '-BreakGlassUpn', CLEAN_G5_BREAK_GLASS_UPNS.join(','),
      '-LicenseUpn', CLEAN_G5_OPERATOR_UPN,
      '-CertStorePath', path.join(dir, 'certs'),
      '-ResultPath', path.join(dir, 'result.json'),
    ]);
    if (existsSync(path.join(dir, 'result.json'))) {
      result = JSON.parse((await fs.readFile(path.join(dir, 'result.json'), 'utf8')).replace(/^﻿/, ''));
    }
  }, 180_000);

  afterAll(async () => {
    const tp = result?.cert_thumbprint;
    if (typeof tp === 'string' && /^[0-9A-F]{40}$/i.test(tp)) {
      await runProcess('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item -Path 'Cert:\\CurrentUser\\My\\${tp}' -ErrorAction SilentlyContinue`], process.env);
    }
    await handle?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }, 60_000);

  it('exits 0 and writes the result file', () => {
    expect(run.exitCode, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(result).toBeTruthy();
    expect(result).toMatchObject({ schema: 'ces-stamper/bootstrap-result@1', tenant_id: CLEAN_G5_TENANT_ID, simulator: true, cert_source: 'store' });
  });

  it('created the app and its service principal, with the certificate attached by thumbprint and no key material', async () => {
    const apps = (await handle.store.list('applications')) as Row[];
    expect(apps).toHaveLength(1);
    expect(apps[0].appId).toBe(result.app_id);
    expect(apps[0].keyCredentials).toHaveLength(1);
    expect(apps[0].keyCredentials[0].customKeyIdentifier).toBe(String(result.cert_thumbprint).toUpperCase());
    expect(apps[0].keyCredentials[0].key).toBeNull();
    const sps = (await handle.store.list('servicePrincipals')) as Row[];
    expect(sps.filter((s) => s.appId === result.app_id)).toHaveLength(1);
  });

  it('the certificate key is non-exportable and no PFX was written', async () => {
    const probe = await runProcess(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-Command',
        `$c = Get-Item 'Cert:\\CurrentUser\\My\\${result.cert_thumbprint}'; $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c); try { [void]$k.ExportParameters($true); 'EXPORTABLE' } catch { 'NON_EXPORTABLE' }`],
      process.env,
    );
    expect(probe.stdout.trim()).toBe('NON_EXPORTABLE');
    const files = await fs.readdir(path.join(dir, 'certs'));
    expect(files.some((f) => /\.pfx$/i.test(f))).toBe(false);
    expect(files).toContain('CES-Fin21-Sim.cer');
  });

  it('grants every Graph permission and Exchange.ManageAsApp; SharePoint Sites.FullControl.All is HELD', async () => {
    expect(result.permissions).toMatchObject({ granted: 24, skipped: 0, failed: 0, held: ['Sites.FullControl.All'] });
    const sp = ((await handle.store.list('servicePrincipals')) as Row[]).find((s) => s.appId === result.app_id)!;
    const grants = ((await handle.store.list('servicePrincipalAppRoleAssignments')) as Row[]).filter((a) => a.principalId === sp.id);
    expect(grants).toHaveLength(24);
    expect(grants.some((g) => g.resourceDisplayName === 'Office 365 SharePoint Online')).toBe(false);
    expect(grants.filter((g) => g.appRoleValue === 'Exchange.ManageAsApp')).toHaveLength(1);
  });

  it('assigns the subscription roles, turns Security Defaults off, verifies break-glass, checks and assigns licences', async () => {
    expect(result.subscription).toMatchObject({ status: 'ok', roles_assigned: ['Contributor', 'User Access Administrator'] });
    expect(result.security_defaults).toBe('disabled_by_operator');
    expect(((await handle.store.list('identitySecurityDefaultsEnforcementPolicy')) as Row[])[0].isEnabled).toBe(false);
    expect(result.break_glass).toMatchObject({ verified: true, upns: [...CLEAN_G5_BREAK_GLASS_UPNS] });
    expect(result.break_glass.user_ids).toHaveLength(2);
    expect(result.licenses).toMatchObject({ check: 'ok', assigned: [CLEAN_G5_OPERATOR_UPN], failed: [] });
    const op = ((await handle.store.list('users')) as Row[]).find((u) => u.userPrincipalName === CLEAN_G5_OPERATOR_UPN)!;
    expect(op.assignedLicenses).toHaveLength(1);
    expect(result.validation_passed).toBe(true);
  });

  it('refuses a scripted Security Defaults answer without -Simulator, and -Simulator on a non-sim tenant id', async () => {
    const live = await pwsh(['-File', SCRIPT, '-TenantId', '11111111-2222-3333-4444-555555555555', '-DisplayName', 'x', '-Environment', 'GCCHigh', '-SecurityDefaultsAnswer', 'yes']);
    expect(live.exitCode).toBe(1);
    expect(live.stdout).toMatch(/accepted only with -Simulator/);
    const notSim = await pwsh(['-File', SCRIPT, '-TenantId', '11111111-2222-3333-4444-555555555555', '-DisplayName', 'x', '-Environment', 'GCCHigh', '-Simulator']);
    expect(notSim.exitCode).toBe(1);
    expect(notSim.stdout).toMatch(/refuses tenant id/);
  }, 60_000);
});
