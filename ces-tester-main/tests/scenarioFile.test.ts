// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// G-TESTER-2 M3: scenario loader/validator unit tests — schema validation,
// the lanes/seed disagreement rejections, live-lane hold, discovery ordering,
// and the answer-map/mid-pipeline bridges.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadScenarioFile,
  discoverScenarioFiles,
  answerMapEntries,
  midPipelineSpecs,
  musterPlanCase,
} from '../src/scenarios/scenarioFile.js';

const VALID = {
  scenario_id: 'unit-test-scn',
  lanes: ['sim'],
  stacksim_seed: { stance: 'm365_azure', countOverrides: {}, steps: [] },
  muster: {
    answer_map: { 'G-01': { wizard: 'sit', answer_type: 'enum', value: 'L2' } },
    mid_pipeline_assertions: [
      {
        path: "x[?(@.control_id=='IA.L2-3.5.3')]",
        assert: 'exists',
        array_path: 'outputs.control_directives',
        match_field: 'control_id',
        match_value: 'IA.L2-3.5.3',
      },
    ],
  },
  expected_state: { checks: [] },
};

async function writeTmp(content: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scn-test-'));
  const p = path.join(dir, 'scenario.json');
  await fs.writeFile(p, JSON.stringify(content), 'utf8');
  return p;
}

describe('loadScenarioFile', () => {
  it('loads a valid scenario and defaults nothing away', async () => {
    const s = await loadScenarioFile(await writeTmp(VALID));
    expect(s.scenario_id).toBe('unit-test-scn');
    expect(s.lanes).toEqual(['sim']);
  });

  it('REJECTS lanes:["sim"] without a seed (lanes/seed disagreement)', async () => {
    const { stacksim_seed: _s, ...noSeed } = VALID;
    await expect(loadScenarioFile(await writeTmp(noSeed))).rejects.toThrow(/lanes\/seed disagreement/);
  });

  it('REJECTS a seed with no sim lane (lanes/seed disagreement)', async () => {
    // "live"-only would also trip the hold; use the schema-invalid-free path:
    const bad = { ...VALID, lanes: ['live'] };
    await expect(loadScenarioFile(await writeTmp(bad))).rejects.toThrow(/lanes\/seed disagreement|BLOCKED-ON-FD-LIVE-SMOKE-HOLD/);
  });

  it('REJECTS the live lane while FD-LIVE-SMOKE is held', async () => {
    const bad = { ...VALID, lanes: ['sim', 'live'] };
    await expect(loadScenarioFile(await writeTmp(bad))).rejects.toThrow(/BLOCKED-ON-FD-LIVE-SMOKE-HOLD/);
  });

  it('REJECTS schema violations loudly (bad lane enum)', async () => {
    const bad = { ...VALID, lanes: ['prod'] };
    await expect(loadScenarioFile(await writeTmp(bad))).rejects.toThrow(/fails scenario schema/);
  });

  it('REJECTS non-JSON', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scn-test-'));
    const p = path.join(dir, 'bad.json');
    await fs.writeFile(p, 'not json', 'utf8');
    await expect(loadScenarioFile(p)).rejects.toThrow(/not valid JSON/);
  });
});

describe('bridges + discovery', () => {
  it('answerMapEntries maps the object form onto driver entries', async () => {
    const s = await loadScenarioFile(await writeTmp(VALID));
    expect(answerMapEntries(s)).toEqual([
      { questionId: 'G-01', wizard: 'sit', answerType: 'enum', value: 'L2' },
    ]);
  });

  it('midPipelineSpecs maps rows with structured fields; rows without them are dropped', async () => {
    const s = await loadScenarioFile(await writeTmp(VALID));
    expect(midPipelineSpecs(s)).toEqual([
      {
        arrayPath: 'outputs.control_directives',
        matchField: 'control_id',
        matchValue: 'IA.L2-3.5.3',
        assert: 'exists',
      },
    ]);
  });

  it('discoverScenarioFiles returns sorted .json files (a 5th file needs no code change)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scn-disc-'));
    for (const n of ['b.json', 'a.json', 'zz.json', 'readme.md']) {
      await fs.writeFile(path.join(dir, n), '{}', 'utf8');
    }
    const found = await discoverScenarioFiles(dir);
    expect(found.map((f) => path.basename(f))).toEqual(['a.json', 'b.json', 'zz.json']);
  });

  it('every shipped scenario file loads + schema-validates (incl. the deliberate-fail one)', async () => {
    const shipped = await discoverScenarioFiles(path.resolve('scenarios'));
    expect(shipped.length).toBeGreaterThanOrEqual(6);
    for (const f of shipped) {
      const s = await loadScenarioFile(f);
      expect(s.scenario_id.length).toBeGreaterThan(0);
      expect(s.lanes).toEqual(['sim']);
      // Every expected_state check must carry a request + a path (grounded, not empty).
      for (const c of s.expected_state?.checks ?? []) {
        expect(c.request).toBeTruthy();
        expect(typeof c.path).toBe('string');
      }
    }
  });
});

describe('flow-through MS-R10: muster.plan_source', () => {
  it('clean-tenant-mfa-baseline is sourced from the Muster generator (SIT rows mapped, TCP row reported)', async () => {
    const s = await loadScenarioFile(path.resolve('scenarios', 'clean-tenant-mfa-baseline.json'));
    const mc = musterPlanCase(s);
    expect(mc).not.toBeNull();
    expect(mc!.planCase.sitAnswers).toEqual({ 'G-01': 'L2', 'G-02': 'cui_present', 'G-07': 'single_enclave' });
    expect(mc!.planCase.requirementResults).toEqual([{ requirement_id: 'IA.L2-3.5.3', status: 'not_met' }]);
    expect(mc!.planCase.cesId).toBe('ces-tester-clean-tenant-mfa-baseline');
    expect(mc!.unmapped).toEqual(['TCP.LIC.001 (tcp)']);
  });

  it('scenarios without plan_source stay on the legacy planner path', async () => {
    const s = await loadScenarioFile(await writeTmp(VALID));
    expect(musterPlanCase(s)).toBeNull();
  });

  it('a malformed plan_source is rejected by the schema', async () => {
    const bad = structuredClone(VALID) as any;
    bad.muster.plan_source = { kind: 'ces-planner', requirement_results: [] };
    await expect(loadScenarioFile(await writeTmp(bad))).rejects.toThrow(/fails scenario schema/);
  });
});
