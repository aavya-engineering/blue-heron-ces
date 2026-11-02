// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-ST3 (results-manifest vocabulary) + FX-ST4 / MS-R13 (manifest planId).
//
// FX-ST3: every verdict and directive word the execute path records must come
// out of ExecutionResultsCollector.buildManifest in ces-shared's vocabulary, so
// the shared ExecutionResultsManifestSchema accepts the manifest.
//   - verdict words: the ResultVerdict constants execute.routes.ts records with
//     (a source guard below proves no bare verdict literal is recorded);
//   - directive words: the literals execute.routes.ts records with, plus every
//     value a REAL translated plan puts in `_control_directives` (the map the
//     execute path reads per control), plus the shared plan directive enum.
// FX-ST4: the manifest's planId is the Mission Plan's bare plan_id (Muster's
// POST /api/plan/results key), the executable id is `executablePlanId`.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { ExecutionResultsManifestSchema as SharedManifestSchema, EXECUTION_RESULTS_CONTRACT_VERSION } from 'ces-shared/types/execution-results';
import { StamperDirective as SharedPlanDirective } from 'ces-shared/types/mission-plan';
import {
  ExecutionResultsCollector,
  ResultVerdict,
  sourcePlanIdOf,
} from '../../src/core/ExecutionResultsCollector';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { ManifestReader } from '../../src/translators/ManifestReader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY = path.join(ROOT, 'src', 'registry', 'cmmc-l2-commands.registry.json');
const EXECUTE_ROUTES = path.join(ROOT, 'src', 'server', 'routes', 'execute.routes.ts');
// FX-ST6: the shared publisher (CLI path) also records results — guarded too.
const RESULTS_PUBLISHER = path.join(ROOT, 'src', 'core', 'ExecutionResultsPublisher.ts');
const MUSTER_FIXTURES = path.resolve(ROOT, '..', 'ces-muster', 'src', 'features', 'plan', '__fixtures__');
const GOLDEN = path.join(ROOT, 'tests', 'fixtures', 'golden');

/** Muster plans: ces-muster's committed fixture (read-only) + the real all-met golden. */
const MUSTER_PLANS = [
  { name: 'ces-muster fixture', mp: path.join(MUSTER_FIXTURES, 'manual-mission-plan.json'), tm: path.join(MUSTER_FIXTURES, 'tenant-manifest.json') },
  { name: 'all-met golden', mp: path.join(GOLDEN, 'muster-all-met.manual-mission-plan.json'), tm: path.join(GOLDEN, 'muster-all-met.tenant-manifest.json') },
];

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

function translateLikeCli(mpPath: string, tmPath: string) {
  const mp = readJson(mpPath);
  const controls = mp?.outputs?.human_readable_mission_plan?.controls;
  const mpControls = Array.isArray(controls) && controls.length > 0 ? controls : undefined;
  const translator = new PlanTranslator(undefined, undefined, mpControls, undefined);
  translator.loadRegistry(REGISTRY);
  return { mp, plan: translator.translate(structuredClone(mp), ManifestReader.fromFile(tmPath)).plan };
}

/** Split a call's argument list on top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const ROUTES_SRC = [EXECUTE_ROUTES, RESULTS_PUBLISHER].map(p => fs.readFileSync(p, 'utf-8')).join('\n');
const RECORD_CALLS = [...ROUTES_SRC.matchAll(/recordControlResult\(([\s\S]*?)\);/g)].map(m => splitArgs(m[1]));
const quoted = (expr: string) => [...expr.matchAll(/'([^']*)'/g)].map(m => m[1]);

describe('FX-ST3 — execute-path source guard', () => {
  it('finds the recordControlResult call sites', () => {
    expect(RECORD_CALLS.length).toBeGreaterThanOrEqual(14);
  });

  it('no call records a bare verdict literal (all go through ResultVerdict / metVerdict)', () => {
    const offenders = RECORD_CALLS.filter(a => quoted(a[2]).length > 0).map(a => a.join(', '));
    expect(offenders).toEqual([]);
    const sprs = [...ROUTES_SRC.matchAll(/const sprsValue = ([^;]*);/g)].map(m => m[1]);
    expect(sprs.length).toBeGreaterThan(0);
    for (const rhs of sprs) expect(rhs).toMatch(/^metVerdict\(/);
  });

  it('manifests are built from the plan (source plan id), never from plan.plan_id directly', () => {
    expect(ROUTES_SRC).not.toMatch(/\.buildManifest\(/);
    expect((ROUTES_SRC.match(/\.buildManifestForPlan\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/** Directive words the execute path can record. */
