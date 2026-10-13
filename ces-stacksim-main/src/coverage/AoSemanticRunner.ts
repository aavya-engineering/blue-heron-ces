// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs, existsSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { InventoryItem } from './InventoryTypes.js';
import { substituteTemplateVars } from './engineClassifier.js';
import { buildShadowedEnv, getPowerShellHostModulesPath, psModulePathPrelude, runProcess } from './psHarness.js';
import { tenantObjectDefaults } from './CoverageRunner.js';
import { loadProfile, resolveProfilePath } from '../profiles/ProfileLoader.js';
import { SeedEngine } from '../seed/SeedEngine.js';
import { startServe } from '../cli/commands/serve.js';
import { generateAllModules } from '../codegen/generatePsModule.js';

/**
 * SIMFIX FIX-S2 / GOAL-AO-SIM-COVERAGE M6 - semantic self-certification.
 *
 * Runs every AO command's real get/set text (from coverage/inventory.json,
 * extracted from ces-ao's registry) against a FRESH m365_azure tenant (its
 * gcc-high-g5 seed set - not harness-injected objects), in AO's own order:
 * GET, then SET, then the paired GET again, each in its own shadowed
 * powershell.exe with AO's `$ErrorActionPreference='Stop'` prelude.
 *
 * Verdict per command (expectations: coverage/ao-semantic-expectations.json):
 *  - read:  the GET ran clean and its output contains `mustContain` (the
 *           seeded data / deliberate gap the command exists to find);
 *  - write: GET, SET and GET ran clean and the paired GET differs afterwards
 *           (the write is visible where the command itself looks);
 *  - honest-open: recorded with its reason + REQ (the sim serves the command,
 *           but the command's own read cannot observe its write).
 * Expectations are assertions keyed by command id; the sim is never told
 * which command is running and returns nothing canned.
 *
 * Request inputs: the tenant object supplies every registry `source`; user
 * inputs name seeded objects (tenantObjectDefaults' request-input table) with
 * the per-command overrides below - chosen so destructive commands do not
 * collide (AO's own matrix uses a different input table; see the report).
 */
export const AO_SEMANTIC_OVERRIDES: Record<string, Record<string, string>> = {
  'A-01': { upn: 'sim.newhire1@simtenant.onmicrosoft.us', displayName: 'Sim New Hire 1' },
  'A-03': { targetUPN: 'sim.user5@simtenant.onmicrosoft.us' },
  'A-05': { targetUPN: 'sim.inactive1@simtenant.onmicrosoft.us' },
  'A-06': { targetUPN: 'sim.inactive1@simtenant.onmicrosoft.us' },
  'A-10': { targetUPN: 'sim.user1@simtenant.onmicrosoft.us' },
  'A-17': { adminUPN: 'adm.sim.user1@simtenant.onmicrosoft.us', adminDisplayName: 'ADM Sim User 1' },
  'A-19': { policyDisplayName: 'Sim CA Policy 1' },
  'A-20': { policyDisplayName: 'Sim Duplicate CA Policy' },
  'B-05': { targetUPN: 'sim.user4@simtenant.onmicrosoft.us' },
  'D-06': { transportRuleName: 'Sim CUI Encrypt Rule', omeTemplateName: 'Encrypt' },
  'D-11': { labelDisplayName: 'CUI//SP-CTI' },
  'H-03': { deviceId: 'managedDevice-3' },
  'H-06': { incidentStartDate: '2026-01-01', incidentEndDate: '2030-12-31' },
};

export type AoSemanticStatus = 'PASS' | 'HONEST-OPEN' | 'FAIL';

export interface AoSemanticExpectation {
  expect: 'read' | 'write' | 'honest-open';
  mustContain?: string;
  reason?: string;
  req?: string;
}

export interface AoSemanticResult {
  id: string;
  expect: AoSemanticExpectation['expect'];
  status: AoSemanticStatus;
  detail: string;
  pre?: string;
  post?: string;
}

export interface AoSemanticReport {
  generatedAt: string;
  totals: { total: number; pass: number; honestOpen: number; fail: number };
  results: AoSemanticResult[];
}

interface Step {
  ok: boolean;
  out: string;
  err: string;
}

