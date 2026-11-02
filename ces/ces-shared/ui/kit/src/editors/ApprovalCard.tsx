// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Approval controls.
// single:     Stamper approve/abort (index.html: task/sub-command/layer approve requests L8951-9090,
//             approve()/approveSubCmd()/approveLayer() L9355-9415, Halt #btnHalt L4568 + haltExecution L7949).
// two-person: AdminOps Tier-3 SoD approval (ces-ao/public/index.html L731 approvals button and count,
//             L878-879 requestor UPN / approvalId inputs, L1206-1216 shown only for a live Tier-3 run,
//             L1483-1490 pending-approval result, L1577-1660 approvals list and decision).
// Props in, callbacks out: no fetch. Request bodies are built here so the SPA sends the legacy keys (AD-4).
import { useState, type ReactNode } from 'react';
import { escId } from './shared';

// ── single (Stamper) ──────────────────────────────────────────────────────────

export type ApprovalDecision = 'approve' | 'accomplish' | 'skip';
export type ApprovalScope = 'task' | 'sub' | 'layer';

/** Body of POST /api/approve, with the legacy keys for each scope. */
export type ApproveRequestBody =
  | { taskId: string; decision: ApprovalDecision }
  | { taskId: string; subId: string; decision: ApprovalDecision }
  | { layer: number; decision: ApprovalDecision };

export interface ApprovalTarget {
  scope: ApprovalScope;
  taskId?: string;
  subId?: string;
  layer?: number;
}

export function approveRequestBody(target: ApprovalTarget, decision: ApprovalDecision): ApproveRequestBody {
  if (target.scope === 'layer') return { layer: target.layer ?? 0, decision };
  if (target.scope === 'sub') return { taskId: target.taskId ?? '', subId: target.subId ?? '', decision };
  return { taskId: target.taskId ?? '', decision };
}

/** Legacy row id: `approval-<task>`, `sub-approval-<task>-<sub>`, `layer-approval-<layer>`. */
export function approvalRowId(target: ApprovalTarget): string {
  if (target.scope === 'layer') return `layer-approval-${target.layer}`;
  if (target.scope === 'sub') return `sub-approval-${escId(target.taskId)}-${escId(target.subId)}`;
  return `approval-${escId(target.taskId)}`;
}

const IDEMPOTENCY_HINTS: Record<string, { tone: 'safe' | 'unsafe' | 'evidence'; text: string }> = {
  safe: { tone: 'safe', text: '(safe to re-run)' },
  'get-then-set': { tone: 'safe', text: '(safe to re-run)' },
  best_effort: { tone: 'safe', text: '(best-effort)' },
  unsafe_requires_gate: { tone: 'unsafe', text: '(unsafe — side effects possible)' },
  unsafe: { tone: 'unsafe', text: '(unsafe — side effects possible)' },
  'evidence-only': { tone: 'evidence', text: '(evidence collection only)' },
};

export interface SingleApprovalProps extends ApprovalTarget {
  mode: 'single';
  /** Layer scope: shown as "Layer N (k tasks)". */
  taskCount?: number;
  /** Optional heading text shown before the buttons (task or command label). */
  title?: ReactNode;
  /** Legacy pre-check badge "✓ Already applied" (sub-command scope). */
  preCheck?: { alreadyApplied?: boolean; output?: string };
  /** Legacy idempotency hint after the buttons. */
  idempotency?: string;
  /** Called with the decision and the exact POST /api/approve body. */
  onDecision: (decision: ApprovalDecision, body: ApproveRequestBody) => void;
  /** Halt control (closes the stream, POST /api/abort): rendered when given. */
  onAbort?: () => void;
  /** Id for the Halt button; the execute screen passes the legacy `btnHalt`. */
  abortId?: string;
  /** Disables the buttons while a decision is in flight. */
  busy?: boolean;
}

