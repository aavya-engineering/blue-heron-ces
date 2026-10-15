// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-ST3 — one bad Muster control must not abort translate.
// Input: ces-muster's committed golden Mission Plan + Tenant Manifest (read-only, via
// `git show main:` — not a possibly-dirty working tree). One control loses its
// stamper_action, another gets an unknown value. The production PlanTranslator must
// still translate; both controls become visible issue rows (manual-review directive +
// warning); every other control's directive matches the unmodified run.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { PlanTranslator, CONTROL_ISSUE_PREFIX } from '../../src/translators/PlanTranslator';
import { ManifestReader } from '../../src/translators/ManifestReader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const committedGolden = (name: string): string => {
  const r = spawnSync('git', ['-C', path.resolve(ROOT, '..', 'ces-muster'), 'show', `main:src/features/plan/__fixtures__/${name}`], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git show ces-muster main:${name} failed: ${r.stderr}`);
  return r.stdout;
};

describe('FX2-ST3 translate survives a bad Muster control', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx2-st3-'));
  const tmPath = path.join(tmp, 'tenant-manifest.json');
  let golden: any;

  const translate = (mp: any) => {
    const controls = mp.outputs.human_readable_mission_plan.controls;
    const translator = new PlanTranslator(undefined, undefined, controls);
    return translator.translate(mp, ManifestReader.fromFile(tmPath));
  };

  beforeAll(() => {
    fs.writeFileSync(tmPath, committedGolden('tenant-manifest.json'));
    golden = JSON.parse(committedGolden('manual-mission-plan.json'));
  });

  it('translates, flags both bad controls, and leaves every other directive unchanged', () => {
    const baseline = translate(JSON.parse(JSON.stringify(golden)));
    const baseDirectives = baseline.plan.variables._control_directives as Record<string, string>;

    const mutated = JSON.parse(JSON.stringify(golden));
    const hp = mutated.outputs.human_readable_mission_plan;
    const implementIds = hp.control_directives.filter((d: any) => d.directive === 'implement').map((d: any) => d.control_id);
    const [missingId, unknownId] = implementIds;
    const missing = hp.controls.find((c: any) => c.requirement_id === missingId);
    const unknown = hp.controls.find((c: any) => c.requirement_id === unknownId);
    delete missing.stamper_action;
    unknown.stamper_action = 'Teleport-Compliance';

    const result = translate(mutated); // must not throw
    const directives = result.plan.variables._control_directives as Record<string, string>;

    // Both appear as flagged issues: warning + issue row + manual-review directive + manual task.
    const issueIds = (result.controlIssues ?? []).map((i) => i.control_id).sort();
    expect(issueIds).toEqual([missingId, unknownId].sort());
    expect(result.plan.variables._control_issues).toEqual(result.controlIssues);
    for (const id of [missingId, unknownId]) {
      expect(result.warnings.some((w) => w.startsWith(CONTROL_ISSUE_PREFIX) && w.includes(id))).toBe(true);
      expect(directives[id]).toBe('manual');
      expect(result.plan.execution_graph.some((t) => t.action.args._directive === 'manual' && t.controls.includes(id))).toBe(true);
    }
    expect(result.warnings.find((w) => w.includes(unknownId))).toContain('Teleport-Compliance');

    // Every other control's directive matches the unmodified run.
    const others = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== missingId && k !== unknownId));
    expect(Object.keys(directives).length).toBe(Object.keys(baseDirectives).length);
    expect(others(directives)).toEqual(others(baseDirectives));
    // The unmodified run had no issues.
    expect(baseline.controlIssues ?? []).toEqual([]);
  });
});
