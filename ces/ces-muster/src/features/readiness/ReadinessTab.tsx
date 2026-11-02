// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M6 — Readiness tab. READINESS-1 M3: when a completed session exists, the tab renders the
// customer readiness report (ReadinessReport over the exporter's payload — same build path as
// the download, so screen and file can never disagree).
//
// FIN-32: the readiness result downloads here (the same file the result screen exports), and the
// fixture "consume-when-available EO panel" is gone: it showed an SPRS number and a control
// matrix from src/__fixtures__/resultsMatrix.ts, i.e. invented results presented on a Muster
// screen. Muster collects data and writes the plan; it reads no results back from EO or Stamper
// and is not a dashboard (founder ruling, 2026-10-30).
import { useEffect, useState } from 'react';
import { executeReadinessExport, executeReadinessExportAndDownload } from '@/features/export/readinessResultService';
import type { ReadinessResult } from '@/shared/types/readinessResult';
import ReadinessReport from './ReadinessReport';

export default function ReadinessTab({
  completedSessionId,
}: {
  completedSessionId?: string | null;
}) {
  const [report, setReport] = useState<ReadinessResult | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [downloadError, setDownloadError] = useState('');

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

  const download = async () => {
    if (!completedSessionId) return;
    setDownloadError('');
    try {
      await executeReadinessExportAndDownload(completedSessionId);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="readiness-tab">
      <div className="ces-titleblock" style={{ marginBottom: 16 }}>
        <span className="tb-title">Readiness</span>
      </div>

      {!completedSessionId && (
        <p className="callout-warning" data-testid="readiness-no-session">
          Finish the interview (Situation) to see the readiness report.
        </p>
      )}

      {report && (
        <p>
          <button className="btn-secondary" data-testid="readiness-download-result" onClick={() => void download()}>
            Download readiness result
          </button>
        </p>
      )}
      {downloadError && (
        <p className="callout-warning" data-testid="readiness-download-error">
          Download failed: {downloadError}
        </p>
      )}

      {report && <ReadinessReport result={report} />}
      {!report && reportNote && (
        <p className="callout-warning" data-testid="readiness-report-note">
          Customer report unavailable: {reportNote}
        </p>
      )}
    </div>
  );
}