/** AO registry order (ces-ao read-only) when present, else inventory order. */
function aoOrder(stacksimRoot: string, ids: string[]): string[] {
  const reg = path.resolve(stacksimRoot, '..', 'ces-ao', 'src', 'registry', 'ao-commands.registry.json');
  if (!existsSync(reg)) return ids;
  const order = (JSON.parse(readFileSync(reg, 'utf8')) as Array<{ id: string }>).map((c) => c.id);
  return [...ids].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
}

export async function runAoSemanticCoverage(opts: { stacksimRoot?: string } = {}): Promise<AoSemanticReport> {
  const stacksimRoot = opts.stacksimRoot ?? process.cwd();
  const inventory = JSON.parse(await fs.readFile(path.join(stacksimRoot, 'coverage', 'inventory.json'), 'utf8')) as {
    items: InventoryItem[];
  };
  const expectations = (
    JSON.parse(await fs.readFile(path.join(stacksimRoot, 'coverage', 'ao-semantic-expectations.json'), 'utf8')) as {
      expectations: Record<string, AoSemanticExpectation>;
    }
  ).expectations;
  const aoItems = inventory.items.filter((i) => i.source === 'ao');
  const byOp = new Map<string, { get?: string; set?: string }>();
  for (const i of aoItems) {
    const [op, kind] = i.sourceRef.split(':');
    const cur = byOp.get(op) ?? {};
    if (kind === 'get') cur.get = i.commandText;
    else if (kind === 'set') cur.set = i.commandText;
    byOp.set(op, cur);
  }

  const psmodulesDir = path.join(stacksimRoot, 'psmodules');
  const azShimDir = path.join(stacksimRoot, 'azshim');
  const profilesDir = path.join(stacksimRoot, 'profiles');
  await generateAllModules(psmodulesDir);
  const psHome = await getPowerShellHostModulesPath();
  const tenantRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ao-semantic-'));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ao-semantic-ps-'));
  const slug = 'ao-semantic';
  const profile = await loadProfile(resolveProfilePath('m365_azure', profilesDir));
  const handle = await startServe({ stance: 'm365_azure', slug, port: 0, profilesDir, tenantRoot });
  const results: AoSemanticResult[] = [];
  try {
    await new SeedEngine(handle.store, handle.ledger).seed(profile);
    const defaults = tenantObjectDefaults(slug);
    const env = buildShadowedEnv(process.env, psmodulesDir, psHome, azShimDir);
    env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
    let n = 0;
    const run = async (text: string): Promise<Step> => {
      const file = path.join(tempDir, `op-${++n}.ps1`);
      // The prelude's own output (Add-Type) must not become the first object of
      // the captured stream, or PowerShell formats everything after it under
      // that object's columns (blank) - dot-source it silently.
      const body = `. {\n${psModulePathPrelude(psmodulesDir, psHome)}\n} | Out-Null\ntry {\n${text}\n} catch { [Console]::Error.WriteLine('AO_SEMANTIC_ERR::' + $_.Exception.Message); exit 3 }\n`;
      await fs.writeFile(file, '﻿' + body, 'utf8');
      const r = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], env);
      return { ok: r.exitCode === 0, out: r.stdout.trim(), err: r.stderr.trim() };
    };

    for (const op of aoOrder(stacksimRoot, [...byOp.keys()])) {
      const cmd = byOp.get(op) ?? {};
      const exp = expectations[op];
      const fill = (t: string) => substituteTemplateVars(t, AO_SEMANTIC_OVERRIDES[op] ?? {}, defaults);
      if (!exp) {
        results.push({ id: op, expect: 'read', status: 'FAIL', detail: 'no expectation recorded for this command' });
        continue;
      }
      const pre = cmd.get ? await run(fill(cmd.get)) : { ok: true, out: '', err: '' };
      let status: AoSemanticStatus;
      let detail: string;
      let post: Step | undefined;
      if (exp.expect === 'read') {
        const found = !!exp.mustContain && pre.out.includes(exp.mustContain);
        status = pre.ok && found ? 'PASS' : 'FAIL';
        detail = !pre.ok ? `GET failed: ${pre.err.slice(0, 300)}` : found ? `read carries "${exp.mustContain}"` : `read lacks "${exp.mustContain}"`;
      } else {
        const set = cmd.set ? await run(fill(cmd.set)) : { ok: false, out: '', err: 'no set command' };
        post = cmd.get ? await run(fill(cmd.get)) : undefined;
        const changed = !!post && post.out !== pre.out;
        if (exp.expect === 'honest-open') {
          status = 'HONEST-OPEN';
          const observed = cmd.set
            ? `set ${set.ok ? 'ran clean' : 'errored'}, paired read ${changed ? 'changed' : 'unchanged'}`
            : `read-only command; read ${pre.ok ? 'ran clean' : 'errored'}`;
          detail = `${exp.reason} [${exp.req}] (observed: ${observed})`;
        } else {
          status = pre.ok && set.ok && post?.ok && changed ? 'PASS' : 'FAIL';
          detail = !pre.ok
            ? `GET failed: ${pre.err.slice(0, 300)}`
            : !set.ok
              ? `SET failed: ${set.err.slice(0, 300)}`
              : !post?.ok
                ? `paired GET failed: ${post?.err.slice(0, 300)}`
                : changed
                  ? 'paired read observes the write'
                  : 'paired read unchanged (pre == post)';
        }
      }
      results.push({ id: op, expect: exp.expect, status, detail, pre: pre.out.slice(0, 600), post: post?.out.slice(0, 600) });
    }
  } finally {
    await handle.stop();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(tenantRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  const pass = results.filter((r) => r.status === 'PASS').length;
  const honestOpen = results.filter((r) => r.status === 'HONEST-OPEN').length;
  return {
    generatedAt: new Date().toISOString(),
    totals: { total: results.length, pass, honestOpen, fail: results.length - pass - honestOpen },
    results,
  };
}

export function renderAoSemanticMarkdown(report: AoSemanticReport, expectations: Record<string, AoSemanticExpectation>): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const rows = report.results.map((r) => {
    const e = expectations[r.id];
    const want = e?.expect === 'read' ? `read contains \`${e.mustContain}\`` : e?.expect === 'write' ? 'write observed by paired read' : `HONEST-OPEN (${e?.req})`;
    return `| ${r.id} | ${want} | ${r.status} | ${esc(r.detail).slice(0, 400)} |`;
  });
  return `# AO semantic coverage (M6) - 95 AO commands on the gcc-high-g5 seed

Generated ${report.generatedAt} by \`npm run coverage:ao\` (src/coverage/AoSemanticRunner.ts).
A fresh \`m365_azure\` tenant (gcc-high-g5 seed set, no harness-injected objects) runs every AO command's real
get/set text through the shimmed PowerShell modules, in AO's registry order: GET, SET, paired GET.

**PASS ${report.totals.pass} - HONEST-OPEN ${report.totals.honestOpen} - FAIL ${report.totals.fail}** (of ${report.totals.total})

read = the output carries the seeded data / deliberate gap the command exists to find. write = the paired read
differs after the write. HONEST-OPEN = the sim serves the command but the command's own read cannot observe it;
reason + REQ (docs/requirements/) given. Expectations: \`coverage/ao-semantic-expectations.json\`.

| Op | Expectation | Status | Detail |
|---|---|---|---|
${rows.join('\n')}
`;
}

export async function runAoSemanticCommand(): Promise<AoSemanticReport> {
  const root = process.cwd();
  const report = await runAoSemanticCoverage({ stacksimRoot: root });
  await fs.writeFile(path.join(root, 'coverage', 'ao-semantic-report.json'), JSON.stringify(report, null, 2), 'utf8');
  const exp = (
    JSON.parse(await fs.readFile(path.join(root, 'coverage', 'ao-semantic-expectations.json'), 'utf8')) as {
      expectations: Record<string, AoSemanticExpectation>;
    }
  ).expectations;
  await fs.mkdir(path.join(root, 'docs', 'coverage'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'coverage', 'AO-SEMANTIC-COVERAGE.md'), renderAoSemanticMarkdown(report, exp), 'utf8');
  console.log(`stacksim coverage-ao: PASS ${report.totals.pass} / HONEST-OPEN ${report.totals.honestOpen} / FAIL ${report.totals.fail} (of ${report.totals.total})`);
  for (const r of report.results) if (r.status !== 'PASS') console.log(`  [${r.status}] ${r.id} - ${r.detail.slice(0, 220)}`);
  return report;
}
