// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Upload, recording the uploader (FIN-12 entry point, FD-10: no separate EC UI, so EC's status,
// runs and findings are shown here too). POST /api/ec/ingest multipart: tenantSlug, controlIds,
// source, submittedByRole, optional form_id / emx_ids, file; header x-ces-principal = the uploader
// token. EC records `uploadedBy` only from a verified token; without one no review can credit it.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { ApiError } from '../../api/http';
import { tokenExpired, tokenUpn } from '../../api/token';
import { useSession } from '../../store/session';
import { Card, Field, Notice, TenantRequired, errorText, type NoticeKind } from '../../components/common';

function EcStatus({ tenant }: { tenant: string }) {
  const health = useQuery({ queryKey: ['ec-health'], queryFn: eoApi.ecHealth, retry: false });
  const runs = useQuery({ queryKey: ['ec-runs', tenant], queryFn: () => eoApi.ecRuns(tenant), retry: false });
  const findings = useQuery({ queryKey: ['ec-findings', tenant], queryFn: () => eoApi.ecFindings(tenant), retry: false });
  const state = health.isError ? 'EC Unreachable' : health.data?.status === 'ok' ? 'Online' : health.data?.status === 'degraded' ? 'Degraded' : health.data ? 'EC Unavailable' : 'Checking...';
  return (
    <Card title="Evidence Collector" id="eo-ec-status">
      <p id="ecDetailHealth">{`Status: ${state}${health.data?.mode ? ` | Mode: ${health.data.mode}` : ''}`}</p>
      {health.data?.reasons?.length ? <ul>{health.data.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
      <details className="eo-details">
        <summary>{`Runs (${(runs.data ?? []).length})`}</summary>
        <div className="eo-table-wrap">
          <table className="eo-table">
            <thead><tr><th scope="col">Run</th><th scope="col">Started</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Artifacts</th></tr></thead>
            <tbody>
              {(runs.data ?? []).length === 0 ? <tr><td colSpan={5}>No runs found</td></tr> : (runs.data ?? []).map((r, i) => (
                <tr key={r.runId ?? i}><td className="eo-mono">{(r.runId ?? '').slice(0, 8)}</td><td>{new Date(r.startedAt).toLocaleString()}</td><td>{r.runType}</td><td>{r.status}</td><td>{r.artifactsWritten ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details className="eo-details">
        <summary>{`Findings (${(findings.data ?? []).length})`}</summary>
        <div className="eo-table-wrap">
          <table className="eo-table">
            <thead><tr><th scope="col">Check</th><th scope="col">Detected</th><th scope="col">Severity</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {(findings.data ?? []).length === 0 ? <tr><td colSpan={4}>No findings</td></tr> : (findings.data ?? []).map((f, i) => (
                <tr key={f.findingId ?? i}><td>{f.checkId ?? f.findingId}</td><td>{new Date(f.detectedAt).toLocaleString()}</td><td>{f.severity}</td><td>{f.status}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function UploadBody({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const uploaderToken = useSession((s) => s.uploaderToken);
  const setUploaderToken = useSession((s) => s.setUploaderToken);
  const [controlIds, setControlIds] = useState('');
  const [source, setSource] = useState('manual_upload');
  const [role, setRole] = useState('');
  const [formId, setFormId] = useState('');
  const [emxIds, setEmxIds] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const upn = tokenUpn(uploaderToken);
  const expired = tokenExpired(uploaderToken);

  const submit = async () => {
    if (!controlIds.trim() || !role.trim() || !file) {
      setStatus({ kind: 'error', text: 'Control ID(s), role and a file are all required' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'Uploading...' });
    try {
      const item = await eoApi.upload({ tenant, file, controlIds: controlIds.trim(), source, submittedByRole: role.trim(), formId, emxIds, uploaderToken });
      setStatus(item.uploadedBy?.upn
        ? { kind: 'success', text: `Uploaded (${item.itemId ?? 'ok'}) by ${item.uploadedBy.upn}` }
        : { kind: 'warn', text: `Uploaded (${item.itemId ?? 'ok'}) with no uploader recorded: a review cannot credit this upload` });
      setFile(null);
      setFileKey((k) => k + 1);
      void qc.invalidateQueries({ queryKey: ['ec-runs', tenant] });
      void qc.invalidateQueries({ queryKey: ['review-queue', tenant] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setStatus({ kind: 'error', text: 'EC unreachable or not configured' });
      else if (e instanceof ApiError && e.status === 401) setStatus({ kind: 'error', text: `Upload failed: ${e.detail} (the uploader token was refused)` });
      else setStatus({ kind: 'error', text: `Upload failed: ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Upload evidence" id="eo-upload-card">
        <div className="eo-grid-2">
          <Field label="Control ID(s)" hint="Comma-separated, e.g. PE.L2-3.10.2">
            <input id="ecUploadControlIds" value={controlIds} onChange={(e) => setControlIds(e.target.value)} />
          </Field>
          <Field label="Source">
            <select id="ecUploadSource" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="manual_upload">Manual upload</option>
              <option value="attestation">Attestation</option>
            </select>
          </Field>
          <Field label="Submitted by (role)">
            <input id="ecUploadRole" value={role} onChange={(e) => setRole(e.target.value)} placeholder="compliance_officer" />
          </Field>
          <Field label="Evidence form id (optional, from the evidence catalog)">
            <input id="ecUploadFormId" value={formId} onChange={(e) => setFormId(e.target.value)} />
          </Field>
          <Field label="Evidence item ids (optional, comma-separated)">
            <input id="ecUploadEmxIds" value={emxIds} onChange={(e) => setEmxIds(e.target.value)} />
          </Field>
          <Field label="File">
            <input key={fileKey} id="ecUploadFile" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        <Field label="Uploader token" hint="Minted for you on the Tenant and access screen, or pasted. Sent as x-ces-principal; EC verifies it.">
          <textarea id="ecUploadPrincipal" rows={2} value={uploaderToken} onChange={(e) => setUploaderToken(e.target.value)} />
        </Field>
        {!uploaderToken.trim() ? (
          <Notice kind="warn">No uploader token: EC will record no uploader, and no review can credit this upload (GD-b).</Notice>
        ) : expired ? (
          <Notice kind="warn">The uploader token has expired; EC will refuse it.</Notice>
        ) : (
          <p className="eo-muted" id="ecUploadAs">{`Uploading as ${upn ?? 'the token holder'}.`}</p>
        )}
        <div className="eo-row">
          <button type="button" className="btn btn-primary btn-small" id="ecUploadBtn" disabled={busy} onClick={() => void submit()}>Upload</button>
        </div>
        {status ? <Notice kind={status.kind} id="ecUploadStatus">{status.text}</Notice> : null}
      </Card>
      <EcStatus tenant={tenant} />
    </>
  );
}

export default function UploadScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <UploadBody tenant={t} />}</TenantRequired></div>;
}
