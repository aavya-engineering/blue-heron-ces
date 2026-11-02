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
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../scenarios/ScenarioEngine.js';
import { startServe, type ServeHandle } from '../cli/commands/serve.js';
import { generateAllModules } from '../codegen/generatePsModule.js';
import { buildShadowedEnv, getPowerShellHostModulesPath, GRAPH_MODULE_IMPORTS, runProcess } from '../coverage/psHarness.js';

/**
 * PH-13 (P13-ST, founder Q3 2026-11-01: an empty successful read is never evidence). The evidence-only reads
 * PH-13 re-aims, run the way Stamper's evidence-only route runs them (each evidence command, in ONE Windows
 * PowerShell 5.1 session, through the generated wrapper modules and the az shim) against an in-process stacksim
 * on a random port (never :4390), on each scenario's own seeded tenant, before any CES SET.
 *  - (b) count reads: the honest answer can be zero, so each emits an explicit JSON object and is never empty.
 *  - (c) repaired reads: the filter now finds the object the seeded tenant really has (S1 / S2 seeds).
 * PH13_PROBE_OUT (optional): a folder that receives one <slug>.json per scenario with every read's output.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json');
const INFRA = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json');
const HAVE_PS = process.platform === 'win32' && existsSync(MAIN);
const SCENARIOS = ['s1-mach', 's2-eng', 's3-def', 'muster-partial'] as const;

/** (b): count reads (never empty when they succeed). */
const COUNT_READS = [
  'AC.L2-3.1.7.pim-roles-permanent',
  'AC.L2-3.1.18.byod-nonbrowser-signins',
  'AC.L2-3.1.3.byod-dlp-matches',
  'SC.L2-3.13.16.byod-label-usage',
  'PS.L2-3.9.2.account-disable-evidence',
  'PS.L2-3.9.2.termination',
  'SC.L2-3.13.2.advisor',
  'SI.L2-3.14.3.advisory-evidence',
] as const;
/** (c): repaired reads, with the scenarios whose seeded tenant holds the object before any CES SET. */
const REPAIRED_READS: Record<string, readonly string[]> = {
  'SI.L1-3.14.4.av-signatures': ['s1-mach', 's2-eng'],
  'SI.L1-3.14.2.malware-protection-evidence': ['s1-mach', 's2-eng'],
  'SC.L2-3.13.4.remote-access': ['s1-mach', 's2-eng'],
  'AU.L2-3.3.8.audit-protect': ['s1-mach'],
  'SI.L2-3.14.7.threat-intel': ['s1-mach'],
  'MP.L2-3.8.7.removable-media-intune': ['s1-mach', 's2-eng'],
  'MP.L2-3.8.8.unowned-storage-intune': ['s1-mach', 's2-eng'],
  // The app registration of the identity CES signs in with (the sim tenant record's auth.app_id); muster-partial seeds none.
  'AZ-ID-003': ['s1-mach', 's2-eng', 's3-def'],
};
/** Reads PH-13 classified (a), run for the record only (their emptiness is the honest answer). */
const RECORD_ONLY = [
  'AC.L2-3.1.17.wireless-profile-evidence', 'AC.L2-3.1.7.pim-roles-eligible', 'IA.L2-3.5.8.password-reuse',
  'CM.L2-3.4.3.change-tracking', 'AT.L2-3.2.3.insider-threat', 'MA.L2-3.7.4.media-check',
] as const;
const ALL = [...COUNT_READS, ...Object.keys(REPAIRED_READS), ...RECORD_ONLY];
/**
 * LOG-PH13-REG STOP-3: these reads carry read_after SI.L1-3.14.5.scan-schedule-evidence (the translator runs their
 * tasks after its task). Run that entry's SET, then the reads again ('<id>#after'): CES's own policy is read.
 */
