// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-C EO-06 (2026-09-27): before deleting the unloaded src/eo/generation/templates set, the
 * scenario-split AT.L2-3.2.3 files (cui-handlers / privileged) were checked for content the live
 * snippets lack. Two findings, both pinned here against the PRODUCTION SnippetTemplateEngine:
 *
 *  1. The live AT.L2-3.2.2 / AT.L2-3.2.3 snippets had their BODIES SWAPPED: 3.2.2 ("trained to carry
 *     out information security duties" = role-based training, NIST SP 800-171 3.2.2) rendered the
 *     insider-threat body, and 3.2.3 (insider threat, 3.2.3) rendered the role-based body.
 *  2. The role-based body lacked the CUI-handler track and the privileged-user topics (separate
 *     admin accounts, break-glass procedures) the old split files covered. Only the generic
 *     curriculum language was ported — none of the old files' fixed numbers, dates or policy ids.
 */
import { SnippetTemplateEngine } from '../../../src/eo/generation/SnippetTemplateEngine';
import type { ControlAssessment } from 'ces-shared/types/controls';

function assessment(controlId: string): ControlAssessment {
  return {
    control_id: controlId,
    nist_ref: controlId,
    status: 'not_assessed' as ControlAssessment['status'],
    classification: 'manual' as ControlAssessment['classification'],
    sources: [],
    last_assessed: '2026-09-27T00:00:00.000Z',
    signals: [],
    evidenceArtifactIds: [],
    automationSource: 'manual',
    lastFetchedAt: '2026-09-27T00:00:00.000Z',
  };
}

const vars = { tenantName: 'Sim Tenant', systemAdministrator: 'IT Administrator' };

describe('FC-EO-C EO-06: AT role-based / insider-threat snippets', () => {
  const engine = new SnippetTemplateEngine();
  const render = (id: string) => engine.renderControlNarrative(id, assessment(id), [], vars);

  it('AT.L2-3.2.2 renders the role-based training body under its own heading', () => {
    const out = render('AT.L2-3.2.2');
    expect(out).toMatch(/^## Control AT\.L2-3\.2\.2: Ensure Personnel Are Trained to Carry Out Information Security Duties/);
    expect(out).toContain('**Role-Specific Training Tracks:**');
    expect(out).not.toContain('**Insider Threat Awareness Training:**');
    expect(out).toContain('procedure AT-002');
  });

  it('AT.L2-3.2.3 renders the insider-threat body under its own heading', () => {
    const out = render('AT.L2-3.2.3');
    expect(out).toMatch(/^## Control AT\.L2-3\.2\.3: Provide Security Awareness Training on Recognizing and Reporting Potential Indicators of Insider Threat/);
    expect(out).toContain('**Insider Threat Awareness Training:**');
    expect(out).not.toContain('**Role-Specific Training Tracks:**');
    expect(out).toContain('procedure AT-003');
  });

  it('the role-based body carries the ported CUI-handler track and privileged-user topics', () => {
    const out = render('AT.L2-3.2.2');
    expect(out).toContain('**CUI Handlers:**');
    expect(out).toMatch(/CUI Basic vs\. CUI Specified/);
    expect(out).toMatch(/sensitivity labels/i);
    expect(out).toMatch(/approved CUI storage locations and transmission methods/i);
    expect(out).toMatch(/Separate privileged and standard user accounts/);
    expect(out).toMatch(/Break-glass \(emergency access\) account procedures/);
    expect(out).toMatch(/retrain(ing)? on role change or privilege escalation/i);
  });

  it('none of the old files\' fabricated specifics came across', () => {
    for (const id of ['AT.L2-3.2.2', 'AT.L2-3.2.3']) {
      const out = render(id);
      expect(out).not.toMatch(/\bCA-0\d\d\b/);           // invented Conditional Access policy ids
      expect(out).not.toMatch(/\b\d+ of \d+\b/);          // invented compliance counts
      expect(out).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);    // invented review / update dates
      expect(out).not.toMatch(/\d+(\.\d+)?%/);             // invented rates
    }
  });
});
