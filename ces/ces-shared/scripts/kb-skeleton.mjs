// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// KB-1a: generate one source file per CMMC family under src/data/assessor-kb/<FAMILY>.json.
// Structural fields (ids, titles, determination statements, methods) are always regenerated from
// cmmc-l2-controls.reference.json and assessment-objectives.reference.json. Authored fields
// (practice `approach`, objective `evidence`) are carried forward from any existing file and
// never overwritten. Run: node scripts/kb-skeleton.mjs

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'src', 'data');
const KB_DIR = path.join(DATA, 'assessor-kb');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

function emptyApproach() {
  return { what_assessor_does: '', common_failure_modes: [] };
}

function carryApproach(prev) {
  if (!prev || typeof prev !== 'object') return emptyApproach();
  return {
    what_assessor_does: typeof prev.what_assessor_does === 'string' ? prev.what_assessor_does : '',
    common_failure_modes: Array.isArray(prev.common_failure_modes) ? prev.common_failure_modes : [],
  };
}

function carryEvidence(prev) {
  if (!Array.isArray(prev)) return [];
  return prev.map((row) => ({
    artifact_type: row.artifact_type ?? '',
    ces_source: row.ces_source ?? '',
    notes: row.notes ?? '',
  }));
}

function main() {
  const controls = readJson(path.join(DATA, 'cmmc-l2-controls.reference.json'));
  const objectives = readJson(path.join(DATA, 'assessment-objectives.reference.json')).objectives;
  fs.mkdirSync(KB_DIR, { recursive: true });

  for (const fam of controls.families) {
    const file = path.join(KB_DIR, `${fam.abbreviation}.json`);
    const prev = fs.existsSync(file) ? readJson(file) : { practices: [] };
    const prevPractices = new Map((prev.practices ?? []).map((p) => [p.id, p]));
    const keptObjectiveIds = new Set();

    const practices = controls.controls
      .filter((c) => c.family === fam.abbreviation)
      .map((c) => {
        const pp = prevPractices.get(c.control_id);
        const prevObjs = new Map((pp?.objectives ?? []).map((o) => [o.id, o]));
        return {
          id: c.control_id,
          title: c.practice,
          approach: carryApproach(pp?.approach),
          objectives: objectives
            .filter((o) => o.controlId === c.control_id)
            .map((o) => {
              keptObjectiveIds.add(o.objectiveId);
              return {
                id: o.objectiveId,
                determination: o.description,
                methods: [...o.methods],
                evidence: carryEvidence(prevObjs.get(o.objectiveId)?.evidence),
              };
            }),
        };
      });

    for (const pp of prev.practices ?? []) {
      if (!practices.some((p) => p.id === pp.id)) console.warn(`[kb-skeleton] dropped practice ${pp.id} (not in reference)`);
      for (const o of pp.objectives ?? []) {
        if (!keptObjectiveIds.has(o.id)) console.warn(`[kb-skeleton] dropped objective ${o.id} (not in reference)`);
      }
    }

    const out = { family: fam.abbreviation, family_name: fam.name, practices };
    const text = JSON.stringify(out, null, 2) + '\n';
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
    if (before !== text) fs.writeFileSync(file, text);
    console.log(`[kb-skeleton] ${fam.abbreviation}: ${practices.length} practices, ${practices.reduce((n, p) => n + p.objectives.length, 0)} objectives${before === text ? ' (unchanged)' : ''}`);
  }
}

main();
