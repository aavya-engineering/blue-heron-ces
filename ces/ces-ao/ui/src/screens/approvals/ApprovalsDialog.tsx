// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the Tier 3 approvals dialog (legacy #approvalsModal, L1687-1809), built from the kit's
// ApprovalList. The whole dialog renders nothing while two-person approval is off (founder ruling,
// AGENT-BRIEF-PH34 "Binding founder rulings"; the kit's W9-C1 default). The server records the
// authenticated principal from `x-ces-principal`; the typed approver UPN is display only.

import { ApprovalList } from 'ces-ui-kit';
import { closeApprovals, decideApproval, loadApprovals, useAoStore } from '../../store/ao';

export function ApprovalsDialog() {
  const s = useAoStore();
  if (!s.twoPersonOn || !s.approvalsOpen) return null;
  return (
    <div className="ao-overlay">
      <div className="ao-dialog ao-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="approvalsHeading">
        <ApprovalList
          approvals={s.approvals}
          status={s.approvalsStatus}
          onStatusChange={(status) => void loadApprovals(status)}
          approverUpn={s.approverUpn}
          onApproverUpnChange={(v) => useAoStore.setState({ approverUpn: v })}
          approverToken={s.approverToken}
          onApproverTokenChange={(v) => useAoStore.setState({ approverToken: v })}
          onRefresh={() => void loadApprovals()}
          onDecision={(req) => void decideApproval(req)}
          loading={s.approvalsLoading}
          error={s.approvalsError || undefined}
          evidenceBanner={s.approvalsBanner || undefined}
          twoPersonApproval
        />
        {s.approvalsNotice ? (
          <p className="ao-notice" role="status" data-testid="approvals-notice">
            {s.approvalsNotice}
          </p>
        ) : null}
        <div className="ao-row">
          <button type="button" className="btn btn-secondary" data-testid="approvals-close" onClick={closeApprovals}>
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
