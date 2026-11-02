// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// PolicyDocumentsPanel.tsx — MG-16 (decision D2): the Plan tab's policy
// documents. "Prepare policy documents" builds the Policy Inputs profile from
// the compiled plan + the session (policyInputsProfile.ts) and renders the 20
// documents (policyDocuments.ts). It shows every input's source (discovered,
// derived, defaulted, answered, drafted, missing), lets a person confirm the
// personnel drafted from directory role holders (the confirmation records the
// PI.PER answer), and downloads each document as Markdown or DOCX, or all 20
// as DOCX. BHD's review of the rendered set is BHD-owed and is shown as pending.
import { useState } from 'react';
import { db } from '@/shared/db/schema';
import type { InterviewFact } from '@/shared/types/engagement';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { downloadText } from '../reports/downloadText';
import type { PlanCompileResult } from '../planCompileService';
import { downloadBlob } from './downloadBlob';
import { loadPolicyBank, policyDocxBlob, policyFileBase, renderPolicySet, type PolicySet } from './policyDocuments';

export default function PolicyDocumentsPanel({ result, sessionId }: { result: PlanCompileResult; sessionId: string }) {
  const [set, setSet] = useState<PolicySet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const prepare = async () => {
    setBusy(true);
    setError('');
    try {
      const session = await db.interview_sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      const party = await db.assessed_parties.get(session.party_id);
      if (!party) throw new Error(`Party not found: ${session.party_id}`);
      const next = await renderPolicySet({ compile: result, facts: session.facts, party, bank: await loadPolicyBank() });
      setSet(next);
      setDrafts(Object.fromEntries(next.profile.drafts.map((d) => [d.question_id, d.value])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** A person confirms (or corrects) a drafted personnel value: it becomes the PI.PER answer. */
  const confirmDraft = async (questionId: string) => {
    const value = (drafts[questionId] ?? '').trim();
    if (!value) return;
    const session = await db.interview_sessions.get(sessionId);
    if (!session) return;
    const fact: InterviewFact = {
      question_id: questionId,
      question_text: QUESTION_GRAPH.find((n) => n.id === questionId)?.text ?? questionId,
      answer: value,
      provenance: 'operator_interview',
      confidence: 'high',
      recorded_at: new Date().toISOString(),
      source: 'plan tab: confirmed directory role holder draft',
    };
    await db.interview_sessions.update(sessionId, {
      facts: [...session.facts.filter((f) => f.question_id !== questionId), fact],
    });
    await prepare();
  };

  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

  const downloadDocx = async (doc: PolicySet['documents'][number]) => {
    if (!set) return;
    try {
      downloadBlob(`${policyFileBase(doc)}-${result.tenantSlug}-${stamp()}.docx`, await policyDocxBlob(doc, set.context));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const downloadAllDocx = async () => {
    if (!set) return;
    for (const doc of set.documents) await downloadDocx(doc);
  };

  return (
    <div data-testid="plan-policies" style={{ marginTop: 8 }}>
      <span>Policy documents</span>
      <button
        className="btn-secondary"
        data-testid="plan-policy-prepare"
        onClick={() => void prepare()}
        disabled={busy}
        style={{ marginLeft: 8 }}
      >
        Prepare policy documents
      </button>
      {error && (
        <p className="callout-warning" data-testid="plan-policy-error">
          Policy documents failed: {error}
        </p>
      )}
      {set && (
        <>
          <p className="callout-warning" data-testid="plan-policy-bhd-review">
            Draft set: BHD has not reviewed these documents yet (BHD review is pending).
          </p>

          {set.profile.drafts.length > 0 && (
            <div data-testid="plan-policy-drafts">
              <p>
                Personnel drafted from directory role holders. A draft is not used in the documents until a person
                confirms it (Name | Title | Email).
              </p>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {set.profile.drafts.map((d) => (
                  <li key={d.question_id} data-testid={`plan-policy-draft-${d.question_id}`} style={{ marginBottom: 8 }}>
                    <span>
                      {d.role_title} ({d.source})
                    </span>
                    <input
                      type="text"
                      data-testid={`plan-policy-draft-input-${d.question_id}`}
                      value={drafts[d.question_id] ?? ''}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [d.question_id]: e.target.value }))}
                      style={{ marginLeft: 8, minWidth: 320 }}
                    />
                    <button
                      className="btn-secondary"
                      data-testid={`plan-policy-confirm-${d.question_id}`}
                      onClick={() => void confirmDraft(d.question_id)}
                      style={{ marginLeft: 8 }}
                    >
                      Confirm
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details data-testid="plan-policy-inputs">
            <summary>
              Policy inputs ({set.profile.sources.filter((s) => s.provenance === 'defaulted').length} defaulted,{' '}
              {set.profile.sources.filter((s) => s.provenance === 'missing').length} missing)
            </summary>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {set.profile.sources.map((s) => (
                <li key={s.question_id} data-testid={`plan-policy-input-${s.question_id}`}>
                  <span className="badge" title={s.source ?? ''}>
                    {s.provenance}
                  </span>{' '}
                  {s.question_id}: {s.prompt} {s.value ? `= ${s.value}` : ''}
                </li>
              ))}
            </ul>
          </details>

          <button
            className="btn-secondary"
            data-testid="plan-download-policies-docx-all"
            onClick={() => void downloadAllDocx()}
          >
            Download all {set.documents.length} (DOCX)
          </button>
          <ul style={{ listStyle: 'none', padding: 0 }} data-testid="plan-policy-list">
            {set.documents.map((doc) => (
              <li key={doc.template_id} data-testid={`plan-policy-${policyFileBase(doc)}`} style={{ marginBottom: 8 }}>
                <span>{doc.title}</span> <span className="badge">{doc.completeness}%</span>
                <button
                  className="btn-secondary"
                  data-testid={`plan-download-policy-md-${policyFileBase(doc)}`}
                  onClick={() =>
                    downloadText(`${policyFileBase(doc)}-${result.tenantSlug}-${stamp()}.md`, doc.markdown, 'text/markdown;charset=utf-8')
                  }
                  style={{ marginLeft: 8 }}
                >
                  MD
                </button>
                <button
                  className="btn-secondary"
                  data-testid={`plan-download-policy-docx-${policyFileBase(doc)}`}
                  onClick={() => void downloadDocx(doc)}
                  style={{ marginLeft: 8 }}
                >
                  DOCX
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
