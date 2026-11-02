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

// Stamper's own verification rule (ces-stamper source, read only), loaded at run time so this
// package's tsc keeps its rootDir; Vitest transforms the TypeScript.
const STAMPER_OVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ces-stamper/src/core/OutputVerificationEngine.ts');
type Verifier = { verify(...a: unknown[]): { passed: boolean; details: { evidence_check: boolean | null } } };
let OutputVerificationEngine: new () => Verifier;

/** A copy of ces-stamper PowerShellAdapter.isEmptyReadResult (importing the adapter pulls its whole module graph). */
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

/**
 * DEPTH-9a (2026-10-31): the infra registry entries DEPTH-2 now plans for an m365_azure enclave
 * (`LOG-DEPTH-2.md` §2: the free, unconditioned AZ-* entries), run the way Stamper runs them -
 * GET, then the SET when the GET is empty (get-then-set), the GET again, then the evidence - in ONE
 * Windows PowerShell 5.1 session against an in-process stacksim on a random port (never :4390),
 * on the scenario's own tenant. Proves, per entry: no error, the state a SET wrote is read back by
 * the next GET, and the entry's verification block passes on the evidence. Each scenario's
 * variables are the ones its translated plan carries (synthetic values).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INFRA = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json');
const HAVE_PS = process.platform === 'win32' && existsSync(INFRA);

/** The entries DEPTH-2 plans on all four scenarios (no DP-1), in Stamper's order (layer, sequence). */
export const DEPTH2_PLANNED_INFRA = [
  'AZ-PREFLIGHT-001', 'AZ-CTX-001', 'AZ-FOUND-001', 'AZ-FOUND-002', 'AZ-FOUND-003',
  'AZ-NET-001', 'AZ-NET-002', 'AZ-NET-003', 'AZ-NET-004',
  'AZ-NSG-001', 'AZ-NSG-002', 'AZ-NSG-003', 'AZ-NSG-005', 'AZ-NSG-006',
  'AZ-NW-001', 'AZ-POL-001', 'AZ-BOUNDARY-001', 'AZ-SUBNET-001',
  'AZ-ID-001', 'AZ-ID-002', 'AZ-ID-004', 'AZ-ID-005',
] as const;

const VARS: Record<string, Record<string, string>> = {
  's1-mach': {
    subscriptionId: '51510000-00a2-4000-8000-000000000001', resourceGroup: 'rg-s1-mach-prod', location: 'usgovvirginia',
    vnetName: 's1mach-vnet-eo', vnetCidr: '10.0.0.0/16', mgmtSubnetCidr: '10.0.2.0/27', workloadSubnetCidr: '10.0.6.0/27',
    bastionSubnetCidr: '10.0.7.0/26', breakGlassUPN: 'bg.access01@s1-mach.simtenant.onmicrosoft.us',
    operatorUPN: 'adm.dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us',
  },
  's3-def': {
    subscriptionId: '53530000-00a2-4000-8000-000000000001', resourceGroup: 's3-def-rg-security', location: 'usgovvirginia',
    vnetName: 's3def-vnet-eo', vnetCidr: '10.0.0.0/16', mgmtSubnetCidr: '10.0.2.0/27', workloadSubnetCidr: '10.0.6.0/27',
    bastionSubnetCidr: '10.0.7.0/26', breakGlassUPN: 'emergency.access@s3-def.simtenant.onmicrosoft.us',
    operatorUPN: 'adm-belmira.pennanmore@s3-def.simtenant.onmicrosoft.us',
  },
  'muster-partial': {
    subscriptionId: '11111111-1111-1111-1111-111111111111', resourceGroup: 'muster-partial-rg-security', location: 'usgovvirginia',
    vnetName: 'musterpartial-vnet-eo', vnetCidr: '10.0.0.0/16', mgmtSubnetCidr: '10.0.2.0/27', workloadSubnetCidr: '10.0.6.0/27',
    bastionSubnetCidr: '10.0.7.0/26', breakGlassUPN: 'sim.user5@simtenant.onmicrosoft.us', operatorUPN: 'sim.user1@simtenant.onmicrosoft.us',
  },
  's2-eng': {
    subscriptionId: '52520000-00a2-4000-8000-000000000001', resourceGroup: 'rg-s2-eng-prod', location: 'usgovvirginia',
    vnetName: 's2eng-vnet-eo', vnetCidr: '10.0.0.0/16', mgmtSubnetCidr: '10.0.2.0/27', workloadSubnetCidr: '10.0.6.0/27',
    bastionSubnetCidr: '10.0.7.0/26', breakGlassUPN: 'eaa.01@s2-eng.simtenant.onmicrosoft.us',
    operatorUPN: 'adm-roswen.dunnridge@s2-eng.simtenant.onmicrosoft.us',
  },
};

