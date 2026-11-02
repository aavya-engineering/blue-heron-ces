// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// POA&M (legacy generatePoam / renderPoam / exportPoam): POST /api/poam/generate from the
// assessment snapshot, plus the DOCX export (GET /api/poam/export/:poamId).

import { useState } from 'react';
import { eoApi } from '../../api/eo';
import { saveFile } from '../../api/http';
import type { Poam } from '../../api/types';
import { Card, Metric, Notice, TenantRequired, useAction } from '../../components/common';
import { useSnapshotId } from '../../components/useSnapshot';

function PoamBody({ tenant }: { tenant: string }) {
  const { snapshotId, loading } = useSnapshotId(tenant);
  const [poam, setPoam] = useState<Poam | null>(null);
  const gen = useAction();
  const dl = useAction();
  return (
    <Card
      title="Plan of action and milestones"
      id="eo-poam-card"
      actions={
        <button type="button" className="btn btn-primary btn-small" id="poamGenerateBtn" disabled={!snapshotId || gen.busy}
          onClick={() => void gen.run(async () => { const r = await eoApi.generatePoam(tenant, snapshotId!); setPoam(r); return r; },
            (r) => `POA&M generated (${r.items.length} items).`)}>
          Generate POA&M
        </button>
      }
    >
      {!snapshotId && !loading ? <Notice kind="warn">Run an evidence assessment first (Assess screen).</Notice> : null}
      {gen.message ? <Notice kind={gen.message.kind}>{gen.message.text}</Notice> : null}
      {poam ? (
        <>
          <Notice kind={poam.eligibility.eligible ? 'success' : 'error'}>
            {poam.eligibility.eligible
              ? `Conditional Certification Eligible. SPRS Score: ${poam.sprsScore} | ${poam.items.filter((i) => i.poamEligible !== false).length} items on POA&M`
              : `Certification Blocked: ${poam.eligibility.blockers.length} blocking controls must be remediated before POA&M is viable.`}
          </Notice>
          <div className="eo-metrics">
            <Metric label="Tracked items" value={poam.summary.totalItems} id="poamTotalItems" />
            <Metric label="Open" value={poam.summary.openItems} id="poamOpenItems" />
            <Metric label="Weight on POA&M" value={poam.summary.totalWeightOnPoam} id="poamWeightOnPoam" />
            <Metric label="Projected score" value={poam.summary.projectedScoreAfterPoam} id="poamProjectedScore" />
          </div>
          {poam.eligibility.blockers.length ? (
            <ul aria-label="Blocking controls">
              {poam.eligibility.blockers.map((b) => <li key={b.control_id}>{`${b.control_id} (${b.nist_ref}, weight ${b.weight}): ${b.reason}`}</li>)}
            </ul>
          ) : null}
          <div className="eo-table-wrap">
            <table className="eo-table" id="poamItemsTable">
              <thead><tr><th scope="col">Control</th><th scope="col">NIST</th><th scope="col">Weight</th><th scope="col">Planned action</th><th scope="col">Responsible</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {poam.items.length === 0 ? <tr><td colSpan={6}>No POA&M items needed</td></tr> : poam.items.map((i) => (
                  <tr key={i.control_id}><td>{i.control_id}</td><td>{i.nist_ref}</td><td>{i.weight}</td><td>{(i.plannedCorrectiveAction ?? '').slice(0, 120)}</td><td>{i.responsibleParty ?? ''}</td><td>{i.status}{i.poamEligible === false ? ` (${i.eligibilityNote ?? 'not CMMC POA&M-eligible'})` : ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="eo-row">
            <button type="button" className="btn btn-secondary btn-small" id="poamExportBtn" disabled={dl.busy}
              onClick={() => void dl.run(async () => { const f = await eoApi.poamDocx(tenant, poam.poamId); saveFile(f); return f; }, (f) => `Downloaded ${f.filename}.`)}>
              Download DOCX
            </button>
          </div>
          {dl.message ? <Notice kind={dl.message.kind}>{dl.message.text}</Notice> : null}
        </>
      ) : null}
    </Card>
  );
}

export default function PoamScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <PoamBody tenant={t} />}</TenantRequired></div>;
}
