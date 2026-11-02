// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: the screening accordion (legacy openScreeningModal / renderScreeningAccordion /
// saveScreeningElement / loadScreeningTemplate / uploadScreeningArtifact / showEvidenceRequest /
// downloadCuiForm). Legacy has 7 elements: six evidence elements, then the Authorizing Official
// sign-off (element 7), which stays locked until elements 1-6 are all completed. The form fields
// come from GET /api/screening/definitions. EO refuses an AO who is the screened person (400).

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { saveFile } from '../../api/http';
import type { PersonnelRecord, ScreeningElementDef, ScreeningElementState } from '../../api/types';
import { Card, Field, Notice, copyText, useAction } from '../../components/common';

/** Legacy SCREENING_ELEMENT_TITLES (fallback when the definitions do not load). */
export const ELEMENT_TITLES: Record<number, string> = {
  1: 'Identity Verification',
  2: 'Citizenship / Legal Work Authorization',
  3: 'Verifiable Professional History',
  4: 'Direct-Knowledge Attestation',
  5: 'Self-Attestation / Background-Check Consent',
  6: 'CUI Acknowledgment',
  7: 'Authorizing Official Sign-Off',
};

/** Legacy SCREENING_EVIDENCE_REQUIREMENTS, the text of the evidence request. */
const REQUIREMENTS: Record<number, { description: string; artifacts: string[]; formats: string }> = {
  1: { description: "Government-issued photo identification to verify the individual's identity.", artifacts: [
    "Copy of valid government-issued photo ID (driver's license, passport, state ID, or military ID)",
    'If expired or name change: additional corroborating document (marriage certificate, court order)',
    'Front and back scan in PDF or clear photograph (JPG/PNG)'], formats: 'PDF, PNG, JPG, JPEG' },
  2: { description: 'Documentation proving U.S. citizenship or legal authorization to access CUI.', artifacts: [
    'U.S. Passport (current or expired) OR U.S. Birth Certificate, OR', 'Certificate of Naturalization (Form N-550 or N-570), OR',
    'Permanent Resident Card (Form I-551) with valid work authorization', 'For non-citizens: current Employment Authorization Document (EAD)'], formats: 'PDF, PNG, JPG, JPEG' },
  3: { description: 'Professional references who can attest to work history and character.', artifacts: [
    'Name, title, and organization of at least one professional reference', 'Contact information (email and/or phone)',
    'Relationship to subject and duration known', 'Optional: LinkedIn profile URL or professional credential documentation'], formats: 'PDF, DOCX (or provide details directly in form fields)' },
  4: { description: "A signed attestation from someone with direct knowledge of the individual's trustworthiness.", artifacts: [
    'Signed attestation letter on company letterhead (or use built-in template)', 'Attestor must state: full name, relationship, duration known, and basis for trust assessment',
    'Digital or wet signature acceptable', 'Template available in the screening form — "Load template text"'], formats: 'PDF, DOCX, or completed via in-app template' },
  5: { description: "Individual's self-attestation and consent for background verification.", artifacts: [
    'Signed self-attestation form (use built-in template or organizational equivalent)', 'Statement acknowledging: no disqualifying criminal history, consent to background check',
    'Explicit consent for the organization to verify employment and education claims', 'Template available in the screening form — "Load template text"'], formats: 'PDF, DOCX, or completed via in-app template' },
  6: { description: 'Signed acknowledgment that individual understands CUI handling obligations.', artifacts: [
    'Complete and sign the fillable CUI Acknowledgment PDF (download below or from the screening form)',
    'Form includes: acknowledgment of NIST SP 800-171 requirements, marking rules, incident reporting obligations',
    'Check the "I AGREE" box, fill in all fields, and sign in the signature field', 'Return the completed PDF via upload or email attachment'], formats: 'PDF (fillable form provided)' },
  7: { description: 'Final authorization by the AO confirming all screening elements are satisfactory.', artifacts: [
    'AO review of all 6 prior elements (must all be marked Complete)', 'Signed authorization statement (digital or wet signature)',
    'AO name, title, and date of authorization', 'Optional: risk acceptance notes for any conditional approvals'], formats: 'PDF, DOCX, or completed via in-app form' },
};

