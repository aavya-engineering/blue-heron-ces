// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-07: the committed readiness index equals a fresh build from the banks in
// public/knowledge (the same files Planner reads). UPDATE_READINESS_INDEX=1 rewrites it.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { buildReadinessIndex } from '../readinessIndex';

const K = path.resolve(process.cwd(), 'public/knowledge');
const OUT = path.resolve(process.cwd(), 'src/features/scoring/readinessIndex.json');
const yaml = (f: string) => load(fs.readFileSync(path.join(K, f), 'utf8'));

describe('MG-07 readiness index', () => {
  it('readinessIndex.json is the current projection of the RR bank, patterns and playbook', () => {
    const built = buildReadinessIndex(
      yaml('primed RR Question Bank.yaml'),
      yaml('domain Implementation Patterns.yaml'),
      yaml('vendor playbook Microsoft 365.yaml')
    );
    const text = JSON.stringify(built, null, 1) + '\n';
    if (process.env.UPDATE_READINESS_INDEX === '1') fs.writeFileSync(OUT, text);
    expect(JSON.parse(fs.readFileSync(OUT, 'utf8'))).toEqual(built);
    expect(built.activities).toHaveLength(165);
  });
});
