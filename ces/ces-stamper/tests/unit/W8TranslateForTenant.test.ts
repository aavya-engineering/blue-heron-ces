// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-STX: one translate path for the CLI and the GUI.
// - Golden: translateForTenant(mode 'cli') writes the same executable plan, byte for byte except
//   variables._translated_at, as the pre-W8 `stamper translate` block (replicated below verbatim).
// - Modes: 'cli' and 'gui' give equal projectExecutablePlan() on the same inputs.
// - Error surface: an unreadable Infra Manifest is an InvalidInfraManifestError in 'gui' mode only.
// - Gate crediting (GUI only): gateCreditedControls = gate entries' control_ids ∩ task.controls.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { CESInfrastructureManifestSchema } from '../../src/types/ces-artifacts.types';
import type { MPControl } from '../../src/types/ces-artifacts.types';
import {
  translateForTenant,
  projectExecutablePlan,
  findSiblingInfraManifest,
  InvalidInfraManifestError,
} from '../../src/translators/translateForTenant';
import { gateCreditedControls } from '../../src/core/gateCredit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const MUSTER_FIXTURES = path.resolve(ROOT, '..', 'ces-muster', 'src', 'features', 'plan', '__fixtures__');
const REGISTRY = path.join(ROOT, 'src', 'registry', 'cmmc-l2-commands.registry.json');

/** The pre-W8 `stamper translate` block (src/cli/index.ts), minus printing and the --tenant load. */
function legacyCliTranslate(missionPlanPath: string, manifestOption: string, outputPath: string) {
  const resolvedPlanPath = path.resolve(missionPlanPath);
  const resolvedManifestPath = path.resolve(manifestOption);
  let mpControls: MPControl[] | undefined;
  try {
    const mpJson = JSON.parse(fs.readFileSync(resolvedPlanPath, 'utf-8'));
    const controls = mpJson?.outputs?.human_readable_mission_plan?.controls;
    if (Array.isArray(controls) && controls.length > 0) mpControls = controls;
  } catch { /* handled downstream */ }
  let infraModelValue: 'm365_only' | 'm365_sentinel' | 'm365_azure' | undefined;
  let infraData: unknown;
  const infraCandidates = [
    manifestOption.replace(/tenant-manifest/i, 'infrastructure-manifest'),
    manifestOption.replace(/tenant-manifest/i, 'infra-manifest'),
  ].filter(p => p !== manifestOption);
  const infraManifestPath = infraCandidates.find(p => fs.existsSync(path.resolve(p)));
  if (infraManifestPath) {
    try {
      infraData = JSON.parse(fs.readFileSync(path.resolve(infraManifestPath), 'utf-8'));
      const infraParse = CESInfrastructureManifestSchema.safeParse(infraData);
      if (infraParse.success) infraModelValue = infraParse.data.infrastructure.infrastructure_model;
    } catch { /* Non-fatal */ }
  }
  const translator = new PlanTranslator(undefined, undefined, mpControls, infraModelValue);
  translator.loadRegistry(REGISTRY);
  return translator.translateFile(resolvedPlanPath, resolvedManifestPath, outputPath, undefined, {
    strictScope: undefined,
    ...(infraData !== undefined ? { infraManifest: infraData, infraManifestSource: path.resolve(infraManifestPath!) } : {}),
  });
}