function SingleApproval(props: SingleApprovalProps) {
  const { scope, taskCount, title, preCheck, idempotency, onDecision, onAbort, abortId, busy } = props;
  const target: ApprovalTarget = { scope, taskId: props.taskId, subId: props.subId, layer: props.layer };
  const decide = (decision: ApprovalDecision) => onDecision(decision, approveRequestBody(target, decision));
  const isLayer = scope === 'layer';
  const heading = isLayer ? `Layer ${props.layer} (${taskCount ?? 0} tasks)` : title;
  const hint = idempotency ? IDEMPOTENCY_HINTS[idempotency] : undefined;
  const rowClass = isLayer ? 'ck-approval ck-approval-layer approval-btns' : scope === 'sub' ? 'ck-approval sub-approval-btns' : 'ck-approval approval-btns';

  return (
    <div className={rowClass} id={approvalRowId(target)} role="group" aria-label={isLayer ? `Approve layer ${props.layer}` : 'Approval'} data-mode="single" data-scope={scope}>
      {heading ? <span className="ck-approval-title">{heading}</span> : null}
      {preCheck?.alreadyApplied ? (
        <span className="ck-approval-precheck pre-check-badge" title={preCheck.output || 'Resource exists in tenant'}>
          {'✓ Already applied'}
        </span>
      ) : null}
      <button type="button" className="btn btn-primary ck-approval-approve" disabled={busy} onClick={() => decide('approve')}>
        {isLayer ? 'Approve Layer' : 'Approve'}
      </button>
      {isLayer ? null : (
        <button
          type="button"
          className="btn btn-secondary ck-approval-accomplish"
          title="Mark as completed outside Stamper"
          disabled={busy}
          onClick={() => decide('accomplish')}
        >
          Accomplished
        </button>
      )}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => decide('skip')}>
        {isLayer ? 'Skip Layer' : 'Skip'}
      </button>
      {hint ? <span className={`ck-approval-hint ck-approval-hint-${hint.tone} idemp-hint hint-${hint.tone}`}>{hint.text}</span> : null}
      {onAbort ? (
        <button type="button" className="btn btn-destructive ck-approval-abort btn-halt" id={abortId} onClick={onAbort}>
          Halt
        </button>
      ) : null}
    </div>
  );
}

// ── two-person (AdminOps Tier-3) ──────────────────────────────────────────────
// W9-C1 (founder ruling 2026-10-31): no two-person authorization anywhere for now. Every
// two-person component below renders nothing unless the host passes `twoPersonApproval`
// (AdminOps re-enables it with CES_TWO_PERSON_APPROVAL=1). The code is kept intact.

/** Default for the `twoPersonApproval` prop: OFF. */
export const TWO_PERSON_APPROVAL_DEFAULT = false;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed';
export const APPROVAL_STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected', 'executed'];

/** One row of GET /api/approvals. */
export interface ApprovalRecord {
  approvalId: string;
  commandId: string;
  commandTitle?: string;
  requestorUPN: string;
  createdAt?: string;
  inputs?: unknown;
  status: ApprovalStatus;
  approverUPN?: string;
  decidedAt?: string;
  evidencePersisted?: boolean;
  evidenceLost?: boolean;
  evidenceWarning?: string;
  evidenceError?: string;
}

export type TwoPersonDecision = 'approve' | 'reject';

/** What the screen sends: POST /api/approvals/:approvalId/decision, body `{ decision, reason }`. */
export interface TwoPersonDecisionRequest {
  approvalId: string;
  decision: TwoPersonDecision;
  reason?: string;
}

/** AdminOps `isEvidenceLost`. */
export function isEvidenceLost(record: Partial<ApprovalRecord> | null | undefined): boolean {
  return !!record && (record.evidencePersisted === false || record.evidenceLost === true);
}

/** AdminOps `evidenceLostText`. */
export function evidenceLostText(record: Partial<ApprovalRecord>): string {
  return (
    (record.evidenceWarning || 'EVIDENCE NOT PERSISTED — this run has NO audit evidence row.') +
    (record.evidenceError ? `\nCause: ${record.evidenceError}` : '')
  );
}