/** Legacy showEvidenceRequest body (shown to copy; nothing is sent: FD-6). */
export function evidenceRequestText(personName: string): { subject: string; body: string } {
  const subject = `Personnel Screening — Evidence Request${personName ? ` — ${personName}` : ''}`;
  let body = `${subject}\n\nRecipient: ${personName || '[Name]'}\n\nThe following documentation is required for personnel screening to proceed.\n\n`;
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const r = REQUIREMENTS[n];
    body += `--- Element ${n}: ${ELEMENT_TITLES[n]} ---\n${r.description}\nRequired:\n`;
    r.artifacts.forEach((a, i) => { body += `  ${i + 1}. ${a}\n`; });
    body += `Accepted Formats: ${r.formats}\n\n`;
  }
  body += 'NOTE: For Element 6 (CUI Acknowledgment), a fillable PDF form is attached / available for download.\n';
  body += 'Please complete all fields, check "I AGREE", sign, and return.\n\n';
  body += 'Please provide the above documentation at your earliest convenience.\n';
  body += 'Upload directly via the personnel screening portal or reply to this email with attachments.\n';
  return { subject, body };
}

const STATUS_ICON: Record<string, string> = { completed: '✓', in_progress: '…', not_started: '○' };

function ElementForm({ tenant, person, el, def, locked, onSaved }: {
  tenant: string; person: PersonnelRecord; el: ScreeningElementState; def: ScreeningElementDef | undefined; locked: boolean; onSaved: () => Promise<void>;
}) {
  const num = el.elementNumber;
  const initial = () => {
    const v: Record<string, string> = {};
    for (const f of def?.fields ?? []) v[f.name] = el.data && el.data[f.name] !== undefined && el.data[f.name] !== null ? String(el.data[f.name]) : '';
    return v;
  };
  // The form is keyed on the element's stored status and update time (see ScreeningPanel), so it
  // re-reads the server values only when the record really changed; unsaved edits survive refetches.
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [file, setFile] = useState<File | null>(null);
  const act = useAction();
  const dl = useAction();
  const artifacts = (person.evidenceArtifacts ?? []).filter((a) => a.metadata?.screeningElement === num);

  if (locked) return <Notice kind="warn">Complete elements 1-6 to unlock the AO sign-off.</Notice>;

  const save = (status: 'in_progress' | 'completed') => void act.run(async () => {
    const data: Record<string, unknown> = {};
    for (const f of def?.fields ?? []) data[f.name] = f.type === 'number' ? (parseFloat(values[f.name]) || 0) : values[f.name] ?? '';
    await eoApi.saveScreeningElement(tenant, person.id, num, status, data);
    await onSaved();
  }, () => (status === 'completed' ? `Element ${num}: marked complete.` : `Element ${num}: draft saved.`));

  return (
    <div className="eo-screening-body" id={`se_body_${num}`}>
      {def?.description ? <p className="eo-muted">{def.description}</p> : null}
      <div className="eo-grid-2">
        {(def?.fields ?? []).map((f) => {
          const id = `se_${num}_${f.name}`;
          const set = (v: string) => setValues((x) => ({ ...x, [f.name]: v }));
          if (f.type === 'select') {
            return (
              <Field key={f.name} label={f.label}>
                <select id={id} value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)}>
                  <option value="">-- select --</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                </select>
              </Field>
            );
          }
          if (f.type === 'textarea') return <Field key={f.name} label={f.label}><textarea id={id} rows={3} value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)} /></Field>;
          return <Field key={f.name} label={f.label}><input id={id} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)} /></Field>;
        })}
      </div>
      <div className="eo-row">
        {def?.hasTemplate ? (
          <button type="button" className="btn btn-ghost btn-small" disabled={act.busy} aria-label={`Load template text for element ${num}`}
            onClick={() => void act.run(async () => {
              const t = await eoApi.screeningTemplate(tenant, person.id, num);
              if (!t.templateText) return 'No template text for this element.';
              setValues((x) => ({ ...x, signedText: t.templateText ?? '' }));
              return (await copyText(t.templateText)) ? 'Template loaded and copied to the clipboard.' : 'Template loaded into Signed Text.';
            }, (m) => m)}>
            Load template text
          </button>
        ) : null}
        <button type="button" className="btn btn-primary btn-small" disabled={act.busy} aria-label={`Save draft of element ${num}`} onClick={() => save('in_progress')}>Save draft</button>
        <button type="button" className="btn btn-secondary btn-small" disabled={act.busy} aria-label={`Mark element ${num} complete`} onClick={() => save('completed')}>Mark complete</button>
      </div>
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
      <fieldset className="eo-fieldset">
        <legend>Artifact upload</legend>
        <div className="eo-row">
          <label className="eo-field">
            <span className="eo-field-label">{`File for element ${num}`}</span>
            <input id={`se_file_${num}`} type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="btn btn-secondary btn-small" disabled={!file || act.busy} aria-label={`Upload artifact for element ${num}`}
            onClick={() => void act.run(async () => { const a = await eoApi.uploadScreeningArtifact(tenant, person.id, num, file!); setFile(null); await onSaved(); return a; }, (a) => `Uploaded ${a.filename}.`)}>
            Upload
          </button>
        </div>
        {artifacts.length ? (
          <ul className="eo-list">
            {artifacts.map((a) => (
              <li key={a.id} className="eo-row">
                <button type="button" className="eo-linkbtn" disabled={dl.busy} onClick={() => void dl.run(async () => { const f = await eoApi.downloadAttachment(tenant, person.id, a.id, a.filename); saveFile(f); return f; })}>{a.filename}</button>
                <span className="eo-muted">{`(${a.type.replace(/-/g, ' ')})`}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {dl.message ? <Notice kind={dl.message.kind}>{dl.message.text}</Notice> : null}
      </fieldset>
    </div>
  );
}

function EvidenceRequest({ person }: { person: PersonnelRecord }) {
  const { subject, body } = evidenceRequestText(person.displayName);
  const act = useAction();
  return (
    <section className="eo-gdb" id="evidenceRequest" aria-label="Evidence request">
      <Notice kind="info">Simulated: EO sends no email (FD-6). Copy the text into your own mail, or hand it over.</Notice>
      <Field label="Subject line"><input readOnly value={subject} id="evidenceRequestSubject" /></Field>
      <Field label="Email body"><textarea readOnly rows={10} value={body} id="evidenceRequestBody" /></Field>
      <div className="eo-row">
        <button type="button" className="btn btn-primary btn-small" disabled={act.busy}
          onClick={() => void act.run(async () => ((await copyText(body)) ? 'Copied to the clipboard.' : 'No clipboard here: select the text and copy it.'), (m) => m)}>Copy to clipboard</button>
        <button type="button" className="btn btn-secondary btn-small" disabled={act.busy}
          onClick={() => void act.run(async () => { const f = await eoApi.cuiForm(person.displayName); saveFile(f); return f; }, (f) => `Downloaded ${f.filename}.`)}>Download CUI form (PDF)</button>
      </div>
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
    </section>
  );
}

export function ScreeningPanel({ tenant, person, onClose }: { tenant: string; person: PersonnelRecord; onClose: () => void }) {
  const qc = useQueryClient();
  const defs = useQuery({ queryKey: ['screening-defs'], queryFn: eoApi.screeningDefinitions, retry: false, staleTime: Infinity });
  const sc = useQuery({ queryKey: ['screening', tenant, person.id], queryFn: () => eoApi.screening(tenant, person.id), retry: false });
  const [showRequest, setShowRequest] = useState(false);
  const elements = sc.data?.elements ?? [];
  const oneToSixDone = [1, 2, 3, 4, 5, 6].every((n) => elements.find((e) => e.elementNumber === n)?.status === 'completed');
  const onSaved = async () => {
    await qc.invalidateQueries({ queryKey: ['screening', tenant, person.id] });
    await qc.invalidateQueries({ queryKey: ['screening-readiness', tenant] });
    await qc.invalidateQueries({ queryKey: ['personnel', tenant] });
  };
  return (
    <Card title={`Screening: ${person.displayName}`} id="eo-screening-panel"
      actions={<>
        <button type="button" className="btn btn-ghost btn-small" id="screeningRequestBtn" aria-pressed={showRequest} onClick={() => setShowRequest((x) => !x)}>Request evidence</button>
        <button type="button" className="btn btn-ghost btn-small" id="screeningCloseBtn" onClick={onClose}>Close</button>
      </>}>
      {showRequest ? <EvidenceRequest person={person} /> : null}
      {sc.isError ? <Notice kind="error">Failed to load the screening data.</Notice> : null}
      {elements.map((el) => {
        const def = defs.data?.find((d) => d.elementNumber === el.elementNumber);
        const title = def?.title ?? ELEMENT_TITLES[el.elementNumber] ?? `Element ${el.elementNumber}`;
        return (
          <details key={el.elementNumber} className="eo-details eo-screening-el" data-element={el.elementNumber}>
            <summary>
              <span>{`${el.elementNumber}. ${title}`}</span>{' '}
              <span className="eo-muted">{`${STATUS_ICON[el.status] ?? ''} ${el.status.replace(/_/g, ' ')}`}</span>
            </summary>
            <ElementForm key={`${el.elementNumber}:${el.status}:${el.updatedDate ?? ''}:${def ? 'd' : '-'}`} tenant={tenant} person={person} el={el} def={def} locked={el.elementNumber === 7 && !oneToSixDone} onSaved={onSaved} />
          </details>
        );
      })}
    </Card>
  );
}
