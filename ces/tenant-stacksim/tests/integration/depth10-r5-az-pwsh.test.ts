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
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { generateAllModules } from '../../src/codegen/generatePsModule.js';
import { buildShadowedEnv, getPowerShellHostModulesPath, GRAPH_MODULE_IMPORTS, runProcess } from '../../src/coverage/psHarness.js';

/**
 * PH-12 P12-R5: the infra entries the simulator could not answer (PH12-FAMILY-GAPS.md "Simulator cannot answer":
 * AZ-LOG-002b, AZ-NET-007, AZ-NSG-007, AZ-SEP-001, AZ-VM-001, AZ-VM-002, AZ-VM-005; AZ-POL-001 was a coverage-tool
 * false positive), run the way Stamper runs them, in ONE Windows PowerShell 5.1 session against an in-process
 * stacksim on a random port (never :4390), on s1-mach (the scenario with an Azure estate). The DEPTH-2 entries
 * they build on (VNet, subnets, workload NSG, the no-public-IP policy) run first, as in a plan. AZ-VM-002 also runs
 * against a seeded VM without encryption at host, so its stop / update / start path is exercised.
 * Same harness as depth9a-infra-pwsh.test.ts. ces-strategy docs/context/finish/LOG-PH12-R5.md.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INFRA = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json');
const STAMPER_OVE = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'core', 'OutputVerificationEngine.ts');
const HAVE_PS = process.platform === 'win32' && existsSync(INFRA);
type Verifier = { verify(...a: unknown[]): { passed: boolean; details: { evidence_check: boolean | null } } };
let OutputVerificationEngine: new () => Verifier;

const PREREQ = ['AZ-CTX-001', 'AZ-FOUND-001', 'AZ-NET-001', 'AZ-NET-002', 'AZ-NET-003', 'AZ-NSG-001', 'AZ-NSG-005', 'AZ-POL-001'];
export const R5_AZ_GAPS = ['AZ-LOG-002b', 'AZ-NSG-007', 'AZ-SEP-001', 'AZ-VM-001', 'AZ-VM-002', 'AZ-VM-005', 'AZ-NET-007'] as const;

const SLUG = 's1-mach';
const BASE_VARS: Record<string, string> = {
  subscriptionId: '51510000-00a2-4000-8000-000000000001', resourceGroup: 'rg-s1-mach-prod', location: 'usgovvirginia',
  vnetName: 's1mach-vnet-eo', vnetCidr: '10.0.0.0/16', mgmtSubnetCidr: '10.0.2.0/27', workloadSubnetCidr: '10.0.6.0/27',
  bastionSubnetCidr: '10.0.7.0/26', breakGlassUPN: 'bg.access01@s1-mach.simtenant.onmicrosoft.us',
  operatorUPN: 'adm.dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us',
  vmName: 'vm-ces-01', vmImage: 'Win2022Datacenter', vmSize: 'Standard_D2s_v5', storageAccountName: 'simstorage1',
  m365Ipv4Ranges: '52.127.0.0/16, 20.140.0.0/15, 52.127.0.0/16, 2001:489a::/32',
  hostFirewallPackageUri: 'https://cesartifacts.blob.core.usgovcloudapi.net/gc/CesHostFirewall_1.0.0.zip',
  hostFirewallPackageHash: '5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F1A2B3C4D5E6F',
};

interface Entry {
  entry_id: string; set_command: string; get_command: string; evidence_commands: string[]; idempotency: string;
  layer_hint: number; sequence_hint: number;
  verification?: { evidence?: { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath?: string; equals?: string }> } };
}
interface Run { id: string; entry: Entry; vars: Record<string, string> }
interface Outcome { id: string; get0: string; get0Exit: number; set: string | null; setExit: number | null; setErr: string; get1: string | null; get1Exit: number | null; ev: string[]; evExit: number[]; evErr: string[] }

const render = (t: string, vars: Record<string, string>) => t.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

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

function script(runs: Run[]): string {
  const lines = [GRAPH_MODULE_IMPORTS, 'Import-Module Az.Accounts -Force -ErrorAction SilentlyContinue'];
  lines.push(`function Run-Stamper([string]$c) { $script:err = ''; if (-not $c) { return @{ out = ''; exit = -1 } }; try { $ErrorActionPreference = 'Stop'; $o = (Invoke-Expression $c | Out-String).Trim(); return @{ out = $o; exit = 0 } } catch { $script:err = $_.Exception.Message; return @{ out = ''; exit = 1 } } finally { $ErrorActionPreference = 'Continue' } }`);
  lines.push(`function Test-Absent([hashtable]$r) { if ($r.exit -ne 0) { return $true }; $o = $r.out; if (-not $o -or $o -match 'ResourceNotFound') { return $true }; try { $p = $o | ConvertFrom-Json -ErrorAction Stop; if ($null -eq $p) { return $true }; if ($p -is [array] -and $p.Count -eq 0) { return $true } } catch { }; return ($o -eq '[]' -or $o -eq '{}' -or $o -eq 'null') }`);
  for (const { id, entry: e, vars } of runs) {
    const get = render(e.get_command, vars);
    const set = render(e.set_command, vars);
    lines.push(`$g0 = Run-Stamper ${psq(get)}; $s = $null; $g1 = $null; $setErr = ''`);
    lines.push(`if (${psq(e.idempotency)} -ne 'get-then-set' -or (Test-Absent $g0)) { if (${psq(set)}) { $s = Run-Stamper ${psq(set)}; $setErr = $script:err }; $g1 = Run-Stamper ${psq(get)} }`);
    lines.push(`$ev = @(); $evExit = @(); $evErr = @()`);
    for (const c of e.evidence_commands) lines.push(`$r = Run-Stamper ${psq(render(c, vars))}; $ev += [string]$r.out; $evExit += $r.exit; $evErr += [string]$script:err`);
    lines.push(`Write-Output ('@@RG@@' + (@{ id = ${psq(id)}; get0 = [string]$g0.out; get0Exit = $g0.exit; set = $(if ($s) { [string]$s.out } else { $null }); setExit = $(if ($s) { $s.exit } else { $null }); setErr = $setErr; get1 = $(if ($g1) { [string]$g1.out } else { $null }); get1Exit = $(if ($g1) { $g1.exit } else { $null }); ev = @($ev); evExit = @($evExit); evErr = @($evErr) } | ConvertTo-Json -Compress -Depth 4))`);
  }
  return lines.join('\n');
}

/** ces-stamper PowerShellAdapter.resolveVerification (FX-04): placeholders resolve in the `equals` values first. */
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

