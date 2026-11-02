// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * P9-EO (check V111 (a), SSP truthfulness): a not_met / not_assessed control's "Verification (Tenant Manifest):"
 * paragraph restates each assessment-objective check as not yet shown this run, so no sentence reads as an
 * affirmative claim. Text only: no control status or SPRS value moves (AR5).
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });

import * as fs from 'node:fs';
import * as path from 'node:path';

type Mod = typeof import('../../src/eo/ssp/SspGenerator.js');
let mod: Mod;
beforeAll(async () => { mod = await import('../../src/eo/ssp/SspGenerator.js'); });

// Copy of the run package's V111 (a) sentence rule (ces-muster-run scripts/verify-gap.mjs, v111AffirmativeSentences).
const AFFIRMATIVE = [
  /implemented and continuously verified/i,
  /\bthe organi[sz]ation (ensures|enforces|maintains|implements|employs|limits|controls|protects|monitors|provides|conducts|restricts|has (implemented|established|deployed))\b/i,
  /\b(is|are) (fully |properly )?(implemented|enforced|in place)\b/i,
];
const NEGATED = /\b(not|no|never|without|yet to|pending|absent|until|unless)\b/i;
const OWN_END = /Policy-based implementation:|\[Extracted from|\*\*Policy and plan reference/;
function affirmative(text: string): string[] {
  const m = OWN_END.exec(text);
  const own = m ? text.slice(0, m.index) : text;
  return own.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s && !NEGATED.test(s) && AFFIRMATIVE.some(re => re.test(s)));
}

const PE_NARRATIVE = 'Required state (Tenant Manifest): Alternate Work Site Safeguards (PE.L2-3.10.6) — required; not yet shown to be in place.\n\n'
  + 'Procedure (Mission Plan step "Alternate Work Site Safeguards (PE.L2-3.10.6)", owner role compliance_engineer): Document alternate work site security requirements.\n\n'
  + 'Verification (Tenant Manifest): PE.L2-3.10.6[a]: safeguarding measures for CUI are defined for alternate work sites. PE.L2-3.10.6[b]: safeguarding measures for CUI are enforced for alternate work sites.\n\n'
  + '**Evidence:** Evidence store: 1 record(s) (collect.stamperEvidence).\n\nPolicy-based implementation: # Physical Protection Policy';

describe('P9-EO withVerificationNotYetShown', () => {
  test('every verification sentence is qualified; the R-F6 PE.L2-3.10.6 sentence is no longer affirmative', () => {
    expect(affirmative(PE_NARRATIVE)).toHaveLength(1);
    const out = mod.withVerificationNotYetShown(PE_NARRATIVE);
    expect(affirmative(out)).toEqual([]);
    expect(out).toContain('Verification (Tenant Manifest): PE.L2-3.10.6[a]: safeguarding measures for CUI are defined for alternate work sites (not yet shown this run). '
      + 'PE.L2-3.10.6[b]: safeguarding measures for CUI are enforced for alternate work sites (not yet shown this run).\n\n');
    // the other paragraphs are byte-identical
    const others = (s: string) => s.split('\n\n').filter(p => !p.startsWith('Verification (Tenant Manifest): '));
    expect(others(out)).toEqual(others(PE_NARRATIVE));
  });

  test('idempotent, and a narrative without a verification paragraph is unchanged', () => {
    const once = mod.withVerificationNotYetShown(PE_NARRATIVE);
    expect(mod.withVerificationNotYetShown(once)).toBe(once);
    const plain = 'Required state (Tenant Manifest): X — required; not yet shown to be in place.\n\nProcedure (Mission Plan step).';
    expect(mod.withVerificationNotYetShown(plain)).toBe(plain);
  });

  test('a check without a closing stop gets one', () => {
    expect(mod.withVerificationNotYetShown('Verification (Tenant Manifest): X are enforced'))
      .toBe('Verification (Tenant Manifest): X are enforced (not yet shown this run).');
  });
});

// Replay over the R-F6 SSPs (read only): every not_met / not_assessed narrative, rewritten, has no V111 (a) sentence.
// PL-123 / CR-18: the evidence root comes from CES_EVIDENCE_REPLAY_ROOT (for example BHD's <WS>\evidence). Unset = the
// replay is skipped, so the unit gate never reads a workspace's live evidence through a hard-coded path.
const EVIDENCE = process.env.CES_EVIDENCE_REPLAY_ROOT ?? '';
const SLUGS = ['s1-mach', 's2-eng', 's3-def', 'muster-partial'];
describe('P9-EO replay on the R-F6 SSPs', () => {
  for (const slug of SLUGS) {
    const file = EVIDENCE ? path.join(EVIDENCE, `gc-rf6-${slug}`, 'ws', 'out', 'ssp.json') : '';
    const why = EVIDENCE ? (fs.existsSync(file) ? '' : ` [skipped: ${file} is absent]`) : ' [skipped: CES_EVIDENCE_REPLAY_ROOT is not set]';
    (why ? test.skip : test)(`${slug}: no affirmative sentence on a not_met / not_assessed control after the rewrite${why}`, () => {
      const ssp = JSON.parse(fs.readFileSync(file, 'utf-8')) as { controlImplementations: Array<{ control_id: string; status: string; implementationNarrative: string }> };
      const hits = ssp.controlImplementations
        .filter(c => c.status === 'not_met' || c.status === 'not_assessed')
        .flatMap(c => affirmative(mod.withVerificationNotYetShown(c.implementationNarrative)).map(s => `${c.control_id}: ${s}`));
      expect(hits).toEqual([]);
    });
  }
});
