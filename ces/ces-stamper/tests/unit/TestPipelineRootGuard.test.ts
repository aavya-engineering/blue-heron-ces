// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W5c7 test hygiene (the harness's V10 outside-the-workspace check found unit tests writing evidence under
// %LOCALAPPDATA%\CES\pipeline\Stamper\plan-data). Under jest, every root a test can write through is the
// run's temporary root (tests/setup/env.cjs), never the user's real pipeline folder or anything in %LOCALAPPDATA%.
import * as os from 'os';
import * as path from 'path';
import { getCesPipelineRoot, getStamperTenantRoot } from 'ces-shared/storage';
import { EVIDENCE_DIR, evidenceDirForTenant } from '../../src/core/EvidenceReadinessAnalyzer';

const inside = (p: string, base: string | undefined): boolean => {
  if (!base) return false;
  const a = path.resolve(base).toLowerCase().replace(/[\\/]+$/, '');
  const b = path.resolve(p).toLowerCase();
  return b === a || b.startsWith(a + path.sep);
};
const LAD = process.env.LOCALAPPDATA;
const RUN_ROOT = process.env.CES_STAMPER_TEST_PIPELINE_ROOT!;

describe('test pipeline root guard', () => {
  it('the run has a temporary root outside %LOCALAPPDATA%', () => {
    expect(RUN_ROOT).toBeTruthy();
    expect(inside(RUN_ROOT, LAD)).toBe(false);
  });

  it('every resolved write root is inside the run root, none inside %LOCALAPPDATA%', () => {
    const roots: Record<string, string> = {
      pipeline: getCesPipelineRoot(),
      'ces.db': path.join(getCesPipelineRoot(), 'ces.db'), // ces-shared getCesDbPath: {CES_PIPELINE_ROOT}/ces.db
      'EVIDENCE_DIR (import-time constant)': EVIDENCE_DIR,
      'tenant root': getStamperTenantRoot('fx-unit-guard'),
      'tenant evidence': evidenceDirForTenant('dev'),
      'os.tmpdir() (per-suite mkdtemp roots)': os.tmpdir(),
    };
    for (const [name, p] of Object.entries(roots)) {
      expect([name, inside(p, LAD)]).toEqual([name, false]);
      expect([name, inside(p, RUN_ROOT)]).toEqual([name, true]);
    }
  });

  it('the guard itself: a %LOCALAPPDATA% path is recognised', () => {
    if (!LAD) return; // not Windows
    expect(inside(path.join(LAD, 'CES', 'pipeline'), LAD)).toBe(true);
  });
});
