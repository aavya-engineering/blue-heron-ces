// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-8 (R-F5 Q1): the GUI's document-prohibition branch (a) sends any task holding a SET down
// the normal task path, as the CLI does, and (b) keeps the read-only branch's empty-read rule equal
// to the CLI's. PH-11 (founder Q3): that rule is now "an empty successful read is NOT_SAT".
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { prohibitionTakesTaskPath } from '../../src/server/routes/execute.routes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(__dirname, '../../src/server/routes/execute.routes.ts'), 'utf8');

// Shape of the DEPTH-4 MP.L2-3.8.6 prohibition sub-command (PlanTranslator keeps its SET).
const bitlocker = {
  id: 'MP.L2-3.8.6.bitlocker', label: 'Prohibition: BitLocker policy',
  set_command: 'New-CMMCBitLockerPolicy', get_command: 'Get-CMMCBitLockerPolicy',
  engine: 'graph', idempotency: 'get-then-set',
};
const readOnly = { id: 'MP.L2-3.8.7.read', label: 'Prohibition: read', set_command: '', get_command: 'Get-X', engine: 'graph', idempotency: 'safe' };

/** Body of the document-prohibition branch, from its `if` to the next directive handler. */
function prohibitionBranch(): string {
  const start = SRC.indexOf("if (directive === 'document-prohibition'");
  const end = SRC.indexOf("if (directive === 'inherit-fedramp')", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('PH-8 (a): a prohibition task with a set_command runs the set step in the GUI path', () => {
  it('a task holding the BitLocker SET takes the task path; a read-only task does not', () => {
    expect(prohibitionTakesTaskPath([bitlocker])).toBe(true);
    expect(prohibitionTakesTaskPath([readOnly, bitlocker])).toBe(true);
    expect(prohibitionTakesTaskPath([readOnly])).toBe(false);
    expect(prohibitionTakesTaskPath([{ ...readOnly, set_command: '   ' }])).toBe(false);
    expect(prohibitionTakesTaskPath([{ id: 'x' } as any])).toBe(false);
    expect(prohibitionTakesTaskPath([])).toBe(false);
  });

  it('the read-only branch is guarded by the helper, so a SET task falls through to taskRunner.executeTask', () => {
    expect(SRC).toMatch(/if \(directive === 'document-prohibition' && !prohibitionTakesTaskPath\(subCommands\)\) \{/);
    // No other branch catches document-prohibition before the normal path.
    expect(SRC.match(/directive === 'document-prohibition'/g)).toHaveLength(1);
    const fallThrough = SRC.indexOf('const idempDecision = idempotencyGuard.evaluateTask(task, false);');
    const exec = SRC.indexOf('await taskRunner.executeTask(', fallThrough);
    expect(fallThrough).toBeGreaterThan(SRC.indexOf("if (directive === 'document-prohibition'"));
    expect(exec).toBeGreaterThan(fallThrough);
    // document-prohibition is a known directive, so the safe-fail does not abort the fall-through.
    expect(SRC).toMatch(/const knownDirectives = \[[^\]]*'document-prohibition'/);
  });
});

describe('PH-8 (b) / PH-11 (founder Q3): the read-only branch keeps CLI parity under the new empty-read rule', () => {
  it('an all-read-only prohibition task takes the read branch; an empty read is no longer "capability not present"', () => {
    const branch = prohibitionBranch();
    // PH-11: a successful read with no output is NOT honest evidence of absence (founder Q3, 2026-11-01).
    expect(branch).not.toMatch(/prohibited capability not present in environment/);
    // Same judgement as the CLI's evidence-only route: the shared helper decides each read.
    expect(branch).toMatch(/const read = judgeProhibitionRead\(discovery\.exitCode, discovery\.rawOutput\);/);
    expect(branch).toMatch(/if \(read\.shown\) \{\s*enforcementVerified = true;/);
    expect(branch).toMatch(/complianceVerdict: \(enforcementVerified \? 'SAT' : 'NOT_SAT'\)/);
    // The helper is the adapter's (one rule, both paths), re-exported with the PH-8 task-path helper.
    expect(SRC).toMatch(/import \{[^}]*judgeProhibitionRead[^}]*prohibitionTakesTaskPath[^}]*\} from '\.\.\/\.\.\/adapters\/PowerShellAdapter\.js';/);
    expect(SRC).toMatch(/export \{ prohibitionTakesTaskPath \};/);
  });
});
