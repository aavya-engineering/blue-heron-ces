// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the result panel (legacy #resultPanel, L842-866). The machine-readable attributes are the
// AO-UI-TEST-HOOKS.md contract: data-state / data-outcome / data-verdict / data-approval-id /
// data-correlation-id. The pending-approval text is the kit's PendingApprovalNotice, which renders
// nothing while two-person approval is off.

import { PendingApprovalNotice } from 'ces-ui-kit';
import { useAoStore } from '../../store/ao';

export function ResultPanel() {
  const r = useAoStore((s) => s.result);
  const twoPersonOn = useAoStore((s) => s.twoPersonOn);
  const state = r?.state ?? 'idle';
  return (
    <section
      id="resultPanel"
      data-testid="result-panel"
      className="ao-result"
      aria-label="Result"
      data-state={state}
      data-outcome={r?.outcome ?? ''}
      data-verdict={r?.verdict ?? ''}
      data-approval-id={r?.approvalId ?? ''}
      data-correlation-id={r?.correlationId ?? ''}
      hidden={!r}
    >
      {r ? (
        <>
          <div className="ao-result-head">
            <span className="ao-label">Result</span>
            <span id="resultStatusBadge" data-testid="result-status" className={`status-badge ${r.badgeClass}`} role="status">
              {r.badge}
            </span>
          </div>
          {r.refusal ? (
            <div className="ck-alert" id="refusalBanner" data-testid="refusal-banner" role="alert">
              {r.refusal}
            </div>
          ) : null}
          {r.evidenceLost ? (
            <div className="ck-alert" id="evidenceLostBanner" data-testid="evidence-lost-banner" role="alert">
              {r.evidenceLost}
            </div>
          ) : null}
          <div id="resultCorrelationId" data-testid="result-correlation-id" className="ao-mono ao-muted">
            {r.correlationId ? `correlationId: ${r.correlationId}` : ''}
          </div>
          {r.state === 'pending_approval' ? (
            <PendingApprovalNotice approvalId={r.approvalId ?? ''} message={r.pendingMessage} twoPersonApproval={twoPersonOn} />
          ) : null}
          {/* Always present, as legacy #resultOutput (empty while an approval is pending). */}
          <pre id="resultOutput" data-testid="result-output" className="ao-output" tabIndex={0} aria-label="Command output">
            {r.output}
          </pre>
          {r.evidence ? (
            <div id="evidenceSection" data-testid="evidence-section" className="ao-evidence-summary">
              <span className="ao-label">Evidence</span>
              <span
                id="evidenceOutcomeBadge"
                data-testid="evidence-outcome"
                className={r.evidence.sat ? 'badge badge-compliant outcome-badge sat' : 'badge badge-violation outcome-badge not-sat'}
              >
                {r.evidence.outcome}
              </span>
              <div id="evidenceVerdict" data-testid="evidence-verdict">
                {r.evidence.verdictText}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
