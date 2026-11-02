// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-5 (V111 red, R-F2 S3 and mp): the control snippet templates opened with "X is enforced through ..."
 * on every status, so a not_met control's SSP narrative claimed the mechanism (FIN-11: never claim on a
 * control not met). Every template, rendered not_met / not_assessed with no reads, must hold no sentence
 * matching V111's affirmative patterns (restated from <PKG>/scripts/verify-gap.mjs V111_AFFIRMATIVE,
 * V111_NEGATED, V111_OWN_TEXT_END); a met render keeps the original lead.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SnippetTemplateEngine } from '../../src/eo/generation/SnippetTemplateEngine';

const DIR = path.resolve(__dirname, '../../src/eo/data/snippet-templates');
const AFFIRMATIVE = [
  /implemented and continuously verified/i,
  /\bthe organi[sz]ation (ensures|enforces|maintains|implements|employs|limits|controls|protects|monitors|provides|conducts|restricts|has (implemented|established|deployed))\b/i,
  /\b(is|are) (fully |properly )?(implemented|enforced|in place)\b/i,
];
const NEGATED = /\b(not|no|never|without|yet to|pending|absent|until|unless)\b/i;
const OWN_END = /Policy-based implementation:|\[Extracted from|\*\*Policy and plan reference/;
const affirmative = (text: string): string[] => {
  const m = OWN_END.exec(text);
  const own = m ? text.slice(0, m.index) : text;
  return own.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s && !NEGATED.test(s) && AFFIRMATIVE.some(re => re.test(s)));
};
const ids = fs.readdirSync(DIR).filter(f => f.endsWith('.hbs')).map(f => f.replace(/\.hbs$/, ''));
const assessment = (status: string) => ({ status, evidenceArtifactIds: [] } as any);

describe('PH-5 V111: no affirmative template sentence on a control not met', () => {
  const engine = new SnippetTemplateEngine();
  it.each(['not_met', 'not_assessed'])('all %s renders of the 111 templates are free of affirmative claims', (status) => {
    expect(ids.length).toBe(111);
    const hits = ids.flatMap(id => affirmative(engine.renderControlNarrative(id, assessment(status), [], { tenantName: 'Fictional Org (FICTIONAL)' }))
      .map(s => `${id}: ${s.slice(0, 80)}`));
    expect(hits).toEqual([]);
  });

  it('a met render keeps the mechanism lead; a not_met render states it as the requirement', () => {
    const met = engine.renderControlNarrative('AC.L2-3.1.5', assessment('met'), [], { tenantName: 'T' });
    expect(met).toContain('This organization employs the principle of least privilege');
    expect(met).toContain('Least privilege is enforced through Azure AD Privileged Identity Management');
    const nm = engine.renderControlNarrative('AC.L2-3.1.5', assessment('not_met'), [], { tenantName: 'T' });
    expect(nm).toContain('This control requires the organization to employ the principle of least privilege');
    expect(nm).toContain('Least privilege is to be enforced through Azure AD Privileged Identity Management');
    expect(nm).not.toContain('Least privilege is enforced through');
  });
});
