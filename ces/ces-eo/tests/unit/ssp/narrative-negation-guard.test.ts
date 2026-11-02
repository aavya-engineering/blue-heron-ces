// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W1.4: the narrative negation guard flags every quote from the run-17 SSP review
 * (findings #1, #10, #17) on a met control, and never on any other status.
 */
import { describe, test, expect } from '@jest/globals';
import { NarrativeNegationGuard, loadNegationLexicon } from '../../../src/eo/ssp/NarrativeNegationGuard.js';

const QUOTES: Array<[string, string, string]> = [
  ['AC.L1-3.1.1', 'A dedicated security group for authorized users has not been created. Access control relies on individual account provisioning pending group-based automation.', 'has not been created'],
  ['AC.L1-3.1.1', 'Conditional Access policies are not yet configured. System access is controlled through Azure AD group membership and application-level permissions only.', 'not yet configured'],
  ['IA.L2-3.5.3', '0 authentication methods', '0 authentication methods'],
  ['IA.L2-3.5.3', 'MFA enforcement has not been configured', 'has not been configured'],
  ['IA.L1-3.5.1', 'data not available', 'data not available'],
  ['IA.L1-3.5.1', 'No artifacts captured', 'No artifacts captured'],
  ['SC.L2-3.13.11', '0 managed devices', '0 managed devices'],
  // Finding #10: 55 narratives carry the dangling token "managed by ." (empty responsible role).
  ['AC.L1-3.1.1', 'managed by .', 'managed by .'],
];

describe('W1.4 NarrativeNegationGuard', () => {
  test('the lexicon carries the review phrases', () => {
    const lex = loadNegationLexicon();
    for (const [, , phrase] of QUOTES) expect(lex).toContain(phrase);
  });

  test.each(QUOTES)('%s (met) is flagged for "%s"', (_id, quote, phrase) => {
    const flags = NarrativeNegationGuard.check('met', quote);
    expect(flags.map(f => f.phrase)).toContain(phrase);
    const f = flags.find(x => x.phrase === phrase)!;
    expect(f.kind).toBe('narrative-negation');
    expect(quote).toContain(f.excerpt.replace(/\.\.\.$/, ''));
  });

  test('the full AC.L1-3.1.1 run-17 narrative raises both flags', () => {
    const narrative = QUOTES[0][1] + '\n\n' + QUOTES[1][1];
    expect(NarrativeNegationGuard.check('met', narrative).map(f => f.phrase)).toEqual(['has not been created', 'not yet configured']);
  });

  test('matching is case-insensitive', () => {
    expect(NarrativeNegationGuard.check('met', 'NO ARTIFACTS CAPTURED').length).toBe(1);
  });

  test('only met controls are flagged', () => {
    for (const status of ['not_met', 'partial', 'not_assessed']) {
      for (const [, quote] of QUOTES) expect(NarrativeNegationGuard.check(status, quote)).toEqual([]);
    }
  });

  test('a count that merely ends in 0 is not a hit; a clean narrative raises nothing', () => {
    expect(NarrativeNegationGuard.check('met', 'Enforced on 10 managed devices and 20 authentication methods.')).toEqual([]);
    expect(NarrativeNegationGuard.check('met', 'Conditional Access requires MFA for all users; managed by the security team.')).toEqual([]);
  });
});