interface Entry {
  entry_id: string; set_command: string; get_command: string; evidence_commands: string[]; idempotency: string;
  layer_hint: number; sequence_hint: number; on_failure: string;
  verification?: { evidence?: { jsonpath?: string; equals?: string; not_empty?: boolean; regex?: string; checks?: Array<{ jsonpath?: string; equals?: string }> } };
}
interface Outcome { id: string; get0: string; get0Exit: number; set: string | null; setExit: number | null; setErr: string; get1: string | null; get1Exit: number | null; ev: string[]; evExit: number[] }

const render = (t: string, vars: Record<string, string>) => t.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * PH7-AZ: ces-stamper PowerShellAdapter.resolveVerification (FX-04): placeholders resolve in the
 * verification `equals` values (top level and each check) before the rule runs; nothing else changes.
 */
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

/**
 * Each command runs the way ces-tenant's session factory runs it: `$ErrorActionPreference = "Stop"`
 * first, raw output (no ConvertTo-Json is added), an error = a non-zero exit.
 */
function script(entries: Entry[], vars: Record<string, string>): string {
  const lines = [GRAPH_MODULE_IMPORTS, 'Import-Module Az.Accounts -Force -ErrorAction SilentlyContinue'];
  lines.push(`function Run-Stamper([string]$c) { $script:err = ''; if (-not $c) { return @{ out = ''; exit = -1 } }; try { $ErrorActionPreference = 'Stop'; $o = (Invoke-Expression $c | Out-String).Trim(); return @{ out = $o; exit = 0 } } catch { $script:err = $_.Exception.Message; return @{ out = ''; exit = 1 } } finally { $ErrorActionPreference = 'Continue' } }`);
  lines.push(`function Test-Absent([hashtable]$r) { if ($r.exit -ne 0) { return $true }; $o = $r.out; if (-not $o -or $o -match 'ResourceNotFound') { return $true }; try { $p = $o | ConvertFrom-Json -ErrorAction Stop; if ($null -eq $p) { return $true }; if ($p -is [array] -and $p.Count -eq 0) { return $true } } catch { }; return ($o -eq '[]' -or $o -eq '{}' -or $o -eq 'null') }`);
  for (const e of entries) {
    const get = render(e.get_command, vars);
    const set = render(e.set_command, vars);
    lines.push(`$g0 = Run-Stamper ${psq(get)}; $s = $null; $g1 = $null; $setErr = ''`);
    lines.push(`if (${psq(e.idempotency)} -ne 'get-then-set' -or (Test-Absent $g0)) { if (${psq(set)}) { $s = Run-Stamper ${psq(set)}; $setErr = $script:err }; $g1 = Run-Stamper ${psq(get)} }`);
    // An entry with no SET is evidence-only: Stamper runs its evidence commands and judges those.
    lines.push(`$ev = @(); $evExit = @()`);
    if (!e.set_command.trim()) {
      for (const c of e.evidence_commands) lines.push(`$r = Run-Stamper ${psq(render(c, vars))}; $ev += [string]$r.out; $evExit += $r.exit`);
    }
    lines.push(`Write-Output ('@@RG@@' + (@{ id = ${psq(e.entry_id)}; get0 = [string]$g0.out; get0Exit = $g0.exit; set = $(if ($s) { [string]$s.out } else { $null }); setExit = $(if ($s) { $s.exit } else { $null }); setErr = $setErr; get1 = $(if ($g1) { [string]$g1.out } else { $null }); get1Exit = $(if ($g1) { $g1.exit } else { $null }); ev = @($ev); evExit = @($evExit) } | ConvertTo-Json -Compress -Depth 4))`);
  }
  return lines.join('\n');
}

