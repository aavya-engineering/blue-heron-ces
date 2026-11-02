// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Review (GD-b document reviews of non-stack objectives; NS-audit F-3, FD-10). The reviewer holds a
// minted approver token; the screen shows whom it names beside the chosen upload's recorded
// uploader and will not submit when they are the same person, or when the upload has no recorded
// uploader. EO enforces both anyway (403 reviewer_is_uploader, 409 uploader_unknown). The latest
// review per objective counts (FIN-12 supersede). This is separation of duties, not two-person
// approval, so it is shown while CES_TWO_PERSON_APPROVAL is off.
//
// Data: GET /api/review-queue/controls, GET /api/review-queue (read-only), POST /api/reviews.

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { ApiError } from '../../api/http';
import { sameUpn, tokenExpired, tokenUpn } from '../../api/token';
import type { ReviewQueueItem } from '../../api/types';
import { useSession } from '../../store/session';
import { Card, Field, Notice, StatusBadge, TenantRequired, errorText, type NoticeKind } from '../../components/common';

const REFUSAL_TEXT: Record<string, string> = {
  reviewer_is_uploader: 'Refused: a reviewer may not review an artifact they uploaded (GD-b).',
  uploader_unknown: 'Refused: the upload has no recorded uploader, so reviewer independence cannot be checked.',
  artifact_not_found: 'Refused: no EC item for this control carries that file hash.',
  unauthorized: 'Refused: the approver token was not accepted.',
};

/** Why the review cannot be submitted yet, or null when it can. */
export function blockReason(item: ReviewQueueItem | null, reviewerUpn: string | null, objectiveId: string, token: string): string | null {
  if (!item) return 'Choose an upload to review.';
  if (!objectiveId) return 'Choose the objective this upload shows.';
  if (!token.trim()) return 'An approver token is required (mint one on the Tenant and access screen).';
  if (tokenExpired(token)) return 'The approver token has expired.';
  if (!item.uploadedBy) return 'This upload has no recorded uploader, so no review can credit it.';
  if (sameUpn(item.uploadedBy.upn, reviewerUpn)) return `The approver token names ${reviewerUpn}, who uploaded this document. Another person must review it (GD-b).`;
  return null;
}

