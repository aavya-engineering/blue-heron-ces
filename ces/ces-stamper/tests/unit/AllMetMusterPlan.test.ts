// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-ST1 / MS-R11: Muster's real all-met plan (`steps: []`, every directive
// validate/manual) must translate. Answers ces-tester's
// REQ-STAMPER-ALL-MET-PLAN-REJECTED.
//
// Fixture: tests/fixtures/golden/muster-all-met.* — real output of Muster's
// generator (buildPlanArtifacts, ces-muster 179260c) for ces-tester's
// ALL_MET_CASE, the same input ces-tester's X1 contract test uses. See
// muster-all-met.provenance.json. Not hand-edited.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { ManualMissionPlanSchema as SharedManualMissionPlanSchema } from 'ces-shared/types/mission-plan';
import { CESManualMissionPlanSchema } from '../../src/types/ces-artifacts.types';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { ManifestReader } from '../../src/translators/ManifestReader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const GOLDEN = path.join(ROOT, 'tests', 'fixtures', 'golden');
const MP_PATH = path.join(GOLDEN, 'muster-all-met.manual-mission-plan.json');
const TM_PATH = path.join(GOLDEN, 'muster-all-met.tenant-manifest.json');
const REGISTRY = path.join(ROOT, 'src', 'registry', 'cmmc-l2-commands.registry.json');

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

/** Construct + translate exactly as `stamper translate` does (cli/index.ts). */
function translateLikeCli(mp: any) {
  const controls = mp?.outputs?.human_readable_mission_plan?.controls;
  const mpControls = Array.isArray(controls) && controls.length > 0 ? controls : undefined;
  const translator = new PlanTranslator(undefined, undefined, mpControls, undefined);
  translator.loadRegistry(REGISTRY);
  return translator.translate(structuredClone(mp), ManifestReader.fromFile(TM_PATH));
}

describe('FX-ST1 — Muster all-met plan (steps: [])', () => {
  const mp = readJson(MP_PATH);
  const human = mp.outputs.human_readable_mission_plan;

  it('golden really is the all-met shape (steps empty, only validate/manual directives)', () => {
    expect(human.steps).toEqual([]);
    const kinds = new Set(human.control_directives.map((d: any) => d.directive));
    expect([...kinds].sort()).toEqual(['manual', 'validate']);
    expect(human.control_directives.length).toBe(110);
  });

  it('ces-shared and Stamper schemas both accept it', () => {
    expect(SharedManualMissionPlanSchema.safeParse(mp).success).toBe(true);
    const r = CESManualMissionPlanSchema.safeParse(mp);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  });

  it('PlanTranslator.translate does not throw and yields 0 configuration tasks', () => {
    const { plan } = translateLikeCli(mp);
    expect(plan.variables._source).toBe('translated-from-control-directives');
    expect(plan.execution_graph.length).toBeGreaterThan(0);
    const configTasks = plan.execution_graph.filter((t: any) => t.type === 'configuration');
    expect(configTasks).toEqual([]);
  });

  it('every Muster directive reaches the Stamper directive map unchanged', () => {
    const { plan } = translateLikeCli(mp);
    const map = plan.variables._control_directives as Record<string, string>;
    for (const d of human.control_directives) {
      expect([d.control_id, map[d.control_id]]).toEqual([d.control_id, d.directive]);
    }
  });

  it('carries the Muster engagement id through', () => {
    const { plan } = translateLikeCli(mp);
    expect(plan.ces?.cesId).toBe(mp.ces.cesId);
  });

  it('a plan with NO directives and no steps is still rejected (nothing to translate)', () => {
    const p = structuredClone(mp);
    p.outputs.human_readable_mission_plan.control_directives = [];
    const r = CESManualMissionPlanSchema.safeParse(p);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some(i => i.path.join('.') === 'outputs.human_readable_mission_plan.steps')).toBe(true);
    }
  });
});
