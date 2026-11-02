// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SPRS (legacy loadSprsDetail / renderSprsPage / renderSprsHistory). Read-only: GET /api/sprs and
// GET /api/sprs/history. The score is EO's single SPRS authority (SprsCalculator); nothing here computes it.

import { useQuery } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { Card, Metric, Notice, StatusBadge, TenantRequired, errorText } from '../../components/common';

const PATH_LABEL: Record<string, string> = {
  full: 'Full Certification (110/110)',
  conditional: 'Conditional Certification (POA&M eligible)',
};

function SprsBody({ tenant }: { tenant: string }) {
  const sprs = useQuery({ queryKey: ['sprs', tenant], queryFn: () => eoApi.sprs(tenant), retry: false });
  const history = useQuery({ queryKey: ['sprs-history', tenant], queryFn: () => eoApi.sprsHistory(tenant), retry: false });
  if (sprs.isLoading) return <Notice>Loading SPRS...</Notice>;
  if (sprs.isError) return <Notice kind="warn">{`No SPRS yet: ${errorText(sprs.error)}`}</Notice>;
  const s = sprs.data!;
  return (
    <>
      <Card title="SPRS score" id="eo-sprs-card">
        <div className="eo-metrics">
          <Metric label="Score" value={s.score} id="sprsDetailScore" />
          <Metric label="Met" value={s.controlsMet} id="sprsMetMet" />
          <Metric label="Not met" value={s.controlsNotMet} id="sprsMetNotMet" />
          <Metric label="POA&M eligible" value={s.poamEligible ? 'Yes' : 'No'} id="sprsMetPoam" />
          <Metric label="POA&M candidates" value={s.poamCandidates.length} id="sprsMetCandidates" />
        </div>
        <p id="sprsCertPath">{PATH_LABEL[s.certificationPath] ?? 'Certification Blocked'}</p>
        {s.poamBlockers.length ? (
          <Notice kind="error">{`Blockers: ${s.poamBlockers.join('; ')}`}</Notice>
        ) : null}
      </Card>
      <Card title="Deductions" id="eo-sprs-deductions">
        {s.deductions.length === 0 ? (
          <Notice kind="success">No deductions.</Notice>
        ) : (
          <div className="eo-table-wrap">
            <table className="eo-table" id="sprsDeductionsTable">
              <thead><tr><th scope="col">Control</th><th scope="col">NIST</th><th scope="col">Weight</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {s.deductions.map((d) => (
                  <tr key={d.control_id}><td>{d.control_id}</td><td>{d.nist_ref}</td><td>{`-${d.weight}`}</td><td><StatusBadge status={d.status} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="History" id="eo-sprs-history">
        {(history.data ?? []).length === 0 ? <Notice>No history yet.</Notice> : (
          <ul>
            {(history.data ?? []).map((h, i) => (
              <li key={h.snapshotId ?? i}>{`${new Date(h.generatedAt ?? h.timestamp ?? '').toLocaleString()}: ${h.score ?? h.sprs_score}`}</li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export default function SprsScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <SprsBody tenant={t} />}</TenantRequired></div>;
}