function ReviewBody({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const approverToken = useSession((s) => s.approverToken);
  const setApproverToken = useSession((s) => s.setApproverToken);
  const controls = useQuery({ queryKey: ['review-controls'], queryFn: eoApi.reviewControls, retry: false });
  const [controlId, setControlId] = useState('');
  const queue = useQuery({
    queryKey: ['review-queue', tenant, controlId],
    queryFn: () => eoApi.reviewQueue(tenant, controlId),
    enabled: !!controlId,
    retry: false,
  });
  const [itemId, setItemId] = useState('');
  const [objectiveId, setObjectiveId] = useState('');
  const [verdict, setVerdict] = useState<'met' | 'not_met'>('met');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: NoticeKind; text: string } | null>(null);

  useEffect(() => { setItemId(''); setObjectiveId(''); setStatus(null); }, [controlId]);

  const item = queue.data?.items.find((i) => i.itemId === itemId) ?? null;
  const reviewerUpn = tokenUpn(approverToken);
  const block = blockReason(item, reviewerUpn, objectiveId, approverToken);

  const submit = async () => {
    if (block || !item) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await eoApi.postReview({ tenant, controlId, objectiveId, artifactHash: item.sha256, verdict, notes, approverToken });
      setStatus({ kind: 'success', text: `Review recorded (${r.reviewId}): ${r.objectiveId} ${r.verdict} by ${r.reviewer.upn}; uploader ${r.uploader.upn}.${r.supersedes?.length ? ` It replaces ${r.supersedes.length} earlier review(s) of this objective.` : ''}` });
      setNotes('');
      await qc.invalidateQueries({ queryKey: ['review-queue', tenant, controlId] });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setStatus({ kind: 'error', text: (code && REFUSAL_TEXT[code]) ? `${REFUSAL_TEXT[code]} (HTTP ${(e as ApiError).status})` : errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Document review (GD-b)" id="eo-review-card">
        <p>
          A non-stack control is met only by reviews of uploaded documents, each by someone other than the person who uploaded it. The
          latest review of an objective is the one that counts.
        </p>
        <Field label="Control (non-stack set)">
          <select id="reviewControl" value={controlId} onChange={(e) => setControlId(e.target.value)}>
            <option value="">Select a control...</option>
            {(controls.data?.controls ?? []).map((c) => <option key={c.controlId} value={c.controlId}>{c.controlId}</option>)}
          </select>
        </Field>
        {queue.isError ? <Notice kind="error">{`The review queue could not be loaded: ${errorText(queue.error)}`}</Notice> : null}
        {queue.data ? (
          <>
            <fieldset className="eo-fieldset">
              <legend>Uploads on {controlId}</legend>
              {queue.data.items.length === 0 ? <Notice kind="warn">No uploads on this control yet (Upload screen).</Notice> : (
                <div className="eo-table-wrap">
                  <table className="eo-table" id="reviewItems">
                    <thead><tr><th scope="col">Pick</th><th scope="col">File</th><th scope="col">Uploaded by</th><th scope="col">Collected</th><th scope="col">SHA-256</th></tr></thead>
                    <tbody>
                      {queue.data.items.map((i) => (
                        <tr key={i.itemId}>
                          <td><input type="radio" name="reviewItem" value={i.itemId} checked={itemId === i.itemId} onChange={() => setItemId(i.itemId)} aria-label={`Review ${i.filename}`} /></td>
                          <td>{i.filename}</td>
                          <td>{i.uploadedBy?.upn ?? <span className="eo-muted">not recorded</span>}</td>
                          <td>{new Date(i.collectedAt).toLocaleString()}</td>
                          <td className="eo-mono">{i.sha256}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </fieldset>
            <div className="eo-grid-2">
              <Field label="Objective">
                <select id="reviewObjective" value={objectiveId} onChange={(e) => setObjectiveId(e.target.value)}>
                  <option value="">Select an objective...</option>
                  {queue.data.objectiveIds.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Verdict">
                <select id="reviewVerdict" value={verdict} onChange={(e) => setVerdict(e.target.value as 'met' | 'not_met')}>
                  <option value="met">met</option>
                  <option value="not_met">not met</option>
                </select>
              </Field>
            </div>
            <Field label="Notes (optional)"><textarea id="reviewNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Field label="Approver token" hint="Minted for the reviewer. Sent as x-ces-principal.">
              <textarea id="reviewApproverToken" rows={2} value={approverToken} onChange={(e) => setApproverToken(e.target.value)} />
            </Field>
            <div className="eo-gdb" id="reviewIdentities">
              <div>{`Reviewer (approver token): ${reviewerUpn ?? 'none'}`}</div>
              <div>{`Uploader (recorded by EC): ${item ? item.uploadedBy?.upn ?? 'not recorded' : '—'}`}</div>
            </div>
            {block ? <Notice kind="warn" id="reviewBlock">{block}</Notice> : null}
            <div className="eo-row">
              <button type="button" className="btn btn-primary btn-small" id="reviewSubmitBtn" disabled={!!block || busy} onClick={() => void submit()}>
                Record review
              </button>
            </div>
            {status ? <Notice kind={status.kind} id="reviewStatus">{status.text}</Notice> : null}
          </>
        ) : null}
      </Card>
      {queue.data ? (
        <Card title={`Reviews that count on ${controlId}`} id="eo-review-live">
          {queue.data.reviews.length === 0 ? <Notice>No reviews yet.</Notice> : (
            <div className="eo-table-wrap">
              <table className="eo-table" id="reviewLive">
                <thead><tr><th scope="col">Objective</th><th scope="col">Verdict</th><th scope="col">Reviewer</th><th scope="col">Uploader</th><th scope="col">When</th></tr></thead>
                <tbody>
                  {queue.data.reviews.map((r) => (
                    <tr key={r.reviewId}><td>{r.objectiveId}</td><td><StatusBadge status={r.verdict} /></td><td>{r.reviewer.upn}</td><td>{r.uploader.upn}</td><td>{new Date(r.reviewedAt).toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}

export default function ReviewScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <ReviewBody tenant={t} />}</TenantRequired></div>;
}
