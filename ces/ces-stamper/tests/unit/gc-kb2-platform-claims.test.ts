// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-KB-2: Stamper's platform-inherited claim text (assess.routes.ts) comes from the KB-1 assessor KBs in ces-shared,
 * not from hard-coded strings. Text only: the verdict stays SAT.
 */
import { describe, test, expect } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { platformClaimFromKb } from '../../src/server/routes/assess.routes.js';

const req = createRequire(path.resolve('package.json'));
const approach = JSON.parse(fs.readFileSync(req.resolve('ces-shared/data/assessor-approach'), 'utf-8')) as { practices: Array<{ id: string; title: string; what_assessor_does: string }> };
const PLATFORM = ['AU.L2-3.3.7', 'IA.L2-3.5.11', 'RA.L2-3.11.2', 'IA.L1-3.5.1', 'IA.L1-3.5.2', 'CM.L2-3.4.8', 'RA.L2-3.11.1', 'RA.L2-3.11.3', 'CA.L2-3.12.2'];

describe('GC-KB-2 platform-inherited claim text from the assessor KB', () => {
  test('practice is the KB title and the detail carries the basis and the KB approach', () => {
    for (const id of PLATFORM) {
      const kb = approach.practices.find((p) => p.id === id)!;
      const claim = platformClaimFromKb(id, 'BASIS');
      expect(claim.practice).toBe(kb.title);
      expect(claim.detail.startsWith('BASIS. Assessor approach (assessor KB): ')).toBe(true);
      expect(claim.detail).toContain(kb.what_assessor_does);
      expect(claim.detail).toMatch(/Evidence the assessor expects: .+\.$/);
    }
  });

  test('an id the KB does not hold throws (no silent hard-coded fallback)', () => {
    expect(() => platformClaimFromKb('XX.L9-0.0.0', 'BASIS')).toThrow(/no entry/);
  });

  test('the route source keeps no hard-coded practice or detail strings for these controls', () => {
    const src = fs.readFileSync(path.resolve('src/server/routes/assess.routes.ts'), 'utf-8');
    expect(src).not.toMatch(/This satisfies [A-Z]{2}\.L[12]-/);
    expect(src).not.toContain("practice: 'Obscure feedback of authentication information.'");
    expect(src).toContain('PLATFORM_INHERITED_BASIS.map(');
  });
});
