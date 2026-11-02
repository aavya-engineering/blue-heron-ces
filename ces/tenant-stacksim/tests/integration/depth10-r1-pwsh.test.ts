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
 * DEPTH-10.1 / 10.2 golden (PH-12 P12-R1, 2026-11-01): the AU and IA registry entries this batch
 * adds or re-aims, run from the registry text the way Stamper's PowerShellAdapter runs them, in ONE
 * Windows PowerShell 5.1 session against an in-process stacksim on a random port (never a fixed
 * port), on each scenario's own seeded tenant:
 *  - the GET; then the SET, unless the SET creates (New-* / POST) and the GET already found the
 *    object (the adapter's idempotent skip, which verifies the existing object instead);
 *  - the GET again, which must pass the entry's verification block (the postcheck's expected value)
 *    and must read the SET's state back.
 * Each entry runs twice, so the second run takes the exists path. Stamper's own verification code
 * (OutputVerificationEngine, lookup.verifyEquivalent) is loaded from ces-stamper's source, read only.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAMPER_SRC = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src');
const MAIN = path.join(STAMPER_SRC, 'registry', 'cmmc-l2-commands.registry.json');
const HAVE_PS = process.platform === 'win32' && existsSync(MAIN);

/** Entries of this batch whose commands the simulator must answer, in Stamper's order (layer, sequence). */
export const DEPTH10_R1_ENTRIES = [
  'AU.L2-3.3.2.mailbox-audit-default',
  'AU.L2-3.3.4.audit-config-alert',
  'AU.L2-3.3.8.compliance-admin-pim-expiry',
  'IA.L1-3.5.1.app-consent-restrict',
  'IA.L2-3.5.7.password-protection',
  'IA.L2-3.5.3.ca-mfa-all-users',
  'IA.L1-3.5.1.ca-compliant-device',
  'IA.L2-3.5.3.whfb-tenant',
  'IA.L2-3.5.10.credential-guard',
  'IA.L2-3.5.4.auth-strength',
  'IA.L2-3.5.10.cert-auth',
] as const;

/** Each scenario's variables, as its translated plan carries them (synthetic values). */
const VARS: Record<string, Record<string, string>> = {
  's1-mach': { breakGlassUPN: 'bg.access01@s1-mach.simtenant.onmicrosoft.us', cisoEmail: 'isso@s1-mach.simtenant.onmicrosoft.us' },
  's2-eng': { breakGlassUPN: 'eaa.01@s2-eng.simtenant.onmicrosoft.us', cisoEmail: 'isso@s2-eng.simtenant.onmicrosoft.us' },
  's3-def': { breakGlassUPN: 'emergency.access@s3-def.simtenant.onmicrosoft.us', cisoEmail: 'isso@s3-def.simtenant.onmicrosoft.us' },
  'muster-partial': { breakGlassUPN: 'sim.user5@simtenant.onmicrosoft.us', cisoEmail: 'isso@simtenant.onmicrosoft.us' },
};

/** Runtime captures resolved inside the session (the adapter takes them from earlier entries' GETs). */
const RUNTIME_MARK: Record<string, string> = { breakGlassUserId: '__RT_BG__' };

interface Entry {
  entry_id: string; set_command: string; get_command: string; idempotency: string; layer_hint: number; sequence_hint: number;
  verification?: { evidence?: { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath?: string; equals?: string }> } };
  lookup?: unknown;
}
interface Outcome { id: string; get0: string; get0Exit: number; get0Err: string; set: string | null; setExit: number | null; setErr: string; get1: string | null; get1Exit: number | null }
type Verifier = { verify(...a: unknown[]): { passed: boolean; reason: string; details: { evidence_check: boolean | null } } };
let OutputVerificationEngine: new () => Verifier;
let verifyEquivalent: (read: string, lookup: unknown, decisions: unknown) => { verification: { passed: boolean; reason: string } } | undefined;