function stamperVerdict(raw: Entry, o: Outcome, vars: Record<string, string>): { ok: boolean; why: string } {
  const e: Entry = { ...raw, verification: resolveVerification(raw.verification, vars) };
  const engine = new OutputVerificationEngine();
  const absent = (out: string, exit: number) => exit !== 0 || !out.trim() || out.includes('ResourceNotFound') || isEmptyReadResult(out);
  if (e.idempotency === 'get-then-set' && !absent(o.get0, o.get0Exit)) {
    if (!e.verification?.evidence) return { ok: true, why: 'exists (skip)' };
    const v = engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: o.get0, exitCode: 0 }, e.verification as never, { stateChanged: false });
    return { ok: v.passed, why: `exists, verified on the GET: ${v.passed}` };
  }
  if (o.setExit !== null && o.setExit !== 0) return { ok: false, why: `SET failed: ${o.setErr}` };
  if (!e.verification) return { ok: true, why: 'SET ok, no verification' };
  const v = engine.verify({ stdout: o.set ?? '', stderr: '', exitCode: o.setExit ?? 0 }, o.get1 !== null ? { stdout: o.get1, exitCode: o.get1Exit ?? -1 } : null, e.verification as never, { stateChanged: o.get0 !== o.get1 });
  return { ok: v.passed, why: `SET ok, post-GET verification ${v.passed} (evidence_check ${v.details.evidence_check})` };
}

