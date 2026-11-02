// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Assessor view (FD-11: it stays, beside the DOCX deliverable). GET /api/assessor-view?tenant= for the
// summary and per-control determinations; the full pivotable viewer is EO's own /assessor?tenant=
// page (carve-out: EO keeps its assessor documents), opened in a new tab.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { buildUrl } from '../../api/http';
import { Card, Field, Metric, Notice, StatusBadge, TenantRequired, errorText } from '../../components/common';

function AssessorBody({ tenant }: { tenant: string }) {
  const view = useQuery({ queryKey: ['assessor-view', tenant], queryFn: () => eoApi.assessorView(tenant), retry: false });
  const [family, setFamily] = useState('');
  const families = useMemo(() => [...new Set((view.data?.controls ?? []).map((c) => c.family))].sort(), [view.data]);
  const rows = (view.data?.controls ?? []).filter((c) => !family || c.family === family);
  return (
    <Card
      title="Assessor view"
      id="eo-assessor-card"
      actions={<a className="btn btn-secondary btn-small" id="assessorFullLink" href={buildUrl('/assessor', { tenant })} target="_blank" rel="noopener">Open full assessor viewer</a>}
    >
      {view.isLoading ? <Notice>Loading...</Notice> : null}
      {view.isError ? <Notice kind="warn">{`No assessor view yet: ${errorText(view.error)}`}</Notice> : null}
      {view.data ? (
        <>
          <div className="eo-metrics">
            <Metric label="SPRS" value={view.data.sprs.score} id="assessorSprs" />
            <Metric label="Objectives satisfied" value={`${view.data.summary.objectivesSatisfied}/${view.data.summary.objectivesTotal}`} />
            <Metric label="Deficiencies" value={view.data.summary.deficiencies} />
            <Metric label="Certification blockers" value={view.data.summary.certificationBlockers} />
            <Metric label="Open POA&M items" value={view.data.summary.openPoamItems} />
          </div>
          <p className="eo-muted">{`Generated ${new Date(view.data.generatedAt).toLocaleString()}. The SSP DOCX is the assessor deliverable; this view shows the determinations behind it.`}</p>
          <Field label="Family">
            <select id="assessorFamily" value={family} onChange={(e) => setFamily(e.target.value)}>
              <option value="">All families</option>
              {families.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <div className="eo-table-wrap">
            <table className="eo-table" id="assessorControls">
              <thead><tr><th scope="col">Control</th><th scope="col">Status</th><th scope="col">Weight</th><th scope="col">Points at risk</th><th scope="col">Blocker</th><th scope="col">Objectives</th><th scope="col">Evidence</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.controlId}>
                    <td>{c.controlId}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>{c.weight}</td>
                    <td>{c.pointsAtRisk}</td>
                    <td>{c.certificationBlocker ? 'Yes' : ''}</td>
                    <td>{c.objectiveIds.length}</td>
                    <td>{c.evidence.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Card>
  );
}

export default function AssessorScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <AssessorBody tenant={t} />}</TenantRequired></div>;
}
