// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * AssessorViewHtml — smoke test: the self-contained viewer renders, embeds a parseable payload,
 * and exposes all six pivot axes. Guards the template (its client JS is not type-checked).
 */
import { describe, test, expect } from '@jest/globals';
import { renderAssessorHtml } from '../../src/eo/viewer/AssessorViewHtml.js';
import type { AssessorView } from '../../src/eo/viewer/AssessorViewComposer.js';

const view: AssessorView = {
  tenantId: 'vfsgov', generatedAt: '2026-07-03T00:00:00Z',
  sprs: { score: 102, controlsMet: 90, controlsNotMet: 1, controlsPartial: 8, controlsNotAssessed: 11, pointsAtRisk: 8 },
  objectives: [
    { objectiveId: 'AC.L2-3.1.7[a]', controlId: 'AC.L2-3.1.7', family: 'AC', statement: 'privileged functions are defined', methods: ['examine', 'interview'], status: 'other_than_satisfied', source: 'digital-signal', rationale: 'r', weight: 5, certificationBlocker: true },
  ],
  controls: [
    { controlId: 'AC.L2-3.1.7', family: 'AC', status: 'not_met', weight: 5, certificationBlocker: true, pointsAtRisk: 5, narrative: 'PIM enforced.', evidence: [{ label: 'run-1/art-2', runId: 'run-1', artifactId: 'art-2', href: '/api/evidence/artifacts/run-1/art-2', verifyHref: '/api/evidence/verify/run-1/art-2', wormVerifiable: true }], missionSteps: [{ what: 'Convert GA to PIM', owner: 'ISSO' }], personas: ['P6'], objectiveIds: ['AC.L2-3.1.7[a]'] },
  ],
  summary: { objectivesTotal: 1, objectivesSatisfied: 0, objectivesOther: 1, objectivesNotAssessed: 0, deficiencies: 1, certificationBlockers: 1, openPoamItems: 1, autoClosedPoamItems: 0, evidenceRefs: 1 },
};

describe('AssessorViewHtml', () => {
  const html = renderAssessorHtml(view);

  test('renders a self-contained HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Assessor Determination Viewer');
    expect(html).not.toContain('http://');   // no external resources
  });

  test('exposes all six pivot axes', () => {
    for (const axis of ['Objective', 'Practice', 'Family', 'Approach', 'Persona', 'Status']) {
      expect(html).toContain(axis);
    }
  });

  test('embeds a parseable payload with the objective + WORM evidence link', () => {
    const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const parsed = JSON.parse(m![1].replace(/\\u003c/g, '<'));
    expect(parsed.objectives[0].objectiveId).toBe('AC.L2-3.1.7[a]');
    expect(parsed.controls[0].evidence[0].verifyHref).toContain('/api/evidence/verify/');
  });
});