const render = (t: string, vars: Record<string, string>) =>
  t.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => (k in vars ? vars[k] : k in RUNTIME_MARK ? RUNTIME_MARK[k] : m));
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** ces-stamper PowerShellAdapter.isEmptyReadResult (copied: importing the adapter pulls its whole module graph). */
function isEmptyReadResult(output: string): boolean {
  const text = output.trim();
  if (text === '') return true;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return false; }
  if (parsed === null || parsed === '') return true;
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (typeof parsed === 'object') {
    const keys = Object.keys(parsed as Record<string, unknown>);
    if (keys.length === 0) return true;
    const value = (parsed as Record<string, unknown>).value;
    return Array.isArray(value) && value.length === 0 && keys.every((k) => k === 'value' || k.startsWith('@odata'));
  }
  return false;
}
/** ces-stamper PowerShellAdapter: the SET creates an object (the idempotent skip applies only to these). */
const isCreation = (set: string) => /^New-|^New[A-Z]|^try\s*\{\s*New-|^\$\w+\s*=.*New-/.test(set.trim()) || /Invoke-MgGraphRequest\s[^|]*-Method\s+POST/i.test(set);
const exists = (out: string, exit: number) => exit === 0 && !!out.trim() && !out.includes('ResourceNotFound') && !isEmptyReadResult(out);

function resolveVerification(v: Entry['verification'], vars: Record<string, string>): Entry['verification'] {
  const ev = v?.evidence;
  if (!v || !ev) return v;
  return {
    ...v,
    evidence: {
      ...ev,
      ...(ev.equals !== undefined ? { equals: render(ev.equals, vars) } : {}),
      ...(ev.checks ? { checks: ev.checks.map((c) => (c.equals !== undefined ? { ...c, equals: render(c.equals, vars) } : c)) } : {}),
    },
  };
}

function script(entries: Entry[], vars: Record<string, string>): string {
  const lines = [GRAPH_MODULE_IMPORTS];
  lines.push(`$rtBg = [string](Get-MgUser -Filter ${psq(`userPrincipalName eq '${vars.breakGlassUPN}'`)}).Id`);
  lines.push(`function Run-Stamper($__r1Cmd) { $script:err = ''; if (-not $__r1Cmd) { return @{ out = ''; exit = -1 } }; $__r1Cmd = ([string]$__r1Cmd).Replace('__RT_BG__', $rtBg); try { $ErrorActionPreference = 'Stop'; $__r1Out = (Invoke-Expression $__r1Cmd | Out-String).Trim(); return @{ out = $__r1Out; exit = 0 } } catch { $script:err = $_.Exception.Message; return @{ out = ''; exit = 1 } } finally { $ErrorActionPreference = 'Continue' } }`);
  for (const e of entries) {
    const get = render(e.get_command, vars);
    const set = render(e.set_command, vars);
    const skipWhenFound = e.idempotency === 'get-then-set' && isCreation(e.set_command) ? '$true' : '$false';
    lines.push(`$g0 = Run-Stamper ${psq(get)}; $g0Err = $script:err; $s = $null; $g1 = $null; $setErr = ''`);
    lines.push(`$found = ($g0.exit -eq 0 -and $g0.out -and $g0.out -notmatch 'ResourceNotFound' -and $g0.out -ne '[]' -and $g0.out -ne '{}' -and $g0.out -ne 'null')`);
    lines.push(`if (-not (${skipWhenFound} -and $found)) { $s = Run-Stamper ${psq(set)}; $setErr = $script:err; $g1 = Run-Stamper ${psq(get)} }`);
    lines.push(`Write-Output ('@@R1@@' + (@{ id = ${psq(e.entry_id)}; get0 = [string]$g0.out; get0Exit = $g0.exit; get0Err = $g0Err; set = $(if ($s) { [string]$s.out } else { $null }); setExit = $(if ($s) { $s.exit } else { $null }); setErr = $setErr; get1 = $(if ($g1) { [string]$g1.out } else { $null }); get1Exit = $(if ($g1) { $g1.exit } else { $null }) } | ConvertTo-Json -Compress -Depth 4))`);
  }
  return lines.join('\n');
}

/** The adapter's decision for one entry: the exists path (creation SET, object found) or SET then post-GET verification. */
function stamperVerdict(raw: Entry, o: Outcome, vars: Record<string, string>): { ok: boolean; why: string } {
  const e: Entry = { ...raw, verification: resolveVerification(raw.verification, vars) };
  const engine = new OutputVerificationEngine();
  if (e.idempotency === 'get-then-set' && isCreation(e.set_command) && exists(o.get0, o.get0Exit)) {
    const eq = e.lookup ? verifyEquivalent(o.get0, e.lookup, undefined) : undefined;
    const v = eq ? eq.verification : engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: o.get0, exitCode: 0 }, e.verification as never, { stateChanged: false });
    return { ok: v.passed, why: `exists, verified on the GET (${eq ? 'equivalent by effect' : 'own object'}): ${v.reason}` };
  }
  if (o.setExit !== 0) return { ok: false, why: `SET failed: ${o.setErr}` };
  if (o.get1Exit !== 0 || o.get1 === null) return { ok: false, why: 'post-SET GET failed' };
  const v = engine.verify({ stdout: o.set ?? '', stderr: '', exitCode: 0 }, { stdout: o.get1, exitCode: 0 }, e.verification as never, { stateChanged: o.get0 !== o.get1 });
  return { ok: v.passed && v.details.evidence_check === true, why: `SET ok, post-GET verification ${v.passed} (evidence_check ${v.details.evidence_check}): ${v.reason}` };
}