function withoutTimestamp(file: string): string {
  const plan = JSON.parse(fs.readFileSync(file, 'utf-8'));
  delete plan.variables._translated_at;
  return JSON.stringify(plan, null, 2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w8-stx-'));

/** Inputs copied into a folder, the TM named `*tenant-manifest*` and the IM beside it as `*infra-manifest*`. */
function stage(name: string, mp: string, tm: string, im?: string): { mp: string; tm: string; im?: string } {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const out = { mp: path.join(dir, 'manual-mission-plan_x.json'), tm: path.join(dir, 'tenant-manifest_x.json') } as { mp: string; tm: string; im?: string };
  fs.copyFileSync(mp, out.mp);
  fs.copyFileSync(tm, out.tm);
  if (im) {
    out.im = path.join(dir, 'infra-manifest_x.json');
    fs.copyFileSync(im, out.im);
  }
  return out;
}

const CASES: Array<{ name: string; mp: string; tm: string; im?: string }> = [
  { name: 'full-registry', mp: path.join(FIXTURES, 'full-registry-mission-plan.json'), tm: path.join(FIXTURES, 'full-registry-manifest.json') },
  { name: 'synthetic', mp: path.join(FIXTURES, 'synthetic-mission-plan.json'), tm: path.join(FIXTURES, 'synthetic-tenant-manifest.json') },
  // Its Infra Manifest fixture is pre-contract (no `ces` block): the translator rejects it in both
  // paths, so the case runs on the MP and TM only; the Muster fixture below covers an Infra Manifest.
  {
    name: 'manual',
    mp: path.join(FIXTURES, 'manual-mission-plan_1_manual-2026-03-09T21-39-38-932Z.json'),
    tm: path.join(FIXTURES, 'tenant-manifest_1_manifest-2026-03-09T21-39-38-932Z.json'),
  },
  ...(fs.existsSync(path.join(MUSTER_FIXTURES, 'manual-mission-plan.json')) ? [{
    name: 'muster-fixture',
    mp: path.join(MUSTER_FIXTURES, 'manual-mission-plan.json'),
    tm: path.join(MUSTER_FIXTURES, 'tenant-manifest.json'),
    im: path.join(MUSTER_FIXTURES, 'infrastructure-manifest.json'),
  }] : []),
];

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('W8-STX golden: the CLI executable plan is unchanged', () => {
  it.each(CASES.map(c => [c.name, c] as const))('%s: translateForTenant(cli) equals the pre-W8 CLI block', async (_name, c) => {
    const s = stage(`golden-${c.name}`, c.mp, c.tm, c.im);
    const before = path.join(path.dirname(s.mp), 'before.executable.json');
    const after = path.join(path.dirname(s.mp), 'after.executable.json');
    const legacy = legacyCliTranslate(s.mp, s.tm, before);
    // DEPTH-2: with an m365_azure Infra Manifest the default path merges the infra registry
    // (Depth2MergedRegistry.test.ts); the main-registry path, named, is still byte-identical.
    const out = await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: after, ...(c.im ? { registryPath: REGISTRY } : {}) });
    expect(withoutTimestamp(after)).toBe(withoutTimestamp(before));
    expect(out.result.warnings).toEqual(legacy.warnings);
    expect(out.registryPath).toBe(REGISTRY);
    if (c.im) expect(out.infraManifestPath).toBe(path.resolve(s.im!));
    else expect(out.infraManifestPath).toBeUndefined();
  });
});