describe.skipIf(!HAVE_PS)('P12-R5: the AZ-* entries the simulator could not answer now run (Windows PowerShell 5.1, s1-mach)', () => {
  let dir: string;
  let handle: ServeHandle;
  let outcomes: Map<string, Outcome>;
  const runVars = new Map<string, Record<string, string>>();
  let raw: { exitCode: number | null; stdout: string; stderr: string };
  const registry = HAVE_PS ? (JSON.parse(readFileSync(INFRA, 'utf8')) as { entries: Entry[] }).entries : [];
  const byId = (id: string) => registry.find((e) => e.entry_id === id)!;
  const gapIds: string[] = [...R5_AZ_GAPS, 'AZ-VM-002@seeded'];

  beforeAll(async () => {
    OutputVerificationEngine = (await import(pathToFileURL(STAMPER_OVE).href)).OutputVerificationEngine;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth10-r5-az-'));
    const tenantRoot = path.join(dir, 'tenant');
    const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${SLUG}.json`));
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    const arm = (await store.list('armResources')) as Array<Record<string, any>>;
    const kv = arm.find((r) => r.type === 'Microsoft.KeyVault/vaults')!;
    const mi = ((await store.list('managedIdentities')) as Array<Record<string, any>>)[0];
    const vars = { ...BASE_VARS, kvResourceId: String(kv.id), keyVaultName: String(kv.name), storageMiPrincipalId: String(mi?.PrincipalId ?? mi?.principalId ?? mi?.id) };
    const ordered = [...PREREQ, ...R5_AZ_GAPS].map(byId).sort((a, b) => a.layer_hint - b.layer_hint || a.sequence_hint - b.sequence_hint);
    const runs: Run[] = ordered.map((e) => ({ id: e.entry_id, entry: e, vars }));
    // A seeded VM without encryption at host: AZ-VM-002's stop / update / start path.
    runs.push({ id: 'AZ-VM-002@seeded', entry: byId('AZ-VM-002'), vars: { ...vars, vmName: 'vm-s1-prog-01' } });
    // Every gap entry again: the exists path.
    for (const id of R5_AZ_GAPS) runs.push({ id: `${id}#2`, entry: byId(id), vars });
    for (const r of runs) runVars.set(r.id, r.vars);
    handle = await startServe({ stance: 'm365_azure', slug: SLUG, port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    const psmodules = path.join(dir, 'psmodules');
    await generateAllModules(psmodules);
    const env = buildShadowedEnv(process.env, psmodules, await getPowerShellHostModulesPath());
    env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
    const file = path.join(dir, 'run.ps1');
    await fs.writeFile(file, script(runs), 'utf8');
    raw = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], env);
    outcomes = new Map();
    for (const line of raw.stdout.split(/\r?\n/)) {
      if (line.startsWith('@@RG@@')) { const o = JSON.parse(line.slice(6)) as Outcome; outcomes.set(o.id, o); }
    }
    if (process.env.DEPTH10_R5_DUMP) await fs.writeFile(`${process.env.DEPTH10_R5_DUMP}.az.json`, JSON.stringify([...outcomes.values()], null, 2));
  }, 300_000);

  afterAll(async () => {
    await handle?.stop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }, 60_000);

  for (const id of [...PREREQ, ...gapIds, ...R5_AZ_GAPS.map((x) => `${x}#2`)]) {
    it(`${id}: no error, SET read back, verification passes`, () => {
      const o = outcomes.get(id);
      expect(o, raw.stderr).toBeDefined();
      const e = byId(id.replace(/#2$|@seeded$/, ''));
      const verdict = stamperVerdict(e, o!, runVars.get(id) ?? {});
      expect({ id, ok: verdict.ok, why: verdict.why }).toEqual({ id, ok: true, why: verdict.why });
      if (o!.setExit === 0 && e.idempotency === 'get-then-set') {
        expect({ id, readBack: o!.get1Exit === 0 && !isEmptyReadResult(o!.get1 ?? '') }).toEqual({ id, readBack: true });
      }
    });
  }

  for (const id of R5_AZ_GAPS) {
    it(`${id}: every evidence command answers`, () => {
      const o = outcomes.get(id)!;
      expect({ id, exits: o.evExit, errs: o.evErr.filter(Boolean) }).toEqual({ id, exits: o.evExit.map(() => 0), errs: [] });
    });
  }
});
