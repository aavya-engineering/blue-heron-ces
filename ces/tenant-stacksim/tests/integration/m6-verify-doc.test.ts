// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDoc } from '../../src/cli/commands/verify-doc.js';

/**
 * M6 gate (PLAN.md Milestone Ladder row M6; Goal Document - G-STACKSIM-1
 * DOC). Wraps `verifyDoc()` (the same function `stacksim verify-doc` calls)
 * and asserts all 3 DOC checks pass against real, unmodified ces-eo/ces-ao/
 * ces-stamper code paths:
 *   1. Stamper's baseline-stamping path (IA.L2-3.5.3.fido2-enable).
 *   2. EO's real ComplianceSignalFetcher.fetchAuthorizationPolicy().
 *   3. AO's A-18 command, mutation visible via Get-MgAuditLogDirectoryAudit
 *      AND ledger.jsonl.
 * (DOC item 4 - "reproducible via one CLI command that exits 0 only if all
 * pass" - is exercised by `verifyDoc()`/`runVerifyDoc()` being the single
 * entry point under test here and by `stacksim verify-doc` itself, run
 * manually per the M6 test gate.)
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const PSMODULES_DIR = path.join(SIM_ROOT, 'psmodules');
const MONOREPO_ROOT = path.resolve(SIM_ROOT, '..');
const CES_EO_ROOT = path.join(MONOREPO_ROOT, 'ces-eo');
const TSX_CLI_PATH = path.join(MONOREPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe('M6: end-to-end DOC verification (stacksim verify-doc)', () => {
  it(
    'seeds a fresh m365_azure sim tenant, runs all 3 DOC checks against real ces-stamper/ces-eo/ces-ao code paths, and passes',
    async () => {
      const result = await verifyDoc({
        slug: `m6-test-${Date.now()}`,
        profilesDir: PROFILES_DIR,
        psmodulesDir: PSMODULES_DIR,
        cesEoRoot: CES_EO_ROOT,
        tsxCliPath: TSX_CLI_PATH,
      });

      const detail = result.checks.map((c) => `[${c.passed ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`).join('\n');

      expect(result.checks.length, detail).toBe(3);

      const check1 = result.checks.find((c) => c.name.includes('DOC check 1'));
      expect(check1?.passed, detail).toBe(true);

      const check2 = result.checks.find((c) => c.name.includes('DOC check 2'));
      expect(check2?.passed, detail).toBe(true);

      const check3 = result.checks.find((c) => c.name.includes('DOC check 3'));
      expect(check3?.passed, detail).toBe(true);

      expect(result.passed, detail).toBe(true);
    },
    120_000,
  );
});