describe('W8-STX modes: cli and gui give the same projection', () => {
  it.each(CASES.map(c => [c.name, c] as const))('%s: projectExecutablePlan(cli) equals projectExecutablePlan(gui)', async (_name, c) => {
    const s = stage(`modes-${c.name}`, c.mp, c.tm, c.im);
    const cliOut = path.join(path.dirname(s.mp), 'cli.json');
    const guiOut = path.join(path.dirname(s.mp), 'gui.json');
    await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: cliOut });
    await translateForTenant({ mode: 'gui', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: guiOut, infraManifestPath: s.im });
    const a = projectExecutablePlan(JSON.parse(fs.readFileSync(cliOut, 'utf-8')));
    const b = projectExecutablePlan(JSON.parse(fs.readFileSync(guiOut, 'utf-8')));
    expect(a.tasks.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

describe('W8-STX error surface', () => {
  it('an unreadable Infra Manifest is a 400-class error in gui mode and ignored in cli mode', async () => {
    const s = stage('bad-infra', CASES[0].mp, CASES[0].tm);
    const badIm = path.join(path.dirname(s.mp), 'infra-manifest_x.json');
    fs.writeFileSync(badIm, '{ not json');
    await expect(translateForTenant({ mode: 'gui', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: path.join(path.dirname(s.mp), 'g.json'), infraManifestPath: badIm }))
      .rejects.toBeInstanceOf(InvalidInfraManifestError);
    const out = await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: path.join(path.dirname(s.mp), 'c.json') });
    expect(out.result.plan.execution_graph.length).toBeGreaterThan(0);
    expect(out.infraManifestPath).toBe(path.resolve(badIm));
  });

  it('findSiblingInfraManifest prefers infrastructure-manifest over infra-manifest', () => {
    const dir = path.join(tmp, 'sibling');
    fs.mkdirSync(dir, { recursive: true });
    const tm = path.join(dir, 'tenant-manifest_y.json');
    fs.writeFileSync(path.join(dir, 'infra-manifest_y.json'), '{}');
    expect(findSiblingInfraManifest(tm)).toBe(path.join(dir, 'infra-manifest_y.json'));
    fs.writeFileSync(path.join(dir, 'infrastructure-manifest_y.json'), '{}');
    expect(findSiblingInfraManifest(tm)).toBe(path.join(dir, 'infrastructure-manifest_y.json'));
  });
});

describe('W8-STX projectExecutablePlan', () => {
  it('keeps the compared fields and leaves out plan_id, timestamps, _source_paths and _pre_accomplished', () => {
    const plan = {
      plan_id: 'translated-x',
      _source_paths: { mission_plan: 'a', translated_at: '2026-10-29T00:00:00Z' },
      variables: { tenantDomain: 'example.test', _translated_at: '2026-10-29T00:00:00Z', _control_directives: { 'AC.L2-3.1.1': 'automated' } },
      execution_graph: [{
        id: 't1', controls: ['AC.L2-3.1.1'],
        action: { engine: 'powershell', args: { _directive: 'implement', _sub_commands: [{
          id: 'e1', set_command: 'Set-X', get_command: 'Get-X', evidence_commands: ['Get-Y'], _pre_accomplished: true,
          org_values: [{ field: 'f' }], lookup: { kind: 'k' }, verification: { method: 'm' },
        }] } },
      }],
    };
    expect(projectExecutablePlan(plan)).toEqual({
      tasks: [{
        id: 't1', engine: 'powershell', directive: 'implement', controls: ['AC.L2-3.1.1'],
        sub_commands: [{ id: 'e1', set_command: 'Set-X', get_command: 'Get-X', evidence_commands: ['Get-Y'],
          org_values: [{ field: 'f' }], lookup: { kind: 'k' }, verification: { method: 'm' } }],
      }],
      variables: { tenantDomain: 'example.test', _control_directives: { 'AC.L2-3.1.1': 'automated' } },
    });
  });
});

describe('W8-STX (4) GUI manual-gate crediting', () => {
  it('credits the gate entries\' control_ids ∩ task.controls', () => {
    expect(gateCreditedControls(['AC.L2-3.1.1', 'AC.L2-3.1.2', 'AU.L2-3.3.1'], [{ control_ids: ['AC.L2-3.1.2', 'SC.L2-3.13.1'] }]))
      .toEqual(['AC.L2-3.1.2']);
  });
  it('unions over several gate entries, in task order', () => {
    expect(gateCreditedControls(['A', 'B', 'C'], [{ control_ids: ['C'] }, { control_ids: ['A'] }, {}])).toEqual(['A', 'C']);
  });
  it('falls back to task.controls when no entry carries control_ids (default unchanged)', () => {
    expect(gateCreditedControls(['A', 'B'], [{}])).toEqual(['A', 'B']);
    expect(gateCreditedControls(['A'], [])).toEqual(['A']);
    expect(gateCreditedControls(undefined, [])).toEqual([]);
  });
  it('credits nothing when the entries name none of the task\'s controls', () => {
    expect(gateCreditedControls(['A'], [{ control_ids: ['Z'] }])).toEqual([]);
  });
});
