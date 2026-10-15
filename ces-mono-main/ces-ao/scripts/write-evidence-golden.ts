// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// A4 (AE-R2): regenerate test/fixtures/contract/adminops-evidence-rows.golden.json.
//
// The golden must come from the REAL persist path with only the PowerShell boundary
// mocked, and vi.mock only works inside vitest — so this script runs the conformance
// test with AO_WRITE_EVIDENCE_GOLDEN=1, which makes it call generateGoldenRows()
// (test/contract/evidenceGoldenGenerator.ts) against a temp database and write the file.
// Sim only: no tenant, no network. Usage: `npx tsx scripts/write-evidence-golden.ts`

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = spawnSync('npx', ['vitest', 'run', 'test/contract/adminopsEvidence.conformance.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AO_WRITE_EVIDENCE_GOLDEN: '1' },
});
process.exit(res.status ?? 1);
