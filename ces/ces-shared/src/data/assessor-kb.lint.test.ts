// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// KB-1a lint for the Assessor Approach KB and Evidence Matrix (gap plan §8).
// Default mode checks structure only. Complete mode fails on any empty authored field:
//   KB_LINT_COMPLETE=1        -> every family
//   KB_LINT_COMPLETE=AT,AU    -> only the listed families
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain .mjs build script, no type declarations
import { buildKb, serialize, APPROACH_FILE, MATRIX_FILE } from '../../scripts/kb-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, 'assessor-kb');
const STORE_FILE = path.resolve(__dirname, '..', '..', '..', 'ces-muster', 'public', 'knowledge', 'domain CES CMMC Fundamental Requirements Store.yaml');

const CES_SOURCES = ['stack_signal', 'ao_row', 'stamper_evidence', 'ec_upload', 'eo_store', 'interview'];
const MIN_SENTENCE_CHARS = 25;

type EvidenceRow = { artifact_type: string; ces_source: string; notes: string };
type KbObjective = { id: string; determination: string; methods: string[]; evidence: EvidenceRow[] };
type KbPractice = {
  id: string;
  title: string;
  approach: { what_assessor_does: string; common_failure_modes: string[] };
  objectives: KbObjective[];
};
type KbFamily = { family: string; family_name: string; practices: KbPractice[] };

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const controls = readJson(path.join(__dirname, 'cmmc-l2-controls.reference.json'));
const objectivesRef: Array<{ objectiveId: string; controlId: string; description: string; methods: string[] }> =
  readJson(path.join(__dirname, 'assessment-objectives.reference.json')).objectives;
const familyCodes: string[] = controls.families.map((f: { abbreviation: string }) => f.abbreviation);
const families: KbFamily[] = familyCodes.map((code) => readJson(path.join(KB_DIR, `${code}.json`)));
const practices = families.flatMap((f) => f.practices.map((p) => ({ family: f.family, ...p })));
const objectives = practices.flatMap((p) => p.objectives.map((o) => ({ practiceId: p.id, ...o })));

function authoredStrings(p: KbPractice): string[] {
  return [
    p.approach.what_assessor_does,
    ...p.approach.common_failure_modes,
    ...p.objectives.flatMap((o) => o.evidence.flatMap((r) => [r.artifact_type, r.notes])),
  ].filter((s) => typeof s === 'string' && s.trim() !== '');
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const sentences = (s: string) =>
  s.split(/(?<=[.!?;])\s+/).map((x) => norm(x).replace(/[.!?;:,]+$/, '')).filter((x) => x.length >= MIN_SENTENCE_CHARS);

const completeEnv = (process.env.KB_LINT_COMPLETE ?? '').trim();
const completeFamilies =
  completeEnv === '' || completeEnv === '0'
    ? []
    : completeEnv === '1'
      ? familyCodes
      : completeEnv.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

describe('assessor KB structure (KB-1)', () => {
  it('has one source file per reference family, named for it', () => {
    expect(families.map((f) => f.family)).toEqual(familyCodes);
    const files = fs.readdirSync(KB_DIR).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual(familyCodes.map((c) => `${c}.json`).sort());
  });

  it('covers every one of the 110 practices exactly once, in the right family, with the reference title', () => {
    const ref = controls.controls as Array<{ control_id: string; family: string; practice: string }>;
    expect(ref.length).toBe(110);
    expect(practices.map((p) => p.id).sort()).toEqual(ref.map((c) => c.control_id).sort());
    for (const c of ref) {
      const p = practices.find((x) => x.id === c.control_id)!;
      expect(p.family, c.control_id).toBe(c.family);
      expect(p.title, c.control_id).toBe(c.practice);
    }
  });

  it('every objective id resolves to the 320, under its own practice, and all 320 are present', () => {
    expect(objectivesRef.length).toBe(320);
    const refById = new Map(objectivesRef.map((o) => [o.objectiveId, o]));
    for (const o of objectives) {
      const r = refById.get(o.id);
      expect(r, `unknown objective ${o.id}`).toBeDefined();
      expect(r!.controlId, o.id).toBe(o.practiceId);
    }
    expect(objectives.map((o) => o.id).sort()).toEqual([...refById.keys()].sort());
  });

  it('methods and determination statements match the 800-171A source', () => {
    const refById = new Map(objectivesRef.map((o) => [o.objectiveId, o]));
    for (const o of objectives) {
      const r = refById.get(o.id)!;
      expect(o.methods, o.id).toEqual(r.methods);
      expect(o.determination, o.id).toBe(r.description);
    }
  });

  it('authored fields have the schema shape; evidence rows name a real CES source', () => {
    for (const p of practices) {
      expect(typeof p.approach.what_assessor_does, p.id).toBe('string');
      expect(Array.isArray(p.approach.common_failure_modes), p.id).toBe(true);
      for (const f of p.approach.common_failure_modes) expect(typeof f, p.id).toBe('string');
      for (const o of p.objectives) {
        expect(Array.isArray(o.evidence), o.id).toBe(true);
        for (const r of o.evidence) {
          expect(Object.keys(r).sort(), o.id).toEqual(['artifact_type', 'ces_source', 'notes']);
          expect(CES_SOURCES, `${o.id} ces_source "${r.ces_source}"`).toContain(r.ces_source);
          expect(r.artifact_type.trim(), `${o.id} artifact_type`).not.toBe('');
        }
      }
    }
  });

  it.skipIf(!fs.existsSync(STORE_FILE))('no authored sentence is copied from the Planner Requirements Store (negative check)', () => {
    const store = norm(fs.readFileSync(STORE_FILE, 'utf-8'));
    const hits: string[] = [];
    for (const p of practices) {
      for (const s of authoredStrings(p).flatMap(sentences)) if (store.includes(s)) hits.push(`${p.id}: "${s}"`);
    }
    expect(hits).toEqual([]);
  });

  it('generated references are in sync with the family files (run scripts/kb-build.mjs)', () => {
    const { approach, matrix } = buildKb(__dirname);
    expect(fs.readFileSync(path.join(__dirname, APPROACH_FILE), 'utf-8')).toBe(serialize(approach));
    expect(fs.readFileSync(path.join(__dirname, MATRIX_FILE), 'utf-8')).toBe(serialize(matrix));
  });
});

describe.skipIf(completeFamilies.length === 0)(`assessor KB complete mode (KB_LINT_COMPLETE=${completeEnv})`, () => {
  it('every authored field in the selected families is filled', () => {
    for (const code of completeFamilies) expect(familyCodes, `unknown family ${code}`).toContain(code);
    const empty: string[] = [];
    for (const p of practices.filter((x) => completeFamilies.includes(x.family))) {
      if (p.approach.what_assessor_does.trim() === '') empty.push(`${p.id} approach.what_assessor_does`);
      if (p.approach.common_failure_modes.length === 0 || p.approach.common_failure_modes.some((f) => f.trim() === ''))
        empty.push(`${p.id} approach.common_failure_modes`);
      for (const o of p.objectives) {
        if (o.evidence.length === 0) empty.push(`${o.id} evidence`);
        for (const r of o.evidence) if (r.notes.trim() === '') empty.push(`${o.id} evidence.notes`);
      }
    }
    expect(empty).toEqual([]);
  });
});
