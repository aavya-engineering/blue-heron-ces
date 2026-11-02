// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: the per-person panels of the legacy personnel ledger: Edit (openEditPersonnelModal /
// saveEditPersonnel: only the changed fields are sent, and "cleared" sets the screened and review
// dates from the configured review cycle) and Attachments (openAttachmentPanel / uploadAttachment /
// deleteAttachment; downloads go through the bearer-carrying fetch, not a bare link).

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { saveFile } from '../../api/http';
import type { PersonnelRecord } from '../../api/types';
import { Card, ConfirmButton, Field, Notice, useAction } from '../../components/common';

/** Every screening state an operator may set in the edit panel (legacy editPersonState). */
export const ALL_STATES = ['unscreened', 'in-progress', 'cleared', 'expiring-soon', 'expired', 'offboarding-in-progress', 'offboarded'] as const;

/** Legacy attachmentTypeSelect values. */
export const ATTACHMENT_TYPES: ReadonlyArray<[string, string]> = [
  ['background-check', 'Background Check'], ['id-verification', 'ID Verification'], ['reference-check', 'Reference Check'],
  ['cui-acknowledgment', 'CUI Acknowledgment'], ['authorization', 'Authorization'], ['citizenship-doc', 'Citizenship Document'],
  ['direct-knowledge-attestation', 'Direct Knowledge Attestation'], ['linkedin-profile', 'LinkedIn Profile'],
  ['professional-credential', 'Professional Credential'], ['training-certificate', 'Training Certificate'], ['other', 'Other'],
];

/** The PUT body for moving to `state` (legacy updatePersonnelState): "cleared" stamps the screened and next-review dates. */
export function stateUpdates(state: string, reviewCycleYears: number | undefined, now = new Date()): Record<string, unknown> {
  const updates: Record<string, unknown> = { screeningState: state };
  if (state === 'cleared') {
    const next = new Date(now);
    next.setFullYear(next.getFullYear() + (reviewCycleYears || 5));
    updates.lastScreenedDate = now.toISOString();
    updates.nextReviewDate = next.toISOString();
  }
  return updates;
}

export function EditPanel({ tenant, person, reviewCycleYears, onClose }: { tenant: string; person: PersonnelRecord; reviewCycleYears?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(person.displayName);
  const [email, setEmail] = useState(person.email);
  const [role, setRole] = useState(person.role);
  const [state, setState] = useState(person.screeningState);
  const save = useAction();
  const changed = state !== person.screeningState;
  return (
    <Card title={`Edit: ${person.displayName}`} id="eo-person-edit">
      <div className="eo-grid-2">
        <Field label="Name"><input id="editPersonName" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email"><input id="editPersonEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Role"><input id="editPersonRole" value={role} onChange={(e) => setRole(e.target.value)} /></Field>
        <Field label="Screening state">
          <select id="editPersonState" value={state} onChange={(e) => setState(e.target.value)}>
            {[...new Set([person.screeningState, ...ALL_STATES])].map((s) => <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>)}
          </select>
        </Field>
      </div>
      {changed ? (
        <Notice kind="warn" id="editPersonStateWarning">
          {`State will change from "${person.screeningState.replace(/-/g, ' ')}" to "${state.replace(/-/g, ' ')}". A lifecycle event will be logged.`}
        </Notice>
      ) : null}
      <div className="eo-row">
        <button type="button" className="btn btn-primary btn-small" id="editPersonSave" disabled={!name.trim() || !email.trim() || !role.trim() || save.busy}
          onClick={() => void save.run(async () => {
            const updates: Record<string, unknown> = {};
            if (name.trim() !== person.displayName) updates.displayName = name.trim();
            if (email.trim() !== person.email) updates.email = email.trim();
            if (role.trim() !== person.role) updates.role = role.trim();
            if (changed) Object.assign(updates, stateUpdates(state, reviewCycleYears));
            if (Object.keys(updates).length === 0) { onClose(); return 'No changes.'; }
            await eoApi.updatePersonnel(tenant, person.id, updates);
            await qc.invalidateQueries({ queryKey: ['personnel', tenant] });
            await qc.invalidateQueries({ queryKey: ['personnel-readiness', tenant] });
            onClose();
            return 'Saved.';
          }, (m) => m)}>
          Save changes
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Cancel</button>
      </div>
      {save.message ? <Notice kind={save.message.kind}>{save.message.text}</Notice> : null}
    </Card>
  );
}

export function AttachmentsPanel({ tenant, person, onClose }: { tenant: string; person: PersonnelRecord; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState('background-check');
  const act = useAction();
  const artifacts = person.evidenceArtifacts ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['personnel', tenant] });
  return (
    <Card title={`Attachments: ${person.displayName}`} id="eo-person-attachments"
      actions={<button type="button" className="btn btn-ghost btn-small" id="attachmentCloseBtn" onClick={onClose}>Close</button>}>
      {artifacts.length === 0 ? <p className="eo-muted">No attachments yet.</p> : (
        <ul className="eo-list" id="attachmentList">
          {artifacts.map((a) => (
            <li key={a.id} className="eo-row">
              <strong>{a.filename}</strong>
              <span className="eo-muted">{a.type.replace(/-/g, ' ')}</span>
              {a.contentHash ? <span className="eo-mono eo-muted">{`SHA-256: ${a.contentHash.slice(0, 16)}...`}</span> : null}
              <button type="button" className="btn btn-ghost btn-small" aria-label={`Download ${a.filename}`} disabled={act.busy}
                onClick={() => void act.run(async () => { const f = await eoApi.downloadAttachment(tenant, person.id, a.id, a.filename); saveFile(f); return f; }, (f) => `Downloaded ${f.filename}.`)}>
                Download
              </button>
              <ConfirmButton label="Delete" ariaLabel={`Delete ${a.filename}`} disabled={act.busy}
                onConfirm={() => void act.run(async () => { await eoApi.deleteAttachment(tenant, person.id, a.id); await refresh(); }, () => `Deleted ${a.filename}.`)} />
            </li>
          ))}
        </ul>
      )}
      <div className="eo-row">
        <label className="eo-field">
          <span className="eo-field-label">Attachment file</span>
          <input id="attachmentFileInput" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Field label="Attachment type">
          <select id="attachmentTypeSelect" value={type} onChange={(e) => setType(e.target.value)}>
            {ATTACHMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <button type="button" className="btn btn-primary btn-small" id="attachmentUploadBtn" disabled={!file || act.busy}
          onClick={() => void act.run(async () => { const a = await eoApi.uploadAttachment(tenant, person.id, file!, type); setFile(null); await refresh(); return a; }, (a) => `Uploaded ${a.filename}.`)}>
          Upload
        </button>
      </div>
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
    </Card>
  );
}
