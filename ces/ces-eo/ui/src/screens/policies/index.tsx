// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: Policy Store (legacy loadPolicyStore): the policy documents imported for the tenant,
// from GET /api/policies?tenant=. Read-only. The route also returns each document's markdown and
// NIST controls, so a row can be opened to read the policy text.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { Card, Notice, TenantRequired } from '../../components/common';

function PolicyBody({ tenant }: { tenant: string }) {
  const q = useQuery({ queryKey: ['policies', tenant], queryFn: () => eoApi.policies(tenant), retry: false });
  const [open, setOpen] = useState<string | null>(null);
  const policies = q.data ?? [];
  const doc = policies.find((p) => p.template_id === open) ?? null;
  return (
    <Card title="Policy store" id="eo-policy-card"
      actions={<button type="button" className="btn btn-ghost btn-small" id="policyRefresh" onClick={() => void q.refetch()}>Refresh</button>}>
      <p className="eo-muted">Policy documents imported from Planner for the selected tenant.</p>
      {q.isError ? <Notice kind="error">Failed to load the policy store.</Notice> : null}
      <div className="eo-table-wrap">
        <table className="eo-table" id="policyStoreTable">
          <thead><tr><th scope="col">Title</th><th scope="col">Template ID</th><th scope="col">Domain</th><th scope="col">Completeness</th><th scope="col">Loaded</th><th scope="col">Text</th></tr></thead>
          <tbody>
            {policies.length === 0 ? <tr><td colSpan={6}>{q.isLoading ? 'Loading...' : 'No policies imported for this tenant'}</td></tr> : policies.map((p) => (
              <tr key={p.template_id}>
                <td>{p.title}</td>
                <td className="eo-mono">{p.template_id}</td>
                <td>{p.domain}</td>
                <td>{`${p.completeness}%`}</td>
                <td>{new Date(p.loadedAt).toLocaleString()}</td>
                <td>
                  <button type="button" className="btn btn-ghost btn-small" aria-label={`Read ${p.title}`} aria-pressed={open === p.template_id}
                    disabled={!p.markdown} onClick={() => setOpen(open === p.template_id ? null : p.template_id)}>
                    {open === p.template_id ? 'Close' : 'Read'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {doc ? (
        <section className="eo-gdb" id="policyText" aria-label={`Policy text: ${doc.title}`}>
          <p><strong>{doc.title}</strong>{doc.nist_controls?.length ? <span className="eo-muted">{` — ${doc.nist_controls.join(', ')}`}</span> : null}</p>
          <pre className="eo-pre">{doc.markdown}</pre>
        </section>
      ) : null}
    </Card>
  );
}

export default function PolicyStoreScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <PolicyBody tenant={t} />}</TenantRequired></div>;
}
