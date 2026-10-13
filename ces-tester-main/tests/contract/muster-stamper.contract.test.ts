// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Flow-through X1 — MS-R3: Muster-output contract test (Muster -> ces-shared -> Stamper).
 *
 * Every plan here comes out of Muster's REAL generator (`buildPlanArtifacts`,
 * ces-muster/src/features/plan/tenantManifestAdapter.ts — the one-compile path
 * the Plan tab calls). Only the generator INPUTS (SIT answers + readiness
 * posture, src/flow/muster-plan-cases.ts) live in this repo. No hand-built plan.
 *
 * Pipeline per case (offline, read-only imports of the sibling sources):
 *   1. ces-shared/types/mission-plan  ManualMissionPlanSchema + TenantManifestSchema
 *   2. ces-stamper ManifestReader.fromFile (the Tenant Manifest Muster emitted)
 *   3. ces-stamper PlanTranslator.translate — directive mode, constructed as the
 *      Stamper CLI constructs it (mpControls = MP controls[], registry loaded)
 *   4. assert the consumed fields: the Stamper directive for each of Muster's 5
 *      stamper_action values, ces.cesId, fedramp_package_id, and control ids.
 * Plus a drift guard: renaming/stripping a consumed field in a copy of the
 * generated plan must make the checks fail.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { findCesRoot } from '../../src/flow/ces-root.js';
import { generateMusterPlan, type MusterPlanOutput } from '../../src/flow/muster-plan-generator.js';
import { ALL_MET_CASE, FEDRAMP_CASE, FEDRAMP_PACKAGE_ID, GAPFUL_CASE } from '../../src/flow/muster-plan-cases.js';

const CES_ROOT = findCesRoot();
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(CES_ROOT, rel)).href);

/** Muster's 5 stamper_action values -> the Stamper directive(s) that must result. */
const EXPECTED_STAMPER_DIRECTIVE: Record<string, string[]> = {
  Automated: ['implement', 'validate'],
  'Non-Stack': ['manual'],
  'N-A-Capability-Absent': ['document-absence'],
  'Met-By-Prohibition': ['document-prohibition'],
  'Inherited-FedRAMP': ['inherit-fedramp'],
};
/** Stamper promotes these 7 manual controls to document-renderable (PlanTranslator DOC_RENDERABLE_CONTROL_IDS). */
const STAMPER_DOC_RENDERABLE = new Set([
  'IA.L2-3.5.8', 'CM.L2-3.4.4', 'CM.L2-3.4.8', 'AU.L2-3.3.6', 'CA.L2-3.12.2', 'CA.L2-3.12.4', 'RA.L2-3.11.2',
]);
/** Directives Stamper materializes as a dedicated per-control task carrying `_directive`. */
const TASK_BEARING = new Set(['document-absence', 'document-prohibition', 'inherit-fedramp']);

let shared: any;
let PlanTranslator: any;
let ManifestReader: any;
const REGISTRY = path.join(CES_ROOT, 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json');
let tmp: string;

function head(repo: string): string {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '(unknown)';
  }
}

interface Translated {
  plan: any;
  warnings: string[];
  reader: any;
}

function writeArtifacts(o: MusterPlanOutput, tag: string): { mpPath: string; tmPath: string } {
  const mpPath = path.join(tmp, `manual-mission-plan-${tag}.json`);
  const tmPath = path.join(tmp, `tenant-manifest-${tag}.json`);
  fs.writeFileSync(mpPath, JSON.stringify(o.missionPlan, null, 2));
  fs.writeFileSync(tmPath, JSON.stringify(o.tenantManifest, null, 2));
  return { mpPath, tmPath };
}

/** Stages 2+3 exactly as `stamper translate` wires them (cli/index.ts). */
function stamperTranslate(mp: any, tmPath: string): Translated {
  const reader = ManifestReader.fromFile(tmPath);
  const controls = mp?.outputs?.human_readable_mission_plan?.controls;
  const mpControls = Array.isArray(controls) && controls.length > 0 ? controls : undefined;
  const translator = new PlanTranslator(undefined, undefined, mpControls, undefined);
  translator.loadRegistry(REGISTRY);
  // Stamper promotes directives in place; translate a copy so the generated plan stays pristine.
  const result = translator.translate(structuredClone(mp), reader);
  return { plan: result.plan, warnings: result.warnings, reader };
}

