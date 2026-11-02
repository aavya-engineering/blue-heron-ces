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
 * DEPTH-10.6..10.11 (PH-12, P12-R5): the new and changed Stamper registry entries of the CM, MA, PS and RA+CA
 * batches, run the way Stamper runs them - GET, the SET when the GET is empty (get-then-set), the GET again, and
 * the evidence commands of evidence-only entries - in ONE Windows PowerShell 5.1 session against an in-process
 * stacksim on a random port (never :4390). Same harness as depth9a-infra-pwsh.test.ts. Proves per entry: no
 * error, the SET's state is read back by the next GET, and Stamper's verification block passes; then each entry
 * runs a second time and takes the exists path. ces-strategy docs/context/finish/LOG-PH12-R5.md.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json');
const STAMPER_OVE = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'core', 'OutputVerificationEngine.ts');
const HAVE_PS = process.platform === 'win32' && existsSync(MAIN);
type Verifier = { verify(...a: unknown[]): { passed: boolean; details: { evidence_check: boolean | null } } };
let OutputVerificationEngine: new () => Verifier;

/** In Stamper's order (layer, sequence) after the sort below. */
export const R5_ENTRIES = [
  // new configuring entries
  'CM.L2-3.4.1.device-cleanup', 'CM.L2-3.4.7.firewall-ports', 'CM.L2-3.4.7.legacy-protocols',
  'CM.L2-3.4.7.nonessential-functions', 'CM.L2-3.4.7.nonessential-services', 'CM.L2-3.4.8.app-control',
  'MA.L2-3.7.5.session-terminate', 'PS.L2-3.9.2.access-review',
  // V94 expected-value fixes (same checks)
  'CM.L2-3.4.7.wdac', 'CM.L2-3.4.9.install-control', 'MA.L2-3.7.1.update-ring',
  // the re-aimed evidence entry (its commands changed). The re-tagged reads (detected-apps, media-check,
  // secure-score, vuln-scan) keep their R-F9 commands unchanged, so they are not re-run here.
  'CM.L2-3.4.8.app-protection-evidence',
] as const;

const UPNS: Record<string, { operatorUPN: string; breakGlassUPN: string }> = {
  's1-mach': { breakGlassUPN: 'bg.access01@s1-mach.simtenant.onmicrosoft.us', operatorUPN: 'adm.dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us' },
  'muster-partial': { breakGlassUPN: 'sim.user5@simtenant.onmicrosoft.us', operatorUPN: 'sim.user1@simtenant.onmicrosoft.us' },
  's3-def': { breakGlassUPN: 'emergency.access@s3-def.simtenant.onmicrosoft.us', operatorUPN: 'adm-belmira.pennanmore@s3-def.simtenant.onmicrosoft.us' },
  's2-eng': { breakGlassUPN: 'eaa.01@s2-eng.simtenant.onmicrosoft.us', operatorUPN: 'adm-roswen.dunnridge@s2-eng.simtenant.onmicrosoft.us' },
};

interface Entry {
  entry_id: string; set_command: string; get_command: string; evidence_commands: string[]; idempotency: string;
  layer_hint: number; sequence_hint: number;
  verification?: { evidence?: { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath?: string; equals?: string }> } };
}
interface Outcome { id: string; get0: string; get0Exit: number; set: string | null; setExit: number | null; setErr: string; get1: string | null; get1Exit: number | null; ev: string[]; evExit: number[] }

const render = (t: string, vars: Record<string, string>) => t.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** ces-stamper PowerShellAdapter.isEmptyReadResult (a copy, as depth9a-infra-pwsh.test.ts keeps). */
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

function script(entries: Entry[], vars: Record<string, string>): string {
  const lines = [GRAPH_MODULE_IMPORTS, 'Import-Module ExchangeOnlineManagement -Force -ErrorAction SilentlyContinue'];
  lines.push(`function Run-Stamper([string]$c) { $script:err = ''; if (-not $c) { return @{ out = ''; exit = -1 } }; try { $ErrorActionPreference = 'Stop'; $o = (Invoke-Expression $c | Out-String).Trim(); return @{ out = $o; exit = 0 } } catch { $script:err = $_.Exception.Message; return @{ out = ''; exit = 1 } } finally { $ErrorActionPreference = 'Continue' } }`);
  lines.push(`function Test-Absent([hashtable]$r) { if ($r.exit -ne 0) { return $true }; $o = $r.out; if (-not $o -or $o -match 'ResourceNotFound') { return $true }; try { $p = $o | ConvertFrom-Json -ErrorAction Stop; if ($null -eq $p) { return $true }; if ($p -is [array] -and $p.Count -eq 0) { return $true } } catch { }; return ($o -eq '[]' -or $o -eq '{}' -or $o -eq 'null') }`);
  for (const e of entries) {
    const get = render(e.get_command, vars);
    const set = render(e.set_command, vars);
    lines.push(`$g0 = Run-Stamper ${psq(get)}; $s = $null; $g1 = $null; $setErr = ''`);
    lines.push(`if (${psq(e.idempotency)} -ne 'get-then-set' -or (Test-Absent $g0)) { if (${psq(set)}) { $s = Run-Stamper ${psq(set)}; $setErr = $script:err }; $g1 = Run-Stamper ${psq(get)} }`);
    lines.push(`$ev = @(); $evExit = @()`);
    if (!e.set_command.trim()) {
      for (const c of e.evidence_commands) lines.push(`$r = Run-Stamper ${psq(render(c, vars))}; $ev += [string]$r.out; $evExit += $r.exit`);
    }
    lines.push(`Write-Output ('@@RG@@' + (@{ id = ${psq(e.entry_id)}; get0 = [string]$g0.out; get0Exit = $g0.exit; set = $(if ($s) { [string]$s.out } else { $null }); setExit = $(if ($s) { $s.exit } else { $null }); setErr = $setErr; get1 = $(if ($g1) { [string]$g1.out } else { $null }); get1Exit = $(if ($g1) { $g1.exit } else { $null }); ev = @($ev); evExit = @($evExit) } | ConvertTo-Json -Compress -Depth 4))`);
  }
  return lines.join('\n');
}

