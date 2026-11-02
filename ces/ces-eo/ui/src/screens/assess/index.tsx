// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Assess (legacy Dashboard: runAssessment / handleAssessEvent / updateDashboard / loadFullAssessment).
// Streams GET /api/assess?tenant= and reads GET /api/assessment for the control table.

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConsoleView, type ConsoleEntry, type LogLevel } from 'ces-ui-kit';
import { eoApi } from '../../api/eo';
import type { StreamFrame } from '../../api/http';
import { useSession } from '../../store/session';
import { Card, Metric, Notice, TenantRequired, errorText } from '../../components/common';
import { ControlMatrix } from './ControlMatrix';
import { TimelineCard } from './TimelineCard';

const now = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

export interface AssessSummary {
  sprs_score?: number;
  controls_met?: number;
  controls_not_met?: number;
  controls_partial?: number;
  controls_not_assessed?: number;
  snapshotId?: string;
}

/** One stream frame -> a console row (legacy handleAssessEvent wording). */
export function frameToEntry(f: StreamFrame): { level: LogLevel; message: string } | null {
  switch (f.type) {
    case 'assess_start':
      return { level: 'info', message: `Evidence assessment started for ${f.tenant}` };
    case 'assess_check': {
      const level: LogLevel = f.status === 'exists' ? 'success' : f.status === 'error' ? 'error' : f.status === 'missing' ? 'warn' : 'info';
      return { level, message: `[${String(f.status ?? '').toUpperCase()}] ${f.entryId} — ${f.label ?? ''}` };
    }
    case 'assess_import':
      return { level: 'info', message: `Imported ${f.filesFound} evidence files from ${f.directory}` };
    case 'assess_summary':
      return { level: 'success', message: `Evidence assessment complete. SPRS: ${f.sprs_score} | MET: ${f.controls_met} | NOT MET: ${f.controls_not_met}` };
    case 'assess_error':
      return { level: 'error', message: `Error: ${f.error}` };
    default:
      return null;
  }
}

function AssessBody({ tenant }: { tenant: string }) {
  const setSnapshot = useSession((s) => s.setSnapshot);
  const qc = useQueryClient();
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<AssessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const assessment = useQuery({ queryKey: ['assessment', tenant], queryFn: () => eoApi.assessment(tenant), retry: false });

  const push = (level: LogLevel, message: string) =>
    setEntries((e) => [...e, { key: String(seq.current++), time: now(), level, message }]);

  const run = async () => {
    setRunning(true);
    setEntries([]);
    setSummary(null);
    setError(null);
    setProgress(0);
    push('info', `Starting evidence assessment for ${tenant}...`);
    try {
      await eoApi.assess(tenant, (f) => {
        const row = frameToEntry(f);
        if (row) push(row.level, row.message);
        if (f.type === 'assess_check' && f.total) setProgress(Math.round((f.checked / f.total) * 100));
        if (f.type === 'assess_summary') {
          setProgress(100);
          setSummary(f as AssessSummary);
          if (typeof f.snapshotId === 'string') setSnapshot(f.snapshotId);
        }
        if (f.type === 'assess_error') setError(String(f.error));
      });
      push('warn', 'Evidence assessment stream closed.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
      void qc.invalidateQueries({ queryKey: ['assessment', tenant] });
      void qc.invalidateQueries({ queryKey: ['sprs', tenant] });
      void qc.invalidateQueries({ queryKey: ['timeline', tenant] });
    }
  };

  const counts = summary ?? (assessment.data
    ? {
        sprs_score: assessment.data.sprs_score,
        controls_met: assessment.data.controls.filter((c) => c.status === 'met').length,
        controls_not_met: assessment.data.controls.filter((c) => c.status === 'not_met').length,
        controls_partial: assessment.data.controls.filter((c) => c.status === 'partial').length,
        controls_not_assessed: assessment.data.controls.filter((c) => c.status === 'not_assessed').length,
      }
    : null);

  return (
    <>
      <Card
        title="Evidence assessment"
        id="eo-assess-card"
        actions={
          <button type="button" className="btn btn-primary btn-small" id="assessBtn" disabled={running} onClick={() => void run()}>
            {running ? 'Assessing...' : 'Run assessment'}
          </button>
        }
      >
        {running ? <div className="eo-progress" role="progressbar" aria-label="Assessment progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div> : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
        <ConsoleView entries={entries} id="assessConsole" label="Assessment log" />
      </Card>

      <Card title="Posture" id="eo-posture-card">
        {counts ? (
          <div className="eo-metrics">
            <Metric label="SPRS" value={counts.sprs_score ?? '--'} id="metricSprs" />
            <Metric label="Met" value={counts.controls_met ?? '--'} id="metricMet" />
            <Metric label="Not met" value={counts.controls_not_met ?? '--'} id="metricNotMet" />
            <Metric label="Partial" value={counts.controls_partial ?? '--'} id="metricPartial" />
            <Metric label="Not assessed" value={counts.controls_not_assessed ?? '--'} id="metricNotAssessed" />
          </div>
        ) : (
          <Notice>No assessment yet for this tenant. Run one above.</Notice>
        )}
      </Card>

      <Card title="Control compliance matrix" id="eo-matrix-card">
        {assessment.data ? <ControlMatrix controls={assessment.data.controls} /> : <p className="eo-muted">Run an evidence assessment to see results.</p>}
      </Card>

      <TimelineCard tenant={tenant} />
    </>
  );
}

export default function AssessScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <AssessBody tenant={t} />}</TenantRequired></div>;
}
