// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// Synthetic-customer W0: scenario selection by slug (run-scenario --scenario <slug>,
// mx-e2e.ps1 -Harness tester -Scenario <slug>). Nothing here starts a server or the sim.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultMusterScenariosDir,
  loadMusterE2eForSlug,
  musterE2eFileForSlug,
} from '../src/scenarios/musterE2eFile.js';
import { runMusterE2e } from '../src/flow/muster-e2e-run.js';
import { runRunScenarioCommand } from '../src/cli/index.js';

const DIR = path.resolve('scenarios', 'muster');

describe('muster-e2e scenario selection by slug', () => {
  it('maps a slug to scenarios/muster/<slug>-e2e.json in the tester tree', () => {
    expect(defaultMusterScenariosDir()).toBe(DIR);
    expect(musterE2eFileForSlug('muster-partial')).toBe(path.join(DIR, 'muster-partial-e2e.json'));
    expect(musterE2eFileForSlug('s1-mach')).toBe(path.join(DIR, 's1-mach-e2e.json'));
    expect(musterE2eFileForSlug('s3-def', '/x')).toBe(path.join('/x', 's3-def-e2e.json'));
  });

  it('refuses anything that is not a slug', () => {
    for (const bad of ['', 'S1-Mach', '../muster-partial', 's1 mach', 'a/b', '-lead']) {
      expect(() => musterE2eFileForSlug(bad)).toThrow(/not a scenario slug/);
    }
  });

  it('loads muster-partial and s1-mach; each drives its own slug', async () => {
    const mp = await loadMusterE2eForSlug('muster-partial');
    expect(mp.scenario.sim_scenario).toBe('muster-partial');
    const s1 = await loadMusterE2eForSlug('s1-mach');
    expect(s1.file).toBe(path.join(DIR, 's1-mach-e2e.json'));
    expect(s1.scenario.sim_scenario).toBe('s1-mach');
    expect(s1.scenario.stance).toBe('m365_azure');
  });

  it('fails on a missing file and on a file whose sim_scenario is another slug', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mx-slug-'));
    await expect(loadMusterE2eForSlug('s9-none', dir)).rejects.toThrow(/no muster-e2e scenario/);
    const raw = JSON.parse(await fs.readFile(path.join(DIR, 'muster-partial-e2e.json'), 'utf8'));
    await fs.writeFile(path.join(dir, 's2-eng-e2e.json'), JSON.stringify(raw));
    await expect(loadMusterE2eForSlug('s2-eng', dir)).rejects.toThrow(/is not the slug "s2-eng"/);
  });

  it('every per-tenant path and command of the s1-mach dry run follows the slug', async () => {
    const { file, scenario } = await loadMusterE2eForSlug('s1-mach');
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'mx-dry-s1-'));
    const rec = await runMusterE2e({ scenario, scenarioPath: file, wsRoot: ws, packageRoot: path.join(ws, 'pkg'), dryRun: true, skipForcedRun: true, log: () => {} });
    expect(rec.status).toBe('DRY-RUN');
    expect(rec.sim_scenario).toBe('s1-mach');
    const cmd = (id: string) => rec.steps.find((s) => s.id === id)?.commands.join(' ') ?? '';
    expect(cmd('E1')).toContain('stacksim.mjs scenario s1-mach');
    expect(cmd('E1')).toContain('--slug s1-mach');
    expect(cmd('E4')).toContain('pl/Stamper/plan-data/s1-mach/plans');
    expect(cmd('E6')).toContain('--tenant s1-mach');
    expect(cmd('E7')).toContain('TENANT_SLUG=s1-mach');
    expect(cmd('E8B')).toContain('--scenario s1-mach');
    expect(JSON.stringify(rec)).not.toContain('muster-partial');
    expect(await fs.readdir(ws)).toEqual([]);
  });

  it('run-scenario --scenario rejects an unknown or malformed slug with exit 2', async () => {
    expect(await runRunScenarioCommand(['--scenario', 's9-none', '--root', '.', '--package-root', '.'])).toBe(2);
    expect(await runRunScenarioCommand(['--scenario', 'Bad Slug'])).toBe(2);
  });
});