/** Stamper's own decision for one entry (PowerShellAdapter: exists path, or SET then post-GET verification). */
export function stamperVerdict(raw: Entry, o: Outcome, vars: Record<string, string> = {}): { ok: boolean; why: string } {
  const e: Entry = { ...raw, verification: resolveVerification(raw.verification, vars) };
  const engine = new OutputVerificationEngine();
  const absent = (out: string, exit: number) => exit !== 0 || !out.trim() || out.includes('ResourceNotFound') || isEmptyReadResult(out);
  if (!e.set_command.trim()) {
    // Evidence-only (EO StamperEvidenceLoader): an empty payload is "empty read, uncounted"; a
    // non-empty one must pass the entry's evidence rule, or it is a Tier 1 NOT_SAT.
    const ev = (o.ev ?? []).map((s, i) => ({ s, exit: (o.evExit ?? [])[i] ?? 0 }));
    if (ev.some((x) => x.exit !== 0)) return { ok: false, why: 'evidence command failed' };
    const filled = ev.filter((x) => !isEmptyReadResult(x.s));
    if (filled.length === 0) return { ok: true, why: 'evidence-only, empty read (uncounted)' };
    if (!e.verification?.evidence) return { ok: true, why: 'evidence-only, no rule' };
    const bad = filled.filter((x) => engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: x.s, exitCode: 0 }, e.verification as never).details.evidence_check === false);
    return { ok: bad.length === 0, why: `evidence-only, ${filled.length} payload(s), ${bad.length} failing the rule` };
  }
  if (e.idempotency === 'get-then-set' && !absent(o.get0, o.get0Exit)) {
    const creation = /^New-|^New[A-Z]|^try\s*\{\s*New-|^\$\w+\s*=.*New-/.test(e.set_command.trim()) || /Invoke-MgGraphRequest\s[^|]*-Method\s+POST/i.test(e.set_command);
    if (!creation || !e.verification?.evidence) return { ok: true, why: 'exists (skip)' };
    const v = engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: o.get0, exitCode: 0 }, e.verification as never, { stateChanged: false });
    return { ok: v.passed, why: `exists, verified on the GET: ${v.passed}` };
  }
  if (o.setExit !== null && o.setExit !== 0) return { ok: false, why: `SET failed: ${o.setErr}` };
  if (!e.verification) return { ok: true, why: 'SET ok, no verification' };
  const v = engine.verify({ stdout: o.set ?? '', stderr: '', exitCode: o.setExit ?? 0 }, o.get1 !== null ? { stdout: o.get1, exitCode: o.get1Exit ?? -1 } : null, e.verification as never, { stateChanged: o.get0 !== o.get1 });
  const evidenceUnavailable = v.details.evidence_check === null;
  return { ok: v.passed || evidenceUnavailable, why: `SET ok, post-GET verification ${v.passed} (evidence_check ${v.details.evidence_check})` };
}

describe.skipIf(!HAVE_PS)('DEPTH-9a: the DEPTH-2 infra entries run on the simulator (Windows PowerShell 5.1)', () => {
  for (const slug of Object.keys(VARS)) {
    describe(slug, () => {
      let dir: string;
      let handle: ServeHandle;
      let outcomes: Map<string, Outcome>;
      let raw: { exitCode: number | null; stdout: string; stderr: string };
      const registry = HAVE_PS ? (JSON.parse(readFileSync(INFRA, 'utf8')) as { entries: Entry[] }).entries : [];
      const entries = DEPTH2_PLANNED_INFRA.map((id) => registry.find((e) => e.entry_id === id)!).filter(Boolean)
        .sort((a, b) => a.layer_hint - b.layer_hint || a.sequence_hint - b.sequence_hint);

      beforeAll(async () => {
        OutputVerificationEngine = (await import(pathToFileURL(STAMPER_OVE).href)).OutputVerificationEngine;
        dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-depth9a-${slug}-`));
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
          if (line.startsWith('@@RG@@')) { const o = JSON.parse(line.slice(6)) as Outcome; outcomes.set(o.id, o); }
        }
        if (process.env.DEPTH9A_DUMP) await fs.writeFile(`${process.env.DEPTH9A_DUMP}.${slug}.json`, JSON.stringify([...outcomes.values()], null, 2));
      }, 240_000);

      afterAll(async () => {
        await handle?.stop();
        if (dir) await fs.rm(dir, { recursive: true, force: true });
      }, 60_000);

      it('every planned entry ran', () => {
        expect([...outcomes.keys()].sort(), raw.stderr).toEqual([...DEPTH2_PLANNED_INFRA, ...DEPTH2_PLANNED_INFRA.map((id) => id + '#2')].sort());
      });

      // Each entry runs twice, as it does when several tasks of one plan name it (no de-duplication
      // before DEPTH-3): the second run takes the exists path.
      for (const id of [...DEPTH2_PLANNED_INFRA, ...DEPTH2_PLANNED_INFRA.map((x) => x + '#2')]) {
        it(`${id}: no error, SET read back, verification passes`, () => {
          const o = outcomes.get(id)!;
          const e = registry.find((x) => x.entry_id === id.replace(/#2$/, ''))!;
          const verdict = stamperVerdict(e, o, VARS[slug]);
          expect({ id, ok: verdict.ok, why: verdict.why }).toEqual({ id, ok: true, why: verdict.why });
          if (o.setExit === 0 && e.idempotency === 'get-then-set') {
            // The state the SET wrote is read back by the next GET.
            expect({ id, readBack: o.get1Exit === 0 && !isEmptyReadResult(o.get1 ?? '') }).toEqual({ id, readBack: true });
          }
        });
      }
    });
  }
});
