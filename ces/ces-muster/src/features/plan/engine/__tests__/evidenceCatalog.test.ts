// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  loadEvidenceCatalog,
  validateEvidenceCatalog,
  EXAMINE_LISTS_FILE,
  RELEASE_LOG_FILE,
  type EvidenceCatalogIndex,
} from '../shared/services/evidenceCatalog';

/** EVC.1 (V29), Muster side: the vendored evidence catalog seed loads, validates and indexes (same cases as Planner's evidenceCatalog.test.ts). */

// jsdom's URL rejects file: resolution, so resolve the folder with node:path.
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/evidence-catalog') + path.sep;
const readBytes = (f: string) => readFileSync(DIR + f);
const read = async (f: string) => JSON.parse(readBytes(f).toString('utf-8'));
// V29: the hash is over the file's exact bytes as sent (the package files are CRLF).
const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

let index: EvidenceCatalogIndex;
beforeAll(async () => {
  index = await loadEvidenceCatalog(read);
});

describe('EVC.1 evidence catalog seed loader', () => {
  it('release log: release 0, 2026-10-26, AC 3.1.1, examine-lists SHA-256 matches the file', async () => {
    const log = await read(RELEASE_LOG_FILE);
    expect(index.releases).toHaveLength(1);
    const r0 = index.releases[0];
    expect(r0).toMatchObject({ release: 0, date: '2026-10-26', definitions: 14, practices_covered: ['AC 3.1.1'] });
    expect(r0.examine_lists_sha256).toBe('c254a6bf7f9db189b45817c23065c80058225fbb566ab2daaad3de63a3c5a4fc');
    expect(sha256(readBytes(EXAMINE_LISTS_FILE))).toBe(log.releases[0].examine_lists_sha256);
  });

  it('release 0 has 14 definitions for 3.1.1, each with an objective id; #E01 and #E08 carry no EMX id', () => {
    expect(index.definitions).toHaveLength(14);
    const defs = index.definitionsForPractice('AC.L2-3.1.1');
    expect(defs).toHaveLength(14);
    expect(defs.map((d) => d.examine_index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    for (const d of defs) expect(d.objective_ids.length).toBeGreaterThanOrEqual(1);
    expect(defs.filter((d) => d.emx_ids.length === 0).map((d) => d.definition_id)).toEqual([
      'AC.L2-3.1.1#E01',
      'AC.L2-3.1.1#E08',
    ]);
  });

  it('both practice-id forms resolve (R-4)', () => {
    const l1 = index.definitionsForPractice('AC.L1-3.1.1');
    expect(l1).toHaveLength(14);
    expect(l1).toEqual(index.definitionsForPractice('AC.L2-3.1.1'));
    expect(index.definitionsForPractice('3.1.1')).toEqual(l1);
    expect(index.definitionsForPractice('AC.L2-3.1.2')).toEqual([]);
    expect(index.examineList('AC.L1-3.1.1')).toBe(index.examineList('AC.L2-3.1.1'));
    expect(index.examineList('AC.L1-3.1.1')?.examine_count).toBe(14);
    expect(index.objectiveBucket('AC.L2-3.1.1[a]')).toBe(index.objectiveBucket('AC.L1-3.1.1[a]'));
    expect(index.objectiveBucket('AC.L2-3.1.1[a]')?.bucket).toBe('A');
  });

  it('indexes by EMX id', () => {
    expect(index.definitionsForEmx('EMX-IAM-004').map((d) => d.definition_id)).toEqual([
      'AC.L2-3.1.1#E02',
      'AC.L2-3.1.1#E07',
      'AC.L2-3.1.1#E09',
    ]);
    expect(index.definitionsForEmx('emx-log-004').map((d) => d.definition_id)).toEqual(['AC.L2-3.1.1#E12']);
    expect(index.definitionsForEmx('EMX-NONE-999')).toEqual([]);
  });

  it('examine lists: 110 requirements; objective buckets: 320 objectives', () => {
    expect(index.examineLists).toHaveLength(110);
    expect(new Set(index.examineLists.map((r) => r.requirement_id)).size).toBe(110);
    for (const r of index.examineLists) expect(r.examine).toHaveLength(r.examine_count);
    expect(index.objectives).toHaveLength(320);
    expect(new Set(index.objectives.map((o) => o.objective_id)).size).toBe(320);
    for (const o of index.objectives) expect(['A', 'B', 'C']).toContain(o.bucket);
  });

  it('validates on load: a catalog that breaks the schema is rejected', async () => {
    const bad = await read('evidence-catalog-release-0.json');
    bad.definitions[0].objective_ids = [];
    expect(() => validateEvidenceCatalog(bad, 'bad')).toThrow(/objective_ids/);
    await expect(
      loadEvidenceCatalog(async (f) => (f === 'evidence-catalog-release-0.json' ? bad : read(f))),
    ).rejects.toThrow(/does not match evidence-catalog.schema.json/);
  });
});
