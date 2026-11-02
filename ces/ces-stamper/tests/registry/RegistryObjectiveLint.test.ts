// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-1 objective-id lint, over both Stamper registries. Every objective_ids value resolves in the
// ces-shared assessment-objectives reference and belongs to one of the entry's control_ids; every
// control_id is one of the 110 practices; source is an https URL wherever present. The main registry
// must carry objective_ids on every entry. The infra registry is checked only on the fields present
// (DEPTH-1b fills it).
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_DIR = path.resolve(__dirname, '../../src/registry');
const MAIN = path.join(REGISTRY_DIR, 'cmmc-l2-commands.registry.json');
const INFRA = path.join(REGISTRY_DIR, 'infra-cmmc-l2-commands.registry.json');
const OBJECTIVES = path.resolve(__dirname, '../../../ces-shared/src/data/assessment-objectives.reference.json');

interface Entry { entry_id: string; control_ids: string[]; objective_ids?: unknown; source?: unknown }

const reference = JSON.parse(fs.readFileSync(OBJECTIVES, 'utf-8')) as { objectives: { objectiveId: string; controlId: string }[] };
const objectiveControl = new Map(reference.objectives.map(o => [o.objectiveId, o.controlId]));
const practices = new Set(reference.objectives.map(o => o.controlId));

function loadEntries(file: string): Entry[] {
  return (JSON.parse(fs.readFileSync(file, 'utf-8')) as { entries: Entry[] }).entries;
}

// Entries kept unreachable on purpose (a control id outside the 110) until the founder decides; see LOG-DEPTH-1a.
const HELD = new Set(['AC.L2-3.1.2.role-assign']);

/** Problems on the fields an entry carries; `requireObjectives` also demands objective_ids. */
function lint(entries: Entry[], requireObjectives: boolean): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    for (const c of e.control_ids) {
      if (!practices.has(c) && !HELD.has(e.entry_id)) problems.push(`${e.entry_id}: control_id ${c} is not one of the 110 practices`);
    }
    if (e.objective_ids === undefined) {
      if (requireObjectives) problems.push(`${e.entry_id}: objective_ids missing`);
    } else if (!Array.isArray(e.objective_ids)) {
      problems.push(`${e.entry_id}: objective_ids is not an array`);
    } else {
      for (const id of e.objective_ids) {
        const control = typeof id === 'string' ? objectiveControl.get(id) : undefined;
        if (control === undefined) problems.push(`${e.entry_id}: objective ${String(id)} not in the reference`);
        else if (!e.control_ids.includes(control)) problems.push(`${e.entry_id}: objective ${id} belongs to ${control}, not to its control_ids`);
      }
      if (new Set(e.objective_ids).size !== e.objective_ids.length) problems.push(`${e.entry_id}: duplicate objective_ids`);
    }
    if (e.source !== undefined) {
      let ok = false;
      try { ok = typeof e.source === 'string' && new URL(e.source).protocol === 'https:'; } catch { ok = false; }
      if (!ok) problems.push(`${e.entry_id}: source is not an https URL`);
    }
  }
  return problems;
}

describe('DEPTH-1 registry objective lint', () => {
  it('the reference holds 110 practices', () => {
    expect(practices.size).toBe(110);
  });

  it('main registry: every entry carries objective_ids that resolve and belong to its controls', () => {
    expect(lint(loadEntries(MAIN), true)).toEqual([]);
  });

  it('infra registry: the fields present are valid (skips fields not yet filled)', () => {
    if (!fs.existsSync(INFRA)) return;
    expect(lint(loadEntries(INFRA), false)).toEqual([]);
  });

  it('the lint rejects a foreign objective, an unknown id, a non-practice control and a non-https source', () => {
    const bad: Entry[] = [
      { entry_id: 'x1', control_ids: ['AC.L1-3.1.1'], objective_ids: ['AC.L1-3.1.2[a]'] },
      { entry_id: 'x2', control_ids: ['AC.L1-3.1.1'], objective_ids: ['AC.L1-3.1.1[z]'] },
      { entry_id: 'x3', control_ids: ['AC.L2-3.1.2'], objective_ids: [] },
      { entry_id: 'x4', control_ids: ['AC.L1-3.1.1'], objective_ids: [], source: 'http://learn.microsoft.com/x' },
      { entry_id: 'x5', control_ids: ['AC.L1-3.1.1'] },
    ];
    const p = lint(bad, true);
    expect(p).toHaveLength(5);
    expect(lint([bad[4]], false)).toEqual([]);
  });
});
