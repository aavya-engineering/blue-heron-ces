// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SSP and DOCX (legacy generateSsp / renderSsp / exportSsp / exportSspDocx). FD-11: the DOCX is the
// assessor deliverable; this screen previews the JSON and downloads the DOCX EO renders.

import { useMemo, useState } from 'react';
import { eoApi } from '../../api/eo';
import { saveFile } from '../../api/http';
import type { SspControlImplementation, SystemSecurityPlan } from '../../api/types';
import { Card, Notice, StatusBadge, TenantRequired, useAction } from '../../components/common';
import { useSnapshotId } from '../../components/useSnapshot';
import { familyName } from '../../components/families';

function SspBody({ tenant }: { tenant: string }) {
  const { snapshotId, loading } = useSnapshotId(tenant);
  const [ssp, setSsp] = useState<SystemSecurityPlan | null>(null);
  const gen = useAction();
  const dl = useAction();

  const families = useMemo(() => {
    const m = new Map<string, SspControlImplementation[]>();
    for (const ci of ssp?.controlImplementations ?? []) {
      const list = m.get(ci.family) ?? [];
      list.push(ci);
      m.set(ci.family, list);
    }
    return [...m.entries()];
  }, [ssp]);

  const exportJson = () => {
    if (!ssp) return;
    saveFile({ blob: new Blob([JSON.stringify(ssp, null, 2)], { type: 'application/json' }), filename: `ssp-${ssp.sspId}.json` });
  };

  return (
    <>
      <Card
        title="System security plan"
        id="eo-ssp-card"
        actions={
          <>
            <button type="button" className="btn btn-primary btn-small" id="sspGenerateBtn" disabled={!snapshotId || gen.busy}
              onClick={() => void gen.run(async () => { const r = await eoApi.generateSsp(tenant, snapshotId!); setSsp(r); return r; },
                (r) => `SSP generated (${r.controlImplementations.length} controls).`)}>
              Generate SSP
            </button>
            <button type="button" className="btn btn-secondary btn-small" id="sspLatestBtn" disabled={gen.busy}
              onClick={() => void gen.run(async () => { const r = await eoApi.latestSsp(tenant); setSsp(r); return r; }, () => 'Latest SSP loaded.')}>
              Load latest
            </button>
          </>
        }
      >
        {!snapshotId && !loading ? <Notice kind="warn">Run an evidence assessment first (Assess screen).</Notice> : null}
        {gen.message ? <Notice kind={gen.message.kind}>{gen.message.text}</Notice> : null}
        {ssp ? (
          <>
            <div className="eo-row">
              <button type="button" className="btn btn-primary btn-small" id="sspExportDocxBtn" disabled={dl.busy}
                onClick={() => void dl.run(async () => { const f = await eoApi.sspDocx(tenant, ssp.sspId); saveFile(f); return f; }, (f) => `Downloaded ${f.filename}.`)}>
                Download DOCX (assessor deliverable)
              </button>
              <button type="button" className="btn btn-secondary btn-small" id="sspExportBtn" onClick={exportJson}>Export JSON</button>
            </div>
            {dl.message ? <Notice kind={dl.message.kind}>{dl.message.text}</Notice> : null}
            <div>
              <strong>{ssp.systemName}</strong>
              <div className="eo-muted">{`Generated ${new Date(ssp.generatedAt).toLocaleString()}${ssp.version ? ` | Version ${ssp.version}` : ''}`}</div>
              {ssp.systemDescription ? <p>{ssp.systemDescription}</p> : null}
            </div>
            <details className="eo-details" id="sspOverview">
              <summary>System overview</summary>
              <dl className="eo-dl">
                <dt>Hosting</dt><dd>{ssp.hostingModel ? `${ssp.hostingModel.model ?? '—'} (${ssp.hostingModel.environment ?? '—'})` : '—'}</dd>
                <dt>Boundary</dt><dd>{ssp.authorizationBoundary?.description ?? '—'}</dd>
                <dt>Components</dt><dd>{`${ssp.systemComponents?.sections?.length ?? 0} sections`}</dd>
                <dt>Source artifacts</dt><dd>{ssp.sourceArtifacts?.length ? ssp.sourceArtifacts.join(', ') : 'None loaded'}</dd>
              </dl>
            </details>
            {families.map(([family, controls]) => (
              <details key={family} className="eo-details" data-family={family}>
                <summary>{`${family} — ${familyName(family)} (${controls.length} controls)`}</summary>
                {controls.map((ci) => (
                  <div key={ci.control_id} className="eo-ssp-control" data-control={ci.control_id}>
                    <div className="eo-row">
                      <strong>{ci.control_id}</strong>
                      <StatusBadge status={ci.status} />
                      {typeof ci.weight === 'number' ? <span className="eo-muted eo-mono">{`wt:${ci.weight}`}</span> : null}
                    </div>
                    {ci.practice ? <p className="eo-muted">{ci.practice.slice(0, 200)}</p> : null}
                    {ci.implementationNarrative ? <p><strong>Implementation:</strong> {ci.implementationNarrative.slice(0, 400)}</p> : null}
                    {ci.technologyUsed?.length ? <p className="eo-muted">{`Tech: ${ci.technologyUsed.join(', ')}`}</p> : null}
                    {ci.responsibleRole ? <p className="eo-muted">{`Role: ${ci.responsibleRole}`}</p> : null}
                  </div>
                ))}
              </details>
            ))}
          </>
        ) : null}
      </Card>
    </>
  );
}

export default function SspScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <SspBody tenant={t} />}</TenantRequired></div>;
}