const CREATOR = 'SI.L1-3.14.5.scan-schedule-evidence';
const AFTER_CREATOR = ['SI.L1-3.14.4.av-signatures', 'SI.L1-3.14.2.malware-protection-evidence'] as const;

/** The plan variables these reads use, as the R-F9 plans resolved them (synthetic values; variable-map.ts defaults). */
const VARS: Record<string, Record<string, string>> = {
  's1-mach': { resourceGroup: 'rg-s1-mach-prod', lawWorkspaceName: 'law-s1-mach-prod' },
  's2-eng': { resourceGroup: 'rg-s2-eng-prod', lawWorkspaceName: 'law-s2-eng-prod' },
  's3-def': { resourceGroup: 's3-def-rg-security', lawWorkspaceName: 's3-def-law-prod' },
  'muster-partial': { resourceGroup: 'muster-partial-rg-security', lawWorkspaceName: 'muster-partial-law-prod' },
};
const COMMON_VARS: Record<string, string> = {
  globalAdminRoleDefId: '62e90394-69f5-4237-9190-012177145e10',
  privilegedRoleAdminDefId: 'e8611ab8-c189-46e8-94e1-60213ab1f814',
  securityAdminRoleDefId: '194ae4cb-b126-40b2-bd5b-6091b380977d',
  complianceRoleId: '17315797-102d-40b4-93e0-432062caca18',
};
/** The sim tenant record's auth.app_id (SimTenantConfig.ts), which Stamper's CLI context resolves {appId} to. */
const appIdOf = (slug: string) => `sim-app-${slug}`;

interface Entry { entry_id: string; evidence_commands: string[]; set_command?: string }
interface Read { id: string; out: string[]; exit: number[]; err: string }

