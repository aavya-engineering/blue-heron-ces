// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// Flow-through MS-R10: the scenario plan source spawns vite-node on Muster's
// REAL generator (offline) and hands back files Stamper's picker can read.
import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generatePlanFromMuster, parseGeneratorStdout } from '../src/flow/muster-plan-source.js';
import { loadScenarioFile, musterPlanCase } from '../src/scenarios/scenarioFile.js';

describe('flow-through MS-R10 Muster plan source', () => {
  test('parseGeneratorStdout rejects output without an FT_RESULT line', () => {
    expect(() => parseGeneratorStdout('hello\n')).toThrow(/no FT_RESULT/);
  });

  test('clean-tenant-mfa-baseline: real Muster generator -> plans/ with IA.L2-3.5.3 implement', async () => {
    const s = await loadScenarioFile(path.resolve('scenarios', 'clean-tenant-mfa-baseline.json'));
    const mc = musterPlanCase(s)!;
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-x2-src-'));
    try {
      const r = await generatePlanFromMuster({ testerRoot: process.cwd(), planCase: mc.planCase, outDir, slug: s.scenario_id });
      expect(path.basename(r.missionPlanPath)).toMatch(/^manual-mission-plan-clean-tenant-mfa-baseline-.*\.json$/);
      expect(path.basename(r.manifestPath)).toMatch(/^tenant-manifest-clean-tenant-mfa-baseline-.*\.json$/);
      expect(r.provenance.generator).toBe('ces-muster/src/features/plan/tenantManifestAdapter.ts');
      const mp = JSON.parse(fs.readFileSync(r.missionPlanPath, 'utf8'));
      expect(mp.ces.cesId).toBe('ces-tester-clean-tenant-mfa-baseline');
      const d = mp.outputs.human_readable_mission_plan.control_directives.find((x: any) => x.control_id === 'IA.L2-3.5.3');
      expect(d?.directive).toBe('implement');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