/** Stage 4: the consumed-field checks. Returns violations (empty = contract holds). */
function consumedFieldViolations(mp: any, t: Translated, expectCesId: string): string[] {
  const v: string[] = [];
  const h = mp.outputs.human_readable_mission_plan;
  const controls: any[] = h.controls ?? [];
  const directives: any[] = h.control_directives ?? [];
  const map: Record<string, string> = t.plan.variables?._control_directives ?? {};
  const graph: any[] = t.plan.execution_graph ?? [];

  if (t.plan.ces?.cesId !== expectCesId) v.push(`ces.cesId: Stamper plan has ${JSON.stringify(t.plan.ces?.cesId)}, Muster emitted ${expectCesId}`);
  if (t.plan.variables?._source !== 'translated-from-control-directives') v.push(`not directive mode: _source=${t.plan.variables?._source}`);

  const directiveById = new Map(directives.map((d) => [d.control_id, d]));
  for (const c of controls) {
    const cid = c.requirement_id;
    const expected = EXPECTED_STAMPER_DIRECTIVE[c.stamper_action];
    if (!expected) {
      v.push(`${cid}: unknown Muster stamper_action ${c.stamper_action}`);
      continue;
    }
    const allowed = c.stamper_action === 'Non-Stack' && STAMPER_DOC_RENDERABLE.has(cid) ? ['document-renderable'] : expected;
    const d = directiveById.get(cid);
    if (!d) {
      v.push(`${cid}: in controls[] but no control_directives[] row`);
      continue;
    }
    const got = map[cid];
    if (got === undefined) v.push(`${cid}: control id absent from Stamper _control_directives`);
    else if (!allowed.includes(got)) v.push(`${cid}: ${c.stamper_action} -> Stamper directive ${got}, expected ${allowed.join('|')}`);

    if (got && TASK_BEARING.has(got)) {
      const task = graph.find((tk) => tk.action?.args?._directive === got && (tk.controls ?? []).includes(cid));
      if (!task) v.push(`${cid}: no ${got} task in Stamper execution_graph`);
      else if (got === 'inherit-fedramp') {
        const pkg = task.action.args._fedramp_package_id;
        if (!c.fedramp_package_id) v.push(`${cid}: Muster controls[] row lacks fedramp_package_id`);
        if (!d.fedramp_package_id) v.push(`${cid}: Muster control_directives[] row lacks fedramp_package_id`);
        if (pkg !== c.fedramp_package_id || !pkg) v.push(`${cid}: Stamper task _fedramp_package_id=${JSON.stringify(pkg)} != Muster ${JSON.stringify(c.fedramp_package_id)}`);
      }
    }
  }
  // Control-id agreement: every Muster directive id is a control Stamper knows.
  for (const d of directives) {
    if (!(d.control_id in map)) v.push(`${d.control_id}: Muster directive control id unknown to Stamper`);
  }
  return v;
}

const cases: Record<string, { out: MusterPlanOutput; mpPath: string; tmPath: string }> = {};

