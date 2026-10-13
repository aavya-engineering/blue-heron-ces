// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import { db } from '@/shared/db/schema';
import { scoreFacts } from './scoringService';
import { computeSprs } from './sprsCalc';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { exportEvidencePackage } from '@/features/export/evidencePackageService';
import { executeReadinessExportAndDownload } from '@/features/export/readinessResultService';
import type { ReadinessPosture } from '@/vendored/ces-spine/types/artifacts';

interface ResultScreenProps {
  sessionId: string;
  onExport: () => void;
}

export default function ResultScreen({ sessionId, onExport }: ResultScreenProps) {
  const [posture, setPosture] = useState<ReadinessPosture | null>(null);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readinessError, setReadinessError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function compute() {
      try {
        const session = await db.interview_sessions.get(sessionId);
        if (!session) { setError('Session not found.'); return; }
        const stacks = session.selected_stacks ?? [];
        const graph = await loadQuestionGraph(stacks);
        const result = await scoreFacts(session.facts, graph, stacks);
        if (!cancelled) {
          setPosture(result.posture);
          setScore(result.conservativeScore);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    compute();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Assemble and download the self-contained evidence package (T3 wiring).
  // Facts, provenance, posture, and SPRS all come from the same session the
  // displayed score was computed from; validation happens inside the service.
  const handleEvidenceExport = async () => {
    try {
      const session = await db.interview_sessions.get(sessionId);
      if (!session || !posture) return;
      const party = await db.assessed_parties.get(session.party_id);
      if (!party) return;
      const sprs = computeSprs(
        posture.ces.requirement_results.map((r) => ({
          requirement_id: r.requirement_id,
          status: r.status,
        }))
      );
      await exportEvidencePackage({
        session,
        party,
        posture,
        conservativeScore: score,
        sprs: { sprs: sprs.sprs, assessed_count: sprs.assessed_count },
      });
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return <div className="page page-narrow">Computing posture…</div>;
  }

  if (error) {
    return <div className="page page-narrow form-error">{error}</div>;
  }

  const summary = posture!.ces.control_status_summary;
  const scoreColor =
    score >= 70 ? 'var(--co-compliant)' : score >= 40 ? 'var(--co-risk)' : 'var(--co-violation)';

  return (
    <div className="page page-narrow">
      <div className="ces-titleblock" style={{ marginBottom: 16 }}>
        <h2 className="tb-title" style={{ margin: 0 }}>Readiness Posture Result</h2>
        <span className="tb-designator">CONSERVATIVE / SELF-ASSESSED</span>
      </div>

      <div data-testid="conservative-score" className="score-display" style={{ color: scoreColor }}>
        {score}% compliant
      </div>

      <p style={{ color: 'var(--co-text-muted)', marginBottom: 24 }}>
        Conservative (self-assessed) indicator based on {posture!.ces.requirement_results.length} requirements.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="badge badge-compliant">Met</span></td>
            <td>{summary.met}</td>
          </tr>
          <tr>
            <td><span className="badge badge-risk">Partial</span></td>
            <td>{summary.partial}</td>
          </tr>
          <tr>
            <td><span className="badge badge-violation">Not Met</span></td>
            <td>{summary.not_met}</td>
          </tr>
          <tr>
            <td><span className="badge badge-review">Unknown</span></td>
            <td>{summary.unknown}</td>
          </tr>
        </tbody>
      </table>

      <p className="eyebrow" style={{ marginBottom: 16 }}>
        Target: ≤ 2 hrs BHD touch per sub [validate with BHD]
      </p>

      <p data-testid="disclaimer-text" className="callout-warning" style={{ marginBottom: 24 }}>
        Self-assessed indicator — not a certification, not an SPRS submission, and not a quote-binding gap report.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={onExport}>
          Export StatusPayload
        </button>
        <button
          className="btn btn-secondary"
          data-testid="export-evidence-package"
          onClick={() => void handleEvidenceExport()}
        >
          Export Evidence Package
        </button>
        {/* READINESS-1 M2: readiness-result.v1 export (schema-validated before
            download; requires the Situation-tab manifest capture — a missing
            manifest surfaces as the error below, never a silent no-op). */}
        <button
          className="btn btn-secondary"
          data-testid="export-readiness-result"
          onClick={() => {
            setReadinessError('');
            executeReadinessExportAndDownload(sessionId).catch((e) =>
              setReadinessError(e instanceof Error ? e.message : String(e))
            );
          }}
        >
          Export Readiness Result
        </button>
      </div>
      {readinessError && (
        <p className="form-error" data-testid="readiness-export-error" style={{ marginTop: 8 }}>
          {readinessError}
        </p>
      )}
    </div>
  );
}