function directiveDomain(): Set<string> {
  const d = new Set<string>(SharedPlanDirective.options);
  for (const a of RECORD_CALLS) for (const q of quoted(a[1])) d.add(q);
  // cidDirective fallback (validate task) — also a literal in the source
  for (const m of ROUTES_SRC.matchAll(/const cidDirective = ([^;]*);/g)) for (const q of quoted(m[1])) d.add(q);
  for (const { mp, tm } of MUSTER_PLANS) {
    const { plan } = translateLikeCli(mp, tm);
    for (const v of Object.values(plan.variables._control_directives as Record<string, string>)) d.add(v);
  }
  d.delete('exclude'); // rejected before recording (execute.routes cidDirective === 'exclude' branch)
  return d;
}

describe('FX-ST3 — manifest vocabulary vs shared ExecutionResultsManifestSchema', () => {
  const directives = [...directiveDomain()].sort();
  const verdicts = Object.values(ResultVerdict);

  it('directive domain covers the Muster words the flow files reported (implement/validate/manual)', () => {
    for (const w of ['implement', 'validate', 'manual', 'automated', 'validation', 'nonstack']) expect(directives).toContain(w);
    expect(verdicts).toEqual(expect.arrayContaining(['MET', 'NOT MET', 'SAT', 'NOT_SAT', 'PROVISIONAL', 'N/A']));
  });

  it.each(verdicts)('verdict %s × every directive → shared schema accepts', (verdict) => {
    const c = new ExecutionResultsCollector();
    directives.forEach((dir, i) => c.recordControlResult(`CTRL-${String(i).padStart(3, '0')}`, dir, verdict, 'outcome'));
    const m = c.buildManifest('run-1', 'sim-tenant', 'plan-1', 'ces-1');
    const r = SharedManifestSchema.safeParse(m);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 5)));
    expect(r.success).toBe(true);
  });

  it('maps met / not met and the Muster directive words to the shared enum', () => {
    const c = new ExecutionResultsCollector();
    c.recordControlResult('A', 'implement', ResultVerdict.MET, 'x');
    c.recordControlResult('B', 'validate', ResultVerdict.NOT_MET, 'x');
    c.recordControlResult('C', 'manual', ResultVerdict.NOT_APPLICABLE, 'x');
    const byId = Object.fromEntries(c.buildManifest('r', 't', 'p').results.map(r => [r.controlId, [r.directive, r.verdict]]));
    expect(byId).toEqual({ A: ['automated', 'sat'], B: ['validation', 'not_sat'], C: ['manual_gate', 'not_applicable'] });
  });
});

describe.each(MUSTER_PLANS)('FX-ST3 + FX-ST4 — real translated plan: $name', ({ mp: mpPath, tm }) => {
  const { mp, plan } = translateLikeCli(mpPath, tm);
  const musterPlanId = mp.outputs.human_readable_mission_plan.plan_id;

  function manifestForEveryControl() {
    const c = new ExecutionResultsCollector();
    const verdicts = Object.values(ResultVerdict);
    Object.entries(plan.variables._control_directives as Record<string, string>)
      .forEach(([cid, dir], i) => c.recordControlResult(cid, dir, verdicts[i % verdicts.length], 'outcome'));
    return c.buildManifestForPlan(plan.plan_id, 'sim-tenant', plan as any);
  }

  it('manifest from the production builder passes the shared schema', () => {
    const m = manifestForEveryControl();
    expect(m.totalControls).toBe(110);
    const r = SharedManifestSchema.safeParse(m);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 5)));
    expect(r.success).toBe(true);
  });

  it('planId is the Muster plan_id; executablePlanId keeps the translated id', () => {
    const m = manifestForEveryControl();
    expect(typeof musterPlanId).toBe('string');
    expect(m.planId).toBe(musterPlanId);
    expect(m.executablePlanId).toBe(`translated-${musterPlanId}`);
    expect(plan.plan_id).toBe(`translated-${musterPlanId}`);
    expect(m.cesId).toBe(mp.ces.cesId);
  });

  it('FX-ST5: shared schema 1.1.0 parse retains executablePlanId', () => {
    const m = manifestForEveryControl();
    const parsed = SharedManifestSchema.parse(m);
    expect(parsed.contractVersion).toBe(EXECUTION_RESULTS_CONTRACT_VERSION);
    expect(parsed.planId).toBe(musterPlanId);
    expect(parsed.executablePlanId).toBe(`translated-${musterPlanId}`);
  });
});

describe('FX-ST4 — sourcePlanIdOf fallback for plans translated before _source_plan_id', () => {
  it('strips the translated- prefix when the variable is absent', () => {
    expect(sourcePlanIdOf({ plan_id: 'translated-mplan_abc', variables: {} })).toBe('mplan_abc');
    expect(sourcePlanIdOf({ plan_id: 'hand-built', variables: {} })).toBe('hand-built');
    expect(sourcePlanIdOf({ plan_id: 'translated-x', variables: { _source_plan_id: 'y' } })).toBe('y');
  });
});