function sameUpn(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface TwoPersonApprovalProps {
  mode: 'two-person';
  approval: ApprovalRecord;
  /**
   * The approver's UPN as typed (display only, as in AdminOps). When it equals the requestor,
   * the decision buttons are disabled: the approver must be a different person. The server
   * still decides on the authenticated principal.
   */
  approverUpn?: string;
  onDecision: (request: TwoPersonDecisionRequest) => void;
  busy?: boolean;
  /** W9-C1: two-person mode is reachable only when true (default TWO_PERSON_APPROVAL_DEFAULT). */
  twoPersonApproval?: boolean;
}

function TwoPersonApproval({ approval: a, approverUpn, onDecision, busy }: TwoPersonApprovalProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const selfApproval = sameUpn(approverUpn, a.requestorUPN);
  const pending = a.status === 'pending';
  const reasonId = `reject-reason-${escId(a.approvalId)}`;
  const sodId = `sod-${escId(a.approvalId)}`;
  const decided = a.status === 'approved' || a.status === 'executed';

  return (
    <article
      className="ck-approval ck-approval-two"
      data-mode="two-person"
      data-testid={`approval-${a.approvalId}`}
      data-approval-id={a.approvalId}
      data-command-id={a.commandId}
      data-status={a.status}
      aria-label={`Approval ${a.approvalId}`}
    >
      <div className="ck-approval-two-main">
        <div className="ck-approval-command">
          <strong>{a.commandId}</strong>
          {` — ${a.commandTitle || ''}`}
        </div>
        <div className="ck-approval-meta">{`requestor: ${a.requestorUPN} · ${a.createdAt ?? ''}`}</div>
        <div className="ck-approval-meta">
          {'inputs: '}
          <code>{JSON.stringify(a.inputs) ?? 'undefined'}</code>
        </div>
        <div className="ck-approval-meta">
          {'approvalId: '}
          <code className="ck-approval-id">{a.approvalId}</code>
        </div>
        {a.approverUPN ? <div className="ck-approval-meta">{`decided by ${a.approverUPN} at ${a.decidedAt || ''}`}</div> : null}
        {isEvidenceLost(a) ? (
          <div className="ck-alert" role="alert">
            {evidenceLostText(a)}
          </div>
        ) : null}
        {pending && selfApproval ? (
          <p className="ck-approval-sod" id={sodId} role="note">
            The approver must be a different person than the requestor.
          </p>
        ) : null}
        {pending && rejecting ? (
          <div className="ck-approval-reason">
            <label htmlFor={reasonId}>Rejection reason</label>
            <input id={reasonId} type="text" value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        ) : null}
      </div>
      {pending ? (
        <div className="ck-approval-actions">
          {rejecting ? (
            <>
              <button
                type="button"
                className="btn btn-destructive"
                data-testid={`reject-confirm-${a.approvalId}`}
                disabled={busy || selfApproval}
                onClick={() => {
                  onDecision({ approvalId: a.approvalId, decision: 'reject', reason: reason.trim() || undefined });
                  setRejecting(false);
                  setReason('');
                }}
              >
                CONFIRM REJECT
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setRejecting(false)}>
                CANCEL
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary"
                data-testid={`approve-${a.approvalId}`}
                disabled={busy || selfApproval}
                aria-describedby={selfApproval ? sodId : undefined}
                onClick={() => onDecision({ approvalId: a.approvalId, decision: 'approve' })}
              >
                APPROVE
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                data-testid={`reject-${a.approvalId}`}
                disabled={busy || selfApproval}
                aria-describedby={selfApproval ? sodId : undefined}
                onClick={() => setRejecting(true)}
              >
                REJECT
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="ck-approval-actions">
          <span className={decided ? 'badge badge-compliant status-badge success' : 'badge badge-violation status-badge failed'}>
            {a.status.toUpperCase()}
          </span>
        </div>
      )}
    </article>
  );
}

export type ApprovalCardProps = SingleApprovalProps | TwoPersonApprovalProps;

/** Approval card: `single` (Stamper approve / accomplish / skip, optional Halt) or `two-person` (AdminOps Tier-3 SoD). */
export function ApprovalCard(props: ApprovalCardProps) {
  if (props.mode === 'single') return <SingleApproval {...props} />;
  return (props.twoPersonApproval ?? TWO_PERSON_APPROVAL_DEFAULT) ? <TwoPersonApproval {...props} /> : null;
}

// ── two-person companions ─────────────────────────────────────────────────────

export interface ApprovalsButtonProps {
  pendingCount: number;
  onOpen: () => void;
  /** W9-C1: rendered only when true (default TWO_PERSON_APPROVAL_DEFAULT). */
  twoPersonApproval?: boolean;
}

/** AdminOps header button `#approvalsBtn` with the pending count `#approvalsCount` (L731). */
export function ApprovalsButton({ pendingCount, onOpen, twoPersonApproval }: ApprovalsButtonProps) {
  if (!(twoPersonApproval ?? TWO_PERSON_APPROVAL_DEFAULT)) return null;
  return (
    <button
      type="button"
      id="approvalsBtn"
      data-testid="approvals-open"
      className="btn btn-secondary"
      title="Two-person (SoD) approvals for Tier-3 commands"
      onClick={onOpen}
    >
      {'APPROVALS'}
      {pendingCount > 0 ? (
        <span id="approvalsCount" data-testid="approvals-count">
          {` (${pendingCount})`}
        </span>
      ) : null}
    </button>
  );
}

export interface ApprovalRequestFieldsProps {
  /** Live execution armed. */
  live: boolean;
  /** Command `sodTier` includes 3. */
  tier3: boolean;
  requestorUpn: string;
  approvalId: string;
  onRequestorUpnChange: (value: string) => void;
  onApprovalIdChange: (value: string) => void;
  /** W9-C1: rendered only when true (default TWO_PERSON_APPROVAL_DEFAULT). */
  twoPersonApproval?: boolean;
}

/** AdminOps form inputs `#requestorUpnInput` and `#approvalIdInput` (L878-879), shown only for a live Tier-3 run (L1206-1216). */
export function ApprovalRequestFields(props: ApprovalRequestFieldsProps) {
  if (!(props.twoPersonApproval ?? TWO_PERSON_APPROVAL_DEFAULT)) return null;
  if (!(props.live && props.tier3)) return null;
  return (
    <span className="ck-approval-fields">
      <input
        type="text"
        id="requestorUpnInput"
        data-testid="requestor-upn"
        aria-label="Requestor UPN (Tier 3)"
        placeholder="requestor UPN (Tier 3)"
        title="Tier-3 commands open a two-person approval bound to this UPN"
        value={props.requestorUpn}
        onChange={(event) => props.onRequestorUpnChange(event.target.value)}
      />
      <input
        type="text"
        id="approvalIdInput"
        data-testid="approval-id"
        aria-label="Approval id (approved Tier-3 run)"
        placeholder="approvalId (approved Tier-3 run)"
        title="Paste an APPROVED approvalId to execute a gated Tier-3 command"
        value={props.approvalId}
        onChange={(event) => props.onApprovalIdChange(event.target.value)}
      />
    </span>
  );
}

/** AdminOps pending-approval result text (L1483-1490): execute returned 202 `pending_approval`. */
export function PendingApprovalNotice({
  approvalId,
  message,
  twoPersonApproval,
}: {
  approvalId: string;
  message?: string;
  /** W9-C1: rendered only when true (default TWO_PERSON_APPROVAL_DEFAULT). */
  twoPersonApproval?: boolean;
}) {
  if (!(twoPersonApproval ?? TWO_PERSON_APPROVAL_DEFAULT)) return null;
  return (
    <div className="ck-approval-pending" role="status" data-approval-id={approvalId}>
      <span className="badge badge-risk">PENDING APPROVAL</span>
      <pre className="ck-approval-pending-text">
        {`Tier-3 two-person gate: a SECOND person must approve before this can run.\n\n` +
          `approvalId: ${approvalId}\n\n` +
          `${message || ''}\n\n` +
          `Open APPROVALS (header) to approve/reject, then re-run this command LIVE with the approvalId ` +
          `(it has been pre-filled in the form).`}
      </pre>
    </div>
  );
}

export interface ApprovalListProps {
  approvals: readonly ApprovalRecord[];
  status: ApprovalStatus;
  onStatusChange: (status: ApprovalStatus) => void;
  approverUpn: string;
  onApproverUpnChange: (value: string) => void;
  /** Approver sign-in token, sent by the screen as `x-ces-principal` (W4-AO3). */
  approverToken: string;
  onApproverTokenChange: (value: string) => void;
  onRefresh: () => void;
  onDecision: (request: TwoPersonDecisionRequest) => void;
  loading?: boolean;
  /** Load failure message (legacy "failed to load approvals: ..."). */
  error?: string;
  /** Evidence-loss banner after a decision (`#approvalsEvidenceBanner`). */
  evidenceBanner?: string;
  busy?: boolean;
  /** W9-C1: rendered only when true (default TWO_PERSON_APPROVAL_DEFAULT). */
  twoPersonApproval?: boolean;
}

/** AdminOps open-approvals list (`#approvalsModal` body, L1577-1600): filter, approver identity, rows. */
export function ApprovalList(props: ApprovalListProps) {
  const { approvals, status } = props;
  if (!(props.twoPersonApproval ?? TWO_PERSON_APPROVAL_DEFAULT)) return null;
  let body: ReactNode;
  if (props.loading) body = <em>{'loading…'}</em>;
  else if (props.error) body = <em>{`failed to load approvals: ${props.error}`}</em>;
  else if (approvals.length === 0) body = <em>{`no ${status} approvals`}</em>;
  else
    body = approvals.map((a) => (
      <ApprovalCard key={a.approvalId} mode="two-person" approval={a} approverUpn={props.approverUpn} onDecision={props.onDecision} busy={props.busy} twoPersonApproval />
    ));

  return (
    <section className="ck-approval-list" aria-labelledby="approvalsHeading" data-testid="approvals-modal">
      <h3 id="approvalsHeading" className="ck-approval-list-title">
        Tier-3 Approvals (two-person rule)
      </h3>
      <p className="ck-approval-list-note">
        {'The approver must be a DIFFERENT person than the requestor. Approving does not execute — re-run the command LIVE with the approvalId.'}
      </p>
      <div className="ck-approval-list-controls">
        <select
          id="approvalsStatusFilter"
          data-testid="approvals-status-filter"
          aria-label="Approval status"
          value={status}
          onChange={(event) => props.onStatusChange(event.target.value as ApprovalStatus)}
        >
          {APPROVAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          id="approverUpnInput"
          data-testid="approver-upn"
          aria-label="Approver UPN (display only)"
          placeholder="approver UPN (display only)"
          value={props.approverUpn}
          onChange={(event) => props.onApproverUpnChange(event.target.value)}
        />
        <input
          type="password"
          id="approverTokenInput"
          data-testid="approver-token"
          aria-label="Approver sign-in token (x-ces-principal)"
          placeholder="approver sign-in token (x-ces-principal)"
          autoComplete="off"
          value={props.approverToken}
          onChange={(event) => props.onApproverTokenChange(event.target.value)}
        />
        <button type="button" className="btn btn-secondary" data-testid="approvals-refresh" onClick={props.onRefresh}>
          REFRESH
        </button>
      </div>
      {props.evidenceBanner ? (
        <div className="ck-alert" id="approvalsEvidenceBanner" data-testid="approvals-evidence-banner" role="alert">
          {props.evidenceBanner}
        </div>
      ) : null}
      <div className="ck-approval-rows" id="approvalsList" data-testid="approvals-list">
        {body}
      </div>
    </section>
  );
}