/** Stamper's own decision for one entry (as depth9a-infra-pwsh.test.ts stamperVerdict). */
function stamperVerdict(e: Entry, o: Outcome): { ok: boolean; why: string } {
  const engine = new OutputVerificationEngine();
  const absent = (out: string, exit: number) => exit !== 0 || !out.trim() || out.includes('ResourceNotFound') || isEmptyReadResult(out);
  if (!e.set_command.trim()) {
    const ev = (o.ev ?? []).map((s, i) => ({ s, exit: (o.evExit ?? [])[i] ?? 0 }));
    if (ev.some((x) => x.exit !== 0)) return { ok: false, why: 'evidence command failed' };
    // Evidence-only (EO StamperEvidenceLoader): an empty payload is "empty read, uncounted"; a non-empty one
    // must pass the entry's evidence rule, or it is a Tier 1 NOT_SAT.
    const filled = ev.filter((x) => !isEmptyReadResult(x.s));
    if (filled.length === 0) return { ok: true, why: 'evidence-only, empty read (uncounted)' };
    if (!e.verification?.evidence) return { ok: true, why: 'evidence-only, no rule' };
    const bad = filled.filter((x) => engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: x.s, exitCode: 0 }, e.verification as never).details.evidence_check === false);
    return { ok: bad.length === 0, why: `evidence-only, ${filled.length} payload(s), ${bad.length} failing the rule` };
  }
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

describe.skipIf(!HAVE_PS)('DEPTH-10.6..10.11 (P12-R5): the CM / MA / PS / RA+CA entries run on the simulator (Windows PowerShell 5.1)', () => {
  for (const slug of Object.keys(UPNS)) {
    describe(slug, () => {
      let dir: string;
      let handle: ServeHandle;
      let outcomes: Map<string, Outcome>;
      let raw: { exitCode: number | null; stdout: string; stderr: string };
      const registry = HAVE_PS ? (JSON.parse(readFileSync(MAIN, 'utf8')) as { entries: Entry[] }).entries : [];
      const entries = R5_ENTRIES.map((id) => registry.find((e) => e.entry_id === id)!).filter(Boolean)
        .sort((a, b) => a.layer_hint - b.layer_hint || a.sequence_hint - b.sequence_hint);

      beforeAll(async () => {
        OutputVerificationEngine = (await import(pathToFileURL(STAMPER_OVE).href)).OutputVerificationEngine;
        dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-depth10-r5-${slug}-`));
        const tenantRoot = path.join(dir, 'tenant');
        const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
        await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
        // Runtime variables, as Stamper's discover entries capture them on this tenant.
        const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
        const users = (await store.list('users')) as Array<Record<string, unknown>>;
        const idOf = (upn: string) => String(users.find((u) => String(u.userPrincipalName).toLowerCase() === upn.toLowerCase())?.id ?? '');
        const groups = (await store.list('groups')) as Array<Record<string, unknown>>;
        const vars = {
          ...UPNS[slug],
          operatorUserId: idOf(UPNS[slug].operatorUPN),
          breakGlassUserId: idOf(UPNS[slug].breakGlassUPN),
          cuiGroupId: String(groups[0]?.id ?? ''),
        };
        expect(Object.values(vars).every(Boolean), JSON.stringify(vars)).toBe(true);
        handle = await startServe({ stance: 'm365_azure', slug, port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
        const psmodules = path.join(dir, 'psmodules');
        await generateAllModules(psmodules);
        const env = buildShadowedEnv(process.env, psmodules, await getPowerShellHostModulesPath());
        env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
        const file = path.join(dir, 'run.ps1');
        await fs.writeFile(file, script([...entries, ...entries.map((e) => ({ ...e, entry_id: e.entry_id + '#2' }))], vars), 'utf8');
        raw = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], env);
        outcomes = new Map();
        for (const line of raw.stdout.split(/\r?\n/)) {
          if (line.startsWith('@@RG@@')) { const o = JSON.parse(line.slice(6)) as Outcome; outcomes.set(o.id, o); }
        }
        if (process.env.DEPTH10_R5_DUMP) await fs.writeFile(`${process.env.DEPTH10_R5_DUMP}.${slug}.json`, JSON.stringify([...outcomes.values()], null, 2));
      }, 240_000);

      afterAll(async () => {
        await handle?.stop();
        if (dir) await fs.rm(dir, { recursive: true, force: true });
      }, 60_000);

      it('every entry ran', () => {
        expect([...outcomes.keys()].sort(), raw.stderr).toEqual([...R5_ENTRIES, ...R5_ENTRIES.map((id) => id + '#2')].sort());
      });

      for (const id of [...R5_ENTRIES, ...R5_ENTRIES.map((x) => x + '#2')]) {
        it(`${id}: no error, SET read back, verification passes`, () => {
          const o = outcomes.get(id)!;
          const e = registry.find((x) => x.entry_id === id.replace(/#2$/, ''))!;
          const verdict = stamperVerdict(e, o);
          expect({ id, ok: verdict.ok, why: verdict.why }).toEqual({ id, ok: true, why: verdict.why });
          if (o.setExit === 0 && e.idempotency === 'get-then-set') {
            expect({ id, readBack: o.get1Exit === 0 && !isEmptyReadResult(o.get1 ?? '') }).toEqual({ id, readBack: true });
          }
        });
      }
    });
  }
});
