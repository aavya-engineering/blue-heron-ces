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
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { generateAllModules } from '../../src/codegen/generatePsModule.js';
import { buildShadowedEnv, getPowerShellHostModulesPath, GRAPH_MODULE_IMPORTS, runProcess } from '../../src/coverage/psHarness.js';

/**
 * DEPTH-10.5 / 10.8 (PH-12 P12-R4): the SI and IR registry entries this batch adds or re-aims, run the way
 * Stamper runs them (GET; the SET when the GET is empty; the GET again; then the evidence), in ONE Windows
 * PowerShell 5.1 session against an in-process stacksim on a random port (never :4390), through the
 * generated wrapper modules, on the scenario's own seeded tenant. Same harness as depth9a-infra-pwsh.test.ts.
 * Proves per entry: no error, the SET is read back by the next GET, and the verification block passes.
 * (IR.L2-3.6.3.attack-sim, the third DEPTH-10.8 change, became a manual-upload item and sends no tenant call.)
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json');
const STAMPER_OVE = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'core', 'OutputVerificationEngine.ts');
const HAVE_PS = process.platform === 'win32' && existsSync(MAIN);

const WRITES = [
  'SI.L2-3.14.7.signin-risk-policy', 'SI.L2-3.14.7.user-risk-policy',
  'SI.L1-3.14.1.mde-onboarding', 'SI.L2-3.14.6.defender-traffic-monitoring',
  'IR.L2-3.6.1.user-reporting',
] as const;
const SCENARIOS = ['s1-mach', 'muster-partial'] as const;

interface Entry {
  entry_id: string; set_command: string; get_command: string; evidence_commands: string[]; idempotency: string;
  verification?: { evidence?: { equals?: string; checks?: Array<{ equals?: string }> } };
}
interface Outcome { id: string; get0: string; get0Exit: number; set: string | null; setExit: number | null; setErr: string; get1: string | null; get1Exit: number | null; ev: string[]; evExit: number[]; evErr: string }
type Verifier = { verify(...a: unknown[]): { passed: boolean; details: { evidence_check: boolean | null } } };

/** PowerShellAdapter's creation test: only a New-* / POST SET is skipped when its GET finds the object; a Set-* always runs. */
const isCreation = (set: string) => /^New-|^New[A-Z]|^try\s*\{\s*New-|^\$\w+\s*=.*New-/.test(set.trim()) || /Invoke-MgGraphRequest\s[^|]*-Method\s+POST/i.test(set);
const render = (t: string, vars: Record<string, string>) => t.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

function resolveVerification(v: Entry['verification'], vars: Record<string, string>): Entry['verification'] {
  const ev = v?.evidence;
  if (!v || !ev) return v;
  return { ...v, evidence: { ...ev, ...(ev.equals !== undefined ? { equals: render(ev.equals, vars) } : {}), ...(ev.checks ? { checks: ev.checks.map((c) => (c.equals !== undefined ? { ...c, equals: render(c.equals, vars) } : c)) } : {}) } };
}

function script(entries: Entry[], vars: Record<string, string>): string {
  const lines = [GRAPH_MODULE_IMPORTS, 'Import-Module ExchangeOnlineManagement -Force -ErrorAction SilentlyContinue'];
  lines.push(`function Run-Stamper([string]$c) { $script:err = ''; if (-not $c) { return @{ out = ''; exit = -1 } }; try { $ErrorActionPreference = 'Stop'; $o = (Invoke-Expression $c | Out-String).Trim(); return @{ out = $o; exit = 0 } } catch { $script:err = $_.Exception.Message; return @{ out = ''; exit = 1 } } finally { $ErrorActionPreference = 'Continue' } }`);
  lines.push(`function Test-Absent([hashtable]$r) { if ($r.exit -ne 0) { return $true }; $o = $r.out; if (-not $o -or $o -match 'ResourceNotFound') { return $true }; try { $p = $o | ConvertFrom-Json -ErrorAction Stop; if ($null -eq $p) { return $true }; if ($p -is [array] -and $p.Count -eq 0) { return $true } } catch { }; return ($o -eq '[]' -or $o -eq '{}' -or $o -eq 'null') }`);
  for (const e of entries) {
    const get = render(e.get_command, vars);
    const set = render(e.set_command, vars);
    lines.push(`$g0 = Run-Stamper ${psq(get)}; $s = $null; $g1 = $null; $setErr = ''`);
    const always = e.set_command.trim() !== '' && !isCreation(e.set_command) ? '$true' : '$false';
    lines.push(`if (${always} -or ${psq(e.idempotency)} -ne 'get-then-set' -or (Test-Absent $g0)) { if (${psq(set)}) { $s = Run-Stamper ${psq(set)}; $setErr = $script:err }; $g1 = Run-Stamper ${psq(get)} }`);
    lines.push(`$ev = @(); $evExit = @(); $evErr = ''`);
    for (const c of e.evidence_commands) lines.push(`$r = Run-Stamper ${psq(render(c, vars))}; $ev += [string]$r.out; $evExit += $r.exit; if ($r.exit -ne 0) { $evErr = $script:err }`);
    lines.push(`Write-Output ('@@RG@@' + (@{ id = ${psq(e.entry_id)}; get0 = [string]$g0.out; get0Exit = $g0.exit; set = $(if ($s) { [string]$s.out } else { $null }); setExit = $(if ($s) { $s.exit } else { $null }); setErr = $setErr; get1 = $(if ($g1) { [string]$g1.out } else { $null }); get1Exit = $(if ($g1) { $g1.exit } else { $null }); ev = @($ev); evExit = @($evExit); evErr = $evErr } | ConvertTo-Json -Compress -Depth 4))`);
  }
  return lines.join('\n');
}

async function resolve(port: number, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`http://127.0.0.1:${port}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json()) as { data?: unknown; error?: string };
  if (!r.ok) throw new Error(`resolve ${JSON.stringify(body)}: ${r.status} ${j.error ?? ''}`);
  return j.data;
}

describe.skipIf(!HAVE_PS)('DEPTH-10.5/10.8: the new SI and IR entries run on the simulator (Windows PowerShell 5.1)', () => {
  for (const slug of SCENARIOS) {
    describe(slug, () => {
      let dir: string;
      let handle: ServeHandle;
      let outcomes: Map<string, Outcome>;
      let raw: { exitCode: number | null; stdout: string; stderr: string };
      let vars: Record<string, string>;
      let OutputVerificationEngine: new () => Verifier;
      const registry = HAVE_PS ? (JSON.parse(readFileSync(MAIN, 'utf8')) as { entries: Entry[] }).entries : [];
      const byId = (id: string) => registry.find((e) => e.entry_id === id)!;

      beforeAll(async () => {
        OutputVerificationEngine = (await import(pathToFileURL(STAMPER_OVE).href)).OutputVerificationEngine;
        dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-depth10-r4-${slug}-`));
        const tenantRoot = path.join(dir, 'tenant');
        const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
        await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
        handle = await startServe({ stance: 'm365_azure', slug, port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
        // Runtime variables as the plan resolves them: an existing group and user of this tenant (synthetic).
        const groups = (await resolve(handle.port, { kind: 'uri', method: 'GET', uri: '/v1.0/groups' })) as { value: Array<{ id: string }> };
        const users = (await resolve(handle.port, { kind: 'uri', method: 'GET', uri: '/v1.0/users' })) as { value: Array<{ id: string; userPrincipalName?: string }> };
        vars = { cuiGroupId: groups.value[0].id, breakGlassUserId: users.value[users.value.length - 1].id, securityEmail: users.value[0].userPrincipalName ?? 'secops@sim.example' };
        const psmodules = path.join(dir, 'psmodules');
        await generateAllModules(psmodules);
        const env = buildShadowedEnv(process.env, psmodules, await getPowerShellHostModulesPath());
        env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
        const file = path.join(dir, 'run.ps1');
        const entries = [...WRITES].map(byId);
        // Run twice: the second pass proves get-then-set finds the object the first pass made (no duplicate SET).
        await fs.writeFile(file, script([...entries, ...entries.map((e) => ({ ...e, entry_id: e.entry_id + '#2' }))], vars), 'utf8');
        raw = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], env);
        outcomes = new Map();
        for (const line of raw.stdout.split(/\r?\n/)) {
          if (line.startsWith('@@RG@@')) { const o = JSON.parse(line.slice(6)) as Outcome; outcomes.set(o.id, o); }
        }
      }, 240_000);

      afterAll(async () => {
        await handle?.stop();
        if (dir) await fs.rm(dir, { recursive: true, force: true });
      }, 60_000);

      it('every entry ran', () => {
        const ids = [...WRITES];
        expect([...outcomes.keys()].sort(), raw.stderr).toEqual([...ids, ...ids.map((i) => i + '#2')].sort());
      });

      for (const id of WRITES) {
        it(`${id}: the GET does not yet hold the configured state, the SET succeeds, the next GET reads it back and passes verification`, () => {
          const o = outcomes.get(id)!;
          const e = byId(id);
          // Before the SET the entry is NOT_SAT on the GET (absent, or the default state).
          const pre = new OutputVerificationEngine().verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: o.get0, exitCode: 0 }, resolveVerification(e.verification, vars) as never, { stateChanged: false });
          expect({ id, preSat: pre.passed }).toEqual({ id, preSat: false });
          expect({ id, setExit: o.setExit, setErr: o.setErr }).toEqual({ id, setExit: 0, setErr: '' });
          expect({ id, get1Exit: o.get1Exit, readBack: !!o.get1 && o.get1.trim() !== '' }).toEqual({ id, get1Exit: 0, readBack: true });
          const v = new OutputVerificationEngine().verify({ stdout: o.set ?? '', stderr: '', exitCode: 0 }, { stdout: o.get1!, exitCode: 0 }, resolveVerification(e.verification, vars) as never, { stateChanged: o.get0 !== o.get1 });
          expect({ id, passed: v.passed, read: o.get1 }).toEqual({ id, passed: true, read: o.get1 });
          expect({ id, evExit: o.evExit }).toEqual({ id, evExit: e.evidence_commands.map(() => 0) });
        });

        it(`${id}#2: the second pass finds the object (a creation SET is not sent again; a Set-* re-applies the same values) and it still verifies`, () => {
          const o = outcomes.get(id + '#2')!;
          const creation = isCreation(byId(id).set_command);
          expect({ id, sentAgain: o.set !== null, get0Exit: o.get0Exit }).toEqual({ id, sentAgain: !creation, get0Exit: 0 });
          if (!creation) expect({ id, setExit: o.setExit }).toEqual({ id, setExit: 0 });
          const read = creation ? o.get0 : o.get1!;
          const v = new OutputVerificationEngine().verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: read, exitCode: 0 }, resolveVerification(byId(id).verification, vars) as never, { stateChanged: false });
          expect({ id, passed: v.passed }).toEqual({ id, passed: true });
          // The GET before the second pass already holds the first pass's state.
          expect({ id, before: new OutputVerificationEngine().verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: o.get0, exitCode: 0 }, resolveVerification(byId(id).verification, vars) as never, { stateChanged: false }).passed }).toEqual({ id, before: true });
        });
      }
    });
  }
});
