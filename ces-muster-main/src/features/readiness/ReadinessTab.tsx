// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M6 — Readiness tab. Renders SPRS via the existing computeSprs
// (src/features/scoring/sprsCalc.ts, called not reimplemented) and a matrix
// via the ResultsMatrixArtifact[] contract (Finding 3) sourced from
// src/__fixtures__/resultsMatrix.ts. This component never recomputes a
// matrix from raw objective/requirement data — it only ever maps over an
// already-shaped ResultsMatrixArtifact[].
//
// READINESS-1 M3: when a completed session exists, the tab renders the
// customer readiness report (ReadinessReport over the exporter's payload —
// same build path as the download, so screen and file can never disagree).
// The fixture matrix stays below as the consume-when-available EO panel.
import { useEffect, useState } from 'react';
import { computeSprs } from '@/features/scoring/sprsCalc';
import { RESULTS_MATRIX_FIXTURE } from '@/__fixtures__/resultsMatrix';
import { executeReadinessExport } from '@/features/export/readinessResultService';
import type { ReadinessResult } from '@/shared/types/readinessResult';
import ReadinessReport from './ReadinessReport';

function statusBadgeClass(status: string): string {
  if (status === 'met') return 'badge badge-compliant';
  if (status === 'not_met') return 'badge badge-violation';
  return 'badge badge-review';
}

export default function ReadinessTab({
  completedSessionId,
}: {
  completedSessionId?: string | null;
}) {
  const requirementResults = RESULTS_MATRIX_FIXTURE.map((row) => ({
    requirement_id: row.control_id,
    status: row.status === 'met' ? 'met' : 'not_met',
  }));
  const sprsResult = computeSprs(requirementResults);

  const [report, setReport] = useState<ReadinessResult | null>(null);
  const [reportNote, setReportNote] = useState('');

  useEffect(() => {
    if (!completedSessionId) return;
    let cancelled = false;
    executeReadinessExport(completedSessionId)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => {
        // A missing manifest is a legitimate state (the Situation tab was not
        // filled) — surface the reason, never a silent fixture fallback.
        if (!cancelled) setReportNote(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [completedSessionId]);

  return (
    <div data-testid="readiness-tab">
      <div className="ces-titleblock" style={{ marginBottom: 16 }}>
        <span className="tb-title">Readiness</span>
      </div>

      {report && <ReadinessReport result={report} />}
      {!report && reportNote && (
        <p className="callout-warning" data-testid="readiness-report-note">
          Customer report unavailable: {reportNote}
        </p>
      )}

      <p data-testid="readiness-sprs">
        SPRS: <span data-testid="readiness-sprs-score">{sprsResult.sprs}</span>{' '}
        ({sprsResult.assessed_count} assessed)
      </p>

      <table data-testid="readiness-matrix">
        <thead>
          <tr>
            <th>Control</th>
            <th>Objective</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {RESULTS_MATRIX_FIXTURE.map((row) => (
            <tr key={row.objective_id} data-testid={`readiness-matrix-row-${row.objective_id}`}>
              <td>{row.control_id}</td>
              <td>{row.objective_id}</td>
              <td className={statusBadgeClass(row.status)}>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