const render = (t: string, vars: Record<string, string>) => t.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Stamper's isEmptyReadResult (ces-stamper/src/utils/structuredEvidence.ts), for the assertions. */
function isEmptyRead(output: string): boolean {
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

function script(entries: Entry[], vars: Record<string, string>, creator?: Entry, after: Entry[] = []): string {
  const lines = [GRAPH_MODULE_IMPORTS, 'Import-Module ExchangeOnlineManagement -Force -ErrorAction SilentlyContinue'];
  lines.push(`function Run-Stamper([string]$c) { $script:err = ''; try { $ErrorActionPreference = 'Stop'; $o = (Invoke-Expression $c | Out-String).Trim(); return @{ out = $o; exit = 0 } } catch { $script:err = $_.Exception.Message; return @{ out = ''; exit = 1 } } finally { $ErrorActionPreference = 'Continue' } }`);
  const all = [...entries];
  if (creator?.set_command) {
    lines.push(`$cr = Run-Stamper ${psq(render(creator.set_command, vars))}; Write-Output ('@@PH13SET@@' + (@{ exit = $cr.exit; err = $script:err } | ConvertTo-Json -Compress))`);
    all.push(...after.map((e) => ({ ...e, entry_id: `${e.entry_id}#after` })));
  }
  for (const e of all) {
    lines.push(`$out = @(); $exit = @(); $err = ''`);
    for (const c of e.evidence_commands) lines.push(`$r = Run-Stamper ${psq(render(c, vars))}; $out += [string]$r.out; $exit += $r.exit; if ($r.exit -ne 0) { $err = $script:err }`);
    lines.push(`Write-Output ('@@PH13@@' + (@{ id = ${psq(e.entry_id)}; out = @($out); exit = @($exit); err = $err } | ConvertTo-Json -Compress -Depth 4))`);
  }
  return lines.join('\n');
}

describe.skipIf(!HAVE_PS)('PH-13: re-aimed evidence-only reads on the simulator (Windows PowerShell 5.1)', () => {
  const registry = HAVE_PS
    ? [...(JSON.parse(readFileSync(MAIN, 'utf8')) as { entries: Entry[] }).entries, ...(JSON.parse(readFileSync(INFRA, 'utf8')) as { entries: Entry[] }).entries]
    : [];
  const byId = (id: string) => registry.find((e) => e.entry_id === id)!;

  for (const slug of SCENARIOS) {
    describe(slug, () => {
      let dir: string;
      let handle: ServeHandle;
      let reads: Map<string, Read>;
      let raw: { exitCode: number | null; stdout: string; stderr: string };
      let creatorRun: { exit: number; err: string } | undefined;

      beforeAll(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-ph13-${slug}-`));
        const tenantRoot = path.join(dir, 'tenant');
        const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
        await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
        handle = await startServe({ stance: 'm365_azure', slug, port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
        const psmodules = path.join(dir, 'psmodules');
        await generateAllModules(psmodules);
        const env = buildShadowedEnv(process.env, psmodules, await getPowerShellHostModulesPath(), path.join(SIM_ROOT, 'azshim'));
        env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
        const file = path.join(dir, 'run.ps1');
        await fs.writeFile(file, script(ALL.map(byId), { ...COMMON_VARS, ...VARS[slug], appId: appIdOf(slug) }, byId(CREATOR), AFTER_CREATOR.map(byId)), 'utf8');
        raw = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], env);
        reads = new Map();
        for (const line of raw.stdout.split(/\r?\n/)) {
          if (line.startsWith('@@PH13SET@@')) creatorRun = JSON.parse(line.slice(11)) as { exit: number; err: string };
          if (line.startsWith('@@PH13@@')) { const r = JSON.parse(line.slice(8)) as Read; reads.set(r.id, { ...r, out: [].concat(r.out as never), exit: [].concat(r.exit as never) }); }
        }
        const outDir = process.env.PH13_PROBE_OUT;
        if (outDir) await fs.writeFile(path.join(outDir, `${slug}.json`), JSON.stringify(Object.fromEntries(reads), null, 2), 'utf8');
      }, 300_000);

      afterAll(async () => {
        await handle?.stop();
        if (dir) await fs.rm(dir, { recursive: true, force: true });
      }, 60_000);

      it('every read ran', () => {
        expect([...reads.keys()].sort(), raw.stderr).toEqual([...ALL, ...AFTER_CREATOR.map((i) => `${i}#after`)].sort());
      });

      it(`STOP-3: after ${CREATOR}'s SET, the reads that read after it find a Defender Antivirus policy`, () => {
        expect(creatorRun).toEqual({ exit: 0, err: '' });
        for (const id of AFTER_CREATOR) {
          const r = reads.get(`${id}#after`)!;
          expect({ id, exit: r.exit, shown: r.out.some((o) => !isEmptyRead(o)), out: r.out }).toMatchObject({ id, exit: [0], shown: true });
        }
      });

      for (const id of COUNT_READS) {
        it(`${id} (b): succeeds and emits an explicit JSON count, never an empty read`, () => {
          const r = reads.get(id)!;
          expect({ id, exit: r.exit, err: r.err }).toEqual({ id, exit: byId(id).evidence_commands.map(() => 0), err: '' });
          for (const out of r.out) {
            expect({ id, empty: isEmptyRead(out) }).toEqual({ id, empty: false });
            const parsed = JSON.parse(out) as Record<string, unknown>;
            expect({ id, count: typeof parsed.count }).toEqual({ id, count: 'number' });
          }
        });
      }

      for (const [id, holders] of Object.entries(REPAIRED_READS)) {
        if (!holders.includes(slug)) continue;
        it(`${id} (c): finds the object this seeded tenant holds (not an empty read)`, () => {
          const r = reads.get(id)!;
          expect({ id, exit: r.exit, err: r.err }).toEqual({ id, exit: byId(id).evidence_commands.map(() => 0), err: '' });
          expect({ id, shown: r.out.some((o) => !isEmptyRead(o)), out: r.out }).toMatchObject({ id, shown: true });
        });
      }
    });
  }
});
