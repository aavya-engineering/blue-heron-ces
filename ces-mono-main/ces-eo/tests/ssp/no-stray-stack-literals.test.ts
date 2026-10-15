// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * G4 #1 (EO scope) — No-stray-literals guard.
 *
 * The stack-AGNOSTIC EO modules that were routed through the stack-provider seam in G4 must NOT
 * hard-code stack-specific literals — those must come from the active provider's capabilities
 * (cloudEndpoints / conventions). This guard asserts the specific selection/orchestration files
 * that were made stack-agnostic contain none of the canonical Microsoft/GCC-High literals.
 *
 * SCOPE (intentionally narrow — see ADR-003 §5):
 *   - src/eo/ssp/SspGenerator.ts            (narrative-strategy selection via sspNarrativeSourceId)
 *   - src/eo/mapping/SignalToControlMapper.ts (control-signal registry selection)
 *   - src/eo/mapping/evaluators/index.ts     (evaluator-set selection)
 *   - src/eo/server/EoServer.ts              (resolves the active provider + threads it in)
 *
 * EXPLICITLY OUT OF SCOPE (NOT asserted here):
 *   - The Microsoft reference provider (shared/.../providers/microsoftGccHigh.ts) — the sanctioned
 *     home for these literals.
 *   - PowerShell-cmdlet / Graph-fetcher internals and other Microsoft reference-implementation
 *     internals, which legitimately keep their literals (ADR-003 §5).
 *
 * Note: the target literals are the canonical GCC-High identifiers from the Microsoft provider's
 * capabilities. Human-readable display strings (e.g. "M365 GCC High") are not these machine literals
 * and are not policed by this guard.
 */
import { describe, test, expect } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Files made stack-agnostic in G4 — they must resolve stack specifics via the provider.
const STACK_AGNOSTIC_FILES = [
  'src/eo/ssp/SspGenerator.ts',
  'src/eo/mapping/SignalToControlMapper.ts',
  'src/eo/mapping/evaluators/index.ts',
  'src/eo/server/EoServer.ts',
];

// Canonical Microsoft/GCC-High literals that must NOT be hard-coded in stack-agnostic code.
const FORBIDDEN_LITERALS = [
  'gcc_high',
  'graph.microsoft.us',
  'login.microsoftonline.us',
];

describe('G4 no-stray-stack-literals guard (EO scope)', () => {
  test.each(STACK_AGNOSTIC_FILES)('%s contains no hard-coded stack literals', (relPath) => {
    const abs = path.join(REPO_ROOT, relPath);
    expect(fs.existsSync(abs)).toBe(true);
    const contents = fs.readFileSync(abs, 'utf-8');
    for (const literal of FORBIDDEN_LITERALS) {
      expect(contents.includes(literal)).toBe(false);
    }
  });
});
