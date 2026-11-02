// @vitest-environment node

// FIN-32: the Readiness tab shows only the session's own readiness report and its download.
// The fixture EO panel (an SPRS number and a control matrix from src/__fixtures__/resultsMatrix.ts)
// is gone: Muster reads no results back and is not a dashboard (founder ruling 2026-10-30).
// Renders via react-dom/server (same node-renderability discipline as MusterNav).
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test, expect } from 'vitest';
import ReadinessTab from '../ReadinessTab';
import { RESULTS_MATRIX_FIXTURE } from '@/__fixtures__/resultsMatrix';

describe('ReadinessTab — no results loop (FIN-32)', () => {
  test('without a session it asks for the interview and shows no score', () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessTab));
    expect(html).toContain('data-testid="readiness-tab"');
    expect(html).toContain('data-testid="readiness-no-session"');
    expect(html).not.toContain('readiness-sprs');
    expect(html).not.toContain('SPRS');
  });

  test('no fixture result row renders (no invented EO results on a Muster screen)', () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessTab, { completedSessionId: null }));
    expect(html).not.toContain('readiness-matrix');
    for (const row of RESULTS_MATRIX_FIXTURE) expect(html).not.toContain(row.objective_id);
  });
});
