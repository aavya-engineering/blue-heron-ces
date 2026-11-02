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
 * PH-13 P13-INT golden (2026-11-01): the Stamper read PS.L2-3.9.2.leaver-access-terminated (verify-only), run as
 * Stamper runs it (Windows PowerShell 5.1 through the simulator's Graph shims, an in-process stacksim on a random port),
 * on each scenario's seed:
 *   - before any leaver flow: the inventory object is emitted (never an empty read) and the entry's checks FAIL where a
 *     past leaver is still enabled (S1, S2, S3) or where no past leaver exists (muster-partial);
 *   - S1 and S2: after the account-ending part of AdminOps A-22 (disable, group removal, direct licence removal, sent
 *     through the same shims), the read gives enabledPastLeaverCount 0 and licensedPastLeaverCount 0 and the checks PASS.
 * This is the evidence for the S1 / S2 rise predicted in PREDICT-RF11.md (AR5: an evidenced read of the expected value).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAMPER_SRC = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src');
const MAIN = path.join(STAMPER_SRC, 'registry', 'cmmc-l2-commands.registry.json');
const HAVE_PS = process.platform === 'win32' && existsSync(MAIN);
const ID = 'PS.L2-3.9.2.leaver-access-terminated';

interface Entry { entry_id: string; get_command: string; verify_only?: boolean; verification?: { evidence?: unknown } }
interface Run { id: string; out: string; exit: number; err: string }
type Verifier = { verify(...a: unknown[]): { passed: boolean; reason: string; details: { evidence_check: boolean | null } } };

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
function script(steps: Array<[string, string]>): string {
  const lines = [GRAPH_MODULE_IMPORTS];
  lines.push(`function Run-Stamper($__c) { $script:err = ''; try { $ErrorActionPreference = 'Stop'; $__o = (Invoke-Expression $__c | Out-String).Trim(); return @{ out = $__o; exit = 0 } } catch { $script:err = $_.Exception.Message; return @{ out = ''; exit = 1 } } }`);
  for (const [id, cmd] of steps) {
    lines.push(`$r = Run-Stamper ${psq(cmd)}; Write-Output ('@@LV@@' + (@{ id = ${psq(id)}; out = [string]$r.out; exit = $r.exit; err = [string]$script:err } | ConvertTo-Json -Compress -Depth 4))`);
  }
  return lines.join('\n');
}

/** The account-ending steps of A-22 (ces-ao TemplateRegistry.ts) for one leaver, through the Graph shims. */
const endAccess = (upn: string): string =>
  `& { $u = Get-MgUser -Filter "userPrincipalName eq '${upn}'" -Property Id,UserPrincipalName,AccountEnabled,AssignedLicenses | Select-Object -First 1; ` +
  `if ($null -eq $u) { throw 'leaver not found' }; ` +
  `Update-MgUser -UserId $u.Id -AccountEnabled:$false | Out-Null; ` +
  `Revoke-MgUserSignInSession -UserId $u.Id | Out-Null; ` +
  `foreach ($g in @(Get-MgUserMemberOf -UserId $u.Id -All)) { $t = [string]$g.'@odata.type'; if (-not $t) { $t = [string]$g.AdditionalProperties.'@odata.type' }; if ($t -eq '#microsoft.graph.group') { Remove-MgGroupMemberByRef -GroupId $g.Id -DirectoryObjectId $u.Id | Out-Null } }; ` +
  `$sku = @(@($u.AssignedLicenses) | Where-Object { $_ } | ForEach-Object { if ($_.SkuId) { $_.SkuId } else { $_.skuId } } | Where-Object { $_ }); ` +
  `if ($sku.Count -gt 0) { Set-MgUserLicense -UserId $u.Id -AddLicenses @() -RemoveLicenses $sku | Out-Null }; 'done' }`;

const SCENARIOS: Array<{ slug: string; leaver?: string; before: { past: number; enabledMin: number } }> = [
  { slug: 's1-mach', leaver: 'merrin.hollinmere', before: { past: 2, enabledMin: 1 } },
  { slug: 's2-eng', leaver: 'ext.calvane.heathford', before: { past: 1, enabledMin: 1 } },
  { slug: 's3-def', before: { past: 2, enabledMin: 2 } },
  { slug: 'muster-partial', before: { past: 0, enabledMin: 0 } },
];

describe.skipIf(!HAVE_PS)('PH-13 P13-INT: PS.L2-3.9.2.leaver-access-terminated on the simulator (Windows PowerShell 5.1)', () => {
  const registry = HAVE_PS ? (JSON.parse(readFileSync(MAIN, 'utf8')) as { entries: Entry[] }).entries : [];
  const entry = registry.find((e) => e.entry_id === ID)!;
  let Engine: new () => Verifier;
  let root: string;
  let psmodules: string;
  let hostModules: string;

  const verified = (read: string) =>
    new Engine().verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: read, exitCode: 0 }, entry.verification as never, { stateChanged: false });

  beforeAll(async () => {
    Engine = (await import(pathToFileURL(path.join(STAMPER_SRC, 'core', 'OutputVerificationEngine.ts')).href)).OutputVerificationEngine;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ph13int-lv-'));
    psmodules = path.join(root, 'psmodules');
    await generateAllModules(psmodules);
    hostModules = await getPowerShellHostModulesPath();
  }, 240_000);

  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  }, 60_000);

  it('the entry is verify-only with the inventory lookup and the three checks', () => {
    expect(entry).toBeDefined();
    expect(entry.verify_only).toBe(true);
  });

  for (const sc of SCENARIOS) {
    it(`${sc.slug}: ${sc.leaver ? 'NOT_SAT before the leaver flow, SAT after A-22 ends the leaver\'s access' : 'NOT_SAT (no confirm on this scenario)'}`, async () => {
      const dir = path.join(root, sc.slug);
      const tenantRoot = path.join(dir, 'tenant');
      const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${sc.slug}.json`));
      await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
      const handle: ServeHandle = await startServe({ stance: 'm365_azure', slug: sc.slug, port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
      try {
        const env = buildShadowedEnv(process.env, psmodules, hostModules);
        env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
        const users = (await handle.store.list('users')) as Array<Record<string, unknown>>;
        const upn = sc.leaver ? String(users.find((u) => String(u.userPrincipalName ?? '').toLowerCase().startsWith(`${sc.leaver}@`))?.userPrincipalName ?? '') : '';
        if (sc.leaver) expect(upn, `${sc.leaver} in the ${sc.slug} seed`).toMatch(/@/);
        const steps: Array<[string, string]> = [['get0', entry.get_command]];
        if (sc.leaver) steps.push(['a22', endAccess(upn)], ['get1', entry.get_command]);
        const file = path.join(dir, 'run.ps1');
        await fs.writeFile(file, script(steps), 'utf8');
        const raw = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], env);
        const r = new Map<string, Run>();
        for (const line of raw.stdout.split(/\r?\n/)) if (line.startsWith('@@LV@@')) { const o = JSON.parse(line.slice(6)) as Run; r.set(o.id, o); }
        expect(r.size, `${raw.stdout}\n${raw.stderr}`).toBe(steps.length);

        const g0 = r.get('get0')!;
        expect({ exit: g0.exit, err: g0.err }).toEqual({ exit: 0, err: '' });
        const before = JSON.parse(g0.out) as Record<string, number>;
        expect(before.displayName).toBe('CES leaver access inventory');
        expect(before.pastLeaverCount).toBe(sc.before.past);
        expect(before.enabledPastLeaverCount).toBeGreaterThanOrEqual(sc.before.enabledMin);
        expect(verified(g0.out).passed).toBe(false);

        if (sc.leaver) {
          expect({ exit: r.get('a22')!.exit, err: r.get('a22')!.err, out: r.get('a22')!.out }).toEqual({ exit: 0, err: '', out: 'done' });
          const g1 = r.get('get1')!;
          expect({ exit: g1.exit, err: g1.err }).toEqual({ exit: 0, err: '' });
          const after = JSON.parse(g1.out) as Record<string, number>;
          expect({ past: after.pastLeaverCount, enabled: after.enabledPastLeaverCount, licensed: after.licensedPastLeaverCount })
            .toEqual({ past: sc.before.past, enabled: 0, licensed: 0 });
          const v = verified(g1.out);
          expect({ passed: v.passed, evidence: v.details.evidence_check, reason: v.reason }).toMatchObject({ passed: true, evidence: true });
        }
      } finally {
        await handle.stop();
      }
    }, 180_000);
  }
});