describe.skipIf(!HAVE_PS)('DEPTH-10.1/10.2 (P12-R1): the AU and IA entries run on the simulator (Windows PowerShell 5.1)', () => {
  for (const slug of Object.keys(VARS)) {
    describe(slug, () => {
      let dir: string;
      let handle: ServeHandle;
      let outcomes: Map<string, Outcome>;
      let raw: { exitCode: number | null; stdout: string; stderr: string };
      const registry = HAVE_PS ? (JSON.parse(readFileSync(MAIN, 'utf8')) as { entries: Entry[] }).entries : [];
      const entries = DEPTH10_R1_ENTRIES.map((id) => registry.find((e) => e.entry_id === id)!).filter(Boolean)
        .sort((a, b) => a.layer_hint - b.layer_hint || a.sequence_hint - b.sequence_hint);

      beforeAll(async () => {
        OutputVerificationEngine = (await import(pathToFileURL(path.join(STAMPER_SRC, 'core', 'OutputVerificationEngine.ts')).href)).OutputVerificationEngine;
        verifyEquivalent = (await import(pathToFileURL(path.join(STAMPER_SRC, 'registry', 'lookup.ts')).href)).verifyEquivalent;
        dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-depth10r1-${slug}-`));
        const tenantRoot = path.join(dir, 'tenant');
        const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
        await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
        handle = await startServe({ stance: 'm365_azure', slug, port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
        const psmodules = path.join(dir, 'psmodules');
        await generateAllModules(psmodules);
        const env = buildShadowedEnv(process.env, psmodules, await getPowerShellHostModulesPath());
        env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
        const file = path.join(dir, 'run.ps1');
        await fs.writeFile(file, script([...entries, ...entries.map((e) => ({ ...e, entry_id: e.entry_id + '#2' }))], VARS[slug]), 'utf8');
        raw = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], env);
        outcomes = new Map();
        for (const line of raw.stdout.split(/\r?\n/)) {
          if (line.startsWith('@@R1@@')) { const o = JSON.parse(line.slice(6)) as Outcome; outcomes.set(o.id, o); }
        }
        if (process.env.DEPTH10_R1_DUMP) await fs.writeFile(`${process.env.DEPTH10_R1_DUMP}.${slug}.json`, JSON.stringify([...outcomes.values()], null, 2));
      }, 240_000);

      afterAll(async () => {
        await handle?.stop();
        if (dir) await fs.rm(dir, { recursive: true, force: true });
      }, 60_000);

      it('every entry ran', () => {
        expect([...outcomes.keys()].sort(), raw.stderr).toEqual([...DEPTH10_R1_ENTRIES, ...DEPTH10_R1_ENTRIES.map((id) => id + '#2')].sort());
      });

      for (const id of [...DEPTH10_R1_ENTRIES, ...DEPTH10_R1_ENTRIES.map((x) => x + '#2')]) {
        it(`${id}: no error, verification passes, the SET's state is read back`, () => {
          const o = outcomes.get(id)!;
          const e = registry.find((x) => x.entry_id === id.replace(/#2$/, ''))!;
          const verdict = stamperVerdict(e, o, VARS[slug]);
          expect({ id, ok: verdict.ok, why: verdict.why }).toEqual({ id, ok: true, why: verdict.why });
          if (o.setExit === 0) expect({ id, readBack: o.get1Exit === 0 && !isEmptyReadResult(o.get1 ?? '') }).toEqual({ id, readBack: true });
        });
      }
    });
  }
});
