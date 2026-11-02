// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence package (legacy buildPackage / loadPackages): POST /api/package/build for the selected
// tenant, the tenant's package list, and the download.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { saveFile } from '../../api/http';
import { Card, Notice, TenantRequired, useAction } from '../../components/common';

function PackageBody({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const packages = useQuery({ queryKey: ['packages', tenant], queryFn: () => eoApi.packages(tenant), retry: false });
  const build = useAction();
  const dl = useAction();
  return (
    <>
      <Card
        title="Evidence package"
        id="eo-package-card"
        actions={
          <button type="button" className="btn btn-primary btn-small" id="buildPackageBtn" disabled={build.busy}
            onClick={() => void build.run(async () => {
              const r = await eoApi.buildPackage(tenant);
              await qc.invalidateQueries({ queryKey: ['packages', tenant] });
              return r;
            }, (r) => `Package built. Files: ${r.fileCount} | Size: ${(r.sizeBytes / 1024).toFixed(1)} KB | ID: ${r.packageId.slice(0, 8)}...`)}>
            {build.busy ? 'Building...' : 'Build package'}
          </button>
        }
      >
        {build.message ? <Notice kind={build.message.kind} id="packageBuildStatus">{build.message.text}</Notice> : null}
        <p className="eo-muted">The package carries the SSP, POA&M, policies, personnel records, evidence index and integrity manifest for this tenant.</p>
      </Card>
      <Card title="Built packages" id="eo-packages-list">
        {dl.message ? <Notice kind={dl.message.kind}>{dl.message.text}</Notice> : null}
        <div className="eo-table-wrap">
          <table className="eo-table" id="packagesTable">
            <thead><tr><th scope="col">File</th><th scope="col">Size</th><th scope="col">Created</th><th scope="col">Download</th></tr></thead>
            <tbody>
              {(packages.data ?? []).length === 0 ? <tr><td colSpan={4}>No packages built yet</td></tr> : (packages.data ?? []).map((p) => (
                <tr key={p.filename}>
                  <td className="eo-mono">{p.filename}</td>
                  <td>{`${(p.sizeBytes / 1024).toFixed(1)} KB`}</td>
                  <td>{new Date(p.createdAt).toLocaleString()}</td>
                  <td>
                    <button type="button" className="btn btn-secondary btn-small" aria-label={`Download ${p.filename}`}
                      onClick={() => void dl.run(async () => { const f = await eoApi.downloadPackage(tenant, p.filename); saveFile(f); return f; }, (f) => `Downloaded ${f.filename}.`)}>
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export default function PackageScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <PackageBody tenant={t} />}</TenantRequired></div>;
}