beforeAll(async () => {
  shared = await imp('ces-shared/dist/types/mission-plan.contract.js');
  ({ PlanTranslator } = await imp('ces-stamper/src/translators/PlanTranslator.ts'));
  ({ ManifestReader } = await imp('ces-stamper/src/translators/ManifestReader.ts'));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-tester-msr3-'));
  for (const c of [GAPFUL_CASE, ALL_MET_CASE, FEDRAMP_CASE]) {
    const out = await generateMusterPlan(c, CES_ROOT);
    cases[c.id] = { out, ...writeArtifacts(out, c.id) };
  }
  console.log(
    `[MS-R3] upstream: ces-muster@${head(path.join(CES_ROOT, 'ces-muster'))} ` +
      `ces(shared/stamper)@${head(CES_ROOT)} generator=${cases.gapful.out.provenance.generator}#buildPlanArtifacts`,
  );
}, 120_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('MS-R3 Muster -> shared -> Stamper contract (real Muster generator output)', () => {
  for (const c of [GAPFUL_CASE, ALL_MET_CASE, FEDRAMP_CASE]) {
    describe(`case ${c.id}`, () => {
      test('ces-shared ManualMissionPlanSchema accepts Muster\'s Mission Plan', () => {
        const r = shared.ManualMissionPlanSchema.safeParse(cases[c.id].out.missionPlan);
        expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
      });

      test('ces-shared TenantManifestSchema accepts Muster\'s Tenant Manifest', () => {
        const r = shared.TenantManifestSchema.safeParse(cases[c.id].out.tenantManifest);
        expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
      });

      test('Stamper ManifestReader reads the Tenant Manifest', () => {
        const reader = ManifestReader.fromFile(cases[c.id].tmPath);
        const body = cases[c.id].out.tenantManifest.tenant_manifest;
        expect(reader.manifestId).toBe(body.manifest_id);
        expect(reader.techStackId).toBe(body.tech_stack_id);
        expect(reader.getControlIds().length).toBeGreaterThan(0);
      });

      // FX-TE2: the all-met case was HONEST-OPEN (Stamper's steps min(1)); ces-stamper
      // FX-ST1 (6c8571c) fixed it, so every case now runs the full assertion.
      // Closed: docs/requirements/REQ-STAMPER-ALL-MET-PLAN-REJECTED.md
      test('Stamper translates it in directive mode and every consumed field lands', () => {
        const mp = cases[c.id].out.missionPlan;
        const t = stamperTranslate(mp, cases[c.id].tmPath);
        expect(consumedFieldViolations(mp, t, c.cesId)).toEqual([]);
        expect(t.plan.execution_graph.length).toBeGreaterThan(0);
      });
    });
  }

  test('the three cases together exercise all 5 Muster stamper_action values', () => {
    const seen = new Set<string>();
    for (const k of Object.keys(cases)) {
      for (const ctl of cases[k].out.missionPlan.outputs.human_readable_mission_plan.controls ?? []) seen.add(ctl.stamper_action);
    }
    expect([...seen].sort()).toEqual(Object.keys(EXPECTED_STAMPER_DIRECTIVE).sort());
  });

  test('all-met: Muster emits steps: [] and both ces-shared and Stamper accept it (FX-ST1, closes REQ-STAMPER-ALL-MET-PLAN-REJECTED)', () => {
    const mp = cases['all-met'].out.missionPlan;
    expect(mp.outputs.human_readable_mission_plan.steps).toEqual([]);
    expect(shared.ManualMissionPlanSchema.safeParse(mp).success).toBe(true);
    expect(() => stamperTranslate(mp, cases['all-met'].tmPath)).not.toThrow();
  });

  test('all-met: no gaps -> Muster emits zero steps and Stamper still validates every control', () => {
    const mp = cases['all-met'].out.missionPlan;
    const h = mp.outputs.human_readable_mission_plan;
    expect((h.control_directives ?? []).length).toBe(110);
    const t = stamperTranslate(mp, cases['all-met'].tmPath);
    const directives = Object.values(t.plan.variables._control_directives as Record<string, string>);
    expect(directives.filter((d) => d === 'validate').length).toBeGreaterThan(0);
    expect(directives).not.toContain('implement');
  });

  test('FedRAMP-inherited: the SI package id reaches Stamper inheritance tasks', () => {
    const mp = cases['fedramp-inherited'].out.missionPlan;
    const inherited = mp.outputs.human_readable_mission_plan.controls.filter((x: any) => x.stamper_action === 'Inherited-FedRAMP');
    expect(inherited.length).toBeGreaterThan(0); // non-vacuous: inheritance actually fired
    const t = stamperTranslate(mp, cases['fedramp-inherited'].tmPath);
    const tasks = t.plan.execution_graph.filter((tk: any) => tk.action?.args?._directive === 'inherit-fedramp');
    expect(tasks.length).toBe(inherited.length);
    for (const tk of tasks) expect(tk.action.args._fedramp_package_id).toBe(FEDRAMP_PACKAGE_ID);
  });
});

describe('MS-R3 drift guard (a renamed/stripped consumed field must fail the contract)', () => {
  const clone = (id: string) => structuredClone(cases[id].out.missionPlan);

  test('rename control_directives[].control_id -> controlId: shared schema rejects', () => {
    const mp = clone('gapful');
    for (const d of mp.outputs.human_readable_mission_plan.control_directives) {
      d.controlId = d.control_id;
      delete d.control_id;
    }
    expect(shared.ManualMissionPlanSchema.safeParse(mp).success).toBe(false);
  });

  test('rename controls[].stamper_action -> stamperAction: shared schema rejects', () => {
    const mp = clone('gapful');
    for (const c of mp.outputs.human_readable_mission_plan.controls) {
      c.stamperAction = c.stamper_action;
      delete c.stamper_action;
    }
    expect(shared.ManualMissionPlanSchema.safeParse(mp).success).toBe(false);
  });

  test('strip fedramp_package_id (optional; passes the schema): the consumed-field check fails', () => {
    const mp = clone('fedramp-inherited');
    const h = mp.outputs.human_readable_mission_plan;
    for (const c of h.controls) delete c.fedramp_package_id;
    for (const d of h.control_directives) delete d.fedramp_package_id;
    expect(shared.ManualMissionPlanSchema.safeParse(mp).success).toBe(true); // passthrough: schema alone would miss it
    const t = stamperTranslate(mp, cases['fedramp-inherited'].tmPath);
    const v = consumedFieldViolations(mp, t, FEDRAMP_CASE.cesId);
    expect(v.some((s) => /fedramp_package_id/.test(s))).toBe(true);
  });

  test('rename ces.cesId -> ces.cesID (optional; passes the schema): the identity check fails', () => {
    const mp = clone('gapful');
    mp.ces.cesID = mp.ces.cesId;
    delete mp.ces.cesId;
    const t = stamperTranslate(mp, cases.gapful.tmPath);
    const v = consumedFieldViolations(mp, t, GAPFUL_CASE.cesId);
    expect(v.some((s) => /ces\.cesId/.test(s))).toBe(true);
  });

  test('rewrite one stamper_action (Met-By-Prohibition -> Automated) in controls[] only: the directive check fails', () => {
    const mp = clone('gapful');
    const row = mp.outputs.human_readable_mission_plan.controls.find((c: any) => c.stamper_action === 'Met-By-Prohibition');
    expect(row).toBeDefined();
    row.stamper_action = 'Automated';
    const t = stamperTranslate(mp, cases.gapful.tmPath);
    const v = consumedFieldViolations(mp, t, GAPFUL_CASE.cesId);
    expect(v.some((s) => s.startsWith(row.requirement_id))).toBe(true);
  });
});
